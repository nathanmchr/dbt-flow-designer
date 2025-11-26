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
import { useCallback, type Dispatch, type SetStateAction } from "react";
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
    (changes: OperationNodeChange[]) =>
      setNodes((prev) => applyNodeChanges<OperationNodeType>(changes, prev)),
    [setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setEdges((prev) => applyEdgeChanges(changes, prev)),
    [setEdges]
  );

  // Validation des connexions : seul un node "database" peut se connecter à un node "source-table"
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);

      if (!sourceNode || !targetNode) return false;

      // Si la cible est un node "source-table", la source doit être un node "database"
      if (targetNode.data?.operation?.id === "source-table") {
        return sourceNode.data?.operation?.id === "database";
      }

      return true;
    },
    [nodes]
  );

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((prev) => addEdge({ ...params, type: "animated" }, prev)),
    [setEdges]
  );

  // On injecte handleRemoveNode et handleConfigureNode dans chaque node
  const nodesWithCallbacks = nodes.map((node) => {
    if (node.data?.operation) {
      return {
        ...node,
        data: {
          ...node.data,
          onRemove: handleRemoveNode,
          onConfigure: handleConfigureNode,
          isSelected: node.id === selectedNodeId,
        },
      };
    }
    return node;
  });

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
