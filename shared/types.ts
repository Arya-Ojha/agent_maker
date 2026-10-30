/**
 * Shared contract between the engine (server) and the canvas (web).
 * Type-only: no runtime imports, so both sides can read it directly.
 */

export type NodeType =
  | "manual.trigger"
  | "agent"
  | "template"
  | "http"
  | "if"
  | "output";

export interface Point {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  position: Point;
  data: {
    label?: string;
    config: Record<string, unknown>;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Workflow {
  id: string;
  name: string;
  graph: Graph;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  nodeCount: number;
  createdAt: number;
  updatedAt: number;
}

export type RunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export interface Run {
  id: string;
  workflowId: string;
  status: RunStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export type RunEvent =
  | { type: "run.started"; ts: number; runId: string }
  | {
      type: "node.started";
      ts: number;
      nodeId: string;
      label: string;
      nodeType: NodeType;
    }
  | { type: "node.log"; ts: number; nodeId: string; message: string }
  | {
      type: "node.succeeded";
      ts: number;
      nodeId: string;
      output: unknown;
      durationMs?: number;
    }
  | {
      type: "node.failed";
      ts: number;
      nodeId: string;
      error: string;
      durationMs?: number;
    }
  | { type: "node.skipped"; ts: number; nodeId: string; reason: string }
  | { type: "run.succeeded"; ts: number; output: unknown }
  | { type: "run.failed"; ts: number; error: string }
  | { type: "run.canceled"; ts: number };

export interface StoredRunEvent {
  seq: number;
  runId: string;
  ts: number;
  event: RunEvent;
}

/* ------------------------------------------------------------------ */
/* Node metadata drives the inspector UI: one source of truth.         */
/* ------------------------------------------------------------------ */

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "boolean"
  | "json"
  | "secret";

export interface NodeField {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
  defaultValue?: unknown;
  options?: Array<{ value: string; label: string }>;
  /** Only show this field when another field has one of these values. */
  showWhen?: { key: string; equals: string[] };
}

export interface NodePort {
  id: string;
  label: string;
}

export interface NodeTypeMeta {
  type: NodeType;
  label: string;
  description: string;
  category: "trigger" | "ai" | "data" | "flow" | "output";
  /** Accent color used by the canvas. */
  color: string;
  /** Output handles; omitted means a single default output. */
  outputs?: NodePort[];
  fields: NodeField[];
}
