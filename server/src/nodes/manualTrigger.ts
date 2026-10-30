import { NodeExecutionError, requireString, type NodeDefinition } from "./types.ts";

export const manualTrigger: NodeDefinition = {
  meta: {
    type: "manual.trigger",
    label: "Manual Trigger",
    description: "Starting point of a run. Seeds the payload that downstream nodes see as {{ input }}.",
    category: "trigger",
    color: "#22c55e",
    fields: [
      {
        key: "payload",
        label: "Run input (JSON)",
        type: "json",
        defaultValue: { topic: "Why small models are getting interesting" },
        help: "Passed through as {{ input }}. Objects keep their shape.",
      },
    ],
  },

  async run({ config }) {
    const payload = config["payload"];
    if (payload === undefined || payload === null || payload === "") return { output: {} };
    if (typeof payload !== "object") return { output: { value: payload } };
    return { output: payload };
  },
};
