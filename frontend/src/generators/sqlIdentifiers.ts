/** Quote a PostgreSQL/DuckDB identifier without treating it as SQL code. */
export function quoteIdentifier(identifier: string): string {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

/** Quote a column identifier while preserving the SQL COUNT(*) wildcard. */
export function quoteColumn(identifier: string): string {
  return identifier === "*" ? "*" : quoteIdentifier(identifier);
}

/** Quote every component of a schema-qualified relation name. */
export function quoteQualifiedIdentifier(...parts: string[]): string {
  return parts.map(quoteIdentifier).join(".");
}
