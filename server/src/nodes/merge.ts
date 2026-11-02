import { requireString, type NodeDefinition } from "./types.ts";

const STRATEGIES = ["shallow", "array", "keyed"] as const;

type Strategy = (typeof STRATEGIES)[number];

export const merge: NodeDefinition = {
  meta: {
    type: "merge",
    label: "Merge",
    description: "Combines the outputs of several upstream nodes into one value.",
    category: "data",
    color: "#84cc16",
    fields: [
      {
        key: "strategy",
        label: "Strategy",
        type: "select",
        defaultValue: "shallow",
        options: [
          { value: "shallow", label: "Shallow merge (spread objects)" },
          { value: "array", label: "Array (one item per input)" },
          { value: "keyed", label: "Object keyed by parent node id" },
        ],
        help: "Use keyed when downstream nodes need {{ input.<nodeId> }}.",
      },
    ],
  },

  async run({ config, state }) {
    const strategy = requireString(config, "strategy", "shallow") as Strategy;
    if (!STRATEGIES.includes(strategy)) {
      throw new Error(`Unknown merge strategy "${strategy}". Use one of: ${STRATEGIES.join(", ")}.`);
    }

    const keyed = keyedParts(state.input, state.outputs);

    if (strategy === "keyed") {
      if (keyed) return { output: keyed };
      const id = parentIdOf(state.input, state.outputs);
      return { output: { [id ?? "value"]: state.input ?? null } };
    }

    if (strategy === "array") {
      return { output: { items: keyed ? Object.values(keyed) : [state.input ?? null] } };
    }

    const out: Record<string, unknown> = {};
    for (const part of keyed ? Object.values(keyed) : [state.input]) {
      if (isPlainObject(part)) {
        Object.assign(out, part);
      } else if (part !== undefined && part !== null) {
        Object.assign(out, { value: part });
      }
    }
    return { output: out };
  },
};

/**
 * The engine hands a node with several parents `{ [parentId]: output }`.
 * Detect that shape by checking the values are the live outputs of those ids.
 */
function keyedParts(
  input: unknown,
  outputs: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!isPlainObject(input)) return undefined;
  const keys = Object.keys(input);
  if (keys.length < 2) return undefined;
  const matches = keys.every((key) => key in outputs && outputs[key] === input[key]);
  return matches ? input : undefined;
}

function parentIdOf(input: unknown, outputs: Record<string, unknown>): string | undefined {
  if (input === undefined || input === null) return undefined;
  return Object.keys(outputs).find((key) => outputs[key] === input);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
