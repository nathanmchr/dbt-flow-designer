import assert from "node:assert/strict";
import test from "node:test";

import {
  createBlankModelState,
  DEFAULT_MODEL_NAME,
} from "../src/services/modelLifecycle.ts";

test("creates a clean model with only the two permanent nodes", () => {
  const model = createBlankModelState();

  assert.equal(model.modelName, DEFAULT_MODEL_NAME);
  assert.equal(model.nodeCounter, 0);
  assert.deepEqual(model.edges, []);
  assert.deepEqual(
    model.nodes.map((node) => ({
      id: node.id,
      operationId: node.data.operation.id,
      params: node.data.params,
    })),
    [
      { id: "database-source", operationId: "database", params: {} },
      { id: "model-output", operationId: "dbt-model", params: {} },
    ]
  );
});

test("returns independent node collections for each new model", () => {
  const firstModel = createBlankModelState();
  const secondModel = createBlankModelState();

  firstModel.nodes[0].position.x = 999;

  assert.equal(secondModel.nodes[0].position.x, 100);
});
