import type { NodeTypeMeta } from "../../../shared/types.ts";
import { nodeMetas } from "../nodes/index.ts";

/** Hard ceiling so a runaway model cannot build a canvas nobody can read. */
export const MAX_NODES = 12;

/** Same rule as the client's `DEFAULT_CONFIG`: only fields with a declared default. */
export function defaultConfig(meta: NodeTypeMeta): Record<string, unknown> {
  return Object.fromEntries(
    meta.fields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue]),
  );
}

function describeField(meta: NodeTypeMeta, field: NodeTypeMeta["fields"][number]): string {
  const parts = [`${field.key}: ${field.type}`];
  if (field.options?.length) {
    parts.push(`(${field.options.map((option) => option.value).join(" | ")})`);
  }
  if (field.defaultValue !== undefined) parts.push(`default ${JSON.stringify(field.defaultValue)}`);
  if (field.help) parts.push(`— ${field.help}`);
  return `    ${parts.join(" ")}`;
}

/**
 * The node catalog handed to the model. Built from `nodeMetas` at call time so a
 * new node (or a renamed field) can never drift from the prompt.
 */
export function describeNodes(): string {
  return nodeMetas
    .map((meta) => {
      const ports = meta.outputs?.length
        ? `handles: ${meta.outputs.map((port) => `"${port.id}"`).join(", ")}`
        : "handles: none (single default output)";
      const fields = meta.fields.length
        ? meta.fields.map((field) => describeField(meta, field)).join("\n")
        : "    none";
      return [
        `- type "${meta.type}" — ${meta.label} [${meta.category}]`,
        `  ${meta.description}`,
        `  ${ports}`,
        "  config keys:",
        fields,
      ].join("\n");
    })
    .join("\n");
}

export const SYSTEM_PROMPT = `You design node graphs for agent_maker, a workflow canvas with a LangGraph engine.

Answer with ONE JSON object, nothing else (no prose outside it, no markdown fences):
{"reply": "<one or two sentences for the human>", "ops": [ ... ]}

An op is one of:
{"op":"add_node","type":"<node type>","label":"<short label>","config":{...},"connectFrom":"<existing node id>","handle":"<handle id>"}
{"op":"update_node","id":"<node id>","label":"<new label>","config":{...}}
{"op":"delete_node","id":"<node id>"}
{"op":"connect","from":"<id>","to":"<id>","handle":"<handle id>"}
{"op":"disconnect","from":"<id>","to":"<id>"}

Rules:
- "connectFrom"/"handle" are optional shortcuts that wire the new node in the same op.
- Node ids are short unique slugs: "start", "classify", "reply". Never reuse an id.
- Only reference ids that already exist in "Current graph", or that an earlier op in the same array adds. Never connect to an id you invented but never added.
- If a node gets dropped (for example a code node), do not connect to it.
- Emit nodes in execution order. Every graph starts from a trigger (manual.trigger) unless the user asks for a fragment.
- Branching nodes (if, switch) route by handle; every outgoing edge from them MUST carry a handle. Other nodes MUST NOT have one.
- Config strings are templates: {{ input.field }} (merged output of direct parents), {{ nodes.<id>.field }} (any node's output), {{ run.id }}, {{ run.input }}. A template that is exactly one placeholder keeps its JSON type.
- Never add a "code" node. The builder rejects it.
- Keep graphs small: ${MAX_NODES} nodes maximum. Prefer one agent over three.
- If the request is ambiguous, put one clarifying question in "reply" and return an empty ops array.

The node catalog follows.

`;

export const REPAIR_PROMPT =
  "Your previous answer was rejected. Fix exactly what the issues describe and answer again with ONE JSON object (reply + ops). No prose, no fences.";
