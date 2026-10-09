/**
 * @fileoverview Operation definitions for the dbt Flow Designer.
 *
 * Defines all available SQL operations that can be used in the flowchart,
 * including their parameters, categories, and connection requirements.
 */

/** Operation category types */
export type OperationCategory = "source" | "transform" | "output" | "advanced";

/** Parameter definition for an operation */
export interface OperationParam {
  name: string;
  label: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "select"
    | "column-list"
    | "column-select"
    | "column-selector"
    | "column-rename"
    | "table"
    | "column-definition"
    | "filter-condition"
    | "filter-builder"
    | "join-condition"
    | "adapter-selector"
    | "aggregations-builder";
  required?: boolean;
  options?: string[];
  tooltip?: string;
}

/** Complete operation definition */
export interface OperationDefinition {
  id: string;
  label: string;
  description: string;
  category: OperationCategory;
  /** Number of incoming connections */
  inputs: number;
  /** Number of outgoing connections */
  outputs: number;
  params: OperationParam[];
}

/**
 * All available SQL operations.
 * Organized by category: source, transform, output, and advanced.
 */
export const OPERATION_DEFS: OperationDefinition[] = [
  // ===== SOURCE OPERATIONS =====
  {
    id: "database",
    label: "Database",
    description: "Configure a database connection source.",
    category: "source",
    inputs: 0,
    outputs: 1,
    params: [
      {
        name: "adapter",
        label: "Database Type",
        type: "adapter-selector",
        required: true,
      },
    ],
  },
  {
    id: "source-table",
    label: "Table",
    description: "Selects a database table and the source columns to use.",
    category: "source",
    inputs: 1,
    outputs: 1,
    params: [
      {
        name: "table",
        label: "Table",
        type: "table",
        required: true,
      },
      {
        name: "columns",
        label: "Columns",
        type: "column-definition",
        required: true,
      },
    ],
  },

  // ===== TRANSFORM OPERATIONS =====
  {
    id: "select",
    label: "Select",
    description: "Selects a subset of columns.",
    category: "transform",
    inputs: 1,
    outputs: 1,
    params: [
      {
        name: "columns",
        label: "Columns",
        type: "column-rename",
        required: true,
        tooltip:
          "Select columns to include in the output. Use aliases to rename columns or avoid naming conflicts (e.g., when joining tables with columns of the same name).",
      },
    ],
  },
  {
    id: "filter",
    label: "Filter",
    description: "Filters rows using a boolean SQL expression.",
    category: "transform",
    inputs: 1,
    outputs: 1,
    params: [
      {
        name: "condition",
        label: "Filter Condition",
        type: "filter-builder",
        required: true,
      },
    ],
  },
  {
    id: "join",
    label: "Join",
    description: "Joins two datasets using a join condition.",
    category: "transform",
    inputs: 2,
    outputs: 1,
    params: [
      {
        name: "type",
        label: "Join Type",
        type: "select",
        options: ["INNER", "LEFT", "RIGHT", "FULL"],
        required: true,
      },
      {
        name: "on",
        label: "Join Condition",
        type: "join-condition",
        required: true,
      },
    ],
  },
  {
    id: "group-by",
    label: "Group By",
    description:
      "Groups rows and applies aggregations (SUM, AVG, COUNT, etc.).",
    category: "transform",
    inputs: 1,
    outputs: 1,
    params: [
      {
        name: "columns",
        label: "Group By Columns",
        type: "column-selector",
        required: true,
      },
      {
        name: "aggregations",
        label: "Aggregations",
        type: "aggregations-builder",
        required: false,
      },
    ],
  },
  {
    id: "sort",
    label: "Sort",
    description: "Sorts rows by a given column.",
    category: "transform",
    inputs: 1,
    outputs: 1,
    params: [
      {
        name: "column",
        label: "Sort Column",
        type: "column-select",
        required: true,
      },
      {
        name: "direction",
        label: "Direction",
        type: "select",
        options: ["ASC", "DESC"],
        required: true,
      },
    ],
  },

  // ===== OUTPUT OPERATIONS =====
  {
    id: "dbt-model",
    label: "Model Output",
    description:
      "Marks the result as a dbt model. The model name is set in the header.",
    category: "output",
    inputs: 1,
    outputs: 0,
    params: [],
  },

  // ===== ADVANCED OPERATIONS =====
  {
    id: "custom-sql",
    label: "Custom SQL",
    description: "Allows writing arbitrary SQL code.",
    category: "advanced",
    inputs: 1,
    outputs: 1,
    params: [
      {
        name: "sql",
        label: "SQL Code",
        type: "string",
        required: true,
      },
    ],
  },
];
