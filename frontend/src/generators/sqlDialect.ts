export type SqlDialect = "sqlserver" | "default";

/** Only source engines reaching the selected output determine its SQL dialect. */
export function getFlowSqlDialect(nodes: Array<{ data: { operation: { id: string }; params?: Record<string, unknown> } }>): SqlDialect {
  const engines = new Set(nodes.filter((node) => node.data.operation.id === "database")
    .map((node) => (node.data.params?.adapter as { type?: string } | undefined)?.type)
    .filter(Boolean));
  if (engines.has("sqlserver") && engines.size > 1) {
    throw new Error("A SQL Server model cannot join sources from different database engines");
  }
  return engines.has("sqlserver") ? "sqlserver" : "default";
}
