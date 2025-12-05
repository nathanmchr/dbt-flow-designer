/**
 * @fileoverview Flowchart component that renders the React Flow canvas.
 * Handles node/edge rendering, connections, and user interactions.
 */

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
import type { OperationDefinition } from "../../definitions/operations";
import OperationNode from "./nodes/OperationNode";
import { AnimatedEdge } from "./AnimatedEdge";

/** Data structure for operation nodes */
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

/**
 * Main flowchart component that renders the React Flow canvas.
 * Manages node connections, selection, and drag-and-drop interactions.
 */
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

  /**
   * Removes a node and its connected edges from the flowchart.
   */
  const handleRemoveNode = useCallback(
    (nodeId: string) => {
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) =>
        prev.filter((e) => e.source !== nodeId && e.target !== nodeId)
      );
    },
    [setNodes, setEdges]
  );

  /**
   * Opens the configuration panel for a node.
   */
  const handleConfigureNode = useCallback(
    (nodeData: {
      id: string;
      operation: OperationDefinition;
      params?: Record<string, unknown>;
    }) => {
      onSelectNode?.(nodeData);
    },
    [onSelectNode]
  );

  /**
   * Handles node changes (position, selection, deletion).
   * Prevents deletion of the Model Output node.
   */
  const onNodesChange = useCallback(
    (changes: OperationNodeChange[]) => {
      const filteredChanges = changes.filter((change) => {
        if (change.type === "remove") {
          const nodeToRemove = nodes.find((n) => n.id === change.id);
          if (nodeToRemove?.data.operation.id === "dbt-model") {
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

  /**
   * Handles edge changes (selection, deletion).
   */
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((prev) => applyEdgeChanges(changes, prev));
    },
    [setEdges]
  );

  /**
   * Validates whether a connection between two nodes is allowed.
   * Rules:
   * - Each handle can only have one connection
   * - Source-table nodes can only connect from database nodes
   */
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);

      if (!sourceNode || !targetNode) return false;

      // Check if source handle already has a connection
      const sourceHandleId = connection.sourceHandle || "default";
      const sourceHasConnection = edges.some(
        (e) =>
          e.source === connection.source &&
          (e.sourceHandle || "default") === sourceHandleId
      );

      // Check if target handle already has a connection
      const targetHandleId = connection.targetHandle || "default";
      const targetHasConnection = edges.some(
        (e) =>
          e.target === connection.target &&
          (e.targetHandle || "default") === targetHandleId
      );

      if (sourceHasConnection || targetHasConnection) {
        return false;
      }

      // Source-table nodes can only connect from database nodes
      if (targetNode.data?.operation?.id === "source-table") {
        return sourceNode.data?.operation?.id === "database";
      }

      return true;
    },
    [nodes, edges]
  );

  /**
   * Handles new edge connections between nodes.
   */
  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((prev) => addEdge({ ...params, type: "animated" }, prev)),
    [setEdges]
  );

  /**
   * Memoized nodes with callback handlers attached.
   * Prevents unnecessary re-renders during pan/zoom operations.
   */
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
