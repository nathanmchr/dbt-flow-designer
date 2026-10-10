import type { Edge } from "@xyflow/react";

import type { HistoryState, OperationNode } from "../types";

const POSITION_TOLERANCE_PX = 1;

function cloneParams(
  params: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  return params === undefined ? undefined : structuredClone(params);
}

function normalizeSerializableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSerializableValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) =>
        !["function", "symbol", "undefined"].includes(typeof entry)
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeSerializableValue(entry)])
  );
}

function paramsKey(params: Record<string, unknown> | undefined): string {
  return JSON.stringify(normalizeSerializableValue(params ?? {}));
}

function canonicalEdge(edge: Edge): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  };
}

export function createHistoryState(
  nodes: OperationNode[],
  edges: Edge[]
): HistoryState {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      data: {
        operation: node.data.operation,
        params: cloneParams(node.data.params),
      },
    })),
    edges: edges.map(canonicalEdge),
  };
}

export function areHistoryStatesEqual(
  left: HistoryState,
  right: HistoryState
): boolean {
  if (
    left.nodes.length !== right.nodes.length ||
    left.edges.length !== right.edges.length
  ) {
    return false;
  }

  const rightNodes = new Map(right.nodes.map((node) => [node.id, node]));
  const nodesMatch = left.nodes.every((node) => {
    const candidate = rightNodes.get(node.id);
    return Boolean(
      candidate &&
        node.type === candidate.type &&
        node.data.operation.id === candidate.data.operation.id &&
        Math.abs(node.position.x - candidate.position.x) <=
          POSITION_TOLERANCE_PX &&
        Math.abs(node.position.y - candidate.position.y) <=
          POSITION_TOLERANCE_PX &&
        paramsKey(node.data.params) === paramsKey(candidate.data.params)
    );
  });
  if (!nodesMatch) return false;

  const rightEdges = new Map(right.edges.map((edge) => [edge.id, edge]));
  return left.edges.every((edge) => {
    const candidate = rightEdges.get(edge.id);
    return Boolean(
      candidate &&
        edge.source === candidate.source &&
        edge.target === candidate.target &&
        (edge.type ?? "default") === (candidate.type ?? "default") &&
        (edge.sourceHandle ?? null) === (candidate.sourceHandle ?? null) &&
        (edge.targetHandle ?? null) === (candidate.targetHandle ?? null)
    );
  });
}

export function describeHistoryChange(
  fromState: HistoryState,
  toState: HistoryState
): string {
  const addedNode = toState.nodes.find(
    (node) => !fromState.nodes.some((candidate) => candidate.id === node.id)
  );
  if (addedNode) return `Added node "${addedNode.data.operation.label}"`;

  const deletedNode = fromState.nodes.find(
    (node) => !toState.nodes.some((candidate) => candidate.id === node.id)
  );
  if (deletedNode) return `Deleted node "${deletedNode.data.operation.label}"`;

  const addedEdge = toState.edges.find(
    (edge) => !fromState.edges.some((candidate) => candidate.id === edge.id)
  );
  if (addedEdge) {
    const sourceNode = toState.nodes.find(
      (node) => node.id === addedEdge.source
    );
    const targetNode = toState.nodes.find(
      (node) => node.id === addedEdge.target
    );
    return sourceNode && targetNode
      ? `Connected "${sourceNode.data.operation.label}" to "${targetNode.data.operation.label}"`
      : "Connected nodes";
  }

  const deletedEdge = fromState.edges.find(
    (edge) => !toState.edges.some((candidate) => candidate.id === edge.id)
  );
  if (deletedEdge) {
    const sourceNode = fromState.nodes.find(
      (node) => node.id === deletedEdge.source
    );
    const targetNode = fromState.nodes.find(
      (node) => node.id === deletedEdge.target
    );
    return sourceNode && targetNode
      ? `Disconnected "${sourceNode.data.operation.label}" from "${targetNode.data.operation.label}"`
      : "Disconnected nodes";
  }

  const movedNode = toState.nodes.find((node) => {
    const previous = fromState.nodes.find(
      (candidate) => candidate.id === node.id
    );
    return Boolean(
      previous &&
        (Math.abs(previous.position.x - node.position.x) >
          POSITION_TOLERANCE_PX ||
          Math.abs(previous.position.y - node.position.y) >
            POSITION_TOLERANCE_PX)
    );
  });
  if (movedNode) return `Moved node "${movedNode.data.operation.label}"`;

  const modifiedNode = toState.nodes.find((node) => {
    const previous = fromState.nodes.find(
      (candidate) => candidate.id === node.id
    );
    return Boolean(
      previous &&
        (previous.type !== node.type ||
          previous.data.operation.id !== node.data.operation.id ||
          paramsKey(previous.data.params) !== paramsKey(node.data.params))
    );
  });
  if (modifiedNode) {
    return `Modified node "${modifiedNode.data.operation.label}"`;
  }

  const reconnectedEdge = toState.edges.find((edge) => {
    const previous = fromState.edges.find(
      (candidate) => candidate.id === edge.id
    );
    return Boolean(
      previous &&
        (previous.source !== edge.source ||
          previous.target !== edge.target ||
          (previous.sourceHandle ?? null) !== (edge.sourceHandle ?? null) ||
          (previous.targetHandle ?? null) !== (edge.targetHandle ?? null))
    );
  });
  if (reconnectedEdge) return "Reconnected nodes";

  return "Updated flow";
}
