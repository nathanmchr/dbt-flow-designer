/**
 * @fileoverview Toolbox node component for the operations sidebar.
 *
 * Displays an operation card with icon, label, and description.
 * Includes hover effect with add button overlay.
 */

import { memo } from "react";
import type { OperationDefinition } from "../../../definitions/operations";
import { getOperationIcon } from "../../ui/OperationIcons";

interface ToolboxNodeProps {
  operation: OperationDefinition;
  onAddNode: (operation: OperationDefinition) => void;
}

/**
 * Individual operation card in the toolbox.
 * Memoized for performance as the toolbox contains many nodes.
 */
const ToolboxNode = memo(function ToolboxNode({
  operation,
  onAddNode,
}: ToolboxNodeProps) {
  return (
    <div
      className="relative toolbox-node group w-full h-full cursor-pointer"
      onClick={() => onAddNode(operation)}
    >
      {/* Hover overlay with add icon */}
      <div className="absolute inset-0 flex justify-center items-center pointer-events-none z-20">
        <svg
          className="w-10 h-10 opacity-0 group-hover:opacity-100 transition-opacity"
          viewBox="0 0 24 24"
        >
          <defs>
            <filter
              id="blur-filter"
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feGaussianBlur stdDeviation="2.5" />
            </filter>
          </defs>

          <circle
            cx="12"
            cy="12"
            r="10"
            className="fill-gray-100 dark:fill-gray-700 opacity-80"
            filter="url(#blur-filter)"
          />

          <line
            x1="12"
            y1="6"
            x2="12"
            y2="18"
            className="stroke-gray-400 dark:stroke-gray-200"
            strokeWidth="2"
          />
          <line
            x1="6"
            y1="12"
            x2="18"
            y2="12"
            className="stroke-gray-400 dark:stroke-gray-200"
            strokeWidth="2"
          />
        </svg>
      </div>

      {/* Card content */}
      <div className="flex flex-col items-start relative z-10">
        <div className="flex items-center">
          <div className="node-icon w-10 h-10">
            {getOperationIcon(operation.id, "w-5 h-5 text-orange-600")}
          </div>
          <div className="ml-3">
            <div className="text-sm font-bold">{operation.label}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {operation.category.toUpperCase()}
            </div>
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          {operation.description}
        </div>
      </div>
    </div>
  );
});

export default ToolboxNode;
