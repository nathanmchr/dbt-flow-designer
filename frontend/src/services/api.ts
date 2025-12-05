/**
 * @fileoverview API service for communicating with the backend.
 * Handles query execution, connection testing, and schema introspection.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

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
 * Connection test result.
 */
export interface ConnectionTestResult {
  success: boolean;
  error?: string;
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
   * Test database connection.
   */
  async testConnection(
    credentials: DatabaseCredentials
  ): Promise<ConnectionTestResult> {
    const response = await fetch(`${API_BASE_URL}/api/test-connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials }),
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
    schemaName: string = "public"
  ): Promise<string[]> {
    const response = await fetch(`${API_BASE_URL}/api/tables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials, schema_name: schemaName }),
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
    schemaName: string = "public"
  ): Promise<ColumnInfo[]> {
    const response = await fetch(`${API_BASE_URL}/api/columns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials, table, schema_name: schemaName }),
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
      return response.ok;
    } catch {
      return false;
    }
  },
};
