import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { GraphNode } from "../../../shared/types.ts";
import type { LocalRunState, RunStateType, RunStateUpdate } from "./state.ts";
import type { NodeRunner } from "./types.ts";

/**
 * Adapts a node's `run()` into a LangGraph node function.
 *
 * - injects the node's merged input (from its incoming edges) as `state.input`,
 *   preserving the sequential runner's semantics,
 * - maps `NodeRunResult` onto the state channels,
 * - captures errors into `state.errors` keyed by node id, so routing stops the
 *   graph at the failure point and the event adapter can attribute it,
 * - rethrows aborts so the run reports cancellation instead of failure.
 */
export function asGraphNode(node: GraphNode, runner: NodeRunner, incomingIds: string[]) {
  return async (
    fullState: RunStateType,
    rawConfig?: unknown,
  ): Promise<RunStateUpdate> => {
    const config = rawConfig as LangGraphRunnableConfig | undefined;
    const signal = config?.signal ?? new AbortController().signal;
    const mergedInput =
      incomingIds.length === 0
        ? undefined
        : incomingIds.length === 1
          ? fullState.outputs[incomingIds[0]!]
          : Object.fromEntries(incomingIds.map((id) => [id, fullState.outputs[id]]));
    const state: LocalRunState = { ...fullState, input: mergedInput };

    const log = (message: string): void => {
      void dispatchCustomEvent("node.log", { nodeId: node.id, message, ts: Date.now() }, config).catch(
        () => undefined,
      );
    };

    try {
      const result = await runner({
        node,
        config: node.data.config ?? {},
        state,
        signal,
        log,
      });
      return {
        outputs: { [node.id]: result.output },
        ...(result.branches ? { branches: { [node.id]: result.branches } } : {}),
        ...(result.result !== undefined ? { result: result.result } : {}),
      };
    } catch (error) {
      if (signal.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      return { errors: { [node.id]: message } };
    }
  };
}
