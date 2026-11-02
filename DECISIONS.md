# Decision log

This project is a learning exercise, so the reasoning matters as much as the code.
Every non-obvious choice goes here: what forced it, what else was on the table, and
what it costs.

**How to add an entry**

1. Append at the bottom (newest last) with the next number.
2. Include `file:line` references so the entry can be checked against the code.
3. Never rewrite old entries. If a decision changes, add a new entry and link back
   (`Supersedes #0007`).

```md
### 0000 — Short title
**Date:** YYYY-MM-DD
**Context:** What forced a choice.
**Decision:** What was done, one sentence.
**Why:** The reasoning.
**Alternatives rejected:** What else was considered.
**Trade-offs:** What it costs, and what to watch.
**Where:** `path:line`
```

Entries marked *backfilled* were reconstructed from the code and `AGENTS.md` on
2026-10-30, not written at the time. The rationale is the best reading of the code;
treat it as documentation, not a diary.

## Contents

- **Foundation** — 0001–0013: workspace, engine, errors, templating, DB, events, seeding
- **Nodes** — 0014–0021: registry, switch, delay, edit fields, split, merge, code, log
- **Delivery** — 0022–0023: proxy/static serving, run-result derivation
- **Stack choices** — 0024–0032: React, Express, zod, SSE, npm workspaces, Node, LangChain, CSS, state
- **Code structure** - 0033-0048: function shapes, arguments, return values, and why not the alternative
- **Canvas interactions** - 0049: mouse-only edge removal

## Stack at a glance

| Area | Chosen | Main alternative | Why not the alternative |
| --- | --- | --- | --- |
| Runtime | Node 24 (type stripping) | Bun, Deno | LangChain/native-module compatibility (#0029) |
| Language | strict TypeScript | plain JavaScript | the graph/contract shapes need checking (#0001, #0008) |
| HTTP | Express 5 | Fastify, Hono | smaller concept count, trivial SSE (#0025) |
| Validation | zod | TypeBox, valibot | one schema gives both types and messages (#0026) |
| Engine | LangGraph | custom executor | scheduling and event streaming for free (#0002) |
| Database | `node:sqlite` | `better-sqlite3`, Postgres | no native build, no server (#0007) |
| Realtime | SSE | WebSocket, polling | one-way traffic plus auto-reconnect (#0027) |
| Monorepo | npm workspaces | pnpm, Turborepo | no extra tool for two packages (#0028) |
| UI | React 19 + Vite | Next.js, Svelte | local SPA, no SSR or routing (#0024) |
| Canvas | `@xyflow/react` | hand-written SVG | handles, zoom, and edges already solved (#0024) |
| Styling | plain CSS + variables | Tailwind, UI kit | small bespoke UI, no build layer (#0031) |
| Client state | React hooks in `App.tsx` | Redux, TanStack Query | one screen, no cache to manage (#0032) |
| AI providers | LangChain adapters | raw vendor SDKs | one interface, three providers (#0030) |

---

### 0001 — npm workspaces with one shared, type-only contract
**Date:** 2026-10-30 · *backfilled*

**Context:** The server and the React canvas need the same `Graph`, `RunEvent`, and
node-metadata shapes.

**Decision:** Two workspaces (`server`, `web`) and a single `shared/types.ts` that
both import directly.

**Why:** One definition, no codegen, no duplication drift. Type-only means the file
can be imported by Vite and by Node's type stripping without pulling runtime code
across the boundary.

**Alternatives rejected:** OpenAPI/codegen pipeline (too much machinery for two
consumers); duplicating types per workspace (guaranteed to drift).

**Trade-offs:** The shared file cannot hold runtime code — not even constants or
defaults. Every new node type edits `shared/types.ts` *and* the server registry, so
those two edits must stay in sync (TypeScript enforces it via the registry's
`Record<NodeType, …>`).

**Where:** `package.json:6`, `shared/types.ts:1`, `tsconfig.base.json:10`

---

### 0002 — LangGraph as the execution engine
**Date:** 2026-10-30 · *backfilled*

**Context:** A graph editor needs scheduling, parallel branches, streaming events,
and eventually resumable runs.

**Decision:** Compile each canvas graph into a LangGraph `StateGraph` rather than
hand-rolling a scheduler.

**Why:** Parallel supersteps, `streamEvents`, and a checkpoint path come for free.
The alternative is maintaining cycle detection, fan-out/fan-in, and event plumbing
by hand.

**Alternatives rejected:** A custom topological executor (more control, much more
code); a queue/worker system (overkill for a local tool).

**Trade-offs:** Leaky abstractions. Conditional edges accept `[]` (route nowhere),
errors thrown inside a superstep can escape `streamEvents`, and node names share a
namespace with `__start__`/`__end__`. Those edge cases are why `compiler.ts` and
`run.ts` carry defensive code.

**Where:** `server/src/langgraph/compiler.ts:114`, `server/src/langgraph/state.ts:15`,
`server/package.json:16`

---

### 0003 — Node failures are state, not exceptions
**Date:** 2026-10-30 · *backfilled*

**Context:** One bad node should not blow up the whole run, but the UI still needs
to name the failing node.

**Decision:** `asGraphNode` catches node errors and writes them into
`state.errors[nodeId]`; the run adapter reads them back and emits `node.failed`.

**Why:** Keeps LangGraph's superstep from rejecting, lets the compiler cut only the
failing node's outgoing edges, and preserves the node id needed for reporting.
Aborts are the exception: they are rethrown so cancellation is not reported as
failure.

**Alternatives rejected:** Letting errors propagate (loses attribution and kills
sibling branches); wrapping every node in try/catch at the call site (duplicated
logic, easy to miss).

**Trade-offs:** Failures are invisible unless the adapter reports them, so the
`conclude()` path in `run.ts` has to double-check `state.errors` — including nodes
that never emitted `on_chain_end`. Two places must agree on what "failed" means.

**Where:** `server/src/langgraph/asNode.ts:51`, `server/src/langgraph/compiler.ts:102`,
`server/src/langgraph/run.ts:193`

---

### 0004 — Nodes render their own templates
**Date:** 2026-10-30 · *backfilled*

**Context:** Prompts and URLs need `{{ input.x }}` interpolation.

**Decision:** The engine passes raw `node.data.config` to each node; the node calls
`renderString`/`renderValue` itself.

**Why:** Pre-rendering every config value in the engine would expand `{{` inside a
prompt twice (once when assembling the prompt, again when the model echoes it), and
would break nodes that want to treat a value literally.

**Alternatives rejected:** Central pre-render before `run()` (double expansion,
wrong types); a template node type only (forces an extra node between every pair).

**Trade-offs:** Every node repeats the same three lines (`scopeOf(state)`, render,
validate). Nothing stops a node from forgetting to render, and each node decides
whether empty-after-render is an error.

**Where:** `server/src/engine/template.ts:59`, `server/src/nodes/http.ts:53`,
`server/src/nodes/agent.ts:88`

---

### 0005 — A whole-placeholder keeps its type
**Date:** 2026-10-30 · *backfilled*

**Context:** `{{ input }}` is often used to pipe an array or object from one node to
the next.

**Decision:** If a template string is exactly one placeholder (and surrounding
whitespace), return the raw value instead of stringifying it.

**Why:** Arrays and objects survive a pass-through without a JSON stringify/parse
round trip in every node.

**Alternatives rejected:** Always stringify (lossy, forces a parse node); a
separate "passthrough" toggle (extra config for the common case).

**Trade-offs:** No escape syntax. A string that literally looks like
`{{ input }}` cannot be emitted as text through a whole-placeholder; wrap it with
other characters to force interpolation instead.

**Where:** `server/src/engine/template.ts:10`, `server/src/engine/template.ts:37`

---

### 0006 — Branching is a list of source-handle ids
**Date:** 2026-10-30 · *backfilled*

**Context:** `if` needs to activate one of two outgoing edges.

**Decision:** `run()` returns `branches: ["true"]`; conditional edges map that list
to `edge.sourceHandle`, and unreached nodes are reported as `node.skipped`.

**Why:** Handles already exist on the canvas as stable ids, so no new graph
concepts are needed. A node that returns no branches falls through to all edges.

**Alternatives rejected:** A dedicated edge kind (new schema, UI work); evaluating
conditions in the compiler (graph would need config access it deliberately lacks).

**Trade-offs:** Handles must be known statically from `meta.outputs`, which
directly shaped the Switch node (see #0015). Edges from one node must be either all
handled or all unhandled — mixing them is a compile error. Skipped nodes are only
reported at the end of the run, so their status appears late in the event stream.

**Where:** `server/src/langgraph/compiler.ts:62`, `server/src/langgraph/compiler.ts:128`,
`server/src/langgraph/run.ts:246`

---

### 0007 — SQLite through `node:sqlite`, no ORM
**Date:** 2026-10-30 · *backfilled*

**Context:** Persist workflows, runs, and run events locally with zero setup.

**Decision:** Use Node's built-in `DatabaseSync` and hand-written SQL.

**Why:** No native dependency to build, no ORM schema to learn, and the data model
is three tables. WAL mode is set for concurrent reads while a run streams events.

**Alternatives rejected:** `better-sqlite3` (native build — see #0013); Prisma/Drizzle
(build steps and migrations for three tables); JSON files (no per-event replay,
corruption risk on crash).

**Trade-offs:** Synchronous calls block the event loop for the duration of each
statement (fine at this size). No migration framework: changing a column means
handling existing DB files. One process only — SQLite's single-writer model is
assumed.

**Where:** `server/src/db.ts:15`, `server/src/db.ts:19`, `server/src/db.ts:22`

---

### 0008 — The server runs TypeScript directly
**Date:** 2026-10-30 · *backfilled*

**Context:** Keep the dev loop short for a small API.

**Decision:** `node src/index.ts` under Node 24's type stripping; no server build step.

**Why:** Editing a node executor is visible on restart with no compile step, and
the same command works in production (`npm start`).

**Alternatives rejected:** `tsx`/`ts-node` (extra dependency for behaviour Node now
provides); a real build with `tsc` (slower loop, an extra artifact to ship).

**Trade-offs:** Only *erasable* TypeScript works — no enums, namespaces, or
constructor parameter properties — and relative imports must carry `.ts`.
TypeScript therefore cannot catch anything at runtime; `npm run typecheck` is the
gate, and it is easy to forget. The dev watcher must stay scoped with `--watch-path`
(`./src`, `../shared`, `./scripts`): watching `node_modules` causes restart churn
that kills in-flight runs and leaves them `running` forever.

**Where:** `server/package.json:8`, `server/package.json:9`, `tsconfig.base.json:10`,
`AGENTS.md:20`

---

### 0009 — Events are persisted before they are fanned out
**Date:** 2026-10-30 · *backfilled*

**Context:** The run panel must survive a page reload or an SSE reconnect mid-run.

**Decision:** One `publish()` path writes the event to `run_events` first, then
notifies SSE listeners; each stored event carries a monotonic `seq`.

**Why:** Replay is then just "send everything after `lastSeq`", with no separate
in-memory buffer and no risk of a listener receiving an event that was never
stored. Ordering is guaranteed by the single publish path.

**Alternatives rejected:** Fan out first, persist asynchronously (a crash can lose
events the client already saw); keep a ring buffer per run (memory, and lost on
restart).

**Trade-offs:** One SQLite write per event is on the hot path of every node log
line. A slow listener is called synchronously from `publish()`, so listener work
must stay cheap.

**Where:** `server/src/index.ts:85`, `server/src/index.ts:86`, `server/src/db.ts:197`

---

### 0010 — The canvas is generated from server metadata
**Date:** 2026-10-30 · *backfilled*

**Context:** Every node type has a form, a colour, a category, and output handles.

**Decision:** `GET /api/node-types` serves `NodeTypeMeta[]`; the palette, inspector,
and node card all render from it.

**Why:** Adding a node means one executor file plus a registry line — no UI work.

**Alternatives rejected:** A form component per node type (lots of duplicated React);
client-side metadata (server and client drift).

**Trade-offs:** The metadata vocabulary is deliberately small (seven field types,
static outputs, one simple `showWhen` rule). Anything richer — dynamic handles,
nested field groups, validation — needs a schema change on both sides. Field
components are keyed by `nodeId:fieldKey`, so switching nodes resets local draft
state.

**Where:** `server/src/index.ts:105`, `web/src/App.tsx:68`,
`web/src/components/FlowNodeCard.tsx:11`

---

### 0011 — A demo workflow is seeded when the DB is empty
**Date:** 2026-10-30 · *backfilled*

**Context:** A blank canvas is a poor first-run experience.

**Decision:** `seedDemoWorkflow()` inserts a small trigger → agent → if → output graph
only when the workflow table has no rows.

**Why:** Something to press Run on immediately, and a working example of branching.

**Alternatives rejected:** Seeding on every start (duplicates); a "load example"
button (more UI for the same result).

**Trade-offs:** The check is "table empty", not "demo missing" — deleting all
workflows in the UI does not bring the demo back, but deleting the DB file does.
The seeded graph can go stale as node metadata evolves.

**Where:** `server/src/seed.ts:68`, `server/src/seed.ts:69`

---

### 0012 — There is no test runner
**Date:** 2026-10-30 · *backfilled*

**Context:** The project has an engine with non-obvious semantics (branching,
error capture, skip reporting).

**Decision:** Ship with `npm run typecheck` only, and say so explicitly in
`AGENTS.md` instead of implying coverage.

**Why:** Honest state beats a half-wired framework. The type checker catches the
most common breakage: registry/union drift and node-result shape errors.

**Alternatives rejected:** Adding Jest/Vitest speculatively (unused scaffolding);
claiming "tests pass" with no tests (actively harmful).

**Trade-offs:** Regressions in routing and event adaptation are caught by hand.
During the node additions in this session I ran throwaway `node --test`-style smoke
scripts and deleted them; that is a signal the project should adopt
`node --test` next. If you add one, update `AGENTS.md` with the exact single-test
command.

**Where:** `package.json:16`, `AGENTS.md:18`

---

### 0013 — The SQLite checkpointer is installed but not wired
**Date:** 2026-10-30 · *backfilled*

**Context:** Resumable runs need a LangGraph checkpointer.

**Decision:** Leave `@langchain/langgraph-checkpoint-sqlite` in `package.json` but do
not use it, and document why.

**Why:** Its `better-sqlite3` dependency needs a native build that npm's install-script
approval blocks. Wiring it would fail on a clean install.

**Alternatives rejected:** Switching to a checkpointer that requires a native build
(same problem); an in-memory checkpointer (useless across restarts).

**Trade-offs:** No graph-level resume after a crash or server restart. Event replay
still works because events are persisted (#0009), but a run is re-executed from
scratch, not resumed mid-graph. Resolve the native build before wiring it.

**Where:** `server/package.json:17`, `AGENTS.md:65`

---

### 0014 — One registry, exhaustive by type
**Date:** 2026-10-30 · *backfilled*

**Context:** The server needs to resolve a node type id to an executor at compile
time.

**Decision:** `registry: Record<NodeType, NodeDefinition>` is the single lookup, and
`NodeType` in `shared/types.ts` is the source of truth for valid ids.

**Why:** TypeScript fails the build when a type is added to the union but not
registered, or vice versa. `isNodeType` (used by API validation) is just `value in
registry`, so the two can never disagree.

**Alternatives rejected:** A `Map` built from an array of definitions (loses
exhaustiveness); per-type switch statements (same, with more code).

**Trade-offs:** The union is hand-maintained. `manual.trigger` keeps a dotted id
while every other node is a plain word; the dot reserves room for future trigger
families (`webhook.trigger`, `schedule.trigger`), at the cost of looking
inconsistent today.

**Where:** `shared/types.ts:6`, `server/src/nodes/index.ts:17`,
`server/src/nodes/index.ts:35`

---

### 0015 — Switch uses four fixed case handles
**Date:** 2026-10-30

**Context:** `if` covers two-way routing. Multi-way routing needs more handles, but
`NodeTypeMeta.outputs` is static and is what the canvas draws.

**Decision:** A `switch` node with `case1`–`case4` plus `else`, first match wins,
each case an optional templated string compared with `equals`/`contains`/`regex`.

**Why:** Static metadata means the handles exist at design time, so edges can be
drawn and validated before any config is entered. Four cases covers most routing,
and the empty-case rule ("ignore it") lets people leave unused handles
unconnected.

**Alternatives rejected:** Dynamic handles derived from config (needs runtime
metadata in the compiler and a re-render on every keystroke); a single output plus
a Code node (loses the visual branch, and skipped nodes would not be reported);
fell back to chained `if` nodes (deep nesting, noisy canvas).

**Trade-offs:** Hard cap of four cases; adding a fifth is a code change, not a
config change. Handle labels are static ("case 1"…), so the canvas does not show
what each case means. Regex cases compile the pattern on every run (cheap, but
invalid patterns surface at run time, not save time). `else` is mandatory in the
sense that it is always the fallback, even if nothing is connected to it.

**Where:** `server/src/nodes/switch.ts:9`, `server/src/nodes/switch.ts:18`,
`server/src/nodes/switch.ts:47`

---

### 0016 — Delay passes data through and caps the wait
**Date:** 2026-10-30

**Context:** Rate-limited APIs and polling need a pause between nodes.

**Decision:** `setTimeout` with an abort listener, capped at five minutes, and the
incoming value is returned unchanged.

**Why:** The node is a pure timing primitive, so it must not reshape the payload.
The cap turns an obvious typo (`1000000` instead of `1000`) into a logged
correction instead of a run that appears hung. Abort listeners mean a canceled run
stops waiting immediately rather than after the timeout.

**Alternatives rejected:** Sleeping without cap (a mistyped value blocks the run
for hours with no obvious cause); returning `{ waitedMs }` (breaks the chain, forces
an Edit Fields node after every delay); using a scheduled/cron trigger (different
problem).

**Trade-offs:** The timer is in-process; a server restart loses it (no checkpointer,
see #0013). The cap is a product choice — a legitimate long wait is impossible
without changing the constant.

**Where:** `server/src/nodes/delay.ts:3`, `server/src/nodes/delay.ts:23`,
`server/src/nodes/delay.ts:30`

---

### 0017 — Edit Fields merges instead of replacing
**Date:** 2026-10-30

**Context:** Most data reshaping in an agent graph is "add or overwrite a couple of
keys", not "throw away the payload".

**Decision:** A `set` ("Edit Fields") node takes a JSON object of templates, renders
each value, and spreads the result over the incoming object. `keepInput` opts out.

**Why:** Spread-merging keeps the mental model simple and avoids a JSON stringify
round trip. A bare placeholder (`"{{ input.items }}"`) keeps arrays/objects intact
(#0005), so nested data does not need a Code node.

**Alternatives rejected:** A per-field UI with add/remove rows (better UX, needs a
richer inspector schema); making users write a Code node (more power, more
friction, unsandboxed); replace-only semantics (a passthrough merge is the common
case).

**Trade-offs:** The merge is shallow: nested objects are replaced, not deep-merged.
Non-object input is discarded when `keepInput` is on. `fields` must render to an
object — an array or scalar is a run-time error.

**Where:** `server/src/nodes/set.ts:29`, `server/src/nodes/set.ts:35`

---

### 0018 — Split Text uses escape sequences, not regex
**Date:** 2026-10-30

**Context:** Splitting on a newline is the dominant case, but the inspector field is
single-line.

**Decision:** A plain-text separator where `\n`, `\r`, `\t`, and `\\` are
interpreted; trim and drop-empty are booleans.

**Why:** Users can type `\n` and get a newline without a multi-line field, and
plain-text splitting is predictable (`a.b` does not match `axb`).

**Alternatives rejected:** A regex field (powerful but surprising, and invalid
patterns fail at run time); a multi-line separator textarea (ambiguous trailing
whitespace).

**Trade-offs:** Literal backslashes require `\\`. Regex splitting is impossible
without a Code node. The output is always `{ items, count }`, so a downstream node
expecting the original text must read `{{ nodes.<splitId>.items }}` instead.

**Where:** `server/src/nodes/split.ts:40`, `server/src/nodes/split.ts:56`

---

### 0019 — Merge detects the multi-parent shape by value identity
**Date:** 2026-10-30

**Context:** The engine gives a node with one parent that parent's output, and a
node with several parents `{ [parentId]: output }` (`asNode.ts:24`). The node
contract does not expose the list of parent ids.

**Decision:** `merge` recognises the multi-parent shape by checking that the input
is an object whose values are the *same references* as entries in `state.outputs`.
Three strategies: `shallow`, `array`, `keyed`.

**Why:** It works without changing the `NodeRunArgs` contract, and reference
equality is reliable because `asNode` copies values out of `state.outputs` without
cloning them.

**Alternatives rejected:** Adding `parents: string[]` to `NodeRunArgs` — cleaner and
the right long-term fix, but a cross-cutting engine change; inferring from the
number of incoming edges — the node does not see edges.

**Trade-offs:** The heuristic can misclassify a single-parent output that happens
to be an object keyed by node ids with identical value references (unlikely in
practice, but possible). A single parent under `keyed` becomes
`{ [matchedId ?? "value"]: output }`, which is a best-effort guess. Shallow merge
is one level deep.

**Where:** `server/src/nodes/merge.ts:30`, `server/src/nodes/merge.ts:64`,
`server/src/langgraph/asNode.ts:24`

---

### 0020 — The Code node is intentionally unsandboxed
**Date:** 2026-10-30

**Context:** Some transformations are easier to write as code than as a stack of
Template/Edit Fields nodes.

**Decision:** Compile a user-supplied function body with
`new AsyncFunction("input", "nodes", "run", code)`, race it against the abort
signal, and require a JSON-serializable return value.

**Why:** No new dependency, no subprocess IPC, and the same mental model as n8n's
function node. JSON-only returns keep the value safe to persist in SQLite and send
over SSE.

**Alternatives rejected:** `node:vm` (not a real security boundary, adds context
setup); a worker/child process with a timeout (the only way to enforce CPU limits,
but much more plumbing); a restricted expression language (small, but always
missing the one thing you need).

**Trade-offs:** Code runs with full Node access in the server process: filesystem,
network, `process.exit`. The field help says to trust the workflow, but there is
no permission gate. The abort race returns control to the engine yet cannot stop a
tight synchronous loop. Compile and runtime errors are wrapped with the original
message; `undefined` becomes `null`, and functions/cycles are rejected.

**Where:** `server/src/nodes/code.ts:9`, `server/src/nodes/code.ts:31`,
`server/src/nodes/code.ts:71`

---

### 0021 — Debug Log is a pass-through
**Date:** 2026-10-30

**Context:** Debugging a chain usually means "show me what is flowing here" without
changing the flow.

**Decision:** Render `[level] message` into the run panel and return the incoming
value unchanged.

**Why:** Inserting a debug node should be a no-op for data. The run panel (backed by
persisted `node.log` events) is the right sink.

**Alternatives rejected:** Making it an Output node (would change the run result);
logging structured data (the panel is line-oriented, and `{{ input }}` already
JSON-stringifies objects).

**Trade-offs:** A pass-through node still appears as a normal node in the run with
its own output and duration, which adds visual noise. Levels are cosmetic — the
run panel does not filter or colour them.

**Where:** `server/src/nodes/log.ts:29`, `server/src/nodes/log.ts:33`

---

### 0022 — One origin in production, a proxy in development
**Date:** 2026-10-30 · *backfilled*

**Context:** The SPA calls relative `/api` URLs.

**Decision:** Vite proxies `/api` to `:5175` in dev; in production Express serves
`web/dist` from the same port.

**Why:** Relative URLs mean no API base configuration and no CORS in the browser.
One deployable artifact for `npm start`.

**Alternatives rejected:** A separate static host (CORS, two deployments); absolute
API URLs baked into the bundle (breaks when the port changes).

**Trade-offs:** Two processes and two ports in dev, so the browser can see a stale
UI if only the server restarts. Express falls back to `index.html` for any
non-`/api` path, which is correct for the SPA but would also swallow a mistyped
static asset. Vite's CSS transform can go stale on Windows — restart `npm run dev`
before debugging a rule.

**Where:** `web/vite.config.ts:8`, `server/src/index.ts:273`,
`server/src/index.ts:281`

---

### 0023 — The run result is the last Output node to execute
**Date:** 2026-10-30 · *backfilled*

**Context:** A graph can contain several Output nodes on different branches.

**Decision:** `output` writes `state.result`; the adapter prefers that value and
otherwise falls back to the last executed node's output.

**Why:** Designers can put an Output node at the end of each branch without
threading a special "final" flag, and a graph without an Output node still returns
something inspectable.

**Alternatives rejected:** Requiring exactly one Output node (validation burden,
awkward for branching); always returning the last node's output (loses explicit
naming of the result).

**Trade-offs:** With parallel branches, "last writer wins" is not obvious from the
canvas. The fallback can return a debugging node's output as the run result, which
is occasionally surprising.

**Where:** `server/src/nodes/output.ts:26`, `server/src/langgraph/run.ts:267`,
`server/src/langgraph/run.ts:272`

---

### 0024 — React 19 + Vite + `@xyflow/react` for the canvas
**Date:** 2026-10-30 · *backfilled*

**Context:** The editor needs draggable nodes, distance-based handles, edge routing,
selection, and zoom.

**Decision:** React 19 with Vite 8, and `@xyflow/react` (React Flow 12) for the canvas.

**Why:** React Flow already solves handles, edges, zoom, and the node-drag model; the
bundle is a local tool, so size is irrelevant. Vite gives a two-second dev loop and a
plain static build that Express can serve.

**Alternatives rejected:**
- **Next.js / Remix** — server rendering and file-based routing for a single local
  screen; adds a server runtime and build conventions with no user-visible gain.
- **Svelte / Solid + a custom canvas** — smaller runtime and better coarse-grained
  reactivity, but rebuilding selection, handles, and edge geometry is the bulk of the
  work here; the language ecosystem for React Flow-style libraries is thinner.
- **Vue Flow** — equivalent feature set; no compelling difference, and React has the
  larger hiring/learning surface for a student project.
- **Hand-rolled SVG/Canvas** — full control over rendering; weeks of work before the
  first graph can be dragged, and every interaction (hit-testing, zoom-to-cursor)
  is your bug.

**Trade-offs:** Graph state now exists in two shapes — React Flow's `FlowGraphNode`
and the API's `GraphNode` — so `web/src/types.ts` owns mapping functions and they must
stay in sync. React Flow owns node/edge state through hooks (`useNodesState`,
`useEdgesState`), which is why the app has no global store. Upgrading React or React
Flow is a coupled decision.

**Where:** `web/package.json:13`, `web/package.json:14`, `web/vite.config.ts:5`,
`web/src/App.tsx:41`, `web/src/App.tsx:89`

---

### 0025 — Express 5 instead of Fastify or Hono
**Date:** 2026-10-30 · *backfilled*

**Context:** A small JSON API plus one streaming endpoint, run locally.

**Decision:** Express 5 with `cors`, `express.json`, and route-level zod checks.

**Why:** Express 5 propagates rejected async handlers to the error middleware, so
routes need no `try/catch` wrapper. SSE is just `res.writeHead` + `res.write`, with no
framework integration. It is also the most documented option, which matters in a
learning project.

**Alternatives rejected:**
- **Fastify** — genuinely faster and schema-first with better TypeScript inference.
  Not chosen because it introduces its own plugin/encapsulation model and schema
  language; the throughput win is meaningless on `localhost`.
- **Hono** — tiny, excellent types, edge-ready. Not chosen because the Node adapter,
  streaming, and middleware ecosystem are less familiar, and edge deployment is not a
  goal.
- **Raw `node:http`** — no dependency at all, but routing, JSON parsing, CORS, and
  error handling become hand-written code that adds nothing to the lesson.

**Trade-offs:** Express is the slowest of the three and typed route params need care.
Validation lives in each handler rather than being generated from a schema, so there
is no automatic OpenAPI document. If throughput or generated docs ever matter,
Fastify is the migration target.

**Where:** `server/package.json:20`, `server/src/index.ts:31`, `server/src/index.ts:226`

---

### 0026 — zod at the boundary, types inferred from it
**Date:** 2026-10-30 · *backfilled*

**Context:** The graph is user-authored JSON coming from the browser; node `type` must
match a registered node and the shapes must not crash the compiler.

**Decision:** `graphSchema` in `index.ts` validates every create/update request; node
`config` is a free-form record validated by each node at run time.

**Why:** One schema produces both the runtime check and the TypeScript type
(`z.infer`), and `z.treeifyError` gives field-level messages the UI can display.
Rejecting bad graphs at the route boundary keeps `compileGraph` simpler.

**Alternatives rejected:**
- **TypeBox / JSON Schema** — would generate OpenAPI for free, but the schema becomes
  a second source of truth next to the TS types, or needs codegen.
- **valibot** — smaller bundle for the client; the schema lives on the server, so the
  bundle size argument disappears.
- **yup** — weaker inference and an older API; zod is the current default in this
  ecosystem.
- **Hand-written guards** — verbose, and they drift from the types they are supposed
  to protect.

**Trade-offs:** Validation stops at the graph envelope: `config` is
`z.record(z.string(), z.unknown())`, so a bad timeout or malformed JSON field is only
caught when the node runs. That is deliberate (nodes own their config), but it means
"Save" can succeed on a workflow that cannot run. Each new structural field needs a
schema edit in addition to the type.

**Where:** `server/package.json:21`, `server/src/index.ts:40`, `server/src/index.ts:115`

---

### 0027 — Server-Sent Events for run progress
**Date:** 2026-10-30 · *backfilled*

**Context:** A run emits many events (started, logs, succeeded/failed/skipped, run
end) and the client must not miss any across a reload.

**Decision:** `GET /api/runs/:id/events` streams `text/event-stream`; the server
replays stored events from `?after=<seq>`, then forwards live ones; the client uses
`EventSource`.

**Why:** Traffic is strictly server→client. `EventSource` reconnects automatically
and speaks plain HTTP, so no upgrade handshake or heartbeat protocol is needed. The
persisted `seq` (#0009) gives exact replay.

**Alternatives rejected:**
- **WebSocket (`ws`)** — bidirectional, but the client only listens; the protocol
  adds upgrade handling, manual reconnect/backoff, and a second server surface.
  Cancel and Save already use ordinary POSTs.
- **Polling** — simplest possible, but a chatty run can produce hundreds of events,
  and latency plus duplicate suppression become the client's problem.
- **Long-polling** — a middle ground, but replay still needs the same `seq` logic and
  the connection handling is more awkward than SSE.
- **In-memory subscriber list only** — no replay; a reload loses history, which is the
  exact failure the event table exists to prevent.

**Trade-offs:** One-way only, so cancellation is a separate request. Browsers cap
HTTP/1.1 connections per origin (~6), which limits how many runs can stream at once;
HTTP/2 multiplexes, so it only bites in dev. Proxies can buffer SSE unless
`no-cache, no-transform` is set, and a 15s `: ping` keeps idle connections alive. On
mount the client opens the stream without `?after`, so it replays the full history
rather than only new events — harmless today, worth tightening if runs get long.

**Where:** `server/src/index.ts:226`, `server/src/index.ts:233`,
`server/src/index.ts:261`, `web/src/App.tsx:286`

---

### 0028 — npm workspaces for the monorepo
**Date:** 2026-10-30 · *backfilled*

**Context:** Two packages share a contract and are installed and type-checked
together.

**Decision:** Root `package.json` with `workspaces: ["server", "web"]` and root
scripts that delegate with `-w`.

**Why:** Zero additional tooling — npm ships with Node — and one `npm install`
hoists both workspaces. Two packages do not justify a task graph or a cache.

**Alternatives rejected:**
- **pnpm** — faster installs, strict (non-hoisted) `node_modules`, better workspace
  ergonomics. Not chosen because it requires installing another package manager on
  every machine, and the strictness can surface phantom-dependency issues in
  dependencies that assume hoisting.
- **Turborepo / Nx** — remote caching and task orchestration pay off with many
  packages and long builds; here it is configuration to maintain for two scripts.
- **One package with folders** — loses per-package dependency boundaries and the
  ability to type-check or run one side independently.

**Trade-offs:** Hoisting makes phantom dependencies possible (a workspace importing
something only installed by its sibling will work locally and break on a clean
install). There is no task cache, so `npm run typecheck` re-checks both packages every
time. `-w` flags are easy to forget. pnpm is the sensible upgrade if the repo grows.

**Where:** `package.json:6`, `package.json:16`

---

### 0029 — Node 24 as the runtime
**Date:** 2026-10-30 · *backfilled*

**Context:** The server needs to run TypeScript, talk to HTTP APIs, and persist data,
with as few moving parts as possible.

**Decision:** Node 24, run directly (`node src/index.ts`), using type stripping,
native `fetch`, `AbortSignal.any/timeout`, and `node:sqlite`.

**Why:** Four features that would otherwise be dependencies or build steps ship in
the runtime. LangChain, Express, and native modules all target Node first, so
compatibility risk is lowest here.

**Alternatives rejected:**
- **Bun** — much faster startup and a built-in SQLite driver, bundler, and test
  runner. Not chosen because it is a younger runtime with a different
  native-module ABI, and the LangChain provider packages are not guaranteed to be
  tested against it.
- **Deno** — TypeScript and secure-by-default permissions. Not chosen because Node
  compatibility (npm resolution, `node:sqlite`, some LangChain internals) is the
  friction point, and the permission model fights a tool that must call arbitrary
  HTTP endpoints.
- **Node 20/22 LTS** — more conservative, but no built-in type stripping and older
  `node:sqlite`; the project would need `tsx` plus `better-sqlite3` (see #0013).

**Trade-offs:** Runtime choice dictates syntax: type stripping only accepts erasable
TypeScript (#0008), so no enums or parameter properties. Behaviour is tied to the
installed Node version — hence nvm in `AGENTS.md` — and experimental-warning
suppression is part of the dev script. A runtime upgrade is a real compatibility
event, not a patch bump.

**Where:** `server/package.json:8`, `server/src/db.ts:15`, `AGENTS.md:20`

---

### 0030 — LangChain provider adapters instead of raw vendor SDKs
**Date:** 2026-10-30 · *backfilled*

**Context:** One Agent node must talk to OpenAI-compatible endpoints, Anthropic, and
Google, and report token usage.

**Decision:** Depend on `@langchain/openai`, `@langchain/anthropic`, and
`@langchain/google-genai`, all behind `buildModel()`; include a local
`MockChatModel` so the graph runs without keys.

**Why:** All three expose `BaseChatModel`, so `agent.ts` has one `invoke()` call,
one message format, and one `usage_metadata` shape. Adding a provider is a branch in
`buildModel`, not a second HTTP client. The mock subclass is small because the
interface is already abstracted.

**Alternatives rejected:**
- **Raw vendor SDKs** (`openai`, `@anthropic-ai/sdk`, `@google/genai`) — fewer layers
  and smaller dependencies, but three request/response/usage formats to normalize
  and three places for retries and timeouts.
- **One gateway only** (OpenRouter, LiteLLM) — a single OpenAI-compatible API, but it
  requires an extra service or a hosted dependency, and provider-native features are
  hidden behind the gateway.
- **Raw `fetch` against each REST API** — maximum control and zero abstraction cost,
  but the most code and the easiest place to get streaming and auth subtly wrong.

**Trade-offs:** Significant dependency weight and version churn; LangChain majors
move quickly. The abstractions leak — `agent.ts` casts the result to `AIMessage`, and
`MockChatModel` has to subclass internals. Provider-specific features (tool calling,
structured output, reasoning controls) are not exposed yet. The raw SDK remains the
escape hatch if a feature is blocked by the adapter.

**Where:** `server/package.json:13`, `server/package.json:16`,
`server/src/langgraph/models.ts:78`, `server/src/nodes/agent.ts:96`

---

### 0031 — Plain CSS with custom properties
**Date:** 2026-10-30 · *backfilled*

**Context:** A dark, bespoke UI: node cards with status accents, a palette, an
inspector, and a run panel.

**Decision:** One `styles.css` using CSS variables for colour, spacing, and the mono
font; no preprocessor, no utility framework.

**Why:** The component count is small and the visual language is custom (accent per
node category, handle positions). Plain CSS keeps the dependency list to React and
React Flow, and variables make a theme switch possible later without a refactor.

**Alternatives rejected:**
- **Tailwind** — fast iteration and consistency, but adds a build/config layer and
  pushes long class strings into JSX, which is harder to read while learning.
- **CSS-in-JS** (styled-components/emotion) — colocated styles, but a runtime cost and
  another dependency for a static local app.
- **A component kit** (MUI, shadcn/ui) — accessible defaults, but heavy, opinionated,
  and awkward to bend into a node-graph aesthetic.

**Trade-offs:** No utility shortcuts or design-token enforcement; class naming is a
human convention. No dark/light toggle yet (the tokens make one cheap). Dead rules
accumulate silently because nothing purges unused CSS.

**Where:** `web/src/styles.css:2`

---

### 0032 — Client state stays in React hooks
**Date:** 2026-10-30 · *backfilled*

**Context:** The app is one screen: workflow list, canvas, inspector, run panel.

**Decision:** `useState`/`useCallback`/`useEffect` inside `App.tsx`; graph node and
edge state come from React Flow's `useNodesState`/`useEdgesState`; the server is the
source of truth for saved workflows.

**Why:** There is no cross-route state and no cache to invalidate. Lifting state to
`App.tsx` and passing it down is the shortest path to working behaviour, and it keeps
the data flow readable for someone learning React.

**Alternatives rejected:**
- **Redux / Zustand / Jotai** — global stores and devtools pay off with many
  independent screens; here they add indirection around state that already has one
  owner.
- **TanStack Query** — request caching, deduplication, and background refetch are
  valuable for a networked app with shared entities; this app saves explicitly and
  refetches on demand, so the cache would mostly add concepts.
- **React Router** — URLs and deep links would be nice, but there is only one view;
  routing would be scaffolding without a user-visible feature.

**Trade-offs:** `App.tsx` is a large component and new panels will keep adding state
there. Prop drilling grows with each extracted component. No optimistic updates or
request cache: every save round-trips and the list is refetched after mutations. If
the app gains multiple screens or background refresh, Zustand plus TanStack Query is
the natural split.

**Where:** `web/src/App.tsx:36`, `web/src/App.tsx:41`, `web/package.json:12`

---

### 0033 — `run()` takes one named-argument object
**Date:** 2026-10-30 · *backfilled*

**Context:** Every executor needs the node config and merged input, and some also need
the abort signal and a log sink. `signal` and `log` were added after the first nodes.

**Decision:** `run({ node, config, state, signal, log })`, destructured in the
signature.

**Rejected shape:**

```ts
// Positional: adding `log` or `signal` means touching every node and getting the
// order right at every call site.
async run(config, state, signal, log) { … }

// Or a class with instance state:
class HttpNode {
  constructor(private config) {}
  async run(state) { /* this.config … */ }
}
```

**Why:** Named arguments are order-free and additive: a node can ask for only the
fields it uses, and adding a field to `NodeRunArgs` breaks nobody. Destructuring also
documents usage at a glance — `log.ts` takes `{ config, state, log }`, while
`set.ts` takes only `{ config, state }`. There is no `this`, so the function can be
passed around detached (which the compiler does).

**Alternatives rejected:** Positional parameters (order bugs, every new field is a
breaking change); a class per node (binding hazards, inheritance pressure, more
ceremony for a data+function pair); a global context (implicit dependencies).

**Trade-offs:** One small object allocated per node execution. Signatures are
longer, and optional fields must be defaulted by the engine (`signal` always exists),
so nodes can rely on them. Nesting the whole `state` puts five channels in reach of
every node, which is convenient but makes it easy to read `state.result` accidentally.

**Where:** `server/src/langgraph/types.ts:5`, `server/src/langgraph/asNode.ts:39`,
`server/src/nodes/types.ts:4`

---

### 0034 — A node is a plain `{ meta, run }` object, not a class
**Date:** 2026-10-30 · *backfilled*

**Context:** The registry has to map a node type id to metadata and behaviour.

**Decision:** Each file exports `const myNode: NodeDefinition = { meta, run }`. The
registry is a plain object; the compiled graph receives the bare `run` function.

**Rejected shape:**

```ts
// Inheritance would be tempting for shared behaviour:
abstract class BaseNode {
  abstract meta: NodeTypeMeta;
  constructor(protected config: Record<string, unknown>) {}
  abstract run(state: LocalRunState): Promise<NodeRunResult>;
}
class HttpNode extends BaseNode { … }
```

**Why:** `NodeDefinition` is a structural type, so the registry needs no base class
import and each node is a self-contained value. Crucially, the compiler passes the
function detached:

```ts
asGraphNode(node, definitionFor(node.type)!.run, incoming)
```

A class method would lose `this` there unless every call site re-bound it. Plain
objects also keep `meta` (data) and `run` (behaviour) in one readable literal, and
they are trivially tree-shakeable.

**Alternatives rejected:** Abstract base class (binding, inheritance for sharing,
more imports); a factory function per node (extra indirection with no per-instance
state); metadata in a separate map from executors (two places to forget when adding
a node).

**Trade-offs:** No inheritance for "like HTTP but with auth" — shared behaviour must
be a function or a helper module. No constructor for per-node setup, so any setup
happens per run (fine here: everything is cheap and config-derived). Shared config
access is repeated unless a helper is extracted (#0035).

**Where:** `server/src/nodes/types.ts:4`, `server/src/nodes/http.ts:9`,
`server/src/langgraph/compiler.ts:119`

---

### 0035 — Config access is two coercion helpers, not a schema per node
**Date:** 2026-10-30 · *backfilled*

**Context:** Node config arrives as `Record<string, unknown>` from JSON. Each node
needs a string with a default, or an optional number.

**Decision:** `requireString(config, key, fallback)` and
`optionalNumber(config, key)` in `nodes/types.ts`.

**Rejected shape:**

```ts
// A schema would look stricter, but config is templated — the value is often
// "{{ input.count }}" until render time, so validating the raw string is wrong.
const schema = z.object({ timeoutMs: z.number().default(20000) });
const { timeoutMs } = schema.parse(config);
```

**Why:** Config values are not typed at edit time: a number field can hold a template
or an empty string, and the inspector writes `undefined` for cleared inputs. Coercion
with a fallback matches how the values are actually produced, and it is one line per
field. Real validation still happens where it can — after rendering, in the node
(`URL is empty`, `Invalid regular expression`, etc.).

**Alternatives rejected:** Per-node zod schemas (validates the wrong representation,
duplicates field metadata); TypeScript generics on `config` (no runtime effect,
casts lie); direct `config.x as string` (undefined leaks into templates).

**Trade-offs:** Helpers coerce silently: `optionalNumber("abc")` becomes `undefined`,
so a typo in a number field falls back instead of erroring — you only notice by
behaviour. `requireString` stringifies objects (`"[object Object]"`). There is no
single place listing the valid config keys; `meta.fields` is the UI list and the node
is the runtime list.

**Where:** `server/src/nodes/types.ts:15`

---

### 0036 — `NodeExecutionError` marks expected failures; the wrapper catches everything
**Date:** 2026-10-30 · *backfilled*

**Context:** Nodes fail for two very different reasons: a user mistake (bad URL,
missing key) or a bug (typo, undefined access).

**Decision:** Throw `NodeExecutionError` for user-facing failures, but have
`asGraphNode` catch `Error` (not just that class) and store the message.

**Why:** The class is documentation and keeps messages consistent, not control flow.
No code does `instanceof NodeExecutionError`. Catching everything means a bug in one
node fails that node instead of rejecting the whole superstep.

**Alternatives rejected:** Catch only `NodeExecutionError` and let other exceptions
escape (a typo would kill the run and lose sibling branches); return
`{ ok: false, error }` from every node (ceremony, easy to forget, and `run` would
never use exceptions for a natural error path); custom error codes for the UI (no
consumer yet).

**Trade-offs:** The UI cannot tell "you configured this wrong" from "the engine has a
bug" — both render as a red `node.failed` line. Stack traces are dropped; only
`error.message` is persisted. Wrapping a `TypeError` in a node's own message can bury
the useful part if done carelessly (`code.ts` and `http.ts` include the cause).

**Where:** `server/src/nodes/types.ts:11`, `server/src/langgraph/asNode.ts:51`

---

### 0037 — `asGraphNode` is a factory that returns a closure and a partial state update
**Date:** 2026-10-30 · *backfilled*

**Context:** LangGraph wants a node function `(state) => update`. Each canvas node
needs its parent outputs merged into `state.input`, its errors captured, and its
result written under its own id.

**Decision:**

```ts
export function asGraphNode(node, runner, incomingIds) {
  return async (fullState, rawConfig) => {
    const state = { ...fullState, input: mergeInput(fullState, incomingIds) };
    try {
      const result = await runner({ node, config, state, signal, log });
      return { outputs: { [node.id]: result.output }, … };
    } catch (error) {
      if (signal.aborted) throw error;
      return { errors: { [node.id]: message } };
    }
  };
}
```

**Why:** The closure captures `node`, `runner`, and `incomingIds` once at compile
time, so the hot path only merges input and runs. Returning a *partial* update lets
LangGraph's reducers merge channels — `outputs` spreads across parallel siblings
instead of replacing them. Computing the merged input here (not in a global channel)
is what gives each node the output of its direct parents.

**Rejected shape:**

```ts
// Mutating and returning the full state overwrites channels written by siblings:
async (state) => {
  state.input = …;              // not a channel at all
  state.outputs[node.id] = …;
  return state;                 // clobbers other nodes' updates
}
```

**Why not that:** mutating `fullState` bypasses reducers and would make parallel
execution order-dependent; returning the full state replaces `outputs` instead of
merging it.

**Alternatives rejected:** A class with an `invoke` method (same behaviour, more
ceremony); a generic wrapper that takes a per-node callback (indirection without
saving code); passing `incomingIds` through state (duplicates what the compiler
already knows).

**Trade-offs:** Returning `{}`-shaped partials is easy to get wrong — writing
`result: undefined` would clobber the output channel, which is why the code spreads
conditionally (`...(result.branches ? … : {})`). There is no pre/post hook, so
metrics, retries, or caching would each need a new wrapper layer.

**Where:** `server/src/langgraph/asNode.ts:17`

---

### 0038 — `compileWithPlan` returns the validation plan next to the runnable
**Date:** 2026-10-30 · *backfilled*

**Context:** Compiling validates the graph and produces node order, incoming edges,
and outgoing edges. The event adapter later needs order and labels to report
`node.started`, `node.skipped`, and the final output.

**Decision:** `compileWithPlan(graph)` returns `{ compiled, plan }`; `compileGraph`
is a thin wrapper for callers that only need the runnable.

**Why:** The plan is a by-product of validation that would otherwise be thrown away
and recomputed. Recomputing it in `run.ts` means validating the graph twice, and the
two results could diverge (different sort, different error text).

**Alternatives rejected:** Attach `plan` to the compiled object (untyped property,
fights LangGraph's return type); a `Plan` class that compiles itself (two objects
either way, plus a class); a separate `validate(graph)` pass before `compile(graph)`
(two traversals, and callers can forget the first).

**Trade-offs:** Callers must thread a small record instead of one value. The plan is
a snapshot of compile time; if a graph could change mid-run, it would be stale (it
cannot today: the graph is copied into the run). `compileGraph` exists only for
ergonomics, so there are two entry points to keep consistent.

**Where:** `server/src/langgraph/compiler.ts:111`, `server/src/langgraph/run.ts:39`

---

### 0039 — `targetsFor` is a pure function of node, edges, and state
**Date:** 2026-10-30 · *backfilled*

**Context:** Every compiled node needs a routing function for LangGraph's conditional
edges. The rule is the same everywhere: stop on error, otherwise follow the branches
the node selected.

**Decision:**

```ts
function targetsFor(node, edges, state): string[] {
  if (state.errors[node.id]) return [];
  const active = state.branches[node.id];
  return edges
    .filter((edge) => (active ? active.includes(edge.sourceHandle ?? "") : true))
    .map((edge) => edge.target)
    .filter((target, index, self) => self.indexOf(target) === index);
}
```

**Why:** One implementation means the error-cut and branch semantics cannot drift
between nodes. It depends only on its arguments, so it can be reasoned about (and
tested) without building a graph. Capture happens in `compileWithPlan`'s loop:
`(state) => targetsFor(node, edges, state)`.

**Alternatives rejected:** A closure per node that captures `edges` (14 identical
lambdas, easy to special-case one by accident); precomputing a handle→targets map
(faster, but routing still needs `state` and the map adds a second structure to keep
in sync); routing inside the node executor (nodes would need edge knowledge the
engine deliberately withholds).

**Trade-offs:** Filters the edge list on every routing decision — O(E) per node, with
an `indexOf` dedupe that is O(n²) in the number of targets. Irrelevant at canvas
sizes, visible only if a graph had thousands of edges. Returning `[]` is legal
LangGraph ("route nowhere"), which is exactly how an error stops a branch.

**Where:** `server/src/langgraph/compiler.ts:101`

---

### 0040 — The run output is derived by scanning the plan backwards
**Date:** 2026-10-30 · *backfilled*

**Context:** A graph may have zero, one, or several Output nodes, and only some of
them execute on a given run.

**Decision:** Prefer `state.result` (written by Output nodes); otherwise walk
`plan.order` in reverse and take the last node that actually ran and has an output.

**Why:** `plan.order` is a topological order produced during validation, so "last in
the plan that executed" is a good definition of "latest result" without tracking
anything extra. The `node.id in outputs` check excludes skipped nodes, whose ids
never appear.

**Alternatives rejected:** Track "last finished node" while handling events (mutable
state in the adapter, and the order events arrive is not necessarily the order nodes
completed); return only `state.result` (a graph without an Output node would return
`null` even though it did work); compare finish timestamps (requires timing for every
node, including skipped ones).

**Trade-offs:** With parallel branches, "last" is whichever node sits later in the
plan order — not necessarily the most interesting one. That ambiguity is why Output
nodes exist and why `state.result` wins (#0023). The scan is O(n) per run, which is
nothing.

**Where:** `server/src/langgraph/run.ts:267`, `server/src/langgraph/run.ts:272`

---

### 0041 — The database is a module singleton with free functions
**Date:** 2026-10-30 · *backfilled*

**Context:** There is exactly one SQLite file per server process, opened at startup.

**Decision:** `export const db = new DatabaseSync(DB_PATH)` at module scope, plus
exported functions (`listWorkflows`, `createRun`, `appendEvent`, …). No class, no
injection.

**Why:** With one database and one process, a class would only add a constructor and
a `this` to pass around. Free functions cannot hold stale state, are easy to import
by name, and keep the SQL next to the mapping code. Opening at import also means the
directory and schema exist before the first request.

**Alternatives rejected:** `class Store { constructor(path) }` turned into a
singleton (testability and multiple DBs, but nothing needs either today); a
repository interface per entity (three tables, no alternative implementation);
an ORM (#0007).

**Trade-offs:** Import has side effects: it creates `data/`, the file, and the
schema. That makes unit tests awkward — you must set `AGENT_MAKER_DB` before the
module is first imported, or run in a separate process. `node:sqlite` is synchronous,
so every query blocks the event loop (fine at this scale). There is no transaction
helper; multi-statement writes would need manual `BEGIN`/`COMMIT`.

**Where:** `server/src/db.ts:15`, `server/src/db.ts:19`

---

### 0042 — Route handlers are inline, with early returns and no controller layer
**Date:** 2026-10-30 · *backfilled*

**Context:** Ten endpoints, each: validate → load → respond, with a 404/400 path.

**Decision:** Handlers live directly in `index.ts`; each failure path returns
immediately:

```ts
app.get("/api/workflows/:id", (req, res) => {
  const workflow = getWorkflow(req.params.id);
  if (!workflow) {
    res.status(404).json({ error: "Workflow not found" });
    return;
  }
  res.json(workflow);
});
```

**Rejected shape:**

```ts
// Controller + service + async wrapper: three files and a try/catch for five lines.
router.get("/:id", asyncHandler(async (req, res, next) => {
  const workflow = await service.get(req.params.id);
  if (!workflow) throw new NotFoundError("Workflow");
  res.json(workflow);
}));
```

**Why:** Express 5 already forwards rejected promises to the error middleware, so the
`asyncHandler` wrapper is unnecessary. Early returns keep the happy path flat and
avoid `else` nesting. A controller layer would only earn its keep with reuse across
routes, which these do not have.

**Alternatives rejected:** Router modules per resource (better for 50 endpoints, noise
for 10); a service layer (no business logic beyond one DB call); a generic
`handle(fn)` wrapper (nothing to wrap in Express 5).

**Trade-offs:** `index.ts` is ~280 lines and every new feature adds to it. The
`if (!workflow) 404` block is repeated five times, and create/update duplicate the
zod parse/respond dance. Splitting into routers is the natural move once the route
count doubles.

**Where:** `server/src/index.ts:113`, `server/src/index.ts:127`,
`server/src/index.ts:162`

---

### 0043 — A run is fire-and-forget after a `202`
**Date:** 2026-10-30 · *backfilled*

**Context:** A run can take seconds or minutes (LLM calls, delays). The browser needs
to start it and then receive progress.

**Decision:** Create the run row, respond `202 { runId }`, then start execution inside
`setImmediate`; events carry progress and the final status is written by `finishRun`.

**Why:** Holding the HTTP request open for the whole run is fragile (proxy and browser
timeouts) and blocks nothing useful. `setImmediate` lets the response flush before
graph work begins, so the client can connect to the event stream without racing the
first `run.started`. The `.catch` guarantees a failed execution still writes a
terminal status.

**Alternatives rejected:** `await executeGraph(...)` in the handler (long-lived
request, no progress); `void executeGraph(...)` without `setImmediate` (works, but the
response and the run compete in the same tick); a job queue/worker (durable execution
and retries — the right answer at scale, but a second process and a broker here); a
child process per run (isolation, but IPC and startup cost).

**Trade-offs:** Errors after the `202` are only visible through events and the `runs`
row. Active runs live in an in-memory `running` map, so a server restart loses the
ability to cancel and leaves runs marked `running` forever (no checkpointer, #0013).
Nothing bounds concurrency; ten simultaneous runs all compete for the same event
loop.

**Where:** `server/src/index.ts:162`, `server/src/index.ts:176`,
`server/src/index.ts:178`

---

### 0044 — SSE subscribes first, buffers during replay, then flushes
**Date:** 2026-10-30 · *backfilled*

**Context:** On connect, the endpoint must send past events and then live ones. A
naive "read history, then subscribe" loses anything published in between.

**Decision:**

```ts
let replaying = true;
const backlog = [];
const unsubscribe = subscribe(runId, (stored) => {
  if (replaying) backlog.push(stored);
  else send(stored);
});
for (const stored of listEvents(runId, lastSeq)) send(stored);
replaying = false;
for (const stored of backlog) send(stored);
```

`send` drops anything with `seq <= lastSeq`.

**Why:** Subscribing first makes the gap impossible; the flag turns concurrent
deliveries into a queue instead of interleaving them with history. The seq check
makes the overlap between the backlog and the replay harmless, so the two sources can
be merged without a lock.

**Alternatives rejected:** Subscribe after replay (events in the gap are lost);
`await` a mutex around read+subscribe (no async boundary to await — the DB is sync,
but the subscription is not a transaction); polling from the client (see #0027).

**Trade-offs:** The backlog is unbounded for the duration of the replay; a very long
history plus a fast-running graph could hold many events in memory. Correctness
depends on `seq` being monotonic per run (it is, via `AUTOINCREMENT`). The endpoint
supports `?after=`, but the client always opens at 0 and replays the full history
(#0027).

**Where:** `server/src/index.ts:241`, `server/src/index.ts:249`,
`server/src/index.ts:251`

---

### 0045 — Two graph shapes with explicit mappers at the boundary
**Date:** 2026-10-30 · *backfilled*

**Context:** React Flow wants `Node<FlowNodeData>` objects with UI-only fields; the
API and SQLite want a minimal `GraphNode`.

**Decision:** `web/src/types.ts` owns `toFlowNodes`, `toFlowEdges`, and `toGraph`.
The server never sees React Flow types; the client never persists them.

**Why:** Persisting React Flow nodes directly would tie the saved format to a library
version and leak runtime fields (`selected`, `dragging`, `measured`, `internals`) into
SQLite. Mapping in one module means the conversion is written once, and the whole
round trip is visible in ~40 lines.

**Rejected shape:**

```ts
// Tempting, and it works — until the library adds a field or you upgrade.
await api.updateWorkflow(id, { name, graph: { nodes, edges } });
```

**Why not that:** `nodes` are `FlowGraphNode`s; sending them would store UI state and
couple the API contract to `@xyflow/react`. It also makes the server accept fields it
does not validate.

**Alternatives rejected:** A per-component `useMemo` mapper (repeated, inconsistent
rounding); storing the raw canvas JSON as an opaque blob (no server-side validation,
no `nodeCount`); server-side mapping to React Flow (server would depend on a UI
library).

**Trade-offs:** Two representations to keep in sync: a new node field needs edits in
the shared type, both mappers, and the inspector. Positions are rounded on save to
avoid float noise. Defaults (`label`, `config`, `status`) are applied on load, so a
missing label becomes the metadata label rather than staying empty.

**Where:** `web/src/types.ts:31`, `web/src/types.ts:53`, `web/src/App.tsx:201`

---

### 0046 — Ephemeral run status lives beside the graph, not inside it
**Date:** 2026-10-30 · *backfilled*

**Context:** Node cards must show running/succeeded/failed/skipped, and the inspector
must show the last output. None of that belongs in the saved workflow.

**Decision:** `runtime: Record<nodeId, NodeRuntime>` is separate state, updated by
`applyEvent`; `displayNodes` merges it into node data at render time.

```ts
const displayNodes = useMemo(
  () => nodes.map((node) => ({ ...node, data: { ...node.data, status, durationMs } })),
  [nodes, runtime],
);
```

**Why:** If status were written into `nodes`, every event would mark the graph dirty,
risk being saved, and disappear on reload anyway. Keeping it in a parallel map means
the editable graph stays exactly the user's data, and the canvas is a pure projection
of `(nodes, runtime)`. `useMemo` avoids rebuilding 50 node objects on unrelated
state changes.

**Alternatives rejected:** Mutating `node.data.status` on each event (dirty flag,
save coupling, lost on reload); a separate status map passed to every component
(prop drilling, and `FlowNodeCard` already receives `data`); a global store (#0032).

**Trade-offs:** Every event creates a new `runtime` object, so the whole canvas
re-renders on each node log; `FlowNodeCard` is memoized, which limits the damage.
Two similarly named things (`nodes` vs `displayNodes`) are easy to confuse — passing
the wrong one to `toGraph` would persist status. Status is reset wholesale on
`startRun` and on workflow load, so there is no per-node history.

**Where:** `web/src/App.tsx:363`, `web/src/App.tsx:250`

---

### 0047 — `buildModel` returns a model, and the mock subclasses the real interface
**Date:** 2026-10-30 · *backfilled*

**Context:** The Agent node must support four providers without knowing their
classes, and must run with no API key for demos.

**Decision:** `buildModel(config)` returns `BaseChatModel`; `MockChatModel extends
BaseChatModel` and fabricates a deterministic reply.

**Why:** Returning the model (not a config object or a provider descriptor) means
`agent.ts` has exactly one call shape: `model.invoke(messages, { signal })`. Because
the mock implements the same base class, it emits the same `on_chat_model_*` events,
so usage logging and the event adapter work unchanged.

**Rejected shape:**

```ts
// Provider dispatch inside the node — every future node repeats it.
if (provider === "openai") return new ChatOpenAI(…);
else if (provider === "anthropic") return new ChatAnthropic(…);
```

**Why not that:** Provider construction, key resolution, and defaults would leak into
every AI node, and adding a provider means editing each one.

**Alternatives rejected:** Return a discriminated config and let the caller construct
(two-step API, same knowledge leak); a plain mock function that bypasses `invoke`
(would need a special case in `agent.ts` and would not emit model events); a gateway
service (#0030).

**Trade-offs:** `ModelConfig` grows a field for every provider-specific option
(reasoning, tools, JSON mode). The `AIMessage` cast in `agent.ts` is a type-system
escape hatch because `invoke` returns a union. `MockChatModel` subclasses internals,
so a LangChain major upgrade can break it despite no network involved.

**Where:** `server/src/langgraph/models.ts:78`, `server/src/langgraph/models.ts:39`,
`server/src/nodes/agent.ts:96`

---

### 0048 — Log rendering is a `switch` over the event union
**Date:** 2026-10-30 · *backfilled*

**Context:** There are nine event types, each with its own fields and styling.

**Decision:** `LogLine` switches on `event.type` and returns JSX per case; the
`default` returns `null`.

```tsx
switch (event.type) {
  case "node.failed":
    return <div className="log-line error">…{event.error}</div>;
  // …
  default:
    return null;
}
```

**Why:** A discriminated union narrows `event` inside each case, so `event.error`
exists only in `node.failed` without casts. Colours and wording stay next to the
condition that selects them. `default: null` makes the client forward-compatible: a
newly added server event renders nothing instead of throwing.

**Rejected shape:**

```ts
// A map of renderers needs a shared props signature and loses per-case narrowing.
const RENDERERS: Record<RunEvent["type"], (event: RunEvent) => JSX.Element> = { … };
```

**Why not that:** every renderer would take the full union and have to cast, and the
`Record` forces an entry for each type only at that one place — the switch reads
better for nine small cases.

**Alternatives rejected:** `if/else` chain (no narrowing without repeated type
guards); a table-driven formatter with a generic line component (less control over
markup); rendering `JSON.stringify(event)` (unreadable, no status colours).

**Trade-offs:** Adding an event type is not a compile error here (because of
`default`), so a new event can silently render nothing — the run still shows the
count. Markup and styling are coupled in this file; a design change touches both.

**Where:** `web/src/components/RunPanel.tsx:91`

---

### 0049 — Edges get a custom type with a hover "×", not a context menu
**Date:** 2026-11-03

**Context:** Removing a connection required selecting the line and pressing Delete.
The line is drawn at `stroke-width: 1.6` with no interaction width, so a click three
pixels off the stroke hit the pane and cleared the selection instead. The gesture was
undiscoverable, and it had no mouse-only form.

**Decision:** Register a custom edge type (`flowEdge` → `DeletableEdge`) that renders
`getSmoothStepPath` + `BaseEdge` with `interactionWidth: 24`, and paints a 20px `×`
button at the path midpoint through `EdgeLabelRenderer`. The button appears while the
edge is hovered or selected and deletes through `deleteElements({ edges: [{ id }] })`.

**Rejected shape:**

```tsx
// Right-click → context menu: needs a menu component, outside-click dismissal,
// and a second fixed-position layer in canvas coordinates.
<BaseEdge onContextMenu={(e) => openMenu(e.clientX, e.clientY, id)} … />
```

```tsx
// Keeping the × always visible: honest, but a dense graph turns into a field of
// × buttons competing with the node cards.
```

**Why:** Hover is where the pointer already is, so no mode switch or documentation is
needed. `deleteElements` is the same code path the Delete key uses, so it fires
`onEdgesChange` with a `remove` change — meaning `App.tsx:122` sets the dirty flag and
`toGraph` drops the edge on save without any new plumbing. Putting the button in
`EdgeLabelRenderer` (an HTML portal) keeps it a constant 20px at every zoom, and
`interactionWidth` widens the invisible hit stroke without changing the drawing.

**Alternatives rejected:** Context menu (more UI surface, discoverability is no better
than hover, and it would need to position itself in screen space); an always-visible ×
(noise on dense graphs); select-then-Delete as the only gesture (keyboard-only, and the
hit target stays 1.6px); deleting from the Inspector's edge list (there is no edge
list); `onEdgeClick` toggle that deletes on a second click (a single click already
selects, so a double-click would fight canvas zoom).

**Trade-offs:** The button is hidden while `hovered || selected`, so moving the pointer
from the line onto the button would unmount it mid-move — `EdgeLabelRenderer` lives
outside the SVG `<g>` that owns the hover state. Hence `HIDE_DELAY_MS = 140`: leaving
the line *schedules* the hide so the pointer can land on the button. That timer is the
fragile part; a slower pointer on a laggy machine can still blink the button away. The
× sits on top of the line, so a midpoint that overlaps a node card is hard to see (the
elbow of a smoothstep path usually avoids this). There is no undo and no confirmation —
one click is final until Ctrl+Z exists, which it does not. Zooming with the wheel while
hovering keeps the button mounted but repositions it on the next render.

**Where:** `web/src/components/DeletableEdge.tsx:22`,
`web/src/components/Canvas.tsx:23`, `web/src/styles.css:466`



