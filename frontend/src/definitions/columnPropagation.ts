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

    // If the source node is a manual source or table, get its defined columns
    if (
      sourceNode.data.operation.id === "source-manual" ||
      sourceNode.data.operation.id === "source-table"
    ) {
      const columns = sourceNode.data.params?.columns as
        | Array<{ name: string; type: string; alias?: string }>
        | undefined;
      if (columns && Array.isArray(columns)) {
        // Use alias as name if present
        const effectiveColumns = columns.map((col) => ({
          name: col.alias || col.name,
          type: col.type,
        }));
        allColumns.push(...effectiveColumns);
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
    } else if (sourceNode.data.operation.id === "group-by") {
      // For GROUP BY nodes, propagate:
      // 1. The GROUP BY columns (with their original types)
      // 2. The aggregated columns (with inferred types)

      const groupByColumns = sourceNode.data.params?.columns as
        | string[]
        | undefined;
      const aggregations = sourceNode.data.params?.aggregations as
        | Array<{
            id: string;
            function: string;
            column: string;
            alias: string;
          }>
        | undefined;

      // Get parent columns to determine types
      const parentColumns = getAvailableColumns(sourceNode.id, nodes, edges);

      // Add GROUP BY columns (preserve their types)
      if (groupByColumns && Array.isArray(groupByColumns)) {
        groupByColumns.forEach((colName) => {
          const parentCol = parentColumns.find((col) => col.name === colName);
          if (parentCol) {
            allColumns.push({
              name: colName,
              type: parentCol.type,
            });
          }
        });
      }

      // Add aggregation columns (infer types based on function)
      if (aggregations && Array.isArray(aggregations)) {
        aggregations.forEach((agg) => {
          const alias =
            agg.alias || `${agg.function.toLowerCase()}_${agg.column}`;

          // Infer type based on aggregation function
          let type = "NUMERIC"; // Default for most aggregations

          if (agg.function === "COUNT" || agg.function === "COUNT(DISTINCT)") {
            type = "INTEGER";
          } else if (
            agg.function === "STRING_AGG" ||
            agg.function === "LISTAGG"
          ) {
            type = "VARCHAR";
          } else if (agg.function === "ARRAY_AGG") {
            type = "ARRAY";
          } else if (["SUM", "AVG", "MIN", "MAX"].includes(agg.function)) {
            // Try to preserve the type of the aggregated column
            const parentCol = parentColumns.find(
              (col) => col.name === agg.column
            );
            type = parentCol?.type || "NUMERIC";
          }

          allColumns.push({
            name: alias,
            type: type,
          });
        });
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
