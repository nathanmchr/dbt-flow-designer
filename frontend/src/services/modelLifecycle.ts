import type { Edge, Node } from "@xyflow/react";

import { OPERATION_DEFS } from "../definitions/operations.ts";
import type { OperationNodeData } from "../types";

export const DEFAULT_MODEL_NAME = "Untitled Model";

export interface BlankModelState {
  modelName: string;
  nodes: Node<OperationNodeData>[];
  edges: Edge[];
  nodeCounter: number;
}

export function createBlankModelState(): BlankModelState {
  const databaseOperation = OPERATION_DEFS.find(
    (operation) => operation.id === "database"
  );
  const modelOutputOperation = OPERATION_DEFS.find(
    (operation) => operation.id === "dbt-model"
  );
  const nodes: Node<OperationNodeData>[] = [];

  if (databaseOperation) {
    nodes.push({
      id: "database-source",
      type: "operation",
      position: { x: 100, y: 300 },
      data: {
        operation: databaseOperation,
        params: {},
      },
    });
  }

  if (modelOutputOperation) {
    nodes.push({
      id: "model-output",
      type: "operation",
      position: { x: 600, y: 300 },
      data: {
        operation: modelOutputOperation,
        params: {},
      },
    });
  }

  return {
    modelName: DEFAULT_MODEL_NAME,
    nodes,
    edges: [],
    nodeCounter: 0,
  };
}
