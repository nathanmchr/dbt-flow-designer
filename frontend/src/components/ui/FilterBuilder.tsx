/**
 * @fileoverview Filter Builder component for visual WHERE clause construction.
 *
 * Provides a drag-and-drop interface for building complex SQL filter conditions
 * with support for:
 * - Nested groups with AND/OR operators
 * - Multiple comparison operators (=, !=, <, >, LIKE, IN, NULL checks)
 * - Reorderable conditions via drag handles
 */

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";

export type FilterCondition = {
  id: string;
  type: "condition";
  column: string;
  operator: string;
  value: string;
};

export type FilterGroup = {
  id: string;
  type: "group";
  operators: ("AND" | "OR")[]; // operators[i] is between children[i] and children[i+1]
  children: (FilterCondition | FilterGroup)[];
};

export type FilterNode = FilterCondition | FilterGroup;

interface FilterBuilderProps {
  value: FilterGroup;
  onChange: (value: FilterGroup) => void;
  availableColumns: Array<{ name: string; type: string }>;
}

const OPERATORS = [
  "=",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "LIKE",
  "NOT LIKE",
  "IN",
  "NOT IN",
  "IS NULL",
  "IS NOT NULL",
];

let nodeIdCounter = 0;
const generateId = () => `node-${Date.now()}-${nodeIdCounter++}`;

// Toggle Switch Component for AND/OR
function ToggleSwitch({
  value,
  onChange,
}: {
  value: "AND" | "OR";
  onChange: () => void;
}) {
  const isAnd = value === "AND";
  const [shouldAnimate, setShouldAnimate] = useState(false);

  const handleClick = () => {
    // Enable animation for this click
    setShouldAnimate(true);
    // Call the onChange handler
    onChange();
    // Disable animation after it completes
    setTimeout(() => setShouldAnimate(false), 300);
  };

  return (
    <button
      onClick={handleClick}
      className="toggle-track relative inline-flex items-center h-8 w-20"
    >
      {/* Labels */}
      <span className="absolute left-1.5 text-xs font-bold text-gray-500 dark:text-gray-400">
        AND
      </span>
      <span className="absolute right-3 text-xs font-bold text-gray-500 dark:text-gray-400">
        OR
      </span>

      {/* Sliding pill - orange */}
      <span
        className={`toggle-thumb absolute h-6 w-9 transform ${
          shouldAnimate ? "transition-transform duration-300 ease-in-out" : ""
        } flex items-center justify-center`}
        style={{
          top: "0.2rem",
          transform: isAnd ? "translateX(4px)" : "translateX(38px)",
        }}
      >
        <span className="text-xs font-bold text-white">
          {isAnd ? "AND" : "OR"}
        </span>
      </span>
    </button>
  );
}

// Condition Block Component
function ConditionBlock({
  condition,
  onUpdate,
  onDelete,
  availableColumns,
  canDelete = true,
}: {
  condition: FilterCondition;
  onUpdate: (updated: FilterCondition) => void;
  onDelete: () => void;
  availableColumns: Array<{ name: string; type: string }>;
  canDelete?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: condition.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const showValueInput =
    condition.operator !== "IS NULL" && condition.operator !== "IS NOT NULL";

  return (
    <div ref={setNodeRef} style={style} className="card p-3 my-2">
      <div className="flex items-start gap-2">
        {/* Drag Handle */}
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing bg-transparent shadow-none border-none backdrop-blur-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16">
            <path
              fill="currentColor"
              d="M5 3h2v2H5V3zm4 0h2v2H9V3zM5 7h2v2H5V7zm4 0h2v2H9V7zm-4 4h2v2H5v-2zm4 0h2v2H9v-2z"
            />
          </svg>
        </button>

        {/* Condition Fields */}
        <div className="flex-1 min-w-0 flex flex-wrap gap-2">
          {/* Column */}
          <select
            value={condition.column}
            onChange={(e) => onUpdate({ ...condition, column: e.target.value })}
          >
            <option value="">Select column...</option>
            {availableColumns.map((col) => (
              <option key={col.name} value={col.name}>
                {col.name} ({col.type})
              </option>
            ))}
          </select>

          {/* Operator */}
          <select
            value={condition.operator}
            onChange={(e) =>
              onUpdate({ ...condition, operator: e.target.value })
            }
          >
            <option value="">Op...</option>
            {OPERATORS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>

          {/* Value */}
          {showValueInput && (
            <input
              type="text"
              value={condition.value}
              onChange={(e) =>
                onUpdate({ ...condition, value: e.target.value })
              }
              placeholder="Value..."
            />
          )}
        </div>

        {/* Delete Button */}
        <button
          onClick={onDelete}
          disabled={!canDelete}
          className={`delete-button w-6 h-6 flex justify-center items-center ${
            canDelete ? "" : "cursor-not-allowed"
          }`}
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
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Group Block Component
function GroupBlock({
  group,
  onUpdate,
  onDelete,
  availableColumns,
  isRoot = false,
}: {
  group: FilterGroup;
  onUpdate: (updated: FilterGroup) => void;
  onDelete?: () => void;
  availableColumns: Array<{ name: string; type: string }>;
  isRoot?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id, disabled: isRoot });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const addCondition = () => {
    const newOperators: ("AND" | "OR")[] =
      group.children.length > 0 ? [...group.operators, "AND"] : [];
    onUpdate({
      ...group,
      operators: newOperators,
      children: [
        ...group.children,
        {
          id: generateId(),
          type: "condition",
          column: "",
          operator: "",
          value: "",
        },
      ],
    });
  };

  const addGroup = () => {
    const newOperators: ("AND" | "OR")[] =
      group.children.length > 0 ? [...group.operators, "AND"] : [];
    onUpdate({
      ...group,
      operators: newOperators,
      children: [
        ...group.children,
        {
          id: generateId(),
          type: "group",
          operators: [],
          children: [
            {
              id: generateId(),
              type: "condition",
              column: "",
              operator: "",
              value: "",
            },
          ],
        },
      ],
    });
  };

  const updateChild = (index: number, updated: FilterNode) => {
    const newChildren = [...group.children];
    newChildren[index] = updated;
    onUpdate({ ...group, children: newChildren });
  };

  const deleteChild = (index: number) => {
    const newChildren = group.children.filter((_, i) => i !== index);
    let newOperators = [...group.operators];

    // Remove the operator before this child, or after if it's the first child
    if (index === 0 && newOperators.length > 0) {
      newOperators = newOperators.slice(1);
    } else if (index > 0) {
      newOperators.splice(index - 1, 1);
    }

    onUpdate({
      ...group,
      operators: newOperators,
      children: newChildren,
    });
  };

  const toggleOperator = (operatorIndex: number) => {
    const newOperators = [...group.operators];
    newOperators[operatorIndex] =
      newOperators[operatorIndex] === "AND" ? "OR" : "AND";
    onUpdate({
      ...group,
      operators: newOperators,
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = group.children.findIndex(
        (child) => child.id === active.id
      );
      const newIndex = group.children.findIndex(
        (child) => child.id === over.id
      );

      if (oldIndex !== -1 && newIndex !== -1) {
        // Only move children, keep operators at their positions
        onUpdate({
          ...group,
          children: arrayMove(group.children, oldIndex, newIndex),
        });
      }
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        ${isRoot ? "" : "filter-group p-3 mb-2"}
      `}
    >
      {!isRoot && (
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {/* Drag Handle for nested groups */}
            <button
              {...attributes}
              {...listeners}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing border-transparent"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                <path d="M5 3h2v2H5V3zm4 0h2v2H9V3zM5 7h2v2H5V7zm4 0h2v2H9V7zm-4 4h2v2H5v-2zm4 0h2v2H9v-2z" />
              </svg>
            </button>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
              Group
            </span>
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              className="delete-button w-6 h-6 flex justify-center items-center text-xs"
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
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          )}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={group.children.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {group.children.map((child, index) => (
            <div key={child.id}>
              {child.type === "condition" ? (
                <ConditionBlock
                  condition={child}
                  onUpdate={(updated) => updateChild(index, updated)}
                  onDelete={() => deleteChild(index)}
                  availableColumns={availableColumns}
                  canDelete={group.children.length > 1}
                />
              ) : (
                <GroupBlock
                  group={child}
                  onUpdate={(updated) => updateChild(index, updated)}
                  onDelete={
                    group.children.length > 1
                      ? () => deleteChild(index)
                      : undefined
                  }
                  availableColumns={availableColumns}
                />
              )}

              {/* AND/OR Toggle between children - each toggle is independent */}
              {index < group.children.length - 1 && (
                <div
                  key={`toggle-${group.children[index].id}-${
                    group.children[index + 1].id
                  }`}
                  className="flex justify-center my-2"
                >
                  <ToggleSwitch
                    value={group.operators[index] || "AND"}
                    onChange={() => toggleOperator(index)}
                  />
                </div>
              )}
            </div>
          ))}
        </SortableContext>
      </DndContext>

      {/* Actions */}
      <div className="flex gap-2 mt-3">
        <button
          onClick={addCondition}
          className="highlight-button flex *:flex-1 px-2 py-1 items-center justify-center gap-1 rounded-full"
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
              d="M12 4v16m8-8H4"
            />
          </svg>
          Condition
        </button>
        <button
          onClick={addGroup}
          className="normal-button flex flex-1 px-2 py-1 items-center justify-center gap-1 rounded-full"
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
              d="M12 4v16m8-8H4"
            />
          </svg>
          Group
        </button>
      </div>
    </div>
  );
}

// Main FilterBuilder Component
export default function FilterBuilder({
  value,
  onChange,
  availableColumns,
}: FilterBuilderProps) {
  return (
    <div className="space-y-2">
      <GroupBlock
        group={value}
        onUpdate={onChange}
        availableColumns={availableColumns}
        isRoot={true}
      />
    </div>
  );
}
