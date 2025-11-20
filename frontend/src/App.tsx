import { useState } from "react";
import Toolbox from "./components/Toolbox";
import Flowchart from "./components/Flowchart";
import Inspector from "./components/Inspector";
import { OPERATION_DEFS } from "./domain/operations";

function App() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [nodeCounter, setNodeCounter] = useState(0);

  const handleAddNode = (operation) => {
    const newId = `node-${nodeCounter}`;
    setNodeCounter((prev) => prev + 1);

    const newNode = {
      id: newId,
      type: "operation",
      position: { x: 150, y: 150 },
      data: {
        operation,
        params: {},
        onConfigure: (id) => console.log("configure", id),
        onRemove: (nodeId) => {
          setNodes((prev) => prev.filter((n) => n.id !== nodeId));
          setEdges((prev) =>
            prev.filter((e) => e.source !== nodeId && e.target !== nodeId)
          );
        },
      },
    };

    setNodes((prev) => [...prev, newNode]);
  };

  return (
    <>
      <header className="flex flex-row justify-between items-center p-4 border-b border-gray-300 dark:border-gray-700">
        <h1 className="text-xl font-bold">dbt Flow Designer</h1>
        <div className="flex flex-row gap-4">
          <button className="w-30 shadow-md p-3 rounded-full">Test</button>
          <button className="w-30 bg-orange-600 text-white shadow-md p-3 rounded-full">
            Save
          </button>
        </div>
      </header>

      <div className="main-content flex">
        <Toolbox onAddNode={handleAddNode} />
        <Flowchart
          nodes={nodes}
          edges={edges}
          setNodes={setNodes}
          setEdges={setEdges}
        />
        <Inspector />
      </div>
    </>
  );
}

export default App;
