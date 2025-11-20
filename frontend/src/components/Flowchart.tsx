import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  applyEdgeChanges,
  applyNodeChanges,
  addEdge,
} from "@xyflow/react";
import { useCallback } from "react";
import OperationNode from "./nodes/OperationNode";

function Flowchart({ nodes, edges, setNodes, setEdges, onSelectNode }) {
  const nodeTypes = { operation: OperationNode };

  // Appelée par les nodes pour supprimer un node
  const handleRemoveNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) =>
      prev.filter((e) => e.source !== nodeId && e.target !== nodeId)
    );
  };

  // Appelée par les nodes pour configurer un node
  const handleConfigureNode = (nodeData) => {
    if (onSelectNode) onSelectNode(nodeData);
  };

  const onNodesChange = useCallback(
    (changes) => setNodes((prev) => applyNodeChanges(changes, prev)),
    [setNodes]
  );

  const onEdgesChange = useCallback(
    (changes) => setEdges((prev) => applyEdgeChanges(changes, prev)),
    [setEdges]
  );

  const onConnect = useCallback(
    (params) => setEdges((prev) => addEdge(params, prev)),
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
      >
        <Background />
        <MiniMap />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default Flowchart;
