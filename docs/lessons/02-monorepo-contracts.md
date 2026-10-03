# 02 — Monorepo and shared contracts

The root npm workspace includes every app and package. Root `build` orders the shared packages before Vite, Next.js, and the worker. Every package publishes only the paths named in its `exports` map. In particular, `@portfolio-pilot/config/browser` contains only public `VITE_` data; `@portfolio-pilot/config/server` is a separate server entry point. The browser imports only contracts and browser config.

## Configuration lookup

- `apps/web`: Vite loads `apps/web/.env` relative to its project root and exposes only `VITE_` variables through `import.meta.env`. Empty example values select the deterministic mock mode and default title.
- `apps/api`: Next.js loads `apps/api/.env.local` relative to its project root. The Node Route Handler validates `process.env` through `@portfolio-pilot/config/server`. Default mock mode needs no credentials.
- `apps/worker`: The process receives OS environment variables. For local use, copy `apps/worker/.env.example` to `apps/worker/.env` and start with `node --env-file=apps/worker/.env apps/worker/dist/index.js` after building. Its default role is `ingestion`; `WORKER_ROLE` accepts `ingestion`, `outbox`, or `agent`.

The example files contain empty placeholders. Credentials belong only in server environments. The browser never imports server config, Prisma, or the agent package.

## HTTP contract

Successful health responses contain `{ "status": "ok", "requestId": "<UUID>" }`. Every application error response should use `{ "error": { "code": "...", "message": "...", "requestId": "<UUID>" } }` from `@portfolio-pilot/contracts`. The `x-request-id` response header matches the body ID. The API accepts a valid UUID from `x-request-id` or generates one. Future routes should apply this same contract.

Run `npm install`, `npm run build`, `npm run typecheck`, and `npm run dev`. Open `http://127.0.0.1:5173`; health is visible on the page and directly at `http://127.0.0.1:5173/api/health/live`. Run `npm run start --workspace=@portfolio-pilot/worker` in a separate shell and stop with Ctrl+C.
