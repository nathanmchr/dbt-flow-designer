import assert from "node:assert/strict";
import test from "node:test";
import type { Edge } from "@xyflow/react";

import { OPERATION_DEFS } from "../src/definitions/operations.ts";
import {
  areHistoryStatesEqual,
  createHistoryState,
  describeHistoryChange,
} from "../src/services/historyState.ts";
import type { HistoryState, OperationNode } from "../src/types/index.ts";

function tableNode(): OperationNode {
  const operation = OPERATION_DEFS.find(
    (candidate) => candidate.id === "source-table"
  );
  assert.ok(operation);

  return {
    id: "orders",
    type: "operation",
    position: { x: 100, y: 200 },
    selected: true,
    measured: { width: 320, height: 180 },
    data: {
      operation,
      params: {
        table: "orders",
        columns: [{ name: "id", type: "BIGINT" }],
      },
      isSelected: true,
      onRemove: () => undefined,
      runtimeStatus: "measured",
    },
  };
}

function tableEdge(): Edge {
  return {
    id: "database-orders",
    source: "database",
    target: "orders",
    sourceHandle: "output-0",
    targetHandle: "input-0",
    type: "smoothstep",
    selected: true,
    animated: true,
    style: { opacity: 0.5 },
  };
}

test("canonical history strips React Flow runtime metadata", () => {
  const state = createHistoryState([tableNode()], [tableEdge()]);

  assert.deepEqual(Object.keys(state.nodes[0]).sort(), [
    "data",
    "id",
    "position",
    "type",
  ]);
  assert.deepEqual(Object.keys(state.nodes[0].data).sort(), [
    "operation",
    "params",
  ]);
  assert.deepEqual(Object.keys(state.edges[0]).sort(), [
    "id",
    "source",
    "sourceHandle",
    "target",
    "targetHandle",
    "type",
  ]);
});

test("history equality ignores ordering, definition refreshes and subpixel drift", () => {
  const original = createHistoryState([tableNode()], [tableEdge()]);
  const noisyNode = tableNode();
  noisyNode.position = { x: 100.75, y: 199.25 };
  noisyNode.data = {
    ...noisyNode.data,
    operation: { ...noisyNode.data.operation, label: "Refreshed label" },
    params: {
      columns: [{ type: "BIGINT", name: "id" }],
      table: "orders",
    },
  };
  const noisy = createHistoryState([noisyNode], [
    { ...tableEdge(), selected: false, animated: false },
  ]);

  assert.equal(areHistoryStatesEqual(original, noisy), true);
});

test("history equality keeps real model edits undoable", () => {
  const original = createHistoryState([tableNode()], [tableEdge()]);
  const movedNode = tableNode();
  movedNode.position = { x: 102, y: 200 };
  const changedParamsNode = tableNode();
  changedParamsNode.data.params = {
    ...changedParamsNode.data.params,
    table: "customers",
  };
  const reconnectedEdge = { ...tableEdge(), targetHandle: "input-1" };

  const moved = createHistoryState([movedNode], [tableEdge()]);
  const changedParams = createHistoryState(
    [changedParamsNode],
    [tableEdge()]
  );
  const reconnected = createHistoryState([tableNode()], [reconnectedEdge]);

  assert.equal(areHistoryStatesEqual(original, moved), false);
  assert.equal(areHistoryStatesEqual(original, changedParams), false);
  assert.equal(areHistoryStatesEqual(original, reconnected), false);
  assert.equal(describeHistoryChange(original, moved), 'Moved node "Table"');
  assert.equal(
    describeHistoryChange(original, changedParams),
    'Modified node "Table"'
  );
  assert.equal(describeHistoryChange(original, reconnected), "Reconnected nodes");
});

test("history equality ignores node and edge collection order", () => {
  const first = tableNode();
  const second = { ...tableNode(), id: "customers" };
  const firstEdge = tableEdge();
  const secondEdge = { ...tableEdge(), id: "database-customers", target: "customers" };
  const forward: HistoryState = createHistoryState(
    [first, second],
    [firstEdge, secondEdge]
  );
  const reversed: HistoryState = createHistoryState(
    [second, first],
    [secondEdge, firstEdge]
  );

  assert.equal(areHistoryStatesEqual(forward, reversed), true);
});
