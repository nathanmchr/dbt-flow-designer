import {
  ReactFlow,
  Background,
  Controls,
  applyEdgeChanges,
  applyNodeChanges,
  addEdge,
  type Edge,
  type Node,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { OperationDefinition } from "../definitions/operations";
import OperationNode from "./nodes/OperationNode";
import { AnimatedEdge } from "./AnimatedEdge";

type OperationNodeData = {
  operation: OperationDefinition;
  params?: Record<string, unknown>;
};
type OperationNodeType = Node<OperationNodeData>;
type OperationNodeChange = NodeChange<OperationNodeType>;

interface FlowchartProps {
  nodes: OperationNodeType[];
  edges: Edge[];
  setNodes: Dispatch<SetStateAction<OperationNodeType[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  onSelectNode?: (
    node: {
      id: string;
      operation: OperationDefinition;
      params?: Record<string, unknown>;
    } | null
  ) => void;
  onSaveParams?: (nodeId: string, params: Record<string, unknown>) => void;
  selectedNodeId?: string | null;
  onNodeDragStart?: (event: React.MouseEvent, node: OperationNodeType) => void;
  onNodeDragStop?: (event: React.MouseEvent, node: OperationNodeType) => void;
}

function Flowchart({
  nodes,
  edges,
  setNodes,
  setEdges,
  onSelectNode,
  onSaveParams,
  selectedNodeId,
  onNodeDragStart,
  onNodeDragStop,
}: FlowchartProps) {
  const nodeTypes = { operation: OperationNode };

  // Appelée par les nodes pour supprimer un node
  const handleRemoveNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) =>
      prev.filter((e) => e.source !== nodeId && e.target !== nodeId)
    );
  };

  // Appelée par les nodes pour configurer un node
  const handleConfigureNode = (nodeData: {
    id: string;
    operation: OperationDefinition;
    params?: Record<string, unknown>;
  }) => {
    onSelectNode?.(nodeData);
  };

  const onNodesChange = useCallback(
    (changes: OperationNodeChange[]) => {
      // Filter out deletion attempts for Model Output node
      const filteredChanges = changes.filter((change) => {
        if (change.type === "remove") {
          const nodeToRemove = nodes.find((n) => n.id === change.id);
          if (nodeToRemove?.data.operation.id === "dbt-model") {
            // Block deletion of Model Output
            return false;
          }
        }
        return true;
      });

      setNodes((prev) =>
        applyNodeChanges<OperationNodeType>(filteredChanges, prev)
      );
    },
    [setNodes, nodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      // Don't filter edge deletions - allow manual edge deletion
      // Edge protection only happens implicitly through node deletion prevention
      setEdges((prev) => applyEdgeChanges(changes, prev));
    },
    [setEdges]
  );

  // Validation des connexions
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);

      if (!sourceNode || !targetNode) return false;

      // Règle 1: Un handle ne peut avoir qu'une seule connexion
      // Vérifier si le handle source a déjà une connexion sortante
      const sourceHandleId = connection.sourceHandle || "default";
      const sourceHasConnection = edges.some(
        (e) =>
          e.source === connection.source &&
          (e.sourceHandle || "default") === sourceHandleId
      );

      // Vérifier si le handle target a déjà une connexion entrante
      const targetHandleId = connection.targetHandle || "default";
      const targetHasConnection = edges.some(
        (e) =>
          e.target === connection.target &&
          (e.targetHandle || "default") === targetHandleId
      );

      if (sourceHasConnection || targetHasConnection) {
        return false;
      }

      // Règle 2: Si la cible est un node "source-table", la source doit être un node "database"
      if (targetNode.data?.operation?.id === "source-table") {
        return sourceNode.data?.operation?.id === "database";
      }

      return true;
    },
    [nodes, edges]
  );

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((prev) => addEdge({ ...params, type: "animated" }, prev)),
    [setEdges]
  );

  // ⚡ PERFORMANCE: Memoize nodesWithCallbacks to prevent recreation on every render
  // This was causing ALL nodes to re-render during pan/zoom, making navigation laggy
  const nodesWithCallbacks = useMemo(() => {
    return nodes.map((node) => {
      if (node.data?.operation) {
        return {
          ...node,
          data: {
            ...node.data,
            onRemove: handleRemoveNode,
            onConfigure: handleConfigureNode,
            onSave: onSaveParams,
            isSelected: node.id === selectedNodeId,
          },
        };
      }
      return node;
    });
  }, [
    nodes,
    selectedNodeId,
    handleRemoveNode,
    handleConfigureNode,
    onSaveParams,
  ]);

  return (
    <div className="flowchart flex-1 w-full h-full">
      <ReactFlow
        nodes={nodesWithCallbacks}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        edgeTypes={{ animated: AnimatedEdge }}
        connectionLineStyle={{ strokeWidth: 2, stroke: "var(--edge-color)" }}
        fitView
        minZoom={0.2}
        maxZoom={1.2}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        onPaneClick={() => onSelectNode?.(null)}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
      >
        <Background />
        <Controls />
      </ReactFlow>

      {/* Custom React Flow attribution */}
      <a
        href="https://reactflow.dev/"
        target="_blank"
        rel="noopener noreferrer"
        className="flowchart-attribution"
      >
        React Flow
      </a>
    </div>
  );
}

export default Flowchart;
