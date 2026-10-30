import { renderString, renderValue } from "../engine/template.ts";
import { NodeExecutionError, optionalNumber, requireString, type NodeDefinition } from "./types.ts";

export const http: NodeDefinition = {
  meta: {
    type: "http",
    label: "HTTP Request",
    description: "Calls an HTTP endpoint and returns status, headers and parsed body.",
    category: "data",
    color: "#f59e0b",
    fields: [
      {
        key: "method",
        label: "Method",
        type: "select",
        defaultValue: "GET",
        options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({ value, label: value })),
      },
      {
        key: "url",
        label: "URL",
        type: "text",
        placeholder: "https://api.example.com/items/{{ input.id }}",
      },
      {
        key: "headers",
        label: "Headers (JSON)",
        type: "json",
        defaultValue: {},
        help: "Values support templating.",
      },
      {
        key: "body",
        label: "Body",
        type: "textarea",
        showWhen: { key: "method", equals: ["POST", "PUT", "PATCH"] },
        help: "Sent as JSON when it parses, otherwise as plain text.",
      },
      {
        key: "timeoutMs",
        label: "Timeout (ms)",
        type: "number",
        defaultValue: 20000,
      },
    ],
  },

  async execute({ config, scope, signal, log }) {
    const url = renderString(requireString(config, "url"), scope).trim();
    if (!url) throw new NodeExecutionError("URL is empty after rendering.");
    if (!/^https?:\/\//i.test(url)) throw new NodeExecutionError(`URL must start with http(s)://, got "${url}".`);

    const method = requireString(config, "method", "GET").toUpperCase();
    const headers = renderValue(config["headers"] ?? {}, scope);
    const bodyTemplate = requireString(config, "body");
    const timeoutMs = optionalNumber(config, "timeoutMs") ?? 20000;

    const requestHeaders: Record<string, string> = {};
    if (headers && typeof headers === "object" && !Array.isArray(headers)) {
      for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
        if (value !== null && value !== undefined) requestHeaders[key] = String(value);
      }
    }

    let body: string | undefined;
    if (bodyTemplate.trim() && method !== "GET") {
      const rendered = renderString(bodyTemplate, scope);
      body = rendered;
      if (!Object.keys(requestHeaders).some((key) => key.toLowerCase() === "content-type")) {
        requestHeaders["content-type"] = looksLikeJson(rendered) ? "application/json" : "text/plain";
      }
    }

    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);

    log(`${method} ${url}`);
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(url, { method, headers: requestHeaders, body, signal: combined });
    } catch (error) {
      if (signal.aborted) throw error;
      const reason = describeFetchError(error);
      const hint = timeout.aborted ? ` (timed out after ${timeoutMs}ms)` : "";
      throw new NodeExecutionError(`Request failed: ${reason}${hint}`);
    }

    const text = await response.text();
    log(`${response.status} in ${Date.now() - started}ms, ${text.length} bytes`);

    return {
      output: {
        status: response.status,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
        body: looksLikeJson(text) ? safeParse(text) : text,
      },
    };
  },
};

/** Node's fetch wraps the useful part (ECONNREFUSED, DNS failures) in `cause`. */
function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return code ? `${code}: ${cause.message}` : cause.message;
  }
  return error.message;
}

const looksLikeJson = (value: string): boolean => {
  const trimmed = value.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
};

const safeParse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
