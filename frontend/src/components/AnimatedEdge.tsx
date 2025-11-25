import React, { useMemo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

export function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Calculate duration based on distance for constant speed
  // Using useMemo to prevent recalculations on every render
  const { duration, numCircles, circleSpacing } = useMemo(() => {
    const distance = Math.sqrt(
      Math.pow(targetX - sourceX, 2) + Math.pow(targetY - sourceY, 2)
    );
    const speed = 40; // pixels per second
    const calculatedDuration = distance / speed;

    // Use constant spacing between circles for consistent visual appearance
    const circleSpacing = 1.5; // seconds between each circle (constant)

    // Calculate number of circles that can fit
    const numCircles = Math.max(
      1,
      Math.round(calculatedDuration / circleSpacing)
    );

    // Adjust duration to be an exact multiple of circleSpacing for perfect loop
    const adjustedDuration = numCircles * circleSpacing;

    return { duration: adjustedDuration, numCircles, circleSpacing };
  }, [sourceX, sourceY, targetX, targetY]);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ strokeWidth: 2, stroke: "var(--edge-color)" }}
      />
      {Array.from({ length: numCircles }).map((_, index) => {
        const offset = circleSpacing * index;
        return (
          <circle key={index} r="4" style={{ fill: "var(--edge-color)" }}>
            <animateMotion
              dur={`${duration}s`}
              repeatCount="indefinite"
              path={edgePath}
              begin={`-${offset}s`}
            />
          </circle>
        );
      })}
    </>
  );
}
