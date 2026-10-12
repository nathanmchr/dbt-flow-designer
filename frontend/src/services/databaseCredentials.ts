import type { DatabaseCredentials } from "./api";
import { ENABLED_DBT_ADAPTER_IDS } from "../definitions/dbtAdapters.ts";

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
    port: optionalPort(config.port) ?? (type === "postgres" ? 5432 : undefined),
    database: optionalString(config.database) ?? optionalString(config.dbname),
    schema_name:
      optionalString(config.schema_name) ?? optionalString(config.schema),
    user: optionalString(config.user),
    password: optionalString(config.password),
    sslmode: optionalString(config.sslmode),
    path: optionalString(config.path),
    account: optionalString(config.account),
    warehouse: optionalString(config.warehouse),
    project: optionalString(config.project),
    dataset: optionalString(config.dataset),
    keyfile: optionalString(config.keyfile),
  };
}

/** Whether a validated adapter has the fields needed to try a live connection. */
export function isDatabaseConfigured(credentials: DatabaseCredentials | null): boolean {
  if (!credentials || !ENABLED_DBT_ADAPTER_IDS.has(credentials.type)) return false;
  return Boolean(credentials.host && credentials.database && credentials.user);
}
