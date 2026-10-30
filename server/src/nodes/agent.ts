import { generateText } from "ai";
import { resolveModel, modelIdOf } from "../engine/providers.ts";
import { renderString } from "../engine/template.ts";
import { NodeExecutionError, optionalNumber, requireString, type NodeDefinition } from "./types.ts";

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

  async execute({ config, scope, signal, log }) {
    const provider = requireString(config, "provider", "mock");
    const model = modelIdOf(provider, requireString(config, "model"));
    const prompt = renderString(requireString(config, "prompt", "{{ input }}"), scope);
    const system = requireString(config, "system").trim()
      ? renderString(requireString(config, "system"), scope)
      : undefined;

    if (!prompt.trim()) throw new NodeExecutionError("Prompt is empty after rendering.");

    log(`${provider}/${model}`);

    if (provider === "mock") {
      const preview = prompt.length > 400 ? `${prompt.slice(0, 400)}…` : prompt;
      return {
        output: {
          text: `[mock:${model}] ${preview}`,
          provider,
          model,
          usage: { inputTokens: 0, outputTokens: 0 },
          mocked: true,
        },
      };
    }

    const result = await generateText({
      model: resolveModel({
        provider,
        model,
        apiKey: requireString(config, "apiKey").trim() || undefined,
        baseURL: requireString(config, "baseURL").trim() || undefined,
      }),
      system,
      prompt,
      temperature: optionalNumber(config, "temperature"),
      maxOutputTokens: optionalNumber(config, "maxOutputTokens"),
      abortSignal: signal,
    });

    log(`${result.usage.inputTokens ?? 0} in / ${result.usage.outputTokens ?? 0} out`);

    return {
      output: {
        text: result.text,
        provider,
        model,
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        },
      },
    };
  },
};
