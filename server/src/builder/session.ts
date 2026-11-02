/**
 * Provider keys typed into the AI panel. Deliberately memory-only: they are needed
 * for generation *and* for running the agent nodes it creates, but they must never
 * reach SQLite.
 */
const keys = new Map<string, string>();

export function rememberKey(provider: string, key: string | undefined): void {
  const trimmed = key?.trim();
  if (trimmed) keys.set(provider, trimmed);
}

export function sessionKey(provider: string): string | undefined {
  return keys.get(provider);
}
