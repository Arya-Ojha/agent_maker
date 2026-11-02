import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { Graph } from "../../../shared/types.ts";
import { buildModel } from "../langgraph/models.ts";
import { NodeExecutionError } from "../nodes/types.ts";
import { REPAIR_PROMPT, SYSTEM_PROMPT, describeNodes } from "./catalog.ts";
import { BuilderOpError, applyOps, lintGraph, validateGraph, type ApplyResult } from "./ops.ts";
import { friendlyProviderError } from "./providerError.ts";

export interface BuilderTurn {
  role: "user" | "assistant";
  content: string;
}

export interface BuilderInput {
  message: string;
  graph: Graph;
  history: BuilderTurn[];
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
}

export interface BuilderOutput {
  graph: Graph;
  reply: string;
  warnings: string[];
}

/** Compact form: the model needs topology and config, not pixel positions. */
function graphBrief(graph: Graph): string {
  return JSON.stringify({
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.data.label,
      config: node.data.config,
    })),
    edges: graph.edges.map((edge) => ({
      from: edge.source,
      to: edge.target,
      ...(edge.sourceHandle ? { handle: edge.sourceHandle } : {}),
    })),
  });
}

/** First balanced `{...}` in the text, ignoring braces inside strings. */
function extractObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function parseAnswer(text: string): { reply: string; ops: unknown[] } {
  const object = extractObject(text);
  if (!object) {
    throw new BuilderOpError("The model did not return a JSON object.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(object);
  } catch {
    // Models occasionally leave a trailing comma; that is the only repair we do.
    try {
      parsed = JSON.parse(object.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      throw new BuilderOpError("The model returned malformed JSON.");
    }
  }
  if (!parsed || typeof parsed !== "object") {
    throw new BuilderOpError("The model returned JSON that is not an object.");
  }
  const record = parsed as Record<string, unknown>;
  return {
    reply: typeof record["reply"] === "string" ? record["reply"] : "",
    ops: Array.isArray(record["ops"]) ? record["ops"] : [],
  };
}

/**
 * Applies ops and validates the result. Op-level mistakes (unknown id, bad handle)
 * are issues too, not exceptions, so the repair pass can fix them.
 */
function attempt(graph: Graph, ops: unknown[]): { applied: ApplyResult | null; issues: string[] } {
  try {
    const applied = applyOps(graph, ops);
    return { applied, issues: validateGraph(applied.graph) };
  } catch (error) {
    if (error instanceof BuilderOpError) return { applied: null, issues: [error.message] };
    throw error;
  }
}

/** A hung provider connection must not leave the panel on "thinking…" forever. */
const MODEL_TIMEOUT_MS = 60_000;

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    /abort|timed? ?out/i.test(error.message)
  );
}

/**
 * Provider errors are long and JSON-shaped. Surface the cases a user can act on
 * instead of dumping the vendor payload into the panel.
 */
async function invokeModel(
  model: ReturnType<typeof buildModel>,
  messages: BaseMessage[],
) {
  try {
    return await model.invoke(messages, { signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
  } catch (error) {
    if (isTimeout(error)) {
      throw new NodeExecutionError(
        "The model did not answer within 60 seconds. Check the network and the base URL in /provider, or pick another model.",
      );
    }
    throw friendlyProviderError(error);
  }
}

/** Deterministic offline path: proves the whole pipeline without an API key. */
function mockTurn(graph: Graph): { reply: string; ops: unknown[] } {
  if (graph.nodes.length === 0) {
    return {
      reply:
        "Mock builder: I made a trigger → agent → output pipeline. Add a provider key in the panel to get real answers.",
      ops: [
        { op: "add_node", type: "manual.trigger", id: "start", label: "Start" },
        {
          op: "add_node",
          type: "agent",
          id: "agent",
          label: "Agent",
          connectFrom: "start",
          config: {
            provider: "mock",
            system: "You are a helpful assistant.",
            prompt: "{{ input.text }}",
          },
        },
        { op: "add_node", type: "output", id: "result", label: "Result", connectFrom: "agent" },
      ],
    };
  }
  return {
    reply: "Mock builder: the graph is unchanged. Set a real provider key to edit it with a model.",
    ops: [],
  };
}

export async function runBuilderTurn(input: BuilderInput): Promise<BuilderOutput> {
  if (input.provider === "mock") {
    const mocked = mockTurn(input.graph);
    const applied = applyOps(input.graph, mocked.ops);
    return {
      graph: applied.graph,
      reply: mocked.reply,
      warnings: [...applied.warnings, ...lintGraph(applied.graph)],
    };
  }

  const model = buildModel({
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    temperature: 0.2,
    maxOutputTokens: 4096,
  });

  // Agent nodes inherit the chat provider so a generated workflow runs with the
  // same key. Stored keys stay out of config: they live in server memory.
  const baseURL = input.baseURL?.trim();
  const settingsBrief =
    input.provider === "mock"
      ? ""
      : `\nGeneration settings: the user is chatting through provider "${input.provider}"${
          input.model ? ` with model "${input.model}"` : ""
        }${input.provider === "openai" && baseURL ? ` and base URL "${baseURL}"` : ""}. Give every agent node exactly those provider/model${
          input.provider === "openai" && baseURL ? "/baseURL" : ""
        } config values. Never put an API key in config.\n`;

  const messages = [
    new SystemMessage(`${SYSTEM_PROMPT}${settingsBrief}${describeNodes()}`),
    ...input.history.slice(-8).map((turn) =>
      turn.role === "user" ? new HumanMessage(turn.content) : new AIMessage(turn.content),
    ),
    new HumanMessage(`Current graph:\n${graphBrief(input.graph)}\n\nRequest: ${input.message}`),
  ];

  const reply = await invokeModel(model, messages);
  let text = typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content);
  let lastIssues: string[] = [];
  let repaired = false;
  let applied: ApplyResult | null = null;
  let replyText = "";
  let lastOps: unknown[] = [];

  // Two repair rounds: small models (gemini-flash) get ids wrong once in a while
  // and recover when shown the exact issues plus the list of valid ids.
  for (let round = 0; round < 3; round += 1) {
    let answer: { reply: string; ops: unknown[] } | null = null;
    try {
      answer = parseAnswer(text);
      replyText = answer.reply || replyText;
      lastOps = answer.ops;
      const result = attempt(input.graph, answer.ops);
      if (result.applied && result.issues.length === 0) {
        applied = result.applied;
        break;
      }
      lastIssues = result.issues;
    } catch (error) {
      if (!(error instanceof BuilderOpError)) throw error;
      lastIssues = [error.message];
    }

    if (round === 2) break;

    const existing = input.graph.nodes.map((node) => `"${node.id}" (${node.type})`).join(", ") || "none";
    const correction = await invokeModel(model, [
      ...messages,
      new AIMessage(text),
      new HumanMessage(
        `${REPAIR_PROMPT}\n\nIssues:\n- ${lastIssues.join("\n- ")}\n\nNode ids that exist right now: ${existing}. Every connect target must be one of those or an id your own add_node op creates.`,
      ),
    ]);
    text = typeof correction.content === "string" ? correction.content : JSON.stringify(correction.content);
    repaired = true;
  }

  if (!applied) {
    // Last resort: keep the nodes the model did get right and drop only the edges
    // that point at ids it never added. The user sees a warning and can re-ask.
    const salvaged = applyOps(input.graph, lastOps, { lenient: true });
    const remaining = validateGraph(salvaged.graph);
    if (salvaged.graph.nodes.length > input.graph.nodes.length && remaining.length === 0) {
      return {
        graph: salvaged.graph,
        reply: replyText,
        warnings: [
          ...salvaged.warnings,
          ...lintGraph(salvaged.graph),
          "The model got some connections wrong; they were dropped. Ask it to reconnect them.",
        ],
      };
    }
    throw new NodeExecutionError(`The model could not build a valid graph: ${lastIssues.join(" ")}`);
  }

  return {
    graph: applied.graph,
    reply: replyText,
    warnings: [
      ...applied.warnings,
      ...lintGraph(applied.graph),
      ...(repaired ? ["The first attempt was invalid; repaired automatically."] : []),
    ],
  };
}
