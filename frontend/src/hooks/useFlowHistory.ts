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
import {
  areHistoryStatesEqual,
  createHistoryState,
  describeHistoryChange,
} from "../services/historyState";

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
    createHistoryState([], []),
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [undoDescription, setUndoDescription] = useState("");
  const [redoDescription, setRedoDescription] = useState("");

  const movingNodes = useRef<Set<string>>(new Set());
  const isRestoringHistory = useRef(false);

  // Save only canonical, user-relevant state to history.
  useEffect(() => {
    if (movingNodes.current.size > 0 || isRestoringHistory.current) {
      return;
    }

    const currentState = createHistoryState(nodes, edges);
    const currentHistoryState = history[historyIndex];

    if (
      !currentHistoryState ||
      !areHistoryStatesEqual(currentState, currentHistoryState)
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
    // The active history entry is intentionally read without making history
    // changes recursively retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  useEffect(() => {
    if (historyIndex > 0) {
      const currentState = history[historyIndex];
      const previousState = history[historyIndex - 1];
      setUndoDescription(
        describeHistoryChange(previousState, currentState)
      );
    } else {
      setUndoDescription("");
    }

    if (historyIndex < history.length - 1) {
      const currentState = history[historyIndex];
      const nextState = history[historyIndex + 1];
      setRedoDescription(describeHistoryChange(currentState, nextState));
    } else {
      setRedoDescription("");
    }
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
