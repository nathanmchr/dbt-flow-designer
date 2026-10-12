/**
 * @fileoverview Test SQL Generator
 *
 * Generates a single executable SQL query from a flow for testing/preview.
 * Unlike the dbt generator which creates separate model files with {{ ref() }},
 * this produces a single query with inline CTEs that can run directly on the database.
 *
 * Uses the same filter/SQL generation logic as dbtGenerator for consistency.
 */

import type { Edge, Node } from "@xyflow/react";
import type { OperationDefinition } from "../definitions/operations";
import { buildFilterSQL, type FilterNode } from "./filterSql.ts";
import { getDefaultDatabaseSchema } from "../definitions/dbtAdapters.ts";
import {
  quoteColumn,
  quoteIdentifier,
  quoteQualifiedIdentifier,
} from "./sqlIdentifiers.ts";

type OperationNodeData = {
  operation: OperationDefinition;
  params?: Record<string, unknown>;
};

interface ExecutableSqlResult {
  sql: string;
  errors: string[];
}

// =============================================================================
// Column Type Registry (copied from dbtGenerator for consistency)
// =============================================================================

function buildColumnTypeRegistry(
  nodes: Node<OperationNodeData>[]
): Map<string, string> {
  const registry = new Map<string, string>();

  nodes.forEach((node) => {
    const opId = node.data.operation.id;
    if (
      opId === "database" ||
      opId === "source-table"
    ) {
      const columns = node.data.params?.columns as
        | Array<{ name: string; type: string; alias?: string }>
        | undefined;
      if (columns) {
        columns.forEach((col) => {
          const name = col.alias || col.name;
          registry.set(name, col.type?.toUpperCase() || "VARCHAR");
        });
      }
    }
  });

  return registry;
}

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generates a single executable SQL query from a flow.
 * All transformations are inlined as CTEs, starting from the source table.
 *
 * @param nodes - All nodes in the flowchart
 * @param edges - All connections between nodes
 * @returns Executable SQL and any errors
 */
export function generateExecutableSql(
  nodes: Node<OperationNodeData>[],
  edges: Edge[]
): ExecutableSqlResult {
  const errors: string[] = [];

  // Build column type registry for proper value formatting
  const columnTypes = buildColumnTypeRegistry(nodes);

  // Build dependency graph (target -> sources)
  const dependencyGraph = new Map<string, string[]>();
  const orderedEdges = edges.map((edge, index) => ({ edge, index }));
  orderedEdges.sort((left, right) => {
    if (left.edge.target !== right.edge.target) return left.index - right.index;
    const handleIndex = (edge: Edge) => {
      const match = edge.targetHandle?.match(/^input-(\d+)$/);
      return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
    };
    return handleIndex(left.edge) - handleIndex(right.edge) || left.index - right.index;
  });
  orderedEdges.forEach(({ edge }) => {
    const dependencies = dependencyGraph.get(edge.target) || [];
    dependencies.push(edge.source);
    dependencyGraph.set(edge.target, dependencies);
  });

  // Find output node (dbt-model)
  const outputNode = nodes.find((n) => n.data.operation.id === "dbt-model");
  if (!outputNode) {
    return { sql: "", errors: ["No Model Output node found"] };
  }

  // Find database node to get schema
  const databaseNode = nodes.find((n) => n.data.operation.id === "database");
  const adapterConfig = databaseNode?.data.params?.adapter as
    | Record<string, unknown>
    | undefined;
    const defaultSchema = (adapterConfig?.schema as string) ||
      getDefaultDatabaseSchema(String(adapterConfig?.type || ""));

  // Find source/database nodes
  const sourceNodes = nodes.filter((n) =>
    ["source-table", "database"].includes(n.data.operation.id)
  );

  if (sourceNodes.length === 0) {
    return { sql: "", errors: ["No source table found"] };
  }

  // Build topological order (source -> transformations -> output)
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const ordered: Node<OperationNodeData>[] = [];

  function visit(nodeId: string) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const deps = dependencyGraph.get(nodeId) || [];
    deps.forEach((depId) => visit(depId));

    const node = nodeMap.get(nodeId);
    if (node) {
      ordered.push(node);
    }
  }

  visit(outputNode.id);

  // Generate CTEs for each node
  const ctes: Array<{ name: string; sql: string }> = [];
  const nodeToCteName = new Map<string, string>();
  let cteCounter = 0;

  for (const node of ordered) {
    const opId = node.data.operation.id;
    const params = node.data.params || {};
    const deps = dependencyGraph.get(node.id) || [];

    // Get parent CTE names
    const parentCtes = deps
      .map((depId) => nodeToCteName.get(depId))
      .filter(Boolean) as string[];

    let cteName = "";
    let cteSql = "";

    switch (opId) {
      case "database":
        // Skip database config nodes
        continue;

      case "source-table": {
        // Source table - reference actual table in database
        const tableName = params.table as string | undefined;
        const schema = (params.schema as string) || defaultSchema;
        const columns = params.columns as
          | Array<{ name: string; alias?: string }>
          | undefined;

        if (!tableName) {
          errors.push("Source table name is missing");
          continue;
        }

        cteName = `source_${sanitize(tableName)}`;
        const fullTableName = quoteQualifiedIdentifier(schema, tableName);

        if (columns && columns.length > 0) {
          const colList = columns
            .map((c) =>
              c.alias
                ? `${quoteIdentifier(c.name)} AS ${quoteIdentifier(c.alias)}`
                : quoteIdentifier(c.name)
            )
            .join(",\n    ");
          cteSql = `SELECT\n    ${colList}\nFROM ${fullTableName}`;
        } else {
          cteSql = `SELECT *\nFROM ${fullTableName}`;
        }
        break;
      }

      case "select": {
        const parent = parentCtes[0] || "unknown";
        // Handle both array of strings and array of objects with name/alias
        const selectedCols = params.columns as
          | Array<
              string | { name?: string; original?: string; alias?: string }
            >
          | undefined;

        cteName = `select_${cteCounter++}`;
        if (selectedCols && selectedCols.length > 0) {
          const colList = selectedCols
            .map((col) => {
              if (typeof col === "string") return quoteIdentifier(col);
              const sourceColumn = col.original || col.name;
              return col.alias
                ? `${quoteIdentifier(String(sourceColumn))} AS ${quoteIdentifier(col.alias)}`
                : quoteIdentifier(String(sourceColumn));
            })
            .join(",\n    ");
          cteSql = `SELECT\n    ${colList}\nFROM ${parent}`;
        } else {
          cteSql = `SELECT *\nFROM ${parent}`;
        }
        break;
      }

      case "filter": {
        const parent = parentCtes[0] || "unknown";
        // Use params.condition like dbtGenerator (not filterGroup)
        const filterCondition = params.condition;

        cteName = `filter_${cteCounter++}`;
        const whereClause = buildFilterSQL(
          filterCondition as FilterNode,
          columnTypes
        );
        if (whereClause) {
          cteSql = `SELECT *\nFROM ${parent}\nWHERE ${whereClause}`;
        } else {
          cteSql = `SELECT *\nFROM ${parent}`;
        }
        break;
      }

      case "join": {
        const leftParent = parentCtes[0] || "unknown";
        const rightParent = parentCtes[1] || "unknown";
        const joinType = (params.type as string) || "INNER";
        // Join condition structure from dbt generator
        const joinCondition = params.on as
          | { leftColumn: string; operator: string; rightColumn: string }
          | undefined;

        cteName = `join_${cteCounter++}`;
        if (joinCondition?.leftColumn && joinCondition?.rightColumn) {
          cteSql = `SELECT\n    l.*,\n    r.*\nFROM ${leftParent} l\n${joinType.toUpperCase()} JOIN ${rightParent} r\n    ON l.${
            quoteIdentifier(joinCondition.leftColumn)
          } ${joinCondition.operator || "="} r.${quoteIdentifier(joinCondition.rightColumn)}`;
        } else {
          cteSql = `SELECT *\nFROM ${leftParent}\nCROSS JOIN ${rightParent}`;
        }
        break;
      }

      case "aggregate":
      case "group-by": {
        const parent = parentCtes[0] || "unknown";
        const aggregations = params.aggregations as Aggregation[] | undefined;
        // The group-by columns are stored in "columns" param
        const groupByColumns = params.columns as string[] | undefined;

        cteName = `aggregate_${cteCounter++}`;
        if (aggregations && aggregations.length > 0) {
          const aggCols = aggregations.map((agg) => {
            const alias = agg.alias || `${agg.function}_${agg.column}`;
            if (agg.function === "COUNT" && agg.column === "*") {
              return `COUNT(*) AS ${quoteIdentifier(alias)}`;
            }
            if (agg.function === "COUNT(DISTINCT)") {
              return `COUNT(DISTINCT ${quoteColumn(agg.column)}) AS ${quoteIdentifier(alias)}`;
            }
            return `${agg.function}(${quoteColumn(agg.column)}) AS ${quoteIdentifier(alias)}`;
          });

          let sql = `SELECT`;
          if (groupByColumns && groupByColumns.length > 0) {
            sql += `\n    ${groupByColumns
              .map(quoteIdentifier)
              .join(",\n    ")},`;
          }
          sql += `\n    ${aggCols.join(",\n    ")}\nFROM ${parent}`;
          if (groupByColumns && groupByColumns.length > 0) {
            sql += `\nGROUP BY ${groupByColumns
              .map(quoteIdentifier)
              .join(", ")}`;
          }
          cteSql = sql;
        } else {
          cteSql = `SELECT *\nFROM ${parent}`;
        }
        break;
      }

      case "sort": {
        const parent = parentCtes[0] || "unknown";
        const sortColumn = params.column as string | undefined;
        const direction = (params.direction as string) || "ASC";

        cteName = `sort_${cteCounter++}`;
        if (sortColumn) {
          cteSql = `SELECT *\nFROM ${parent}\nORDER BY ${quoteIdentifier(sortColumn)} ${direction}`;
        } else {
          cteSql = `SELECT *\nFROM ${parent}`;
        }
        break;
      }

      case "union": {
        cteName = `union_${cteCounter++}`;
        if (parentCtes.length >= 2) {
          cteSql = parentCtes
            .map((p) => `SELECT * FROM ${p}`)
            .join("\nUNION ALL\n");
        } else {
          cteSql = `SELECT * FROM ${parentCtes[0] || "unknown"}`;
        }
        break;
      }

      case "custom-sql": {
        const parent = parentCtes[0] || "unknown";
        const customSql = params.sql as string | undefined;

        cteName = `custom_${cteCounter++}`;
        if (customSql) {
          // Replace {{parent}} or {{source}} with actual parent CTE name
          cteSql = customSql
            .replace(/\{\{parent\}\}/gi, parent)
            .replace(/\{\{source\}\}/gi, parent);
        } else {
          cteSql = `SELECT *\nFROM ${parent}`;
        }
        break;
      }

      case "dbt-model": {
        // Final output - just select from parent
        cteName = "final_output";
        cteSql = `SELECT *\nFROM ${parentCtes[0] || "unknown"}`;
        break;
      }

      default:
        // Pass through
        cteName = `transform_${cteCounter++}`;
        cteSql = `SELECT *\nFROM ${parentCtes[0] || "unknown"}`;
    }

    if (cteName && cteSql) {
      ctes.push({ name: cteName, sql: cteSql });
      nodeToCteName.set(node.id, cteName);
    }
  }

  if (ctes.length === 0) {
    return {
      sql: "",
      errors: ["No SQL generated. Check your flow structure."],
    };
  }

  // Build final SQL with CTEs
  let sql = "WITH ";
  ctes.forEach((cte, i) => {
    sql += `${cte.name} AS (\n`;
    sql += cte.sql
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
    sql += "\n)";
    sql += i < ctes.length - 1 ? ",\n\n" : "\n\n";
  });

  sql += `SELECT * FROM ${ctes[ctes.length - 1].name}`;

  return { sql, errors };
}

// =============================================================================
// Helper Types
// =============================================================================

interface Aggregation {
  column: string;
  function: string;
  alias?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

/**
 * @deprecated Use generateExecutableSql instead
 * Cleans dbt SQL by removing Jinja syntax.
 */
export function cleanDbtSqlForExecution(dbtSql: string): string {
  let sql = dbtSql;

  // Remove Jinja comments {# ... #}
  sql = sql.replace(/\{#[\s\S]*?#\}/g, "");

  // Remove {{ config(...) }} blocks
  sql = sql.replace(/\{\{\s*config\s*\([^)]*\)\s*\}\}/g, "");

  // Convert {{ ref('model_name') }} to just model_name (the CTE name)
  sql = sql.replace(/\{\{\s*ref\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g, "$1");

  // Convert {{ source('source', 'table') }} to source_table
  sql = sql.replace(
    /\{\{\s*source\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g,
    "$1_$2"
  );

  // Remove any remaining {{ ... }}
  sql = sql.replace(/\{\{[\s\S]*?\}\}/g, "/* JINJA_REMOVED */");

  // Clean up extra whitespace
  sql = sql.replace(/^\s*\n/gm, "");
  sql = sql.trim();

  return sql;
}
