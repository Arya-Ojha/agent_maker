import type { NodeTypeMeta, Run, StoredRunEvent, Workflow, WorkflowSummary } from "./types.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
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
};
