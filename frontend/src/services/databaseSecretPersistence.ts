import type { OperationNode } from "../types";

export const DATABASE_SECRETS_STORAGE_KEY =
  "dbt-flow-designer.database-secrets.session.v1";

export interface DatabaseSecretSnapshot {
  version: "1.0";
  passwords: Record<string, string>;
}

let legacySnapshotConsumed = false;
let consumedLegacySnapshot: DatabaseSecretSnapshot | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPassword(adapter: Record<string, unknown>): string | null {
  const nestedConfig = isRecord(adapter.config) ? adapter.config : {};
  const value = Object.prototype.hasOwnProperty.call(adapter, "password")
    ? adapter.password
    : nestedConfig.password;

  return typeof value === "string" && value.length > 0 ? value : null;
}

export function createDatabaseSecretSnapshot(
  nodes: OperationNode[]
): DatabaseSecretSnapshot {
  const passwords: Record<string, string> = {};

  nodes.forEach((node) => {
    if (node.data.operation.id !== "database") return;
    const adapter = node.data.params?.adapter;
    if (!isRecord(adapter)) return;

    const password = getPassword(adapter);
    if (password) passwords[node.id] = password;
  });

  return { version: "1.0", passwords };
}

export function parseDatabaseSecretSnapshot(
  serialized: string | null
): DatabaseSecretSnapshot | null {
  if (!serialized) return null;

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || parsed.version !== "1.0") return null;
    if (!isRecord(parsed.passwords)) return null;

    const entries = Object.entries(parsed.passwords);
    if (
      !entries.every(
        ([nodeId, password]) =>
          nodeId.length > 0 &&
          typeof password === "string" &&
          password.length > 0
      )
    ) {
      return null;
    }

    return {
      version: "1.0",
      passwords: Object.fromEntries(entries) as Record<string, string>,
    };
  } catch {
    return null;
  }
}

export function hydrateDatabaseSecrets(
  nodes: OperationNode[],
  snapshot: DatabaseSecretSnapshot | null
): OperationNode[] {
  if (!snapshot) return nodes;

  return nodes.map((node) => {
    if (node.data.operation.id !== "database") return node;
    const password = snapshot.passwords[node.id];
    const adapter = node.data.params?.adapter;
    if (!password || !isRecord(adapter) || getPassword(adapter)) return node;

    return {
      ...node,
      data: {
        ...node.data,
        params: {
          ...node.data.params,
          adapter: {
            ...adapter,
            password,
          },
        },
      },
    };
  });
}

export function consumeLegacyDatabaseSecretSnapshot(): DatabaseSecretSnapshot | null {
  if (typeof window === "undefined") return null;
  if (legacySnapshotConsumed) return consumedLegacySnapshot;

  legacySnapshotConsumed = true;

  try {
    consumedLegacySnapshot = parseDatabaseSecretSnapshot(
      window.sessionStorage.getItem(DATABASE_SECRETS_STORAGE_KEY)
    );
    window.sessionStorage.removeItem(DATABASE_SECRETS_STORAGE_KEY);
    return consumedLegacySnapshot;
  } catch {
    return null;
  }
}
