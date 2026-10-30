import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import cors from "cors";
import { z } from "zod";
import type { NodeType, RunEvent, StoredRunEvent } from "../../shared/types.ts";
import {
  appendEvent,
  createRun,
  createWorkflow,
  deleteWorkflow,
  finishRun,
  getRun,
  getWorkflow,
  listEvents,
  listRuns,
  listWorkflows,
  updateWorkflow,
} from "./db.ts";
import { executeGraph } from "./engine/runner.ts";
import { nodeMetas, isNodeType } from "./nodes/index.ts";
import { seedDemoWorkflow } from "./seed.ts";

try {
  process.loadEnvFile(resolve(process.env.AGENT_MAKER_ENV ?? ".env"));
} catch {
  // .env is optional
}

const PORT = Number(process.env.PORT ?? 5175);
const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

/* ------------------------------- validation ------------------------------ */

const positionSchema = z.object({ x: z.number(), y: z.number() });

const graphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      type: z.custom<NodeType>(
        (value) => typeof value === "string" && isNodeType(value),
        { message: "Unknown node type" },
      ),
      position: positionSchema,
      data: z
        .object({
          label: z.string().optional(),
          config: z.record(z.string(), z.unknown()).default({}),
        })
        .default({ config: {} }),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string().min(1),
      source: z.string().min(1),
      target: z.string().min(1),
      sourceHandle: z.string().nullable().optional(),
      targetHandle: z.string().nullable().optional(),
    }),
  ),
});

const workflowBody = z.object({
  name: z.string().trim().min(1).max(120),
  graph: graphSchema,
});

const runBody = z.object({
  input: z.unknown().optional(),
});

/* ----------------------------- live run events ---------------------------- */

type Listener = (event: StoredRunEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const running = new Map<string, AbortController>();

function publish(runId: string, event: RunEvent): void {
  const stored = appendEvent(runId, event);
  for (const listener of listeners.get(runId) ?? []) listener(stored);
}

function subscribe(runId: string, listener: Listener): () => void {
  const set = listeners.get(runId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(runId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(runId);
  };
}

/* --------------------------------- routes -------------------------------- */

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/node-types", (_req, res) => {
  res.json(nodeMetas);
});

app.get("/api/workflows", (_req, res) => {
  res.json(listWorkflows());
});

app.post("/api/workflows", (req, res) => {
  const parsed = workflowBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid workflow", issues: z.treeifyError(parsed.error) });
    return;
  }
  const node = parsed.data.graph.nodes.find((candidate) => !isNodeType(candidate.type));
  if (node) {
    res.status(400).json({ error: `Unknown node type "${node.type}"` });
    return;
  }
  res.status(201).json(createWorkflow(parsed.data.name, parsed.data.graph));
});

app.get("/api/workflows/:id", (req, res) => {
  const workflow = getWorkflow(req.params.id);
  if (!workflow) {
    res.status(404).json({ error: "Workflow not found" });
    return;
  }
  res.json(workflow);
});

app.put("/api/workflows/:id", (req, res) => {
  const parsed = workflowBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid workflow", issues: z.treeifyError(parsed.error) });
    return;
  }
  const workflow = updateWorkflow(req.params.id, parsed.data);
  if (!workflow) {
    res.status(404).json({ error: "Workflow not found" });
    return;
  }
  res.json(workflow);
});

app.delete("/api/workflows/:id", (req, res) => {
  res.status(deleteWorkflow(req.params.id) ? 204 : 404).send();
});

app.get("/api/workflows/:id/runs", (req, res) => {
  if (!getWorkflow(req.params.id)) {
    res.status(404).json({ error: "Workflow not found" });
    return;
  }
  res.json(listRuns(req.params.id));
});

app.post("/api/workflows/:id/run", (req, res) => {
  const workflow = getWorkflow(req.params.id);
  if (!workflow) {
    res.status(404).json({ error: "Workflow not found" });
    return;
  }

  const parsed = runBody.safeParse(req.body ?? {});
  const input = parsed.success ? parsed.data.input : undefined;

  const run = createRun(workflow.id, input ?? null);
  const controller = new AbortController();
  running.set(run.id, controller);

  res.status(202).json({ runId: run.id });

  setImmediate(() => {
    void executeGraph({
      graph: workflow.graph,
      input: input ?? null,
      runId: run.id,
      signal: controller.signal,
      emit: (event) => publish(run.id, event),
    })
      .then((result) => {
        finishRun(run.id, result.status, result.output, result.error);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        publish(run.id, { type: "run.failed", ts: Date.now(), error: message });
        finishRun(run.id, "failed", null, message);
      })
      .finally(() => {
        running.delete(run.id);
      });
  });
});

app.get("/api/runs/:id", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json({ ...run, events: listEvents(run.id) });
});

app.post("/api/runs/:id/cancel", (req, res) => {
  const controller = running.get(req.params.id);
  if (!controller) {
    res.status(409).json({ error: "Run is not active" });
    return;
  }
  controller.abort();
  res.status(202).json({ canceled: true });
});

app.get("/api/runs/:id/events", (req, res) => {
  const runId = req.params.id;
  if (!getRun(runId)) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let lastSeq = Number(req.query["after"] ?? 0) || 0;

  const send = (stored: StoredRunEvent): void => {
    if (stored.seq <= lastSeq) return;
    lastSeq = stored.seq;
    res.write(`data: ${JSON.stringify(stored)}\n\n`);
  };

  // Subscribe before replay so nothing slips through the gap.
  let replaying = true;
  const backlog: StoredRunEvent[] = [];
  const unsubscribe = subscribe(runId, (stored) => {
    if (replaying) backlog.push(stored);
    else send(stored);
  });

  for (const stored of listEvents(runId, lastSeq)) send(stored);
  replaying = false;
  for (const stored of backlog) send(stored);

  const finished = getRun(runId);
  if (finished && finished.status !== "running") {
    unsubscribe();
    res.write(`event: end\ndata: ${JSON.stringify({ status: finished.status })}\n\n`);
    res.end();
    return;
  }

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/* ------------------------- serve the built web app ------------------------ */

const webDist = resolve(import.meta.dirname, "../../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(resolve(webDist, "index.html"));
  });
}

seedDemoWorkflow();

app.listen(PORT, () => {
  console.log(`agent_maker server listening on http://localhost:${PORT}`);
});
