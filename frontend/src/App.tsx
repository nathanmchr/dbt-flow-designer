import { useEffect, useMemo, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import Flowchart from "./components/Flowchart";
import Inspector from "./components/Inspector";
import Toolbox from "./components/Toolbox";
import { OPERATION_DEFS, type OperationDefinition } from "./domain/operations";
import { getAvailableColumns } from "./domain/columnPropagation";

type OperationNodeData = {
  operation: OperationDefinition;
  params?: Record<string, unknown>;
};

function App() {
  const [nodes, setNodes] = useState<Node<OperationNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [nodeCounter, setNodeCounter] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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
    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                params,
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
      nodes,
      edges,
      nodeCounter,
    };

    const json = JSON.stringify(modelData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dbt-flow-model-${Date.now()}.json`;
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

        // Restore state
        setNodes(modelData.nodes);
        setEdges(modelData.edges);
        setNodeCounter(modelData.nodeCounter || modelData.nodes.length);
        setSelectedNodeId(null);
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

  return (
    <>
      <header>
        <h1>dbt Flow Designer</h1>
        <div className="flex flex-row gap-4">
          <button
            className="w-30 shadow-md p-3 rounded-full"
            onClick={() => fileInputRef.current?.click()}
          >
            Load
          </button>
          <button
            className="w-30 bg-orange-600 hover:bg-orange-400 hover:border-transparent hover:shadow-lg hover:shadow-orange-400/30 transition-all text-gray-200 shadow-md p-3 rounded-full"
            onClick={handleSaveModel}
          >
            Save
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
          selectedNodeId={selectedNodeId}
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
