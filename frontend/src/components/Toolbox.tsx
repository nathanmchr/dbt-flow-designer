import { useState, useEffect, useMemo } from "react";
import {
  OPERATION_DEFS,
  type OperationDefinition,
} from "../definitions/operations";
import ToolboxNode from "./nodes/ToolboxNode";

interface ToolboxProps {
  onAddNode: (operation: OperationDefinition) => void;
}

function Toolbox({ onAddNode }: ToolboxProps) {
  // Grouper les opérations par catégorie (exclure Model Output)
  const categories = useMemo(
    () =>
      OPERATION_DEFS.filter((op) => op.id !== "dbt-model").reduce<
        Record<string, OperationDefinition[]>
      >((acc, op) => {
        if (!acc[op.category]) acc[op.category] = [];
        acc[op.category].push(op);
        return acc;
      }, {}),
    []
  );

  const categoryTitles: Record<string, string> = {
    source: "Sources",
    transform: "Transformations",
    output: "Output",
    advanced: "Advanced",
  };

  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >({});

  const [isOpen, setIsOpen] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [width, setWidth] = useState(280); // w-70 = 280px
  const [isResizing, setIsResizing] = useState(false);

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [cat]: !prev[cat],
    }));
  };

  const handleOpenToolbox = () => {
    setIsClosing(true);
    setIsOpen(true); // Open immediately so both animations play together
    setTimeout(() => {
      setIsClosing(false); // Clean up after animation completes
    }, 200); // Match animation duration
  };

  // Handle resizing
  useEffect(() => {
    if (!isResizing) return;

    // Prevent text selection and fix cursor during resize
    document.body.classList.add("resizing");
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX - 16; // 16px for left margin
      setWidth(Math.max(280, Math.min(newWidth, 800))); // min 280px, max 800px
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      // Restore default styles
      document.body.classList.remove("resizing");
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const enterEase = "cubic-bezier(0.22,1,0.36,1)";
  const exitEase = "cubic-bezier(0.5,0.05,0.8,0.25)";

  // Calculate number of columns based on width for consistent grid across all categories
  const gridCols = useMemo(() => {
    // Account for padding and scrollbar (approx 40px total)
    const availableWidth = width - 40;
    const minColWidth = 240;
    const gap = 16; // gap-4 = 1rem = 16px

    // Calculate how many columns fit
    const cols = Math.max(
      1,
      Math.floor((availableWidth + gap) / (minColWidth + gap))
    );
    return cols;
  }, [width]);

  const panelStyle = {
    transform: isOpen ? "translateX(0)" : "translateX(-120%)",
    opacity: isOpen ? 1 : 0,
    transition: isOpen
      ? `transform 420ms ${enterEase}, opacity 420ms ${enterEase}`
      : `transform 200ms ${exitEase}, opacity 200ms ${exitEase}`,
  } as const;

  return (
    <>
      {/* Toggle button when closed */}
      {(!isOpen || isClosing) && (
        <button
          onClick={handleOpenToolbox}
          className="normal-button fixed left-0 top-34.5 -translate-y-1/2 z-50 p-3 rounded-r-2xl rounded-l-none border-l-transparent"
          style={{
            animation: isClosing
              ? "slideOutToLeft 200ms ease-in both"
              : "slideInFromLeft 200ms ease-out 160ms both",
          }}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
            />
          </svg>
        </button>
      )}

      <div
        className="panel fixed left-4 top-19 z-50 h-[calc(100%-var(--spacing)*27)] flex flex-col"
        style={{ ...panelStyle, width: `${width}px` }}
      >
        {/* Resize handle */}
        <div
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-50"
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizing(true);
          }}
        />
        <div className="shrink-0 flex justify-between items-center px-4 pt-4">
          <p className="pb-2 border-b text-xs font-bold uppercase tracking-[0.2em] border-gray-400 dark:border-gray-700 text-gray-500 dark:text-gray-400">
            Toolbox
          </p>
          <button
            onClick={() => setIsOpen(false)}
            className="normal-button rounded-full p-1"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 mask-gradient-both pr-3 -mr-3 pt-4">
          {Object.entries(categories).map(([cat, ops]) => (
            <div key={cat} className="category mb-2">
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center justify-start group sticky top-0 z-10 gap-2 mb-4 px-4 backdrop-blur-none border-transparent bg-transparent shadow-transparent text-gray-700 dark:text-gray-200 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                    expandedCategories[cat] ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
                <h3 className="text-lg font-semibold">
                  {categoryTitles[cat] || cat}
                </h3>
              </button>
              <div
                className={`grid transition-[grid-template-rows] duration-280 ease-out will-change-[grid-template-rows] ${
                  expandedCategories[cat]
                    ? "grid-rows-[1fr]"
                    : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <ul
                    className={`grid gap-4 mb-4 px-4 transition-transform duration-300 ease-out will-change-transform transform-gpu ${
                      expandedCategories[cat]
                        ? "translate-y-0"
                        : "-translate-y-full"
                    }`}
                    style={{
                      gridTemplateColumns: `repeat(${gridCols}, 240px)`,
                    }}
                  >
                    {ops.map((op) => (
                      <li
                        key={op.id}
                        className={`h-full transition-opacity will-change-[opacity] transform-gpu ${
                          expandedCategories[cat]
                            ? "opacity-100 duration-400"
                            : "opacity-0 duration-150"
                        }`}
                      >
                        <ToolboxNode operation={op} onAddNode={onAddNode} />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default Toolbox;
