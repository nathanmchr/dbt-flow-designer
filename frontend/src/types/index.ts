/**
 * @fileoverview Shared TypeScript types for the application.
 */

import type { Edge, Node } from "@xyflow/react";
import type { OperationDefinition } from "../definitions/operations";

/**
 * Data structure for operation nodes in the flowchart.
 */
export interface OperationNodeData extends Record<string, unknown> {
  operation: OperationDefinition;
  params?: Record<string, unknown>;
  onRemove?: (nodeId: string) => void;
  onConfigure?: (nodeData: {
    id: string;
    operation: OperationDefinition;
    params?: Record<string, unknown>;
  }) => void;
  onSave?: (nodeId: string, params: Record<string, unknown>) => void;
  isSelected?: boolean;
}

/**
 * Type alias for an operation node.
 */
export type OperationNode = Node<OperationNodeData>;

/**
 * History state for undo/redo functionality.
 */
export interface HistoryState {
  nodes: OperationNode[];
  edges: Edge[];
}

/**
 * Model data structure for save/load functionality.
 */
export interface ModelData {
  version: string;
  timestamp: string;
  modelName: string;
  nodes: OperationNode[];
  edges: Edge[];
  nodeCounter: number;
}
