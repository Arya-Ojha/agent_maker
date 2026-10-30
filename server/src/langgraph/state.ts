import { Annotation } from "@langchain/langgraph";

/**
 * Run state for compiled canvas graphs.
 *
 * There is no `input` channel: each node's merged input is computed from its
 * incoming edges at compile time and injected into `state` by `asGraphNode`,
 * preserving the old runner's semantics exactly.
 *
 * `outputs` mirrors the old runner's scope: every node's result keyed by node
 * id, merged across nodes. `branches` records which source handles a node
 * activated (the `if`/switch mechanism). `errors` is written by the node
 * wrapper when a node throws; routing cuts the graph at that node.
 */
export const RunState = Annotation.Root({
  /** Run-level input from the API call (`{{ run.input }}`). */
  runInput: Annotation<unknown>({ reducer: (_a, b) => b, default: () => undefined }),
  runId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  outputs: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  branches: Annotation<Record<string, string[]>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  errors: Annotation<Record<string, string>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  /** Written by output nodes; the run's final result. */
  result: Annotation<unknown>({ reducer: (_a, b) => b, default: () => undefined }),
});

export type RunStateType = typeof RunState.State;
export type RunStateUpdate = Partial<typeof RunState.State>;

/** `state` as seen by a node's `run()` — merged input injected by asGraphNode. */
export type LocalRunState = RunStateType & { input: unknown };
