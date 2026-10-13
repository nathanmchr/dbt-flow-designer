import type { Edge, Node } from "@xyflow/react";
import { OPERATION_DEFS } from "../src/definitions/operations.ts";
import { generateDbtModel, type OperationNodeData } from "../src/generators/dbtGenerator.ts";

function node(id: string, operationId: string, params: Record<string, unknown> = {}): Node<OperationNodeData> {
  const operation = OPERATION_DEFS.find((candidate) => candidate.id === operationId);
  if (!operation) throw new Error(`Unknown operation ${operationId}`);
  return { id, type: "operation", position: { x: 0, y: 0 }, data: { operation, params } };
}

const columns: Record<string, [string, string][]> = {
  customers: [["customer_id", "INT"], ["customer_name", "NVARCHAR"], ["country", "NVARCHAR"], ["active", "BIT"]],
  orders: [["order_id", "INT"], ["customer_id", "INT"], ["amount", "DECIMAL(18,2)"], ["status", "NVARCHAR"]],
  products: [["product_id", "INT"], ["category", "NVARCHAR"], ["price", "DECIMAL(18,2)" ]],
  order_items: [["item_id", "INT"], ["order_id", "INT"], ["product_id", "INT"], ["quantity", "INT"]],
};

function fixture(name: string, configure: (nodes: Node<OperationNodeData>[], link: (source: string, target: string, input?: number) => void, source: (table: string) => void) => string) {
  const nodes = [node("database", "database", { adapter: { type: "sqlserver", database: process.env.DBT_FLOW_SQLSERVER_DATABASE || "dbt_flow_test", schema: "qa" } })];
  const edges: Edge[] = [];
  const link = (source: string, target: string, input?: number) => edges.push({ id: `${source}-${target}`, source, target, ...(input === undefined ? {} : { targetHandle: `input-${input}` }) });
  const source = (table: string) => {
    nodes.push(node(table, "source-table", { table, columns: columns[table].map(([name, type]) => ({ name, type })) }));
    link("database", table);
  };
  const last = configure(nodes, link, source);
  nodes.push(node("output", "dbt-model"));
  link(last, "output");
  const result = generateDbtModel(nodes, edges, `QA ${name}`);
  if (result.errors.length) throw new Error(`${name}: ${result.errors.join("; ")}`);
  return { name, model: `fct_qa_${name}`, files: result.files,
    ...(process.argv.includes("--flows") ? { flow: { version: "1.0", modelName: `QA ${name}`, nodes, edges, nodeCounter: nodes.length } } : {}) };
}

const cases = [
  fixture("projection", (nodes, link, source) => {
    source("orders");
    nodes.push(node("select", "select", { columns: [{ original: "order_id", alias: "id" }, { original: "amount", alias: "total" }] }));
    link("orders", "select");
    return "select";
  }),
  fixture("nested_filter", (nodes, link, source) => {
    source("customers");
    nodes.push(node("filter", "filter", { condition: { type: "group", operators: ["AND"], children: [
      { type: "condition", column: "active", operator: "=", value: true },
      { type: "group", operators: ["OR"], children: [
        { type: "condition", column: "customer_name", operator: "=", value: "L'été 東京" },
        { type: "condition", column: "customer_id", operator: ">=", value: 90 },
      ] },
    ] } }), node("sort", "sort", { column: "customer_id", direction: "DESC" }));
    link("customers", "filter"); link("filter", "sort");
    return "sort";
  }),
  fixture("left_join", (nodes, link, source) => {
    source("orders"); source("customers");
    nodes.push(node("customer_select", "select", { columns: [{ original: "customer_id", alias: "customer_key" }, { original: "customer_name" }, { original: "country" }] }),
      node("join", "join", { type: "LEFT", on: { leftColumn: "customer_id", operator: "=", rightColumn: "customer_key" } }),
      node("sort", "sort", { column: "order_id", direction: "DESC" }));
    link("customers", "customer_select"); link("orders", "join", 0); link("customer_select", "join", 1); link("join", "sort");
    return "sort";
  }),
  fixture("aggregate", (nodes, link, source) => {
    source("orders");
    nodes.push(node("aggregate", "group-by", { columns: ["customer_id"], aggregations: [
      { function: "SUM", column: "amount", alias: "total" }, { function: "COUNT", column: "*", alias: "orders" },
      { function: "COUNT", column: "amount", alias: "non_null" }, { function: "AVG", column: "order_id", alias: "avg_order" },
      { function: "COUNT(DISTINCT)", column: "status", alias: "statuses" },
    ] }));
    link("orders", "aggregate");
    return "aggregate";
  }),
  fixture("multi_join_aggregate", (nodes, link, source) => {
    source("order_items"); source("orders"); source("products");
    nodes.push(node("order_select", "select", { columns: [{ original: "order_id", alias: "order_key" }, { original: "status" }] }),
      node("product_select", "select", { columns: [{ original: "product_id", alias: "product_key" }, { original: "category" }, { original: "price" }] }),
      node("join_orders", "join", { type: "INNER", on: { leftColumn: "order_id", operator: "=", rightColumn: "order_key" } }),
      node("join_products", "join", { type: "INNER", on: { leftColumn: "product_id", operator: "=", rightColumn: "product_key" } }),
      node("filter", "filter", { condition: { type: "condition", column: "status", operator: "=", value: "paid" } }),
      node("custom", "custom-sql", { sql: "SELECT category, quantity, quantity * price AS revenue FROM {{ parent }}" }),
      node("aggregate", "group-by", { columns: ["category"], aggregations: [{ function: "SUM", column: "revenue", alias: "revenue" }, { function: "SUM", column: "quantity", alias: "units" }, { function: "COUNT", column: "*", alias: "lines" }] }),
      node("post_filter", "filter", { condition: { type: "condition", column: "revenue", operator: ">", value: 30000 } }),
      node("sort", "sort", { column: "revenue", direction: "DESC" }));
    link("orders", "order_select"); link("products", "product_select"); link("order_items", "join_orders", 0); link("order_select", "join_orders", 1);
    link("join_orders", "join_products", 0); link("product_select", "join_products", 1); link("join_products", "filter"); link("filter", "custom");
    link("custom", "aggregate"); link("aggregate", "post_filter"); link("post_filter", "sort");
    return "sort";
  }),
  fixture("window", (nodes, link, source) => {
    source("orders");
    nodes.push(node("custom", "custom-sql", { sql: "SELECT order_id, customer_id, amount, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY amount DESC, order_id DESC) AS position FROM {{ parent }} WHERE amount IS NOT NULL" }),
      node("filter", "filter", { condition: { type: "condition", column: "position", operator: "<=", value: 2 } }),
      node("sort", "sort", { column: "order_id", direction: "DESC" }));
    link("orders", "custom"); link("custom", "filter"); link("filter", "sort");
    return "sort";
  }),
  fixture("union_duplicates", (nodes, link, source) => {
    source("customers");
    nodes.push(node("select", "select", { columns: [{ original: "country" }] }),
      node("custom", "custom-sql", { sql: "SELECT country FROM {{ parent }} UNION ALL SELECT country FROM {{ parent }}" }));
    link("customers", "select"); link("select", "custom");
    return "custom";
  }),
  fixture("empty", (nodes, link, source) => {
    source("orders");
    nodes.push(node("filter", "filter", { condition: { type: "condition", column: "order_id", operator: "<", value: 0 } }));
    link("orders", "filter");
    return "filter";
  }),
];

process.stdout.write(JSON.stringify(cases));
