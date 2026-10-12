/**
 * @fileoverview dbt adapter definitions for database connections.
 *
 * Defines supported database adapters and their connection parameters:
 * - PostgreSQL, MySQL, Snowflake, BigQuery, Redshift
 * - Databricks, DuckDB, SQLite
 *
 * Each adapter specifies required fields for the inspector UI.
 */

export interface DBTAdapterParam {
  name: string;
  label: string;
  type: "string" | "number" | "password" | "boolean" | "select";
  required?: boolean;
  options?: string[];
}

export interface DBTAdapterDefinition {
  id: string;
  label: string;
  defaultPort?: number;
  defaultSchema?: string;
  params: DBTAdapterParam[];
}

export const DBT_ADAPTERS: DBTAdapterDefinition[] = [
  {
    id: "postgres",
    label: "PostgreSQL",
    defaultPort: 5432,
    defaultSchema: "public",
    params: [
      { name: "host", label: "Host", type: "string", required: true },
      { name: "port", label: "Port", type: "number" },
      { name: "user", label: "User", type: "string", required: true },
      { name: "password", label: "Password", type: "password" },
      {
        name: "dbname",
        label: "Database Name",
        type: "string",
        required: true,
      },
      { name: "schema", label: "Schema", type: "string", required: true },
      {
        name: "sslmode",
        label: "SSL Mode",
        type: "select",
        options: ["disable", "require", "verify-ca", "verify-full"],
      },
    ],
  },
  {
    id: "mysql",
    label: "MySQL",
    defaultPort: 3306,
    params: [
      { name: "host", label: "Host", type: "string", required: true },
      { name: "port", label: "Port", type: "number" },
      { name: "user", label: "User", type: "string", required: true },
      { name: "password", label: "Password", type: "password", required: true },
      {
        name: "dbname",
        label: "Database Name",
        type: "string",
        required: true,
      },
    ],
  },
  {
    id: "snowflake",
    label: "Snowflake",
    params: [
      { name: "account", label: "Account", type: "string", required: true },
      { name: "user", label: "User", type: "string", required: true },
      { name: "password", label: "Password", type: "password", required: true },
      { name: "role", label: "Role", type: "string" },
      { name: "warehouse", label: "Warehouse", type: "string", required: true },
      { name: "database", label: "Database", type: "string", required: true },
      { name: "schema", label: "Schema", type: "string", required: true },
    ],
  },
  {
    id: "bigquery",
    label: "BigQuery",
    params: [
      {
        name: "method",
        label: "Auth Method",
        type: "select",
        options: ["oauth", "service-account"],
        required: true,
      },
      { name: "project", label: "Project ID", type: "string", required: true },
      { name: "dataset", label: "Dataset", type: "string", required: true },
      { name: "keyfile", label: "Key File Path", type: "string" },
      { name: "timeoutSeconds", label: "Timeout (Seconds)", type: "number" },
    ],
  },
  {
    id: "redshift",
    label: "Redshift",
    defaultPort: 5439,
    params: [
      { name: "host", label: "Host", type: "string", required: true },
      { name: "port", label: "Port", type: "number" },
      { name: "user", label: "User", type: "string", required: true },
      { name: "password", label: "Password", type: "password", required: true },
      {
        name: "dbname",
        label: "Database Name",
        type: "string",
        required: true,
      },
      { name: "schema", label: "Schema", type: "string", required: true },
    ],
  },
  {
    id: "databricks",
    label: "Databricks",
    params: [
      { name: "host", label: "Host", type: "string", required: true },
      { name: "httpPath", label: "HTTP Path", type: "string", required: true },
      { name: "token", label: "Token", type: "password", required: true },
      { name: "catalog", label: "Catalog", type: "string" },
      { name: "schema", label: "Schema", type: "string", required: true },
    ],
  },
  {
    id: "duckdb",
    label: "DuckDB",
    params: [
      { name: "path", label: "File Path", type: "string", required: true },
    ],
  },
  {
    id: "sqlite",
    label: "SQLite",
    params: [
      { name: "path", label: "File Path", type: "string", required: true },
    ],
  },
];

/** Adapters currently available in the Database node UI. */
export const ENABLED_DBT_ADAPTER_IDS: ReadonlySet<string> = new Set([
  "postgres",
]);

export function getDefaultDatabaseSchema(adapterType: string): string {
  return DBT_ADAPTERS.find((adapter) => adapter.id === adapterType)?.defaultSchema || "public";
}

export type DBTAdapterId = DBTAdapterDefinition["id"];
