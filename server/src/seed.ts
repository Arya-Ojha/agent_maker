import type { Graph } from "../../shared/types.ts";
import { createWorkflow, listWorkflows } from "./db.ts";

const demo: Graph = {
  nodes: [
    {
      id: "trigger",
      type: "manual.trigger",
      position: { x: 40, y: 200 },
      data: {
        label: "Start",
        config: { payload: { topic: "why small language models are getting interesting" } },
      },
    },
    {
      id: "draft",
      type: "agent",
      position: { x: 320, y: 180 },
      data: {
        label: "Draft",
        config: {
          provider: "mock",
          model: "mock-1",
          system: "You are a concise technical writer.",
          prompt: "Explain {{ input.topic }} in two sentences.",
          temperature: 0.7,
          maxOutputTokens: 400,
        },
      },
    },
    {
      id: "branch",
      type: "if",
      position: { x: 600, y: 180 },
      data: {
        label: "Mentions mock?",
        config: { left: "{{ input.text }}", operator: "contains", right: "mock" },
      },
    },
    {
      id: "format",
      type: "template",
      position: { x: 880, y: 100 },
      data: { label: "Format", config: { template: "Draft:\n{{ input.left }}" } },
    },
    {
      id: "done",
      type: "output",
      position: { x: 1140, y: 100 },
      data: { label: "Result", config: { value: "{{ input.text }}" } },
    },
    {
      id: "fallback",
      type: "output",
      position: { x: 880, y: 300 },
      data: { label: "Fallback", config: { value: "{{ input.left }}" } },
    },
  ],
  edges: [
    { id: "e1", source: "trigger", target: "draft" },
    { id: "e2", source: "draft", target: "branch" },
    { id: "e3", source: "branch", target: "format", sourceHandle: "true" },
    { id: "e4", source: "format", target: "done" },
    { id: "e5", source: "branch", target: "fallback", sourceHandle: "false" },
  ],
};

export function seedDemoWorkflow(): void {
  if (listWorkflows().length > 0) return;
  createWorkflow("Demo: draft and branch", demo);
  console.log("seeded demo workflow");
}
