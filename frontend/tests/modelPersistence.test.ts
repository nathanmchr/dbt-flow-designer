import assert from "node:assert/strict";
import test from "node:test";

import { OPERATION_DEFS } from "../src/definitions/operations.ts";
import {
  createDatabaseSecretSnapshot,
  hydrateDatabaseSecrets,
  parseDatabaseSecretSnapshot,
} from "../src/services/databaseSecretPersistence.ts";
import {
  createCurrentModelSnapshot,
  createFlowHistorySnapshot,
  parseCurrentModel,
  parseFlowHistory,
} from "../src/services/modelPersistence.ts";
import type { OperationNode } from "../src/types/index.ts";

const PROJECT_ID = "2dd13508-64a5-4217-ab05-ccb170530625";

const SECRET_ENVELOPE = {
  version: "1.0" as const,
  algorithm: "AES-256-GCM" as const,
  project_id: PROJECT_ID,
  wrapped_key: {
    nonce: "d3JhcHBlZC1ub25jZQ==",
    ciphertext: "d3JhcHBlZC1jaXBoZXJ0ZXh0",
  },
  payload: {
    nonce: "cGF5bG9hZC1ub25jZQ==",
    ciphertext: "cGF5bG9hZC1jaXBoZXJ0ZXh0",
  },
};

function databaseNode(): OperationNode {
  const operation = OPERATION_DEFS.find((candidate) => candidate.id === "database");
  if (!operation) throw new Error("Missing database operation definition");

  return {
    id: "database-source",
    type: "operation",
    position: { x: 100, y: 300 },
    data: {
      operation,
      params: {
        adapter: {
          type: "postgres",
          host: "127.0.0.1",
          password: "top-level-secret",
          config: {
            schema: "raw",
            token: "nested-secret",
          },
        },
      },
    },
  };
}

function manualTableNode(): OperationNode {
  return {
    id: "manual-source",
    type: "operation",
    position: { x: 300, y: 300 },
    data: {
      operation: {
        id: "source-manual",
        label: "Manual Table",
        description: "Legacy manual source",
        category: "source",
        inputs: 0,
        outputs: 1,
        params: [],
      },
      params: { table_name: "legacy_events" },
    },
  };
}

test("removes obsolete manual tables from persisted models and history", () => {
  const nodes = [databaseNode(), manualTableNode()];
  const edges = [
    {
      id: "manual-to-database",
      source: "manual-source",
      target: "database-source",
    },
  ];
  const currentModel = parseCurrentModel(
    JSON.stringify({
      version: "1.0",
      timestamp: new Date().toISOString(),
      modelName: "Legacy model",
      nodes,
      edges,
      nodeCounter: 2,
    })
  );
  const history = parseFlowHistory(
    JSON.stringify({
      version: "1.0",
      history: [{ nodes, edges }],
      historyIndex: 0,
    })
  );

  assert.deepEqual(currentModel?.nodes.map((node) => node.id), [
    "database-source",
  ]);
  assert.deepEqual(currentModel?.edges, []);
  assert.deepEqual(history?.history[0]?.nodes.map((node) => node.id), [
    "database-source",
  ]);
  assert.deepEqual(history?.history[0]?.edges, []);
});

test("round-trips the active model", () => {
  const edges = [
    {
      id: "database-to-output",
      source: "database-source",
      target: "model-output",
    },
  ];
  const snapshot = createCurrentModelSnapshot({
    projectId: PROJECT_ID,
    modelName: "Orders mart",
    nodes: [databaseNode()],
    edges,
    nodeCounter: 4,
  });

  const restored = parseCurrentModel(JSON.stringify(snapshot));

  assert.equal(restored?.modelName, "Orders mart");
  assert.equal(restored?.projectId, PROJECT_ID);
  assert.equal(restored?.nodes[0].id, "database-source");
  assert.deepEqual(restored?.edges, edges);
  assert.equal(restored?.nodeCounter, 4);
});

test("does not persist database secrets", () => {
  const snapshot = createCurrentModelSnapshot({
    projectId: PROJECT_ID,
    modelName: "Safe model",
    nodes: [databaseNode()],
    edges: [],
    nodeCounter: 1,
  });
  const adapter = snapshot.nodes[0].data.params?.adapter as Record<
    string,
    unknown
  >;
  const nestedConfig = adapter.config as Record<string, unknown>;

  assert.equal(adapter.password, undefined);
  assert.equal(nestedConfig.token, undefined);
  assert.equal(adapter.host, "127.0.0.1");
  assert.equal(nestedConfig.schema, "raw");
});

test("round-trips only an authenticated secret envelope", () => {
  const snapshot = createCurrentModelSnapshot({
    projectId: PROJECT_ID,
    modelName: "Encrypted model",
    nodes: [databaseNode()],
    edges: [],
    nodeCounter: 1,
    secretEnvelope: SECRET_ENVELOPE,
  });
  const serialized = JSON.stringify(snapshot);
  const restored = parseCurrentModel(serialized);

  assert.deepEqual(restored?.secretEnvelope, SECRET_ENVELOPE);
  assert.equal(serialized.includes("top-level-secret"), false);
  assert.equal(serialized.includes("nested-secret"), false);
});

test("drops plaintext secrets and mismatched envelopes from imported files", () => {
  const imported = parseCurrentModel(
    JSON.stringify({
      version: "1.0",
      timestamp: new Date().toISOString(),
      projectId: PROJECT_ID,
      modelName: "Untrusted import",
      nodes: [databaseNode()],
      edges: [],
      nodeCounter: 1,
      secretEnvelope: {
        ...SECRET_ENVELOPE,
        project_id: "783caf36-f0bd-4dc1-a5bd-d9ef6d721f79",
      },
    })
  );
  const adapter = imported?.nodes[0].data.params?.adapter as Record<
    string,
    unknown
  >;

  assert.equal(adapter.password, undefined);
  assert.equal(imported?.secretEnvelope, undefined);
});

test("ignores malformed persisted data", () => {
  assert.equal(parseCurrentModel("not-json"), null);
  assert.equal(parseCurrentModel('{"version":"1.0","nodes":[]}'), null);
});

test("round-trips undo and redo history at the active index", () => {
  const history = [0, 10, 20].map((position) => ({
    nodes: [
      {
        ...databaseNode(),
        position: { x: position, y: 300 },
      },
    ],
    edges: [],
  }));
  const snapshot = createFlowHistorySnapshot(history, 1);

  const restored = parseFlowHistory(JSON.stringify(snapshot), history[1]);

  assert.equal(restored?.history.length, 3);
  assert.equal(restored?.historyIndex, 1);
  assert.equal(restored?.history[0].nodes[0].position.x, 0);
  assert.equal(restored?.history[2].nodes[0].position.x, 20);
  assert.equal(
    parseFlowHistory(JSON.stringify(snapshot), history[2]),
    null
  );
});

test("restores history when React Flow only added transient metadata", () => {
  const history = [{ nodes: [databaseNode()], edges: [] }];
  const snapshot = createFlowHistorySnapshot(history, 0);
  const renderedNode = {
    ...history[0].nodes[0],
    measured: { width: 240, height: 160 },
    selected: false,
    dragging: false,
  } as OperationNode;

  const restored = parseFlowHistory(JSON.stringify(snapshot), {
    nodes: [renderedNode],
    edges: [],
  });

  assert.equal(restored?.historyIndex, 0);
  assert.equal(restored?.history.length, 1);
});

test("limits persisted history while keeping the active state", () => {
  const history = Array.from({ length: 60 }, (_, position) => ({
    nodes: [
      {
        ...databaseNode(),
        position: { x: position, y: 300 },
      },
    ],
    edges: [],
  }));

  const snapshot = createFlowHistorySnapshot(history, 30);

  assert.equal(snapshot.history.length, 50);
  assert.equal(
    snapshot.history[snapshot.historyIndex].nodes[0].position.x,
    30
  );
});

test("removes database secrets from every persisted history state", () => {
  const snapshot = createFlowHistorySnapshot(
    [{ nodes: [databaseNode()], edges: [] }],
    0
  );
  const adapter = snapshot.history[0].nodes[0].data.params
    ?.adapter as Record<string, unknown>;

  assert.equal(adapter.password, undefined);
  assert.equal(parseFlowHistory('{"version":"1.0","history":[],"historyIndex":0}'), null);
  assert.equal(
    parseFlowHistory(
      '{"version":"1.0","history":[{"nodes":[],"edges":[]}],"historyIndex":4}'
    ),
    null
  );
});

test("restores database passwords from a validated decrypted snapshot", () => {
  const sourceNode = databaseNode();
  const secretSnapshot = createDatabaseSecretSnapshot([sourceNode]);
  const persistedModel = createCurrentModelSnapshot({
    modelName: "Safe model",
    nodes: [sourceNode],
    edges: [],
    nodeCounter: 1,
  });
  const parsedSecrets = parseDatabaseSecretSnapshot(
    JSON.stringify(secretSnapshot)
  );
  const hydratedNodes = hydrateDatabaseSecrets(
    persistedModel.nodes,
    parsedSecrets
  );
  const adapter = hydratedNodes[0].data.params?.adapter as Record<
    string,
    unknown
  >;

  assert.equal(adapter.password, "top-level-secret");
  assert.equal(
    (
      persistedModel.nodes[0].data.params?.adapter as Record<string, unknown>
    ).password,
    undefined
  );
});

test("drops cleared or malformed decrypted database secrets", () => {
  const node = databaseNode();
  const adapter = node.data.params?.adapter as Record<string, unknown>;
  const nodeWithoutPassword = {
    ...node,
    data: {
      ...node.data,
      params: {
        ...node.data.params,
        adapter: { ...adapter, password: "" },
      },
    },
  };

  assert.deepEqual(createDatabaseSecretSnapshot([nodeWithoutPassword]).passwords, {});
  assert.equal(
    parseDatabaseSecretSnapshot(
      '{"version":"1.0","passwords":{"database-source":42}}'
    ),
    null
  );
});
