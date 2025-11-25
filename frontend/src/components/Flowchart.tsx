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
import type { OperationDefinition } from "../domain/operations";
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
}

function Flowchart({
  nodes,
  edges,
  setNodes,
  setEdges,
  onSelectNode,
  selectedNodeId,
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
        nodeTypes={nodeTypes}
        edgeTypes={{ animated: AnimatedEdge }}
        connectionLineStyle={{ strokeWidth: 2, stroke: "var(--edge-color)" }}
        fitView
        minZoom={0.2}
        maxZoom={1.2}
        onPaneClick={() => onSelectNode?.(null)}
      >
        <Background />
        <Controls />
      </ReactFlow>

      {/* Custom React Flow attribution */}
      <a
        href="https://reactflow.dev/"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-[1.04rem] left-1/2 -translate-x-1/2 -ml-17 px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur-md shadow-md dark:shadow-black/20 text-[0.7rem] hover:underline transition-colors cursor-pointer"
      >
        React Flow
      </a>
    </div>
  );
}

export default Flowchart;
