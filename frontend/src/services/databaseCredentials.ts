import type { DatabaseCredentials } from "./api";
import { DBT_ADAPTERS, ENABLED_DBT_ADAPTER_IDS } from "../definitions/dbtAdapters.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalPort(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? port
    : undefined;
}

/** Convert the adapter value stored by a Database node into API credentials. */
export function buildDatabaseCredentials(
  adapter: Record<string, unknown> | undefined
): DatabaseCredentials | null {
  if (!adapter) return null;

  const nestedConfig = isRecord(adapter.config) ? adapter.config : {};
  const config = { ...nestedConfig, ...adapter };
  const type = optionalString(config.type);
  if (!type) return null;

  return {
    type,
    host: optionalString(config.host),
    port: optionalPort(config.port) ?? DBT_ADAPTERS.find((adapter) => adapter.id === type)?.defaultPort,
    database: optionalString(config.database) ?? optionalString(config.dbname),
    schema_name:
      optionalString(config.schema_name) ?? optionalString(config.schema),
    user: optionalString(config.user),
    password: typeof config.password === "string" && config.password.length > 0 ? config.password : undefined,
    sslmode: optionalString(config.sslmode),
    path: optionalString(config.path),
    account: optionalString(config.account),
    warehouse: optionalString(config.warehouse),
    project: optionalString(config.project),
    dataset: optionalString(config.dataset),
    keyfile: optionalString(config.keyfile),
    ...(type === "sqlserver" ? {
      driver: optionalString(config.driver) ?? "ODBC Driver 18 for SQL Server",
      encrypt: config.encrypt === undefined || config.encrypt === "" ? true : config.encrypt === true || config.encrypt === "true",
      trust_cert: config.trust_cert === true || config.trust_cert === "true",
    } : {}),
  };
}

/** Whether a validated adapter has the fields needed to try a live connection. */
export function isDatabaseConfigured(credentials: DatabaseCredentials | null): boolean {
  if (!credentials || !ENABLED_DBT_ADAPTER_IDS.has(credentials.type)) return false;
  if (credentials.type === "duckdb") return Boolean(credentials.path);
  if (credentials.type === "sqlserver" && !credentials.password) return false;
  return Boolean(credentials.host && credentials.database && credentials.user);
}
