import type { Node } from "reactflow";
import type {
  OperationNodeData,
  ClassifiedNode,
  NodeGroup,
} from "./dbtGenerator";

/**
 * PIPELINE OPTIMIZER - Approche Hybride
 * Groupe les opérations simples séquentielles en un seul fichier avec CTEs
 */
export class PipelineOptimizer {
  private dependencyGraph: Map<string, string[]>;

  constructor(dependencyGraph: Map<string, string[]>) {
    this.dependencyGraph = dependencyGraph;
  }

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

  private findDirectChildren(
    nodeId: string,
    allClassified: ClassifiedNode[]
  ): ClassifiedNode[] {
    return allClassified.filter((cn) => cn.dependencies.includes(nodeId));
  }

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

  private getMainOperation(classifiedNodes: ClassifiedNode[]): string {
    const operations = classifiedNodes.map((cn) => cn.node.data.operation.id);
    if (operations.every((op) => op === operations[0])) {
      return operations[0];
    }
    return operations.join("+");
  }
}
