import { renderString } from "../engine/template.ts";
import { NodeExecutionError, requireString, type NodeDefinition } from "./types.ts";

const OPERATORS = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "greaterThan",
  "lessThan",
  "regex",
] as const;

type Operator = (typeof OPERATORS)[number];

export const asText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

export const ifElse: NodeDefinition = {
  meta: {
    type: "if",
    label: "If / Else",
    description: "Routes the run down the true or false branch. Only the taken branch executes.",
    category: "flow",
    color: "#ec4899",
    outputs: [
      { id: "true", label: "true" },
      { id: "false", label: "false" },
    ],
    fields: [
      {
        key: "left",
        label: "Value",
        type: "text",
        defaultValue: "{{ input.text }}",
      },
      {
        key: "operator",
        label: "Operator",
        type: "select",
        defaultValue: "contains",
        options: OPERATORS.map((value) => ({ value, label: value })),
      },
      {
        key: "right",
        label: "Compare to",
        type: "text",
        defaultValue: "",
        help: "Templating is supported on both sides.",
      },
    ],
  },

  async execute({ config, scope }) {
    const left = renderString(requireString(config, "left"), scope);
    const right = renderString(requireString(config, "right"), scope);
    const operator = requireString(config, "operator", "contains") as Operator;

    const result = compare(left, right, operator);
    return {
      output: { result, left, right, operator },
      branches: [result ? "true" : "false"],
    };
  },
};

function compare(left: string, right: string, operator: Operator): boolean {
  switch (operator) {
    case "equals":
      return left === right;
    case "notEquals":
      return left !== right;
    case "contains":
      return left.includes(right);
    case "notContains":
      return !left.includes(right);
    case "greaterThan":
      return toNumber(left) > toNumber(right);
    case "lessThan":
      return toNumber(left) < toNumber(right);
    case "regex":
      try {
        return new RegExp(right).test(left);
      } catch {
        throw new NodeExecutionError(`Invalid regular expression: ${right}`);
      }
    default:
      throw new NodeExecutionError(
        `Unknown operator "${operator}". Use one of: ${OPERATORS.join(", ")}.`,
      );
  }
}

function toNumber(value: string): number {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    throw new NodeExecutionError(`Cannot compare "${value}" numerically.`);
  }
  return parsed;
}
