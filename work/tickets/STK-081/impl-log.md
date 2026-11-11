## Attempt 1 — 2026-11-11 (slice b1: handle hardening)

### Files touched
| File | Required because |
|---|---|
| packages/db/src/pg/client.ts | Opaque frozen handle (`end`, `stats`, non-enumerable `Symbol.for` accessor), memoized `end()`, code-only `'error'` listener held during session setup (AC3, AC4) |
| packages/db/src/pg/access.ts (new) | `kyselyOf` and `q()` wrapping `run()` (AC5) |
| packages/db/src/pg/index.ts | Export `PgPoolStats` |
| packages/db/src/pg/schema.ts | jsonb columns take `RawBuilder` only |
| packages/db/src/errors.ts | `SqlstateMap` hook on `toDataError` / `run` |
| packages/db/src/errors.test.ts, src/pg/client.test.ts, src/pg/upsert.test.ts | Plan test list (R8) |
| packages/db/src/r3-guard.test.ts | `S5 data access` rules + regex self-tests; old "pg and kysely only under packages/db/" test replaced by the tightened rule |
| packages/db/test-db/pg-proxy.ts (new) | Deterministic TCP fault proxy (pass/terminate/drop/stall) |
| packages/db/test-db/session.test.ts | Ported to `kyselyOf`/`stats()`; end-twice, stats and three crash tests |
| packages/db/test-db/access.test.ts (new) | `q()` tests |
| packages/db/test-db/types.test.ts, errors.test.ts, upsert.test.ts | Mechanical `kyselyOf(...)` port; two `as never` casts on jsonb dropped |
| docs/adr/0010-self-hosted-postgres-data-layer.md | Decision 13 |

### Tests added / changed
- src/pg/client.test.ts › handle is opaque ...; stats() is zero before any query; end() twice resolves (never connected)
- src/pg/upsert.test.ts › jsonb columns reject raw objects at compile time (`@ts-expect-error`)
- src/errors.test.ts › run() map overrides the code ...; map returning undefined falls back
- test-db/session.test.ts › setup survives pg_terminate_backend / a socket drop / a stalled set_config; end() twice resolves ...; stats() reports total/idle/waiting; two existing tests ported
- test-db/access.test.ts › 5 q() cases (value, DataError no cause, 22023 map, tx rollback, non-handle)
- src/r3-guard.test.ts › 4 S5 rules + `S5 regexes catch their fixtures`

### Checks (actual output summary)
Local Postgres 16 started via initdb/pg_ctl on 127.0.0.1:54329 (trust auth, TCP needed by the proxy), `DB_TEST_URL=postgresql://postgres@127.0.0.1:54329/postgres`; stopped and removed afterwards.
- typecheck: pass (exit 0)
- lint: pass (exit 0)
- test: core 834, sources 35, ai 184, db 236 passed | 1 todo (25 files); all green
- test:db: 5 files, 24 tests passed
- db:check: `db:check OK`
- check:service-key: `OK: no secret or AI SDK material in client bundle`

Mutation proof (deleted `this.on('error', onErr)`, ran `pnpm test:db -t "setup survives"`): 2 failed, 1 passed.
- `drop`: FAIL, `uncaughtException` spy called with `Connection terminated unexpectedly`.
- `stall`: FAIL, same uncaught error (pg-pool's timeout destroys the stream mid-setup).
- `terminate`: PASSED without the listener. Per plan A3, no crash in this mode with pg 8.23 here (the 57P01 arrives as a query error during setup rather than an unhandled client 'error'). Kept as a regression test and for the literal AC3 wording.
Line restored afterwards; the full suite above ran with it restored.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- `terminate` mode does not fail without the listener; a variant that kills the backend after the first `ReadyForQuery` of an idle pooled client is not needed for this AC but would cover the idle path.
- `DRIVER_IMPORT` (kysely-inclusive) in r3-guard.test.ts is now used only by its own regex self-test; remove it with the next guard touch.

### Scope self-check
- Could the diff be smaller? No; every file is on the plan list.
- Diff size: ~+520 / -35 lines including 3 new files (not committed).
- No file under apps/, src/repos/, scripts/, .env.example or CLAUDE.md changed.

## Attempt 2 — 2026-11-11 (REWORK: fixes Ming asked for after review attempt 1 PASS)

### Files touched
| File | Required because |
|---|---|
| packages/db/src/pg/access.ts | `q()` callback result type is `Promise<T extends Compilable<unknown> \| Kysely<Database> ? never : T>` (distributive, so unions are caught; `Transaction` extends `Kysely`); the body casts back to `Promise<T>` |
| packages/db/src/pg/access.test.ts (new) | Compile-time fixtures: positive (row array, `number \| null`, `sql` result rows) and `@ts-expect-error` for a builder, `Kysely`, `Transaction`, and `Kysely \| null`. Covered by `pnpm typecheck` (src is in tsconfig include) |
| packages/db/src/r3-guard.test.ts | `log:` guard now spans nested config (`[\s\S]*?`, also catches `log(e) {}` shorthand, not `console.log(`); accessor rule adds `getOwnPropertySymbols` and `Reflect.ownKeys`; kysely rule catches `export * / export {…} / export * as x from 'kysely'` (only `sql` and type-only re-exports pass); self-tests for all; unused `DRIVER_IMPORT` and its self-test removed |

### Tests added
- src/pg/access.test.ts: type fixtures (4 `@ts-expect-error`, 3 positive); typecheck fails if any directive becomes unused.
- r3-guard `S5 regexes catch their fixtures`: nested `log:` (single and multi-line, shorthand), re-export positives/negatives, the two new accessor names.

### Checks (actual output summary)
Local Postgres (initdb as `postgres` user, TCP 127.0.0.1:54329), `DB_TEST_URL` set; stopped and removed afterwards.
- typecheck: pass (no errors in any package)
- lint: pass
- test: core 834, sources 35, ai 184, db 236 passed | 1 todo, worker 295, web 349; all green
- test:db: 5 files, 24 tests passed
- db:check: `db:check OK`
- check:service-key: `OK: no secret or AI SDK material in client bundle`

### Out-of-plan files
None.

### Follow-ups
- The repo has no `format` script or oxfmt config; I did not run a formatter (an ad hoc oxfmt run with defaults rewrote quotes, so I reverted it and re-applied the edits by hand in the existing style).
- The `log:` regex scans from `new Kysely(` to the end of the file, so a later unrelated `log:` in the same file would be a false positive. None exists today; the rule is limited to files that contain `new Kysely`.

### Scope self-check
- Only the five listed items; no commit made.
