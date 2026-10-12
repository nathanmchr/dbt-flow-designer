/** Shared, deterministic SQL generation for visual filter trees. */

import { quoteIdentifier } from "./sqlIdentifiers.ts";

export interface FilterNode {
  type: "group" | "condition";
  children?: FilterNode[];
  operators?: string[];
  column?: string;
  operator?: string;
  value?: unknown;
}

const ALLOWED_OPERATORS = new Set([
  "=",
  "!=",
  "<>",
  "<",
  ">",
  "<=",
  ">=",
  "LIKE",
  "NOT LIKE",
  "IN",
  "NOT IN",
  "IS NULL",
  "IS NOT NULL",
  "IS NaN",
  "IS NOT NaN",
]);

const NUMERIC_TYPES = new Set([
  "SMALLINT",
  "INTEGER",
  "INT",
  "BIGINT",
  "DECIMAL",
  "NUMERIC",
  "REAL",
  "FLOAT",
  "DOUBLE",
  "DOUBLE PRECISION",
]);

function quoteString(value: unknown): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function isNumericLiteral(value: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(
    value.trim()
  );
}

function formatScalarValue(
  column: string,
  value: unknown,
  columnTypes: Map<string, string>
): string {
  const type = columnTypes.get(column)?.toUpperCase();

  if (NUMERIC_TYPES.has(type || "")) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "string" && isNumericLiteral(value)) {
      return value.trim();
    }
    return quoteString(value);
  }

  if (type === "BOOLEAN" || type === "BOOL") {
    if (value === true || value === "true" || value === "1" || value === 1) {
      return "TRUE";
    }
    if (
      value === false ||
      value === "false" ||
      value === "0" ||
      value === 0
    ) {
      return "FALSE";
    }
    return quoteString(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  return quoteString(value ?? "");
}

function parseListValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [value];

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Build a WHERE expression accepted by PostgreSQL and DuckDB. */
export function buildFilterSQL(
  node: FilterNode | null | undefined,
  columnTypes: Map<string, string>
): string {
  if (!node) return "";

  if (node.type === "condition") {
    const column = node.column?.trim();
    const operator = node.operator;
    if (!column || !operator || !ALLOWED_OPERATORS.has(operator)) return "";

    if (operator === "IS NULL" || operator === "IS NOT NULL") {
      return `${quoteIdentifier(column)} ${operator}`;
    }

    if (operator === "IS NaN" || operator === "IS NOT NaN") {
      const comparison = operator === "IS NaN" ? "=" : "<>";
      return `LOWER(CAST(${quoteIdentifier(column)} AS VARCHAR)) ${comparison} 'nan'`;
    }

    if (operator === "IN" || operator === "NOT IN") {
      const values = parseListValue(node.value);
      if (values.length === 0) return "";
      const list = values
        .map((value) => formatScalarValue(column, value, columnTypes))
        .join(", ");
      return `${quoteIdentifier(column)} ${operator} (${list})`;
    }

    return `${quoteIdentifier(column)} ${operator} ${formatScalarValue(
      column,
      node.value,
      columnTypes
    )}`;
  }

  const children = (node.children || [])
    .map((child, index) => ({
      index,
      sql: buildFilterSQL(child, columnTypes),
    }))
    .filter((child) => child.sql);

  if (children.length === 0) return "";
  if (children.length === 1) return children[0].sql;

  let sql = children[0].sql;
  for (let index = 1; index < children.length; index++) {
    const originalIndex = children[index].index;
    const logicalOperator = node.operators?.[originalIndex - 1] === "OR"
      ? "OR"
      : "AND";
    sql += ` ${logicalOperator} ${children[index].sql}`;
  }
  return `(${sql})`;
}
