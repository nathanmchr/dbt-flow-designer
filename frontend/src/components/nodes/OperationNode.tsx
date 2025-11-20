import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { OperationDefinition } from "../../domain/operations";

interface OperationNodeProps {
  id: string;
  data: {
    operation: OperationDefinition;
    params?: Record<string, any>;
    onConfigure: (nodeData: {
      id: string;
      operation: OperationDefinition;
      params?: Record<string, any>;
    }) => void;
    onRemove: (nodeId: string) => void;
  };
}

function OperationNode({ id, data }: OperationNodeProps) {
  const { operation, params, onConfigure, onRemove } = data;

  return (
    <div className="relative node px-4 py-3 w-56">
      {/* Info icon top-right */}
      <div className="absolute top-2 right-2">
        <div className="relative group">
          <div className="w-5 h-5 flex justify-center items-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm cursor-pointer">
            ?
          </div>
          {/* Tooltip */}
          <div className="absolute bottom-full mb-2 right-1/2 translate-x-1/2 w-44 bg-white/30 dark:bg-gray-800/50 backdrop-blur-md text-xs p-2 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none">
            {operation.description || "No description available."}
          </div>
        </div>
      </div>

      {/* Header: Operation name */}
      <div className="flex">
        <div className="rounded-full w-12 h-12 flex justify-center items-center bg-gray-100 dark:bg-gray-700 text-lg">
          {operation.label[0]}
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

      {/* Footer buttons */}
      <div className="flex gap-2 mt-3">
        <button
          className="text-xs bg-orange-600 hover:bg-orange-400 text-white px-2 py-1 rounded-full flex-1"
          onClick={() => onConfigure({ id, operation, params })}
        >
          Configure
        </button>

        <button
          className="text-xs bg-red-600 hover:bg-red-400 text-white px-2 py-1 rounded-full"
          onClick={() => onRemove(id)}
        >
          ✕
        </button>
      </div>

      {/* Handles */}
      {operation.inputs > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          className="w-2 h-2 bg-gray-600 dark:bg-gray-300"
        />
      )}

      {operation.outputs > 0 && (
        <Handle
          type="source"
          position={Position.Right}
          className="w-2 h-2 bg-orange-500 dark:bg-orange-300"
        />
      )}
    </div>
  );
}

export default memo(OperationNode);
