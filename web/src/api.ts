import type { NodeTypeMeta, Run, StoredRunEvent, Workflow, WorkflowSummary } from "./types.ts";

/** Three model calls can take 3 × 60s server-side; this is the outer safety net. */
const REQUEST_TIMEOUT_MS = 200_000;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(
        "The request timed out after 200 seconds. Check the provider and base URL, or the server log.",
      );
    }
    throw error;
  }
  if (!response.ok) {
    const body = await response.text();
    let message = body || `${response.status} ${response.statusText}`;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // keep raw text
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  nodeTypes: () => request<NodeTypeMeta[]>("/api/node-types"),
  workflows: () => request<WorkflowSummary[]>("/api/workflows"),
  workflow: (id: string) => request<Workflow>(`/api/workflows/${id}`),
  createWorkflow: (name: string, graph: Workflow["graph"]) =>
    request<Workflow>("/api/workflows", {
      method: "POST",
      body: JSON.stringify({ name, graph }),
    }),
  updateWorkflow: (id: string, patch: { name?: string; graph?: Workflow["graph"] }) =>
    request<Workflow>(`/api/workflows/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  deleteWorkflow: (id: string) =>
    request<void>(`/api/workflows/${id}`, { method: "DELETE" }),
  runs: (workflowId: string) => request<Run[]>(`/api/workflows/${workflowId}/runs`),
  run: (workflowId: string) =>
    request<{ runId: string }>(`/api/workflows/${workflowId}/run`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  runDetail: (runId: string) =>
    request<Run & { events: StoredRunEvent[] }>(`/api/runs/${runId}`),
  cancelRun: (runId: string) =>
    request<{ canceled: boolean }>(`/api/runs/${runId}/cancel`, { method: "POST" }),
  builderChat: (body: {
    message: string;
    graph: Workflow["graph"];
    history: Array<{ role: "user" | "assistant"; content: string }>;
    provider: string;
    model: string;
    apiKey?: string;
    baseURL?: string;
  }) =>
    request<{ graph: Workflow["graph"]; reply: string; warnings: string[] }>(
      "/api/builder/chat",
      { method: "POST", body: JSON.stringify(body) },
    ),
  builderModels: (body: { provider: string; apiKey?: string; baseURL?: string }) =>
    request<{ models: string[] }>("/api/builder/models", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
