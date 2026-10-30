# AGENTS.md — agent_maker

Node-graph agent builder (n8n-like). Vite + React canvas, Express API, in-process DAG
runner, SQLite. Verified against the committed config; trust `package.json` over prose.

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
- DB file: `server/data/agent_maker.db` (cwd is the server workspace; override
  `AGENT_MAKER_DB`). Delete it to reset. A demo workflow is seeded whenever the
  workflow table is empty.

## Conventions

- `shared/types.ts` is the only cross-workspace contract: type-only imports, no runtime
  code. Graph/run/event shapes and node metadata live there.
- Node executors live in `server/src/nodes/*.ts`, each exporting `{ meta, execute }`;
  register in `server/src/nodes/index.ts` *and* extend `NodeType` in `shared/types.ts`.
  `meta.fields` drives the inspector form — no UI work needed for config fields.
- Nodes render their own templates (`renderString`/`renderValue`) against a scope of
  `{ input, nodes, run }`. The runner deliberately does not pre-render config, to avoid
  double-expanding `{{` inside prompts.
- Runs emit events through one `publish()` path: persisted to `run_events` first, then
  fanned out to SSE listeners. Keep that ordering; resume relies on `seq`.
- Branching is expressed by `execute()` returning `branches: ["true"]`; the runner maps
  that to outgoing `sourceHandle` ids and skips dead nodes.
- Express 5 + zod validation at the route boundary. `node:sqlite` (`DatabaseSync`) is
  used directly — no ORM.

## Gotchas

- Vite dev sometimes serves a stale CSS transform on Windows; if a stylesheet edit
  doesn't apply, restart `npm run dev` before debugging the rule.
- `process.loadEnvFile()` reads `.env` from the cwd (server workspace) — put keys in
  `server/.env`.
- Windows PowerShell: quote browser refs (`agent-browser click "@e4"`), `@e4` is a
  splat operator otherwise.

## Boundaries

- Ask before `git commit`/`push` or deleting the SQLite DB.
- Keep secrets out of the repo: keys belong in `server/.env` (gitignored), and the
  README documents env var names.
