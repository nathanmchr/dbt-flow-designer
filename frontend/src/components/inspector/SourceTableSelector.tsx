import { useEffect, useRef, useState } from "react";
import {
  api,
  type ColumnInfo,
  type DatabaseCredentials,
} from "../../services/api";
import { isDatabaseConfigured } from "../../services/databaseCredentials";
import { ENABLED_DBT_ADAPTER_IDS, getDefaultDatabaseSchema } from "../../definitions/dbtAdapters";

export type SourceTableColumn = ColumnInfo & { alias?: string };

interface SourceTableSelectorProps {
  credentials: DatabaseCredentials | null;
  tableName: string;
  selectedColumns: SourceTableColumn[];
  onTableChange: (tableName: string) => void;
  onColumnsChange: (columns: SourceTableColumn[]) => void;
}

interface LoadState<T> {
  requestKey: string;
  data: T;
  error: string | null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function sameColumns(
  left: SourceTableColumn[],
  right: SourceTableColumn[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (column, index) =>
        column.name === right[index]?.name &&
        column.type === right[index]?.type &&
        column.alias === right[index]?.alias
    )
  );
}

function SourceTableSelector({
  credentials,
  tableName,
  selectedColumns,
  onTableChange,
  onColumnsChange,
}: SourceTableSelectorProps) {
  const [tablesState, setTablesState] = useState<LoadState<string[]>>({
    requestKey: "",
    data: [],
    error: null,
  });
  const [columnsState, setColumnsState] = useState<LoadState<ColumnInfo[]>>({
    requestKey: "",
    data: [],
    error: null,
  });
  const [tablesReload, setTablesReload] = useState(0);
  const [columnsReload, setColumnsReload] = useState(0);
  const selectedColumnsRef = useRef(selectedColumns);

  const adapterType = credentials?.type ?? "";
  const schemaName = credentials?.schema_name || getDefaultDatabaseSchema(adapterType);
  // Preserve every adapter option in both transport and invalidation. Do not
  // persist this key: it is only an in-memory request snapshot.
  const credentialsKey = credentials ? JSON.stringify(credentials) : "";
  const isSupported = ENABLED_DBT_ADAPTER_IDS.has(adapterType);
  const isConfigured = isDatabaseConfigured(credentials);
  const tablesRequestKey = isConfigured
    ? JSON.stringify([
        credentialsKey,
        schemaName,
        tablesReload,
      ])
    : "";
  const columnsRequestKey = isConfigured && tableName
    ? JSON.stringify([tablesRequestKey, tableName, columnsReload])
    : "";
  const tablesLoading = Boolean(
    tablesRequestKey && tablesState.requestKey !== tablesRequestKey
  );
  const columnsLoading = Boolean(
    columnsRequestKey && columnsState.requestKey !== columnsRequestKey
  );
  const tables =
    tablesState.requestKey === tablesRequestKey ? tablesState.data : [];
  const availableColumns =
    columnsState.requestKey === columnsRequestKey ? columnsState.data : [];
  const tablesError =
    tablesState.requestKey === tablesRequestKey ? tablesState.error : null;
  const columnsError =
    columnsState.requestKey === columnsRequestKey ? columnsState.error : null;

  useEffect(() => {
    selectedColumnsRef.current = selectedColumns;
  }, [selectedColumns]);

  useEffect(() => {
    if (!isConfigured) {
      return;
    }

    const controller = new AbortController();
    const requestCredentials: DatabaseCredentials = JSON.parse(credentialsKey);

    api
      .getTables(requestCredentials, schemaName, controller.signal)
      .then((nextTables) => {
        setTablesState({
          requestKey: tablesRequestKey,
          data: nextTables,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setTablesState({
            requestKey: tablesRequestKey,
            data: [],
            error:
              error instanceof Error ? error.message : "Unable to load tables",
          });
        }
      });

    return () => controller.abort();
  }, [
    credentialsKey,
    isConfigured,
    schemaName,
    tablesRequestKey,
  ]);

  useEffect(() => {
    if (!isConfigured || !tableName) {
      return;
    }

    const controller = new AbortController();
    const requestCredentials: DatabaseCredentials = JSON.parse(credentialsKey);

    api
      .getColumns(
        requestCredentials,
        tableName,
        schemaName,
        controller.signal
      )
      .then((columns) => {
        setColumnsState({
          requestKey: columnsRequestKey,
          data: columns,
          error: null,
        });

        const currentColumns = selectedColumnsRef.current;
        const currentByName = new Map(
          currentColumns.map((column) => [column.name, column])
        );
        const nextColumns = currentColumns.length
          ? columns
              .filter((column) => currentByName.has(column.name))
              .map((column) => ({
                ...column,
                alias: currentByName.get(column.name)?.alias,
              }))
          : columns;

        if (!sameColumns(currentColumns, nextColumns)) {
          selectedColumnsRef.current = nextColumns;
          onColumnsChange(nextColumns);
        }
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setColumnsState({
            requestKey: columnsRequestKey,
            data: [],
            error:
              error instanceof Error ? error.message : "Unable to load columns",
          });
        }
      });

    return () => controller.abort();
  }, [
    credentialsKey,
    columnsRequestKey,
    isConfigured,
    onColumnsChange,
    schemaName,
    tableName,
  ]);

  const changeTable = (nextTableName: string) => {
    selectedColumnsRef.current = [];
    onColumnsChange([]);
    onTableChange(nextTableName);
  };

  const selectedNames = new Set(selectedColumns.map((column) => column.name));

  const toggleColumn = (columnName: string) => {
    const nextNames = new Set(selectedNames);
    if (nextNames.has(columnName)) nextNames.delete(columnName);
    else nextNames.add(columnName);

    const currentByName = new Map(
      selectedColumns.map((column) => [column.name, column])
    );
    const nextColumns = availableColumns
      .filter((column) => nextNames.has(column.name))
      .map((column) => ({
        ...column,
        alias: currentByName.get(column.name)?.alias,
      }));
    selectedColumnsRef.current = nextColumns;
    onColumnsChange(nextColumns);
  };

  const selectAllColumns = () => {
    const currentByName = new Map(
      selectedColumns.map((column) => [column.name, column])
    );
    const nextColumns = availableColumns.map((column) => ({
      ...column,
      alias: currentByName.get(column.name)?.alias,
    }));
    selectedColumnsRef.current = nextColumns;
    onColumnsChange(nextColumns);
  };

  const clearColumns = () => {
    selectedColumnsRef.current = [];
    onColumnsChange([]);
  };

  const currentTableIsMissing = Boolean(
    tableName && !tables.includes(tableName)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 text-sm">
        <span className="font-semibold">
          Table<span className="ml-1 text-orange-600">*</span>
        </span>

        {!isSupported ? (
          <div className="inspector-callout border-amber-400 text-xs text-amber-800 dark:border-amber-600 dark:text-amber-300">
            Connect this node to a supported Database node to browse its tables.
          </div>
        ) : !isConfigured ? (
          <div className="inspector-callout border-amber-400 text-xs text-amber-800 dark:border-amber-600 dark:text-amber-300">
            Complete and save the database connection before choosing a table.
          </div>
        ) : (
          <>
            <select
              value={tableName}
              disabled={tablesLoading}
              onChange={(event) => changeTable(event.target.value)}
            >
              <option value="">
                {tablesLoading ? "Loading tables..." : "Select a table..."}
              </option>
              {currentTableIsMissing && (
                <option value={tableName}>{tableName}</option>
              )}
              {tables.map((table) => (
                <option key={table} value={table}>
                  {table}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>
                Schema: <span className="font-mono">{schemaName}</span>
              </span>
              <button
                type="button"
                className="normal-button flex h-6 w-6 shrink-0 items-center justify-center rounded-full p-0"
                aria-label="Refresh tables"
                title="Refresh tables"
                disabled={tablesLoading}
                onClick={() => setTablesReload((value) => value + 1)}
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h5M20 20v-5h-5M5.6 15A7 7 0 0018 17m.4-8A7 7 0 006 7"
                  />
                </svg>
              </button>
            </div>
            {tablesError && (
              <div className="inspector-callout border-red-400 text-xs text-red-700 dark:border-red-600 dark:text-red-300">
                {tablesError}
              </div>
            )}
            {!tablesLoading && !tablesError && tables.length === 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                No table was found in this schema.
              </p>
            )}
          </>
        )}
      </div>

      {tableName && isConfigured && (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">
              Columns<span className="ml-1 text-orange-600">*</span>
            </span>
            {availableColumns.length > 0 && (
              <div className="flex gap-3 text-xs">
                <button
                  type="button"
                  className="text-orange-600 hover:underline dark:text-orange-400"
                  onClick={selectAllColumns}
                >
                  All
                </button>
                <button
                  type="button"
                  className="text-gray-500 hover:underline dark:text-gray-400"
                  onClick={clearColumns}
                >
                  None
                </button>
              </div>
            )}
          </div>

          {columnsLoading ? (
            <div className="inspector-section px-1 text-xs text-gray-500 dark:text-gray-400">
              Loading columns from {tableName}...
            </div>
          ) : columnsError ? (
            <div className="inspector-callout space-y-2 border-red-400 text-xs text-red-700 dark:border-red-600 dark:text-red-300">
              <p>{columnsError}</p>
              <button
                type="button"
                className="font-semibold hover:underline"
                onClick={() => setColumnsReload((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          ) : availableColumns.length > 0 ? (
            <div className="inspector-list max-h-72 overflow-y-auto py-1">
              {availableColumns.map((column) => {
                const selected = selectedNames.has(column.name);
                return (
                  <label
                    key={column.name}
                    className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-2.5 py-2 hover:bg-gray-100/70 dark:hover:bg-gray-700/40"
                  >
                    <input
                      type="checkbox"
                      className="accent-orange-600"
                      checked={selected}
                      onChange={() => toggleColumn(column.name)}
                    />
                    <span className="min-w-0">
                      <span
                        className="block truncate font-medium text-gray-900 dark:text-gray-100"
                        title={column.name}
                      >
                        {column.name}
                      </span>
                      <span
                        className="mt-0.5 block truncate font-mono text-[11px] text-gray-500 dark:text-gray-400"
                        title={column.type}
                      >
                        {column.type}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No column was found for this table.
            </p>
          )}

          {!columnsLoading && availableColumns.length > 0 && (
            <div
              className={`text-xs ${
                selectedColumns.length > 0
                  ? "text-gray-500 dark:text-gray-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {selectedColumns.length > 0
                ? `${selectedColumns.length} of ${availableColumns.length} columns selected`
                : "Select at least one column"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SourceTableSelector;
