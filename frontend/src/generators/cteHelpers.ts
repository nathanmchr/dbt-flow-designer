/**
 * @fileoverview CTE (Common Table Expression) Helper Functions.
 *
 * Provides utilities for generating SQL with CTEs when multiple
 * operations are combined into a single file by the pipeline optimizer.
 */

import type { Node } from "@xyflow/react";
import type {
  OperationNodeData,
  ClassifiedNode,
  NodeGroup,
  CTE,
} from "./dbtGenerator";
import { buildFilterSQL, type FilterNode } from "./filterSql.ts";
import { quoteIdentifier } from "./sqlIdentifiers.ts";

/**
 * Generates a CTE name based on the operation type and position.
 */
export function generateCTEName(
  node: Node<OperationNodeData>,
  index: number
): string {
  const opId = node.data.operation.id;

  switch (opId) {
    case "filter":
      return index === 0 ? "base_filtered" : `filtered_step_${index + 1}`;
    case "select":
      return "selected_columns";
    default:
      return `step_${index + 1}`;
  }
}

/**
 * Generates the SQL body for a CTE.
 */
export function generateCTEBody(
  node: Node<OperationNodeData>,
  previousCTE: string | null,
  _group: NodeGroup,
  allGroups: NodeGroup[],
  classifiedNodes: ClassifiedNode[],
  columnTypes: Map<string, string>
): string {
  const opId = node.data.operation.id;
  const params = node.data.params || {};
  const cn = classifiedNodes.find((c) => c.node.id === node.id)!;

  // Determine the FROM source
  let fromRef: string;
  if (previousCTE) {
    // Reference the previous CTE in the same group
    fromRef = previousCTE;
  } else {
    // Reference the upstream model (outside the group)
    const upstreamGroup = allGroups.find((g) =>
      cn.dependencies.some((depId) => g.nodes.find((n) => n.id === depId))
    );
    fromRef = upstreamGroup
      ? `{{ ref('${upstreamGroup.groupName}') }}`
      : "unknown";
  }

  // Generate SQL based on operation type
  switch (opId) {
    case "filter":
      return generateFilterCTEBody(fromRef, params, cn.columns, columnTypes);
    case "select":
      return generateSelectCTEBody(fromRef, params, cn.columns);
    case "sort": {
      const column = String(params.column || "").trim();
      const direction = params.direction === "DESC" ? "DESC" : "ASC";
      return `SELECT *\nFROM ${fromRef}\nORDER BY ${quoteIdentifier(column)} ${direction}`;
    }
    case "custom-sql":
      return String(params.sql || "")
        .replace(/\{\{\s*parent\s*\}\}/gi, fromRef)
        .replace(/\{\{\s*source\s*\}\}/gi, fromRef);
    default:
      return `SELECT *\nFROM ${fromRef}`;
  }
}

/**
 * Generates CTE body for a Filter operation.
 */
function generateFilterCTEBody(
  fromRef: string,
  params: Record<string, unknown>,
  columns: string[],
  columnTypes: Map<string, string>
): string {
  let sql = "SELECT\n";

  if (columns.length > 0 && columns[0] !== "*") {
    sql += columns
      .map((col) => `    ${quoteIdentifier(col)}`)
      .join(",\n");
  } else {
    sql += "    *";
  }

  sql += `\nFROM ${fromRef}`;

  if (params.condition) {
    const whereClause = buildFilterSQL(
      params.condition as FilterNode,
      columnTypes
    );
    if (whereClause) {
      sql += `\nWHERE ${whereClause}`;
    }
  }

  return sql;
}

/**
 * Generates CTE body for a Select operation.
 */
function generateSelectCTEBody(
  fromRef: string,
  _params: Record<string, unknown>,
  columns: string[]
): string {
  let sql = "SELECT\n";

  if (columns.length > 0 && columns[0] !== "*") {
    sql += columns
      .map((col) => `    ${quoteIdentifier(col)}`)
      .join(",\n");
  } else {
    sql += "    *";
  }

  sql += `\nFROM ${fromRef}`;

  return sql;
}

/**
 * Generates complete SQL for a combined file with CTEs.
 *
 * @param group - The node group to generate SQL for
 * @param allGroups - All node groups for resolving references
 * @param classifiedNodes - All classified nodes for metadata
 * @param columnTypes - Column type registry for value formatting
 * @returns Complete SQL string with CTEs
 */
export function generateCombinedSQL(
  group: NodeGroup,
  allGroups: NodeGroup[],
  classifiedNodes: ClassifiedNode[],
  columnTypes: Map<string, string>
): string {
  const ctes: CTE[] = [];

  // Generate a CTE for each node in the group
  group.nodes.forEach((node, index) => {
    const cteName = generateCTEName(node, index);
    const previousCTE = index > 0 ? ctes[index - 1].name : null;
    const cteSQL = generateCTEBody(
      node,
      previousCTE,
      group,
      allGroups,
      classifiedNodes,
      columnTypes
    );
    const cn = classifiedNodes.find((c) => c.node.id === node.id)!;

    ctes.push({
      name: cteName,
      sql: cteSQL,
      node,
      columns: cn.columns,
    });
  });

  // Generate final SQL
  let sql = `{#\n`;
  sql += `  Model: ${group.groupName}\n`;
  sql += `  Layer: ${group.layer}\n`;
  sql += `  Operations: ${group.nodes
    .map((n) => n.data.operation.label)
    .join(" → ")}\n`;
  sql += `#}\n\n`;

  // CTEs
  ctes.forEach((cte, i) => {
    if (i === 0) {
      sql += `WITH ${cte.name} AS (\n\n`;
    } else {
      sql += `${cte.name} AS (\n\n`;
    }

    // Indent the CTE SQL
    const indentedSQL = cte.sql
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
    sql += `${indentedSQL}\n\n`;

    sql += `)${i < ctes.length - 1 ? ",\n\n" : "\n\n"}`;
  });

  // Final SELECT
  sql += `SELECT * FROM ${ctes[ctes.length - 1].name}`;

  return sql;
}
