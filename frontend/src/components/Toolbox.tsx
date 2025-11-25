import { useState, useEffect, useMemo } from "react";
import { OPERATION_DEFS, type OperationDefinition } from "../domain/operations";
import ToolboxNode from "./nodes/ToolboxNode";

interface ToolboxProps {
  onAddNode: (operation: OperationDefinition) => void;
}

function Toolbox({ onAddNode }: ToolboxProps) {
  // Grouper les opérations par catégorie
  const categories = useMemo(
    () =>
      OPERATION_DEFS.reduce<Record<string, OperationDefinition[]>>(
        (acc, op) => {
          if (!acc[op.category]) acc[op.category] = [];
          acc[op.category].push(op);
          return acc;
        },
        {}
      ),
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
          className="fixed left-0 top-36.5 -translate-y-1/2 z-50 p-3 rounded-r-xl bg-white/50 dark:bg-gray-800/50 backdrop-blur-lg border border-l-0 border-gray-300 dark:border-gray-700 shadow-lg dark:shadow-black/20 hover:bg-white/70 dark:hover:bg-gray-700/50 transition-all"
          style={{
            animation: isClosing
              ? "slideOutToLeft 200ms ease-in both"
              : "slideInFromLeft 200ms ease-out 160ms both",
          }}
        >
          <svg
            className="w-5 h-5 text-gray-600 dark:text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      )}

      <div
        className="panel fixed left-4 top-21 z-50 h-[calc(100%-115px)] flex flex-col"
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
        <div className="shrink-0 pb-2 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold">
            Toolbox
          </p>
          <button
            onClick={() => setIsOpen(false)}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-400 dark:hover:text-gray-200 backdrop-blur-md rounded-full p-1 border border-gray-300 hover:border-gray-200 dark:border-gray-600 dark:hover:border-gray-500 bg-gray-300/50 dark:bg-gray-600/50 hover:bg-white/50 dark:hover:bg-gray-400/50 shadow-md hover:shadow-xl dark:hover:shadow-lg dark:shadow-black/20 hover:shadow-white dark:hover:shadow-white/10 transition-colors"
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
        <div className="overflow-y-auto flex-1 mask-gradient-top -mr-2 pt-4">
          {Object.entries(categories).map(([cat, ops]) => (
            <div key={cat} className="category mb-2">
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center justify-start gap-2 p-2 mb-2 border-transparent group sticky top-0 z-10"
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
                    className={`grid gap-4 mb-4 transition-transform duration-300 ease-out will-change-transform transform-gpu ${
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
