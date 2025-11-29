import type { Node, Edge } from "reactflow";
import type { OperationDefinition } from "../definitions/operations";

// Type pour les données des nodes
type OperationNodeData = {
  operation: OperationDefinition;
  params: Record<string, any>;
};

// Type pour les fichiers générés
export interface GeneratedFile {
  path: string;
  content: string;
}

// Type pour le résultat de la génération
export interface DbtModelOutput {
  files: GeneratedFile[];
  errors: string[];
}

// Type pour un nœud classifié
type ClassifiedNode = {
  node: Node<OperationNodeData>;
  layer: "staging" | "intermediate" | "mart";
  modelName: string;
  filePath: string;
  dependencies: string[]; // IDs des nœuds parents
  columns: string[]; // Colonnes de sortie du modèle
};

/**
 * Récupère les colonnes de sortie d'un modèle
 */
function getModelColumns(
  node: Node<OperationNodeData>,
  dependencies: string[],
  allClassified: ClassifiedNode[]
): string[] {
  const opId = node.data.operation.id;
  const params = node.data.params || {};

  switch (opId) {
    case "source-table":
    case "source-manual": {
      // Pour les sources : utiliser les colonnes avec alias
      const columns = params.columns as
        | Array<{ name: string; alias?: string }>
        | undefined;
      if (columns && columns.length > 0) {
        return columns.map((col) => col.alias || col.name);
      }
      return ["*"];
    }

    case "select": {
      // Pour SELECT : utiliser les colonnes sélectionnées
      const selectCols = params.columns as
        | Array<{ original: string; alias?: string }>
        | undefined;
      if (selectCols && selectCols.length > 0) {
        return selectCols.map((col) => col.alias || col.original);
      }
      // Si pas de colonnes spécifiques, hériter du parent
      if (dependencies.length > 0) {
        const parentNode = allClassified.find(
          (cn) => cn.node.id === dependencies[0]
        );
        return parentNode?.columns || ["*"];
      }
      return ["*"];
    }

    case "filter": {
      // Filter : hériter les colonnes du parent
      if (dependencies.length > 0) {
        const parentNode = allClassified.find(
          (cn) => cn.node.id === dependencies[0]
        );
        return parentNode?.columns || ["*"];
      }
      return ["*"];
    }

    case "join": {
      // Join : combiner les colonnes left et right
      if (dependencies.length >= 2) {
        const leftNode = allClassified.find(
          (cn) => cn.node.id === dependencies[0]
        );
        const rightNode = allClassified.find(
          (cn) => cn.node.id === dependencies[1]
        );

        const leftCols = leftNode?.columns || [];
        const rightCols = rightNode?.columns || [];

        // Combiner, en évitant les doublons (préférer left en cas de conflit)
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
      // Group by : colonnes groupées + agrégations
      const groupCols = ((params.columns as string) || "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const aggregations = params.aggregations as string | undefined;

      const cols = [...groupCols];
      if (aggregations) {
        // Extraire les alias des agrégations (ex: "sum(amount) as total" -> "total")
        // Pour simplifier, on garde l'agrégation complète
        const aggList = aggregations
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean);
        aggList.forEach((agg) => {
          // Essayer d'extraire l'alias si présent
          const asMatch = agg.match(/\s+as\s+(\w+)/i);
          if (asMatch) {
            cols.push(asMatch[1]);
          } else {
            // Générer le même alias que dans generateAggregateSQL
            const funcMatch = agg.match(/^(\w+)\s*\(([^)]+)\)/i);
            if (funcMatch) {
              const [, func, col] = funcMatch;
              const cleanCol = col.replace(/[*]/g, "all").replace(/\s+/g, "_");
              const alias = `${func.toLowerCase()}_${cleanCol}`;
              cols.push(alias);
            } else {
              // Fallback : garder l'expression complète
              cols.push(agg);
            }
          }
        });
      }

      return cols.length > 0 ? cols : ["*"];
    }

    case "union":
    case "aggregate": {
      // Union/Aggregate : hériter du premier parent
      if (dependencies.length > 0) {
        const parentNode = allClassified.find(
          (cn) => cn.node.id === dependencies[0]
        );
        return parentNode?.columns || ["*"];
      }
      return ["*"];
    }

    case "dbt-model": {
      // Model output : hériter du parent
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

/**
 * Génère un projet dbt complet à partir d'un flowchart
 */
export function generateDbtModel(
  nodes: Node<OperationNodeData>[],
  edges: Edge[],
  projectName: string
): DbtModelOutput {
  const files: GeneratedFile[] = [];
  const errors: string[] = [];

  try {
    // 1. Validation
    if (nodes.length === 0) {
      errors.push("No nodes in the model");
      return { files, errors };
    }

    // Trouver le nœud Model Output
    const outputNode = nodes.find((n) => n.data.operation.id === "dbt-model");
    if (!outputNode) {
      errors.push("No Model Output node found");
      return { files, errors };
    }

    // 2. Construire le graphe de dépendances
    const dependencyGraph = buildDependencyGraph(edges);

    // 3. Classifier tous les nœuds (staging, intermediate, mart)
    const classifiedNodes = classifyNodes(
      nodes,
      edges,
      dependencyGraph,
      outputNode
    );

    // 4. Générer sources.yml basé sur les nœuds Database et leurs Tables connectées
    const databaseNodes = nodes.filter(
      (n) => n.data.operation.id === "database"
    );
    databaseNodes.forEach((dbNode) => {
      // Trouver toutes les tables connectées à cette database
      const connectedTableNodes = edges
        .filter((edge) => edge.source === dbNode.id)
        .map((edge) => nodes.find((n) => n.id === edge.target))
        .filter(
          (n) => n && n.data.operation.id === "source-table"
        ) as Node<OperationNodeData>[];

      if (connectedTableNodes.length > 0) {
        // Extraire le nom de la database depuis l'adapter
        const adapterConfig = dbNode.data.params?.adapter as
          | { type: string; config?: Record<string, any> }
          | undefined;
        const dbName =
          adapterConfig?.config?.database ||
          adapterConfig?.type ||
          sanitizeName(dbNode.id);
        const schema = adapterConfig?.config?.schema || "public";

        // Générer sources.yml pour cette database
        const content = generateSourcesYmlForDatabaseNode(
          dbName,
          schema,
          connectedTableNodes
        );
        files.push({
          path: `models/staging/${sanitizeName(dbName)}/sources.yml`,
          content,
        });
      }
    });

    // 5. Générer un fichier SQL pour chaque nœud
    classifiedNodes.forEach((cn) => {
      const sql = generateSQLForNode(
        cn,
        classifiedNodes,
        dependencyGraph,
        nodes,
        edges
      );
      files.push({
        path: cn.filePath,
        content: sql,
      });
    });

    // 6. Générer schema.yml global
    const schemaYml = generateSchemaYml(classifiedNodes, projectName);
    files.push({
      path: `models/schema.yml`,
      content: schemaYml,
    });

    // 7. Créer dbt_project.yml
    const dbtProjectYml = generateDbtProjectYml(projectName);
    files.push({
      path: `dbt_project.yml`,
      content: dbtProjectYml,
    });
  } catch (error) {
    errors.push(
      `Generation error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return { files, errors };
}

/**
 * Construit un graphe de dépendances (id -> [parent ids])
 */
function buildDependencyGraph(edges: Edge[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();

  edges.forEach((edge) => {
    if (!graph.has(edge.target)) {
      graph.set(edge.target, []);
    }
    graph.get(edge.target)!.push(edge.source);
  });

  return graph;
}

/**
 * Classifier les nœuds en staging, intermediate, ou mart
 */
function classifyNodes(
  nodes: Node<OperationNodeData>[],
  edges: Edge[],
  dependencyGraph: Map<string, string[]>,
  outputNode: Node<OperationNodeData>
): ClassifiedNode[] {
  const classified: ClassifiedNode[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const processed = new Set<string>();

  // Helper function to classify a single node
  const classifyNode = (node: Node<OperationNodeData>) => {
    if (processed.has(node.id)) return;

    const opId = node.data.operation.id;
    const dependencies = dependencyGraph.get(node.id) || [];

    // Skip database nodes - they only generate sources.yml, not models
    if (opId === "database") {
      processed.add(node.id);
      return;
    }

    // First, ensure all dependencies are processed
    dependencies.forEach((depId) => {
      const depNode = nodeMap.get(depId);
      if (depNode && !processed.has(depId)) {
        classifyNode(depNode);
      }
    });

    let layer: "staging" | "intermediate" | "mart";
    let modelName: string;
    let filePath: string;

    if (opId === "source-table" || opId === "source-manual") {
      // Staging layer
      layer = "staging";
      const tableName =
        node.data.params?.table ||
        node.data.params?.tableName ||
        node.data.params?.name ||
        "unknown";
      const database = node.data.params?.database || "default";
      modelName = `stg_${sanitizeName(tableName)}`;
      filePath = `models/staging/${sanitizeName(database)}/${modelName}.sql`;
    } else if (node.id === outputNode.id) {
      // Mart layer (final output)
      layer = "mart";
      const outputName = node.data.params?.name || "output";
      const domain = "core"; // Could be extracted from params
      modelName = `fct_${sanitizeName(outputName)}`;
      filePath = `models/marts/${domain}/${modelName}.sql`;
    } else {
      // Intermediate layer
      layer = "intermediate";
      modelName = generateIntermediateName(
        node,
        nodeMap,
        dependencyGraph,
        classified
      );
      filePath = `models/intermediate/${modelName}.sql`;
    }

    // Calculate output columns for this node
    const columns = getModelColumns(node, dependencies, classified);

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

  // Process all nodes in topological order
  nodes.forEach((node) => classifyNode(node));

  return classified;
}

/**
 * Générer un nom pour un modèle intermédiaire
 */
function generateIntermediateName(
  node: Node<OperationNodeData>,
  nodeMap: Map<string, Node<OperationNodeData>>,
  dependencyGraph: Map<string, string[]>,
  allClassified: ClassifiedNode[]
): string {
  const opId = node.data.operation.id;
  const deps = dependencyGraph.get(node.id) || [];

  // Get parent model names from already classified nodes
  const parentModels = deps
    .map((depId) => {
      const classified = allClassified.find((cn) => cn.node.id === depId);
      if (classified) {
        // Extract base name from parent model (remove int_ prefix and operation suffix)
        const modelName = classified.modelName;
        // For staging models (stg_xxx), remove stg_ prefix
        if (modelName.startsWith("stg_")) {
          return modelName.substring(4);
        }
        // For intermediate models, extract the base name
        if (modelName.startsWith("int_")) {
          // Remove int_ and everything after the first operation keyword
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

      // Fallback to params if not classified yet
      const depNode = nodeMap.get(depId);
      if (!depNode) return null;
      const tableName =
        depNode.data.params?.tableName || depNode.data.params?.name;
      return tableName ? sanitizeName(tableName) : null;
    })
    .filter(Boolean) as string[];

  const baseName = parentModels.length > 0 ? parentModels[0] : "data";

  // Count how many nodes of this type operate on the same base
  const sameTypeCount =
    allClassified.filter(
      (cn) =>
        cn.node.data.operation.id === opId && cn.modelName.includes(baseName)
    ).length + 1; // +1 for current node

  const suffix = sameTypeCount > 1 ? `_${sameTypeCount}` : "";

  switch (opId) {
    case "select":
      return `int_${baseName}_selected${suffix}`;
    case "filter":
      return `int_${baseName}_filtered${suffix}`;
    case "join":
      const leftName = parentModels[0] || "left";
      const rightName = parentModels[1] || "right";
      return `int_${leftName}_join_${rightName}${suffix}`;
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

/**
 * Générer le SQL pour un nœud donné
 */
function generateSQLForNode(
  classified: ClassifiedNode,
  allClassified: ClassifiedNode[],
  dependencyGraph: Map<string, string[]>,
  nodes: Node<OperationNodeData>[],
  edges: Edge[]
): string {
  const { node, layer, modelName, dependencies } = classified;
  const opId = node.data.operation.id;
  const params = node.data.params || {};

  // Trouver les modèles parents
  const parentModels = dependencies
    .map((depId) => {
      const parent = allClassified.find((cn) => cn.node.id === depId);
      return parent ? parent.modelName : null;
    })
    .filter(Boolean) as string[];

  let sql = "";

  // Header comment
  sql += `{#\n  Model: ${modelName}\n  Layer: ${layer}\n  Operation: ${node.data.operation.label}\n#}\n\n`;

  // Config block
  if (layer === "mart") {
    const materializationType = params.materialization || "view";
    sql += `{{ config(\n  materialized='${materializationType}'\n) }}\n\n`;
  }

  switch (opId) {
    case "source-table":
      // Trouver le nœud Database parent
      const databaseNodeId = dependencies[0]; // Le parent devrait être le Database node
      const databaseNode = nodes.find((n) => n.id === databaseNodeId);
      return sql + generateStagingSQL(node, params, databaseNode);

    case "source-manual":
      return sql + generateStagingSQL(node, params);

    case "select":
      return sql + generateSelectSQL(parentModels, params);

    case "filter":
      return sql + generateFilterSQL(parentModels, params, classified.columns);

    case "join":
      return (
        sql + generateJoinSQL(parentModels, params, dependencies, allClassified)
      );

    case "aggregate":
      return sql + generateAggregateSQL(parentModels, params);

    case "group-by":
      return sql + generateAggregateSQL(parentModels, params);

    case "union":
      return sql + generateUnionSQL(parentModels);

    case "dbt-model":
      // Final model output - just select from upstream
      return sql + generateOutputSQL(parentModels, classified.columns);

    default:
      return (
        sql + `SELECT * FROM {{ ref('${parentModels[0] || "upstream"}') }}`
      );
  }
}

/**
 * Générer SQL pour staging (source)
 */
function generateStagingSQL(
  node: Node<OperationNodeData>,
  params: Record<string, any>,
  databaseNode?: Node<OperationNodeData>
): string {
  const tableName =
    params.table || params.tableName || params.name || "unknown";

  let database: string;
  let schema: string;

  if (databaseNode) {
    // Extraire les infos depuis le nœud Database parent
    const adapterConfig = databaseNode.data.params?.adapter as
      | { type: string; config?: Record<string, any> }
      | undefined;
    database = adapterConfig?.config?.database || adapterConfig?.type || "raw";
    schema = adapterConfig?.config?.schema || "public";
  } else {
    // Fallback pour Manual Table (pas de Database parent)
    database = params.database || "raw";
    schema = params.schema || "public";
  }

  const columns = params.columns as
    | Array<{ name: string; type: string; alias?: string }>
    | undefined;

  let sql = "SELECT\n";

  if (columns && columns.length > 0) {
    const columnList = columns
      .map((col) => {
        if (col.alias) {
          return `  ${col.name} AS ${col.alias}`;
        }
        return `  ${col.name}`;
      })
      .join(",\n");
    sql += columnList;
  } else {
    sql += "  *";
  }

  sql += `\nFROM {{ source('${database}', '${tableName}') }}`;

  return sql;
}

/**
 * Générer SQL pour select
 */
function generateSelectSQL(
  parentModels: string[],
  params: Record<string, any>
): string {
  const columns = params.columns as
    | Array<{ original: string; alias?: string }>
    | undefined;
  const fromModel = parentModels[0] || "upstream";

  let sql = "SELECT\n";

  if (columns && columns.length > 0) {
    const columnList = columns
      .map((col) => {
        if (col.alias) {
          return `  ${col.original} AS ${col.alias}`;
        }
        return `  ${col.original}`;
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
 * Générer SQL pour filter
 */
function generateFilterSQL(
  parentModels: string[],
  params: Record<string, any>,
  columns: string[]
): string {
  const fromModel = parentModels[0] || "upstream";

  // Generate explicit column selection
  let sql = "SELECT\n";
  if (columns.length > 0 && columns[0] !== "*") {
    const columnList = columns.map((col) => `  ${col}`).join(",\n");
    sql += columnList;
  } else {
    sql += "  *";
  }

  sql += `\nFROM {{ ref('${fromModel}') }}`;

  // Handle FilterGroup structure
  if (params.condition) {
    const whereClause = buildFilterSQL(params.condition);
    if (whereClause) {
      sql += `\nWHERE ${whereClause}`;
    }
  }

  return sql;
}

/**
 * Helper pour construire le SQL de filtres récursifement
 */
function buildFilterSQL(node: any): string {
  if (!node) return "";

  if (node.type === "condition") {
    if (!node.column) return "";
    if (node.operator === "IS NULL" || node.operator === "IS NOT NULL") {
      return `${node.column} ${node.operator}`;
    }
    const val = node.value;
    const isNumber = !isNaN(parseFloat(val)) && isFinite(val);
    const isQuoted = val.startsWith("'") && val.endsWith("'");
    const finalVal = !isNumber && !isQuoted ? `'${val}'` : val;
    return `${node.column} ${node.operator} ${finalVal}`;
  }

  if (node.type === "group") {
    if (!node.children || node.children.length === 0) return "";

    const parts: string[] = [];
    for (let i = 0; i < node.children.length; i++) {
      const childSQL = buildFilterSQL(node.children[i]);
      if (childSQL) {
        if (i > 0) {
          const op = node.operators?.[i - 1] || "AND";
          parts.push(op);
        }
        parts.push(childSQL);
      }
    }

    if (parts.length === 0) return "";

    // Only add parentheses if:
    // - Multiple children (more than 1 part that's not an operator)
    // - Contains OR operator (needs grouping)
    const hasMultipleConditions =
      parts.filter((p) => p !== "AND" && p !== "OR").length > 1;
    const hasOrOperator = parts.includes("OR");

    if (hasMultipleConditions || hasOrOperator) {
      return `(${parts.join(" ")})`;
    }

    // Single condition without grouping needed
    return parts.join(" ");
  }

  return "";
}

/**
 * Générer SQL pour join
 */
function generateJoinSQL(
  parentModels: string[],
  params: Record<string, any>,
  dependencies: string[],
  allClassified: ClassifiedNode[]
): string {
  const leftModel = parentModels[0] || "left";
  const rightModel = parentModels[1] || "right";
  const joinType = params.type || "INNER";
  const joinCondition = params.on as
    | { leftColumn: string; operator: string; rightColumn: string }
    | undefined;

  // Get columns from left and right models
  const leftNode = allClassified.find((cn) => cn.modelName === leftModel);
  const rightNode = allClassified.find((cn) => cn.modelName === rightModel);

  const leftCols = leftNode?.columns || [];
  const rightCols = rightNode?.columns || [];

  let sql = "SELECT\n";

  // Generate explicit column selection
  if (leftCols.length > 0 && leftCols[0] !== "*") {
    // Add all left columns with l. prefix
    const leftSelect = leftCols.map((col) => `  l.${col}`).join(",\n");
    sql += leftSelect;

    if (rightCols.length > 0 && rightCols[0] !== "*") {
      // Add right columns that don't conflict with left
      const rightSelect = rightCols
        .filter((col) => !leftCols.includes(col))
        .map((col) => `  r.${col}`)
        .join(",\n");

      if (rightSelect) {
        sql += ",\n" + rightSelect;
      }
    } else {
      // Fallback to r.* if right columns unknown
      sql += ",\n  r.*";
    }
  } else {
    // Fallback to SELECT * if columns not tracked
    sql += "  l.*,\n  r.*";
  }

  sql += `\nFROM {{ ref('${leftModel}') }} AS l\n`;
  sql += `${joinType} JOIN {{ ref('${rightModel}') }} AS r\n`;

  if (joinCondition && joinCondition.leftColumn && joinCondition.rightColumn) {
    sql += `  ON l.${joinCondition.leftColumn} ${joinCondition.operator} r.${joinCondition.rightColumn}`;
  } else {
    sql += `  ON TRUE -- Configure join condition`;
  }

  return sql;
}

/**
 * Générer SQL pour aggregate
 */
function generateAggregateSQL(
  parentModels: string[],
  params: Record<string, any>
): string {
  const fromModel = parentModels[0] || "upstream";
  const groupByColumns = params.columns || "";
  const aggregations = params.aggregations as string | undefined;

  let sql = "SELECT\n";

  if (groupByColumns) {
    const groupCols = groupByColumns
      .split(",")
      .map((c: string) => c.trim())
      .filter(Boolean);
    sql += groupCols.map((col: string) => `  ${col}`).join(",\n");

    if (aggregations) {
      sql += ",\n";
      // Parse aggregations string - e.g., "sum(sales_amount)" or "sum(amount), count(*)"
      const aggList = aggregations
        .split(",")
        .map((a: string) => a.trim())
        .filter(Boolean);

      // Add alias if not present
      sql += aggList
        .map((agg: string) => {
          // Check if already has AS alias
          if (/\s+as\s+/i.test(agg)) {
            return `  ${agg}`;
          }

          // Generate alias from function name
          // Extract: sum(amount) -> total_amount, count(*) -> count_all, etc.
          const match = agg.match(/^(\w+)\s*\(([^)]+)\)/i);
          if (match) {
            const [, func, col] = match;
            const cleanCol = col.replace(/[*]/g, "all").replace(/\s+/g, "_");
            const alias = `${func.toLowerCase()}_${cleanCol}`;
            return `  ${agg} AS ${alias}`;
          }

          return `  ${agg}`;
        })
        .join(",\n");
    }

    sql += `\nFROM {{ ref('${fromModel}') }}`;
    sql += `\nGROUP BY ${groupCols.join(", ")}`;
  } else {
    sql += "  *\n";
    sql += `FROM {{ ref('${fromModel}') }}`;
  }

  return sql;
}

/**
 * Générer SQL pour union
 */
function generateUnionSQL(parentModels: string[]): string {
  let sql = parentModels
    .map((model) => `SELECT * FROM {{ ref('${model}') }}`)
    .join("\n\nUNION ALL\n\n");

  return sql;
}

/**
 * Générer SQL pour output (Model Output)
 */
function generateOutputSQL(parentModels: string[], columns: string[]): string {
  const fromModel = parentModels[0] || "upstream";

  // Generate explicit column selection
  let sql = "SELECT\n";
  if (columns.length > 0 && columns[0] !== "*") {
    const columnList = columns.map((col) => `  ${col}`).join(",\n");
    sql += columnList;
  } else {
    sql += "  *";
  }

  sql += `\nFROM {{ ref('${fromModel}') }}`;

  return sql;
}

/**
 * Générer sources.yml pour un nœud Database et ses tables connectées
 */
function generateSourcesYmlForDatabaseNode(
  database: string,
  schema: string,
  tableNodes: Node<OperationNodeData>[]
): string {
  const tables = tableNodes
    .map((node) => {
      const tableName =
        node.data.params?.table || node.data.params?.tableName || "unknown";
      return `      - name: ${tableName}`;
    })
    .join("\n");

  return `version: 2

sources:
  - name: ${database}
    schema: ${schema}
    tables:
${tables}
`;
}

/**
 * Générer une description informative pour un modèle
 */
function generateModelDescription(node: ClassifiedNode): string {
  const opId = node.node.data.operation.id;
  const params = node.node.data.params || {};
  const deps = node.dependencies;

  switch (opId) {
    case "filter": {
      const condition = params.condition;
      if (condition && condition.children && condition.children.length > 0) {
        const numConditions = condition.children.length;
        return `Filtered data with ${numConditions} condition${
          numConditions > 1 ? "s" : ""
        }`;
      }
      return "Filtered data";
    }

    case "join": {
      const joinType = params.type || "INNER";
      const joinCond = params.on as
        | { leftColumn?: string; rightColumn?: string }
        | undefined;
      if (joinCond?.leftColumn && joinCond?.rightColumn) {
        return `${joinType} joined on ${joinCond.leftColumn} = ${joinCond.rightColumn}`;
      }
      return `${joinType} joined data`;
    }

    case "group-by": {
      const groupCols = params.columns as string | undefined;
      const aggs = params.aggregations as string | undefined;
      if (groupCols) {
        const cols = groupCols
          .split(",")
          .map((c) => c.trim())
          .join(", ");
        if (aggs) {
          return `Grouped by ${cols} with aggregations: ${aggs}`;
        }
        return `Grouped by ${cols}`;
      }
      return "Aggregated data";
    }

    case "select": {
      const columns = params.columns as Array<{ original: string }> | undefined;
      if (columns && columns.length > 0) {
        return `Selected ${columns.length} column${
          columns.length > 1 ? "s" : ""
        }`;
      }
      return "Selected columns";
    }

    case "union":
      return `Union of ${deps.length} datasets`;

    case "dbt-model": {
      const modelName = params.name || "output";
      return `Final ${modelName} model`;
    }

    default:
      return `${node.node.data.operation.label} transformation`;
  }
}

/**
 * Générer schema.yml global
 */
function generateSchemaYml(
  classifiedNodes: ClassifiedNode[],
  projectName: string
): string {
  const modelEntries = classifiedNodes
    .filter((cn) => cn.layer !== "staging") // Sources are documented in sources.yml
    .map((cn) => {
      const columns = cn.columns || [];

      // Find primary key - look for first column ending with '_id'
      const pkCol = columns.find((col) => col.endsWith("_id")) || columns[0];

      // Generate informative description
      const description = generateModelDescription(cn);

      let entry = `  - name: ${cn.modelName}\n`;
      entry += `    description: "${description}"\n`;
      entry += `    columns:\n`;

      // Document all columns
      if (columns.length > 0 && columns[0] !== "*") {
        columns.forEach((col) => {
          entry += `      - name: ${col}\n`;
          entry += `        description: "${col} column"\n`;

          // Add tests only on the primary key
          if (col === pkCol) {
            entry += `        tests:\n`;
            entry += `          - unique\n`;
            entry += `          - not_null\n`;
          }
        });
      } else {
        // Fallback si pas de colonnes trackées
        entry += `      - name: id\n`;
        entry += `        description: "Primary identifier"\n`;
        entry += `        tests:\n`;
        entry += `          - unique\n`;
        entry += `          - not_null\n`;
      }

      return entry;
    })
    .join("\n\n");

  return `version: 2\n\nmodels:\n${modelEntries}\n`;
}

/**
 * Générer dbt_project.yml
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

/**
 * Sanitize un nom pour le rendre compatible SQL/dbt
 */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
}
