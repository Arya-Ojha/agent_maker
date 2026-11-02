/** Provider choices the builder UI offers, mirroring the server's provider list. */
export interface ProviderOption {
  id: string;
  label: string;
  hint: string;
  defaultModel: string;
  needsKey: boolean;
  /** Only OpenAI-compatible endpoints accept a custom base URL. */
  baseUrl: boolean;
}

export const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    id: "google",
    label: "Google (Gemini)",
    hint: "AI Studio key from aistudio.google.com",
    defaultModel: "gemini-2.5-flash",
    needsKey: true,
    baseUrl: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    hint: "api.openai.com or any OpenAI-compatible endpoint",
    defaultModel: "gpt-4o-mini",
    needsKey: true,
    baseUrl: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    hint: "console.anthropic.com key",
    defaultModel: "claude-sonnet-4-5",
    needsKey: true,
    baseUrl: false,
  },
  {
    id: "mock",
    label: "Mock (offline)",
    hint: "No key, no network: builds a trigger → agent → output chain",
    defaultModel: "mock-1",
    needsKey: false,
    baseUrl: false,
  },
];

export function providerOption(id: string): ProviderOption {
  return PROVIDER_OPTIONS.find((option) => option.id === id) ?? PROVIDER_OPTIONS[0]!;
}

/** Accepts `{...}` from the server; falls back to the provider default. */
export function defaultModelFor(id: string): string {
  return providerOption(id).defaultModel;
}
