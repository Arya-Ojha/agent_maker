import { useEffect, useRef, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import type { FlowEdge, FlowGraphNode } from "../types.ts";

/** Grace period for moving the pointer from the line onto the delete button. */
const HIDE_DELAY_MS = 140;

/**
 * A smoothstep edge with a hover/selection delete affordance.
 *
 * The × lives in `EdgeLabelRenderer` (an HTML portal) so it stays the same size at
 * any zoom, which means it is outside the SVG group that reports hover. The hide
 * timer bridges that gap: leaving the line schedules the hide instead of hiding at
 * once, so the pointer can reach the button.
 */
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
}: EdgeProps) {
  const { deleteElements } = useReactFlow<FlowGraphNode, FlowEdge>();
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const reveal = () => {
    window.clearTimeout(hideTimer.current);
    setHovered(true);
  };

  const scheduleHide = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHovered(false), HIDE_DELAY_MS);
  };

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <g onMouseEnter={reveal} onMouseLeave={scheduleHide}>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={24}
      />
      {(hovered || selected) && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="edge-delete nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onMouseEnter={reveal}
            onMouseLeave={scheduleHide}
            onClick={(event) => {
              event.stopPropagation();
              void deleteElements({ edges: [{ id }] });
            }}
            title="Remove connection"
            aria-label="Remove connection"
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}
