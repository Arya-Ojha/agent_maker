import { renderString, scopeOf } from "../engine/template.ts";
import { NodeExecutionError, requireString, type NodeDefinition } from "./types.ts";

const COMPARATORS = ["equals", "contains", "regex"] as const;

type Comparator = (typeof COMPARATORS)[number];

/** Case handles are fixed so the canvas can draw them without dynamic metadata. */
const CASES = [1, 2, 3, 4] as const;

export const switchNode: NodeDefinition = {
  meta: {
    type: "switch",
    label: "Switch",
    description: "Routes the run to the first matching case, or to else when nothing matches.",
    category: "flow",
    color: "#a855f7",
    outputs: [
      ...CASES.map((index) => ({ id: `case${index}`, label: `case ${index}` })),
      { id: "else", label: "else" },
    ],
    fields: [
      {
        key: "value",
        label: "Value",
        type: "text",
        defaultValue: "{{ input.text }}",
        help: "Templating is supported.",
      },
      {
        key: "comparator",
        label: "Compare with",
        type: "select",
        defaultValue: "equals",
        options: COMPARATORS.map((value) => ({ value, label: value })),
      },
      ...CASES.map((index) => ({
        key: `case${index}`,
        label: `Case ${index}`,
        type: "text" as const,
        defaultValue: "",
        help: "Left empty, the case is ignored.",
      })),
    ],
  },

  async run({ config, state, log }) {
    const scope = scopeOf(state);
    const value = renderString(requireString(config, "value"), scope);
    const comparator = requireString(config, "comparator", "equals") as Comparator;

    if (!COMPARATORS.includes(comparator)) {
      throw new NodeExecutionError(
        `Unknown comparator "${comparator}". Use one of: ${COMPARATORS.join(", ")}.`,
      );
    }

    for (const index of CASES) {
      const raw = requireString(config, `case${index}`).trim();
      if (!raw) continue;
      const expected = renderString(raw, scope);
      if (matches(value, expected, comparator)) {
        log(`matched case ${index}: "${expected}"`);
        return { output: { value, matched: expected, case: `case${index}` }, branches: [`case${index}`] };
      }
    }

    log("no case matched, taking else");
    return { output: { value, matched: null, case: "else" }, branches: ["else"] };
  },
};

function matches(value: string, expected: string, comparator: Comparator): boolean {
  switch (comparator) {
    case "equals":
      return value === expected;
    case "contains":
      return value.includes(expected);
    case "regex":
      try {
        return new RegExp(expected).test(value);
      } catch {
        throw new NodeExecutionError(`Invalid regular expression: ${expected}`);
      }
  }
}
