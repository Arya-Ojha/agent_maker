import type { GraphNode } from "../../../shared/types.ts";
import type { LocalRunState } from "./state.ts";

/** What a node needs at execution time. */
export interface NodeRunArgs {
  node: GraphNode;
  /** Raw `node.data.config` — nodes render their own templates. */
  config: Record<string, unknown>;
  /** This node's merged upstream output + shared run state. */
  state: LocalRunState;
  signal: AbortSignal;
  /** Streams a log line to the run panel via a custom callback event. */
  log: (message: string) => void;
}

export interface NodeRunResult {
  output: unknown;
  /** Source handle ids to activate; omitted means all outgoing edges. */
  branches?: string[];
  /** Written to `state.result` (used by the output node). */
  result?: unknown;
}

export type NodeRunner = (args: NodeRunArgs) => Promise<NodeRunResult>;
