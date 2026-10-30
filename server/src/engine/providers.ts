import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { NodeExecutionError } from "../nodes/types.ts";

export const PROVIDERS = ["mock", "openai", "anthropic", "google"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

interface ModelRequest {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
}

const ENV_KEYS: Record<Exclude<ProviderId, "mock">, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  mock: "mock-1",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-5",
  google: "gemini-2.5-flash",
};

function resolveKey(provider: Exclude<ProviderId, "mock">, override?: string): string {
  const key = override?.trim() || process.env[ENV_KEYS[provider]];
  if (!key) {
    throw new NodeExecutionError(
      `No API key for provider "${provider}". Set ${ENV_KEYS[provider]} in server/.env or fill in the node's apiKey field.`,
    );
  }
  return key;
}

export function resolveModel({ provider, model, apiKey, baseURL }: ModelRequest): LanguageModel {
  const modelId = model.trim() || DEFAULT_MODELS[provider as ProviderId] || "gpt-4o-mini";

  switch (provider) {
    case "openai":
      return createOpenAI({
        apiKey: resolveKey("openai", apiKey),
        ...(baseURL?.trim() ? { baseURL: baseURL.trim() } : {}),
      })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey: resolveKey("anthropic", apiKey) })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey: resolveKey("google", apiKey) })(modelId);
    default:
      throw new NodeExecutionError(
        `Unsupported provider "${provider}". Choose one of: ${PROVIDERS.join(", ")}.`,
      );
  }
}

export const modelIdOf = (provider: string, model: string): string =>
  model.trim() || DEFAULT_MODELS[provider as ProviderId] || model;
