import { renderString, scopeOf } from "../engine/template.ts";
import { NodeExecutionError, requireString, type NodeDefinition } from "./types.ts";

export const split: NodeDefinition = {
  meta: {
    type: "split",
    label: "Split Text",
    description: "Splits text into an array of items. Pair it with an Output node to inspect chunks.",
    category: "data",
    color: "#06b6d4",
    fields: [
      {
        key: "text",
        label: "Text",
        type: "textarea",
        defaultValue: "{{ input.text }}",
      },
      {
        key: "separator",
        label: "Separator",
        type: "text",
        defaultValue: "\\n",
        help: "Literal text. Escape sequences (\\n, \\t, \\r) are interpreted.",
      },
      {
        key: "trim",
        label: "Trim each item",
        type: "boolean",
        defaultValue: true,
      },
      {
        key: "removeEmpty",
        label: "Drop empty items",
        type: "boolean",
        defaultValue: true,
      },
    ],
  },

  async run({ config, state }) {
    const text = renderString(requireString(config, "text"), scopeOf(state));
    const separator = unescape(requireString(config, "separator", "\\n"));
    if (!separator) throw new NodeExecutionError("Separator is empty after rendering.");

    const trim = config["trim"] !== false;
    const removeEmpty = config["removeEmpty"] !== false;

    let items = text.split(separator);
    if (trim) items = items.map((item) => item.trim());
    if (removeEmpty) items = items.filter((item) => item !== "");

    return { output: { items, count: items.length } };
  },
};

function unescape(value: string): string {
  return value.replace(/\\(n|r|t|\\)/g, (_match, code: string) =>
    code === "n" ? "\n" : code === "r" ? "\r" : code === "t" ? "\t" : "\\",
  );
}
