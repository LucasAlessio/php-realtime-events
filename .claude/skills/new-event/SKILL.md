---
name: new-event
description: Scaffold a new realtime notification type end-to-end — interviews the developer for the payload shape and audience rules, then generates the contracts event file, registry patch, unit test, sample envelope, PHP/React docs, and proves delivery against the real server. Use when asked to add/create a new event, notification type, or webhook payload type in this project.
---

Guided scaffolding for a new notification `type` in this project's
`EventRegistry` (see `packages/contracts/src/events/` and
`CLAUDE.md`'s "Adding a new notification type"). You interview the user for
the payload and audience, hand a spec to
`.claude/skills/new-event/driver.mjs`, and it generates every derived
artifact and proves delivery end-to-end. All paths below are relative to the
repo root.

## 1. Interview the user

Ask (via `AskUserQuestion` or plain conversation — whatever fits) until you
can write the spec below. Don't skip straight to guessing field types.

- **`type`** — dotted, lowercase, `dominio.acao` (e.g. `invoice.paid`). Must
  not already exist in `packages/contracts/src/events/index.ts`.
- **`v`** — defaults to `1`. Only bump for an existing type when the payload
  shape changes incompatibly.
- **`description`** — one sentence, in Portuguese (matches every existing
  comment and doc in this repo), on when the event fires.
- **Payload fields** — for each: `name`, a **raw Zod expression** (you write
  it, e.g. `z.number().int().positive()` or
  `z.union([z.string(), z.number()])` — this is Zod **v3**, not v4:
  `z.string().uuid()` / `z.string().datetime()` are v3 idioms), whether it's
  optional, a concrete sample value, and a short doc string.
- **Audience** — always ask `tenantId`. Then ask whether delivery narrows to
  specific `userIds`, to subscribers of an `entity` (type + which field
  holds its id), both, or neither.
  **Repeat this rule to the user explicitly**: `userIds` and `entity` are
  _additive_ and _narrow_ the audience — the tenant-wide broadcast room is
  only used when **neither** is present. `entity` alone does **not**
  broadcast to the whole tenant (`apps/server/src/core/resolve-rooms.ts`).
  Get this wrong and the scaffold will be correct but the user's mental
  model won't be.
- Tell the user: `payload` is **not** audience-filtered by the client — it
  reaches every browser in the target rooms, unlike `audience` which the
  server strips before publishing. Don't put anything in the payload a
  recipient in those rooms shouldn't see.

Then write the spec as JSON, e.g.:

```json
{
  "type": "invoice.paid",
  "v": 1,
  "description": "Emitido quando o parceiro confirma o pagamento de uma fatura.",
  "fields": [
    {
      "name": "invoiceId",
      "zod": "z.union([z.string(), z.number()])",
      "optional": false,
      "sample": 4711,
      "doc": "Id da fatura no ERP"
    },
    {
      "name": "amountCents",
      "zod": "z.number().int().positive()",
      "optional": false,
      "sample": 12900,
      "doc": "Valor pago, em centavos"
    },
    {
      "name": "paidAt",
      "zod": "z.string().datetime()",
      "optional": true,
      "sample": "2026-08-12T21:49:00Z",
      "doc": "Quando o pagamento foi confirmado"
    }
  ],
  "audience": {
    "tenantId": "7",
    "userIds": ["12"],
    "entity": { "type": "invoice", "idFrom": "invoiceId" }
  }
}
```

`audience.userIds` and `audience.entity` are both optional — omit either or
both. `entity.idFrom` must name one of `fields`.

## 2. Run the driver — scaffold

```bash
node .claude/skills/new-event/driver.mjs scaffold --spec <path-to-spec.json|->
```

(`-` reads the spec from stdin — pipe it directly instead of writing a temp
file if that's more convenient.)

This generates, all commented in Portuguese to match the codebase:

| File                                            | What                                                                                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/events/<kebab>.ts`      | `<camel>PayloadSchema`, `export type <Pascal>Payload`, `<camel>Event = defineEvent(...)`                                                                    |
| `packages/contracts/src/events/<kebab>.test.ts` | valid sample parses; an invalid payload is rejected; type is registered                                                                                     |
| `.claude/skills/new-event/samples/<kebab>.json` | a complete, valid envelope — used by `verify` and as the exact reference for the PHP side                                                                   |
| `docs/events/<kebab>.md`                        | payload field table, the resulting room names, the sample envelope, a ready PHP `curl`+HMAC snippet, and a `useRealtimeEvent<Pascal Payload>` React snippet |
| `packages/contracts/src/events/index.ts`        | patched in place: import + `.register(...)` + `export *`, re-sorted alphabetically and reformatted with `eslint --fix`                                      |

If the type is already registered, `scaffold` fails loudly and writes
nothing.

## 3. Verify delivery end-to-end

```bash
pnpm --filter @realtime-events/contracts run build   # server consumes dist/, not src/
node .claude/skills/new-event/driver.mjs verify --type <type>
```

`verify` runs `apps/server/scripts/verify-event.mts` (via the `tsx` binary
that lives in `apps/server/node_modules/.bin/` — there's no `tsx` at the
repo root, so don't try `pnpm exec tsx` from root). It boots the real
HTTP+Socket.IO server on an ephemeral port (same pattern as
`apps/server/tests/integration.test.ts`), signs a JWT for a user in the
sample's tenant, connects a real `socket.io-client`, subscribes to the
sample's entity room if present, POSTs the HMAC-signed sample envelope to
`/internal/emit`, and asserts the event arrives on `realtime:event` **and**
that `audience` was stripped. Exit code reflects pass/fail; sample output:

```
✓ conectado como tenant=7 user=12 (porta 50497)
✓ assinado em entity=invoice:4711
→ POST /internal/emit → 202 {"accepted":1}
✓ evento recebido pelo cliente: {"id":"...","type":"invoice.paid",...}

OK — "invoice.paid" entregue ponta a ponta.
```

Also run the normal gates before handing off — the generated test file
participates in these like any other:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

To manually poke it against a running `pnpm dev` server (e.g. from the
playground UI), the generalized `pnpm emit` now accepts a full sample file:

```bash
pnpm emit --file .claude/skills/new-event/samples/<kebab>.json
```

(`pnpm emit --type <type> --payload '<json>' --entityType <t> --entityId <id>`
also works for one-off payloads without a sample file. The original
`pnpm emit --type order.updated --orderId 123` form is untouched.)

## 4. Undo, if needed

```bash
node .claude/skills/new-event/driver.mjs remove --type <type>
```

Deletes the event/test/sample/doc files and reverts the `index.ts` patch
(re-derived from the remaining registered events, not a diff-revert — so it
also re-normalizes the file if it was hand-edited since). Use this to retry
after a bad spec, or if the user asks to discard the scaffold.

## What's left for the programmer

The scaffold produces a _type-checked, tested, delivery-proven_ event. It
deliberately does **not** touch:

- The PHP side that actually posts to `/internal/emit` — the generated doc
  has the exact envelope and a working `curl` snippet, but wiring the real
  trigger in PHP is out of scope here.
- Any UI beyond the one `useRealtimeEvent` call point printed in the doc —
  what the frontend _does_ with the event is product logic.
- Business rules a Zod schema can't express (cross-field invariants, DB
  lookups) — say so if the interview surfaces one; it belongs in application
  code, not the contract.

## Gotchas

- **Zod is v3, not v4** in this repo (`packages/contracts/package.json`
  pins `^3.24.1`). `.datetime()`, `.uuid()`, and `z.ZodIssue` are v3 names —
  don't write v4-only syntax into the `zod` field of a spec.
- **The server reads `dist/`, tests read `src/`.** `pnpm test` works without
  a contracts build (root `vitest.config.ts` aliases straight to `src/`),
  but `verify` (and `pnpm dev`) need
  `pnpm --filter @realtime-events/contracts run build` first — the driver's
  `scaffold` output already reminds you of this.
- **No `tsx` at the repo root.** `pnpm exec tsx ...` from root fails with
  `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`; only `apps/server/node_modules/.bin/tsx`
  and `apps/playground/node_modules/.bin/tsx` exist. `driver.mjs verify`
  already calls the right one.
- **`apps/server/scripts/` isn't in `apps/server/tsconfig.json`'s
  `include`.** That tsconfig has `rootDir: "src"` because it doubles as the
  build config (`tsc -p tsconfig.json` → `dist/`); adding `scripts` there
  would break the build. So `pnpm typecheck` does **not** typecheck
  `verify-event.mts` — its real proof is that `driver.mjs verify` actually
  runs it successfully, not a green typecheck.
- **`pnpm emit --file <path>` resolves `<path>` from the repo root, not the
  process cwd.** `pnpm --filter @realtime-events/playground run emit`
  changes cwd to `apps/playground` before the script runs, and `INIT_CWD`
  isn't set through the nested `pnpm --filter` invocation the root `emit`
  script uses — so `emit.ts` resolves `--file` against a `REPO_ROOT`
  computed from `import.meta.url` instead of trusting cwd.
- **The `.register()` chain stays multi-line** — `renderEventsIndex` always
  emits the multi-line form, and unlike Prettier, `@stylistic`/ESLint has no
  print-width-based reflow that would collapse it back onto one line
  regardless of how short it ends up being.
- **`entity` alone does not broadcast tenant-wide** — this is the bug the
  integration test was written to catch (`CLAUDE.md`); re-confirm the
  audience answer with the user if their expectation sounds like "everyone
  subscribed to this entity, plus... wait, does everyone in the tenant get
  it too?" — no, not unless `userIds`/`entity` are both absent.

## Troubleshooting

- **`error: já existe: packages/contracts/src/events/<kebab>.ts`** —
  `scaffold` refuses to overwrite; run `remove --type <type>` first if you
  want to regenerate from a corrected spec.
- **`error: sample não encontrado: ... (rode "scaffold" primeiro)`** from
  `verify` — the type was never scaffolded, or was already `remove`d.
- **`verify` fails with `esperava 202 do ingest, recebi 422`** — the sample
  envelope's `payload` doesn't match the registered schema. This usually
  means the spec's `sample` values don't actually satisfy the `zod`
  expression given for that field (e.g. a `sample: "abc"` against
  `z.number()`) — fix the spec and re-scaffold.
