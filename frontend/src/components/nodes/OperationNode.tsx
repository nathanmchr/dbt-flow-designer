import { memo, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position } from "@xyflow/react";
import type { OperationDefinition } from "../../domain/operations";
import { getOperationIcon } from "../icons";

interface OperationNodeProps {
  id: string;
  data: {
    operation: OperationDefinition;
    params?: Record<string, any>;
    onConfigure?: (nodeData: {
      id: string;
      operation: OperationDefinition;
      params?: Record<string, any>;
    }) => void;
    onRemove?: (nodeId: string) => void;
  };
}

// Helper function to format param values for display
function formatParamValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (Array.isArray(value)) {
    // Special handling for column definitions
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
    // Handle filter-condition
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

const NodeTooltip = ({ content }: { content: React.ReactNode }) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  return (
    <>
      <div
        className="w-6 h-6 flex justify-center items-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-sm font-bold cursor-help"
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
      </div>
      {visible &&
        createPortal(
          <div
            className="tooltip-content"
            style={{
              top: position.top,
              left: position.left,
              transform: "translateY(-100%) translateY(-10px) translateX(-50%)", // Centered above
              width: "12rem", // Smaller width for node description
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
};

function OperationNode({ id, data }: OperationNodeProps) {
  const { operation, params, onConfigure, onRemove } = data;

  // Check if any params are configured
  const hasParams = params && Object.keys(params).length > 0;

  return (
    <div className="relative node px-4 py-3 w-56">
      {/* Header: Operation name */}
      <div className="flex">
        <div className="rounded-full w-12 h-12 flex justify-center items-center bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
          {getOperationIcon(operation.id, "w-6 h-6")}
        </div>

        <div className="ml-3">
          <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {operation.label}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {operation.category.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Parameters display or not configured message */}
      <div className="mt-3 mb-2 border-t border-gray-200 dark:border-gray-700 pt-2">
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
                <span className="text-gray-900 dark:text-gray-100 text-right truncate">
                  {formatParamValue(value)}
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

      {/* Footer buttons */}
      <div className="flex gap-2 mt-3 items-center">
        <button
          className="text-xs bg-orange-600 hover:bg-orange-400 hover:shadow-lg shadow-orange-400/30 transition-all text-white px-2 py-1 rounded-full flex-1"
          onClick={() => onConfigure?.({ id, operation, params })}
        >
          Configure
        </button>

        <div className="relative group">
          <NodeTooltip
            content={
              <div className="text-gray-600 dark:text-gray-400">
                {operation.description || "No description available."}
              </div>
            }
          />
        </div>

        <button
          className="w-6 h-6 flex justify-center items-center rounded-full bg-gray-200 dark:bg-gray-700 text-red-600 dark:text-red-500 hover:text-red-400 text-xs font-bold"
          onClick={() => onRemove?.(id)}
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

      {/* Handles */}
      {operation.inputs > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ width: 14, height: 24, borderRadius: "4px" }}
        />
      )}

      {operation.outputs > 0 && (
        <Handle
          type="source"
          position={Position.Right}
          style={{ width: 18, height: 18 }}
        />
      )}
    </div>
  );
}

export default memo(OperationNode);
