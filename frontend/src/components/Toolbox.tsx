import { OPERATION_DEFS, type OperationDefinition } from "../domain/operations";
import ToolboxNode from "./nodes/ToolboxNode";

interface ToolboxProps {
  onAddNode: (operation: OperationDefinition) => void;
}

function Toolbox({ onAddNode }: ToolboxProps) {
  // Grouper les opérations par catégorie
  const categories = OPERATION_DEFS.reduce<
    Record<string, OperationDefinition[]>
  >((acc, op) => {
    if (!acc[op.category]) acc[op.category] = [];
    acc[op.category].push(op);
    return acc;
  }, {});

  const categoryTitles: Record<string, string> = {
    source: "Sources",
    transform: "Transformations",
    output: "Output",
    advanced: "Advanced",
  };

  return (
    <div className="panel fixed left-4 top-21 z-50 w-70 h-[calc(100%-115px)] overflow-y-auto">
      <p className="text-xs uppercase sticky top-0 tracking-[0.2em] text-gray-400">
        Toolbox
      </p>
      {Object.entries(categories).map(([cat, ops]) => (
        <div key={cat} className="category mb-4">
          <h3 className="font-semibold mb-2">{categoryTitles[cat] || cat}</h3>
          <ul className="flex flex-col gap-4">
            {ops.map((op) => (
              <li key={op.id}>
                <ToolboxNode operation={op} onAddNode={onAddNode} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default Toolbox;
