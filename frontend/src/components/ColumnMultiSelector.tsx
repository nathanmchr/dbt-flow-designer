interface ColumnMultiSelectorProps {
  selectedColumns: string[];
  onChange: (columns: string[]) => void;
  availableColumns: Array<{ name: string; type: string }>;
}

export default function ColumnMultiSelector({
  selectedColumns,
  onChange,
  availableColumns,
}: ColumnMultiSelectorProps) {
  const toggleColumn = (columnName: string) => {
    if (selectedColumns.includes(columnName)) {
      // Remove column
      onChange(selectedColumns.filter((col) => col !== columnName));
    } else {
      // Add column
      onChange([...selectedColumns, columnName]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-400 mb-2">
        Click columns to select/deselect for grouping:
      </div>

      {selectedColumns.length > 0 && (
        <div className="p-3 bg-blue-900/20 border border-blue-800 rounded-lg mb-3">
          <div className="text-xs font-semibold text-blue-300 mb-2">
            Selected Columns ({selectedColumns.length}):
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedColumns.map((col) => (
              <div
                key={col}
                className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white text-xs rounded-full"
              >
                <span>{col}</span>
                <button
                  type="button"
                  onClick={() => toggleColumn(col)}
                  className="hover:bg-blue-700 rounded-full px-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {availableColumns.map((col) => {
          const isSelected = selectedColumns.includes(col.name);
          return (
            <button
              key={col.name}
              type="button"
              onClick={() => toggleColumn(col.name)}
              className={`
                text-left px-3 py-2 rounded border transition-all
                ${
                  isSelected
                    ? "bg-blue-600 border-blue-500 text-white font-semibold"
                    : "bg-gray-800 border-gray-600 text-gray-300 hover:border-blue-500 hover:bg-gray-700"
                }
              `}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono">{col.name}</span>
                {isSelected && (
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
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
              <div className="text-xs text-gray-400 mt-1">{col.type}</div>
            </button>
          );
        })}
      </div>

      {availableColumns.length === 0 && (
        <div className="text-sm text-gray-500 italic p-4 border border-dashed border-gray-600 rounded text-center">
          No columns available. Connect a node first.
        </div>
      )}
    </div>
  );
}
