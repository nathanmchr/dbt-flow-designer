import { memo, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position } from "@xyflow/react";
import type { OperationDefinition } from "../../definitions/operations";
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
    isSelected?: boolean;
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
      <button
        className="flex w-5 h-5 p-1 rounded-full justify-center items-center text-sm font-bold cursor-help"
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
  const { operation, params, onConfigure, isSelected } = data;

  // Check if any params are configured
  const hasParams = params && Object.keys(params).length > 0;

  return (
    <div
      className={`relative node px-4 py-3 w-60 cursor-pointer ${
        isSelected ? "selected" : ""
      }`}
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

      {/* Header: Operation name */}
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

      {/* Parameters display or not configured message */}
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
                <span className="text-right truncate">
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
