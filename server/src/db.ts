import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Graph,
  Run,
  RunEvent,
  RunStatus,
  StoredRunEvent,
  Workflow,
  WorkflowSummary,
} from "../../shared/types.ts";

const DB_PATH = resolve(process.env.AGENT_MAKER_DB ?? "data/agent_maker.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS workflows (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    graph      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id          TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status      TEXT NOT NULL,
    input       TEXT,
    output      TEXT,
    error       TEXT,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS run_events (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  TEXT NOT NULL,
    type    TEXT NOT NULL,
    node_id TEXT,
    payload TEXT NOT NULL,
    ts      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events (run_id, seq);
  CREATE INDEX IF NOT EXISTS idx_runs_workflow ON runs (workflow_id, started_at DESC);
`);

type Row = Record<string, unknown>;

const parseJson = <T>(raw: unknown, fallback: T): T =>
  typeof raw === "string" ? (JSON.parse(raw) as T) : fallback;

/* ------------------------------- workflows ------------------------------- */

export function listWorkflows(): WorkflowSummary[] {
  const rows = db
    .prepare(`SELECT id, name, graph, created_at, updated_at FROM workflows ORDER BY updated_at DESC`)
    .all() as Row[];

  return rows.map((row) => {
    const graph = parseJson<Graph>(row["graph"], { nodes: [], edges: [] });
    return {
      id: String(row["id"]),
      name: String(row["name"]),
      nodeCount: graph.nodes.length,
      createdAt: Number(row["created_at"]),
      updatedAt: Number(row["updated_at"]),
    };
  });
}

export function getWorkflow(id: string): Workflow | null {
  const row = db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(id) as Row | undefined;
  if (!row) return null;
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    graph: parseJson<Graph>(row["graph"], { nodes: [], edges: [] }),
    createdAt: Number(row["created_at"]),
    updatedAt: Number(row["updated_at"]),
  };
}

export function createWorkflow(name: string, graph: Graph): Workflow {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO workflows (id, name, graph, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, name, JSON.stringify(graph), now, now);
  return { id, name, graph, createdAt: now, updatedAt: now };
}

export function updateWorkflow(
  id: string,
  patch: { name?: string; graph?: Graph },
): Workflow | null {
  const existing = getWorkflow(id);
  if (!existing) return null;
  const name = patch.name ?? existing.name;
  const graph = patch.graph ?? existing.graph;
  const now = Date.now();
  db.prepare(`UPDATE workflows SET name = ?, graph = ?, updated_at = ? WHERE id = ?`).run(
    name,
    JSON.stringify(graph),
    now,
    id,
  );
  return { ...existing, name, graph, updatedAt: now };
}

export function deleteWorkflow(id: string): boolean {
  const result = db.prepare(`DELETE FROM workflows WHERE id = ?`).run(id);
  return Number(result.changes) > 0;
}

/* ---------------------------------- runs --------------------------------- */

export function createRun(workflowId: string, input: unknown): Run {
  const run: Run = {
    id: randomUUID(),
    workflowId,
    status: "running",
    input,
    output: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  db.prepare(
    `INSERT INTO runs (id, workflow_id, status, input, output, error, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    run.id,
    run.workflowId,
    run.status,
    JSON.stringify(run.input ?? null),
    null,
    null,
    run.startedAt,
    null,
  );
  return run;
}

export function finishRun(
  id: string,
  status: RunStatus,
  output: unknown,
  error: string | null,
): void {
  db.prepare(
    `UPDATE runs SET status = ?, output = ?, error = ?, finished_at = ? WHERE id = ?`,
  ).run(status, JSON.stringify(output ?? null), error, Date.now(), id);
}

const toRun = (row: Row): Run => ({
  id: String(row["id"]),
  workflowId: String(row["workflow_id"]),
  status: String(row["status"]) as RunStatus,
  input: parseJson(row["input"], null),
  output: parseJson(row["output"], null),
  error: row["error"] === null ? null : String(row["error"]),
  startedAt: Number(row["started_at"]),
  finishedAt: row["finished_at"] === null ? null : Number(row["finished_at"]),
});

export function getRun(id: string): Run | null {
  const row = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as Row | undefined;
  return row ? toRun(row) : null;
}

export function listRuns(workflowId: string, limit = 25): Run[] {
  const rows = db
    .prepare(`SELECT * FROM runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?`)
    .all(workflowId, limit) as Row[];
  return rows.map(toRun);
}

/* -------------------------------- events --------------------------------- */

export function appendEvent(runId: string, event: RunEvent): StoredRunEvent {
  const nodeId =
    "nodeId" in event && typeof event.nodeId === "string" ? event.nodeId : null;
  const result = db
    .prepare(
      `INSERT INTO run_events (run_id, type, node_id, payload, ts) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(runId, event.type, nodeId, JSON.stringify(event), event.ts);
  return {
    seq: Number(result.lastInsertRowid),
    runId,
    ts: event.ts,
    event,
  };
}

export function listEvents(runId: string, afterSeq = 0): StoredRunEvent[] {
  const rows = db
    .prepare(`SELECT seq, run_id, payload, ts FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq`)
    .all(runId, afterSeq) as Row[];
  return rows.map((row) => ({
    seq: Number(row["seq"]),
    runId: String(row["run_id"]),
    ts: Number(row["ts"]),
    event: parseJson<RunEvent>(row["payload"], { type: "run.failed", ts: 0, error: "corrupt event" }),
  }));
}
