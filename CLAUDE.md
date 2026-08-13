# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Socket.IO server that bridges a PHP backend webhook to a React frontend:
PHP receives notifications from a third-party partner, forwards them to
this server, and the server delivers them to the right browser sessions —
so the frontend can update parts of the page without a full reload.

Designed to scale in notification _types_, not traffic: the PHP module
grows continuously and new notification types keep appearing. Adding one
should mean creating a schema file and registering it — no changes to the
server, auth, or routing.

## Commands

```bash
pnpm install                          # install all workspace deps

pnpm dev                              # build contracts, then run the server (tsx watch), http://localhost:4000
pnpm dev:playground                   # build contracts, then run the demo React app, http://localhost:5173
pnpm emit --type order.updated --orderId 123   # simulate the PHP webhook (HMAC-signs and POSTs /internal/emit)

pnpm build                            # build all workspace packages (topological order)
pnpm typecheck                        # build contracts first, then `tsc --noEmit` in every package
pnpm lint                             # eslint . (flat config, typescript-eslint)
pnpm format                           # prettier --write .

pnpm test                             # vitest run, whole repo
pnpm test:watch                       # vitest watch mode
pnpm vitest run path/to/file.test.ts  # run a single test file
pnpm vitest run -t "test name"        # run tests matching a name
```

There's no top-level git repo yet (`git init` hasn't been run in this
directory).

### Environment

`.env` at the repo root holds local dev secrets (already populated,
gitignored); `.env.example` documents every variable. Both the server
(`apps/server/src/main.ts`) and the playground (`vite.config.ts`,
`scripts/emit.ts`) load this **root** `.env` explicitly via `dotenv`,
regardless of which package's directory they run from — mind the relative
path depth (`../../.env`, `../../../.env`) if you move files. `INGEST_HMAC_SECRET`
and `JWT_SECRET` are required (min 16 chars, validated by Zod in
`apps/server/src/config.ts`); everything else has a sane default.

## Architecture

Ports & Adapters. The domain layer doesn't know HTTP or Socket.IO exist.

```
[PHP webhook] --HTTP+HMAC--> POST /internal/emit ┐
                                                  ├─> dispatchEvent (domain)
                                                  │     resolve audience → rooms
                                                  ▼
                                           EventPublisher (port)
                                                  │
                                     SocketIoPublisher (adapter)
                                                  │
                                          [React browsers]
```

### Workspace layout

- **`packages/contracts`** — the extension point of the whole system. An
  `EventRegistry` (`registry.ts`) maps a `type` string to a Zod payload
  schema; `defineEvent()` + `.register()` in `events/index.ts` is the only
  place a new notification type needs to be wired in. `parseEnvelope()`
  validates an incoming envelope against the registry and returns a typed
  `ok`/`error` result (`unknown_type` / `invalid_payload` / `invalid_envelope`).
  Both the server and the React client import this package for shared
  types — `apps/server` consumes it via its built `dist/` (must run
  `pnpm --filter @realtime-events/contracts build` first, or `pnpm dev`
  which does this automatically), while **Vitest resolves it straight from
  `src/` via an alias in the root `vitest.config.ts`**, so tests don't
  require a prior build.

- **`apps/server`** — the Socket.IO server, organized so `core/` never
  imports from `http/` or `realtime/`:
  - `core/dispatch-event.ts` — the single use case: takes a validated
    envelope, resolves target rooms, publishes via the `EventPublisher`
    port, strips `audience` before it reaches the client.
  - `core/resolve-rooms.ts` — audience → room-name translation. Rooms are
    always tenant-scoped (`tenant:{id}`, `tenant:{id}:user:{id}`,
    `tenant:{id}:{entityType}:{entityId}`). **Important precedence rule**:
    `userIds` and `entity` are additive and narrow the audience; the
    tenant-wide broadcast room is only used as a fallback when _neither_
    is present. (This was a real bug caught by the integration test —
    don't reintroduce a version where `entity` alone also broadcasts to
    the whole tenant.)
  - `http/ingest-route.ts` — `POST /internal/emit` handler. Reads the raw
    body _before_ JSON-parsing (HMAC in `http/hmac.ts` signs raw bytes,
    not the reserialized object). Batch validation is all-or-nothing: one
    bad event in `{ events: [...] }` rejects the whole batch with `422`
    and per-index errors.
  - `realtime/auth.ts` — `io.use()` middleware validating the JWT
    (HS256, claims `sub` → `userId`, `tenantId`) and attaching
    `{ tenantId, userId }` to `socket.data`. Distinguishes `TOKEN_EXPIRED`
    from `TOKEN_INVALID` in the error's `data.code`.
  - `realtime/gateway.ts` — wires auth + subscription handlers, joins
    tenant/user rooms on connect, and is the only place that constructs
    the `SocketIoPublisher` (`io.to(rooms).emit(...)`). Also where the
    Redis adapter gets attached if `REDIS_URL` is set.
  - `realtime/subscriptions.ts` — `realtime:subscribe`/`realtime:unsubscribe`
    handlers for entity rooms. Room names are always server-constructed
    with the token's `tenantId` prefix — the client picks the entity, never
    the tenant, so cross-tenant subscription isn't reachable even in
    principle.
  - `main.ts` — composition root. Note the `publisherBox` pattern: the
    HTTP server needs an `EventPublisher` at construction time, but the
    real publisher only exists after the Socket.IO gateway is created
    _from_ that same HTTP server. A mutable box breaks the circularity.
  - `logger.ts` — a tiny interface wrapping `console.*` as one-line JSON.
    Deliberately not pino/winston (per project decision) — swapping the
    implementation means editing this one file.

- **`packages/client-react`** — `RealtimeProvider` owns the socket
  lifecycle; `getToken` is re-invoked on every (re)connection attempt, so
  it must never be a fixed cached token. A single `socket.on("realtime:event")`
  feeds an internal `EventDispatcher` (`dispatcher.ts`) that fans out by
  `type` to whatever `useRealtimeEvent(type, handler)` calls are mounted —
  this is why there's one Socket.IO listener total, not one per
  notification type. `useEntitySubscription` re-subscribes whenever
  `status` transitions back to `"connected"`, because Socket.IO rooms
  don't survive a reconnect.

- **`apps/playground`** — not a package other code depends on; a
  throwaway-safe way to manually verify the pipeline. `vite.config.ts`
  registers a dev-only middleware at `/api/realtime/token` that mints a
  JWT locally (stand-in for the PHP endpoint). `scripts/emit.ts` is a CLI
  that HMAC-signs and POSTs an envelope like the PHP webhook would.

### Adding a new notification type

Preferred path: `/new-event` (`.claude/skills/new-event/`) interviews you
for the payload fields and audience rules, then generates the event file,
registry patch, a unit test, a sample envelope, PHP/React docs, and proves
delivery against the real server. See that skill's `SKILL.md` for details.

Manual steps, if you're not using the skill:

1. `packages/contracts/src/events/<name>.ts`: a Zod payload schema +
   `defineEvent({ type, v, payload })`.
2. Register it in `packages/contracts/src/events/index.ts` via
   `.register(...)`.
3. `pnpm build` (or run the contracts package in watch mode).

Nothing else changes — the ingest route validates against the registry
automatically (unknown type → `422`), and the frontend consumes it via
`useRealtimeEvent("your.type", handler)`.

### Testing conventions

- Unit tests live next to the file they test (`*.test.ts`).
- `apps/server/tests/integration.test.ts` boots the _real_ HTTP+Socket.IO
  server on an ephemeral port and drives it with a real `socket.io-client`
  — this is the test that actually proves the pipeline wiring, not just
  isolated units. Prefer extending it over adding another layer of mocks
  when changing cross-cutting behavior (auth, room routing, HMAC).
- `exactOptionalPropertyTypes` is on in `tsconfig.base.json`: don't assign
  `undefined` to an optional field directly (`{ redisUrl: maybeUndefined }`
  fails to typecheck) — spread it in conditionally instead
  (`...(x !== undefined ? { redisUrl: x } : {})`), as done in
  `apps/server/src/main.ts` and `http/ingest-route.ts`.

### Docker

The `Dockerfile` deliberately avoids `pnpm deploy` — the `--legacy` mode
symlinks to absolute host paths that don't survive a `COPY --from=build`
between stages, and the "injected" mode's config didn't take effect in
testing. Instead it builds with devDependencies, then in a fresh stage
deletes `node_modules` everywhere and reinstalls `--prod`, then copies the
resulting tree preserving relative structure — pnpm's workspace symlinks
(e.g. `apps/server/node_modules/@realtime-events/contracts -> ../../../../packages/contracts`)
are relative, so they stay valid as long as the directory layout around
them is copied too. If you touch the Dockerfile, keep that constraint in
mind.
