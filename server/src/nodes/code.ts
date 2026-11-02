import { NodeExecutionError, requireString, type NodeDefinition } from "./types.ts";

const DEFAULT_CODE = `// input, nodes and run are in scope.
// Return a JSON-serializable value.
return { text: String(input?.text ?? input ?? "").trim() };`;

type AsyncFn = (...args: unknown[]) => Promise<unknown>;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => AsyncFn;

export const code: NodeDefinition = {
  meta: {
    type: "code",
    label: "Code",
    description: "Runs JavaScript with input/nodes/run in scope. Return a JSON-serializable value.",
    category: "data",
    color: "#6366f1",
    fields: [
      {
        key: "code",
        label: "Code",
        type: "textarea",
        defaultValue: DEFAULT_CODE,
        help: "Runs unsandboxed in the server process with full Node access. Only use workflows you trust.",
      },
    ],
  },

  async run({ config, state, signal, log }) {
    const source = requireString(config, "code", DEFAULT_CODE);
    if (!source.trim()) throw new NodeExecutionError("Code is empty.");

    let fn: AsyncFn;
    try {
      fn = new AsyncFunction("input", "nodes", "run", source);
    } catch (error) {
      throw new NodeExecutionError(`Could not compile code: ${describe(error)}`);
    }

    let value: unknown;
    try {
      value = await Promise.race([
        fn(state.input, state.outputs, { id: state.runId, input: state.runInput ?? null }),
        aborted(signal),
      ]);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new NodeExecutionError(`Code threw: ${describe(error)}`);
    }

    const serialized = serialize(value);
    log(`returned ${serialized.kind}`);
    return { output: serialized.value };
  },
};

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason ?? new Error("Aborted")), {
      once: true,
    });
  });
}

function serialize(value: unknown): { value: unknown; kind: string } {
  if (value === undefined) return { value: null, kind: "undefined" };
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    throw new NodeExecutionError(`Return value is not JSON-serializable: ${describe(error)}`);
  }
  if (json === undefined) {
    throw new NodeExecutionError("Return value is not JSON-serializable (functions are dropped).");
  }
  return { value: JSON.parse(json), kind: Array.isArray(value) ? "array" : typeof value };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
