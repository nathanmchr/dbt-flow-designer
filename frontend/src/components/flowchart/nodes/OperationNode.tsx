/**
 * @fileoverview Operation Node component for the flowchart.
 *
 * Renders individual operation nodes with:
 * - Dynamic handles for join and database nodes
 * - Parameter display with formatted values
 * - Tooltip with operation description
 * - Selection state styling
 */

import { memo, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position } from "@xyflow/react";
import type { OperationDefinition } from "../../../definitions/operations";
import { getOperationIcon } from "../../ui/OperationIcons";

/** Props for the OperationNode component */
interface OperationNodeProps {
  id: string;
  data: {
    operation: OperationDefinition;
    params?: Record<string, unknown>;
    onConfigure?: (nodeData: {
      id: string;
      operation: OperationDefinition;
      params?: Record<string, unknown>;
    }) => void;
    onRemove?: (nodeId: string) => void;
    onSave?: (nodeId: string, params: Record<string, unknown>) => void;
    isSelected?: boolean;
  };
}

/** Filter node structure for recursive filter display */
interface FilterNode {
  type: "group" | "condition";
  children?: FilterNode[];
  operators?: string[];
  column?: string;
  operator?: string;
  value?: string | number;
}

/**
 * Recursively formats a filter group for display.
 * Handles nested groups with operators and parentheses.
 */
function formatFilterGroup(node: unknown, isRoot = false): string {
  if (!node || typeof node !== "object") return "";

  // Handle condition nodes
  if ("type" in node && node.type === "condition") {
    const condition = node as {
      type: "condition";
      column?: string;
      operator?: string;
      value?: string | number;
    };
    if (!condition.column) return "";
    if (
      condition.operator === "IS NULL" ||
      condition.operator === "IS NOT NULL"
    ) {
      return `${condition.column} ${condition.operator}`;
    }
    return `${condition.column} ${condition.operator} ${
      condition.value || "?"
    }`;
  }

  // Handle group nodes
  if ("type" in node && node.type === "group") {
    const group = node as {
      type: "group";
      children?: unknown[];
      operators?: string[];
    };
    if (!group.children || group.children.length === 0) return "";

    const parts: string[] = [];
    for (let i = 0; i < group.children.length; i++) {
      const childStr = formatFilterGroup(group.children[i]);
      if (childStr) {
        if (i > 0) {
          const op = group.operators?.[i - 1] || "AND";
          parts.push(op);
        }
        parts.push(childStr);
      }
    }

    if (parts.length === 0) return "";

    const joined = parts.join(" ");
    // Root groups don't need parentheses, nested groups do
    return isRoot ? joined : `(${joined})`;
  }

  return "";
}

/**
 * Formats parameter values for display in the node.
 * Handles various types: filters, columns, joins, etc.
 */
function formatParamValue(value: unknown, paramName?: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "✓" : "✗";

  // Handle FilterGroup (nested object)
  if (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as FilterNode).type === "group" &&
    "children" in value
  ) {
    const formatted = formatFilterGroup(value, true);
    return formatted || "—";
  }

  if (Array.isArray(value)) {
    // Handle filter conditions (legacy array format)
    if (
      (paramName === "conditions" || paramName === "condition") &&
      value.length > 0 &&
      typeof value[0] === "object" &&
      "column" in value[0]
    ) {
      const filterStrs = value
        .map(
          (filter: { column?: string; operator?: string; value?: string }) => {
            if (!filter.column) return null;
            if (
              filter.operator === "IS NULL" ||
              filter.operator === "IS NOT NULL"
            ) {
              return `${filter.column} ${filter.operator}`;
            }
            return `${filter.column} ${filter.operator} ${filter.value || "?"}`;
          }
        )
        .filter(Boolean);

      if (filterStrs.length === 0) return "—";
      return filterStrs.join(", ");
    }

    // Handle column definitions
    if (
      value.length > 0 &&
      typeof value[0] === "object" &&
      "name" in value[0]
    ) {
      return `${value.length} column${value.length !== 1 ? "s" : ""}`;
    }
    return value.length > 0 ? `${value.length} items` : "—";
  }

  if (typeof value === "object") {
    // Handle join-condition
    if (
      "leftColumn" in value &&
      "rightColumn" in value &&
      "operator" in value
    ) {
      const join = value as {
        leftColumn: string;
        rightColumn: string;
        operator: string;
      };
      if (!join.leftColumn || !join.rightColumn) return "—";
      return `${join.leftColumn} ${join.operator} ${join.rightColumn}`;
    }
    // Handle single filter-condition (legacy)
    if ("column" in value && "operator" in value && "value" in value) {
      const filter = value as {
        column: string;
        operator: string;
        value: string;
      };
      if (!filter.column) return "—";
      if (filter.operator === "IS NULL" || filter.operator === "IS NOT NULL") {
        return `${filter.column} ${filter.operator}`;
      }
      return `${filter.column} ${filter.operator} ${filter.value || "?"}`;
    }
    return "—";
  }

  const str = String(value);
  return str.length > 20 ? str.substring(0, 20) + "..." : str;
}

/**
 * Tooltip component for displaying operation description.
 * Uses portal to render outside the node for proper layering.
 */
const NodeTooltip = ({ content }: { content: React.ReactNode }) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  return (
    <>
      <button
        className="normal-button flex w-6 h-6 p-1 justify-center items-center cursor-help"
        onMouseEnter={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setPosition({
            top: rect.top,
            left: rect.left,
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
              transform: "translateY(-100%) translateY(-10px) translateX(-50%)",
              width: "12rem",
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
};

/**
 * Main operation node component.
 * Renders differently based on operation type (join, database, or standard).
 */
function OperationNode({ id, data }: OperationNodeProps) {
  const { operation, params, onConfigure, isSelected } = data;
  const hasParams = params && Object.keys(params).length > 0;

  /**
   * Calculates minimum height for nodes with dynamic handles.
   * Ensures the node is tall enough to display all handles.
   */
  const calculateMinHeight = () => {
    if (operation.id === "join") {
      const handleCount = (params?.inputHandles as number) || 2;
      const minHeight = 28 + (handleCount + 1) * 40;
      return minHeight;
    }
    if (operation.id === "database") {
      const handleCount = (params?.outputHandles as number) || 1;
      const minHeight = 28 + (handleCount + 1) * 40;
      return minHeight;
    }
    return undefined;
  };

  return (
    <div
      className={`relative node z-10 px-4 py-3 w-60 cursor-pointer ${
        isSelected ? "selected" : ""
      }`}
      style={{ minHeight: calculateMinHeight() }}
      onClick={() => onConfigure?.({ id, operation, params })}
    >
      {/* Tooltip */}
      <div
        className="absolute top-3 right-3 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <NodeTooltip
          content={
            <div className="text-gray-600 dark:text-gray-400">
              {operation.description || "No description available."}
            </div>
          }
        />
      </div>

      {/* Header */}
      <div className="flex">
        <div className="node-icon w-11 h-11">
          {getOperationIcon(operation.id, "w-6 h-6 text-orange-600")}
        </div>

        <div className="ml-3">
          <div className="text-lg font-bold">{operation.label}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {operation.category.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Parameters display */}
      <div className="mt-3 border-t border-gray-300 dark:border-gray-700 pt-2">
        {hasParams ? (
          <div className="space-y-1">
            {Object.entries(params).map(([key, value]) => (
              <div
                key={key}
                className="flex justify-between items-start text-xs"
              >
                <span className="text-gray-600 dark:text-gray-400 font-medium truncate shrink-0 mr-2">
                  {key}:
                </span>
                <span
                  className={`text-right ${
                    key === "condition" || key === "conditions"
                      ? "wrap-break-words"
                      : "truncate"
                  }`}
                >
                  {formatParamValue(value, key)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-400 dark:text-gray-500 italic text-center">
            Not configured yet
          </div>
        )}
      </div>

      {/* Handles */}
      {operation.id === "join" ? (
        <JoinHandles data={data} id={id} operation={operation} />
      ) : operation.id === "database" ? (
        <DatabaseHandles data={data} id={id} operation={operation} />
      ) : (
        <StandardHandles operation={operation} />
      )}
    </div>
  );
}

/**
 * Dynamic input handles for join operations.
 * Allows adding/removing inputs beyond the default 2.
 */
function JoinHandles({
  data,
  id,
  operation,
}: {
  data: OperationNodeProps["data"];
  id: string;
  operation: OperationDefinition;
}) {
  const handleCount = (data.params?.inputHandles as number) || 2;
  const handleSpacing = 40;
  const startTop = 18;

  const handles = [];

  // Active input handles
  for (let i = 0; i < handleCount; i++) {
    const canRemove = handleCount > 2 && i >= 2;
    const topPosition = startTop + i * handleSpacing;

    handles.push(
      <div
        key={`input-${i}`}
        style={{
          position: "absolute",
          left: -9,
          top: `${topPosition}px`,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Handle
          type="target"
          position={Position.Left}
          id={`input-${i}`}
          style={{
            position: "relative",
            width: 16,
            height: 32,
            borderRadius: "6px 0 0 6px",
            left: 0,
            top: 0,
            transform: "none",
            marginLeft: "-0.5rem",
            zIndex: -1,
          }}
        />
        {canRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const newCount = handleCount - 1;
              const saveCallback = data.onSave;
              if (saveCallback) {
                saveCallback(id, {
                  ...data.params,
                  inputHandles: newCount,
                  _removedHandleIndex: i,
                });
              }
            }}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: "20px",
              height: "20px",
              border: "none",
              background: "transparent",
              color: "var(--text-primary)",
              fontSize: "16px",
              fontWeight: "bold",
              lineHeight: "1",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              zIndex: 10,
              marginRight: "-8rem",
            }}
            title="Remove input"
          >
            −
          </button>
        )}
      </div>
    );
  }

  // Add button
  const addButtonTop = startTop + handleCount * handleSpacing;
  handles.push(
    <div
      key="add-handle"
      style={{
        position: "absolute",
        left: -9,
        top: `${addButtonTop}px`,
        display: "flex",
        alignItems: "center",
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          const newCount = handleCount + 1;
          const saveCallback = data.onSave;
          if (saveCallback) {
            saveCallback(id, {
              ...data.params,
              inputHandles: newCount,
            });
          }
        }}
        style={{
          position: "relative",
          width: 15,
          height: 32,
          borderRadius: "6px 0 0 6px",
          borderLeft: "1px dashed currentColor",
          borderTop: "1px dashed currentColor",
          borderBottom: "1px dashed currentColor",
          borderRight: "none",
          borderColor: "var(--color-gray-400)",
          background: "transparent",
          color: "var(--color-gray-500)",
          fontSize: "14px",
          lineHeight: "1",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          opacity: 1,
          marginLeft: "-0.55rem",
          zIndex: -1,
        }}
        title="Add input"
      >
        +
      </button>
    </div>
  );

  return (
    <>
      {handles}
      {operation.outputs > 0 && (
        <Handle
          type="source"
          position={Position.Right}
          style={{
            width: 16,
            height: 32,
            borderRadius: "0 calc(infinity * 1px) calc(infinity * 1px) 0",
            margin: "0 -0.55rem",
            zIndex: -1,
          }}
        />
      )}
    </>
  );
}

/**
 * Dynamic output handles for database operations.
 * Allows adding/removing outputs for multiple table connections.
 */
function DatabaseHandles({
  data,
  id,
  operation,
}: {
  data: OperationNodeProps["data"];
  id: string;
  operation: OperationDefinition;
}) {
  const handleCount = (data.params?.outputHandles as number) || 1;
  const handleSpacing = 40;
  const startTop = 18;

  const handles = [];

  // Active output handles
  for (let i = 0; i < handleCount; i++) {
    const canRemove = handleCount > 1 && i >= 1;
    const topPosition = startTop + i * handleSpacing;

    handles.push(
      <div
        key={`output-${i}`}
        style={{
          position: "absolute",
          right: -9,
          top: `${topPosition}px`,
          display: "flex",
          alignItems: "center",
          flexDirection: "row-reverse",
        }}
      >
        <Handle
          type="source"
          position={Position.Right}
          id={`output-${i}`}
          style={{
            position: "relative",
            width: 16,
            height: 32,
            borderRadius: "0 calc(infinity * 1px) calc(infinity * 1px) 0",
            left: 0,
            top: 0,
            transform: "none",
            margin: "0 -0.5rem",
            zIndex: -1,
          }}
        />
        {canRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const newCount = handleCount - 1;
              const saveCallback = data.onSave;
              if (saveCallback) {
                saveCallback(id, {
                  ...data.params,
                  outputHandles: newCount,
                  _removedHandleIndex: i,
                });
              }
            }}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: "20px",
              height: "20px",
              border: "none",
              background: "transparent",
              color: "var(--text-primary)",
              fontSize: "16px",
              fontWeight: "bold",
              lineHeight: "1",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              zIndex: 10,
            }}
            title="Remove output"
          >
            −
          </button>
        )}
      </div>
    );
  }

  // Add button
  const addButtonTop = startTop + handleCount * handleSpacing;
  handles.push(
    <div
      key="add-handle"
      style={{
        position: "absolute",
        right: -9,
        top: `${addButtonTop}px`,
        display: "flex",
        alignItems: "center",
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          const newCount = handleCount + 1;
          const saveCallback = data.onSave;
          if (saveCallback) {
            saveCallback(id, {
              ...data.params,
              outputHandles: newCount,
            });
          }
        }}
        style={{
          position: "relative",
          width: 15,
          height: 32,
          borderRadius: "0 calc(infinity * 1px) calc(infinity * 1px) 0",
          borderRight: "1px dashed currentColor",
          borderTop: "1px dashed currentColor",
          borderBottom: "1px dashed currentColor",
          borderLeft: "none",
          borderColor: "var(--color-gray-400)",
          background: "transparent",
          color: "var(--color-gray-500)",
          fontSize: "14px",
          lineHeight: "1",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          opacity: 1,
          marginRight: "-0.5rem",
          zIndex: -1,
        }}
        title="Add output"
      >
        +
      </button>
    </div>
  );

  return (
    <>
      {handles}
      {operation.inputs > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          style={{
            width: 16,
            height: 32,
            borderRadius: "6px 0 0 6px",
            margin: "0 -0.55rem",
            zIndex: -1,
          }}
        />
      )}
    </>
  );
}

/**
 * Standard handles for regular operations.
 * Displays single input and/or output handles.
 */
function StandardHandles({ operation }: { operation: OperationDefinition }) {
  return (
    <>
      {operation.inputs > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          style={{
            width: 16,
            height: 32,
            borderRadius: "6px 0 0 6px",
            margin: "0 -0.55rem",
            zIndex: -1,
          }}
        />
      )}

      {operation.outputs > 0 && (
        <Handle
          type="source"
          position={Position.Right}
          style={{
            width: 16,
            height: 32,
            borderRadius: "0 calc(infinity * 1px) calc(infinity * 1px) 0",
            margin: "0 -0.55rem",
            zIndex: -1,
          }}
        />
      )}
    </>
  );
}

/**
 * Custom comparison function for memo optimization.
 * Only re-renders when critical props change.
 */
const arePropsEqual = (
  prevProps: OperationNodeProps,
  nextProps: OperationNodeProps
) => {
  return (
    prevProps.id === nextProps.id &&
    prevProps.data.operation.id === nextProps.data.operation.id &&
    prevProps.data.isSelected === nextProps.data.isSelected &&
    JSON.stringify(prevProps.data.params) ===
      JSON.stringify(nextProps.data.params)
  );
};

export default memo(OperationNode, arePropsEqual);
