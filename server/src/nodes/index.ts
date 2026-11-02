import type { NodeType, NodeTypeMeta } from "../../../shared/types.ts";
import { agent } from "./agent.ts";
import { code } from "./code.ts";
import { delay } from "./delay.ts";
import { http } from "./http.ts";
import { ifElse } from "./if.ts";
import { log } from "./log.ts";
import { manualTrigger } from "./manualTrigger.ts";
import { merge } from "./merge.ts";
import { output } from "./output.ts";
import { set } from "./set.ts";
import { split } from "./split.ts";
import { switchNode } from "./switch.ts";
import { template } from "./template.ts";
import type { NodeDefinition } from "./types.ts";

export const registry: Record<NodeType, NodeDefinition> = {
  "manual.trigger": manualTrigger,
  agent,
  template,
  http,
  if: ifElse,
  switch: switchNode,
  delay,
  output,
  set,
  split,
  merge,
  code,
  log,
};

export const nodeMetas: NodeTypeMeta[] = Object.values(registry).map((node) => node.meta);

export const isNodeType = (value: string): value is NodeType => value in registry;

export function definitionFor(type: NodeType): NodeDefinition | undefined {
  return registry[type];
}
