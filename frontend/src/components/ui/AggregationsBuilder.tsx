/**
 * @fileoverview Aggregations Builder for GROUP BY operations.
 *
 * Provides interface for configuring SQL aggregation functions:
 * - Supports all major SQL aggregation functions (COUNT, SUM, AVG, etc.)
 * - Column selection and alias configuration
 * - Auto-generates column aliases based on function and column name
 */

export interface Aggregation {
  id: string;
  function: string;
  column: string;
  alias: string;
}

interface AggregationsBuilderProps {
  value: Aggregation[];
  onChange: (value: Aggregation[]) => void;
  availableColumns: Array<{ name: string; type: string }>;
}

// All SQL/DBT aggregation functions
const AGGREGATION_FUNCTIONS = [
  "COUNT",
  "COUNT(DISTINCT)",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "STRING_AGG",
  "LISTAGG",
  "ARRAY_AGG",
  "STDDEV",
  "STDDEV_POP",
  "STDDEV_SAMP",
  "VARIANCE",
  "VAR_POP",
  "VAR_SAMP",
  "MEDIAN",
  "PERCENTILE_CONT",
  "PERCENTILE_DISC",
  "MODE",
  "FIRST_VALUE",
  "LAST_VALUE",
  "ANY_VALUE",
  "APPROX_COUNT_DISTINCT",
  "CORR",
  "COVAR_POP",
  "COVAR_SAMP",
];

let aggregationIdCounter = 0;
const generateId = () => `agg_${Date.now()}_${aggregationIdCounter++}`;

export default function AggregationsBuilder({
  value,
  onChange,
  availableColumns,
}: AggregationsBuilderProps) {
  const aggregations = value || [];

  const addAggregation = () => {
    const newAgg: Aggregation = {
      id: generateId(),
      function: "COUNT",
      column: availableColumns[0]?.name || "",
      alias: "",
    };
    onChange([...aggregations, newAgg]);
  };

  const updateAggregation = (id: string, updates: Partial<Aggregation>) => {
    onChange(
      aggregations.map((agg) => (agg.id === id ? { ...agg, ...updates } : agg))
    );
  };

  const deleteAggregation = (id: string) => {
    onChange(aggregations.filter((agg) => agg.id !== id));
  };

  // Auto-generate alias if empty
  const generateAlias = (func: string, column: string): string => {
    const funcName = func.replace(/[()]/g, "_").toLowerCase();
    const colName = column.toLowerCase();
    return `${funcName}_${colName}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={addAggregation}
          className="normal-button px-3 py-1 text-xs bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          + Add Aggregation
        </button>
      </div>

      {aggregations.length === 0 ? (
        <div className="inspector-section px-1 text-sm italic text-gray-500">
          No aggregations yet. Click "Add Aggregation" to start.
        </div>
      ) : (
        <div className="space-y-2">
          {aggregations.map((agg, index) => (
            <div key={agg.id} className="inspector-repeat-row space-y-3">
              <div className="flex justify-between items-start">
                <span className="text-xs font-semibold text-gray-400">
                  Aggregation #{index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => deleteAggregation(agg.id)}
                  className="delete-button w-6 h-6 flex items-center justify-center"
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

              <div className="grid grid-cols-2 gap-3">
                {/* Function */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Function
                  </label>
                  <select
                    value={agg.function}
                    onChange={(e) => {
                      const newFunc = e.target.value;
                      updateAggregation(agg.id, {
                        function: newFunc,
                        alias: agg.alias || generateAlias(newFunc, agg.column),
                      });
                    }}
                  >
                    {AGGREGATION_FUNCTIONS.map((func) => (
                      <option key={func} value={func}>
                        {func}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Column */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Column
                  </label>
                  <select
                    value={agg.column}
                    onChange={(e) => {
                      const newCol = e.target.value;
                      updateAggregation(agg.id, {
                        column: newCol,
                        alias: agg.alias || generateAlias(agg.function, newCol),
                      });
                    }}
                  >
                    <option value="">Select column</option>
                    {availableColumns.map((col) => (
                      <option key={col.name} value={col.name}>
                        {col.name}
                      </option>
                    ))}
                    <option value="*">* (all columns)</option>
                  </select>
                </div>

                {/* Alias */}
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Alias (Output Column Name)
                  </label>
                  <input
                    type="text"
                    value={agg.alias}
                    onChange={(e) =>
                      updateAggregation(agg.id, { alias: e.target.value })
                    }
                    placeholder={generateAlias(agg.function, agg.column)}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    e.g., total_revenue, avg_price, customer_count
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
