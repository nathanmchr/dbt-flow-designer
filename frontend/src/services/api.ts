/**
 * @fileoverview API service for communicating with the backend.
 * Handles query execution, connection testing, and schema introspection.
 */

import type { ProjectSecretEnvelope } from "../types";

const DEFAULT_API_HOST =
  typeof window === "undefined" || !window.location.hostname
    ? "localhost"
    : window.location.hostname;
const API_BASE_URL =
  import.meta.env?.VITE_API_URL || `http://${DEFAULT_API_HOST}:8765`;

export const DEFAULT_RESULTS_PAGE_SIZE = 25;

/**
 * Database credentials structure.
 */
export interface DatabaseCredentials {
  type: string;
  host?: string;
  port?: number;
  database?: string;
  schema_name?: string;
  user?: string;
  password?: string;
  sslmode?: string;
  path?: string;
  driver?: string;
  encrypt?: boolean;
  trust_cert?: boolean;
  // Cloud databases
  account?: string;
  warehouse?: string;
  project?: string;
  dataset?: string;
  keyfile?: string;
}

/**
 * Query execution result.
 */
export interface QueryResult {
  columns: string[];
  data: Record<string, unknown>[];
  row_count: number;
}

/**
 * Paginated query result.
 */
export interface PaginatedResult {
  columns: string[];
  data: Record<string, unknown>[];
  total_rows: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/**
 * Connection test result.
 */
export interface ConnectionTestResult {
  success: boolean;
  error?: string;
}

/**
 * Column statistics for numeric columns.
 */
export interface ColumnStats {
  min: number | null;
  max: number | null;
  avg: number | null;
  nulls: number;
  type: string;
}

/**
 * Column information.
 */
export interface ColumnInfo {
  name: string;
  type: string;
}

/**
 * API client for the dbt Flow Designer backend.
 */
export const api = {
  /** Encrypt database passwords with a key dedicated to the project. */
  async encryptProjectSecrets(
    projectId: string,
    passwords: Record<string, string>,
    existingEnvelope?: ProjectSecretEnvelope | null,
    signal?: AbortSignal
  ): Promise<ProjectSecretEnvelope> {
    const response = await fetch(`${API_BASE_URL}/api/project-secrets/encrypt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        passwords,
        existing_envelope: existingEnvelope || undefined,
      }),
      signal,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to encrypt project secrets");
    }

    return response.json();
  },

  /** Unlock database passwords using the application-owned vault key. */
  async decryptProjectSecrets(
    envelope: ProjectSecretEnvelope,
    signal?: AbortSignal
  ): Promise<Record<string, string>> {
    const response = await fetch(`${API_BASE_URL}/api/project-secrets/decrypt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ envelope }),
      signal,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to decrypt project secrets");
    }

    const result = await response.json();
    return result.passwords;
  },

  /**
   * Execute a SQL query against a source database.
   */
  async executeQuery(
    credentials: DatabaseCredentials,
    sql: string,
    limit: number = 100
  ): Promise<QueryResult> {
    const response = await fetch(`${API_BASE_URL}/api/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials, sql, limit }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Query execution failed");
    }

    return response.json();
  },

  /**
   * Get a page of results from the last read-only preview query.
   */
  async getResultsPage(
    page: number = 1,
    pageSize: number = DEFAULT_RESULTS_PAGE_SIZE,
    sortColumn?: string,
    sortDirection: "ASC" | "DESC" = "ASC",
    search?: string
  ): Promise<PaginatedResult> {
    const response = await fetch(`${API_BASE_URL}/api/results-page`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page,
        page_size: pageSize,
        sort_column: sortColumn,
        sort_direction: sortDirection,
        search: search || null,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to get results page");
    }

    return response.json();
  },

  /**
   * Get statistics for numeric columns.
   */
  async getColumnStats(): Promise<Record<string, ColumnStats>> {
    const response = await fetch(`${API_BASE_URL}/api/column-stats`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return {};
    }

    return response.json();
  },

  /**
   * Test database connection.
   */
  async testConnection(
    credentials: DatabaseCredentials,
    signal?: AbortSignal
  ): Promise<ConnectionTestResult> {
    const response = await fetch(`${API_BASE_URL}/api/test-connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials }),
      signal,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Connection test failed");
    }

    return response.json();
  },

  /**
   * Get list of tables from the database.
   */
  async getTables(
    credentials: DatabaseCredentials,
    schemaName: string = "public",
    signal?: AbortSignal
  ): Promise<string[]> {
    const response = await fetch(`${API_BASE_URL}/api/tables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials, schema_name: schemaName }),
      signal,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to fetch tables");
    }

    const result = await response.json();
    return result.tables;
  },

  /**
   * Get columns for a specific table.
   */
  async getColumns(
    credentials: DatabaseCredentials,
    table: string,
    schemaName: string = "public",
    signal?: AbortSignal
  ): Promise<ColumnInfo[]> {
    const response = await fetch(`${API_BASE_URL}/api/columns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials, table, schema_name: schemaName }),
      signal,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to fetch columns");
    }

    const result = await response.json();
    return result.columns;
  },

  /**
   * Check if the backend is available.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (!response.ok) return false;
      const result: unknown = await response.json();
      return (
        typeof result === "object" &&
        result !== null &&
        "service" in result &&
        result.service === "dbt-flow-designer"
      );
    } catch {
      return false;
    }
  },

  /**
   * Compile a dbt model and preview its SQL on the connected database.
   */
  async runDbtModel(
    files: Array<{ path: string; content: string }>,
    modelName?: string,
    sourceCredentials?: DatabaseCredentials
  ): Promise<DbtRunResult> {
    const response = await fetch(`${API_BASE_URL}/api/run-dbt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files,
        model_name: modelName,
        source_credentials: sourceCredentials,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to run dbt model");
    }

    return response.json();
  },
};

/**
 * Result of a dbt model run.
 */
export interface DbtRunResult {
  success: boolean;
  output?: string;
  error?: string;
  columns: string[];
  data: Record<string, unknown>[];
  row_count: number;
}
