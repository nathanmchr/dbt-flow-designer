import type { Edge, Node } from "@xyflow/react";

import { OPERATION_DEFS } from "../src/definitions/operations.ts";
import {
  generateDbtModel,
  type OperationNodeData,
} from "../src/generators/dbtGenerator.ts";

function operation(id: string) {
  const definition = OPERATION_DEFS.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Missing operation definition: ${id}`);
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

const nodes = [
  node("database", "database", {
    adapter: process.argv.includes("--duckdb") ? {
      type: "duckdb",
      path: "fixture.duckdb",
    } : {
      type: "postgres",
      host: "127.0.0.1",
      port: 5432,
      user: "postgres",
      dbname: "warehouse",
      schema: "public",
    },
  }),
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
      { name: "amount", type: "NUMERIC" },
    ],
  }),
  node("join", "join", {
    type: "LEFT",
    on: { leftColumn: "user_id", operator: "=", rightColumn: "id" },
  }),
  node("filter", "filter", {
    condition: {
      type: "condition",
      column: "amount",
      operator: ">=",
      value: 20,
    },
  }),
  node("sort", "sort", { column: "amount", direction: "DESC" }),
  node("output", "dbt-model"),
];

const edges = [
  edge("users-join", "users", "join", "input-1"),
  edge("orders-join", "orders", "join", "input-0"),
  edge("db-users", "database", "users"),
  edge("db-orders", "database", "orders"),
  edge("join-filter", "join", "filter"),
  edge("filter-sort", "filter", "sort"),
  edge("sort-output", "sort", "output"),
];

// Extra native-engine cases share the same generated fixture and source tables.
if (process.argv.includes("--aggregate") || process.argv.includes("--custom-sql")) {
  const aggregate = process.argv.includes("--aggregate");
  nodes.splice(nodes.length - 1, 0, aggregate
    ? node("extra", "group-by", {
        columns: ["email"],
        aggregations: [
          { function: "SUM", column: "amount", alias: "total_amount" },
          { function: "COUNT", column: "*", alias: "order_count" },
        ],
      })
    : node("extra", "custom-sql", {
        sql: "SELECT order_id, user_id, amount, email FROM {{ parent }} WHERE amount >= 30",
      })
  );
  edges.pop();
  edges.push(edge("sort-extra", "sort", "extra"), edge("extra-output", "extra", "output"));
}

const result = generateDbtModel(nodes, edges, "Orders With Users");
if (result.errors.length > 0) {
  throw new Error(result.errors.join("\n"));
}
process.stdout.write(JSON.stringify(
  process.argv.includes("--flow")
    ? {
        version: "1.0", projectId: "8e6630a3-473d-4940-8c8c-4b53524867ec",
        modelName: "Orders With Users", nodes, edges, nodeCounter: nodes.length,
      }
    : result.files
));
