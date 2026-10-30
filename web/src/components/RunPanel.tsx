import { useEffect, useRef } from "react";
import type { RunStatus, StoredRunEvent } from "../../../shared/types.ts";
import type { FlowGraphNode } from "../types.ts";
import type { NodeRuntime } from "./Inspector.tsx";

interface Props {
  status: RunStatus | "starting";
  events: StoredRunEvent[];
  runtime: Record<string, NodeRuntime>;
  nodes: FlowGraphNode[];
  error: string | null;
  onCancel: () => void;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}

export function RunPanel({ status, events, runtime, nodes, error, onCancel, onClose, onSelectNode }: Props) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events.length]);

  const labelFor = (nodeId: string) =>
    nodes.find((node) => node.id === nodeId)?.data.label ?? nodeId;

  return (
    <div className="run-panel">
      <div className="run-panel-head">
        <span className={`pill ${status === "starting" ? "running" : status}`}>{status}</span>
        <span className="muted small">{events.length} events</span>
        <div className="spacer" />
        {status === "running" && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onClose}>
          Hide
        </button>
      </div>

      {error && <div className="banner error-box">{error}</div>}

      <div className="run-body">
        <div className="run-steps">
          {nodes.map((node) => {
            const state = runtime[node.id];
            return (
              <button
                key={node.id}
                type="button"
                className={`run-step ${state?.status ?? "idle"}`}
                onClick={() => onSelectNode(node.id)}
              >
                <span className="run-step-dot" />
                <span className="run-step-label">{node.data.label}</span>
                <span className="muted small">
                  {state?.status === "succeeded" && state.durationMs !== undefined
                    ? `${state.durationMs}ms`
                    : state?.status ?? ""}
                </span>
              </button>
            );
          })}
        </div>

        <div className="run-log" ref={logRef}>
          {events.map((stored) => (
            <LogLine key={stored.seq} event={stored.event} labelFor={labelFor} />
          ))}
          {events.length === 0 && <div className="muted small">Waiting for events…</div>}
        </div>
      </div>
    </div>
  );
}

const time = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour12: false }) + "." + String(ts % 1000).padStart(3, "0");

function LogLine({
  event,
  labelFor,
}: {
  event: StoredRunEvent["event"];
  labelFor: (nodeId: string) => string;
}) {
  const prefix = <span className="log-time">{time(event.ts)}</span>;

  switch (event.type) {
    case "run.started":
      return (
        <div className="log-line info">
          {prefix} <span>run started</span>
        </div>
      );
    case "node.started":
      return (
        <div className="log-line">
          {prefix} <span className="node-tag">{labelFor(event.nodeId)}</span> started
        </div>
      );
    case "node.log":
      return (
        <div className="log-line subtle">
          {prefix} <span className="node-tag">{labelFor(event.nodeId)}</span> {event.message}
        </div>
      );
    case "node.succeeded":
      return (
        <div className="log-line ok">
          {prefix} <span className="node-tag">{labelFor(event.nodeId)}</span> done in {event.durationMs}ms
        </div>
      );
    case "node.failed":
      return (
        <div className="log-line error">
          {prefix} <span className="node-tag">{labelFor(event.nodeId)}</span> {event.error}
        </div>
      );
    case "node.skipped":
      return (
        <div className="log-line subtle">
          {prefix} <span className="node-tag">{labelFor(event.nodeId)}</span> skipped ({event.reason})
        </div>
      );
    case "run.succeeded":
      return (
        <div className="log-line ok">
          {prefix} <strong>run succeeded</strong>
        </div>
      );
    case "run.failed":
      return (
        <div className="log-line error">
          {prefix} <strong>run failed:</strong> {event.error}
        </div>
      );
    case "run.canceled":
      return (
        <div className="log-line subtle">
          {prefix} <strong>run canceled</strong>
        </div>
      );
    default:
      return null;
  }
}
