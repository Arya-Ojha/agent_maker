import { PROVIDERS, type ProviderId } from "../engine/providerMeta.ts";
import { providerKey } from "../langgraph/models.ts";
import { NodeExecutionError } from "../nodes/types.ts";

export interface ModelListInput {
  provider: string;
  apiKey?: string;
  baseURL?: string;
}

const TIMEOUT_MS = 15_000;

/** Ids that are valid API models but cannot drive a chat node. */
const NON_CHAT = /embed|whisper|tts|dall-e|moderation|transcribe|image|audio|rerank/i;

function isProviderId(value: string): value is ProviderId {
  return (PROVIDERS as readonly string[]).includes(value);
}

async function getJson(url: string, init: RequestInit, label: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new NodeExecutionError(
      `Could not reach ${label} to list models. Check the network or the base URL.`,
    );
  }
  if (!response.ok) {
    // The status is enough for `friendlyProviderError` to pick the right advice.
    throw new NodeExecutionError(`${label} returned ${response.status} while listing models.`);
  }
  return response.json();
}

function uniqueSorted(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * Asks the provider which models the key can actually use, so the picker reflects
 * the user's account instead of a hardcoded list that goes stale.
 */
export async function listModels(input: ModelListInput): Promise<string[]> {
  const provider = input.provider;
  if (!isProviderId(provider)) {
    throw new NodeExecutionError(`Unknown provider "${provider}".`);
  }
  if (provider === "mock") return ["mock-1"];

  const key = providerKey(provider, input.apiKey);
  const baseURL = input.baseURL?.trim().replace(/\/+$/, "");
  if (baseURL && !/^https?:\/\//i.test(baseURL)) {
    throw new NodeExecutionError(
      `Base URL must start with http:// or https:// (got "${baseURL}").`,
    );
  }

  switch (provider) {
    case "google": {
      const data = (await getJson(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1000`,
        {},
        "Google",
      )) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
      const ids = (data.models ?? [])
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
        .map((model) => (model.name ?? "").replace(/^models\//, ""))
        // The listing includes media/agent products (imagen, lyria, deep-research)
        // that a chat node cannot use.
        .filter((id) => /^(gemini|gemma)/.test(id));
      return uniqueSorted(ids);
    }

    case "openai": {
      const data = (await getJson(
        `${baseURL || "https://api.openai.com/v1"}/models`,
        { headers: { Authorization: `Bearer ${key}` } },
        "OpenAI",
      )) as { data?: Array<{ id?: string }> };
      const ids = (data.data ?? [])
        .map((model) => model.id ?? "")
        .filter((id) => id && !NON_CHAT.test(id));
      return uniqueSorted(ids);
    }

    case "anthropic": {
      const data = (await getJson(
        "https://api.anthropic.com/v1/models?limit=100",
        { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } },
        "Anthropic",
      )) as { data?: Array<{ id?: string }> };
      return uniqueSorted((data.data ?? []).map((model) => model.id ?? ""));
    }
  }
}
