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
}

function Flowchart({
  nodes,
  edges,
  setNodes,
  setEdges,
  onSelectNode,
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
    (params: Connection) => setEdges((prev) => addEdge(params, prev)),
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
        fitView
        minZoom={0.2}
        maxZoom={1.2}
        onPaneClick={() => onSelectNode?.(null)}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default Flowchart;
