/**
 * @fileoverview Pipeline Optimizer for dbt model generation.
 *
 * Groups simple sequential operations (e.g., filter, select) into a single
 * SQL file using CTEs (Common Table Expressions) for better organization
 * and reduced file count.
 */

import type { Node } from "@xyflow/react";
import type {
  OperationNodeData,
  ClassifiedNode,
  NodeGroup,
} from "./dbtGenerator";

/**
 * Optimizes the pipeline by grouping compatible operations.
 * Uses a hybrid approach: complex operations get separate files,
 * while simple sequential operations are combined using CTEs.
 */
export class PipelineOptimizer {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_dependencyGraph: Map<string, string[]>) {
    // Dependency graph reserved for future optimizations
  }

  /**
   * Processes all classified nodes and groups them into optimized NodeGroups.
   */
  optimizePipeline(classified: ClassifiedNode[]): NodeGroup[] {
    const groups: NodeGroup[] = [];
    const processedNodeIds = new Set<string>();

    classified.forEach((cn) => {
      if (processedNodeIds.has(cn.node.id)) return;

      if (this.shouldSeparate(cn.node)) {
        const group = this.createSingleNodeGroup(cn);
        groups.push(group);
        processedNodeIds.add(cn.node.id);
      } else {
        const groupedNodes = this.collectGroupableNodes(
          cn,
          classified,
          processedNodeIds
        );
        if (groupedNodes.length > 0) {
          const group = this.createMultiNodeGroup(groupedNodes);
          groups.push(group);
          groupedNodes.forEach((n) => processedNodeIds.add(n.node.id));
        }
      }
    });

    return groups;
  }

  /**
   * Determines if an operation should be in its own separate file.
   * Complex operations like joins, aggregations, and unions are separated.
   */
  private shouldSeparate(node: Node<OperationNodeData>): boolean {
    const opId = node.data.operation.id;
    const separateOps = [
      "source-table",
      "source-manual",
      "join",
      "group-by",
      "aggregate",
      "union",
      "dbt-model",
    ];
    return separateOps.includes(opId);
  }

  /**
   * Collects consecutive groupable nodes starting from a given node.
   * Stops when encountering a branching point or a complex operation.
   */
  private collectGroupableNodes(
    startNode: ClassifiedNode,
    allClassified: ClassifiedNode[],
    processed: Set<string>
  ): ClassifiedNode[] {
    const group: ClassifiedNode[] = [startNode];
    processed.add(startNode.node.id);
    let current = startNode;

    while (true) {
      const children = this.findDirectChildren(current.node.id, allClassified);
      if (children.length !== 1 || processed.has(children[0].node.id)) break;

      const child = children[0];
      if (this.shouldSeparate(child.node)) break;

      group.push(child);
      processed.add(child.node.id);
      current = child;
    }

    return group;
  }

  /**
   * Finds all nodes that directly depend on a given node.
   */
  private findDirectChildren(
    nodeId: string,
    allClassified: ClassifiedNode[]
  ): ClassifiedNode[] {
    return allClassified.filter((cn) => cn.dependencies.includes(nodeId));
  }

  /**
   * Creates a NodeGroup for a single node (no CTE combination).
   */
  private createSingleNodeGroup(cn: ClassifiedNode): NodeGroup {
    return {
      nodes: [cn.node],
      groupName: cn.modelName,
      layer: cn.layer,
      filePath: cn.filePath,
      isCombined: false,
      mainOperation: cn.node.data.operation.id,
      dependencies: cn.dependencies,
      columns: cn.columns,
    };
  }

  /**
   * Creates a NodeGroup for multiple nodes (combined using CTEs).
   */
  private createMultiNodeGroup(classifiedNodes: ClassifiedNode[]): NodeGroup {
    const lastNode = classifiedNodes[classifiedNodes.length - 1];
    const groupName = this.generateGroupName(classifiedNodes);
    const externalDeps = classifiedNodes[0].dependencies;

    return {
      nodes: classifiedNodes.map((cn) => cn.node),
      groupName,
      layer: lastNode.layer,
      filePath: `models/${lastNode.layer}/${groupName}.sql`,
      isCombined: true,
      mainOperation: this.getMainOperation(classifiedNodes),
      dependencies: externalDeps,
      columns: lastNode.columns,
    };
  }

  /**
   * Generates a descriptive name for a group of nodes.
   */
  private generateGroupName(classifiedNodes: ClassifiedNode[]): string {
    const lastNode = classifiedNodes[classifiedNodes.length - 1];
    const operations = classifiedNodes.map((cn) => cn.node.data.operation.id);

    const allFilters = operations.every((op) => op === "filter");
    if (allFilters && classifiedNodes.length > 1) {
      const baseName = this.extractBaseName(classifiedNodes[0].modelName);
      return `int_filtered_${baseName}`;
    }

    if (operations.includes("select") && operations.includes("filter")) {
      const baseName = this.extractBaseName(classifiedNodes[0].modelName);
      return `int_cleaned_${baseName}`;
    }

    return lastNode.modelName;
  }

  /**
   * Extracts the base entity name from a model name.
   */
  private extractBaseName(modelName: string): string {
    const parts = modelName.split("_");
    if (parts.length >= 2 && parts[0] === "int") {
      const withoutPrefix = parts.slice(1);
      const keywords = [
        "filtered",
        "selected",
        "transformed",
        "grouped",
        "joined",
      ];
      return withoutPrefix.filter((p) => !keywords.includes(p)).join("_");
    }
    return modelName;
  }

  /**
   * Determines the main operation for a group.
   */
  private getMainOperation(classifiedNodes: ClassifiedNode[]): string {
    const operations = classifiedNodes.map((cn) => cn.node.data.operation.id);
    if (operations.every((op) => op === operations[0])) {
      return operations[0];
    }
    return operations.join("+");
  }
}
