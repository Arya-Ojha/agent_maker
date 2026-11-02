# AGENTS.md — agent_maker

Node-graph agent builder (n8n-like). Vite + React canvas, Express API, LangGraph
engine (`@langchain/langgraph`), SQLite. Verified against the committed config; trust
`package.json` over prose.

## Commands (verified)

```bash
npm install                  # root; npm workspaces: server + web
npm run dev                  # server :5175 + vite :5173 (proxies /api)
npm run typecheck            # tsc --noEmit for both workspaces
npm run build                # vite build -> web/dist (server serves it)
npm start                    # prod: API + built UI on :5175
```

- Single workspace: `npm run typecheck -w server` / `-w web`, `npm run dev -w server`.
- There is **no test runner yet**. Do not claim tests pass; there are none. If you add
  one, update this section with the exact single-test command.
- Server runs directly under Node 24 type stripping (`node src/index.ts`): no build
  step, but only *erasable* TS syntax (no enums, namespaces, parameter properties) and
  imports must include the `.ts` extension.
- Server dev watcher uses `--watch-path` (`./src`, `../shared`, `./scripts`) — do NOT
  go back to plain `--watch`: it watches `node_modules`, restarts on churn, and kills
  in-flight runs (run status stays `running` forever).
- DB file: `server/data/agent_maker.db` (cwd is the server workspace; override
  `AGENT_MAKER_DB`). Delete it to reset. A demo workflow is seeded whenever the
  workflow table is empty.

## Conventions

- `shared/types.ts` is the only cross-workspace contract: type-only imports, no runtime
  code. Graph/run/event shapes and node metadata live there.
- The engine lives in `server/src/langgraph/`: `compiler.ts` (validate + build
  `StateGraph`), `asNode.ts` (node wrapper), `state.ts` (channels), `models.ts`
  (`buildModel`), `run.ts` (`streamEvents` v2 → `RunEvent` adapter). Node ids become
  LangGraph node names — don't use `__start__`, `__end__`, or `LangGraph` as ids.
- Node executors live in `server/src/nodes/*.ts`, each exporting `{ meta, run }`;
  register in `server/src/nodes/index.ts` *and* extend `NodeType` in `shared/types.ts`.
  `meta.fields` drives the inspector form — no UI work needed for config fields.
- Nodes render their own templates (`renderString`/`renderValue`) against a scope of
  `{ input, nodes, run }`. The engine deliberately does not pre-render config, to avoid
  double-expanding `{{` inside prompts. `state.input` is the merged output of the
  node's direct parents, injected per-node by `asGraphNode` — there is no global
  `input` channel.
- Node errors are captured into the `state.errors` channel by `asGraphNode` (returns
  an update, does not throw); routing cuts the failing node's outgoing edges. Only
  aborts are rethrown. The run adapter in `run.ts` attributes failures from node
  `on_chain_end` payloads and the final state.
- Runs emit events through one `publish()` path: persisted to `run_events` first, then
  fanned out to SSE listeners. Keep that ordering; resume relies on `seq`.
- Branching is expressed by `run()` returning `branches: ["true"]`; conditional edges
  map that to outgoing `sourceHandle` ids and skip dead nodes (emitted as
  `node.skipped` by the run adapter).
- The AI builder lives in `server/src/builder/`: `catalog.ts` (system prompt built from
  `nodeMetas` + `defaultConfig`), `ops.ts` (op DSL, apply, placement, `validateGraph`
  via the compiler's exported `planGraph`, `lintGraph`), `chat.ts` (model loop,
  parse/repair/lenient salvage, mock turn), `session.ts` (in-memory provider keys),
  `modelList.ts` (provider model listing), `providerError.ts` (vendor-error mapping).
  `POST /api/builder/chat` and `POST /api/builder/models` are in `server/src/index.ts`;
  the panel is `web/src/components/BuilderPanel.tsx` with dialogs in
  `web/src/components/ProviderDialogs.tsx`.
- `/provider` and `/model` are handled in the panel's `submit()` and must never be sent
  to the model. Config is per provider (`{ apiKey, baseURL }` in `localStorage`), and
  `loadSettings` migrates the v1 single-key shape — keep that migration when changing
  the shape again. Base URL only applies to OpenAI (`buildModel` ignores it elsewhere).
  Model listing filters OpenAI's non-chat ids and Gemini's media ids; add a provider to
  `web/src/providers.ts` *and* `builder/modelList.ts` together.
- Builder output is **ops, not graphs**: `add_node` / `update_node` / `delete_node` /
  `connect` / `disconnect`. Edge ops are deferred until after node ops so op order does
  not matter. New nodes are placed right of their parent — never ask a model for
  coordinates.
- Nothing reaches the canvas unless `validateGraph` passes, which reuses the compiler's
  `planGraph`. The node ceiling is `MAX_NODES` in `catalog.ts` and is interpolated into
  the prompt, so change it there rather than in prose. Do not let the builder add `code`
  nodes.
- `builder/session.ts` holds provider keys in memory so generated agent nodes can run
  with the key typed into the panel. Never put a key in node config (it would land in
  SQLite and exports).
- Express 5 + zod validation at the route boundary. `node:sqlite` (`DatabaseSync`) is
  used directly — no ORM.
- Every non-obvious choice gets an entry appended to `DECISIONS.md` in the same turn it
  is made: context, decision, why, rejected alternatives, trade-offs, and `file:line`
  references. Never rewrite old entries; supersede them with a new one.

## Gotchas

- Vite dev sometimes serves a stale CSS transform on Windows; if a stylesheet edit
  doesn't apply, restart `npm run dev` before debugging the rule.
- `@langchain/langgraph-checkpoint-sqlite` is installed but unusable: its
  `better-sqlite3` dep needs a native build that npm's install-script approval blocks.
  Don't wire a checkpointer without resolving that first.
- LangGraph's conditional edges accept an empty array (routes nowhere) but a thrown
  error inside a parallel superstep threw out of `streamEvents` in probing — keep the
  "capture into `state.errors`" wrapper intact.
- `process.loadEnvFile()` reads `.env` from the cwd (server workspace) — put keys in
  `server/.env`.
- The AI builder needs the server restarted after changes in `server/src/builder/`; on
  `--watch-path` this is automatic, but an in-flight chat call dies with the process.
  Small models (Gemini flash) invent node ids they never add — this is why edge ops are
  deferred and repaired with the explicit id list. Test changes with
  `provider: "mock"` first: it exercises the whole pipeline with no key or quota.
- Builder model calls abort after 60s (`chat.ts`) and the browser gives up after 200s
  (`api.ts`). Keep the outer bound above 3×60s or a repair chain is cut off mid-flight.
  Base URLs are validated as `http(s)` in the dialog and on the server — never pass a
  path or a `file:///` URL to `fetch`.
- Windows PowerShell: quote browser refs (`agent-browser click "@e4"`), `@e4` is a
  splat operator otherwise.

## Boundaries

- Ask before `git commit`/`push` or deleting the SQLite DB.
- Keep secrets out of the repo: keys belong in `server/.env` (gitignored), and the
  README documents env var names.
