import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Edge, Node } from "@xyflow/react";
import Flowchart from "./components/Flowchart";
import Inspector from "./components/Inspector";
import Toolbox from "./components/Toolbox";
import {
  OPERATION_DEFS,
  type OperationDefinition,
} from "./definitions/operations";
import { getAvailableColumns } from "./definitions/columnPropagation";
import { Tooltip } from "./components/Tooltip";
import { generateDbtModel } from "./generators/dbtGenerator";

type OperationNodeData = {
  operation: OperationDefinition;
  params?: Record<string, unknown>;
};

function App() {
  const [nodes, setNodes] = useState<Node<OperationNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [nodeCounter, setNodeCounter] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [modelName, setModelName] = useState("Untitled Model");
  const [isEditingName, setIsEditingName] = useState(false);
  const previousModelName = useRef("Untitled Model");
  // Undo/Redo history management
  type HistoryState = {
    nodes: Node<OperationNodeData>[];
    edges: Edge[];
  };

  const [history, setHistory] = useState<HistoryState[]>([
    { nodes: [], edges: [] },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const movingNodes = useRef<Set<string>>(new Set()); // Track which nodes are being moved
  const isRestoringHistory = useRef(false);

  const [undoDescription, setUndoDescription] = useState<string>("");
  const [redoDescription, setRedoDescription] = useState<string>("");

  // Dropdown menu state
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

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

  // Initialize Model Output node if it doesn't exist
  useEffect(() => {
    const hasModelOutput = nodes.some(
      (n) => n.data.operation.id === "dbt-model"
    );
    if (!hasModelOutput && nodes.length === 0) {
      const modelOutputOp = OPERATION_DEFS.find((op) => op.id === "dbt-model");
      if (modelOutputOp) {
        const newNode: Node<OperationNodeData> = {
          id: "model-output",
          type: "operation",
          position: { x: 600, y: 300 },
          data: {
            operation: modelOutputOp,
            params: {
              name: modelName,
              materialized: "view",
            },
          },
        };
        setNodes([newNode]);
      }
    }
  }, []);

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

  // Normalize nodes to only keep user-relevant properties (ignore ReactFlow metadata)
  const normalizeNode = (node: Node<OperationNodeData>) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: node.data,
  });

  const normalizeEdge = (edge: Edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type,
  });

  // Generate a human-readable description of the change between two states
  const describeChange = (
    fromState: HistoryState,
    toState: HistoryState
  ): string => {
    // Check for added nodes
    const addedNodes = toState.nodes.filter(
      (n) => !fromState.nodes.find((fn) => fn.id === n.id)
    );
    if (addedNodes.length > 0) {
      const nodeName = addedNodes[0].data.operation.label;
      return `Added node "${nodeName}"`;
    }

    // Check for deleted nodes
    const deletedNodes = fromState.nodes.filter(
      (n) => !toState.nodes.find((tn) => tn.id === n.id)
    );
    if (deletedNodes.length > 0) {
      const nodeName = deletedNodes[0].data.operation.label;
      return `Deleted node "${nodeName}"`;
    }

    // Check for added edges
    const addedEdges = toState.edges.filter(
      (e) => !fromState.edges.find((fe) => fe.id === e.id)
    );
    if (addedEdges.length > 0) {
      const edge = addedEdges[0];
      const sourceNode = toState.nodes.find((n) => n.id === edge.source);
      const targetNode = toState.nodes.find((n) => n.id === edge.target);
      if (sourceNode && targetNode) {
        return `Connected "${sourceNode.data.operation.label}" to "${targetNode.data.operation.label}"`;
      }
      return "Connected nodes";
    }

    // Check for deleted edges
    const deletedEdges = fromState.edges.filter(
      (e) => !toState.edges.find((te) => te.id === e.id)
    );
    if (deletedEdges.length > 0) {
      const edge = deletedEdges[0];
      const sourceNode = fromState.nodes.find((n) => n.id === edge.source);
      const targetNode = fromState.nodes.find((n) => n.id === edge.target);
      if (sourceNode && targetNode) {
        return `Disconnected "${sourceNode.data.operation.label}" from "${targetNode.data.operation.label}"`;
      }
      return "Disconnected nodes";
    }

    // Check for moved nodes (with threshold to avoid floating point issues)
    const movedNode = toState.nodes.find((n) => {
      const oldNode = fromState.nodes.find((fn) => fn.id === n.id);
      if (!oldNode) return false;
      const deltaX = Math.abs(oldNode.position.x - n.position.x);
      const deltaY = Math.abs(oldNode.position.y - n.position.y);
      return deltaX > 1 || deltaY > 1; // Threshold of 1px to avoid floating point issues
    });
    if (movedNode) {
      return `Moved node "${movedNode.data.operation.label}"`;
    }

    // Check for changed node params
    const changedNode = toState.nodes.find((n) => {
      const oldNode = fromState.nodes.find((fn) => fn.id === n.id);
      return (
        oldNode &&
        JSON.stringify(oldNode.data.params) !== JSON.stringify(n.data.params)
      );
    });
    if (changedNode) {
      return `Modified node "${changedNode.data.operation.label}"`;
    }

    return "Unknown change";
  };

  // Save state to history when nodes/edges change (but not during drag or history restoration)
  useEffect(() => {
    if (movingNodes.current.size > 0 || isRestoringHistory.current) {
      return;
    }

    const currentState = { nodes, edges };
    const currentHistoryState = history[historyIndex];

    // Normalize states before comparison to ignore ReactFlow metadata
    const normalizedCurrentNodes = currentState.nodes.map(normalizeNode);
    const normalizedCurrentEdges = currentState.edges.map(normalizeEdge);
    const normalizedHistoryNodes =
      currentHistoryState?.nodes.map(normalizeNode) || [];
    const normalizedHistoryEdges =
      currentHistoryState?.edges.map(normalizeEdge) || [];

    // Only save if state actually changed
    if (
      JSON.stringify(normalizedCurrentNodes) !==
        JSON.stringify(normalizedHistoryNodes) ||
      JSON.stringify(normalizedCurrentEdges) !==
        JSON.stringify(normalizedHistoryEdges)
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
  }, [nodes, edges]);

  // Update undo/redo descriptions when history changes
  useEffect(() => {
    if (historyIndex > 0) {
      const currentState = history[historyIndex];
      const previousState = history[historyIndex - 1];
      const description = describeChange(previousState, currentState);
      setUndoDescription(description);
    } else {
      setUndoDescription("");
    }

    if (historyIndex < history.length - 1) {
      const currentState = history[historyIndex];
      const nextState = history[historyIndex + 1];
      const description = describeChange(currentState, nextState);
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
  }, [historyIndex, history]);

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
    // Prevent deletion of Model Output node
    const nodeToDelete = nodes.find((n) => n.id === nodeId);
    if (nodeToDelete?.data.operation.id === "dbt-model") {
      console.warn("Model Output node cannot be deleted");
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
                params: cleanParams,
              },
            }
          : node
      )
    );
  };

  // Save model to JSON file
  const handleSaveModel = () => {
    const modelData = {
      version: "1.0",
      timestamp: new Date().toISOString(),
      modelName,
      nodes,
      edges,
      nodeCounter,
    };

    const json = JSON.stringify(modelData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    // Use model name for filename (sanitized)
    const sanitizedName = modelName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    link.download = `${sanitizedName || "untitled"}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Load model from JSON file
  const handleLoadModel = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const modelData = JSON.parse(json);

        // Validate structure
        if (!modelData.nodes || !modelData.edges) {
          alert("Invalid model file format");
          return;
        }

        // Check if model has a Model Output node, add one if missing
        const hasModelOutput = modelData.nodes.some(
          (n: any) => n.data?.operation?.id === "dbt-model"
        );

        let nodesToLoad = modelData.nodes;
        if (!hasModelOutput) {
          const modelOutputOp = OPERATION_DEFS.find(
            (op) => op.id === "dbt-model"
          );
          if (modelOutputOp) {
            // Find the rightmost node to position Model Output to the right
            const maxX = Math.max(
              ...modelData.nodes.map((n: any) => n.position?.x || 0),
              0
            );
            const newModelOutputNode = {
              id: "model-output",
              type: "operation", // Changed from "operationNode" to "operation"
              position: { x: maxX + 400, y: 300 },
              data: {
                operation: modelOutputOp,
                params: {
                  name: modelData.modelName || file.name.replace(".json", ""),
                  materialized: "view",
                },
              },
            };
            nodesToLoad = [...modelData.nodes, newModelOutputNode];
          }
        }

        // Restore state
        setNodes(nodesToLoad);
        setEdges(modelData.edges);
        setNodeCounter(modelData.nodeCounter || nodesToLoad.length);
        setModelName(modelData.modelName || file.name.replace(".json", ""));
        setSelectedNodeId(null);

        // Reset history with the loaded state as initial state
        setHistory([
          {
            nodes: nodesToLoad,
            edges: modelData.edges,
          },
        ]);
        setHistoryIndex(0);
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

  // Calculate available columns for the selected node
  const availableColumns = useMemo(() => {
    if (!selectedNodeId) return [];
    return getAvailableColumns(selectedNodeId, nodes, edges);
  }, [selectedNodeId, nodes, edges]);

  // Auto-update column references when columns are renamed globally
  const previousNodeColumns = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    // Build a map of node -> available columns
    const nodeColumnsMap = new Map<string, string[]>();
    nodes.forEach((node) => {
      const cols = getAvailableColumns(node.id, nodes, edges);
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
          (currentValue as any).type === "group"
        ) {
          // Helper to recursively update columns in FilterGroup
          const updateFilterGroup = (group: any): any => {
            const newChildren = (group.children || []).map((child: any) => {
              if (child.type === "condition") {
                if (child.column) {
                  const updatedCol = updateColumnRef(child.column);
                  // If column was renamed (different name) or removed (empty string), update it
                  if (updatedCol !== child.column) {
                    return { ...child, column: updatedCol };
                  }
                }
                return child;
              } else if (child.type === "group") {
                return updateFilterGroup(child);
              }
              return child;
            });

            // Check if children changed (shallow comparison is enough as we create new objects on change)
            const hasChanges = newChildren.some(
              (child: any, i: number) => child !== group.children[i]
            );

            if (hasChanges) {
              return { ...group, children: newChildren };
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

    if (hasUpdates) {
      setNodes(updatedNodes);
    }

    // Update previous columns for next iteration (using ref to avoid re-render)
    previousNodeColumns.current = nodeColumnsMap;
  }, [nodes, edges]);

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
                  className="w-full text-left px-4 py-2.5 rounded-xl hover:bg-white/60 dark:hover:bg-gray-500/30 transition-colors flex items-center gap-2 text-sm font-medium"
                  onClick={() => {
                    handleSaveModel();
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

          {/* Test Button */}
          <button
            className="highlight-button w-30 p-2 rounded-full"
            onClick={() => alert("Test functionality coming soon!")}
          >
            Test
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
        <Toolbox onAddNode={handleAddNode} />
        <Flowchart
          nodes={nodes}
          edges={edges}
          setNodes={setNodes}
          setEdges={setEdges}
          onSelectNode={handleSelectNode}
          onSaveParams={handleSaveParams}
          selectedNodeId={selectedNodeId}
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
        />
      </div>
    </>
  );
}

export default App;
