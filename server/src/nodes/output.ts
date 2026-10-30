import { renderValue } from "../engine/template.ts";
import { requireString, type NodeDefinition } from "./types.ts";

export const output: NodeDefinition = {
  meta: {
    type: "output",
    label: "Output",
    description: "Final result of the run. A run's output is the last output node to execute.",
    category: "output",
    color: "#14b8a6",
    fields: [
      {
        key: "value",
        label: "Value",
        type: "textarea",
        defaultValue: "{{ input }}",
        help: "A bare {{ input }} preserves objects and arrays.",
      },
    ],
  },
  async execute({ config, scope }) {
    const raw = config["value"];
    const value = raw === undefined || raw === null || raw === "" ? scope.input : renderValue(raw, scope);
    return { output: value };
  },
};
