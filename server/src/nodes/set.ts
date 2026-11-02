import { renderValue, scopeOf } from "../engine/template.ts";
import { NodeExecutionError, type NodeDefinition } from "./types.ts";

export const set: NodeDefinition = {
  meta: {
    type: "set",
    label: "Edit Fields",
    description: "Builds an object from templated values and merges it into the incoming data.",
    category: "data",
    color: "#10b981",
    fields: [
      {
        key: "fields",
        label: "Fields (JSON)",
        type: "json",
        defaultValue: { text: "{{ input.text }}" },
        help: 'Object of key → value. A value that is exactly one placeholder keeps its type: { "items": "{{ input.items }}" }.',
      },
      {
        key: "keepInput",
        label: "Keep incoming fields",
        type: "boolean",
        defaultValue: true,
        help: "When off, only the fields above are emitted.",
      },
    ],
  },

  async run({ config, state }) {
    const rendered = renderValue(config["fields"] ?? {}, scopeOf(state));
    if (!isPlainObject(rendered)) {
      throw new NodeExecutionError("Fields must be a JSON object.");
    }

    const keep = config["keepInput"] !== false;
    const base = keep && isPlainObject(state.input) ? (state.input as Record<string, unknown>) : {};
    return { output: { ...base, ...(rendered as Record<string, unknown>) } };
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
