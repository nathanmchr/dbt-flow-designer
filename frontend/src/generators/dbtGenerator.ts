import type { Node, Edge } from "reactflow";
import type { OperationDefinition } from "../definitions/operations";
import { PipelineOptimizer } from "./pipelineOptimizer";
import { generateCombinedSQL } from "./cteHelpers";

// Type pour les données des nodes
export type OperationNodeData = {
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
export type ClassifiedNode = {
  node: Node<OperationNodeData>;
  layer: "staging" | "intermediate" | "mart";
  modelName: string;
  filePath: string;
  dependencies: string[]; // IDs des nœuds parents
  columns: string[]; // Colonnes de sortie du modèle
};

// Type pour un groupe de nœuds (approche hybride)
export type NodeGroup = {
  nodes: Node<OperationNodeData>[];
  groupName: string;
  layer: "staging" | "intermediate" | "mart";
  filePath: string;
  isCombined: boolean; // true si multiple nœuds groupés
  mainOperation: string; // L'opération principale du groupe
  dependencies: string[]; // IDs des nœuds parents externes au groupe
  columns: string[]; // Colonnes de sortie du groupe
};

// Type pour une CTE
export type CTE = {
  name: string;
  sql: string;
  node: Node<OperationNodeData>;
  columns: string[];
};

// Options de génération
export interface GeneratorOptions {
  optimizePipeline?: boolean; // true = approche hybride, false = 1 fichier/opération
}

/**
 * Column Type Registry - Collecte les types de colonnes depuis tous les nodes source
 */
function buildColumnTypeRegistry(
  nodes: Node<OperationNodeData>[]
): Map<string, string> {
  const registry = new Map<string, string>();

  nodes.forEach((node) => {
    const opId = node.data.operation.id;

    // Collecter depuis les source nodes (database, source-table, source-manual)
    if (
      opId === "database" ||
      opId === "source-table" ||
      opId === "source-manual"
    ) {
      const columns = node.data.params?.columns as
        | Array<{
            name: string;
            type: string;
            alias?: string;
          }>
        | undefined;

      if (columns && Array.isArray(columns)) {
        columns.forEach((col) => {
          // Enregistrer le type de la colonne
          registry.set(col.name, col.type);

          // Si alias existe, enregistrer aussi
          if (col.alias && col.alias.trim()) {
            registry.set(col.alias, col.type);
          }
        });
      }
    }
  });

  return registry;
}

/**
 * Formate une valeur selon le type de colonne (schema-based)
 */
function formatValueByColumnType(
  column: string,
  value: any,
  columnTypes: Map<string, string>
): string | number | boolean {
  const type = columnTypes.get(column);

  // Si type inconnu, fallback sur comportement intelligent
  if (!type) {
    return smartFormatValue(value);
  }

  // Types numériques → Sans quotes
  if (
    type === "INTEGER" ||
    type === "FLOAT" ||
    type === "NUMERIC" ||
    type === "DECIMAL" ||
    type === "BIGINT"
  ) {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const num = parseFloat(value);
      return isNaN(num) ? `'${value}'` : num;
    }
    return value;
  }

  // Booleans → Sans quotes
  if (type === "BOOLEAN" || type === "BOOL") {
    if (typeof value === "boolean") {
      return value;
    }
    // Convert string to boolean
    if (value === "true" || value === "1" || value === 1) return true;
    if (value === "false" || value === "0" || value === 0) return false;
    return value;
  }

  // Dates et Timestamps → Avec quotes
  if (type === "DATE" || type === "TIMESTAMP" || type === "DATETIME") {
    return `'${value}'`;
  }

  // VARCHAR et autres types string → Avec quotes
  return `'${value}'`;
}

/**
 * Fallback intelligent si type de colonne inconnu
 */
function smartFormatValue(value: any): string | number | boolean {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    // Déjà quoté?
    if (value.startsWith("'") && value.endsWith("'")) {
      return value;
    }

    // Nombre?
    const num = parseFloat(value);
    if (!isNaN(num) && value.trim() === num.toString()) {
      return num;
    }

    // String
    return `'${value}'`;
  }

  return value;
}

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
  projectName: string,
  options: GeneratorOptions = {}
): DbtModelOutput {
  // Approche hybride activée par défaut - Groupe les opérations simples en CTEs
  const { optimizePipeline = true } = options;

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

    // ✅ Construire le registre des types de colonnes
    const columnTypes = buildColumnTypeRegistry(nodes);

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

    // 5. Générer les fichiers SQL
    if (optimizePipeline) {
      // APPROCHE HYBRIDE - Grouper les nœuds simples
      const optimizer = new PipelineOptimizer(dependencyGraph);
      const optimizedGroups = optimizer.optimizePipeline(classifiedNodes);

      optimizedGroups.forEach((group) => {
        let sql: string;

        if (group.isCombined) {
          // Groupe de plusieurs nœuds → générer avec CTEs
          sql = generateCombinedSQL(
            group,
            optimizedGroups,
            classifiedNodes,
            columnTypes
          );
        } else {
          // Nœud unique → utiliser la logique classique
          const cn = classifiedNodes.find(
            (c) => c.node.id === group.nodes[0].id
          )!;
          sql = generateSQLForNode(
            cn,
            classifiedNodes,
            dependencyGraph,
            nodes,
            edges,
            columnTypes
          );
        }

        files.push({
          path: group.filePath,
          content: sql,
        });
      });
    } else {
      // APPROCHE CLASSIQUE - 1 fichier par nœud
      classifiedNodes.forEach((cn) => {
        const sql = generateSQLForNode(
          cn,
          classifiedNodes,
          dependencyGraph,
          nodes,
          edges,
          columnTypes
        );
        files.push({
          path: cn.filePath,
          content: sql,
        });
      });
    }

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
  edges: Edge[],
  columnTypes: Map<string, string>
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
      return (
        sql +
        generateFilterSQL(parentModels, params, classified.columns, columnTypes)
      );

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
  columns: string[],
  columnTypes: Map<string, string>
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
    const whereClause = buildFilterSQL(params.condition, columnTypes);
    if (whereClause) {
      sql += `\nWHERE ${whereClause}`;
    }
  }

  return sql;
}

/**
 * Helper pour construire le SQL de filtres récursifement
 */
function buildFilterSQL(node: any, columnTypes: Map<string, string>): string {
  if (!node) return "";

  if (node.type === "condition") {
    if (!node.column) return "";

    // Handle NULL operators
    if (node.operator === "IS NULL" || node.operator === "IS NOT NULL") {
      return `${node.column} ${node.operator}`;
    }

    const val = node.value;

    // ✅ Use schema-based formatting
    const finalVal = formatValueByColumnType(node.column, val, columnTypes);

    return `${node.column} ${node.operator} ${finalVal}`;
  }

  if (node.type === "group") {
    if (!node.children || node.children.length === 0) return "";

    const parts: string[] = [];
    for (let i = 0; i < node.children.length; i++) {
      const childSQL = buildFilterSQL(node.children[i], columnTypes);
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

  // New format: columns is an array of column names
  const groupByColumns = Array.isArray(params.columns)
    ? params.columns
    : typeof params.columns === "string"
    ? params.columns
        .split(",")
        .map((c: string) => c.trim())
        .filter(Boolean)
    : [];

  // New format: aggregations is an array of Aggregation objects
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

  // Add group by columns
  if (groupByColumns.length > 0) {
    sql += groupByColumns.map((col) => `  ${col}`).join(",\n");

    // Add comma if we have aggregations
    if (aggregations.length > 0) {
      sql += ",\n";
    }
  }

  // Add aggregations
  if (aggregations.length > 0) {
    sql += aggregations
      .map((agg) => {
        // Handle COUNT(DISTINCT column)
        const funcCall =
          agg.function === "COUNT(DISTINCT)"
            ? `COUNT(DISTINCT ${agg.column})`
            : `${agg.function}(${agg.column})`;

        // Add alias if provided
        if (agg.alias) {
          return `  ${funcCall} AS ${agg.alias}`;
        }

        return `  ${funcCall}`;
      })
      .join(",\n");
  }

  // If no columns and no aggregations, select all
  if (groupByColumns.length === 0 && aggregations.length === 0) {
    sql += "  *";
  }

  sql += `\nFROM {{ ref('${fromModel}') }}`;

  // Add GROUP BY clause
  if (groupByColumns.length > 0) {
    sql += "\nGROUP BY\n";
    sql += groupByColumns
      .map((col, i) => {
        const comma = i < groupByColumns.length - 1 ? "," : "";
        return `  ${col}${comma}`;
      })
      .join("\n");
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
  const timestamp = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // Helper to get upstream model names
  const getUpstreamInfo = () => {
    if (deps.length === 0) return "";
    if (deps.length === 1)
      return `\n  Source: ${node.modelName.replace(
        /^(int|fct|stg)_/,
        ""
      )}_upstream`;
    return `\n  Sources: ${deps.length} upstream models`;
  };

  // Helper to extract and format filter conditions
  const formatFilterConditions = (condition: any, depth = 0): string[] => {
    const conditions: string[] = [];

    if (!condition) return conditions;

    if (condition.type === "condition") {
      const { column, operator, value } = condition;
      conditions.push(`${column} ${operator} ${value}`);
    } else if (condition.type === "group" && condition.children) {
      condition.children.forEach((child: any, i: number) => {
        const childConditions = formatFilterConditions(child, depth + 1);
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
      const groupCols = params.columns as string | undefined;
      const aggs = params.aggregations as any[] | undefined;

      let desc = "Aggregated data";

      if (groupCols) {
        const cols = groupCols
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean);

        if (cols.length > 0) {
          desc = `Grouped by:\n  - ` + cols.join("\n  - ");
        }
      }

      if (aggs && Array.isArray(aggs) && aggs.length > 0) {
        desc += `\n  \n  Aggregations:`;
        aggs.forEach((agg) => {
          if (agg.function && agg.column) {
            desc += `\n  - ${agg.function}(${agg.column})`;
            if (agg.alias) desc += ` as ${agg.alias}`;
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

      if (columns && columns.length > 0) {
        const colList = columns
          .slice(0, 10) // Limit to first 10 to avoid too long descriptions
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

    case "union": {
      return `Union of ${deps.length} datasets\n  Combines all rows from upstream models\n  \n  Generated: ${timestamp}`;
    }

    case "dbt-model": {
      const modelName = params.name || "output";
      return `Final output model: ${modelName}\n  Mart layer model for analytics\n  ${getUpstreamInfo()}\n  Generated: ${timestamp}`;
    }

    case "source-table":
    case "source-manual": {
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
      // Use YAML literal block style (|) for multiline descriptions
      entry += `    description: |\n`;
      // Indent each line of the description by 6 spaces (4 for description + 2 for | content)
      const descriptionLines = description.split("\n");
      descriptionLines.forEach((line) => {
        entry += `      ${line}\n`;
      });

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
