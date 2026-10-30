import type { Graph, NodeType, RunEvent } from "../../../shared/types.ts";
import { compileWithPlan, type Plan } from "./compiler.ts";
import type { RunStateType } from "./state.ts";

export interface ExecuteOptions {
  graph: Graph;
  input: unknown;
  runId: string;
  signal: AbortSignal;
  emit: (event: RunEvent) => void;
}

export interface ExecuteResult {
  status: "succeeded" | "failed" | "canceled";
  output: unknown;
  error: string | null;
}

const RECURSION_LIMIT = 64;

/** Shape of `streamEvents(..., { version: "v2" })` items (verified empirically). */
interface StreamEventListener {
  event: string;
  name: string;
  run_id: string;
  tags?: string[];
  data?: { input?: unknown; output?: unknown; chunk?: unknown; error?: unknown; payload?: unknown };
  metadata?: Record<string, unknown>;
}

const now = (): number => Date.now();

export async function executeGraph(options: ExecuteOptions): Promise<ExecuteResult> {
  const { graph, input, runId, signal, emit } = options;

  let compiled: ReturnType<typeof compileWithPlan>["compiled"];
  let plan: Plan;
  try {
    const built = compileWithPlan(graph);
    compiled = built.compiled;
    plan = built.plan;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "run.failed", ts: now(), error: message });
    return { status: "failed", output: null, error: message };
  }

  emit({ type: "run.started", ts: now(), runId });

  const labels = new Map(plan.order.map((node) => [node.id, node.data.label ?? node.type]));
  const startedAt = new Map<string, number>();
  const concluded = new Set<string>();
  const failedReported = new Set<string>();
  let finalState: RunStateType | undefined;

  try {
    const events = compiled.streamEvents(
      { runId, runInput: input ?? null } as unknown as Record<string, unknown>,
      { version: "v2", signal, recursionLimit: RECURSION_LIMIT },
    ) as AsyncIterable<StreamEventListener>;

    for await (const event of events) {
      handleEvent(event, plan, {
        labels,
        startedAt,
        concluded,
        failedReported,
        onFinal: (state) => (finalState = state),
        emit,
      });
    }
  } catch (error) {
    // Node errors are captured in state by asGraphNode; reaching this catch
    // means an abort or an internal graph error (dangling runnable, etc.).
    if (signal.aborted) {
      emit({ type: "run.canceled", ts: now() });
      return { status: "canceled", output: finalState?.result ?? null, error: null };
    }
    const message = error instanceof Error ? error.message : String(error);
    const unfinished = [...startedAt.keys()].filter((id) => !concluded.has(id));
    for (const nodeId of unfinished) {
      emit({
        type: "node.failed",
        ts: now(),
        nodeId,
        error: message,
        durationMs: duration(startedAt.get(nodeId)),
      });
    }
    emit({ type: "run.failed", ts: now(), error: message });
    return { status: "failed", output: finalState?.result ?? null, error: message };
  }

  return conclude(graph, {
    plan,
    emit,
    labels,
    startedAt,
    concluded,
    failedReported,
    finalState,
  });
}

/* --------------------------------- helpers -------------------------------- */

const isTopLevelNode = (event: StreamEventListener, nodeId: string): boolean =>
  event.name === nodeId && event.metadata?.["langgraph_node"] === nodeId && !event.tags?.includes("langsmith:hidden");

const nodeNameOf = (event: StreamEventListener): string | undefined =>
  event.metadata?.["langgraph_node"] as string | undefined;

const duration = (startedAt: number | undefined): number | undefined =>
  startedAt === undefined ? undefined : Math.max(0, now() - startedAt);

function nodeTypeOf(plan: Plan, nodeId: string): NodeType {
  return plan.order.find((node) => node.id === nodeId)?.type ?? "manual.trigger";
}

function handleEvent(
  event: StreamEventListener,
  plan: Plan,
  sinks: {
    labels: Map<string, string>;
    startedAt: Map<string, number>;
    concluded: Set<string>;
    /** Node ids whose failure was already emitted (dedupes against `conclude`). */
    failedReported: Set<string>;
    /** Receives the graph's final accumulated state. */
    onFinal: (state: RunStateType | undefined) => void;
    emit: (event: RunEvent) => void;
  },
): void {
  const nodeId = nodeNameOf(event);

  switch (event.event) {
    case "on_chain_start": {
      if (nodeId && isTopLevelNode(event, nodeId) && !sinks.startedAt.has(nodeId)) {
        sinks.startedAt.set(nodeId, now());
        sinks.emit({
          type: "node.started",
          ts: now(),
          nodeId,
          label: sinks.labels.get(nodeId) ?? nodeId,
          nodeType: nodeTypeOf(plan, nodeId),
        });
      }
      return;
    }

    case "on_custom_event": {
      if (event.name === "node.log") {
        const payload = (event.data?.["payload"] ?? event.data) as
          | { nodeId?: string; message?: string }
          | undefined;
        if (payload && typeof payload.message === "string" && payload.nodeId) {
          sinks.emit({ type: "node.log", ts: now(), nodeId: payload.nodeId, message: payload.message });
        }
      }
      return;
    }

    case "on_chat_model_end": {
      const output = event.data?.["output"] as
        | { usage_metadata?: { input_tokens?: number; output_tokens?: number } }
        | undefined;
      const usage = output?.usage_metadata;
      const inputTokens = usage?.input_tokens ?? 0;
      const outputTokens = usage?.output_tokens ?? 0;
      if (inputTokens === 0 && outputTokens === 0) return;
      const owner = (event.metadata?.["langgraph_node"] as string | undefined) ?? "";
      if (!owner || !sinks.startedAt.has(owner)) return;
      sinks.emit({
        type: "node.log",
        ts: now(),
        nodeId: owner,
        message: `${event.name}: ${inputTokens} in / ${outputTokens} out`,
      });
      return;
    }

    case "on_chain_end": {
      if (event.name === "LangGraph" && !nodeId) {
        sinks.onFinal((event.data?.["output"] as RunStateType | undefined) ?? undefined);
        return;
      }
      if (!nodeId || !isTopLevelNode(event, nodeId) || sinks.concluded.has(nodeId)) return;
      sinks.concluded.add(nodeId);

      const partial = event.data?.["output"] as
        | { outputs?: Record<string, unknown>; errors?: Record<string, string> }
        | undefined;
      const failure = partial?.errors?.[nodeId];
      if (failure) {
        sinks.failedReported.add(nodeId);
        sinks.emit({
          type: "node.failed",
          ts: now(),
          nodeId,
          error: failure,
          durationMs: duration(sinks.startedAt.get(nodeId)),
        });
        return;
      }
      sinks.emit({
        type: "node.succeeded",
        ts: now(),
        nodeId,
        output: partial?.outputs?.[nodeId] ?? null,
        durationMs: duration(sinks.startedAt.get(nodeId)),
      });
      return;
    }

    default:
      return;
  }
}

function emitNodeFailure(
  nodeId: string,
  label: string,
  startedAt: Map<string, number>,
  emit: (event: RunEvent) => void,
  error: string,
): void {
  emit({ type: "node.failed", ts: now(), nodeId, error, durationMs: duration(startedAt.get(nodeId)) });
}

function conclude(
  _graph: Graph,
  context: {
    plan: Plan;
    emit: (event: RunEvent) => void;
    labels: Map<string, string>;
    startedAt: Map<string, number>;
    concluded: Set<string>;
    failedReported: Set<string>;
    finalState: RunStateType | undefined;
  },
): ExecuteResult {
  const { plan, emit, startedAt, concluded, finalState } = context;

  // Nodes LangGraph never routed to (dead branch): closest analogue of the old
  // runner's explicit skips.
  for (const node of plan.order) {
    if (!startedAt.has(node.id) && !concluded.has(node.id)) {
      emit({ type: "node.skipped", ts: now(), nodeId: node.id, reason: "Branch not taken" });
    }
  }

  const errors = finalState?.errors ?? {};
  const failedIds = Object.keys(errors);
  if (failedIds.length > 0) {
    const summary = failedIds.map((id) => `${context.labels.get(id) ?? id}: ${errors[id]}`).join("; ");

    // Fallback in case the failing node never produced its own on_chain_end.
    for (const nodeId of failedIds) {
      if (context.startedAt.has(nodeId) && !context.failedReported.has(nodeId)) {
        emitNodeFailure(nodeId, context.labels.get(nodeId) ?? nodeId, context.startedAt, emit, errors[nodeId] ?? "failed");
      }
    }
    emit({ type: "run.failed", ts: now(), error: summary });
    return { status: "failed", output: finalState?.result ?? null, error: summary };
  }

  const output = deriveOutput(plan, startedAt, finalState);
  emit({ type: "run.succeeded", ts: now(), output });
  return { status: "succeeded", output, error: null };
}

function deriveOutput(plan: Plan, startedAt: Map<string, number>, finalState: RunStateType | undefined): unknown {
  if (finalState?.result !== undefined) return finalState.result;
  for (let index = plan.order.length - 1; index >= 0; index -= 1) {
    const node = plan.order[index];
    if (!node) continue;
    if (startedAt.has(node.id) && node.id in (finalState?.outputs ?? {})) {
      return finalState?.outputs[node.id];
    }
  }
  return null;
}
