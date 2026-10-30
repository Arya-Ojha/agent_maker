import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { NodeExecutionError } from "../nodes/types.ts";
import { PROVIDERS, DEFAULT_MODELS, type ProviderId } from "../engine/providerMeta.ts";

const ENV_KEYS: Record<Exclude<ProviderId, "mock">, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/** Extra accepted env vars per provider (first match wins after the primary). */
const ENV_KEY_FALLBACKS: Partial<Record<Exclude<ProviderId, "mock">, string[]>> = {
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
};

function resolveKey(provider: Exclude<ProviderId, "mock">, override?: string): string {
  const primary = process.env[ENV_KEYS[provider]];
  const fallback = ENV_KEY_FALLBACKS[provider]?.map((key) => process.env[key]).find(Boolean);
  const key = override?.trim() || primary || fallback;
  if (!key) {
    const accepted = [ENV_KEYS[provider], ...(ENV_KEY_FALLBACKS[provider] ?? [])].join(" / ");
    throw new NodeExecutionError(
      `No API key for provider "${provider}". Set ${accepted} in server/.env or fill in the node's apiKey field.`,
    );
  }
  return key;
}

/**
 * A chat model that fabricates deterministic replies so workflows run with no
 * API key. Routes the same on_chat_model_* events as real models, which the
 * event adapter uses for usage logging.
 */
export class MockChatModel extends BaseChatModel {
  modelId: string;

  constructor(modelId: string) {
    super({});
    this.modelId = modelId;
  }

  override _llmType(): string {
    return "mock";
  }

  static override lc_name(): string {
    return "MockChatModel";
  }

  override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const last = messages.at(-1);
    const raw = last?.content;
    const text =
      typeof raw === "string"
        ? raw
        : JSON.stringify(raw);
    const preview = text.length > 400 ? `${text.slice(0, 400)}…` : text;
    const message = new AIMessage(`[mock:${this.modelId}] ${preview}`);
    message.response_metadata = { model_name: `mock/${this.modelId}`, mocked: true };
    return { generations: [{ text: message.content as string, message }] };
  }
}

export interface ModelConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export function buildModel(config: ModelConfig): BaseChatModel {
  const provider = config.provider as ProviderId;
  const modelId = config.model.trim() || DEFAULT_MODELS[provider] || "gpt-4o-mini";
  const apiKey = config.apiKey?.trim() || undefined;

  switch (provider) {
    case "mock":
      return new MockChatModel(modelId);
    case "openai": {
      const key = resolveKey("openai", apiKey);
      const baseUrl = config.baseURL?.trim();
      const options: ConstructorParameters<typeof ChatOpenAI>[0] = {
        apiKey: key,
        model: modelId,
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.maxOutputTokens !== undefined
          ? { maxTokens: config.maxOutputTokens }
          : {}),
        ...(baseUrl ? { configuration: { baseURL: baseUrl } } : {}),
      };
      return new ChatOpenAI(options);
    }
    case "anthropic":
      return new ChatAnthropic({
        apiKey: resolveKey("anthropic", apiKey),
        model: modelId,
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.maxOutputTokens !== undefined
          ? { maxTokens: config.maxOutputTokens }
          : {}),
      });
    case "google":
      return new ChatGoogleGenerativeAI({
        apiKey: resolveKey("google", apiKey),
        model: modelId,
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.maxOutputTokens !== undefined
          ? { maxOutputTokens: config.maxOutputTokens }
          : {}),
      });
    default:
      throw new NodeExecutionError(
        `Unsupported provider "${config.provider}". Choose one of: ${PROVIDERS.join(", ")}.`,
      );
  }
}
