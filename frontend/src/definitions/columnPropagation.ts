import type { Edge, Node } from "@xyflow/react";
import type { OperationDefinition } from "./operations";

export type ColumnDefinition = {
  name: string;
  type: string;
};

type OperationNodeData = {
  operation: OperationDefinition;
  params?: Record<string, unknown>;
};

/**
 * Get columns available for a given node by traversing the graph backwards
 * and collecting column definitions from source nodes.
 */
export function getAvailableColumns(
  nodeId: string,
  nodes: Node<OperationNodeData>[],
  edges: Edge[]
): ColumnDefinition[] {
  const incomingEdges = edges.filter((edge) => edge.target === nodeId);

  if (incomingEdges.length === 0) {
    return [];
  }

  // Collect columns from all parent nodes
  const allColumns: ColumnDefinition[] = [];

  for (const edge of incomingEdges) {
    const sourceNode = nodes.find((node) => node.id === edge.source);
    if (!sourceNode) continue;

    // If the source node is a manual source, get its defined columns
    if (sourceNode.data.operation.id === "source-manual") {
      const columns = sourceNode.data.params?.columns as
        | ColumnDefinition[]
        | undefined;
      if (columns && Array.isArray(columns)) {
        allColumns.push(...columns);
      }
    } else if (sourceNode.data.operation.id === "select") {
      // For SELECT nodes, only propagate the selected columns
      const selectedColumns = sourceNode.data.params?.columns as
        | Array<{ original: string; alias?: string }>
        | undefined;

      if (selectedColumns && Array.isArray(selectedColumns)) {
        // Get the parent columns first
        const parentColumns = getAvailableColumns(sourceNode.id, nodes, edges);

        // Map selected columns, using alias if provided, otherwise original name
        const renamedColumns = selectedColumns
          .map((selectedCol) => {
            const parentCol = parentColumns.find(
              (col) => col.name === selectedCol.original
            );
            if (!parentCol) return null;

            return {
              name: selectedCol.alias || selectedCol.original,
              type: parentCol.type,
            };
          })
          .filter((col): col is ColumnDefinition => col !== null);

        allColumns.push(...renamedColumns);
      } else {
        // If no columns selected yet, propagate all parent columns
        const inheritedColumns = getAvailableColumns(
          sourceNode.id,
          nodes,
          edges
        );
        allColumns.push(...inheritedColumns);
      }
    } else {
      // For other nodes, recursively get their available columns
      const inheritedColumns = getAvailableColumns(sourceNode.id, nodes, edges);
      allColumns.push(...inheritedColumns);
    }
  }

  // Remove duplicates based on column name
  const uniqueColumns = allColumns.reduce<ColumnDefinition[]>((acc, col) => {
    if (!acc.find((c) => c.name === col.name)) {
      acc.push(col);
    }
    return acc;
  }, []);

  return uniqueColumns;
}
