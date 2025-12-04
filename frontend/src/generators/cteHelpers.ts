import type { Node } from "reactflow";
import type {
  OperationNodeData,
  ClassifiedNode,
  NodeGroup,
  CTE,
} from "./dbtGenerator";

// Type for filter nodes in the filter tree structure
interface FilterNode {
  type: "group" | "condition";
  children?: FilterNode[];
  operators?: string[];
  column?: string;
  operator?: string;
  value?: string | number | boolean;
}

// Import the type-safe formatting function from dbtGenerator
// Note: We're using a simplified inline version to avoid circular dependency
function formatValueByType(
  column: string,
  value: unknown,
  columnTypes: Map<string, string>
): string | number | boolean {
  const type = columnTypes.get(column);

  // If no type, fallback to smart guessing
  if (!type) {
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const num = parseFloat(value);
      if (!isNaN(num) && value.trim() === num.toString()) return num;
      return `'${value}'`;
    }
    // Fallback for other types
    return `'${String(value)}'`;
  }

  // Use schema-based formatting
  if (
    type === "INTEGER" ||
    type === "FLOAT" ||
    type === "NUMERIC" ||
    type === "DECIMAL" ||
    type === "BIGINT"
  ) {
    if (typeof value === "number") return value;
    const num = typeof value === "string" ? parseFloat(value) : NaN;
    return isNaN(num) ? `'${String(value)}'` : num;
  }

  if (type === "BOOLEAN" || type === "BOOL") {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "1" || value === 1) return true;
    if (value === "false" || value === "0" || value === 0) return false;
    return false; // Default to false for other non-boolean values
  }

  // Dates and strings → with quotes
  return `'${String(value)}'`;
}

/**
 * Build SQL Helper - needed for filter conditions
 * This is a simplified version copied from dbtGenerator to avoid circular dependencies
 */
function buildFilterSQL(
  node: FilterNode | null | undefined,
  columnTypes: Map<string, string>
): string {
  if (!node) return "";

  if (node.type === "group") {
    const children = node.children || [];
    if (children.length === 0) return "";

    const parts: string[] = [];
    for (let i = 0; i < children.length; i++) {
      const childSQL = buildFilterSQL(children[i], columnTypes);
      if (childSQL) {
        if (i > 0) {
          // Use the specific operator for this position from the operators array
          const op = node.operators?.[i - 1] || "AND";
          parts.push(op);
        }
        parts.push(childSQL);
      }
    }

    if (parts.length === 0) return "";

    // Only add parentheses if:
    // - Multiple children (more than 1 part that's not an operator)
    // - Contains OR operator (needs grouping)
    const hasMultipleConditions =
      parts.filter((p) => p !== "AND" && p !== "OR").length > 1;
    const hasOrOperator = parts.includes("OR");

    if (hasMultipleConditions || hasOrOperator) {
      return `(${parts.join(" ")})`;
    }

    // Single condition without grouping needed
    return parts.join(" ");
  }

  if (node.type === "condition") {
    const { column, operator, value } = node;
    if (!column || !operator) return "";

    // Handle NULL operators
    if (operator === "IS NULL" || operator === "IS NOT NULL") {
      return `${column} ${operator}`;
    }

    // ✅ Use schema-based formatting
    const formattedValue = formatValueByType(column, value, columnTypes);

    return `${column} ${operator} ${formattedValue}`;
  }

  return "";
}

/**
 * Génère le nom d'une CTE basé sur l'opération
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
 * Génère le corps SQL d'une CTE
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

  // Déterminer la source FROM
  let fromRef: string;
  if (previousCTE) {
    // Référencer la CTE précédente dans le même groupe
    fromRef = previousCTE;
  } else {
    // Référencer le modèle upstream (en dehors du groupe)
    const upstreamGroup = allGroups.find((g) =>
      cn.dependencies.some((depId) => g.nodes.find((n) => n.id === depId))
    );
    fromRef = upstreamGroup
      ? `{{ ref('${upstreamGroup.groupName}') }}`
      : "unknown";
  }

  // Générer le SQL selon l'opération
  switch (opId) {
    case "filter":
      return generateFilterCTEBody(fromRef, params, cn.columns, columnTypes);
    case "select":
      return generateSelectCTEBody(fromRef, params, cn.columns);
    default:
      return `SELECT *\nFROM ${fromRef}`;
  }
}

/**
 * Génère le corps d'une CTE pour une opération Filter
 */
function generateFilterCTEBody(
  fromRef: string,
  params: Record<string, unknown>,
  columns: string[],
  columnTypes: Map<string, string>
): string {
  let sql = "SELECT\n";

  // Colonnes explicites
  if (columns.length > 0 && columns[0] !== "*") {
    sql += columns.map((col) => `    ${col}`).join(",\n");
  } else {
    sql += "    *";
  }

  sql += `\nFROM ${fromRef}`;

  // Condition WHERE
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
 * Génère le corps d'une CTE pour une opération Select
 */
function generateSelectCTEBody(
  fromRef: string,
  _params: Record<string, unknown>,
  columns: string[]
): string {
  let sql = "SELECT\n";

  // Colonnes explicites
  if (columns.length > 0 && columns[0] !== "*") {
    sql += columns.map((col) => `    ${col}`).join(",\n");
  } else {
    sql += "    *";
  }

  sql += `\nFROM ${fromRef}`;

  return sql;
}

/**
 * Génère le SQL complet pour un fichier combiné avec CTEs
 */
export function generateCombinedSQL(
  group: NodeGroup,
  allGroups: NodeGroup[],
  classifiedNodes: ClassifiedNode[],
  columnTypes: Map<string, string>
): string {
  const ctes: CTE[] = [];

  // Générer une CTE par nœud dans le groupe
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

  // Générer le SQL final
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

    // Indenter le SQL de la CTE
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
