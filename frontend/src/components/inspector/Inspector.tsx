/**
 * @fileoverview Inspector panel component for node configuration.
 *
 * Provides a resizable side panel for editing operation parameters:
 * - Column selection and renaming
 * - Filter condition builder
 * - Join condition configuration
 * - Aggregation builder
 * - Database adapter selection
 *
 * Features auto-updating column references when upstream columns are renamed.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  OperationDefinition,
  OperationParam,
} from "../../definitions/operations";
import type { ColumnDefinition } from "../../definitions/columnPropagation";
import {
  DBT_ADAPTERS,
  ENABLED_DBT_ADAPTER_IDS,
} from "../../definitions/dbtAdapters";
import type { DatabaseCredentials } from "../../services/api";
import FilterBuilder, { type FilterGroup } from "../ui/FilterBuilder";
import AggregationsBuilder, {
  type Aggregation,
} from "../ui/AggregationsBuilder";
import SourceTableSelector, {
  type SourceTableColumn,
} from "./SourceTableSelector";

type InspectorNode = {
  id: string;
  operation: OperationDefinition;
  params?: Record<string, unknown>;
};

interface InspectorProps {
  node: InspectorNode | null;
  onSave: (nodeId: string, params: Record<string, unknown>) => void;
  onClearSelection: () => void;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
  availableColumns: ColumnDefinition[];
  sourceCredentials: DatabaseCredentials | null;
  onLayoutChange?: (isOpen: boolean, width: number) => void;
}

function getDefaultValue(param: OperationParam) {
  if (param.type === "boolean") return false;
  if (param.type === "number") return "";
  if (param.type === "select") return param.options?.[0] ?? "";
  if (param.type === "column-definition") return [];
  if (param.type === "column-rename") return [];
  if (param.type === "filter-condition")
    return { column: "", operator: "=", value: "" };
  if (param.type === "filter-builder")
    return {
      id: "root",
      type: "group",
      operators: [],
      children: [
        {
          id: `node-${Date.now()}-0`,
          type: "condition",
          column: "",
          operator: "",
          value: "",
        },
      ],
    };
  if (param.type === "join-condition")
    return { leftColumn: "", operator: "=", rightColumn: "" };
  return "";
}

const ParamTooltip = ({ content }: { content: React.ReactNode }) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  return (
    <>
      <button
        className="normal-button flex w-5 h-5 p-1 justify-center items-center cursor-help"
        onMouseEnter={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setPosition({
            top: rect.top,
            left: rect.left - 300,
          });
          setVisible(true);
        }}
        onMouseLeave={() => setVisible(false)}
      >
        ?
      </button>
      {visible &&
        createPortal(
          <div
            className="tooltip-content"
            style={{
              top: position.top,
              left: position.left,
              transform: "translateY(-100%) translateY(-10px)",
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
};

function Inspector({
  node,
  onSave,
  onClearSelection,
  onClose,
  onDelete,
  availableColumns,
  sourceCredentials,
  onLayoutChange,
}: InspectorProps) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [renderedNode, setRenderedNode] = useState<InspectorNode | null>(null);
  const [stage, setStage] = useState<"hidden" | "enter" | "exit">("hidden");
  const [joinColumnTarget, setJoinColumnTarget] = useState<"left" | "right">(
    "left"
  );
  const [width, setWidth] = useState(280); // w-70 = 280px
  const [isResizing, setIsResizing] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    onLayoutChange?.(node !== null, width);
  }, [node, width, onLayoutChange]);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const syncScrollbarWidth = () => {
      const nextScrollbarWidth = `${
        scrollContainer.offsetWidth - scrollContainer.clientWidth
      }px`;

      if (
        scrollContainer.style.getPropertyValue(
          "--inspector-scrollbar-width"
        ) === nextScrollbarWidth
      ) {
        return;
      }

      scrollContainer.style.setProperty(
        "--inspector-scrollbar-width",
        nextScrollbarWidth
      );
    };

    syncScrollbarWidth();
    window.addEventListener("resize", syncScrollbarWidth);

    return () => window.removeEventListener("resize", syncScrollbarWidth);
  }, [renderedNode?.id]);

  // Handle resizing
  useEffect(() => {
    if (!isResizing) return;

    // Prevent text selection and fix cursor during resize
    document.body.classList.add("resizing");
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX - 16; // 16px for right margin
      setWidth(Math.max(280, Math.min(newWidth, 800))); // min 280px, max 800px
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      // Restore default styles
      document.body.classList.remove("resizing");
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  useEffect(() => {
    let timeout: number | undefined;
    if (node) {
      setTimeout(() => {
        setRenderedNode(node);
        // Wait for render then animate
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setStage("enter");
          });
        });
      }, 0);
    } else if (renderedNode) {
      setTimeout(() => setStage("exit"), 0);
      timeout = window.setTimeout(() => {
        setRenderedNode(null);
        setFormValues({});
        setStage("hidden");
      }, 200);
    }
    return () => {
      if (timeout) window.clearTimeout(timeout);
    };
  }, [node, renderedNode]);

  useEffect(() => {
    if (!renderedNode) return;
    const initialValues = renderedNode.operation.params.reduce<
      Record<string, unknown>
    >((acc, param) => {
      const currentValue = renderedNode.params?.[param.name];
      acc[param.name] =
        currentValue !== undefined ? currentValue : getDefaultValue(param);
      return acc;
    }, {});
    setTimeout(() => setFormValues(initialValues), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedNode?.id]);

  // Auto-update column references when columns are renamed
  const [invalidColumnsDetected, setInvalidColumnsDetected] = useState(false);
  const [previousAvailableColumns, setPreviousAvailableColumns] = useState<
    ColumnDefinition[]
  >([]);

  useEffect(() => {
    if (!renderedNode) return;

    const availableColumnNames = availableColumns.map((col) => col.name);
    const previousColumnNames = previousAvailableColumns.map((col) => col.name);

    // Detect column renames by finding what disappeared and what appeared
    const disappearedColumns = previousColumnNames.filter(
      (name) => !availableColumnNames.includes(name)
    );
    const appearedColumns = availableColumnNames.filter(
      (name) => !previousColumnNames.includes(name)
    );

    // Create a rename mapping (old name -> new name)
    const renameMap = new Map<string, string>();

    // Simple heuristic: if same number of columns disappeared and appeared, map them in order
    // This works for single renames and when changing aliases
    if (
      disappearedColumns.length > 0 &&
      disappearedColumns.length === appearedColumns.length
    ) {
      disappearedColumns.forEach((oldName, index) => {
        renameMap.set(oldName, appearedColumns[index]);
      });
    }

    let hasChanges = false;
    const updatedValues = { ...formValues };

    // Helper function to rename a column reference
    const renameColumn = (colName: string): string => {
      return renameMap.get(colName) || colName;
    };

    renderedNode.operation.params.forEach((param) => {
      const currentValue = formValues[param.name];

      // Update column-list (Group By, etc.)
      if (param.type === "column-list" && typeof currentValue === "string") {
        const selectedCols = currentValue
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean);
        const renamedCols = selectedCols.map(renameColumn);
        const validCols = renamedCols.filter((col) =>
          availableColumnNames.includes(col)
        );

        const newValue = validCols.join(", ");
        if (newValue !== currentValue) {
          updatedValues[param.name] = newValue;
          hasChanges = true;
        }
      }

      // Update column-select (Sort)
      if (param.type === "column-select" && typeof currentValue === "string") {
        if (currentValue) {
          const renamedCol = renameColumn(currentValue);
          if (renamedCol !== currentValue) {
            updatedValues[param.name] = availableColumnNames.includes(
              renamedCol
            )
              ? renamedCol
              : "";
            hasChanges = true;
          } else if (!availableColumnNames.includes(currentValue)) {
            updatedValues[param.name] = "";
            hasChanges = true;
          }
        }
      }

      // Update filter-condition
      if (
        param.type === "filter-condition" &&
        currentValue &&
        typeof currentValue === "object"
      ) {
        const filterValue = currentValue as {
          column: string;
          operator: string;
          value: string;
        };
        if (filterValue.column) {
          const renamedCol = renameColumn(filterValue.column);
          if (renamedCol !== filterValue.column) {
            updatedValues[param.name] = {
              ...filterValue,
              column: availableColumnNames.includes(renamedCol)
                ? renamedCol
                : "",
            };
            hasChanges = true;
          } else if (!availableColumnNames.includes(filterValue.column)) {
            updatedValues[param.name] = { ...filterValue, column: "" };
            hasChanges = true;
          }
        }
      }

      // Update join-condition
      if (
        param.type === "join-condition" &&
        currentValue &&
        typeof currentValue === "object"
      ) {
        const joinValue = currentValue as {
          leftColumn: string;
          operator: string;
          rightColumn: string;
        };
        let leftCol = joinValue.leftColumn;
        let rightCol = joinValue.rightColumn;
        let changed = false;

        if (leftCol) {
          const renamedLeft = renameColumn(leftCol);
          if (renamedLeft !== leftCol) {
            leftCol = availableColumnNames.includes(renamedLeft)
              ? renamedLeft
              : "";
            changed = true;
          } else if (!availableColumnNames.includes(leftCol)) {
            leftCol = "";
            changed = true;
          }
        }

        if (rightCol) {
          const renamedRight = renameColumn(rightCol);
          if (renamedRight !== rightCol) {
            rightCol = availableColumnNames.includes(renamedRight)
              ? renamedRight
              : "";
            changed = true;
          } else if (!availableColumnNames.includes(rightCol)) {
            rightCol = "";
            changed = true;
          }
        }

        if (changed) {
          updatedValues[param.name] = {
            leftColumn: leftCol,
            operator: joinValue.operator,
            rightColumn: rightCol,
          };
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      setTimeout(() => setFormValues(updatedValues), 0);
      setTimeout(() => setInvalidColumnsDetected(true), 0);
      // Clear the warning after 5 seconds
      setTimeout(() => setInvalidColumnsDetected(false), 5000);
    }

    // Update previous columns for next iteration
    setTimeout(() => setPreviousAvailableColumns(availableColumns), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableColumns, renderedNode]);

  const paramFields = useMemo(
    () => renderedNode?.operation.params ?? [],
    [renderedNode]
  );

  const handleChange = (
    param: OperationParam,
    value:
      | string
      | boolean
      | number
      | string[]
      | Array<{ name: string; type: string }>
      | Array<{ original: string; alias?: string }>
      | { column: string; operator: string; value: string }
      | { leftColumn: string; operator: string; rightColumn: string }
      | FilterGroup
      | Aggregation[]
      | Record<string, unknown>
  ) => {
    setFormValues((prev) => ({
      ...prev,
      [param.name]: value,
    }));
  };

  const handleSourceTableChange = useCallback((tableName: string) => {
    setFormValues((previous) => ({ ...previous, table: tableName }));
  }, []);

  const handleSourceColumnsChange = useCallback(
    (columns: SourceTableColumn[]) => {
      setFormValues((previous) => ({ ...previous, columns }));
    },
    []
  );

  const handleSave = () => {
    if (!renderedNode) return;
    if (renderedNode.operation.id === "source-table") {
      const tableName = String(formValues.table || "").trim();
      const columns = formValues.columns;
      if (!tableName || !Array.isArray(columns) || columns.length === 0) return;
    }
    onSave(renderedNode.id, formValues);
    onClearSelection();
  };

  if (!renderedNode && stage === "hidden") {
    return null;
  }

  const enterEase = "cubic-bezier(0.22,1,0.36,1)";
  const exitEase = "cubic-bezier(0.5,0.05,0.8,0.25)";

  const panelStyle = {
    transform:
      stage === "enter"
        ? "translateX(0)"
        : stage === "exit"
        ? "translateX(120%)"
        : "translateX(120%)",
    opacity: stage === "enter" ? 1 : 0,
    // ⚡ PERFORMANCE: Reduced animation duration for snappier feel
    // Before: 420ms enter, 200ms exit → Felt sluggish
    // After: 200ms enter, 150ms exit → Feels instant
    transition:
      stage === "exit"
        ? `transform 150ms ${exitEase}, opacity 150ms ${exitEase}` // was 200ms
        : `transform 200ms ${enterEase}, opacity 200ms ${enterEase}`, // was 420ms
    pointerEvents: stage === "enter" ? "auto" : "none",
  } as const;

  return (
    <div
      className="panel fixed right-4 top-19 z-50 h-[calc(100%-var(--spacing)*27)] flex flex-col"
      style={{ ...panelStyle, width: `${width}px` }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-50"
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
        }}
      />
      {!renderedNode ? (
        <div className="text-sm text-gray-500">
          Select a node and click on <strong>Configure</strong> to change its
          parameters.
        </div>
      ) : (
        <>
          <div className="shrink-0 flex justify-between items-center px-4 pt-4">
            <p className="pb-2 border-b text-xs font-bold uppercase tracking-[0.2em] border-gray-400 dark:border-gray-700 text-gray-500 dark:text-gray-400">
              Parameters
            </p>
            <button onClick={onClose} className="normal-button p-1">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div
            ref={scrollContainerRef}
            className="inspector-scroll overflow-y-auto flex-1 mask-gradient-both px-4 pb-6 -mb-2"
          >
            <div className="pt-4 pb-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">
                  {renderedNode.operation.label}
                </h2>
                <p className="text-sm text-gray-500">
                  {renderedNode.operation.description}
                </p>
              </div>

              {/* Global warning for invalid columns */}
              {invalidColumnsDetected && (
                <div className="inspector-callout border-yellow-400 text-sm text-yellow-700 dark:border-yellow-600 dark:text-yellow-400">
                  ⚠️ Some column references were removed because they no longer
                  exist in the source
                </div>
              )}

              {/* Available columns from upstream nodes */}
              {availableColumns.length > 0 && (
                <div
                  className={`border-l-2 border-l-green-500 pl-3 ${
                    renderedNode.operation.id === "dbt-model"
                      ? "py-2"
                      : "inspector-section"
                  }`}
                >
                  <h3 className="text-sm font-semibold text-green-900 dark:text-green-200 mb-2 flex items-center gap-2">
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
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    Available Columns ({availableColumns.length})
                  </h3>
                  <p className="text-xs text-green-700 dark:text-green-400 mb-3">
                    Click to select columns for parameters below
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {availableColumns.map((col, idx) => {
                      // Find various column parameter types
                      const columnSelectorParam = paramFields.find(
                        (p) => p.type === "column-selector"
                      );
                      const columnListParam = paramFields.find(
                        (p) => p.type === "column-list"
                      );
                      const columnSelectParam = paramFields.find(
                        (p) => p.type === "column-select"
                      );
                      const columnRenameParam = paramFields.find(
                        (p) => p.type === "column-rename"
                      );
                      const filterConditionParam = paramFields.find(
                        (p) => p.type === "filter-condition"
                      );
                      const joinConditionParam = paramFields.find(
                        (p) => p.type === "join-condition"
                      );

                      // Determine which parameter to use (priority order)
                      const targetParam =
                        columnSelectorParam ||
                        columnSelectParam ||
                        filterConditionParam ||
                        columnRenameParam ||
                        columnListParam ||
                        joinConditionParam;

                      // Check if this column is selected
                      let isSelected = false;
                      if (targetParam) {
                        if (targetParam.type === "column-selector") {
                          const selectorValue = formValues[
                            targetParam.name
                          ] as string[];
                          isSelected = (selectorValue || []).includes(col.name);
                        } else if (targetParam.type === "column-select") {
                          isSelected =
                            formValues[targetParam.name] === col.name;
                        } else if (targetParam.type === "filter-condition") {
                          isSelected =
                            (
                              formValues[targetParam.name] as {
                                column: string;
                                operator: string;
                                value: string;
                              }
                            )?.column === col.name;
                        } else if (targetParam.type === "column-rename") {
                          const renameValue = formValues[
                            targetParam.name
                          ] as Array<{
                            original: string;
                            alias?: string;
                          }>;
                          isSelected = (renameValue || []).some(
                            (item) => item.original === col.name
                          );
                        } else if (targetParam.type === "join-condition") {
                          const joinValue = formValues[targetParam.name] as {
                            leftColumn: string;
                            operator: string;
                            rightColumn: string;
                          };
                          // Only highlight if it's in the currently active field
                          isSelected =
                            joinColumnTarget === "left"
                              ? joinValue?.leftColumn === col.name
                              : joinValue?.rightColumn === col.name;
                        } else if (targetParam.type === "column-list") {
                          isSelected = (
                            (formValues[targetParam.name] as string) || ""
                          )
                            .split(",")
                            .map((c) => c.trim())
                            .filter(Boolean)
                            .includes(col.name);
                        }
                      }

                      return (
                        <button
                          key={idx}
                          type="button"
                          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${
                            isSelected
                              ? "bg-green-600 dark:bg-green-700 border-green-600 dark:border-green-700"
                              : "bg-white dark:bg-gray-800 border-green-200 dark:border-green-700 hover:bg-green-100 dark:hover:bg-green-900/40"
                          }`}
                          onClick={() => {
                            if (!targetParam) return;

                            if (targetParam.type === "column-selector") {
                              // Multi selection array: toggle
                              const currentValue =
                                (formValues[targetParam.name] as string[]) ||
                                [];

                              let newValue: string[];
                              if (currentValue.includes(col.name)) {
                                // Remove column
                                newValue = currentValue.filter(
                                  (c) => c !== col.name
                                );
                              } else {
                                // Add column
                                newValue = [...currentValue, col.name];
                              }

                              handleChange(targetParam, newValue);
                            } else if (targetParam.type === "column-select") {
                              // Single selection: just set the value
                              handleChange(targetParam, col.name);
                            } else if (
                              targetParam.type === "filter-condition"
                            ) {
                              const currentFilter = (formValues[
                                targetParam.name
                              ] as {
                                column: string;
                                operator: string;
                                value: string;
                              }) || { column: "", operator: "=", value: "" };
                              handleChange(targetParam, {
                                ...currentFilter,
                                column: col.name,
                              });
                            } else if (targetParam.type === "column-rename") {
                              // Toggle column in rename list
                              const currentValue =
                                (formValues[targetParam.name] as Array<{
                                  original: string;
                                  alias?: string;
                                }>) || [];

                              const exists = currentValue.some(
                                (item) => item.original === col.name
                              );

                              let newValue;
                              if (exists) {
                                // Remove column
                                newValue = currentValue.filter(
                                  (item) => item.original !== col.name
                                );
                              } else {
                                // Add column with empty alias
                                newValue = [
                                  ...currentValue,
                                  { original: col.name, alias: "" },
                                ];
                              }

                              handleChange(targetParam, newValue);
                            } else if (targetParam.type === "join-condition") {
                              // For join, update the active column (left or right)
                              const currentJoin = (formValues[
                                targetParam.name
                              ] as {
                                leftColumn: string;
                                operator: string;
                                rightColumn: string;
                              }) || {
                                leftColumn: "",
                                operator: "=",
                                rightColumn: "",
                              };

                              handleChange(targetParam, {
                                ...currentJoin,
                                [joinColumnTarget === "left"
                                  ? "leftColumn"
                                  : "rightColumn"]: col.name,
                              });
                            } else if (targetParam.type === "column-list") {
                              // Multi selection: toggle
                              const currentValue =
                                (formValues[targetParam.name] as string) || "";
                              const currentColumns = currentValue
                                .split(",")
                                .map((c) => c.trim())
                                .filter(Boolean);

                              let newColumns: string[];
                              if (currentColumns.includes(col.name)) {
                                // Remove column
                                newColumns = currentColumns.filter(
                                  (c) => c !== col.name
                                );
                              } else {
                                // Add column
                                newColumns = [...currentColumns, col.name];
                              }

                              handleChange(targetParam, newColumns.join(", "));
                            }
                          }}
                        >
                          <span
                            className={`text-xs font-medium ${
                              isSelected
                                ? "text-white"
                                : "text-gray-900 dark:text-white"
                            }`}
                          >
                            {col.name}
                          </span>
                          <span
                            className={`text-xs font-mono ${
                              isSelected
                                ? "text-green-100"
                                : "text-green-700 dark:text-green-400"
                            }`}
                          >
                            {col.type}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {renderedNode.operation.id === "source-table" && (
                  <SourceTableSelector
                    key={renderedNode.id}
                    credentials={sourceCredentials}
                    tableName={String(formValues.table || "")}
                    selectedColumns={
                      Array.isArray(formValues.columns)
                        ? (formValues.columns as SourceTableColumn[])
                        : []
                    }
                    onTableChange={handleSourceTableChange}
                    onColumnsChange={handleSourceColumnsChange}
                  />
                )}
                {paramFields
                  .filter(
                    (param) =>
                      param.type !== "column-selector" &&
                      !(
                        renderedNode.operation.id === "source-table" &&
                        (param.name === "table" || param.name === "columns")
                      )
                  )
                  .map((param) => (
                    <label
                      key={param.name}
                      className="flex flex-col gap-2 text-sm"
                    >
                      <span className="font-semibold flex items-center gap-2">
                        <span>
                          {param.label}
                          {param.required && (
                            <span className="ml-1 text-orange-600">*</span>
                          )}
                        </span>
                        {/* Generic tooltip for any parameter */}
                        {param.tooltip && (
                          <ParamTooltip content={param.tooltip} />
                        )}
                        {/* Join Type tooltip */}
                        {renderedNode?.operation.id === "join" &&
                          param.name === "type" && (
                            <ParamTooltip
                              content={
                                <div className="space-y-2 text-xs">
                                  <div>
                                    <span className="font-semibold text-gray-900 dark:text-white">
                                      INNER:
                                    </span>
                                    <span className="text-gray-600 dark:text-gray-400">
                                      {" "}
                                      Returns only rows that match in both
                                      tables
                                    </span>
                                  </div>
                                  <div>
                                    <span className="font-semibold text-gray-900 dark:text-white">
                                      LEFT:
                                    </span>
                                    <span className="text-gray-600 dark:text-gray-400">
                                      {" "}
                                      Returns all rows from left table + matches
                                      from right
                                    </span>
                                  </div>
                                  <div>
                                    <span className="font-semibold text-gray-900 dark:text-white">
                                      RIGHT:
                                    </span>
                                    <span className="text-gray-600 dark:text-gray-400">
                                      {" "}
                                      Returns all rows from right table +
                                      matches from left
                                    </span>
                                  </div>
                                  <div>
                                    <span className="font-semibold text-gray-900 dark:text-white">
                                      FULL:
                                    </span>
                                    <span className="text-gray-600 dark:text-gray-400">
                                      {" "}
                                      Returns all rows from both tables
                                    </span>
                                  </div>
                                </div>
                              }
                            />
                          )}

                        {/* Materialization tooltip */}
                        {renderedNode?.operation.id === "dbt-model" &&
                          param.name === "materialized" && (
                            <ParamTooltip
                              content={
                                <div className="space-y-2 text-xs">
                                  <div>
                                    <span className="font-semibold">View:</span>
                                    <span className="text-gray-600 dark:text-gray-400">
                                      {" "}
                                      Virtual table, computed on every query.
                                      Good for lightweight transformations.
                                    </span>
                                  </div>
                                  <div>
                                    <span className="font-semibold">
                                      Table:
                                    </span>
                                    <span className="text-gray-600 dark:text-gray-400">
                                      {" "}
                                      Physical table, recomputed entirely on
                                      each run. Good for heavy transformations.
                                    </span>
                                  </div>
                                  <div>
                                    <span className="font-semibold">
                                      Incremental:
                                    </span>
                                    <span className="text-gray-600 dark:text-gray-400">
                                      {" "}
                                      Only computes new/changed rows. Best for
                                      very large datasets.
                                    </span>
                                  </div>
                                </div>
                              }
                            />
                          )}

                        {/* Sort Direction tooltip */}
                        {renderedNode?.operation.id === "sort" &&
                          param.name === "direction" && (
                            <ParamTooltip
                              content={
                                <div className="space-y-2 text-xs">
                                  <div>
                                    <span className="font-semibold text-gray-900 dark:text-white">
                                      ASC:
                                    </span>
                                    <span className="text-gray-600 dark:text-gray-400">
                                      {" "}
                                      Ascending order (A to Z, 0 to 9).
                                    </span>
                                  </div>
                                  <div>
                                    <span className="font-semibold text-gray-900 dark:text-white">
                                      DESC:
                                    </span>
                                    <span className="text-gray-600 dark:text-gray-400">
                                      {" "}
                                      Descending order (Z to A, 9 to 0).
                                    </span>
                                  </div>
                                </div>
                              }
                            />
                          )}

                        {/* Group By Aggregations tooltip */}
                        {renderedNode?.operation.id === "group-by" &&
                          param.name === "aggregations" && (
                            <ParamTooltip
                              content={
                                <div className="space-y-2 text-xs">
                                  <p className="text-gray-600 dark:text-gray-400">
                                    Enter SQL aggregation functions separated by
                                    commas.
                                  </p>
                                  <div>
                                    <span className="font-semibold text-gray-900 dark:text-white">
                                      Examples:
                                    </span>
                                    <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 mt-1">
                                      <li>count(*)</li>
                                      <li>sum(price)</li>
                                      <li>avg(amount) as avg_amount</li>
                                      <li>max(created_at)</li>
                                    </ul>
                                  </div>
                                </div>
                              }
                            />
                          )}
                      </span>
                      {param.type === "column-definition" ? (
                        <div className="space-y-3">
                          {(
                            (formValues[param.name] as Array<{
                              name: string;
                              type: string;
                              alias?: string;
                            }>) || []
                          ).map((column, index) => (
                            <div
                              key={index}
                              className="inspector-repeat-row flex items-start gap-2"
                            >
                              <div className="flex-1 space-y-2">
                                <input
                                  type="text"
                                  placeholder="Column name"
                                  value={column.name}
                                  onChange={(event) => {
                                    const newColumns = [
                                      ...(formValues[param.name] as Array<{
                                        name: string;
                                        type: string;
                                        alias?: string;
                                      }>),
                                    ];
                                    newColumns[index] = {
                                      ...newColumns[index],
                                      name: event.target.value,
                                    };
                                    handleChange(param, newColumns);
                                  }}
                                />
                                <input
                                  type="text"
                                  placeholder="Alias (optional)"
                                  value={column.alias || ""}
                                  onChange={(event) => {
                                    const newColumns = [
                                      ...(formValues[param.name] as Array<{
                                        name: string;
                                        type: string;
                                        alias?: string;
                                      }>),
                                    ];
                                    newColumns[index] = {
                                      ...newColumns[index],
                                      alias: event.target.value,
                                    };
                                    handleChange(param, newColumns);
                                  }}
                                />
                                <select
                                  value={column.type}
                                  onChange={(event) => {
                                    const newColumns = [
                                      ...(formValues[param.name] as Array<{
                                        name: string;
                                        type: string;
                                        alias?: string;
                                      }>),
                                    ];
                                    newColumns[index] = {
                                      ...newColumns[index],
                                      type: event.target.value,
                                    };
                                    handleChange(param, newColumns);
                                  }}
                                >
                                  <option value="VARCHAR">VARCHAR</option>
                                  <option value="INTEGER">INTEGER</option>
                                  <option value="FLOAT">FLOAT</option>
                                  <option value="BOOLEAN">BOOLEAN</option>
                                  <option value="DATE">DATE</option>
                                  <option value="TIMESTAMP">TIMESTAMP</option>
                                </select>
                              </div>
                              <button
                                type="button"
                                className="delete-button w-6 h-6 flex justify-center items-center"
                                onClick={() => {
                                  const newColumns = (
                                    formValues[param.name] as Array<{
                                      name: string;
                                      type: string;
                                      alias?: string;
                                    }>
                                  ).filter((_, i) => i !== index);
                                  handleChange(param, newColumns);
                                }}
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
                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                  />
                                </svg>
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="w-full rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 px-4 py-3 text-sm text-gray-600 dark:text-gray-400 hover:border-orange-400 hover:text-orange-600 dark:hover:text-orange-400 transition-all"
                            onClick={() => {
                              const currentColumns =
                                (formValues[param.name] as Array<{
                                  name: string;
                                  type: string;
                                  alias?: string;
                                }>) || [];
                              handleChange(param, [
                                ...currentColumns,
                                { name: "", type: "VARCHAR" },
                              ]);
                            }}
                          >
                            + Add Column
                          </button>
                        </div>
                      ) : param.type === "column-rename" ? (
                        <div className="space-y-2">
                          {(() => {
                            const currentColumns =
                              (formValues[param.name] as Array<{
                                original: string;
                                alias?: string;
                              }>) || [];

                            // Filter out columns that no longer exist in availableColumns
                            const validColumns = currentColumns.filter((col) =>
                              availableColumns.some(
                                (availCol) => availCol.name === col.original
                              )
                            );

                            // Auto-cleanup invalid columns
                            const hasInvalidColumns =
                              validColumns.length !== currentColumns.length;
                            if (hasInvalidColumns) {
                              // Update the form values to remove invalid columns
                              setTimeout(
                                () => handleChange(param, validColumns),
                                0
                              );
                            }

                            return (
                              <>
                                {hasInvalidColumns && (
                                  <div className="inspector-callout border-yellow-400 text-xs text-yellow-700 dark:border-yellow-600 dark:text-yellow-400">
                                    ⚠️ Some columns were removed because they no
                                    longer exist in the source
                                  </div>
                                )}
                                {validColumns.map((col, index) => (
                                  <div
                                    key={index}
                                    className="inspector-repeat-row flex items-start gap-2"
                                  >
                                    <div className="flex-1 space-y-2">
                                      <div>
                                        <label className="text-xs text-gray-600 dark:text-gray-400 mb-1 block">
                                          Column
                                        </label>
                                        <input
                                          type="text"
                                          value={col.original}
                                          readOnly
                                        />
                                      </div>
                                      <div>
                                        <label className="text-xs text-gray-600 dark:text-gray-400 mb-1 block">
                                          Alias (optional)
                                        </label>
                                        <input
                                          type="text"
                                          placeholder="Leave empty to use original name"
                                          value={col.alias || ""}
                                          onChange={(event) => {
                                            const newColumns = [
                                              ...validColumns,
                                            ];
                                            newColumns[index] = {
                                              ...newColumns[index],
                                              alias: event.target.value,
                                            };
                                            handleChange(param, newColumns);
                                          }}
                                        />
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      className="delete-button p-1"
                                      onClick={() => {
                                        const newColumns = validColumns.filter(
                                          (_, i) => i !== index
                                        );
                                        handleChange(param, newColumns);
                                      }}
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
                                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                        />
                                      </svg>
                                    </button>
                                  </div>
                                ))}
                              </>
                            );
                          })()}
                          {(
                            (formValues[param.name] as Array<{
                              original: string;
                              alias?: string;
                            }>) || []
                          ).length === 0 && (
                            <div className="text-center py-3 text-sm text-gray-500 dark:text-gray-400">
                              Click columns above to select them
                            </div>
                          )}
                        </div>
                      ) : param.type === "filter-condition" ? (
                        <div className="space-y-2">
                          {/* Column display (read-only) */}
                          <div>
                            <label className="text-xs text-gray-600 dark:text-gray-400 mb-1 block">
                              Column
                            </label>
                            <input
                              type="text"
                              placeholder="Click a column above to select"
                              value={
                                (
                                  formValues[param.name] as {
                                    column: string;
                                    operator: string;
                                    value: string;
                                  }
                                )?.column || ""
                              }
                              readOnly
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            {/* Operator selector */}
                            <div>
                              <label className="text-xs text-gray-600 dark:text-gray-400 mb-1 block">
                                Operator
                              </label>
                              <select
                                value={
                                  (
                                    formValues[param.name] as {
                                      column: string;
                                      operator: string;
                                      value: string;
                                    }
                                  )?.operator || "="
                                }
                                onChange={(event) => {
                                  const currentFilter = (formValues[
                                    param.name
                                  ] as {
                                    column: string;
                                    operator: string;
                                    value: string;
                                  }) || {
                                    column: "",
                                    operator: "=",
                                    value: "",
                                  };
                                  handleChange(param, {
                                    ...currentFilter,
                                    operator: event.target.value,
                                  });
                                }}
                              >
                                <option value="=">=</option>
                                <option value="!=">!=</option>
                                <option value="<">&lt;</option>
                                <option value=">">&gt;</option>
                                <option value="<=">&lt;=</option>
                                <option value=">=">&gt;=</option>
                                <option value="LIKE">LIKE</option>
                                <option value="NOT LIKE">NOT LIKE</option>
                                <option value="IN">IN</option>
                                <option value="NOT IN">NOT IN</option>
                                <option value="IS NULL">IS NULL</option>
                                <option value="IS NOT NULL">IS NOT NULL</option>
                                <option value="BETWEEN">BETWEEN</option>
                              </select>
                            </div>

                            {/* Value input */}
                            <div>
                              <label className="text-xs text-gray-600 dark:text-gray-400 mb-1 block">
                                Value
                              </label>
                              <input
                                type="text"
                                placeholder="Enter value"
                                value={
                                  (
                                    formValues[param.name] as {
                                      column: string;
                                      operator: string;
                                      value: string;
                                    }
                                  )?.value || ""
                                }
                                onChange={(event) => {
                                  const currentFilter = (formValues[
                                    param.name
                                  ] as {
                                    column: string;
                                    operator: string;
                                    value: string;
                                  }) || {
                                    column: "",
                                    operator: "=",
                                    value: "",
                                  };
                                  handleChange(param, {
                                    ...currentFilter,
                                    value: event.target.value,
                                  });
                                }}
                                disabled={
                                  (
                                    formValues[param.name] as {
                                      column: string;
                                      operator: string;
                                      value: string;
                                    }
                                  )?.operator === "IS NULL" ||
                                  (
                                    formValues[param.name] as {
                                      column: string;
                                      operator: string;
                                      value: string;
                                    }
                                  )?.operator === "IS NOT NULL"
                                }
                              />
                            </div>
                          </div>
                        </div>
                      ) : param.type === "filter-builder" ? (
                        <div className="space-y-2">
                          <FilterBuilder
                            value={
                              (formValues[param.name] as FilterGroup) || {
                                id: "root",
                                type: "group",
                                operators: [],
                                children: [
                                  {
                                    id: "node-default-0",
                                    type: "condition",
                                    column: "",
                                    operator: "",
                                    value: "",
                                  },
                                ],
                              }
                            }
                            onChange={(newFilter) =>
                              handleChange(param, newFilter)
                            }
                            availableColumns={availableColumns}
                          />
                        </div>
                      ) : param.type === "aggregations-builder" ? (
                        <div className="space-y-2">
                          <AggregationsBuilder
                            value={
                              (formValues[param.name] as Aggregation[]) || []
                            }
                            onChange={(newAggregations) =>
                              handleChange(param, newAggregations)
                            }
                            availableColumns={availableColumns}
                          />
                        </div>
                      ) : param.type === "join-condition" ? (
                        <div className="space-y-2">
                          {/* Column selection - click on field to select it */}
                          <div className="inspector-callout border-blue-400 text-blue-700 dark:border-blue-600 dark:text-blue-400">
                            <div className="text-xs text-blue-700 dark:text-blue-400 mb-2 font-medium">
                              Click on a field below to select it, then click a
                              column above:
                            </div>
                            <div className="space-y-2">
                              {/* First Column */}
                              <div>
                                <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                                  First Column
                                </div>
                                <input
                                  className={`w-full rounded-lg border-2 px-3 py-2 text-sm cursor-pointer transition-colors ${
                                    joinColumnTarget === "left"
                                      ? "border-orange-500 bg-orange-50 dark:bg-orange-900/20"
                                      : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hover:border-orange-300"
                                  }`}
                                  type="text"
                                  placeholder="Click here, then select a column above"
                                  value={
                                    (
                                      formValues[param.name] as {
                                        leftColumn: string;
                                        operator: string;
                                        rightColumn: string;
                                      }
                                    )?.leftColumn || ""
                                  }
                                  onClick={() => setJoinColumnTarget("left")}
                                  readOnly
                                />
                              </div>

                              {/* Second Column */}
                              <div>
                                <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                                  Second Column
                                </div>
                                <input
                                  className={`w-full rounded-lg border-2 px-3 py-2 text-sm cursor-pointer transition-colors ${
                                    joinColumnTarget === "right"
                                      ? "border-orange-500 bg-orange-50 dark:bg-orange-900/20"
                                      : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hover:border-orange-300"
                                  }`}
                                  type="text"
                                  placeholder="Click here, then select a column above"
                                  value={
                                    (
                                      formValues[param.name] as {
                                        leftColumn: string;
                                        operator: string;
                                        rightColumn: string;
                                      }
                                    )?.rightColumn || ""
                                  }
                                  onClick={() => setJoinColumnTarget("right")}
                                  readOnly
                                />
                              </div>
                            </div>
                          </div>

                          {/* Operator selector */}
                          <div>
                            <label className="text-xs text-gray-600 dark:text-gray-400 mb-1 block">
                              Operator
                            </label>
                            <select
                              value={
                                (
                                  formValues[param.name] as {
                                    leftColumn: string;
                                    operator: string;
                                    rightColumn: string;
                                  }
                                )?.operator || "="
                              }
                              onChange={(event) => {
                                const currentJoin = (formValues[param.name] as {
                                  leftColumn: string;
                                  operator: string;
                                  rightColumn: string;
                                }) || {
                                  leftColumn: "",
                                  operator: "=",
                                  rightColumn: "",
                                };
                                handleChange(param, {
                                  ...currentJoin,
                                  operator: event.target.value,
                                });
                              }}
                            >
                              <option value="=">=</option>
                              <option value="!=">!=</option>
                              <option value="<">&lt;</option>
                              <option value=">">&gt;</option>
                              <option value="<=">&lt;=</option>
                              <option value=">=">&gt;=</option>
                            </select>
                          </div>
                        </div>
                      ) : param.type === "column-select" ? (
                        <input
                          type="text"
                          placeholder={
                            availableColumns.length === 0
                              ? "No columns available (connect a parent node)"
                              : "Click a column above to select"
                          }
                          value={(formValues[param.name] as string) ?? ""}
                          readOnly
                        />
                      ) : param.type === "adapter-selector" ? (
                        <div className="space-y-4">
                          <select
                            value={
                              ((
                                formValues[param.name] as Record<
                                  string,
                                  unknown
                                >
                              )?.type as string) || ""
                            }
                            onChange={(e) => {
                              const adapter = DBT_ADAPTERS.find((candidate) => candidate.id === e.target.value);
                              const defaults = adapter?.id === "sqlserver" ? {
                                port: adapter.defaultPort,
                                schema: adapter.defaultSchema,
                                ...Object.fromEntries(adapter.params.filter((field) => field.defaultValue !== undefined)
                                  .map((field) => [field.name, field.defaultValue])),
                              } : {};
                              handleChange(param, { type: e.target.value, ...defaults });
                            }}
                          >
                            <option value="">Select a database type...</option>
                            {DBT_ADAPTERS.filter((adapter) =>
                              ENABLED_DBT_ADAPTER_IDS.has(adapter.id)
                            ).map((adapter) => (
                              <option key={adapter.id} value={adapter.id}>
                                {adapter.label}
                              </option>
                            ))}
                          </select>

                          {(() => {
                            const currentConfig =
                              (formValues[param.name] as Record<
                                string,
                                unknown
                              >) || {};
                            const selectedAdapter = DBT_ADAPTERS.find(
                              (a) => a.id === currentConfig.type
                            );

                            if (!selectedAdapter) return null;

                            return (
                              <div className="mt-1 space-y-3 border-l-2 border-gray-300 pl-3 dark:border-gray-700">
                                {selectedAdapter.id === "duckdb" && (
                                  <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Existing local file on the backend host. Opened read-only;
                                    schema defaults to main. External files and extensions are disabled.
                                  </p>
                                )}
                                {selectedAdapter.id === "sqlserver" && (
                                  <p className="text-xs text-gray-500 dark:text-gray-400">
                                    SQL authentication with a SELECT-only account. Requires Microsoft ODBC Driver
                                    on the backend host. TLS and certificate verification are enabled by default.
                                  </p>
                                )}
                                {selectedAdapter.params.map((field) => (
                                  <div key={field.name}>
                                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">
                                      {field.label}
                                      {field.required && (
                                        <span className="text-orange-600 ml-0.5">
                                          *
                                        </span>
                                      )}
                                    </label>
                                    {field.type === "select" ? (
                                      <select
                                        value={
                                          String(currentConfig[field.name] ?? field.defaultValue ?? "")
                                        }
                                        onChange={(e) =>
                                          handleChange(param, {
                                            ...currentConfig,
                                            [field.name]: e.target.value,
                                          })
                                        }
                                      >
                                        <option value="">Select...</option>
                                        {field.options?.map((opt) => (
                                          <option key={opt} value={opt}>
                                            {opt}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        type={
                                          field.type === "password"
                                            ? "password"
                                            : field.type === "number"
                                            ? "number"
                                            : "text"
                                        }
                                        value={
                                          (currentConfig[
                                            field.name
                                          ] as string) || ""
                                        }
                                        onChange={(e) =>
                                          handleChange(param, {
                                            ...currentConfig,
                                            [field.name]: e.target.value,
                                          })
                                        }
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      ) : param.type === "select" ? (
                        <select
                          value={(formValues[param.name] as string) ?? ""}
                          onChange={(event) =>
                            handleChange(param, event.target.value)
                          }
                        >
                          {param.options?.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : param.type === "boolean" ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={Boolean(formValues[param.name])}
                            onChange={(event) =>
                              handleChange(param, event.target.checked)
                            }
                          />
                          <span className="text-gray-500">Activer</span>
                        </div>
                      ) : (
                        <input
                          type={param.type === "number" ? "number" : "text"}
                          placeholder={
                            param.type === "column-list"
                              ? "Click columns above to select"
                              : param.label
                          }
                          value={(formValues[param.name] as string) ?? ""}
                          onChange={(event) =>
                            handleChange(param, event.target.value)
                          }
                          readOnly={param.type === "column-list"}
                        />
                      )}
                    </label>
                  ))}
              </div>
            </div>
          </div>
          <div className="shrink-0 pb-4 flex flex-row-reverse gap-2 py-1 px-4">
            {renderedNode?.operation.id !== "dbt-model" && (
              <button
                className="highlight-button rounded-full px-4 py-1 w-20 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={handleSave}
                disabled={
                  renderedNode.operation.id === "source-table" &&
                  (!String(formValues.table || "").trim() ||
                    !Array.isArray(formValues.columns) ||
                    formValues.columns.length === 0)
                }
              >
                Save
              </button>
            )}
            {renderedNode?.operation.id !== "dbt-model" &&
              renderedNode?.operation.id !== "database" && (
              <button
                className="delete-button px-4 py-1"
                onClick={() => renderedNode && onDelete(renderedNode.id)}
              >
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default Inspector;
