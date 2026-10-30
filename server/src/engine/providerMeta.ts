/** Provider ids shared by node metadata (`select` field) and model building. */

export const PROVIDERS = ["mock", "openai", "anthropic", "google"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  mock: "mock-1",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-5",
  google: "gemini-2.5-flash",
};
