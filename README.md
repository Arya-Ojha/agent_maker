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

## Build with AI

Press **✦ AI** in the header to open the builder panel. Describe the workflow ("draft
a tweet from a topic, then shorten it") and the model adds the nodes and edges to the
canvas. Follow-up messages edit the graph in place: "add a debug log after the agent",
"make the classify step use switch instead". You can keep editing by hand at any time;
the AI applies deltas, so ids, positions and labels you touched survive.

- Pick a **Provider** with `/provider` (or the pill above the chat): a window lists the
  providers, then a second window takes that provider's key and, for OpenAI, an
  optional base URL. Config is kept per provider, so switching back and forth does not
  lose keys.
- `/model` (or the model pill) asks the provider which models the key can use and shows
  them in a searchable list; pick one, or type an id the listing did not include. The
  key is stored in this browser (`localStorage`) and in server memory for the current
  process — never in the workflow or the SQLite file. Leave it empty to use
  `server/.env`.
- Nothing is saved until you press **Save**, and nothing runs until you press
  **▶ Run**. *Undo last AI change* restores the graph from before the last turn.
- Set the provider to **Mock** to try the panel with no key: the first turn builds a
  trigger → agent → output pipeline.
- `Code` nodes are refused (a generated graph is untrusted input and `code` is
  unsandboxed), and every answer is re-validated against the same rules as a real run
  before it reaches the canvas. A turn may need two repair rounds, so a single request
  can cost up to three model calls — watch the [free-tier
  quota](https://ai.google.dev/gemini-api/docs/rate-limits) (Gemini flash is ~20
  requests/day). If the provider returns 429 or rejects the key, the panel says so and
  leaves the graph untouched. A call that does not answer within 60 seconds fails with
  an error instead of spinning forever, and a custom base URL must start with
  `http://` or `https://`.

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
| Switch | First matching case (equals/contains/regex) or `else`; 5 output handles |
| Delay | Waits N ms (capped at 5 min), abort-aware, passes input through |
| Output | Final run result |
| Edit Fields | Builds/merges an object from templated values |
| Split Text | Splits text into `{ items, count }` |
| Merge | Shallow/array/keyed combination of several parents |
| Code | `new AsyncFunction("input", "nodes", "run", code)`; JSON-only return |
| Debug Log | Writes a templated line to the run panel, passes input through |

Node forms are generated from metadata the server exposes at `GET /api/node-types`,
so adding a node means adding one file under `server/src/nodes/` and registering it.

## Adding a node type

1. Create `server/src/nodes/myNode.ts` exporting a `NodeDefinition`
   (`meta` + `run`).
2. Register it in `server/src/nodes/index.ts` and add its id to `NodeType` in
   `shared/types.ts`.
3. Restart the server. The palette and inspector pick it up automatically.

## Decisions

Non-obvious choices, the alternatives rejected, and what each one costs are logged
in [DECISIONS.md](DECISIONS.md). Append an entry whenever you change engine
semantics, add a node, or pick between two reasonable designs.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/node-types` | Node palette + form metadata |
| POST | `/api/builder/models` | Models a provider key can use: `{ provider, apiKey?, baseURL? }` → `{ models }` |
| POST | `/api/builder/chat` | AI builder turn: `{ message, graph, history, provider, model, apiKey? }` → `{ graph, reply, warnings }` |
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
