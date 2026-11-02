import { renderString, scopeOf } from "../engine/template.ts";
import { requireString, type NodeDefinition } from "./types.ts";

export const log: NodeDefinition = {
  meta: {
    type: "log",
    label: "Debug Log",
    description: "Writes a templated message to the run panel, then passes its input through.",
    category: "data",
    color: "#eab308",
    fields: [
      {
        key: "level",
        label: "Level",
        type: "select",
        defaultValue: "info",
        options: ["info", "warn", "error"].map((value) => ({ value, label: value })),
      },
      {
        key: "message",
        label: "Message",
        type: "text",
        defaultValue: "{{ input }}",
        help: "Templating is supported; objects are JSON-stringified.",
      },
    ],
  },

  async run({ config, state, log: emit }) {
    const level = requireString(config, "level", "info");
    const message = renderString(requireString(config, "message"), scopeOf(state)).trim();
    emit(message ? `[${level}] ${message}` : `[${level}]`);
    return { output: state.input };
  },
};
