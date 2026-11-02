import { NodeExecutionError } from "../nodes/types.ts";

/**
 * Vendor errors arrive as multi-line JSON blobs. Surface only the cases a user can
 * actually act on; everything else keeps its original message.
 */
export function friendlyProviderError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  // Already actionable ("No API key for provider …"): do not rewrite it as a rejection.
  if (/no api key/i.test(message)) {
    return error instanceof Error ? error : new Error(message);
  }
  if (/\b429\b|quota|rate.?limit/i.test(message)) {
    return new NodeExecutionError(
      "The provider rate-limited this key (quota or 429). Wait a minute, pick another model, or change the key in /provider.",
    );
  }
  if (/\b401\b|\b403\b|api key|unauthorized|invalid key/i.test(message)) {
    return new NodeExecutionError(
      "The provider rejected the API key. Check it in /provider.",
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}
