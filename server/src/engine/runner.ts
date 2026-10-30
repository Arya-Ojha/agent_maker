import type { Graph, GraphEdge, GraphNode, RunEvent } from "../../../shared/types.ts";
import { registry } from "../nodes/index.ts";
import type { NodeContext } from "../nodes/types.ts";

export class GraphError extends Error {
  override name = "GraphError";
}

export class RunCanceled extends Error {
  override name = "RunCanceled";
}

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

const now = (): number => Date.now();

/**
 * Validates the graph and returns nodes in execution order.
 * Throws GraphError on dangling edges, duplicate ids, or cycles.
 */
export function planRun(graph: Graph): GraphNode[] {
  const byId = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    if (byId.has(node.id)) throw new GraphError(`Duplicate node id "${node.id}".`);
    if (!registry[node.type]) throw new GraphError(`Unknown node type "${node.type}" on node "${node.id}".`);
    byId.set(node.id, node);
  }
  if (byId.size === 0) throw new GraphError("Workflow has no nodes.");

  for (const edge of graph.edges) {
    if (!byId.has(edge.source)) throw new GraphError(`Edge "${edge.id}" starts at missing node "${edge.source}".`);
    if (!byId.has(edge.target)) throw new GraphError(`Edge "${edge.id}" points at missing node "${edge.target}".`);
  }

  const indegree = new Map<string, number>(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, GraphEdge[]>(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge);
  }

  const queue = graph.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const order: GraphNode[] = [];

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    const node = byId.get(id);
    if (!node) continue;
    order.push(node);
    for (const edge of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(edge.target) ?? 1) - 1;
      indegree.set(edge.target, remaining);
      if (remaining === 0) queue.push(edge.target);
    }
  }

  if (order.length !== graph.nodes.length) {
    const stuck = graph.nodes.filter((node) => !order.includes(node)).map((node) => node.data.label ?? node.id);
    throw new GraphError(`Workflow contains a cycle through: ${stuck.join(", ")}.`);
  }

  return order;
}

export async function executeGraph({ graph, input, runId, signal, emit }: ExecuteOptions): Promise<ExecuteResult> {
  let order: GraphNode[];
  try {
    order = planRun(graph);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "run.failed", ts: now(), error: message });
    return { status: "failed", output: null, error: message };
  }

  const incoming = new Map<string, GraphEdge[]>(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) incoming.get(edge.target)?.push(edge);

  const outputs: Record<string, unknown> = {};
  const activeEdges = new Set<string>();
  const canceled = (): boolean => signal.aborted;

  emit({ type: "run.started", ts: now(), runId });

  let runOutput: unknown = null;
  let sawOutput = false;
  let failure: string | null = null;

  for (const node of order) {
    if (canceled()) break;

    const edges = incoming.get(node.id) ?? [];
    const isActive = edges.length === 0 || edges.some((edge) => activeEdges.has(edge.id));

    if (!isActive) {
      emit({
        type: "node.skipped",
        ts: now(),
        nodeId: node.id,
        reason: "Branch not taken",
      });
      continue;
    }

    const mergedInput =
      edges.length === 0
        ? undefined
        : edges.length === 1
          ? outputs[edges[0]!.source]
          : Object.fromEntries(edges.map((edge) => [edge.source, outputs[edge.source]]));

    const scope = {
      input: mergedInput,
      nodes: outputs,
      run: { id: runId, input },
    };

    // Nodes render their own templates: pre-rendering here would double-expand
    // prompts that legitimately contain "{{".
    const config = (node.data.config ?? {}) as Record<string, unknown>;

    const ctx: NodeContext = {
      ...scope,
      scope,
      node,
      config,
      signal,
      log: (message) => emit({ type: "node.log", ts: now(), nodeId: node.id, message }),
    };

    const label = node.data.label ?? node.type;
    emit({ type: "node.started", ts: now(), nodeId: node.id, label, nodeType: node.type });
    const startedAt = now();

    try {
      const result = await registry[node.type].execute(ctx);
      outputs[node.id] = result.output;

      const allowed = result.branches ? new Set(result.branches) : null;
      for (const edge of graph.edges.filter((candidate) => candidate.source === node.id)) {
        if (!allowed || allowed.has(edge.sourceHandle ?? "")) activeEdges.add(edge.id);
      }

      if (node.type === "output") {
        runOutput = result.output;
        sawOutput = true;
      }

      emit({
        type: "node.succeeded",
        ts: now(),
        nodeId: node.id,
        output: result.output,
        durationMs: now() - startedAt,
      });
    } catch (error) {
      if (canceled()) break;
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: "node.failed", ts: now(), nodeId: node.id, error: message, durationMs: now() - startedAt });
      failure = `${label}: ${message}`;
      break;
    }
  }

  if (canceled()) {
    emit({ type: "run.canceled", ts: now() });
    return { status: "canceled", output: runOutput, error: null };
  }

  if (failure) {
    emit({ type: "run.failed", ts: now(), error: failure });
    return { status: "failed", output: runOutput, error: failure };
  }

  const output = sawOutput ? runOutput : lastOutput(outputs, order);
  emit({ type: "run.succeeded", ts: now(), output });
  return { status: "succeeded", output, error: null };
}

function lastOutput(outputs: Record<string, unknown>, order: GraphNode[]): unknown {
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const node = order[index];
    if (node && node.id in outputs) return outputs[node.id];
  }
  return null;
}
