type CatalogSection = {
  title: string;
  description: string;
  items: string[];
};

type DagNode = {
  id: string;
  label: string;
  type: "model" | "source" | "seed" | "macro" | "test";
  x: number;
  y: number;
  owner: string;
  tags: string[];
  materialization: string;
  status: "ready" | "draft" | "blocked";
};
