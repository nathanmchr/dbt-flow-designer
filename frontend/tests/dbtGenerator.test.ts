import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, Node } from "@xyflow/react";

import { OPERATION_DEFS } from "../src/definitions/operations.ts";
import {
  generateDbtModel,
  type DbtModelOutput,
  type OperationNodeData,
} from "../src/generators/dbtGenerator.ts";
import { buildFilterSQL } from "../src/generators/filterSql.ts";

function operation(id: string) {
  const definition = OPERATION_DEFS.find((candidate) => candidate.id === id);
  assert.ok(definition, `Missing operation definition: ${id}`);
  return definition;
}

function node(
  id: string,
  operationId: string,
  params: Record<string, unknown> = {}
): Node<OperationNodeData> {
  return {
    id,
    type: "operation",
    position: { x: 0, y: 0 },
    data: { operation: operation(operationId), params },
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  targetHandle?: string
): Edge {
  return { id, source, target, targetHandle };
}

function file(result: DbtModelOutput, suffix: string): string {
  const generated = result.files.find((candidate) =>
    candidate.path.endsWith(suffix)
  );
  assert.ok(generated, `Missing generated file ending with ${suffix}`);
  return generated.content;
}

function assertAllRefsResolve(result: DbtModelOutput): void {
  const modelNames = new Set(
    result.files
      .filter((generated) => generated.path.endsWith(".sql"))
      .map((generated) => generated.path.split("/").at(-1)!.replace(/\.sql$/, ""))
  );
  const referenced = result.files.flatMap((generated) =>
    [...generated.content.matchAll(/ref\(['"]([^'"]+)['"]\)/g)].map(
      (match) => match[1]
    )
  );
  assert.deepEqual(
    referenced.filter((reference) => !modelNames.has(reference)),
    []
  );
}

const postgresDatabase = node("database", "database", {
  adapter: {
    type: "postgres",
    host: "db.example.test",
    port: 5432,
    user: "reader",
    password: "secret",
    dbname: "warehouse",
    schema: "analytics",
  },
});

test("defaults DuckDB sources to main without exposing its local path in dbt SQL", () => {
  const result = generateDbtModel(
    [
      node("database", "database", { adapter: { type: "duckdb", path: "/private/sales.duckdb" } }),
      node("orders", "source-table", { table: "orders", columns: [{ name: "order_id", type: "INTEGER" }] }),
      node("output", "dbt-model"),
    ],
    [edge("db-orders", "database", "orders"), edge("orders-output", "orders", "output")],
    "DuckDB Orders"
  );
  assert.deepEqual(result.errors, []);
  assert.match(file(result, "sources.yml"), /schema: "main"/);
  assert.doesNotMatch(result.files.map((generated) => generated.content).join("\n"), /\/private\/sales/);
  assertAllRefsResolve(result);
});

test("does not expose the obsolete manual table operation", () => {
  assert.equal(
    OPERATION_DEFS.some((candidate) => candidate.id === "source-manual"),
    false
  );
});

test("projects source columns without requiring a separate Select node", () => {
  const result = generateDbtModel(
    [
      postgresDatabase,
      node("orders-source", "source-table", {
        table: "orders",
        columns: [
          { name: "id", type: "BIGINT" },
          { name: "total_amount", type: "NUMERIC" },
        ],
      }),
      node("output", "dbt-model"),
    ],
    [
      edge("database-orders", "database", "orders-source"),
      edge("orders-output", "orders-source", "output"),
    ],
    "Orders"
  );

  assert.deepEqual(result.errors, []);
  const stagingSql = file(result, "stg_orders.sql");
  assert.ok(stagingSql.includes('SELECT\n  "id",\n  "total_amount"'));
  assert.doesNotMatch(stagingSql, /SELECT\s+\*/);
});

test("generates aligned PostgreSQL sources and safe transformation SQL", () => {
  const nodes = [
    postgresDatabase,
    node("orders", "source-table", {
      table: "orders",
      columns: [
        { name: "id", type: "INTEGER" },
        { name: "customer_name", type: "VARCHAR" },
        { name: "amount", type: "DOUBLE" },
      ],
    }),
    node("filter", "filter", {
      condition: {
        type: "group",
        operators: ["AND", "AND"],
        children: [
          {
            type: "condition",
            column: "customer_name",
            operator: "=",
            value: "O'Reilly",
          },
          {
            type: "condition",
            column: "id",
            operator: "IN",
            value: "1, 2",
          },
          {
            type: "condition",
            column: "amount",
            operator: "IS NOT NaN",
          },
        ],
      },
    }),
    node("sort", "sort", { column: "amount", direction: "DESC" }),
    node("output", "dbt-model"),
  ];
  const edges = [
    edge("db-orders", "database", "orders"),
    edge("orders-filter", "orders", "filter"),
    edge("filter-sort", "filter", "sort"),
    edge("sort-output", "sort", "output"),
  ];

  const result = generateDbtModel(nodes, edges, "Revenue Model");

  assert.deepEqual(result.errors, []);
  const sources = file(result, "models/staging/postgres/sources.yml");
  assert.match(sources, /name: "postgres"/);
  assert.match(sources, /database: "warehouse"/);
  assert.match(sources, /schema: "analytics"/);
  assert.match(sources, /- name: "orders"/);
  assert.match(
    file(result, "stg_orders.sql"),
    /source\('postgres', 'orders'\)/
  );

  const filterSql = file(result, "int_orders_filtered.sql");
  assert.match(filterSql, /"customer_name" = 'O''Reilly'/);
  assert.match(filterSql, /"id" IN \(1, 2\)/);
  assert.match(
    filterSql,
    /LOWER\(CAST\("amount" AS VARCHAR\)\) <> 'nan'/
  );
  assert.match(
    file(result, "int_orders_transformed.sql"),
    /ORDER BY "amount" DESC/
  );
  assertAllRefsResolve(result);
});

test("uses target handles to preserve left and right join inputs", () => {
  const nodes = [
    postgresDatabase,
    node("users", "source-table", {
      table: "users",
      columns: [
        { name: "id", type: "INTEGER" },
        { name: "email", type: "VARCHAR" },
      ],
    }),
    node("orders", "source-table", {
      table: "orders",
      columns: [
        { name: "order_id", type: "INTEGER" },
        { name: "user_id", type: "INTEGER" },
      ],
    }),
    node("join", "join", {
      type: "LEFT",
      on: { leftColumn: "user_id", operator: "=", rightColumn: "id" },
    }),
    node("output", "dbt-model"),
  ];
  const edges = [
    edge("users-join", "users", "join", "input-1"),
    edge("orders-join", "orders", "join", "input-0"),
    edge("db-users", "database", "users"),
    edge("db-orders", "database", "orders"),
    edge("join-output", "join", "output"),
  ];

  const result = generateDbtModel(nodes, edges, "Orders With Users");

  assert.deepEqual(result.errors, []);
  const joinSql = file(result, "int_orders_join_users.sql");
  assert.match(joinSql, /FROM \{\{ ref\('stg_orders'\) \}\} AS l/);
  assert.match(joinSql, /LEFT JOIN \{\{ ref\('stg_users'\) \}\} AS r/);
  assert.match(joinSql, /ON l\."user_id" = r\."id"/);
  assertAllRefsResolve(result);
});

test("resolves optimized downstream references to the generated group", () => {
  const nodes = [
    postgresDatabase,
    node("orders", "source-table", {
      table: "orders",
      columns: [
        { name: "id", type: "INTEGER" },
        { name: "amount", type: "DOUBLE" },
      ],
    }),
    node("select", "select", {
      columns: [
        { original: "id" },
        { original: "amount" },
      ],
    }),
    node("filter", "filter", {
      condition: {
        type: "condition",
        column: "amount",
        operator: ">",
        value: 0,
      },
    }),
    node("output", "dbt-model"),
  ];
  const edges = [
    edge("db-orders", "database", "orders"),
    edge("orders-select", "orders", "select"),
    edge("select-filter", "select", "filter"),
    edge("filter-output", "filter", "output"),
  ];

  const result = generateDbtModel(nodes, edges, "Optimized", {
    optimizePipeline: true,
  });

  assert.deepEqual(result.errors, []);
  file(result, "int_cleaned_orders.sql");
  assert.match(file(result, "fct_optimized.sql"), /ref\('int_cleaned_orders'\)/);
  assertAllRefsResolve(result);
});

test("supports explicit custom SQL parent placeholders", () => {
  const nodes = [
    postgresDatabase,
    node("events", "source-table", {
      table: "events",
      columns: [{ name: "event_id", type: "INTEGER" }],
    }),
    node("custom", "custom-sql", {
      sql: "SELECT event_id FROM {{ parent }} WHERE event_id > 0",
    }),
    node("output", "dbt-model"),
  ];
  const edges = [
    edge("database-events", "database", "events"),
    edge("events-custom", "events", "custom"),
    edge("custom-output", "custom", "output"),
  ];

  const result = generateDbtModel(nodes, edges, "Custom Events");

  assert.deepEqual(result.errors, []);
  assert.match(file(result, "stg_events.sql"), /source\('postgres', 'events'\)/);
  assert.match(
    file(result, "int_events_transformed.sql"),
    /FROM \{\{ ref\('stg_events'\) \}\}/
  );
  assertAllRefsResolve(result);
});

test("keeps intermediate model names distinct for filter-sort-custom SQL chains", () => {
  const result = generateDbtModel(
    [
      postgresDatabase,
      node("orders", "source-table", { table: "orders", columns: [{ name: "order_id", type: "INTEGER" }, { name: "amount", type: "NUMERIC" }] }),
      node("filter", "filter", { condition: { type: "condition", column: "amount", operator: ">=", value: 20 } }),
      node("sort", "sort", { column: "amount", direction: "DESC" }),
      node("custom", "custom-sql", { sql: "SELECT order_id, amount FROM {{ parent }} WHERE amount >= 30" }),
      node("output", "dbt-model"),
    ],
    [edge("db-orders", "database", "orders"), edge("orders-filter", "orders", "filter"),
     edge("filter-sort", "filter", "sort"), edge("sort-custom", "sort", "custom"), edge("custom-output", "custom", "output")],
    "Custom Orders"
  );
  assert.deepEqual(result.errors, []);
  const sqlPaths = result.files.filter((generated) => generated.path.endsWith(".sql")).map((generated) => generated.path);
  assert.equal(new Set(sqlPaths).size, sqlPaths.length);
  assertAllRefsResolve(result);
});

test("rejects incomplete flows before generating files", () => {
  const result = generateDbtModel(
    [postgresDatabase, node("output", "dbt-model")],
    [],
    "Incomplete"
  );

  assert.equal(result.files.length, 0);
  assert.ok(result.errors.some((error) => error.includes("expects 1 input")));
});

test("rejects invalid nested filter parameters", () => {
  const nodes = [
    postgresDatabase,
    node("orders", "source-table", {
      table: "orders",
      columns: [{ name: "id", type: "INTEGER" }],
    }),
    node("filter", "filter", {
      condition: { type: "condition", column: "id", operator: "DROP" },
    }),
    node("output", "dbt-model"),
  ];
  const edges = [
    edge("db-orders", "database", "orders"),
    edge("orders-filter", "orders", "filter"),
    edge("filter-output", "filter", "output"),
  ];

  const result = generateDbtModel(nodes, edges, "Invalid Filter");

  assert.equal(result.files.length, 0);
  assert.ok(result.errors.some((error) => error.includes("no valid condition")));
});

test("filter builder rejects unknown operators and formats typed values", () => {
  const types = new Map([
    ["price", "NUMERIC"],
    ["active", "BOOLEAN"],
  ]);

  assert.equal(
    buildFilterSQL(
      { type: "condition", column: "price", operator: ">=", value: "1.25" },
      types
    ),
    '"price" >= 1.25'
  );
  assert.equal(
    buildFilterSQL(
      { type: "condition", column: "active", operator: "=", value: false },
      types
    ),
    '"active" = FALSE'
  );
  assert.equal(
    buildFilterSQL(
      { type: "condition", column: "price", operator: "DROP", value: 1 },
      types
    ),
    ""
  );
});

test("SQL Server exports quoted sources, Unicode/BIT filters and CTE-safe final ordering", () => {
  const nodes = [
    node("database", "database", { adapter: { type: "sqlserver", database: "warehouse", password: "do-not-export" } }),
    node("orders", "source-table", { table: "orders", columns: [
      { name: "id", type: "INT" }, { name: "label", type: "NVARCHAR" }, { name: "active", type: "BIT" }, { name: "amount", type: "DECIMAL(18,2)" },
    ] }),
    node("filter", "filter", { condition: { type: "group", operators: ["AND", "AND"], children: [
      { type: "condition", column: "label", operator: "=", value: "L'été 東京" },
      { type: "condition", column: "active", operator: "=", value: true },
      { type: "condition", column: "amount", operator: ">=", value: "12.5" },
    ] } }),
    node("sort", "sort", { column: "amount", direction: "DESC" }), node("output", "dbt-model"),
  ];
  const edges = [edge("dt", "database", "orders"), edge("tf", "orders", "filter"), edge("fs", "filter", "sort"), edge("so", "sort", "output")];
  for (const optimizePipeline of [false, true]) {
    const result = generateDbtModel(nodes, edges, "SQL Server Orders", { optimizePipeline });
    assert.deepEqual(result.errors, []);
    assert.match(file(result, "sources.yml"), /schema: "dbo"/);
    assert.match(file(result, "sources.yml"), /database: "warehouse"/);
    const filter = file(result, "int_orders_filtered.sql");
    assert.match(filter, /"label" = N'L''été 東京'/);
    assert.match(filter, /"active" = 1/);
    assert.match(filter, /"amount" >= 12.5/);
    assert.match(file(result, "int_orders_transformed.sql"), /ORDER BY "amount" DESC\nOFFSET 0 ROWS/);
    assert.match(file(result, "fct_sql_server_orders.sql"), /ORDER BY "amount" DESC\nOFFSET 0 ROWS/);
    assert.doesNotMatch(result.files.map((generated) => generated.content).join("\n"), /do-not-export/);
    assertAllRefsResolve(result);
  }
});

test("SQL Server AVG keeps fractions and unsupported NaN is explicit", () => {
  const database = node("database", "database", { adapter: { type: "sqlserver" } });
  const table = node("orders", "source-table", { table: "orders", columns: [{ name: "id", type: "INT" }] });
  const output = node("output", "dbt-model");
  const aggregate = node("agg", "group-by", { columns: ["id"], aggregations: [{ function: "AVG", column: "id", alias: "avg_id" }] });
  const result = generateDbtModel([database, table, aggregate, output],
    [edge("dt", "database", "orders"), edge("ta", "orders", "agg"), edge("ao", "agg", "output")], "Average");
  assert.deepEqual(result.errors, []);
  assert.ok(result.files.some((generated) => generated.content.includes('AVG(CAST("id" AS FLOAT))')));
  assert.throws(() => buildFilterSQL({ type: "condition", column: "id", operator: "IS NaN" }, new Map(), "sqlserver"), /does not support IEEE NaN/);
});

test("SQL Server refuses a flow mixing engines but ignores disconnected database nodes", () => {
  const sqlserver = node("db", "database", { adapter: { type: "sqlserver" } });
  const table = node("orders", "source-table", { table: "orders", columns: [{ name: "id", type: "INT" }] });
  const other = node("other", "source-table", { table: "other", columns: [{ name: "id", type: "INT" }] });
  const output = node("output", "dbt-model");
  const result = generateDbtModel([sqlserver, table, postgresDatabase, output],
    [edge("dt", "db", "orders"), edge("to", "orders", "output")], "One engine");
  assert.deepEqual(result.errors, []);
  const mixed = generateDbtModel([sqlserver, table, postgresDatabase, other, node("union", "join", { type: "INNER", on: { leftColumn: "id", rightColumn: "id", operator: "=" } }), output],
    [edge("dt", "db", "orders"), edge("po", "database", "other"), edge("tu", "orders", "union", "input-0"),
     edge("ou", "other", "union", "input-1"), edge("uo", "union", "output")], "Mixed");
  assert.ok(mixed.errors.some((error) => error.includes("different database engines")));
});
