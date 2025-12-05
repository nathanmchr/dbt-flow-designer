/**
 * @fileoverview Custom animated edge component for React Flow.
 * Renders a dual-layer edge with a base line and animated dashes overlay.
 */

import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

/**
 * Animated edge component that displays a flowing dash animation.
 * Consists of two layers:
 * - Base layer: solid line (2px)
 * - Overlay layer: animated dashed line with rounded caps (5px)
 */
export function AnimatedEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      {/* Base edge layer */}
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{ ...style, strokeWidth: 2 }}
      />
      {/* Animated dash overlay */}
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{ ...style, strokeWidth: 5, strokeLinecap: "round" }}
        className="animated-edge-path"
      />
    </>
  );
}
