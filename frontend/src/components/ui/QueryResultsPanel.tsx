/**
 * @fileoverview Query Results Panel component with pagination.
 * Displays paginated query results with sorting and navigation.
 * Uses the same panel styling as Inspector and Toolbox.
 */

import { useState, useEffect, useCallback } from "react";
import {
  api,
  DEFAULT_RESULTS_PAGE_SIZE,
  type PaginatedResult,
  type ColumnStats,
} from "../../services/api";

interface QueryResultsPanelProps {
  /** Initial columns (from first query) */
  initialColumns: string[];
  /** Initial data (from first query) */
  initialData: Record<string, unknown>[];
  /** Initial total row count */
  initialTotalRows: number;
  /** Whether the initial query is still loading */
  isLoading?: boolean;
  /** Error message if query failed */
  error?: string | null;
  /** Whether the persistent panel is expanded */
  isExpanded: boolean;
  /** Callback to expand or minimize the persistent panel */
  onExpandedChange: (isExpanded: boolean) => void;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250];
const TAB_EXIT_DURATION_MS = 150;

/**
 * Panel displaying paginated query results with sorting.
 */
export function QueryResultsPanel({
  initialColumns,
  initialData,
  initialTotalRows,
  isLoading = false,
  error = null,
  isExpanded,
  onExpandedChange,
}: QueryResultsPanelProps) {
  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_RESULTS_PAGE_SIZE);
  const [totalRows, setTotalRows] = useState(initialTotalRows);
  const [totalPages, setTotalPages] = useState(1);

  // Data state
  const [columns, setColumns] = useState(initialColumns);
  const [data, setData] = useState(initialData);
  const [isPageLoading, setIsPageLoading] = useState(false);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"ASC" | "DESC">("ASC");

  // Search state
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Resizing state
  const [height, setHeight] = useState(400);
  const [isResizing, setIsResizing] = useState(false);

  // Stats state
  const [columnStats, setColumnStats] = useState<Record<string, ColumnStats>>(
    {}
  );
  const [showStats, setShowStats] = useState(false);

  const isMinimized = !isExpanded;
  const [isClosingTab, setIsClosingTab] = useState(false);

  // Handle opening panel from tab (same pattern as Toolbox)
  const handleOpenFromTab = () => {
    setIsClosingTab(true);
    onExpandedChange(true);
    setTimeout(() => {
      setIsClosingTab(false);
    }, TAB_EXIT_DURATION_MS);
  };

  // Animation state
  const [stage, setStage] = useState<"hidden" | "enter">("hidden");

  // Trigger enter animation when loading completes
  useEffect(() => {
    if (!isLoading && stage === "hidden") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setStage("enter");
        });
      });
    }
  }, [isLoading, stage]);

  // Update from initial data
  useEffect(() => {
    setColumns(initialColumns);
    setData(initialData);
    setTotalRows(initialTotalRows);
    setPageSize(DEFAULT_RESULTS_PAGE_SIZE);
    setTotalPages(Math.ceil(initialTotalRows / DEFAULT_RESULTS_PAGE_SIZE) || 1);
    setPage(1);
  }, [initialColumns, initialData, initialTotalRows]);

  // Load column stats when data is loaded
  useEffect(() => {
    if (!isLoading && initialData.length > 0) {
      api.getColumnStats().then(setColumnStats).catch(console.error);
    }
  }, [isLoading, initialData.length]);

  // Handle resize drag
  useEffect(() => {
    if (!isResizing) return;

    document.body.classList.add("resizing-row");
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      const newHeight = window.innerHeight - e.clientY - 16; // 16px for bottom margin
      setHeight(Math.max(200, Math.min(newHeight, window.innerHeight - 100)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.classList.remove("resizing-row");
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Trigger search when debounced value changes
  useEffect(() => {
    if (stage === "enter") {
      fetchPage(1, pageSize, sortColumn, sortDirection, debouncedSearch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // Fetch page from API
  const fetchPage = useCallback(
    async (
      newPage: number,
      newPageSize: number,
      newSortColumn: string | null,
      newSortDirection: "ASC" | "DESC",
      search: string = ""
    ) => {
      setIsPageLoading(true);
      try {
        const result: PaginatedResult = await api.getResultsPage(
          newPage,
          newPageSize,
          newSortColumn || undefined,
          newSortDirection,
          search || undefined
        );
        setColumns(result.columns);
        setData(result.data);
        setTotalRows(result.total_rows);
        setTotalPages(result.total_pages);
        setPage(result.page);
        setPageSize(result.page_size);
      } catch (err) {
        console.error("Failed to fetch page:", err);
      } finally {
        setIsPageLoading(false);
      }
    },
    []
  );

  // Handle page change
  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      fetchPage(newPage, pageSize, sortColumn, sortDirection, debouncedSearch);
    }
  };

  // Handle page size change
  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    fetchPage(1, newSize, sortColumn, sortDirection, debouncedSearch);
  };

  // Handle column sort
  const handleSort = (column: string) => {
    let newDirection: "ASC" | "DESC" = "ASC";
    if (sortColumn === column) {
      newDirection = sortDirection === "ASC" ? "DESC" : "ASC";
    }
    setSortColumn(column);
    setSortDirection(newDirection);
    fetchPage(1, pageSize, column, newDirection, debouncedSearch);
  };

  // Copy value to clipboard with notification
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  const handleCopyCell = async (value: unknown, cellId: string) => {
    const textValue = formatValue(value);
    try {
      await navigator.clipboard.writeText(textValue);
      setCopiedCell(cellId);
      setTimeout(() => setCopiedCell(null), 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (data.length === 0) return;

    // Create CSV content
    const csvHeader = columns.join(",");
    const csvRows = data.map((row) =>
      columns
        .map((col) => {
          const value = row[col];
          const stringValue = formatValue(value);
          // Escape quotes and wrap in quotes if contains comma or newline
          if (
            stringValue.includes(",") ||
            stringValue.includes("\n") ||
            stringValue.includes('"')
          ) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        })
        .join(",")
    );
    const csvContent = [csvHeader, ...csvRows].join("\n");

    // Download file
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `query_results_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number" && isNaN(value)) return "NaN";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const showLoading = isLoading || isPageLoading;

  // Animation easing
  const enterEase = "cubic-bezier(0.22,1,0.36,1)";
  const exitEase = "cubic-bezier(0.5,0.05,0.8,0.25)";

  const panelStyle = {
    height: `${height}px`,
    transform:
      stage === "enter"
        ? isMinimized
          ? "translateY(calc(100% + 20px))"
          : "translateY(0)"
        : "translateY(120%)",
    transition:
      isMinimized
        ? `transform 200ms ${exitEase}`
        : `transform 420ms ${enterEase}`,
    pointerEvents: stage === "enter" && !isMinimized ? "auto" : "none",
  } as const;

  return (
    <>
      {/* Toggle tab when minimized - positioned on right side */}
      {(isMinimized || isClosingTab) && stage === "enter" && (
        <button
          type="button"
          aria-label="Expand query results"
          aria-controls="query-results-panel"
          aria-expanded="false"
          onClick={handleOpenFromTab}
          className="normal-button fixed bottom-0 left-[calc(50%+7.4rem)] z-50 p-3 rounded-t-2xl backdrop-blur-lg rounded-b-none border-b-transparent"
          style={{
            animation: isClosingTab
              ? `slideOutToBottom ${TAB_EXIT_DURATION_MS}ms ease-in both`
              : "slideInFromBottom 200ms ease-out 160ms both",
          }}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </button>
      )}

      <div
        id="query-results-panel"
        aria-hidden={isMinimized}
        inert={isMinimized}
        className="panel fixed inset-x-4 bottom-0 z-50 flex flex-col overflow-hidden"
        style={panelStyle}
      >
        {/* Resize handle - at the top */}
        <div
          className="absolute left-0 right-0 top-0 h-1 cursor-row-resize z-50"
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizing(true);
          }}
        />

        {/* Header - matching Inspector/Toolbox style */}
        <div className="shrink-0 flex justify-between items-center px-4 pt-4">
          <div className="flex items-center gap-4">
            <p className="pb-2 border-b text-xs font-bold uppercase tracking-[0.2em] border-gray-400 dark:border-gray-700 text-gray-500 dark:text-gray-400">
              Query Results
            </p>
            {!showLoading && !error && (
              <>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {totalRows.toLocaleString()} row{totalRows !== 1 ? "s" : ""} •{" "}
                  {columns.length} column{columns.length !== 1 ? "s" : ""}
                </span>
                {Object.keys(columnStats).length > 0 && (
                  <button
                    onClick={() => setShowStats(!showStats)}
                    className={`normal-button px-2 py-1 text-xs flex items-center gap-1 ${
                      showStats ? "bg-blue-100 dark:bg-blue-900/30" : ""
                    }`}
                    title="Toggle column statistics"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                      />
                    </svg>
                    Stats
                  </button>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* Search input */}
            {!error && (
              <div className="relative">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search..."
                  className="pl-8 pr-3 py-1 text-sm w-48"
                />
              </div>
            )}

            {/* Page size selector */}
            {!error && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500 dark:text-gray-400">Rows:</span>
                <select
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  className="text-sm"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Export CSV button */}
            {!error && data.length > 0 && (
              <button
                onClick={handleExportCSV}
                className="normal-button p-1.5 flex items-center gap-1.5 text-sm"
                title="Export current page to CSV"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                CSV
              </button>
            )}

            {/* Minimize button */}
            <button
              type="button"
              aria-label="Minimize query results"
              aria-controls="query-results-panel"
              onClick={() => onExpandedChange(false)}
              className="normal-button p-1"
              title="Minimize panel"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20 12H4"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Stats bar - collapsible */}
        {showStats && Object.keys(columnStats).length > 0 && (
          <div className="shrink-0 px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700/50">
            <div className="flex flex-wrap gap-4 text-xs">
              {Object.entries(columnStats).map(([colName, stats]) => (
                <div
                  key={colName}
                  className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg px-2.5 py-1.5 border border-gray-200 dark:border-gray-700"
                >
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {colName}
                  </span>
                  <span className="text-gray-400">|</span>
                  <span className="text-blue-600 dark:text-blue-400">
                    min: <span className="font-mono">{stats.min ?? "N/A"}</span>
                  </span>
                  <span className="text-green-600 dark:text-green-400">
                    max: <span className="font-mono">{stats.max ?? "N/A"}</span>
                  </span>
                  <span className="text-purple-600 dark:text-purple-400">
                    avg: <span className="font-mono">{stats.avg ?? "N/A"}</span>
                  </span>
                  {stats.nulls > 0 && (
                    <span className="text-orange-600 dark:text-orange-400">
                      nulls: <span className="font-mono">{stats.nulls}</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content with mask gradient at bottom only */}
        <div className="flex-1 overflow-auto mask-gradient-bottom px-4 mt-4 -mb-2 pb-6">
          {showLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10 backdrop-blur-sm">
              <div className="flex items-center gap-3 text-gray-500">
                <svg
                  className="w-6 h-6 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>
                  {isLoading ? "Executing query..." : "Loading page..."}
                </span>
              </div>
            </div>
          )}

          {error ? (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-red-800 dark:text-red-300">
                    Query Failed
                  </h4>
                  <pre className="mt-2 text-sm text-red-700 dark:text-red-400 whitespace-pre-wrap break-words font-mono bg-red-100 dark:bg-red-900/30 p-2 rounded overflow-auto max-h-40">
                    {error}
                  </pre>
                </div>
              </div>
            </div>
          ) : data.length === 0 && !showLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              No results returned
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column}
                      className="px-4 py-2 text-left font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors whitespace-nowrap select-none"
                      onClick={() => handleSort(column)}
                    >
                      <div className="flex items-center gap-1">
                        {column}
                        {sortColumn === column && (
                          <svg
                            className={`w-4 h-4 transition-transform ${
                              sortDirection === "DESC" ? "rotate-180" : ""
                            }`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 15l7-7 7 7"
                            />
                          </svg>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, idx) => (
                  <tr
                    key={idx}
                    className={`border-b border-gray-200 dark:border-gray-700/50 ${
                      idx % 2 === 0
                        ? "bg-transparent"
                        : "bg-gray-50/50 dark:bg-gray-800/30"
                    } hover:bg-gray-100/50 dark:hover:bg-gray-700/30 transition-colors`}
                  >
                    {columns.map((column) => {
                      const cellId = `${idx}-${column}`;
                      const isCopied = copiedCell === cellId;
                      return (
                        <td
                          key={column}
                          className="px-4 py-2 text-gray-900 dark:text-gray-100 whitespace-nowrap cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors relative group"
                          onClick={() => handleCopyCell(row[column], cellId)}
                          title="Click to copy"
                        >
                          <span
                            className={
                              row[column] === null || row[column] === undefined
                                ? "text-gray-400 italic"
                                : ""
                            }
                          >
                            {formatValue(row[column])}
                          </span>
                          {isCopied && (
                            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50 px-1.5 py-0.5 rounded">
                              Copied!
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Footer - no border, just spacing */}
        {!error && totalRows > 0 && (
          <div className="shrink-0 flex items-center justify-between px-4 py-3">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Showing {(page - 1) * pageSize + 1} -{" "}
              {Math.min(page * pageSize, totalRows)} of{" "}
              {totalRows.toLocaleString()}
            </div>

            <div className="flex items-center gap-2">
              {/* First page */}
              <button
                onClick={() => handlePageChange(1)}
                disabled={page === 1 || showLoading}
                className="normal-button p-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                  />
                </svg>
              </button>

              {/* Previous page */}
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1 || showLoading}
                className="normal-button p-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>

              {/* Page indicator */}
              <span className="px-3 py-1 text-sm">
                Page {page} of {totalPages}
              </span>

              {/* Next page */}
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page === totalPages || showLoading}
                className="normal-button p-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>

              {/* Last page */}
              <button
                onClick={() => handlePageChange(totalPages)}
                disabled={page === totalPages || showLoading}
                className="normal-button p-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 5l7 7-7 7M5 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default QueryResultsPanel;
