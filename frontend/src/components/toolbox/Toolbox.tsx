/**
 * @fileoverview Toolbox component displaying available operations.
 *
 * Provides a collapsible sidebar with categorized operations that
 * users can add to the flowchart by clicking.
 */

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  OPERATION_DEFS,
  type OperationDefinition,
} from "../../definitions/operations";
import ToolboxNode from "../flowchart/nodes/ToolboxNode";

interface ToolboxProps {
  onAddNode: (operation: OperationDefinition) => void;
  onLayoutChange?: (isOpen: boolean, width: number) => void;
}

// Permanent nodes that shouldn't appear in the toolbox
const PERMANENT_NODE_IDS = ["dbt-model", "database"];

const CATEGORY_TITLES: Record<string, string> = {
  source: "Sources",
  transform: "Transformations",
  output: "Output",
  advanced: "Advanced",
};
const TAB_EXIT_DURATION_MS = 150;

/**
 * Toolbox sidebar component with categorized operations.
 * Features resizable panel, collapsible categories, and smooth animations.
 */
function Toolbox({ onAddNode, onLayoutChange }: ToolboxProps) {
  // Group operations by category (exclude permanent nodes: Model Output, Database)
  const categories = useMemo(
    () =>
      OPERATION_DEFS.filter((op) => !PERMANENT_NODE_IDS.includes(op.id)).reduce<
        Record<string, OperationDefinition[]>
      >((acc, op) => {
        if (!acc[op.category]) acc[op.category] = [];
        acc[op.category].push(op);
        return acc;
      }, {}),
    []
  );

  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >({});

  const [isOpen, setIsOpen] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [width, setWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const categoryHeaderRefs = useRef<
    Record<string, HTMLButtonElement | null>
  >({});
  const categoryContentRefs = useRef<Record<string, HTMLDivElement | null>>(
    {}
  );

  useEffect(() => {
    onLayoutChange?.(isOpen, width);
  }, [isOpen, width, onLayoutChange]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [cat]: !prev[cat],
    }));
  };

  const handleOpenToolbox = () => {
    setIsClosing(true);
    setIsOpen(true);
    setTimeout(() => {
      setIsClosing(false);
    }, TAB_EXIT_DURATION_MS);
  };

  // Handle resize drag
  useEffect(() => {
    if (!isResizing) return;

    document.body.classList.add("resizing");
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX - 16;
      setWidth(Math.max(280, Math.min(newWidth, 800)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.classList.remove("resizing");
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  // Keep each content mask aligned with the bottom edge of its sticky header.
  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    let scheduledFrame: number | null = null;

    const updateCategoryMasks = () => {
      scheduledFrame = null;
      const pixelRatio = window.devicePixelRatio || 1;
      const maskUpdates = Object.keys(categories).flatMap((cat) => {
        const header = categoryHeaderRefs.current[cat];
        const content = categoryContentRefs.current[cat];
        if (!header || !content) return [];

        const rawMaskStart =
          header.getBoundingClientRect().bottom -
          content.getBoundingClientRect().top;
        const maskStart =
          Math.round(rawMaskStart * pixelRatio) / pixelRatio;

        return [{ content, nextMaskStart: `${maskStart}px` }];
      });

      maskUpdates.forEach(({ content, nextMaskStart }) => {
        if (
          content.style.getPropertyValue("--toolbox-category-mask-start") ===
          nextMaskStart
        ) {
          return;
        }

        content.style.setProperty(
          "--toolbox-category-mask-start",
          nextMaskStart
        );
      });
    };

    const scheduleCategoryMasksUpdate = () => {
      if (scheduledFrame !== null) return;
      scheduledFrame = window.requestAnimationFrame(updateCategoryMasks);
    };

    const resizeObserver = new ResizeObserver(scheduleCategoryMasksUpdate);
    resizeObserver.observe(scrollContainer);
    Object.values(categoryContentRefs.current).forEach((content) => {
      if (content) resizeObserver.observe(content);
    });

    scrollContainer.addEventListener("scroll", scheduleCategoryMasksUpdate, {
      passive: true,
    });
    window.addEventListener("resize", scheduleCategoryMasksUpdate);
    updateCategoryMasks();

    return () => {
      scrollContainer.removeEventListener(
        "scroll",
        scheduleCategoryMasksUpdate
      );
      window.removeEventListener("resize", scheduleCategoryMasksUpdate);
      resizeObserver.disconnect();
      if (scheduledFrame !== null) {
        window.cancelAnimationFrame(scheduledFrame);
      }
    };
  }, [categories]);

  const enterEase = "cubic-bezier(0.22,1,0.36,1)";
  const exitEase = "cubic-bezier(0.5,0.05,0.8,0.25)";

  // Calculate grid columns based on panel width
  const gridCols = useMemo(() => {
    const availableWidth = width - 40;
    const minColWidth = 240;
    const gap = 16;

    const cols = Math.max(
      1,
      Math.floor((availableWidth + gap) / (minColWidth + gap))
    );
    return cols;
  }, [width]);

  const panelStyle = {
    transform: isOpen ? "none" : "translateX(-120%)",
    pointerEvents: isOpen ? "auto" : "none",
    transition: isOpen
      ? `transform 420ms ${enterEase}`
      : `transform 200ms ${exitEase}`,
  } as const;

  return (
    <>
      {/* Toggle button when closed */}
      {(!isOpen || isClosing) && (
        <button
          type="button"
          aria-label="Open toolbox"
          aria-controls="toolbox-panel"
          aria-expanded="false"
          onClick={handleOpenToolbox}
          className="normal-button fixed left-0 top-34.5 -translate-y-1/2 z-50 p-3 rounded-r-2xl backdrop-blur-lg rounded-l-none border-l-transparent"
          style={{
            animation: isClosing
              ? `slideOutToLeft ${TAB_EXIT_DURATION_MS}ms ease-in both`
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

      <aside
        id="toolbox-panel"
        aria-labelledby="toolbox-title"
        aria-hidden={!isOpen}
        inert={!isOpen}
        className="toolbox-shell fixed left-4 top-19 z-50 my-4 h-[calc(100%-var(--spacing)*27)]"
        style={{ ...panelStyle, width: `${width}px` }}
      >
        <div
          aria-hidden="true"
          className="panel toolbox-panel-surface absolute inset-0"
        />

        {/* Resize handle */}
        <div
          role="separator"
          aria-label="Resize toolbox"
          aria-orientation="vertical"
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-30"
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizing(true);
          }}
        />

        <div className="toolbox-layout absolute inset-px z-10 grid grid-rows-[auto_minmax(0,1fr)] overflow-x-clip rounded-[calc(1.5rem-1px)]">
          <div className="flex items-center justify-between px-4 pt-4">
            <p
              id="toolbox-title"
              className="pb-2 border-b text-xs font-bold uppercase tracking-[0.2em] border-gray-400 dark:border-gray-700 text-gray-500 dark:text-gray-400"
            >
              Toolbox
            </p>
            <button
              type="button"
              aria-label="Minimize toolbox"
              aria-controls="toolbox-panel"
              onClick={() => setIsOpen(false)}
              className="normal-button p-1"
              title="Minimize toolbox"
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
                  strokeWidth={2}
                  d="M20 12H4"
                />
              </svg>
            </button>
          </div>

          <div className="toolbox-viewport toolbox-mask-gradient min-h-0 -mr-3">
            <nav
              ref={scrollContainerRef}
              aria-label="Available operations"
              className="toolbox-scroll h-full overflow-y-scroll pr-3 pt-4"
            >
              {Object.entries(categories).map(([cat, ops]) => (
                <section
                  key={cat}
                  aria-labelledby={`toolbox-category-${cat}`}
                  className="category mb-2"
                >
                  <button
                    id={`toolbox-category-${cat}`}
                    type="button"
                    aria-expanded={Boolean(expandedCategories[cat])}
                    aria-controls={`toolbox-category-content-${cat}`}
                    ref={(element) => {
                      categoryHeaderRefs.current[cat] = element;
                    }}
                    onClick={() => toggleCategory(cat)}
                    className="toolbox-category-header w-full flex items-center justify-start group sticky top-0 z-10 gap-2 mb-4 px-4 border-transparent bg-transparent shadow-transparent hover:text-gray-700 dark:hover:text-gray-200"
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
                    <span className="text-lg font-semibold">
                      {CATEGORY_TITLES[cat] || cat}
                    </span>
                  </button>
                  <div
                    id={`toolbox-category-content-${cat}`}
                    className={`toolbox-category-reveal grid ${
                      expandedCategories[cat]
                        ? "grid-rows-[1fr]"
                        : "grid-rows-[0fr]"
                    }`}
                  >
                    <div
                      ref={(element) => {
                        categoryContentRefs.current[cat] = element;
                      }}
                      className="toolbox-category-content overflow-hidden"
                    >
                      <ul
                        className={`toolbox-category-list-motion grid gap-4 mb-4 px-4 ${
                          expandedCategories[cat]
                            ? "toolbox-category-list-motion-expanded"
                            : ""
                        }`}
                        style={{
                          gridTemplateColumns: `repeat(${gridCols}, 240px)`,
                        }}
                      >
                        {ops.map((op) => (
                          <li key={op.id} className="h-full">
                            <ToolboxNode
                              operation={op}
                              onAddNode={onAddNode}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </section>
              ))}
            </nav>
          </div>
        </div>
      </aside>
    </>
  );
}

export default Toolbox;
