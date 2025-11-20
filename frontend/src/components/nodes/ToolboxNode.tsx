import type { OperationDefinition } from "../../domain/operations";

interface ToolboxNodeProps {
  operation: OperationDefinition;
  onAddNode: (operation: OperationDefinition) => void;
}

export default function ToolboxNode({
  operation,
  onAddNode,
}: ToolboxNodeProps) {
  return (
    <div
      className="relative node group w-full cursor-pointer transition-all hover:bg-gray-200 dark:hover:bg-gray-700"
      onClick={() => onAddNode(operation)}
    >
      {/* Overlay */}
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
              <feGaussianBlur stdDeviation="1.5" />
            </filter>
          </defs>

          <circle
            cx="12"
            cy="12"
            r="10" // Cercle reste le même
            className="fill-gray-200 dark:fill-gray-700 opacity-80"
            filter="url(#blur-filter)"
          />

          <line
            x1="12"
            y1="6"
            x2="12"
            y2="18"
            stroke="#ea580c"
            strokeWidth="2"
          />
          <line
            x1="6"
            y1="12"
            x2="18"
            y2="12"
            stroke="#ea580c"
            strokeWidth="2"
          />
        </svg>
      </div>

      {/* Content */}
      <div className="flex flex-col items-start relative z-10">
        <div className="flex items-center">
          <div className="rounded-full w-10 h-10 flex justify-center items-center bg-gray-100 dark:bg-gray-700 text-lg">
            {operation.label[0]}
          </div>
          <div className="ml-3">
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {operation.label}
            </div>
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
}
