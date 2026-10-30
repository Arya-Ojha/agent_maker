import type { NodeTypeMeta } from "../../../shared/types.ts";
import type { NodeRunArgs, NodeRunResult, NodeRunner } from "../langgraph/types.ts";

export interface NodeDefinition {
  meta: NodeTypeMeta;
  run: NodeRunner;
}

export type { NodeRunArgs, NodeRunResult, NodeRunner };

export class NodeExecutionError extends Error {
  override name = "NodeExecutionError";
}

export function requireString(config: Record<string, unknown>, key: string, fallback = ""): string {
  const value = config[key];
  if (value === undefined || value === null) return fallback;
  return String(value);
}

export function optionalNumber(config: Record<string, unknown>, key: string): number | undefined {
  const value = config[key];
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
