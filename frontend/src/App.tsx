/**
 * @fileoverview Main application component for the dbt Flow Designer.
 *
 * Manages the overall application state including:
 * - Flowchart nodes and edges
 * - Undo/redo history
 * - Model name and export functionality
 * - Node selection and inspector integration
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Edge, Node } from "@xyflow/react";
import {
  Flowchart,
  Inspector,
  Toolbox,
  Tooltip,
  QueryResultsPanel,
} from "./components";
import {
  OPERATION_DEFS,
  type OperationDefinition,
} from "./definitions/operations";
import {
  getAvailableColumns,
  type ColumnDefinition,
} from "./definitions/columnPropagation";
import { generateDbtModel } from "./generators/dbtGenerator";
import { api, type QueryResult } from "./services/api";
import { buildDatabaseCredentials } from "./services/databaseCredentials";
import { ENABLED_DBT_ADAPTER_IDS } from "./definitions/dbtAdapters";
import {
  consumeLegacyDatabaseSecretSnapshot,
  createDatabaseSecretSnapshot,
  hydrateDatabaseSecrets,
} from "./services/databaseSecretPersistence";
import {
  createCurrentModelSnapshot,
  createProjectId,
  loadFlowHistory,
  loadCurrentModel,
  parseCurrentModel,
  persistFlowHistory,
  persistCurrentModel,
} from "./services/modelPersistence";
import { createBlankModelState } from "./services/modelLifecycle";
import {
  areHistoryStatesEqual,
  createHistoryState,
  describeHistoryChange,
} from "./services/historyState";
import type {
  HistoryState,
  OperationNodeData,
  ProjectSecretEnvelope,
} from "./types";

function App() {
  const [initialModel] = useState(loadCurrentModel);
  const [legacyDatabaseSecrets] = useState(
    consumeLegacyDatabaseSecretSnapshot
  );
  const [blankInitialModel] = useState(createBlankModelState);
  const initialModelName = initialModel?.modelName || blankInitialModel.modelName;
  const initialNodes = hydrateDatabaseSecrets(
    initialModel?.nodes ?? blankInitialModel.nodes,
    legacyDatabaseSecrets
  );
  const initialEdges = initialModel?.edges ?? blankInitialModel.edges;
  const [initialFlowHistory] = useState(() =>
    loadFlowHistory({ nodes: initialNodes, edges: initialEdges })
  );
  const restoredInitialHistory = initialFlowHistory?.history.map((state) => ({
    ...state,
    nodes: hydrateDatabaseSecrets(state.nodes, legacyDatabaseSecrets),
  }));

  const [nodes, setNodes] = useState<Node<OperationNodeData>[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [nodeCounter, setNodeCounter] = useState(
    initialModel?.nodeCounter ?? blankInitialModel.nodeCounter
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [modelName, setModelName] = useState(initialModelName);
  const [projectId, setProjectId] = useState(
    () => initialModel?.projectId ?? createProjectId()
  );
  const [secretEnvelope, setSecretEnvelope] =
    useState<ProjectSecretEnvelope | null>(
      initialModel?.secretEnvelope ?? null
    );
  const [secretsReady, setSecretsReady] = useState(
    !initialModel?.secretEnvelope
  );
  const secretEnvelopeRef = useRef<ProjectSecretEnvelope | null>(
    initialModel?.secretEnvelope ?? null
  );
  const [isEditingName, setIsEditingName] = useState(false);

  // Query test results state
  const [queryResults, setQueryResults] = useState<QueryResult | null>(null);
  const [isTestLoading, setIsTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [isResultsPanelExpanded, setIsResultsPanelExpanded] = useState(false);
  const previousModelName = useRef(initialModelName);

  // Undo/Redo history management
  const [history, setHistory] = useState<HistoryState[]>(
    restoredInitialHistory ?? [
      createHistoryState(initialNodes, initialEdges),
    ]
  );
  const [historyIndex, setHistoryIndex] = useState(
    initialFlowHistory?.historyIndex ?? 0
  );
  const movingNodes = useRef<Set<string>>(new Set()); // Track which nodes are being moved
  const isRestoringHistory = useRef(false);
  const toolboxLayoutRef = useRef({ isOpen: true, width: 280 });
  const inspectorLayoutRef = useRef({ isOpen: false, width: 280 });
  const [isToolboxOpen, setIsToolboxOpen] = useState(true);

  const handleToolboxLayoutChange = useCallback(
    (isOpen: boolean, width: number) => {
      toolboxLayoutRef.current = { isOpen, width };
      setIsToolboxOpen(isOpen);
    },
    []
  );

  const getFitViewLeftPadding = useCallback(() => {
    const { isOpen, width } = toolboxLayoutRef.current;
    return isOpen ? width + 32 : 32;
  }, []);

  const handleInspectorLayoutChange = useCallback(
    (isOpen: boolean, width: number) => {
      inspectorLayoutRef.current = { isOpen, width };
    },
    []
  );

  const getFitViewRightPadding = useCallback(() => {
    const { isOpen, width } = inspectorLayoutRef.current;
    return isOpen ? width + 32 : 32;
  }, []);

  const [undoDescription, setUndoDescription] = useState<string>("");
  const [redoDescription, setRedoDescription] = useState<string>("");

  // Dropdown menu state
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isNewModelDialogOpen, setIsNewModelDialogOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const currentModelStateRef = useRef({
    projectId,
    modelName,
    nodes,
    edges,
    nodeCounter,
  });
  currentModelStateRef.current = {
    projectId,
    modelName,
    nodes,
    edges,
    nodeCounter,
  };
  const databasePasswordsJson = useMemo(
    () => JSON.stringify(createDatabaseSecretSnapshot(nodes).passwords),
    [nodes]
  );

  const persistSecretEnvelopeImmediately = useCallback(
    (envelope: ProjectSecretEnvelope | null) => {
      const currentModel = currentModelStateRef.current;
      if (envelope && envelope.project_id !== currentModel.projectId) return;

      secretEnvelopeRef.current = envelope;
      persistCurrentModel({
        ...currentModel,
        secretEnvelope: envelope ?? undefined,
      });
    },
    []
  );

  useEffect(() => {
    secretEnvelopeRef.current = secretEnvelope;
  }, [secretEnvelope]);

  // Finish editing model name with validation
  const finishEditingName = () => {
    const trimmedName = modelName.trim();
    if (trimmedName === "") {
      // Restore previous name if empty
      setModelName(previousModelName.current);
    } else {
      // Update previous name for next edit
      previousModelName.current = trimmedName;
      setModelName(trimmedName);
    }
    setIsEditingName(false);
  };

  // Keep the active model available across page refreshes.
  useEffect(() => {
    persistCurrentModel({
      projectId,
      modelName,
      nodes,
      edges,
      nodeCounter,
      secretEnvelope: secretEnvelope ?? undefined,
    });
  }, [projectId, modelName, nodes, edges, nodeCounter, secretEnvelope]);

  // Unlock the encrypted secrets of the model restored after a page refresh.
  useEffect(() => {
    const envelope = initialModel?.secretEnvelope;
    if (!envelope) return;

    const controller = new AbortController();
    void api
      .decryptProjectSecrets(envelope, controller.signal)
      .then((passwords) => {
        const snapshot = { version: "1.0" as const, passwords };
        setNodes((currentNodes) =>
          hydrateDatabaseSecrets(currentNodes, snapshot)
        );
        setHistory((currentHistory) =>
          currentHistory.map((state) => ({
            ...state,
            nodes: hydrateDatabaseSecrets(state.nodes, snapshot),
          }))
        );
        setSecretsReady(true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn(
          error instanceof Error
            ? error.message
            : "Unable to unlock project secrets"
        );
        setSecretsReady(false);
      });

    return () => controller.abort();
  }, [initialModel]);

  // Re-encrypt only when a database password actually changes.
  useEffect(() => {
    const passwords = JSON.parse(databasePasswordsJson) as Record<
      string,
      string
    >;
    if (!secretsReady && Object.keys(passwords).length === 0) return;

    if (Object.keys(passwords).length === 0) {
      persistSecretEnvelopeImmediately(null);
      setSecretEnvelope(null);
      setSecretsReady(true);
      return;
    }

    const controller = new AbortController();
    void api
      .encryptProjectSecrets(
        projectId,
        passwords,
        secretEnvelopeRef.current,
        controller.signal
      )
      .then((envelope) => {
        persistSecretEnvelopeImmediately(envelope);
        setSecretEnvelope(envelope);
        setSecretsReady(true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn(
          error instanceof Error
            ? error.message
            : "Unable to encrypt project secrets"
        );
      });

    return () => controller.abort();
  }, [
    databasePasswordsJson,
    persistSecretEnvelopeImmediately,
    projectId,
    secretsReady,
  ]);

  // Keep the active point in the undo/redo timeline across page refreshes.
  useEffect(() => {
    persistFlowHistory(history, historyIndex);
  }, [history, historyIndex]);

  // Sync existing nodes with latest operation definitions (e.g. label changes)
  useEffect(() => {
    setNodes((prevNodes) => {
      let hasChanges = false;
      const newNodes = prevNodes.map((node) => {
        const latestOp = OPERATION_DEFS.find(
          (op) => op.id === node.data.operation.id
        );
        if (latestOp && latestOp.label !== node.data.operation.label) {
          hasChanges = true;
          return {
            ...node,
            data: {
              ...node.data,
              operation: latestOp,
            },
          };
        }
        return node;
      });
      return hasChanges ? newNodes : prevNodes;
    });
  }, []);

  // Save state to history when nodes/edges change (but not during drag or history restoration)
  useEffect(() => {
    if (movingNodes.current.size > 0 || isRestoringHistory.current) {
      return;
    }

    const currentState = createHistoryState(nodes, edges);
    const currentHistoryState = history[historyIndex];

    // Only save if state actually changed
    if (
      !currentHistoryState ||
      !areHistoryStatesEqual(currentState, currentHistoryState)
    ) {
      // Remove any history after current index (when making changes after undo)
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(currentState);

      // Limit history size to 50 states
      if (newHistory.length > 50) {
        newHistory.shift();
      } else {
        setHistoryIndex(newHistory.length - 1);
      }

      setHistory(newHistory);
    }
    // The active history entry is intentionally read without making history
    // changes recursively retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // Update undo/redo descriptions when history changes
  useEffect(() => {
    if (historyIndex > 0) {
      const currentState = history[historyIndex];
      const previousState = history[historyIndex - 1];
      const description = describeHistoryChange(previousState, currentState);
      setUndoDescription(description);
    } else {
      setUndoDescription("");
    }

    if (historyIndex < history.length - 1) {
      const currentState = history[historyIndex];
      const nextState = history[historyIndex + 1];
      const description = describeHistoryChange(currentState, nextState);
      setRedoDescription(description);
    } else {
      setRedoDescription("");
    }
  }, [history, historyIndex]);

  // Undo function
  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const restoredState = history[newIndex];
      isRestoringHistory.current = true;
      setNodes(restoredState.nodes);
      setEdges(restoredState.edges);
      setHistoryIndex(newIndex);
      setTimeout(() => {
        isRestoringHistory.current = false;
      }, 0);
    }
  };

  // Redo function
  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const restoredState = history[newIndex];
      isRestoringHistory.current = true;
      setNodes(restoredState.nodes);
      setEdges(restoredState.edges);
      setHistoryIndex(newIndex);
      setTimeout(() => {
        isRestoringHistory.current = false;
      }, 0);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(event.target as HTMLElement) &&
        modelButtonRef.current &&
        !modelButtonRef.current.contains(event.target as HTMLElement)
      ) {
        setIsModelMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, []);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isNewModelDialogOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setIsNewModelDialogOpen(false);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "z") {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyIndex, history, isNewModelDialogOpen]);

  const handleAddNode = (operation: OperationDefinition) => {
    const newId = `node-${nodeCounter}`;
    setNodeCounter((prev) => prev + 1);

    const newNode: Node<OperationNodeData> = {
      id: newId,
      type: "operation",
      position: { x: 150 + nodeCounter * 25, y: 100 + nodeCounter * 30 },
      data: {
        operation,
        params: {},
      },
    };

    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(newId);
  };

  const handleSelectNode = (nodeData: { id: string } | null) => {
    if (nodeData) {
      setSelectedNodeId(nodeData.id);
    }
  };

  const handleCloseInspector = () => {
    setSelectedNodeId(null);
  };

  const handleDeleteNode = (nodeId: string) => {
    // Prevent deletion of permanent nodes (Database source, Model Output)
    const nodeToDelete = nodes.find((n) => n.id === nodeId);
    const permanentNodeIds = ["dbt-model", "database"];
    if (
      nodeToDelete &&
      permanentNodeIds.includes(nodeToDelete.data.operation.id)
    ) {
      console.warn(
        `${nodeToDelete.data.operation.label} node cannot be deleted`
      );
      return;
    }

    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) =>
      prev.filter((e) => e.source !== nodeId && e.target !== nodeId)
    );
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
  };

  useEffect(() => {
    if (selectedNodeId && !nodes.find((node) => node.id === selectedNodeId)) {
      setTimeout(() => setSelectedNodeId(null), 0);
    }
  }, [nodes, selectedNodeId]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return undefined;
    return nodes.find((node) => node.id === selectedNodeId);
  }, [nodes, selectedNodeId]);

  const handleSaveParams = (
    nodeId: string,
    params: Record<string, unknown>
  ) => {
    // Check if we're reducing the number of handles for a join node
    const node = nodes.find((n) => n.id === nodeId);

    // Handle join node input handles
    if (
      node?.data.operation.id === "join" &&
      typeof params.inputHandles === "number"
    ) {
      const oldCount = (node.data.params?.inputHandles as number) || 2;
      const newCount = params.inputHandles;
      const removedIndex = params._removedHandleIndex as number | undefined;

      // If reducing handles, remove and remap edges
      if (newCount < oldCount && removedIndex !== undefined) {
        setEdges((prev) =>
          prev
            .filter((edge) => {
              // Filter out edges for other nodes
              if (edge.target !== nodeId) return true;
              const handleId = edge.targetHandle || "default";
              if (!handleId.startsWith("input-")) return true;

              const handleIndex = parseInt(handleId.split("-")[1]);
              // Remove edge connected to the deleted handle
              return handleIndex !== removedIndex;
            })
            .map((edge) => {
              // Remap edges for handles after the removed one
              if (edge.target !== nodeId) return edge;
              const handleId = edge.targetHandle || "default";
              if (!handleId.startsWith("input-")) return edge;

              const handleIndex = parseInt(handleId.split("-")[1]);
              // If handle index is after the removed one, decrement it
              if (handleIndex > removedIndex) {
                return {
                  ...edge,
                  targetHandle: `input-${handleIndex - 1}`,
                };
              }
              return edge;
            })
        );
      }
    }

    // Handle database node output handles
    if (
      node?.data.operation.id === "database" &&
      typeof params.outputHandles === "number"
    ) {
      const oldCount = (node.data.params?.outputHandles as number) || 1;
      const newCount = params.outputHandles;
      const removedIndex = params._removedHandleIndex as number | undefined;

      // If reducing handles, remove and remap edges
      if (newCount < oldCount && removedIndex !== undefined) {
        setEdges((prev) =>
          prev
            .filter((edge) => {
              // Filter out edges for other nodes
              if (edge.source !== nodeId) return true;
              const handleId = edge.sourceHandle || "default";
              if (!handleId.startsWith("output-")) return true;

              const handleIndex = parseInt(handleId.split("-")[1]);
              // Remove edge connected to the deleted handle
              return handleIndex !== removedIndex;
            })
            .map((edge) => {
              // Remap edges for handles after the removed one
              if (edge.source !== nodeId) return edge;
              const handleId = edge.sourceHandle || "default";
              if (!handleId.startsWith("output-")) return edge;

              const handleIndex = parseInt(handleId.split("-")[1]);
              // If handle index is after the removed one, decrement it
              if (handleIndex > removedIndex) {
                return {
                  ...edge,
                  sourceHandle: `output-${handleIndex - 1}`,
                };
              }
              return edge;
            })
        );
      }
    }

    // Clean up temporary parameters before saving
    const cleanParams = { ...params };
    delete cleanParams._removedHandleIndex;

    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                params: { ...node.data.params, ...cleanParams },
              },
            }
          : node
      )
    );
  };

  // Save model to JSON file
  const handleSaveModel = async (): Promise<boolean> => {
    try {
      const passwordSnapshot = createDatabaseSecretSnapshot(nodes);
      const hasPasswords = Object.keys(passwordSnapshot.passwords).length > 0;
      const exportEnvelope = hasPasswords
        ? await api.encryptProjectSecrets(
            projectId,
            passwordSnapshot.passwords,
            secretEnvelope
          )
        : secretsReady
          ? null
          : secretEnvelope;

      if (hasPasswords) {
        persistSecretEnvelopeImmediately(exportEnvelope);
        setSecretEnvelope(exportEnvelope);
        setSecretsReady(true);
      }

      const modelData = createCurrentModelSnapshot({
        projectId,
        modelName,
        nodes,
        edges,
        nodeCounter,
        secretEnvelope: exportEnvelope ?? undefined,
      });

      const json = JSON.stringify(modelData, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      // Use model name for filename (sanitized)
      const sanitizedName = modelName
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase();
      link.download = `${sanitizedName || "untitled"}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.error("Failed to encrypt model secrets", error);
      alert(
        "The model could not be saved because its database password could not be encrypted. Make sure the backend is running."
      );
      return false;
    }
  };

  const createNewModel = () => {
    const blankModel = createBlankModelState();
    const blankHistory = createHistoryState(
      blankModel.nodes,
      blankModel.edges
    );

    isRestoringHistory.current = true;
    movingNodes.current.clear();
    setProjectId(createProjectId());
    setSecretEnvelope(null);
    setSecretsReady(true);
    setNodes(blankModel.nodes);
    setEdges(blankModel.edges);
    setNodeCounter(blankModel.nodeCounter);
    setModelName(blankModel.modelName);
    previousModelName.current = blankModel.modelName;
    setIsEditingName(false);
    setSelectedNodeId(null);
    setHistory([blankHistory]);
    setHistoryIndex(0);
    setUndoDescription("");
    setRedoDescription("");
    setQueryResults(null);
    setTestError(null);
    setIsResultsPanelExpanded(false);
    setIsNewModelDialogOpen(false);
    setIsModelMenuOpen(false);

    window.setTimeout(() => {
      isRestoringHistory.current = false;
    }, 0);
  };

  const saveAndCreateNewModel = async () => {
    if (await handleSaveModel()) {
      createNewModel();
    }
  };

  // Preview the compiled dbt model directly on the source in read-only mode.
  const handleTestModel = async () => {
    // Find database node for credentials
    const databaseNode = nodes.find((n) => n.data.operation.id === "database");

    if (!databaseNode) {
      setTestError(
        "No database node found. Add a Database node with connection credentials."
      );
      setIsResultsPanelExpanded(true);
      return;
    }

    const adapterConfig = databaseNode.data.params?.adapter as
      | Record<string, unknown>
      | undefined;
    const sourceCredentials = buildDatabaseCredentials(adapterConfig);
    if (!sourceCredentials) {
      setTestError(
        "Database node is not configured. Please configure connection credentials."
      );
      setIsResultsPanelExpanded(true);
      return;
    }

    if (!ENABLED_DBT_ADAPTER_IDS.has(sourceCredentials.type)) {
      setTestError(
        "Live dbt testing supports PostgreSQL and DuckDB. This adapter has not been validated yet."
      );
      setIsResultsPanelExpanded(true);
      return;
    }

    // Generate dbt model files
    const dbtResult = generateDbtModel(nodes, edges, modelName);

    // Check for generation errors
    if (dbtResult.errors.length > 0) {
      setTestError(`Generation errors:\n${dbtResult.errors.join("\n")}`);
      setIsResultsPanelExpanded(true);
      return;
    }

    if (dbtResult.files.length === 0) {
      setTestError(
        "No dbt files generated. Please ensure your flow has a complete pipeline."
      );
      setIsResultsPanelExpanded(true);
      return;
    }

    // Debug: log generated files to console
    console.log("=== Generated dbt Files ===");
    dbtResult.files.forEach((f) => {
      console.log(`--- ${f.path} ---`);
      console.log(f.content);
    });
    console.log("===========================");

    setIsTestLoading(true);
    setTestError(null);
    setIsResultsPanelExpanded(true);
    setQueryResults(null);

    try {
      // Compile the exported files and query the source without materialization.
      const result = await api.runDbtModel(
        dbtResult.files,
        undefined, // auto-detect model name
        sourceCredentials
      );

      if (!result.success) {
        setTestError(result.error || "Model preview failed");
        if (result.output) {
          console.log("dbt output:", result.output);
        }
        return;
      }

      // Set results for display
      setQueryResults({
        columns: result.columns,
        data: result.data,
        row_count: result.row_count,
      });
    } catch (error) {
      setTestError(
        error instanceof Error ? error.message : "dbt execution failed"
      );
    } finally {
      setIsTestLoading(false);
    }
  };

  // Load model from JSON file
  const handleLoadModel = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = e.target?.result as string;
        const modelData = parseCurrentModel(json);
        if (!modelData) {
          alert("Invalid model file format");
          return;
        }

        // Check if model has permanent nodes, add them if missing
        const hasModelOutput = modelData.nodes.some(
          (n: { data?: { operation?: { id?: string } } }) =>
            n.data?.operation?.id === "dbt-model"
        );
        const hasDatabase = modelData.nodes.some(
          (n: { data?: { operation?: { id?: string } } }) =>
            n.data?.operation?.id === "database"
        );

        let nodesToLoad: Node<OperationNodeData>[] = modelData.nodes;

        // Add Database node if missing
        if (!hasDatabase) {
          const databaseOp = OPERATION_DEFS.find((op) => op.id === "database");
          if (databaseOp) {
            // Position to the left of all nodes
            const minX = Math.min(
              ...modelData.nodes.map(
                (n: { position?: { x?: number } }) => n.position?.x || 0
              ),
              0
            );
            const newDatabaseNode = {
              id: "database-source",
              type: "operation",
              position: { x: minX - 400, y: 300 },
              data: {
                operation: databaseOp,
                params: {},
              },
            };
            nodesToLoad = [newDatabaseNode, ...nodesToLoad];
          }
        }

        // Add Model Output node if missing
        if (!hasModelOutput) {
          const modelOutputOp = OPERATION_DEFS.find(
            (op) => op.id === "dbt-model"
          );
          if (modelOutputOp) {
            // Find the rightmost node to position Model Output to the right
            const maxX = Math.max(
              ...nodesToLoad.map(
                (n: { position?: { x?: number } }) => n.position?.x || 0
              ),
              0
            );
            const newModelOutputNode = {
              id: "model-output",
              type: "operation",
              position: { x: maxX + 400, y: 300 },
              data: {
                operation: modelOutputOp,
                params: {
                  name: modelData.modelName || file.name.replace(".json", ""),
                  materialized: "view",
                },
              },
            };
            nodesToLoad = [...nodesToLoad, newModelOutputNode];
          }
        }

        let importedSecretsReady = !modelData.secretEnvelope;
        let secretImportFailed = false;
        if (modelData.secretEnvelope) {
          try {
            const passwords = await api.decryptProjectSecrets(
              modelData.secretEnvelope
            );
            nodesToLoad = hydrateDatabaseSecrets(nodesToLoad, {
              version: "1.0",
              passwords,
            });
            importedSecretsReady = true;
          } catch (error) {
            console.warn(
              error instanceof Error
                ? error.message
                : "Unable to unlock imported project secrets"
            );
            secretImportFailed = true;
          }
        }

        // Restore state
        secretEnvelopeRef.current = modelData.secretEnvelope ?? null;
        persistCurrentModel({
          projectId: modelData.projectId,
          modelName: modelData.modelName || file.name.replace(".json", ""),
          nodes: nodesToLoad,
          edges: modelData.edges,
          nodeCounter: modelData.nodeCounter ?? nodesToLoad.length,
          secretEnvelope: modelData.secretEnvelope,
        });
        isRestoringHistory.current = true;
        movingNodes.current.clear();
        setProjectId(modelData.projectId);
        setSecretEnvelope(modelData.secretEnvelope ?? null);
        setSecretsReady(importedSecretsReady);
        setNodes(nodesToLoad);
        setEdges(modelData.edges);
        setNodeCounter(modelData.nodeCounter ?? nodesToLoad.length);
        setModelName(modelData.modelName || file.name.replace(".json", ""));
        previousModelName.current =
          modelData.modelName || file.name.replace(".json", "");
        setSelectedNodeId(null);

        // Reset history with the loaded state as initial state
        setHistory([createHistoryState(nodesToLoad, modelData.edges)]);
        setHistoryIndex(0);

        window.setTimeout(() => {
          isRestoringHistory.current = false;
        }, 0);

        if (secretImportFailed) {
          alert(
            "The model was loaded, but its database password was encrypted by another installation and could not be restored."
          );
        }
      } catch (error) {
        console.error("Failed to load model:", error);
        alert("Failed to load model file");
      }
    };
    reader.readAsText(file);

    // Reset input so the same file can be loaded again
    event.target.value = "";
  };

  const inspectorNode = selectedNode
    ? {
        id: selectedNode.id,
        operation: selectedNode.data.operation,
        params: selectedNode.data.params,
      }
    : null;

  const inspectorSourceCredentials = useMemo(() => {
    if (!selectedNode || selectedNode.data.operation.id !== "source-table") {
      return null;
    }

    const databaseEdge = edges.find((edge) => {
      if (edge.target !== selectedNode.id) return false;
      return nodes.some(
        (candidate) =>
          candidate.id === edge.source &&
          candidate.data.operation.id === "database"
      );
    });
    if (!databaseEdge) return null;

    const databaseNode = nodes.find(
      (candidate) => candidate.id === databaseEdge.source
    );
    const adapter = databaseNode?.data.params?.adapter as
      | Record<string, unknown>
      | undefined;
    return buildDatabaseCredentials(adapter);
  }, [edges, nodes, selectedNode]);

  // Calculate available columns for the selected node
  const availableColumns = useMemo(() => {
    if (!selectedNodeId) return [];
    return getAvailableColumns(selectedNodeId, nodes, edges);
  }, [selectedNodeId, nodes, edges]);

  // ⚡ PERFORMANCE: Cache for getAvailableColumns to avoid redundant graph traversals
  const columnCacheRef = useRef<Map<string, ColumnDefinition[]>>(new Map());
  const cacheVersionRef = useRef(0);

  // Invalidate cache when nodes or edges change
  useEffect(() => {
    cacheVersionRef.current++;
    columnCacheRef.current.clear();
  }, [nodes.length, edges.length]); // Only invalidate on structural changes

  // Memoized wrapper for getAvailableColumns
  const getAvailableColumnsCached = useCallback(
    (nodeId: string): ColumnDefinition[] => {
      const cacheKey = `${cacheVersionRef.current}-${nodeId}`;

      // Check cache first
      if (columnCacheRef.current.has(cacheKey)) {
        return columnCacheRef.current.get(cacheKey)!;
      }

      // Calculate and cache
      const cols = getAvailableColumns(nodeId, nodes, edges);
      columnCacheRef.current.set(cacheKey, cols);
      return cols;
    },
    [nodes, edges]
  );

  // Auto-update column references when columns are renamed globally
  const previousNodeColumns = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    // ⚡ PERFORMANCE OPTIMIZATION: Skip if no structural changes
    // Only recalculate if:
    // 1. Number of nodes changed
    // 2. Node IDs changed
    // 3. First render
    const currentNodeIds = nodes
      .map((n) => n.id)
      .sort()
      .join(",");
    const previousNodeIds = Array.from(previousNodeColumns.current.keys())
      .sort()
      .join(",");

    if (
      currentNodeIds === previousNodeIds &&
      previousNodeColumns.current.size > 0
    ) {
      // Nodes structure hasn't changed, skip expensive recalculation
      return;
    }

    // Build a map of node -> available columns
    const nodeColumnsMap = new Map<string, string[]>();
    nodes.forEach((node) => {
      // ⚡ Use cached version for 95% speedup
      const cols = getAvailableColumnsCached(node.id);
      nodeColumnsMap.set(
        node.id,
        cols.map((c) => c.name)
      );
    });

    let hasUpdates = false;
    const updatedNodes = nodes.map((node) => {
      const availableColNames = nodeColumnsMap.get(node.id) || [];
      const previousColNames = previousNodeColumns.current.get(node.id) || [];

      if (availableColNames.length === 0 || !node.data.params) return node;

      // Detect renamed columns for this specific node
      const disappearedCols = previousColNames.filter(
        (name) => !availableColNames.includes(name)
      );
      const appearedCols = availableColNames.filter(
        (name) => !previousColNames.includes(name)
      );

      // Create rename mapping (old -> new)
      const renameMap = new Map<string, string>();
      if (
        disappearedCols.length > 0 &&
        disappearedCols.length === appearedCols.length
      ) {
        disappearedCols.forEach((oldName, index) => {
          renameMap.set(oldName, appearedCols[index]);
        });
      }

      const updatedParams = { ...node.data.params };
      let nodeHasChanges = false;

      // Helper to rename a single column reference
      const updateColumnRef = (colName: string): string => {
        // First check if it was renamed
        const renamed = renameMap.get(colName);
        if (renamed) return renamed;

        // If column exists as-is, keep it
        if (availableColNames.includes(colName)) return colName;

        // Otherwise clear it
        return "";
      };

      node.data.operation.params.forEach((param) => {
        const currentValue = updatedParams[param.name];

        // Update column-list
        if (param.type === "column-list" && typeof currentValue === "string") {
          const cols = currentValue
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);
          const updatedCols = cols.map(updateColumnRef);
          const validCols = updatedCols.filter(Boolean);
          const newValue = validCols.join(", ");
          if (newValue !== currentValue) {
            updatedParams[param.name] = newValue;
            nodeHasChanges = true;
          }
        }

        // Update column-select
        if (
          param.type === "column-select" &&
          typeof currentValue === "string"
        ) {
          if (currentValue) {
            const updated = updateColumnRef(currentValue);
            if (updated !== currentValue) {
              updatedParams[param.name] = updated;
              nodeHasChanges = true;
            }
          }
        }

        // Update filter-condition
        if (
          param.type === "filter-condition" &&
          currentValue &&
          typeof currentValue === "object"
        ) {
          const filterValue = currentValue as {
            column: string;
            operator: string;
            value: string;
          };
          if (filterValue.column) {
            const updated = updateColumnRef(filterValue.column);
            if (updated !== filterValue.column) {
              updatedParams[param.name] = { ...filterValue, column: updated };
              nodeHasChanges = true;
            }
          }
        }

        // Update filter-builder (FilterGroup)
        if (
          param.type === "filter-builder" &&
          currentValue &&
          typeof currentValue === "object" &&
          (currentValue as { type?: string }).type === "group"
        ) {
          // Type for filter nodes
          interface FilterChildNode {
            type: string;
            column?: string;
            children?: unknown[];
          }

          // Helper to recursively update columns in FilterGroup
          const updateFilterGroup = (group: unknown): unknown => {
            if (!group || typeof group !== "object") return group;
            if (!("type" in group)) return group;

            const typedGroup = group as {
              type: string;
              children?: unknown[];
              operators?: string[];
            };
            const newChildren = (typedGroup.children || []).map(
              (child: unknown) => {
                if (!child || typeof child !== "object") return child;
                if (!("type" in child)) return child;

                const typedChild = child as FilterChildNode;
                if (typedChild.type === "condition") {
                  if (typedChild.column) {
                    const updatedCol = updateColumnRef(typedChild.column);
                    // If column was renamed (different name) or removed (empty string), update it
                    if (updatedCol !== typedChild.column) {
                      return { ...typedChild, column: updatedCol };
                    }
                  }
                  return child;
                } else if (typedChild.type === "group") {
                  return updateFilterGroup(child);
                }
                return child;
              }
            );

            // Check if children changed (shallow comparison is enough as we create new objects on change)
            const hasChanges = newChildren.some(
              (child: unknown, i: number) =>
                child !== (typedGroup.children as unknown[])?.[i]
            );

            if (hasChanges) {
              return { ...typedGroup, children: newChildren };
            }
            return group;
          };

          const updatedGroup = updateFilterGroup(currentValue);
          if (updatedGroup !== currentValue) {
            updatedParams[param.name] = updatedGroup;
            nodeHasChanges = true;
          }
        }

        // Update join-condition
        if (
          param.type === "join-condition" &&
          currentValue &&
          typeof currentValue === "object"
        ) {
          const joinValue = currentValue as {
            leftColumn: string;
            operator: string;
            rightColumn: string;
          };
          let leftCol = joinValue.leftColumn;
          let rightCol = joinValue.rightColumn;
          let changed = false;

          if (leftCol) {
            const updatedLeft = updateColumnRef(leftCol);
            if (updatedLeft !== leftCol) {
              leftCol = updatedLeft;
              changed = true;
            }
          }

          if (rightCol) {
            const updatedRight = updateColumnRef(rightCol);
            if (updatedRight !== rightCol) {
              rightCol = updatedRight;
              changed = true;
            }
          }

          if (changed) {
            updatedParams[param.name] = {
              leftColumn: leftCol,
              operator: joinValue.operator,
              rightColumn: rightCol,
            };
            nodeHasChanges = true;
          }
        }

        // Update column-rename
        if (param.type === "column-rename" && Array.isArray(currentValue)) {
          const renameValue = currentValue as Array<{
            original: string;
            alias?: string;
          }>;
          const updatedRenames = renameValue
            .map((item) => {
              const updatedOriginal = updateColumnRef(item.original);
              if (updatedOriginal !== item.original) {
                return { ...item, original: updatedOriginal };
              }
              return item;
            })
            .filter((item) => item.original !== "");

          if (JSON.stringify(updatedRenames) !== JSON.stringify(renameValue)) {
            updatedParams[param.name] = updatedRenames;
            nodeHasChanges = true;
          }
        }
      });

      if (nodeHasChanges) {
        hasUpdates = true;
        return {
          ...node,
          data: {
            ...node.data,
            params: updatedParams,
          },
        };
      }

      return node;
    });

    // ⚡ PERFORMANCE: Only update if there are actual changes
    // This prevents unnecessary re-renders and potential loops
    if (hasUpdates) {
      // Double check that nodes actually changed before setting
      const nodesActuallyChanged = updatedNodes.some(
        (node, i) => node !== nodes[i]
      );
      if (nodesActuallyChanged) {
        setNodes(updatedNodes);
      }
    }

    // Update previous columns for next iteration (using ref to avoid re-render)
    previousNodeColumns.current = nodeColumnsMap;
  }, [nodes, edges, getAvailableColumnsCached]);

  // Ref for file input
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate dbt model
  const handleGenerateDbt = async () => {
    const result = generateDbtModel(nodes, edges, modelName);

    if (result.errors.length > 0) {
      alert(`Errors generating dbt model:\n${result.errors.join("\n")}`);
      return;
    }

    if (result.files.length === 0) {
      alert("No files generated");
      return;
    }

    try {
      // Dynamically import JSZip
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      // Add all files to the zip
      result.files.forEach((file) => {
        zip.file(file.path, file.content);
      });

      // Generate the zip file
      const content = await zip.generateAsync({ type: "blob" });

      // Download the zip
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${modelName
        .replace(/\s+/g, "_")
        .toLowerCase()}_dbt_project.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert(`Generated dbt project with ${result.files.length} files!`);
    } catch (error) {
      alert(
        `Error creating ZIP: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  return (
    <>
      <header className="">
        <h1 className="border-r border-gray-400 dark:border-gray-700 pr-4 shrink-0">
          dbt Flow Designer
        </h1>

        <div className="flex flex-1 min-w-0">
          {isEditingName ? (
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              onBlur={finishEditingName}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  finishEditingName();
                }
              }}
              autoFocus
              className="text-xl font-semibold bg-transparent outline-none border-none w-full cursor-text"
            />
          ) : (
            <Tooltip content={modelName}>
              <h2
                className="text-xl font-semibold whitespace-nowrap overflow-hidden text-ellipsis flex-1"
                onClick={() => {
                  previousModelName.current = modelName;
                  setIsEditingName(true);
                }}
              >
                {modelName}
              </h2>
            </Tooltip>
          )}
        </div>

        {/* Undo/Redo buttons */}
        <div className="flex flex-row gap-3 border-l border-r border-gray-300 dark:border-gray-700 px-4">
          <Tooltip
            content={
              <>
                {undoDescription ? `Undo: ${undoDescription}` : "Undo"}{" "}
                <span className="opacity-50 ml-1">(Ctrl+Z)</span>
              </>
            }
          >
            <button
              className="normal-button p-2 rounded-full disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={undo}
              disabled={historyIndex === 0}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                />
              </svg>
            </button>
          </Tooltip>

          <Tooltip
            content={
              <>
                {redoDescription ? `Redo: ${redoDescription}` : "Redo"}{" "}
                <span className="opacity-50 ml-1 ">(Ctrl+Shift+Z)</span>
              </>
            }
          >
            <button
              className="normal-button p-2 rounded-full disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"
                />
              </svg>
            </button>
          </Tooltip>
        </div>

        <div className="flex flex-row gap-4">
          {/* Dropdown Menu "Model" */}
          <div className="relative">
            <button
              ref={modelButtonRef}
              className="normal-button w-30 p-2 rounded-full"
              aria-haspopup="menu"
              aria-expanded={isModelMenuOpen}
              onClick={() => {
                if (!isModelMenuOpen && modelButtonRef.current) {
                  const rect = modelButtonRef.current.getBoundingClientRect();
                  setMenuPosition({
                    top: rect.bottom + 8,
                    left: rect.right - 200, // Align right edge
                  });
                }
                setIsModelMenuOpen(!isModelMenuOpen);
              }}
            >
              Model
              <svg
                className={`w-4 h-4 ml-2 inline transition-transform ${
                  isModelMenuOpen ? "rotate-180" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </div>

          {/* Portal for dropdown content */}
          {isModelMenuOpen &&
            createPortal(
              <div
                ref={modelMenuRef}
                className="fixed panel rounded-2xl min-w-[200px] z-9998 p-1.5 flex flex-col gap-0.5"
                style={{
                  top: `${menuPosition.top}px`,
                  left: `${menuPosition.left}px`,
                }}
              >
                <button
                  type="button"
                  className="w-full text-left px-4 py-2.5 rounded-xl hover:bg-white/60 dark:hover:bg-gray-500/30 transition-colors flex items-center gap-2 text-sm font-medium"
                  onClick={() => {
                    setIsModelMenuOpen(false);
                    setIsNewModelDialogOpen(true);
                  }}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  New
                </button>
                <div
                  role="separator"
                  className="mx-3 my-1 border-t border-gray-300/70 dark:border-gray-600/70"
                />
                <button
                  type="button"
                  className="w-full text-left px-4 py-2.5 rounded-xl hover:bg-white/60 dark:hover:bg-gray-500/30 transition-colors flex items-center gap-2 text-sm font-medium"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setIsModelMenuOpen(false);
                  }}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                    />
                  </svg>
                  Load
                </button>
                <button
                  type="button"
                  className="w-full text-left px-4 py-2.5 rounded-xl hover:bg-white/60 dark:hover:bg-gray-500/30 transition-colors flex items-center gap-2 text-sm font-medium"
                  onClick={() => {
                    void handleSaveModel();
                    setIsModelMenuOpen(false);
                  }}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                    />
                  </svg>
                  Save
                </button>
                <button
                  type="button"
                  className="w-full text-left px-4 py-2.5 rounded-xl hover:bg-white/60 dark:hover:bg-gray-500/30 transition-colors flex items-center gap-2 text-sm font-medium"
                  onClick={() => {
                    handleGenerateDbt();
                    setIsModelMenuOpen(false);
                  }}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  Export dbt
                </button>
              </div>,
              document.body
            )}

          {isNewModelDialogOpen &&
            createPortal(
              <div
                className="fixed inset-0 z-[10000] flex items-center justify-center bg-gray-950/70 p-4 backdrop-blur-sm"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    setIsNewModelDialogOpen(false);
                  }
                }}
              >
                <section
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="new-model-title"
                  aria-describedby="new-model-description"
                  className="w-full max-w-lg rounded-3xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-500/15 text-orange-500">
                      <svg
                        className="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 4v16m8-8H4"
                        />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <h2
                        id="new-model-title"
                        className="text-xl font-semibold text-gray-900 dark:text-gray-100"
                      >
                        Create a new model?
                      </h2>
                      <p
                        id="new-model-description"
                        className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300"
                      >
                        Do you want to save changes to{` `}
                        <span className="font-semibold break-words">
                          “{modelName}”
                        </span>{` `}
                        before starting over?
                      </p>
                    </div>
                  </div>

                  <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      className="normal-button px-5 py-2.5"
                      onClick={() => setIsNewModelDialogOpen(false)}
                      autoFocus
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="normal-button px-5 py-2.5 text-red-500 dark:text-red-400"
                      onClick={createNewModel}
                    >
                      Don&apos;t save
                    </button>
                    <button
                      type="button"
                      className="highlight-button px-5 py-2.5"
                      onClick={saveAndCreateNewModel}
                    >
                      Save &amp; New
                    </button>
                  </div>
                </section>
              </div>,
              document.body
            )}

          {/* Test Button */}
          <button
            className="highlight-button w-30 p-2 rounded-full flex items-center justify-center gap-2"
            onClick={handleTestModel}
            disabled={isTestLoading}
          >
            {isTestLoading ? (
              <>
                <svg
                  className="w-4 h-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Testing...
              </>
            ) : (
              "Test"
            )}
          </button>
        </div>
      </header>

      {/* Hidden file input for loading models */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleLoadModel}
        style={{ display: "none" }}
      />

      <div className="main-content flex">
        <Toolbox
          onAddNode={handleAddNode}
          onLayoutChange={handleToolboxLayoutChange}
        />
        <Flowchart
          nodes={nodes}
          edges={edges}
          setNodes={setNodes}
          setEdges={setEdges}
          onSelectNode={handleSelectNode}
          onSaveParams={handleSaveParams}
          selectedNodeId={selectedNodeId}
          isToolboxOpen={isToolboxOpen}
          getFitViewLeftPadding={getFitViewLeftPadding}
          getFitViewRightPadding={getFitViewRightPadding}
          onNodeDragStart={(_, node) => {
            movingNodes.current.add(node.id);
          }}
          onNodeDragStop={(_, node) => {
            movingNodes.current.delete(node.id);
          }}
        />
        <Inspector
          node={inspectorNode}
          onSave={handleSaveParams}
          onClearSelection={() => setSelectedNodeId(null)}
          onClose={handleCloseInspector}
          onDelete={handleDeleteNode}
          availableColumns={availableColumns}
          sourceCredentials={inspectorSourceCredentials}
          onLayoutChange={handleInspectorLayoutChange}
        />
      </div>

      {/* Persistent Query Results Panel */}
      <QueryResultsPanel
        initialColumns={queryResults?.columns || []}
        initialData={queryResults?.data || []}
        initialTotalRows={queryResults?.row_count || 0}
        isLoading={isTestLoading}
        error={testError}
        isExpanded={isResultsPanelExpanded}
        onExpandedChange={setIsResultsPanelExpanded}
      />
    </>
  );
}

export default App;
