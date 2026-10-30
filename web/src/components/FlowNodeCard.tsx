import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowGraphNode } from "../types.ts";
import { useMeta } from "../metaContext.ts";

function FlowNodeCard({ data, selected }: NodeProps<FlowGraphNode>) {
  const { byType } = useMeta();
  const meta = byType[data.nodeType];
  const color = meta?.color ?? "#64748b";
  const status = data.status ?? "idle";
  const ports = meta?.outputs ?? [{ id: "out", label: "out" }];

  return (
    <div
      className={`flow-node status-${status}${selected ? " selected" : ""}`}
      style={{ ["--accent" as string]: color }}
    >
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="flow-node-head">
        <span className="dot" />
        <span className="flow-node-title">{data.label}</span>
        <StatusBadge status={status} durationMs={data.durationMs} />
      </div>
      <div className="flow-node-type">{meta?.label ?? data.nodeType}</div>

      {ports.map((port, index) => {
        const top = `${((index + 1) / (ports.length + 1)) * 100}%`;
        return (
          <div key={port.id}>
            {ports.length > 1 && (
              <span className="port-label" style={{ top }}>
                {port.label}
              </span>
            )}
            <Handle
              id={ports.length > 1 ? port.id : undefined}
              type="source"
              position={Position.Right}
              className="handle"
              style={{ top }}
            />
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status, durationMs }: { status: string; durationMs?: number }) {
  if (status === "running") return <span className="badge running">running</span>;
  if (status === "succeeded")
    return <span className="badge ok">{durationMs !== undefined ? `${durationMs}ms` : "ok"}</span>;
  if (status === "failed") return <span className="badge error">failed</span>;
  if (status === "skipped") return <span className="badge muted">skipped</span>;
  return null;
}

export default memo(FlowNodeCard);
