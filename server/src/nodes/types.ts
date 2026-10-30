import type { GraphNode, NodeType, NodeTypeMeta } from "../../../shared/types.ts";

export interface NodeScope {
  /** Merged output of upstream nodes. */
  input: unknown;
  /** Every node's output so far, keyed by node id. */
  nodes: Record<string, unknown>;
  run: { id: string; input: unknown };
}

export interface NodeContext extends NodeScope {
  node: GraphNode;
  config: Record<string, unknown>;
  signal: AbortSignal;
  log: (message: string) => void;
  scope: NodeScope & Record<string, unknown>;
}

export interface NodeResult {
  output: unknown;
  /** Source handle ids to activate. Omitted = all outgoing edges. */
  branches?: string[];
}

export interface NodeDefinition {
  meta: NodeTypeMeta;
  execute: (ctx: NodeContext) => Promise<NodeResult>;
}

export type NodeRegistry = Record<NodeType, NodeDefinition>;

export class NodeExecutionError extends Error {
  override name = "NodeExecutionError";
}

export function requireString(config: Record<string, unknown>, key: string, fallback = ""): string {
  const value = config[key];
  if (value === undefined || value === null) return fallback;
  return String(value);
}

export function optionalNumber(
  config: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = config[key];
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
