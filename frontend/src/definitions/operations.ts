// ------------------------------------------------------------
// Global operation type definitions
// ------------------------------------------------------------

export type OperationCategory = "source" | "transform" | "output" | "advanced";

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
    | "column-rename"
    | "table"
    | "column-definition"
    | "filter-condition"
    | "filter-builder"
    | "join-condition"
    | "adapter-selector";
  required?: boolean;
  options?: string[];
  tooltip?: string;
}

export interface OperationDefinition {
  id: string;
  label: string;
  description: string;
  category: OperationCategory;
  inputs: number; // number of incoming connections
  outputs: number; // number of outgoing connections
  params: OperationParam[];
}

// ------------------------------------------------------------
// All available SQL operations definitions
// ------------------------------------------------------------

export const OPERATION_DEFS: OperationDefinition[] = [
  // ------------------------------------------------------------
  // SOURCE OPERATIONS
  // ------------------------------------------------------------
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
    id: "source-manual",
    label: "Manual Table",
    description:
      "Define a table structure manually without a database connection.",
    category: "source",
    inputs: 0,
    outputs: 1,
    params: [
      {
        name: "table_name",
        label: "Table Name",
        type: "string",
        required: true,
      },
      {
        name: "columns",
        label: "Column Definitions",
        type: "column-definition",
        required: true,
      },
    ],
  },
  {
    id: "source-table",
    label: "Table",
    description: "Selects a table from the database as a source.",
    category: "source",
    inputs: 1,
    outputs: 1,
    params: [
      {
        name: "table",
        label: "Table Name",
        type: "table",
        required: true,
      },
    ],
  },

  // ------------------------------------------------------------
  // TRANSFORM OPERATIONS
  // ------------------------------------------------------------
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
    description: "Groups rows and applies aggregations.",
    category: "transform",
    inputs: 1,
    outputs: 1,
    params: [
      {
        name: "columns",
        label: "Group Columns",
        type: "column-list",
        required: true,
      },
      {
        name: "aggregations",
        label: "Aggregations",
        type: "string",
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

  // ------------------------------------------------------------
  // OUTPUT OPERATIONS
  // ------------------------------------------------------------
  {
    id: "dbt-model",
    label: "dbt Model",
    description:
      "Marks the result as a dbt model with a given materialization.",
    category: "output",
    inputs: 1,
    outputs: 0,
    params: [
      {
        name: "name",
        label: "Model Name",
        type: "string",
        required: true,
      },
      {
        name: "materialized",
        label: "Materialization",
        type: "select",
        options: ["view", "table", "incremental"],
        required: true,
      },
    ],
  },

  // ------------------------------------------------------------
  // ADVANCED OPERATIONS
  // ------------------------------------------------------------
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
