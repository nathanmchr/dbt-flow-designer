import assert from "node:assert/strict";
import test from "node:test";

import { buildDatabaseCredentials } from "../src/services/databaseCredentials.ts";

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
