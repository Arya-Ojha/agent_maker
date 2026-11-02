import { optionalNumber, type NodeDefinition } from "./types.ts";

const MAX_WAIT_MS = 5 * 60 * 1000;

export const delay: NodeDefinition = {
  meta: {
    type: "delay",
    label: "Delay",
    description: "Pauses the run for a fixed time, then passes its input through unchanged.",
    category: "flow",
    color: "#64748b",
    fields: [
      {
        key: "ms",
        label: "Wait (ms)",
        type: "number",
        defaultValue: 1000,
        help: `Capped at ${MAX_WAIT_MS}ms. Canceled runs stop waiting immediately.`,
      },
    ],
  },

  async run({ config, state, signal, log }) {
    const requested = optionalNumber(config, "ms") ?? 1000;
    const ms = Math.min(Math.max(Math.round(requested), 0), MAX_WAIT_MS);
    if (requested > MAX_WAIT_MS) log(`capped wait from ${requested}ms to ${MAX_WAIT_MS}ms`);

    await sleep(ms, signal);
    log(`waited ${ms}ms`);
    return { output: state.input === undefined ? { waitedMs: ms } : state.input };
  },
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
