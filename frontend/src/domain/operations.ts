// ------------------------------------------------------------
// Global operation type definitions
// ------------------------------------------------------------

export type OperationCategory = "source" | "transform" | "output" | "advanced";

export interface OperationParam {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "column-list" | "table";
  required?: boolean;
  options?: string[];
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
    id: "source-table",
    label: "Table",
    description: "Selects a table from the database as a source.",
    category: "source",
    inputs: 0,
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
        type: "column-list",
        required: true,
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
        label: "Condition",
        type: "string",
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
        type: "string",
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
        type: "string",
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
