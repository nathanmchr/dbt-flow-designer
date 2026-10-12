import type { Edge } from "@xyflow/react";

import type {
  HistoryState,
  ModelData,
  OperationNode,
  ProjectSecretEnvelope,
} from "../types";
import { areHistoryStatesEqual, createHistoryState } from "./historyState.ts";

export const CURRENT_MODEL_STORAGE_KEY = "dbt-flow-designer.current-model.v1";
export const FLOW_HISTORY_STORAGE_KEY = "dbt-flow-designer.flow-history.v1";
const MAX_HISTORY_STATES = 50;
const OBSOLETE_OPERATION_IDS = new Set(["source-manual"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CurrentModelState = Pick<
  ModelData,
  "modelName" | "nodes" | "edges" | "nodeCounter"
> &
  Partial<Pick<ModelData, "projectId" | "secretEnvelope">>;

export interface FlowHistorySnapshot {
  version: "1.0";
  history: HistoryState[];
  historyIndex: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEncryptedBlob(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.nonce === "string" &&
    value.nonce.length > 0 &&
    typeof value.ciphertext === "string" &&
    value.ciphertext.length > 0
  );
}

function isProjectSecretEnvelope(
  value: unknown,
  projectId: string
): value is ProjectSecretEnvelope {
  return (
    isRecord(value) &&
    value.version === "1.0" &&
    value.algorithm === "AES-256-GCM" &&
    value.project_id === projectId &&
    isEncryptedBlob(value.wrapped_key) &&
    isEncryptedBlob(value.payload)
  );
}

export function createProjectId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("Secure random identifiers are unavailable");
  }
  return globalThis.crypto.randomUUID();
}

function isOperationNode(value: unknown): value is OperationNode {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  if (!isRecord(value.position)) return false;
  if (
    typeof value.position.x !== "number" ||
    typeof value.position.y !== "number"
  ) {
    return false;
  }
  if (!isRecord(value.data) || !isRecord(value.data.operation)) return false;
  return typeof value.data.operation.id === "string";
}

function isEdge(value: unknown): value is Edge {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.source === "string" &&
    typeof value.target === "string"
  );
}

function isHistoryState(value: unknown): value is HistoryState {
  return (
    isRecord(value) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isOperationNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isEdge)
  );
}

function removeObsoleteOperationNodes(
  nodes: OperationNode[],
  edges: Edge[]
): { nodes: OperationNode[]; edges: Edge[] } {
  const retainedNodes = nodes.filter(
    (node) => !OBSOLETE_OPERATION_IDS.has(node.data.operation.id)
  );

  if (retainedNodes.length === nodes.length) return { nodes, edges };

  const retainedNodeIds = new Set(retainedNodes.map((node) => node.id));
  return {
    nodes: retainedNodes,
    edges: edges.filter(
      (edge) =>
        retainedNodeIds.has(edge.source) && retainedNodeIds.has(edge.target)
    ),
  };
}

function sanitizeAdapter(
  adapter: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  Object.entries(adapter).forEach(([key, value]) => {
    if (key === "password" || key === "token") return;
    sanitized[key] = isRecord(value) ? sanitizeAdapter(value) : value;
  });

  return sanitized;
}

export function sanitizeModelNodes(nodes: OperationNode[]): OperationNode[] {
  return nodes.map((node) => {
    if (node.data.operation.id !== "database") return node;

    const adapter = node.data.params?.adapter;
    if (!isRecord(adapter)) return node;

    return {
      ...node,
      data: {
        ...node.data,
        params: {
          ...node.data.params,
          adapter: sanitizeAdapter(adapter),
        },
      },
    };
  });
}

export function createCurrentModelSnapshot(
  state: CurrentModelState
): ModelData {
  const projectId = state.projectId ?? createProjectId();

  return {
    version: "1.0",
    timestamp: new Date().toISOString(),
    projectId,
    modelName: state.modelName,
    nodes: sanitizeModelNodes(state.nodes),
    edges: state.edges,
    nodeCounter: state.nodeCounter,
    ...(state.secretEnvelope?.project_id === projectId
      ? { secretEnvelope: state.secretEnvelope }
      : {}),
  };
}

export function parseCurrentModel(serialized: string | null): ModelData | null {
  if (!serialized) return null;

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || parsed.version !== "1.0") return null;
    if (typeof parsed.modelName !== "string") return null;
    if (!Array.isArray(parsed.nodes) || !parsed.nodes.every(isOperationNode)) {
      return null;
    }
    if (!Array.isArray(parsed.edges) || !parsed.edges.every(isEdge)) return null;

    const projectId =
      typeof parsed.projectId === "string" && UUID_PATTERN.test(parsed.projectId)
        ? parsed.projectId
        : createProjectId();
    const migratedFlow = removeObsoleteOperationNodes(
      sanitizeModelNodes(parsed.nodes),
      parsed.edges
    );

    return {
      version: parsed.version,
      timestamp:
        typeof parsed.timestamp === "string"
          ? parsed.timestamp
          : new Date().toISOString(),
      projectId,
      modelName: parsed.modelName,
      nodes: migratedFlow.nodes,
      edges: migratedFlow.edges,
      nodeCounter:
        typeof parsed.nodeCounter === "number" &&
        Number.isFinite(parsed.nodeCounter) &&
        parsed.nodeCounter >= 0
          ? parsed.nodeCounter
          : parsed.nodes.length,
      ...(isProjectSecretEnvelope(parsed.secretEnvelope, projectId)
        ? { secretEnvelope: parsed.secretEnvelope }
        : {}),
    };
  } catch {
    return null;
  }
}

export function loadCurrentModel(): ModelData | null {
  if (typeof window === "undefined") return null;

  try {
    return parseCurrentModel(window.localStorage.getItem(CURRENT_MODEL_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function persistCurrentModel(state: CurrentModelState): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      CURRENT_MODEL_STORAGE_KEY,
      JSON.stringify(createCurrentModelSnapshot(state))
    );
  } catch {
    // Storage can be disabled or full; the editor must remain usable either way.
  }
}

function sameHistoryState(left: HistoryState, right: HistoryState): boolean {
  return areHistoryStatesEqual(
    createHistoryState(sanitizeModelNodes(left.nodes), left.edges),
    createHistoryState(sanitizeModelNodes(right.nodes), right.edges)
  );
}

export function createFlowHistorySnapshot(
  history: HistoryState[],
  historyIndex: number
): FlowHistorySnapshot {
  const sourceHistory = history.length
    ? history
    : [createHistoryState([], [])];
  const safeIndex = Number.isInteger(historyIndex)
    ? Math.min(Math.max(historyIndex, 0), sourceHistory.length - 1)
    : sourceHistory.length - 1;
  const maxStart = Math.max(0, sourceHistory.length - MAX_HISTORY_STATES);
  const preferredStart = safeIndex - Math.floor(MAX_HISTORY_STATES / 2);
  const start = Math.min(Math.max(preferredStart, 0), maxStart);
  const boundedHistory = sourceHistory.slice(
    start,
    start + MAX_HISTORY_STATES
  );

  return {
    version: "1.0",
    history: boundedHistory.map((state) =>
      createHistoryState(sanitizeModelNodes(state.nodes), state.edges)
    ),
    historyIndex: safeIndex - start,
  };
}

export function parseFlowHistory(
  serialized: string | null,
  currentState?: HistoryState
): FlowHistorySnapshot | null {
  if (!serialized) return null;

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || parsed.version !== "1.0") return null;
    if (
      !Array.isArray(parsed.history) ||
      parsed.history.length === 0 ||
      !parsed.history.every(isHistoryState)
    ) {
      return null;
    }
    if (
      typeof parsed.historyIndex !== "number" ||
      !Number.isInteger(parsed.historyIndex) ||
      parsed.historyIndex < 0 ||
      parsed.historyIndex >= parsed.history.length
    ) {
      return null;
    }

    const migratedHistory = parsed.history.map((state) => ({
      ...state,
      ...removeObsoleteOperationNodes(state.nodes, state.edges),
    }));
    const snapshot = createFlowHistorySnapshot(
      migratedHistory,
      parsed.historyIndex
    );
    if (
      currentState &&
      !sameHistoryState(snapshot.history[snapshot.historyIndex], currentState)
    ) {
      return null;
    }

    return snapshot;
  } catch {
    return null;
  }
}

export function loadFlowHistory(
  currentState: HistoryState
): FlowHistorySnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    return parseFlowHistory(
      window.localStorage.getItem(FLOW_HISTORY_STORAGE_KEY),
      currentState
    );
  } catch {
    return null;
  }
}

export function persistFlowHistory(
  history: HistoryState[],
  historyIndex: number
): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      FLOW_HISTORY_STORAGE_KEY,
      JSON.stringify(createFlowHistorySnapshot(history, historyIndex))
    );
  } catch {
    // Persistence is best-effort when browser storage is unavailable or full.
  }
}
