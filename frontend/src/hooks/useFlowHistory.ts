/**
 * @fileoverview Hook for managing undo/redo history of flowchart state.
 *
 * Features:
 * - Tracks changes to nodes and edges
 * - Ignores transient changes during node dragging
 * - Provides human-readable descriptions of changes
 * - Limits history to 50 states
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Edge } from "@xyflow/react";
import type { OperationNode, HistoryState } from "../types";

/**
 * Normalize a node to only keep user-relevant properties (ignore ReactFlow metadata).
 */
const normalizeNode = (node: OperationNode) => ({
  id: node.id,
  type: node.type,
  position: node.position,
  data: node.data,
});

/**
 * Normalize an edge to only keep essential properties.
 */
const normalizeEdge = (edge: Edge) => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  type: edge.type,
});

/**
 * Generate a human-readable description of the change between two states.
 */
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

  // Check for moved nodes
  const movedNode = toState.nodes.find((n) => {
    const oldNode = fromState.nodes.find((fn) => fn.id === n.id);
    if (!oldNode) return false;
    const deltaX = Math.abs(oldNode.position.x - n.position.x);
    const deltaY = Math.abs(oldNode.position.y - n.position.y);
    return deltaX > 1 || deltaY > 1;
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

interface UseFlowHistoryOptions {
  nodes: OperationNode[];
  edges: Edge[];
  setNodes: React.Dispatch<React.SetStateAction<OperationNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
}

interface UseFlowHistoryReturn {
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Description of the action that will be undone */
  undoDescription: string;
  /** Description of the action that will be redone */
  redoDescription: string;
  /** Undo the last action */
  undo: () => void;
  /** Redo the last undone action */
  redo: () => void;
  /** Ref to track which nodes are being moved (for ignoring transient states) */
  movingNodes: React.MutableRefObject<Set<string>>;
}

/**
 * Hook for managing undo/redo history of flowchart state.
 */
export function useFlowHistory({
  nodes,
  edges,
  setNodes,
  setEdges,
}: UseFlowHistoryOptions): UseFlowHistoryReturn {
  const [history, setHistory] = useState<HistoryState[]>([
    { nodes: [], edges: [] },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [undoDescription, setUndoDescription] = useState("");
  const [redoDescription, setRedoDescription] = useState("");

  const movingNodes = useRef<Set<string>>(new Set());
  const isRestoringHistory = useRef(false);

  // Save state to history when nodes/edges change
  useEffect(() => {
    if (movingNodes.current.size > 0 || isRestoringHistory.current) {
      return;
    }

    const currentState = { nodes, edges };
    const currentHistoryState = history[historyIndex];

    const normalizedCurrentNodes = currentState.nodes.map(normalizeNode);
    const normalizedCurrentEdges = currentState.edges.map(normalizeEdge);
    const normalizedHistoryNodes =
      currentHistoryState?.nodes.map(normalizeNode) || [];
    const normalizedHistoryEdges =
      currentHistoryState?.edges.map(normalizeEdge) || [];

    if (
      JSON.stringify(normalizedCurrentNodes) !==
        JSON.stringify(normalizedHistoryNodes) ||
      JSON.stringify(normalizedCurrentEdges) !==
        JSON.stringify(normalizedHistoryEdges)
    ) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(currentState);

      if (newHistory.length > 50) {
        newHistory.shift();
      } else {
        setHistoryIndex(newHistory.length - 1);
      }

      setHistory(newHistory);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // Update undo/redo descriptions
  useEffect(() => {
    if (historyIndex > 0) {
      const currentState = history[historyIndex];
      const previousState = history[historyIndex - 1];
      setUndoDescription(describeChange(previousState, currentState));
    } else {
      setUndoDescription("");
    }

    if (historyIndex < history.length - 1) {
      const currentState = history[historyIndex];
      const nextState = history[historyIndex + 1];
      setRedoDescription(describeChange(currentState, nextState));
    } else {
      setRedoDescription("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, historyIndex]);

  const undo = useCallback(() => {
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
  }, [historyIndex, history, setNodes, setEdges]);

  const redo = useCallback(() => {
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
  }, [historyIndex, history, setNodes, setEdges]);

  return {
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    undoDescription,
    redoDescription,
    undo,
    redo,
    movingNodes,
  };
}
