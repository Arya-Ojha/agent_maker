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
- Windows PowerShell: quote browser refs (`agent-browser click "@e4"`), `@e4` is a
  splat operator otherwise.

## Boundaries

- Ask before `git commit`/`push` or deleting the SQLite DB.
- Keep secrets out of the repo: keys belong in `server/.env` (gitignored), and the
  README documents env var names.
