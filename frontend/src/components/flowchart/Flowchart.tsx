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
  useReactFlow,
  type Edge,
  type Node,
  type Connection,
  type EdgeChange,
  type FitViewOptions,
  type NodeChange,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type RefObject,
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
  isToolboxOpen?: boolean;
  onNodeDragStart?: (event: React.MouseEvent, node: OperationNodeType) => void;
  onNodeDragStop?: (event: React.MouseEvent, node: OperationNodeType) => void;
  getFitViewLeftPadding?: () => number;
  getFitViewRightPadding?: () => number;
}

const FIT_VIEW_PADDING_PX = 32;
const PANEL_VIEWPORT_MARGIN_PX = 16;

function createFitViewPadding(
  getFitViewLeftPadding?: () => number,
  getFitViewRightPadding?: () => number
): NonNullable<FitViewOptions["padding"]> {
  const leftPadding = Math.max(
    FIT_VIEW_PADDING_PX,
    Math.round(getFitViewLeftPadding?.() ?? FIT_VIEW_PADDING_PX)
  );
  const rightPadding = Math.max(
    FIT_VIEW_PADDING_PX,
    Math.round(getFitViewRightPadding?.() ?? FIT_VIEW_PADDING_PX)
  );

  return {
    top: `${FIT_VIEW_PADDING_PX}px`,
    right: `${rightPadding}px`,
    bottom: `${FIT_VIEW_PADDING_PX}px`,
    left: `${leftPadding}px`,
  };
}

function ContextAwareControls({
  getFitViewLeftPadding,
  getFitViewRightPadding,
}: {
  getFitViewLeftPadding?: () => number;
  getFitViewRightPadding?: () => number;
}) {
  const { fitView } = useReactFlow();

  const handleFitView = useCallback(() => {
    void fitView({
      padding: createFitViewPadding(
        getFitViewLeftPadding,
        getFitViewRightPadding
      ),
      duration: 300,
    });
  }, [fitView, getFitViewLeftPadding, getFitViewRightPadding]);

  return <Controls onFitView={handleFitView} />;
}

function ContextAwareViewport({
  selectedNodeId,
  isToolboxOpen,
  flowchartRef,
  getFitViewLeftPadding,
  getFitViewRightPadding,
}: {
  selectedNodeId?: string | null;
  isToolboxOpen?: boolean;
  flowchartRef: RefObject<HTMLDivElement | null>;
  getFitViewLeftPadding?: () => number;
  getFitViewRightPadding?: () => number;
}) {
  const { fitView, getViewport, setViewport } = useReactFlow();
  const previousSelectedNodeIdRef = useRef(selectedNodeId);
  const didAdjustForSelectionRef = useRef(false);
  const previousToolboxOpenRef = useRef(isToolboxOpen);
  const didAdjustForToolboxRef = useRef(false);

  useEffect(() => {
    const previousSelectedNodeId = previousSelectedNodeIdRef.current;
    previousSelectedNodeIdRef.current = selectedNodeId;

    if (!selectedNodeId) {
      if (!previousSelectedNodeId || !didAdjustForSelectionRef.current) return;

      didAdjustForSelectionRef.current = false;

      const frame = window.requestAnimationFrame(() => {
        void fitView({
          padding: createFitViewPadding(
            getFitViewLeftPadding,
            getFitViewRightPadding
          ),
          duration: 300,
        });
      });

      return () => window.cancelAnimationFrame(frame);
    }

    if (!previousSelectedNodeId) {
      didAdjustForSelectionRef.current = false;
    }

    const frame = window.requestAnimationFrame(() => {
      const flowchart = flowchartRef.current;
      if (!flowchart) return;

      const selectedNode = Array.from(
        flowchart.querySelectorAll<HTMLElement>(".react-flow__node")
      ).find((element) => element.dataset.id === selectedNodeId);
      if (!selectedNode) return;

      const leftPadding = Math.max(
        FIT_VIEW_PADDING_PX,
        getFitViewLeftPadding?.() ?? FIT_VIEW_PADDING_PX
      );
      const rightPadding = Math.max(
        FIT_VIEW_PADDING_PX,
        getFitViewRightPadding?.() ?? FIT_VIEW_PADDING_PX
      );

      const flowchartBounds = flowchart.getBoundingClientRect();
      const nodeBounds = selectedNode.getBoundingClientRect();
      let horizontalOffset = 0;

      if (leftPadding > FIT_VIEW_PADDING_PX) {
        const toolboxRight =
          flowchartBounds.left + leftPadding - PANEL_VIEWPORT_MARGIN_PX;
        if (nodeBounds.left < toolboxRight) {
          horizontalOffset =
            toolboxRight + FIT_VIEW_PADDING_PX - nodeBounds.left;
        }
      }

      if (
        Math.abs(horizontalOffset) < 1 &&
        rightPadding > FIT_VIEW_PADDING_PX
      ) {
        const editorLeft =
          flowchartBounds.right - rightPadding + PANEL_VIEWPORT_MARGIN_PX;
        if (nodeBounds.right > editorLeft) {
          horizontalOffset =
            editorLeft - FIT_VIEW_PADDING_PX - nodeBounds.right;
        }
      }

      if (Math.abs(horizontalOffset) < 1) return;

      const viewport = getViewport();
      didAdjustForSelectionRef.current = true;
      void setViewport(
        { ...viewport, x: viewport.x + horizontalOffset },
        { duration: 250 }
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    fitView,
    flowchartRef,
    getFitViewLeftPadding,
    getFitViewRightPadding,
    getViewport,
    selectedNodeId,
    setViewport,
  ]);

  useEffect(() => {
    const wasToolboxOpen = previousToolboxOpenRef.current;
    previousToolboxOpenRef.current = isToolboxOpen;

    if (wasToolboxOpen === isToolboxOpen) return;

    if (!isToolboxOpen) {
      if (!didAdjustForToolboxRef.current) return;

      didAdjustForToolboxRef.current = false;

      const frame = window.requestAnimationFrame(() => {
        void fitView({
          padding: createFitViewPadding(
            getFitViewLeftPadding,
            getFitViewRightPadding
          ),
          duration: 300,
        });
      });

      return () => window.cancelAnimationFrame(frame);
    }

    didAdjustForToolboxRef.current = false;
    if (!selectedNodeId) return;

    const frame = window.requestAnimationFrame(() => {
      const flowchart = flowchartRef.current;
      if (!flowchart) return;

      const selectedNode = Array.from(
        flowchart.querySelectorAll<HTMLElement>(".react-flow__node")
      ).find((element) => element.dataset.id === selectedNodeId);
      if (!selectedNode) return;

      const leftPadding = Math.max(
        FIT_VIEW_PADDING_PX,
        getFitViewLeftPadding?.() ?? FIT_VIEW_PADDING_PX
      );
      if (leftPadding <= FIT_VIEW_PADDING_PX) return;

      const flowchartBounds = flowchart.getBoundingClientRect();
      const nodeBounds = selectedNode.getBoundingClientRect();
      const toolboxRight =
        flowchartBounds.left + leftPadding - PANEL_VIEWPORT_MARGIN_PX;
      if (nodeBounds.left >= toolboxRight) return;

      const nodeLeftTarget = toolboxRight + FIT_VIEW_PADDING_PX;
      const horizontalOffset = nodeLeftTarget - nodeBounds.left;
      if (Math.abs(horizontalOffset) < 1) return;

      const viewport = getViewport();
      didAdjustForToolboxRef.current = true;
      void setViewport(
        { ...viewport, x: viewport.x + horizontalOffset },
        { duration: 250 }
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    fitView,
    flowchartRef,
    getFitViewLeftPadding,
    getFitViewRightPadding,
    getViewport,
    isToolboxOpen,
    selectedNodeId,
    setViewport,
  ]);

  return null;
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
  isToolboxOpen,
  onNodeDragStart,
  onNodeDragStop,
  getFitViewLeftPadding,
  getFitViewRightPadding,
}: FlowchartProps) {
  const nodeTypes = { operation: OperationNode };
  const flowchartRef = useRef<HTMLDivElement>(null);
  const initialFitViewOptions = useMemo(
    () => ({
      padding: createFitViewPadding(
        getFitViewLeftPadding,
        getFitViewRightPadding
      ),
    }),
    [getFitViewLeftPadding, getFitViewRightPadding]
  );

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
    <div ref={flowchartRef} className="flowchart flex-1 w-full h-full">
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
        fitViewOptions={initialFitViewOptions}
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
        <ContextAwareControls
          getFitViewLeftPadding={getFitViewLeftPadding}
          getFitViewRightPadding={getFitViewRightPadding}
        />
        <ContextAwareViewport
          selectedNodeId={selectedNodeId}
          isToolboxOpen={isToolboxOpen}
          flowchartRef={flowchartRef}
          getFitViewLeftPadding={getFitViewLeftPadding}
          getFitViewRightPadding={getFitViewRightPadding}
        />
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
