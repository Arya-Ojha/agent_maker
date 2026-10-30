import type { NodeType, NodeTypeMeta } from "../../../shared/types.ts";
import { agent } from "./agent.ts";
import { http } from "./http.ts";
import { ifElse } from "./if.ts";
import { manualTrigger } from "./manualTrigger.ts";
import { output } from "./output.ts";
import { template } from "./template.ts";
import type { NodeRegistry } from "./types.ts";

export const registry: NodeRegistry = {
  "manual.trigger": manualTrigger,
  agent,
  template,
  http,
  if: ifElse,
  output,
};

export const nodeMetas: NodeTypeMeta[] = Object.values(registry).map((node) => node.meta);

export const isNodeType = (value: string): value is NodeType => value in registry;

export function definitionFor(type: NodeType) {
  return registry[type];
}
