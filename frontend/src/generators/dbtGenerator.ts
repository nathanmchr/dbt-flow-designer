/**
 * @fileoverview dbt Model Generator
 *
 * Transforms a visual flowchart into a complete dbt project structure.
 * Generates SQL models, sources.yml, schema.yml, and dbt_project.yml.
 *
 * Architecture:
 * - Nodes are classified into layers: staging, intermediate, and mart
 * - Pipeline optimization groups simple operations into CTEs
 * - Column types are tracked for proper SQL value formatting
 */

import type { Node, Edge } from "@xyflow/react";
import type { OperationDefinition } from "../definitions/operations";
import { PipelineOptimizer } from "./pipelineOptimizer.ts";
import { generateCombinedSQL } from "./cteHelpers.ts";
import { buildFilterSQL, type FilterNode } from "./filterSql.ts";
import { quoteColumn, quoteIdentifier } from "./sqlIdentifiers.ts";
import { getDefaultDatabaseSchema } from "../definitions/dbtAdapters.ts";

// =============================================================================
// Types
// =============================================================================

/** Node data containing operation definition and parameters */
export type OperationNodeData = {
  operation: OperationDefinition;
  params?: Record<string, unknown>;
};

/** Generated file with path and content */
export interface GeneratedFile {
  path: string;
  content: string;
}

/** Output from dbt model generation */
export interface DbtModelOutput {
  files: GeneratedFile[];
  errors: string[];
}

/** Node classification with layer, model name, and metadata */
export type ClassifiedNode = {
  node: Node<OperationNodeData>;
  layer: "staging" | "intermediate" | "mart";
  modelName: string;
  filePath: string;
  dependencies: string[];
  columns: string[];
};

/** Group of nodes for CTE optimization */
export type NodeGroup = {
  nodes: Node<OperationNodeData>[];
  groupName: string;
  layer: "staging" | "intermediate" | "mart";
  filePath: string;
  isCombined: boolean;
  mainOperation: string;
  dependencies: string[];
  columns: string[];
};

/** CTE (Common Table Expression) definition */
export type CTE = {
  name: string;
  sql: string;
  node: Node<OperationNodeData>;
  columns: string[];
};

type SourceReference = {
  sourceName: string;
  tableName: string;
};

/** Generator options */
export interface GeneratorOptions {
  /** Combine compatible steps in one file. dbt ephemeral models already inline by default. */
  optimizePipeline?: boolean;
}

// =============================================================================
// Column Type Registry
// =============================================================================

/**
 * Builds a registry mapping column names to their SQL types.
 * Collects type information from source nodes for proper value formatting.
 */
function buildColumnTypeRegistry(
  nodes: Node<OperationNodeData>[]
): Map<string, string> {
  const registry = new Map<string, string>();

  nodes.forEach((node) => {
    const opId = node.data.operation.id;

    if (
      opId === "database" ||
      opId === "source-table"
    ) {
      const columns = node.data.params?.columns as
        | Array<{ name: string; type: string; alias?: string }>
        | undefined;

      if (columns && Array.isArray(columns)) {
        columns.forEach((col) => {
          const type = col.type?.toUpperCase() || "VARCHAR";
          registry.set(col.name, type);
          if (col.alias?.trim()) {
            registry.set(col.alias, type);
          }
        });
      }
    }
  });

  return registry;
}

// =============================================================================
// Column Propagation
// =============================================================================

/**
 * Determines output columns for a model based on its operation type.
 * Handles column inheritance and transformation tracking.
 */
function getModelColumns(
  node: Node<OperationNodeData>,
  dependencies: string[],
  allClassified: ClassifiedNode[]
): string[] {
  const opId = node.data.operation.id;
  const params = node.data.params || {};

  switch (opId) {
    case "source-table": {
      const columns = params.columns as
        | Array<{ name: string; alias?: string }>
        | undefined;
      if (columns?.length) {
        return columns.map((col) => col.alias || col.name);
      }
      return ["*"];
    }

    case "select": {
      const selectCols = params.columns as
        | Array<{ original: string; alias?: string }>
        | undefined;
      if (selectCols?.length) {
        return selectCols.map((col) => col.alias || col.original);
      }
      if (dependencies.length > 0) {
        const parentNode = allClassified.find(
          (cn) => cn.node.id === dependencies[0]
        );
        return parentNode?.columns || ["*"];
      }
      return ["*"];
    }

    case "filter":
    case "sort": {
      if (dependencies.length > 0) {
        const parentNode = allClassified.find(
          (cn) => cn.node.id === dependencies[0]
        );
        return parentNode?.columns || ["*"];
      }
      return ["*"];
    }

    case "join": {
      if (dependencies.length >= 2) {
        const leftNode = allClassified.find(
          (cn) => cn.node.id === dependencies[0]
        );
        const rightNode = allClassified.find(
          (cn) => cn.node.id === dependencies[1]
        );

        const leftCols = leftNode?.columns || [];
        const rightCols = rightNode?.columns || [];

        // Combine columns, avoiding duplicates (prefer left on conflict)
        const allCols = [...leftCols];
        rightCols.forEach((col) => {
          if (!leftCols.includes(col)) {
            allCols.push(col);
          }
        });

        return allCols;
      }
      return ["*"];
    }

    case "group-by": {
      // Support both string and array formats for columns
      const groupCols = Array.isArray(params.columns)
        ? params.columns
        : typeof params.columns === "string"
        ? params.columns
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean)
        : [];
      const aggregations = params.aggregations;

      const cols = [...groupCols];
      if (aggregations) {
        if (Array.isArray(aggregations)) {
          aggregations.forEach((agg: unknown) => {
            const typedAgg = agg as {
              function?: string;
              column?: string;
              alias?: string;
            };
            if (typedAgg.alias) {
              cols.push(typedAgg.alias);
            } else if (typedAgg.function && typedAgg.column) {
              const cleanCol = typedAgg.column
                .replace(/[*]/g, "all")
                .replace(/\s+/g, "_");
              const alias = `${typedAgg.function.toLowerCase()}_${cleanCol}`;
              cols.push(alias);
            }
          });
        } else if (typeof aggregations === "string") {
          const aggList = aggregations
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean);
          aggList.forEach((agg) => {
            const asMatch = agg.match(/\s+as\s+(\w+)/i);
            if (asMatch) {
              cols.push(asMatch[1]);
            } else {
              const funcMatch = agg.match(/^(\w+)\s*\(([^)]+)\)/i);
              if (funcMatch) {
                const [, func, col] = funcMatch;
                const cleanCol = col
                  .replace(/[*]/g, "all")
                  .replace(/\s+/g, "_");
                const alias = `${func.toLowerCase()}_${cleanCol}`;
                cols.push(alias);
              } else {
                cols.push(agg);
              }
            }
          });
        }
      }

      return cols.length > 0 ? cols : ["*"];
    }

    case "union":
    case "aggregate": {
      if (dependencies.length > 0) {
        const parentNode = allClassified.find(
          (cn) => cn.node.id === dependencies[0]
        );
        return parentNode?.columns || ["*"];
      }
      return ["*"];
    }

    case "dbt-model": {
      if (dependencies.length > 0) {
        const parentNode = allClassified.find(
          (cn) => cn.node.id === dependencies[0]
        );
        return parentNode?.columns || ["*"];
      }
      return ["*"];
    }

    default:
      return ["*"];
  }
}

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generates a complete dbt project from a flowchart.
 *
 * @param nodes - All nodes in the flowchart
 * @param edges - All connections between nodes
 * @param projectName - Name for the dbt project
 * @param options - Generator options (e.g., pipeline optimization)
 * @returns Generated files and any errors encountered
 */
export function generateDbtModel(
  nodes: Node<OperationNodeData>[],
  edges: Edge[],
  projectName: string,
  options: GeneratorOptions = {}
): DbtModelOutput {
  const { optimizePipeline = false } = options;

  const files: GeneratedFile[] = [];
  const errors: string[] = [];

  try {
    // Validate input
    if (nodes.length === 0) {
      errors.push("No nodes in the model");
      return { files, errors };
    }

    const outputNodes = nodes.filter(
      (node) => node.data.operation.id === "dbt-model"
    );
    if (outputNodes.length !== 1) {
      errors.push(
        outputNodes.length === 0
          ? "No Model Output node found"
          : "A flow must contain exactly one Model Output node"
      );
      return { files, errors };
    }
    const outputNode = outputNodes[0];

    const dependencyGraph = buildDependencyGraph(edges);
    const reachableNodeIds = collectReachableNodeIds(
      outputNode.id,
      dependencyGraph,
      new Map(nodes.map((node) => [node.id, node])),
      errors
    );
    const relevantNodes = nodes.filter((node) => reachableNodeIds.has(node.id));
    const relevantEdges = edges.filter(
      (edge) =>
        reachableNodeIds.has(edge.source) && reachableNodeIds.has(edge.target)
    );

    validateFlow(relevantNodes, dependencyGraph, errors);
    if (!sanitizeName(projectName)) {
      errors.push("The model name must contain at least one letter or number");
    }
    if (errors.length > 0) return { files, errors };

    const columnTypes = buildColumnTypeRegistry(relevantNodes);
    const sourceConfiguration = buildSourceConfiguration(
      relevantNodes,
      relevantEdges
    );
    files.push(...sourceConfiguration.files);

    // Classify all nodes
    const classifiedNodes = classifyNodes(
      relevantNodes,
      relevantEdges,
      dependencyGraph,
      outputNode,
      projectName,
      sourceConfiguration.references
    );
    validateClassifiedNodes(classifiedNodes, errors);
    if (errors.length > 0) return { files: [], errors };

    // Generate SQL files
    let schemaNodes = classifiedNodes;
    if (optimizePipeline) {
      const optimizer = new PipelineOptimizer(dependencyGraph);
      const optimizedGroups = optimizer.optimizePipeline(classifiedNodes);
      const generatedModelNames = new Map<string, string>();
      optimizedGroups.forEach((group) => {
        group.nodes.forEach((node) => {
          generatedModelNames.set(node.id, group.groupName);
        });
      });

      optimizedGroups.forEach((group) => {
        let sql: string;

        if (group.isCombined) {
          sql = generateCombinedSQL(
            group,
            optimizedGroups,
            classifiedNodes,
            columnTypes
          );
        } else {
          const cn = classifiedNodes.find(
            (c) => c.node.id === group.nodes[0].id
          )!;
          sql = generateSQLForNode(
            cn,
            classifiedNodes,
            columnTypes,
            sourceConfiguration.references,
            generatedModelNames
          );
        }

        files.push({ path: group.filePath, content: sql });
      });

      schemaNodes = optimizedGroups.map((group) => {
        const lastNode = group.nodes[group.nodes.length - 1];
        const classified = classifiedNodes.find(
          (candidate) => candidate.node.id === lastNode.id
        )!;
        return {
          ...classified,
          modelName: group.groupName,
          filePath: group.filePath,
          columns: group.columns,
        };
      });
    } else {
      classifiedNodes.forEach((cn) => {
        const sql = generateSQLForNode(
          cn,
          classifiedNodes,
          columnTypes,
          sourceConfiguration.references
        );
        files.push({ path: cn.filePath, content: sql });
      });
    }

    // Generate schema.yml
    const schemaYml = generateSchemaYml(schemaNodes);
    files.push({ path: `models/schema.yml`, content: schemaYml });

    // Generate dbt_project.yml
    const dbtProjectYml = generateDbtProjectYml(projectName);
    files.push({ path: `dbt_project.yml`, content: dbtProjectYml });
  } catch (error) {
    errors.push(
      `Generation error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return { files, errors };
}

// =============================================================================
// Dependency Graph
// =============================================================================

/**
 * Builds a dependency graph mapping node IDs to their parent node IDs.
 */
function buildDependencyGraph(edges: Edge[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const incomingEdges = new Map<string, Array<{ edge: Edge; index: number }>>();

  edges.forEach((edge, index) => {
    const incoming = incomingEdges.get(edge.target) || [];
    incoming.push({ edge, index });
    incomingEdges.set(edge.target, incoming);
  });

  incomingEdges.forEach((incoming, target) => {
    incoming.sort((left, right) => {
      const getHandleIndex = (edge: Edge) => {
        const match = edge.targetHandle?.match(/^input-(\d+)$/);
        return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
      };
      const handleOrder = getHandleIndex(left.edge) - getHandleIndex(right.edge);
      return handleOrder || left.index - right.index;
    });
    graph.set(
      target,
      incoming.map(({ edge }) => edge.source)
    );
  });

  return graph;
}

function collectReachableNodeIds(
  outputNodeId: string,
  dependencyGraph: Map<string, string[]>,
  nodeMap: Map<string, Node<OperationNodeData>>,
  errors: string[]
): Set<string> {
  const reachable = new Set<string>();
  const visiting = new Set<string>();

  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      errors.push(`Cycle detected at node '${nodeId}'`);
      return;
    }
    if (reachable.has(nodeId)) return;
    if (!nodeMap.has(nodeId)) {
      errors.push(`Connection references missing node '${nodeId}'`);
      return;
    }

    visiting.add(nodeId);
    (dependencyGraph.get(nodeId) || []).forEach(visit);
    visiting.delete(nodeId);
    reachable.add(nodeId);
  };

  visit(outputNodeId);
  return reachable;
}

function validateFlow(
  nodes: Node<OperationNodeData>[],
  dependencyGraph: Map<string, string[]>,
  errors: string[]
): void {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  nodes.forEach((node) => {
    const operation = node.data.operation;
    const dependencies = dependencyGraph.get(node.id) || [];

    if (dependencies.length !== operation.inputs) {
      errors.push(
        `${operation.label} '${node.id}' expects ${operation.inputs} input(s), received ${dependencies.length}`
      );
    }

    dependencies.forEach((dependencyId) => {
      if (!nodeMap.has(dependencyId)) {
        errors.push(`Node '${node.id}' references missing input '${dependencyId}'`);
      }
    });

    for (const parameter of operation.params.filter((param) => param.required)) {
      const value = node.data.params?.[parameter.name];
      const isMissing =
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === "object" &&
          !Array.isArray(value) &&
          Object.keys(value).length === 0);
      if (isMissing) {
        errors.push(
          `${operation.label} '${node.id}' is missing required parameter '${parameter.name}'`
        );
      }
    }

    if (operation.id === "database") {
      const adapter = node.data.params?.adapter as
        | Record<string, unknown>
        | undefined;
      if (!adapter?.type) {
        errors.push(`Database '${node.id}' has no configured adapter`);
      }
    }

    if (operation.id === "source-table") {
      const parent = nodeMap.get(dependencies[0]);
      if (parent && parent.data.operation.id !== "database") {
        errors.push(`Table '${node.id}' must be connected to a Database node`);
      }
    }

    if (operation.id === "filter") {
      const condition = node.data.params?.condition as FilterNode | undefined;
      if (!buildFilterSQL(condition, new Map())) {
        errors.push(`Filter '${node.id}' has no valid condition`);
      }
    }

    if (operation.id === "join") {
      const joinType = node.data.params?.type;
      const joinCondition = node.data.params?.on as
        | { leftColumn?: string; operator?: string; rightColumn?: string }
        | undefined;
      const allowedJoinTypes = new Set(["INNER", "LEFT", "RIGHT", "FULL"]);
      const allowedJoinOperators = new Set(["=", "!=", "<>", "<", ">", "<=", ">="]);
      if (!allowedJoinTypes.has(String(joinType))) {
        errors.push(`Join '${node.id}' has an unsupported join type`);
      }
      if (
        !joinCondition?.leftColumn ||
        !joinCondition.rightColumn ||
        !allowedJoinOperators.has(String(joinCondition.operator))
      ) {
        errors.push(`Join '${node.id}' has an incomplete or invalid condition`);
      }
    }

    if (operation.id === "group-by") {
      const aggregations = node.data.params?.aggregations;
      const allowedAggregationFunctions = new Set([
        "SUM",
        "AVG",
        "COUNT",
        "COUNT(DISTINCT)",
        "MIN",
        "MAX",
      ]);
      if (Array.isArray(aggregations)) {
        aggregations.forEach((aggregation, index) => {
          const typedAggregation = aggregation as {
            function?: string;
            column?: string;
          };
          if (
            !typedAggregation.column ||
            !allowedAggregationFunctions.has(String(typedAggregation.function))
          ) {
            errors.push(
              `Group By '${node.id}' has an invalid aggregation at position ${index + 1}`
            );
          }
        });
      }
    }
  });
}

function validateClassifiedNodes(
  classifiedNodes: ClassifiedNode[],
  errors: string[]
): void {
  const modelNames = new Set<string>();
  const filePaths = new Set<string>();

  classifiedNodes.forEach((classified) => {
    if (modelNames.has(classified.modelName)) {
      errors.push(`Duplicate generated model name '${classified.modelName}'`);
    }
    if (filePaths.has(classified.filePath)) {
      errors.push(`Duplicate generated file path '${classified.filePath}'`);
    }
    modelNames.add(classified.modelName);
    filePaths.add(classified.filePath);
  });
}

function yamlValue(value: unknown): string {
  return JSON.stringify(String(value));
}

function buildSourceConfiguration(
  nodes: Node<OperationNodeData>[],
  edges: Edge[]
): { references: Map<string, SourceReference>; files: GeneratedFile[] } {
  const references = new Map<string, SourceReference>();
  const files: GeneratedFile[] = [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const databaseNodes = nodes.filter(
    (node) => node.data.operation.id === "database"
  );

  databaseNodes.forEach((databaseNode) => {
    const adapter = databaseNode.data.params?.adapter as
      | ({ type?: string; config?: Record<string, unknown> } &
          Record<string, unknown>)
      | undefined;
    const config = adapter?.config || adapter || {};
    const baseSourceName = sanitizeName(String(adapter?.type || "source"));
    const duplicateCount = databaseNodes.filter((candidate) => {
      const candidateAdapter = candidate.data.params?.adapter as
        | { type?: string }
        | undefined;
      return sanitizeName(String(candidateAdapter?.type || "source")) === baseSourceName;
    }).length;
    const sourceName =
      duplicateCount > 1
        ? `${baseSourceName}_${sanitizeName(databaseNode.id)}`
        : baseSourceName;
    const database =
      config.database || config.dbname || config.project || undefined;
    const schema = config.schema || config.dataset || getDefaultDatabaseSchema(String(adapter?.type || ""));
    const tableNodes = edges
      .filter((edge) => edge.source === databaseNode.id)
      .map((edge) => nodeMap.get(edge.target))
      .filter(
        (node): node is Node<OperationNodeData> =>
          Boolean(node && node.data.operation.id === "source-table")
      );

    tableNodes.forEach((tableNode) => {
      const tableName = String(tableNode.data.params?.table || "");
      references.set(tableNode.id, { sourceName, tableName });
    });

    if (tableNodes.length > 0) {
      files.push({
        path: `models/staging/${sourceName}/sources.yml`,
        content: generateSourcesYmlForDatabaseNode(
          sourceName,
          database ? String(database) : undefined,
          String(schema),
          tableNodes
        ),
      });
    }
  });

  return { references, files };
}

// =============================================================================
// Node Classification
// =============================================================================

/**
 * Classifies nodes into dbt layers: staging, intermediate, or mart.
 * Determines model names and file paths for each node.
 */
function classifyNodes(
  nodes: Node<OperationNodeData>[],
  _edges: Edge[],
  dependencyGraph: Map<string, string[]>,
  outputNode: Node<OperationNodeData>,
  outputModelName: string,
  sourceReferences: Map<string, SourceReference>
): ClassifiedNode[] {
  const classified: ClassifiedNode[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const processed = new Set<string>();

  const usedModelNames = new Set<string>();

  const classifyNode = (node: Node<OperationNodeData>) => {
    if (processed.has(node.id)) return;

    const opId = node.data.operation.id;
    const dependencies = dependencyGraph.get(node.id) || [];

    // Skip database nodes
    if (opId === "database") {
      processed.add(node.id);
      return;
    }

    // Process dependencies first
    dependencies.forEach((depId) => {
      const depNode = nodeMap.get(depId);
      if (depNode && !processed.has(depId)) {
        classifyNode(depNode);
      }
    });

    let layer: "staging" | "intermediate" | "mart";
    let modelName: string;
    let filePath: string;

    if (opId === "source-table") {
      layer = "staging";
      const tableName =
        node.data.params?.table ||
        node.data.params?.tableName ||
        node.data.params?.name ||
        "unknown";
      const sourceName =
        sourceReferences.get(node.id)?.sourceName ||
        node.data.params?.database ||
        "default";
      modelName = `stg_${sanitizeName(String(tableName))}`;
      filePath = `models/staging/${sanitizeName(
        String(sourceName)
      )}/${modelName}.sql`;
    } else if (node.id === outputNode.id) {
      layer = "mart";
      const domain = "core";
      modelName = `fct_${sanitizeName(outputModelName)}`;
      filePath = `models/marts/${domain}/${modelName}.sql`;
    } else {
      layer = "intermediate";
      modelName = generateIntermediateName(
        node,
        nodeMap,
        dependencyGraph,
        classified
      );
      const baseName = modelName;
      let suffix = 2;
      while (usedModelNames.has(modelName)) {
        modelName = `${baseName}_${suffix++}`;
      }
      filePath = `models/intermediate/${modelName}.sql`;
    }

    const columns = getModelColumns(node, dependencies, classified);

    usedModelNames.add(modelName);

    classified.push({
      node,
      layer,
      modelName,
      filePath,
      dependencies,
      columns,
    });
    processed.add(node.id);
  };

  nodes.forEach((node) => classifyNode(node));

  return classified;
}

/**
 * Generates a descriptive name for an intermediate model.
 */
function generateIntermediateName(
  node: Node<OperationNodeData>,
  nodeMap: Map<string, Node<OperationNodeData>>,
  dependencyGraph: Map<string, string[]>,
  allClassified: ClassifiedNode[]
): string {
  const opId = node.data.operation.id;
  const deps = dependencyGraph.get(node.id) || [];

  const parentModels = deps
    .map((depId) => {
      const classified = allClassified.find((cn) => cn.node.id === depId);
      if (classified) {
        const modelName = classified.modelName;
        if (modelName.startsWith("stg_")) {
          return modelName.substring(4);
        }
        if (modelName.startsWith("int_")) {
          const withoutPrefix = modelName.substring(4);
          const operationKeywords = [
            "_selected",
            "_filtered",
            "_join",
            "_aggregated",
            "_grouped",
            "_union",
            "_transformed",
          ];
          for (const keyword of operationKeywords) {
            const idx = withoutPrefix.indexOf(keyword);
            if (idx > 0) {
              return withoutPrefix.substring(0, idx);
            }
          }
          return withoutPrefix;
        }
        return modelName;
      }

      const depNode = nodeMap.get(depId);
      if (!depNode) return null;
      const tableName =
        depNode.data.params?.tableName || depNode.data.params?.name;
      return tableName ? sanitizeName(String(tableName)) : null;
    })
    .filter(Boolean) as string[];

  const baseName = parentModels.length > 0 ? parentModels[0] : "data";

  const sameTypeCount =
    allClassified.filter(
      (cn) =>
        cn.node.data.operation.id === opId && cn.modelName.includes(baseName)
    ).length + 1;

  const suffix = sameTypeCount > 1 ? `_${sameTypeCount}` : "";

  switch (opId) {
    case "select":
      return `int_${baseName}_selected${suffix}`;
    case "filter":
      return `int_${baseName}_filtered${suffix}`;
    case "join": {
      const leftName = parentModels[0] || "left";
      const rightName = parentModels[1] || "right";
      return `int_${leftName}_join_${rightName}${suffix}`;
    }
    case "aggregate":
      return `int_${baseName}_aggregated${suffix}`;
    case "group-by":
      return `int_${baseName}_grouped${suffix}`;
    case "union":
      return `int_${baseName}_union${suffix}`;
    default:
      return `int_${baseName}_transformed${suffix}`;
  }
}

// =============================================================================
// SQL Generation
// =============================================================================

/**
 * Generates SQL for a single classified node.
 */
function generateSQLForNode(
  classified: ClassifiedNode,
  allClassified: ClassifiedNode[],
  columnTypes: Map<string, string>,
  sourceReferences: Map<string, SourceReference>,
  generatedModelNames: Map<string, string> = new Map()
): string {
  const { node, layer, modelName, dependencies } = classified;
  const opId = node.data.operation.id;
  const params = node.data.params || {};

  const parentModels = dependencies
    .map((depId) => {
      const generatedName = generatedModelNames.get(depId);
      if (generatedName) return generatedName;
      const parent = allClassified.find((cn) => cn.node.id === depId);
      return parent ? parent.modelName : null;
    })
    .filter(Boolean) as string[];

  let sql = "";

  // Header comment
  sql += `{#\n  Model: ${modelName}\n  Layer: ${layer}\n  Operation: ${node.data.operation.label}\n#}\n\n`;

  switch (opId) {
    case "source-table":
      return sql + generateStagingSQL(params, sourceReferences.get(node.id));

    case "select":
      return sql + generateSelectSQL(parentModels, params);

    case "filter":
      return (
        sql +
        generateFilterSQL(parentModels, params, classified.columns, columnTypes)
      );

    case "join":
      return sql + generateJoinSQL(parentModels, params, allClassified);

    case "aggregate":
    case "group-by":
      return sql + generateAggregateSQL(parentModels, params);

    case "union":
      return sql + generateUnionSQL(parentModels);

    case "sort":
      return sql + generateSortSQL(parentModels, params);

    case "custom-sql":
      return sql + generateCustomSQL(parentModels, params);

    case "dbt-model":
      return sql + generateOutputSQL(parentModels, classified.columns);

    default:
      return (
        sql + `SELECT * FROM {{ ref('${parentModels[0] || "upstream"}') }}`
      );
  }
}

/**
 * Generates SQL for staging models (source tables).
 */
function generateStagingSQL(
  params: Record<string, unknown>,
  sourceReference?: SourceReference
): string {
  const tableName =
    sourceReference?.tableName ||
    params.table ||
    params.tableName ||
    params.name ||
    "unknown";
  const sourceName =
    sourceReference?.sourceName || params.database || "source";

  const columns = params.columns as
    | Array<{ name: string; type: string; alias?: string }>
    | undefined;

  let sql = "SELECT\n";

  if (columns?.length) {
    const columnList = columns
      .map((col) => {
        if (col.alias) {
          return `  ${quoteIdentifier(col.name)} AS ${quoteIdentifier(col.alias)}`;
        }
        return `  ${quoteIdentifier(col.name)}`;
      })
      .join(",\n");
    sql += columnList;
  } else {
    sql += "  *";
  }

  sql += `\nFROM {{ source('${sourceName}', '${tableName}') }}`;

  return sql;
}

/**
 * Generates SQL for SELECT operations.
 */
function generateSelectSQL(
  parentModels: string[],
  params: Record<string, unknown>
): string {
  const columns = params.columns as
    | Array<{ original: string; alias?: string }>
    | undefined;
  const fromModel = parentModels[0] || "upstream";

  let sql = "SELECT\n";

  if (columns?.length) {
    const columnList = columns
      .map((col) => {
        if (col.alias) {
          return `  ${quoteIdentifier(col.original)} AS ${quoteIdentifier(col.alias)}`;
        }
        return `  ${quoteIdentifier(col.original)}`;
      })
      .join(",\n");
    sql += columnList;
  } else {
    sql += "  *";
  }

  sql += `\nFROM {{ ref('${fromModel}') }}`;

  return sql;
}

/**
 * Generates SQL for FILTER operations with WHERE clause.
 */
function generateFilterSQL(
  parentModels: string[],
  params: Record<string, unknown>,
  columns: string[],
  columnTypes: Map<string, string>
): string {
  const fromModel = parentModels[0] || "upstream";

  let sql = "SELECT\n";
  if (columns.length > 0 && columns[0] !== "*") {
    const columnList = columns
      .map((col) => `  ${quoteIdentifier(col)}`)
      .join(",\n");
    sql += columnList;
  } else {
    sql += "  *";
  }

  sql += `\nFROM {{ ref('${fromModel}') }}`;

  if (params.condition) {
    const whereClause = buildFilterSQL(
      params.condition as FilterNode,
      columnTypes
    );
    if (whereClause) {
      sql += `\nWHERE ${whereClause}`;
    }
  }

  return sql;
}

/**
 * Generates SQL for JOIN operations.
 */
function generateJoinSQL(
  parentModels: string[],
  params: Record<string, unknown>,
  allClassified: ClassifiedNode[]
): string {
  const leftModel = parentModels[0] || "left";
  const rightModel = parentModels[1] || "right";
  const joinType = params.type || "INNER";
  const joinCondition = params.on as
    | { leftColumn: string; operator: string; rightColumn: string }
    | undefined;

  const leftNode = allClassified.find((cn) => cn.modelName === leftModel);
  const rightNode = allClassified.find((cn) => cn.modelName === rightModel);

  const leftCols = leftNode?.columns || [];
  const rightCols = rightNode?.columns || [];

  let sql = "SELECT\n";

  if (leftCols.length > 0 && leftCols[0] !== "*") {
    const leftSelect = leftCols
      .map((col) => `  l.${quoteIdentifier(col)}`)
      .join(",\n");
    sql += leftSelect;

    if (rightCols.length > 0 && rightCols[0] !== "*") {
      const rightSelect = rightCols
        .filter((col) => !leftCols.includes(col))
        .map((col) => `  r.${quoteIdentifier(col)}`)
        .join(",\n");

      if (rightSelect) {
        sql += ",\n" + rightSelect;
      }
    } else {
      sql += ",\n  r.*";
    }
  } else {
    sql += "  l.*,\n  r.*";
  }

  sql += `\nFROM {{ ref('${leftModel}') }} AS l\n`;
  sql += `${joinType} JOIN {{ ref('${rightModel}') }} AS r\n`;

  if (joinCondition?.leftColumn && joinCondition?.rightColumn) {
    sql += `  ON l.${quoteIdentifier(joinCondition.leftColumn)} ${joinCondition.operator} r.${quoteIdentifier(joinCondition.rightColumn)}`;
  } else {
    sql += `  ON TRUE -- Configure join condition`;
  }

  return sql;
}

/**
 * Generates SQL for aggregate/GROUP BY operations.
 */
function generateAggregateSQL(
  parentModels: string[],
  params: Record<string, unknown>
): string {
  const fromModel = parentModels[0] || "upstream";

  const groupByColumns = Array.isArray(params.columns)
    ? params.columns
    : typeof params.columns === "string"
    ? params.columns
        .split(",")
        .map((c: string) => c.trim())
        .filter(Boolean)
    : [];

  interface Aggregation {
    id: string;
    function: string;
    column: string;
    alias: string;
  }

  const aggregations = Array.isArray(params.aggregations)
    ? (params.aggregations as Aggregation[])
    : [];

  let sql = "SELECT\n";

  if (groupByColumns.length > 0) {
    sql += groupByColumns
      .map((col) => `  ${quoteIdentifier(String(col))}`)
      .join(",\n");

    if (aggregations.length > 0) {
      sql += ",\n";
    }
  }

  if (aggregations.length > 0) {
    sql += aggregations
      .map((agg) => {
        const funcCall =
          agg.function === "COUNT(DISTINCT)"
            ? `COUNT(DISTINCT ${quoteColumn(agg.column)})`
            : `${agg.function}(${quoteColumn(agg.column)})`;

        const alias =
          agg.alias ||
          (() => {
            const cleanCol = agg.column
              .replace(/[*]/g, "all")
              .replace(/\s+/g, "_");
            return `${agg.function
              .toLowerCase()
              .replace(/\(|\)/g, "_")}_${cleanCol}`;
          })();

        return `  ${funcCall} AS ${quoteIdentifier(alias)}`;
      })
      .join(",\n");
  }

  if (groupByColumns.length === 0 && aggregations.length === 0) {
    sql += "  *";
  }

  sql += `\nFROM {{ ref('${fromModel}') }}`;

  if (groupByColumns.length > 0) {
    sql += "\nGROUP BY\n";
    sql += groupByColumns
      .map((col, i) => {
        const comma = i < groupByColumns.length - 1 ? "," : "";
        return `  ${quoteIdentifier(String(col))}${comma}`;
      })
      .join("\n");
  }

  return sql;
}

/**
 * Generates SQL for UNION operations.
 */
function generateUnionSQL(parentModels: string[]): string {
  return parentModels
    .map((model) => `SELECT * FROM {{ ref('${model}') }}`)
    .join("\n\nUNION ALL\n\n");
}

/** Generates a deterministic PostgreSQL/DuckDB ORDER BY step. */
function generateSortSQL(
  parentModels: string[],
  params: Record<string, unknown>
): string {
  const fromModel = parentModels[0] || "upstream";
  const column = String(params.column || "").trim();
  const direction = params.direction === "DESC" ? "DESC" : "ASC";
  return `SELECT *\nFROM {{ ref('${fromModel}') }}\nORDER BY ${quoteIdentifier(column)} ${direction}`;
}

/** Resolves the explicit parent placeholder used by Custom SQL nodes. */
function generateCustomSQL(
  parentModels: string[],
  params: Record<string, unknown>
): string {
  const fromModel = parentModels[0] || "upstream";
  const customSql = String(params.sql || "");
  const parentReference = `{{ ref('${fromModel}') }}`;
  return customSql
    .replace(/\{\{\s*parent\s*\}\}/gi, parentReference)
    .replace(/\{\{\s*source\s*\}\}/gi, parentReference);
}

/**
 * Generates SQL for the final output model.
 */
function generateOutputSQL(parentModels: string[], columns: string[]): string {
  const fromModel = parentModels[0] || "upstream";

  let sql = "SELECT\n";
  if (columns.length > 0 && columns[0] !== "*") {
    const columnList = columns
      .map((col) => `  ${quoteIdentifier(col)}`)
      .join(",\n");
    sql += columnList;
  } else {
    sql += "  *";
  }

  sql += `\nFROM {{ ref('${fromModel}') }}`;

  return sql;
}

// =============================================================================
// YAML Generation
// =============================================================================

/**
 * Generates sources.yml for a database node and its connected tables.
 */
function generateSourcesYmlForDatabaseNode(
  sourceName: string,
  database: string | undefined,
  schema: string,
  tableNodes: Node<OperationNodeData>[]
): string {
  const tables = tableNodes
    .map((node) => {
      const tableName =
        node.data.params?.table ||
        node.data.params?.tableName ||
        "unknown";
      return `      - name: ${yamlValue(tableName)}`;
    })
    .join("\n");

  const databaseLine = database
    ? `    database: ${yamlValue(database)}\n`
    : "";

  return `version: 2

sources:
  - name: ${yamlValue(sourceName)}
${databaseLine}    schema: ${yamlValue(schema)}
    tables:
${tables}
`;
}

/**
 * Generates a descriptive documentation string for a model.
 */
function generateModelDescription(node: ClassifiedNode): string {
  const opId = node.node.data.operation.id;
  const params = node.node.data.params || {};
  const deps = node.dependencies;
  const timestamp = new Date().toISOString().split("T")[0];

  const getUpstreamInfo = () => {
    if (deps.length === 0) return "";
    if (deps.length === 1)
      return `\n  Source: ${node.modelName.replace(
        /^(int|fct|stg)_/,
        ""
      )}_upstream`;
    return `\n  Sources: ${deps.length} upstream models`;
  };

  const formatFilterConditions = (condition: unknown): string[] => {
    const conditions: string[] = [];

    if (!condition) return conditions;

    const typedCondition = condition as {
      type?: string;
      column?: string;
      operator?: string;
      value?: unknown;
      children?: unknown[];
    };

    if (typedCondition.type === "condition") {
      const { column, operator, value } = typedCondition;
      conditions.push(`${column} ${operator} ${value}`);
    } else if (typedCondition.type === "group" && typedCondition.children) {
      typedCondition.children.forEach((child) => {
        const childConditions = formatFilterConditions(child);
        conditions.push(...childConditions);
      });
    }

    return conditions;
  };

  switch (opId) {
    case "filter": {
      const condition = params.condition;
      if (condition) {
        const conditions = formatFilterConditions(condition);
        if (conditions.length > 0) {
          const conditionsList = conditions.map((c) => `  - ${c}`).join("\n");
          return `Filtered data with ${conditions.length} condition${
            conditions.length > 1 ? "s" : ""
          }:\n${conditionsList}${getUpstreamInfo()}\n  \n  Generated: ${timestamp}`;
        }
      }
      return `Filtered data${getUpstreamInfo()}\n  Generated: ${timestamp}`;
    }

    case "join": {
      const joinType = params.type || "INNER";
      const joinCond = params.on as
        | { leftColumn?: string; rightColumn?: string }
        | undefined;

      let desc = `${joinType} join`;

      if (joinCond?.leftColumn && joinCond?.rightColumn) {
        desc += `\n  Condition: ${joinCond.leftColumn} = ${joinCond.rightColumn}`;
      }

      if (deps.length === 2) {
        desc += `\n  Left: upstream model 1`;
        desc += `\n  Right: upstream model 2`;
      }

      desc += `\n  \n  Generated: ${timestamp}`;
      return desc;
    }

    case "group-by": {
      const groupColsRaw = params.columns;
      const aggs = params.aggregations as unknown[] | undefined;

      let desc = "Aggregated data";

      if (groupColsRaw) {
        const cols = Array.isArray(groupColsRaw)
          ? groupColsRaw
          : typeof groupColsRaw === "string"
          ? groupColsRaw
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean)
          : [];

        if (cols.length > 0) {
          desc = `Grouped by:\n  - ` + cols.join("\n  - ");
        }
      }

      if (aggs?.length) {
        desc += `\n  \n  Aggregations:`;
        aggs.forEach((agg) => {
          const typedAgg = agg as {
            function?: string;
            column?: string;
            alias?: string;
          };
          if (typedAgg.function && typedAgg.column) {
            desc += `\n  - ${typedAgg.function}(${typedAgg.column})`;
            if (typedAgg.alias) desc += ` as ${typedAgg.alias}`;
          }
        });
      }

      desc += `${getUpstreamInfo()}\n  Generated: ${timestamp}`;
      return desc;
    }

    case "select": {
      const columns = params.columns as
        | Array<{ original: string; alias?: string }>
        | undefined;

      if (columns?.length) {
        const colList = columns
          .slice(0, 10)
          .map((col) => {
            if (col.alias && col.alias !== col.original) {
              return `  - ${col.original} → ${col.alias}`;
            }
            return `  - ${col.original}`;
          })
          .join("\n");

        let desc = `Selected ${columns.length} column${
          columns.length > 1 ? "s" : ""
        }:\n${colList}`;

        if (columns.length > 10) {
          desc += `\n  - ... and ${columns.length - 10} more`;
        }

        desc += `${getUpstreamInfo()}\n  Generated: ${timestamp}`;
        return desc;
      }
      return `Selected columns${getUpstreamInfo()}\n  Generated: ${timestamp}`;
    }

    case "union":
      return `Union of ${deps.length} datasets\n  Combines all rows from upstream models\n  \n  Generated: ${timestamp}`;

    case "dbt-model": {
      const modelName = params.name || "output";
      return `Final output model: ${modelName}\n  Mart layer model for analytics\n  ${getUpstreamInfo()}\n  Generated: ${timestamp}`;
    }

    case "source-table": {
      const tableName = params.table || params.name || "source";
      return `Source table: ${tableName}\n  Raw data from source system\n  Layer: staging\n  \n  Generated: ${timestamp}`;
    }

    default:
      return `${
        node.node.data.operation.label
      } transformation${getUpstreamInfo()}\n  Generated: ${timestamp}`;
  }
}

/**
 * Generates schema.yml with model and column documentation.
 */
function generateSchemaYml(classifiedNodes: ClassifiedNode[]): string {
  const modelEntries = classifiedNodes
    .filter((cn) => cn.layer !== "staging")
    .map((cn) => {
      const columns = cn.columns || [];
      const description = generateModelDescription(cn);

      let entry = `  - name: ${cn.modelName}\n`;
      entry += `    description: |\n`;
      const descriptionLines = description.split("\n");
      descriptionLines.forEach((line) => {
        entry += `      ${line}\n`;
      });

      if (columns.length > 0 && columns[0] !== "*") {
        entry += `    columns:\n`;
        columns.forEach((col) => {
          entry += `      - name: ${yamlValue(col)}\n`;
          entry += `        description: ${yamlValue(`${col} column`)}\n`;
        });
      }

      return entry;
    })
    .join("\n\n");

  return `version: 2\n\nmodels:\n${modelEntries}\n`;
}

/**
 * Generates dbt_project.yml configuration file.
 */
function generateDbtProjectYml(projectName: string): string {
  const sanitizedName = sanitizeName(projectName);

  return `name: '${sanitizedName}'
version: '1.0.0'
config-version: 2

profile: '${sanitizedName}'

model-paths: ["models"]
analysis-paths: ["analyses"]
test-paths: ["tests"]
seed-paths: ["seeds"]
macro-paths: ["macros"]
snapshot-paths: ["snapshots"]

clean-targets:
  - "target"
  - "dbt_packages"

models:
  ${sanitizedName}:
    staging:
      +materialized: view
    intermediate:
      +materialized: ephemeral
    marts:
      +materialized: table
`;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Sanitizes a name for SQL/dbt compatibility.
 * Converts to lowercase, replaces invalid characters with underscores.
 */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
}
