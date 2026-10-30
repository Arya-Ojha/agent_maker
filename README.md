# agent_maker

A node-based agent builder in the spirit of n8n: drag nodes onto a canvas, wire them
together, and run the graph. Agent nodes call real models through LangChain
(`@langchain/openai`, `@langchain/anthropic`, `@langchain/google-genai`, or any
OpenAI-compatible endpoint); a Mock provider makes the demo runnable with no API key.

## Quickstart

```bash
npm install
npm run dev          # http://localhost:5173  (API on :5175)
```

A demo workflow is seeded on first boot. Press **▶ Run** to watch it execute —
node statuses light up on the canvas and events stream into the run panel.

Use a real model: select an Agent node, switch **Provider** to `openai` (or
`anthropic` / `google`), and set the matching key in `server/.env`
(see `.env.example`).

## Production

```bash
npm run build        # bundles the web app into web/dist
npm start            # single process: API + static UI on http://localhost:5175
```

## How it works

```
web/     Vite + React + @xyflow/react canvas, inspector, run panel
server/  Express API, SQLite (node:sqlite), LangGraph engine, node executors
shared/  types shared by both sides (no runtime code)
```

- **Execution** runs on LangGraph: the canvas graph is validated (dangling edges,
  cycles, duplicate ids) and compiled into a `StateGraph` (`server/src/langgraph/`).
  Nodes without a dependency run in parallel within a LangGraph superstep.
- **Node errors are data, not exceptions**: each node is wrapped so a throw lands in a
  `state.errors` channel; the failing node's outgoing routing is cut, downstream nodes
  report `skipped`, sibling branches still finish, and the run ends `failed`.
- **Events** (`run.started`, `node.started`, `node.log`, `node.succeeded`,
  `node.failed`, `node.skipped`, `run.*`) are adapted from LangGraph's
  `streamEvents` v2 stream, persisted to SQLite, and pushed to the browser over SSE,
  so reconnects and page reloads replay history. Nodes stream progress with
  `dispatchCustomEvent("node.log", ...)`.
- **Branching**: an `if` node activates only the outgoing edge matching its result;
  nodes whose incoming edges were all skipped report `skipped` and are not executed.
- **Templating**: `{{ input }}`, `{{ input.text }}`, `{{ nodes.<nodeId>.text }}`,
  `{{ run.input }}`. A value that is exactly one placeholder keeps its type
  (objects/arrays survive a pass-through). `input` is the merged output of the node's
  direct parents (by id when there are several).

## Nodes

| Node | Does |
| --- | --- |
| Manual Trigger | Seeds the run payload (`{{ input }}`) |
| Agent | One LLM call; provider + model + system/prompt templates |
| Template | Composes a string from upstream values |
| HTTP Request | `fetch` with templated URL/headers/body, JSON auto-parse |
| If / Else | `true`/`false` output handles; only the taken branch runs |
| Output | Final run result |

Node forms are generated from metadata the server exposes at `GET /api/node-types`,
so adding a node means adding one file under `server/src/nodes/` and registering it.

## Adding a node type

1. Create `server/src/nodes/myNode.ts` exporting a `NodeDefinition`
   (`meta` + `run`).
2. Register it in `server/src/nodes/index.ts` and add its id to `NodeType` in
   `shared/types.ts`.
3. Restart the server. The palette and inspector pick it up automatically.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/node-types` | Node palette + form metadata |
| GET/POST | `/api/workflows` | List / create |
| GET/PUT/DELETE | `/api/workflows/:id` | Read / update / delete |
| POST | `/api/workflows/:id/run` | Start a run, returns `{ runId }` |
| GET | `/api/runs/:id` | Run + stored events |
| GET | `/api/runs/:id/events` | SSE stream (`?after=<seq>` to resume) |
| POST | `/api/runs/:id/cancel` | Abort a running run |

## Known limits

- Single user, no auth, no multi-tenant isolation.
- No retries, scheduling, sub-workflows, or tool-calling agents.
- Loops are rejected at compile time (the canvas has no loop UI yet), though LangGraph
  itself supports cycles.
- Checkpoints are not persisted between runs (`@langchain/langgraph-checkpoint-sqlite`
  is installed but unused — its `better-sqlite3` native build is not approved here).
- API keys typed into a node are stored in the SQLite file — prefer env vars.
