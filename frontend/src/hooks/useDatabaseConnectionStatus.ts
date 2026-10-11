import { useEffect, useState } from "react";
import { api, type DatabaseCredentials } from "../services/api";
import { isDatabaseConfigured } from "../services/databaseCredentials";

export type DatabaseConnectionStatus = "checking" | "live" | "offline";

const CONNECTION_CHECK_INTERVAL_MS = 30_000;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Keep a lightweight, non-persisted status for a database connection. */
export function useDatabaseConnectionStatus(
  credentials: DatabaseCredentials | null
): DatabaseConnectionStatus {
  const [status, setStatus] =
    useState<DatabaseConnectionStatus>("offline");

  const adapterType = credentials?.type ?? "";
  const host = credentials?.host ?? "";
  const port = credentials?.port;
  const database = credentials?.database ?? "";
  const schemaName = credentials?.schema_name;
  const user = credentials?.user ?? "";
  const password = credentials?.password;
  const sslmode = credentials?.sslmode;
  const path = credentials?.path;
  const isConfigured = isDatabaseConfigured(credentials);

  useEffect(() => {
    if (!isConfigured) {
      setStatus("offline");
      return;
    }

    const controller = new AbortController();
    let disposed = false;
    let requestInFlight = false;
    const requestCredentials: DatabaseCredentials = {
      type: adapterType,
      host,
      port,
      database,
      schema_name: schemaName,
      user,
      password,
      sslmode,
      path,
    };

    const checkConnection = async (showChecking: boolean) => {
      if (requestInFlight) return;
      requestInFlight = true;
      if (showChecking) setStatus("checking");

      try {
        const result = await api.testConnection(
          requestCredentials,
          controller.signal
        );
        if (!disposed) setStatus(result.success ? "live" : "offline");
      } catch (error) {
        if (!disposed && !isAbortError(error)) setStatus("offline");
      } finally {
        requestInFlight = false;
      }
    };

    void checkConnection(true);
    const intervalId = window.setInterval(
      () => void checkConnection(false),
      CONNECTION_CHECK_INTERVAL_MS
    );
    const handleFocus = () => void checkConnection(false);
    window.addEventListener("focus", handleFocus);

    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [
    adapterType,
    database,
    host,
    isConfigured,
    password,
    path,
    port,
    schemaName,
    sslmode,
    user,
  ]);

  return status;
}
