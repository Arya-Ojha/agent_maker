import { END, START, StateGraph } from "@langchain/langgraph";
import type { Graph, GraphEdge, GraphNode } from "../../../shared/types.ts";
import { definitionFor, isNodeType } from "../nodes/index.ts";
import { asGraphNode } from "./asNode.ts";
import { RunState, type RunStateType } from "./state.ts";

export class GraphError extends Error {
  override name = "GraphError";
}

/** Structural surface of the compiler we actually touch (keeps generic churn out). */
interface BuilderLike {
  addNode(
    key: string,
    action: (state: RunStateType, config?: unknown) => Promise<Partial<RunStateType>>,
  ): BuilderLike;
  addEdge(source: string, target: string): BuilderLike;
  addConditionalEdges(source: string, path: (state: RunStateType) => string[]): BuilderLike;
  compile(): RunnableGraph;
}

export interface RunnableGraph {
  streamEvents(
    input: unknown,
    options: { version: "v2"; signal?: AbortSignal; recursionLimit?: number },
  ): AsyncIterable<unknown>;
  invoke(input: unknown, options?: { signal?: AbortSignal; recursionLimit?: number }): Promise<unknown>;
}

export interface Plan {
  order: GraphNode[];
  incoming: Map<string, string[]>;
  outgoing: Map<string, GraphEdge[]>;
}

/** Structural validation shared by the compiler and the AI builder. */
export function planGraph(graph: Graph): Plan {
  const byId = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    if (byId.has(node.id)) throw new GraphError(`Duplicate node id "${node.id}".`);
    if (!isNodeType(node.type)) {
      throw new GraphError(`Unknown node type "${node.type}" on node "${node.id}".`);
    }
    byId.set(node.id, node);
  }
  if (byId.size === 0) throw new GraphError("Workflow has no nodes.");

  const incoming = new Map<string, string[]>(graph.nodes.map((node) => [node.id, []]));
  const outgoing = new Map<string, GraphEdge[]>(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    if (!byId.has(edge.source)) {
      throw new GraphError(`Edge "${edge.id}" starts at missing node "${edge.source}".`);
    }
    if (!byId.has(edge.target)) {
      throw new GraphError(`Edge "${edge.id}" points at missing node "${edge.target}".`);
    }
    incoming.get(edge.target)?.push(edge.source);
    outgoing.get(edge.source)?.push(edge);
  }

  // Branch-handle consistency: a node either makes no branch decisions, or all
  // of its outgoing edges carry a handle those decisions can select.
  for (const [id, edges] of outgoing) {
    const handled = edges.filter((edge) => edge.sourceHandle);
    if (handled.length > 0 && handled.length !== edges.length) {
      throw new GraphError(
        `Node "${id}" mixes handled and unhandled outgoing edges (${handled.length}/${edges.length}).`,
      );
    }
  }

  // Cycle detection via Kahn's algorithm. LangGraph supports loops natively,
  // but the canvas has no loop UI yet — reject early with a readable error.
  const indegree = new Map<string, number>(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
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
    const stuck = graph.nodes
      .filter((node) => !order.includes(node))
      .map((node) => node.data.label ?? node.id);
    throw new GraphError(`Workflow contains a cycle through: ${stuck.join(", ")}.`);
  }

  return { order, incoming, outgoing };
}

function targetsFor(node: GraphNode, edges: GraphEdge[], state: RunStateType): string[] {
  if (state.errors[node.id]) return [];
  const active = state.branches[node.id];
  return edges
    .filter((edge) => (active ? active.includes(edge.sourceHandle ?? "") : true))
    .map((edge) => edge.target)
    .filter((target, index, self) => self.indexOf(target) === index);
}

/** Validates and compiles a canvas graph into a runnable LangGraph. */
export function compileWithPlan(graph: Graph): { compiled: RunnableGraph; plan: Plan } {
  const plan = planGraph(graph);

  const builder = new StateGraph(RunState) as unknown as BuilderLike;

  for (const node of plan.order) {
    builder.addNode(
      node.id,
      asGraphNode(node, definitionFor(node.type)!.run, plan.incoming.get(node.id) ?? []),
    );
  }

  for (const node of plan.order) {
    const edges = plan.outgoing.get(node.id) ?? [];
    if (edges.length === 0) {
      builder.addEdge(node.id, END);
    } else {
      builder.addConditionalEdges(node.id, (state: RunStateType) => targetsFor(node, edges, state));
    }
  }

  for (const node of plan.order) {
    if ((plan.incoming.get(node.id) ?? []).length === 0) {
      builder.addEdge(START, node.id);
    }
  }

  return { compiled: builder.compile(), plan };
}

export function compileGraph(graph: Graph): RunnableGraph {
  return compileWithPlan(graph).compiled;
}
