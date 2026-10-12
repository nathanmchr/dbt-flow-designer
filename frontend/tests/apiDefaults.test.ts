import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_RESULTS_PAGE_SIZE } from "../src/services/api.ts";

test("query results default to twenty-five rows", () => {
  assert.equal(DEFAULT_RESULTS_PAGE_SIZE, 25);
});
