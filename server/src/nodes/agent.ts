import { HumanMessage, SystemMessage, type AIMessage } from "@langchain/core/messages";
import type { NodeTypeMeta } from "../../../shared/types.ts";
import { renderString, scopeOf } from "../engine/template.ts";
import { DEFAULT_MODELS } from "../engine/providerMeta.ts";
import { buildModel } from "../langgraph/models.ts";
import {
  NodeExecutionError,
  optionalNumber,
  requireString,
  type NodeDefinition,
} from "./types.ts";

export const agent: NodeDefinition = {
  meta: {
    type: "agent",
    label: "Agent",
    description: "Calls an LLM once. Prompt and system message support {{ input.x }} templating.",
    category: "ai",
    color: "#8b5cf6",
    fields: [
      {
        key: "provider",
        label: "Provider",
        type: "select",
        defaultValue: "mock",
        options: [
          { value: "mock", label: "Mock (no API key)" },
          { value: "openai", label: "OpenAI / compatible" },
          { value: "anthropic", label: "Anthropic" },
          { value: "google", label: "Google" },
        ],
      },
      {
        key: "model",
        label: "Model",
        type: "text",
        placeholder: "gpt-4o-mini",
        help: "Provider-specific model id.",
      },
      {
        key: "system",
        label: "System prompt",
        type: "textarea",
        placeholder: "You are a concise research assistant.",
      },
      {
        key: "prompt",
        label: "Prompt",
        type: "textarea",
        defaultValue: "{{ input }}",
        help: "Templates: {{ input }}, {{ input.text }}, {{ nodes.<nodeId>.text }}.",
      },
      {
        key: "temperature",
        label: "Temperature",
        type: "number",
        defaultValue: 0.7,
      },
      {
        key: "maxOutputTokens",
        label: "Max output tokens",
        type: "number",
        defaultValue: 1024,
      },
      {
        key: "baseURL",
        label: "Base URL (OpenAI-compatible)",
        type: "text",
        placeholder: "http://localhost:11434/v1",
        showWhen: { key: "provider", equals: ["openai"] },
        help: "Point at Ollama, LM Studio, vLLM, OpenRouter, etc.",
      },
      {
        key: "apiKey",
        label: "API key override",
        type: "secret",
        showWhen: { key: "provider", equals: ["openai", "anthropic", "google"] },
        help: "Optional. Prefer the env var: OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY.",
      },
    ],
  },

  async run({ config, state, signal, log }) {
    const provider = requireString(config, "provider", "mock");
    const modelId =
      requireString(config, "model").trim() || DEFAULT_MODELS[provider as "openai"] || "gpt-4o-mini";

    const prompt = renderString(requireString(config, "prompt", "{{ input }}"), scopeOf(state));
    if (!prompt.trim()) throw new NodeExecutionError("Prompt is empty after rendering.");

    const system = requireString(config, "system").trim()
      ? renderString(requireString(config, "system"), scopeOf(state))
      : undefined;
    log(`${provider}/${modelId}`);

    const model = buildModel({
      provider,
      model: modelId,
      apiKey: requireString(config, "apiKey").trim() || undefined,
      baseURL: requireString(config, "baseURL").trim() || undefined,
      temperature: optionalNumber(config, "temperature"),
      maxOutputTokens: optionalNumber(config, "maxOutputTokens"),
    });

    const response = (await model.invoke(
      system ? [new SystemMessage(system), new HumanMessage(prompt)] : [new HumanMessage(prompt)],
      { signal, timeout: 120000 },
    )) as AIMessage;
    return {
      output: {
        text: typeof response.content === "string" ? response.content : JSON.stringify(response.content),
        provider,
        model: modelId,
        usage: {
          inputTokens: response.usage_metadata?.input_tokens ?? 0,
          outputTokens: response.usage_metadata?.output_tokens ?? 0,
        },
        mocked: Boolean(response.response_metadata?.["mocked"]),
      },
    };
  },
};
