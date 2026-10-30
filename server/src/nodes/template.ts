import { renderString, scopeOf } from "../engine/template.ts";
import { requireString, type NodeDefinition } from "./types.ts";

export const template: NodeDefinition = {
  meta: {
    type: "template",
    label: "Template",
    description: "Composes a string from upstream values. Cheapest way to reshape data between nodes.",
    category: "data",
    color: "#0ea5e9",
    fields: [
      {
        key: "template",
        label: "Template",
        type: "textarea",
        defaultValue: "{{ input }}",
        help: "Objects are JSON-stringified. Use {{ input.field }} to pick a field.",
      },
    ],
  },

  async run({ config, state }) {
    return { output: { text: renderString(requireString(config, "template"), scopeOf(state)) } };
  },
};
