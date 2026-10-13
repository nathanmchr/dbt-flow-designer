import assert from "node:assert/strict";
import test from "node:test";

import { buildDatabaseCredentials, isDatabaseConfigured } from "../src/services/databaseCredentials.ts";
import { ENABLED_DBT_ADAPTER_IDS, getDefaultDatabaseSchema } from "../src/definitions/dbtAdapters.ts";

test("maps the PostgreSQL adapter stored by a Database node", () => {
  assert.deepEqual(
    buildDatabaseCredentials({
      type: "postgres",
      host: "127.0.0.1",
      port: "5432",
      dbname: "dbt_flow_test",
      schema: "raw",
      user: "dbt_flow_reader",
      password: "dbt_flow_reader_local",
      sslmode: "disable",
    }),
    {
      type: "postgres",
      host: "127.0.0.1",
      port: 5432,
      database: "dbt_flow_test",
      schema_name: "raw",
      user: "dbt_flow_reader",
      password: "dbt_flow_reader_local",
      sslmode: "disable",
      account: undefined,
      path: undefined,
      warehouse: undefined,
      project: undefined,
      dataset: undefined,
      keyfile: undefined,
    }
  );
});

test("supports nested adapter configuration and rejects missing adapter types", () => {
  assert.deepEqual(
    buildDatabaseCredentials({
      type: "postgres",
      config: {
        host: "db.internal",
        dbname: "warehouse",
        schema: "analytics",
        user: "reader",
      },
    }),
    {
      type: "postgres",
      host: "db.internal",
      port: 5432,
      database: "warehouse",
      schema_name: "analytics",
      user: "reader",
      password: undefined,
      sslmode: undefined,
      account: undefined,
      path: undefined,
      warehouse: undefined,
      project: undefined,
      dataset: undefined,
      keyfile: undefined,
    }
  );
  assert.equal(buildDatabaseCredentials({ host: "localhost" }), null);
});

test("maps local DuckDB paths and uses its own default schema", () => {
  const credentials = buildDatabaseCredentials({ type: "duckdb", path: "/data/sales.duckdb" });
  assert.equal(credentials?.path, "/data/sales.duckdb");
  assert.equal(credentials?.port, undefined);
  assert.equal(isDatabaseConfigured(credentials), true);
  assert.equal(getDefaultDatabaseSchema("duckdb"), "main");
  assert.equal(getDefaultDatabaseSchema("postgres"), "public");
});

test("does not treat incomplete or unvalidated adapters as live-ready", () => {
  assert.equal(isDatabaseConfigured(null), false);
  assert.equal(isDatabaseConfigured({ type: "duckdb" }), false);
  assert.equal(isDatabaseConfigured({ type: "postgres", host: "localhost" }), false);
  assert.equal(isDatabaseConfigured({ type: "mysql", host: "localhost", database: "db", user: "reader" }), false);
  assert.deepEqual([...ENABLED_DBT_ADAPTER_IDS], ["postgres", "duckdb", "sqlserver"]);
});

test("SQL Server uses secure defaults, dbo and preserves password whitespace", () => {
  const credentials = buildDatabaseCredentials({ type: "sqlserver", host: "db.internal", database: "warehouse", user: "reader", password: " secret; } " });
  assert.equal(credentials?.port, 1433);
  assert.equal(credentials?.driver, "ODBC Driver 18 for SQL Server");
  assert.equal(credentials?.encrypt, true);
  assert.equal(credentials?.trust_cert, false);
  assert.equal(credentials?.password, " secret; } ");
  assert.equal(getDefaultDatabaseSchema("sqlserver"), "dbo");
  assert.equal(isDatabaseConfigured(credentials), true);
  assert.equal(isDatabaseConfigured({ ...credentials!, password: undefined }), false);
  const local = buildDatabaseCredentials({ type: "sqlserver", encrypt: "false", trust_cert: "true" });
  assert.equal(local?.encrypt, false);
  assert.equal(local?.trust_cert, true);
});
