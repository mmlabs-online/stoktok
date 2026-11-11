## Attempt 1 — 2026-11-11 (slice a: driver foundation)

### Files touched
| File | Required because |
|---|---|
| `packages/db/package.json` | deps `pg`, `kysely`, devDep `@types/pg`, `test:db` script, `./pg` subpath export (AC1, AC11) |
| `pnpm-lock.yaml` | new deps |
| `packages/db/src/pg/{index,config,types,client,schema,upsert}.ts` | the foundation (AC1-AC10) |
| `packages/db/src/errors.ts` | `toDataError`, `run` (AC6); `unwrap`, `unwrapFound`, `fetchAll` untouched |
| `packages/db/src/pg/{types,client,upsert}.test.ts`, `packages/db/src/errors.test.ts`, `packages/db/src/r3-guard.test.ts` | unit tests and R3 rules |
| `packages/db/vitest.db.config.ts`, `packages/db/test-db/{global-setup,harness}.ts` | real-PG harness (AC11) |
| `packages/db/test-db/{types,session,errors,upsert}.test.ts` | real-PG tests |
| `packages/db/tsconfig.json` | include `test-db`, `vitest.db.config.ts` |
| `package.json` (root) | `test:db` script |
| `.github/workflows/ci.yml` | `pnpm test:db` step with `DB_TEST_URL` (after `pnpm test`, before `check:service-key` and `db:check`) |
| `scripts/check-no-service-key-in-client.sh` | sentinel DB URL in build env, new needles |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | ADR |

### Tests added / changed
- `src/pg/types.test.ts`: timestamptz normalisation (4 cases), `parseArray`, parsers (DATE, DATE[], timestamptz, int8 not overridden)
- `src/pg/client.test.ts`: missing/empty URL, non-postgres schemes, constructing does not connect (pool `totalCount` 0), profile values and overrides reach the `pg.Pool` config
- `src/pg/upsert.test.ts`: do update set, ignoreDuplicates, only-conflict-cols, key-set uniformity, conflict col missing, `chunkForParams`
- `src/errors.test.ts`: 5 `toDataError` / `run` cases
- `src/r3-guard.test.ts`: `STOKTOK_DATABASE_URL` location, driver imports only under `packages/db/`, regex self-test
- `test-db/types.test.ts`: round-trip, handled-type set, global `pg.types` untouched
- `test-db/session.test.ts`: session settings on 2 concurrent connections, `end()`
- `test-db/errors.test.ts`: CONFLICT, VALIDATION, unreachable server
- `test-db/upsert.test.ts`: partial, full, ignoreDuplicates, in-batch duplicate (21000), jsonb, chunked

### Checks (actual output summary)
Local PG 16.x started with `initdb`/`pg_ctl` (no Docker), `DB_TEST_URL=postgresql://postgres@127.0.0.1:54329/postgres`.
- typecheck: `pnpm typecheck` no errors, all packages
- lint: `pnpm lint` no errors or warnings
- test: `pnpm test` green (core 834, sources 35, ai 184, db 219 passed + 1 todo)
- test:db: 4 files, 14 tests passed. Without `DB_TEST_URL` it exits 1 with the "needs DB_TEST_URL" message; with host `example.com` it exits 1 with the refusal message. No `stoktok_test_*` databases are left after a run.
- db:check: `db:check OK`
- build: `pnpm build` ok
- check:service-key: OK, the new needles (`STOKTOK_DATABASE_URL`, `postgres://`, `postgresql://`, `pg-protocol`) show 0 hits
- `grep -rn "@stoktok/db/pg" apps`: no matches

### Out-of-plan files
None.

### Deviations and notes
- `end()` test checks that later queries reject; it does not assert pool `totalCount` 0 because the Kysely `PgDb` handle does not expose the pool.
- Vitest 5 hides the message of an error thrown from `globalSetup` (stack-map crash), so `global-setup.ts` prints the DB_TEST_URL message and calls `process.exit(1)` for the missing and non-local cases.
- Test workers are separate processes, so `global-setup.ts` hands the run suffix to them via `process.env.DB_TEST_SUFFIX`.
- A2: no `pg-types` import; a small local array parser (`parseArray`) is used and tested.
- A1: `test:db` and `db:check` are not run against one shared server here (each used its own); CI order is as planned. `bootstrap-roles.sql` is idempotent, so I expect no conflict, but this is untested on one CI server.

### Follow-ups (noticed, not done)
- `pool.on('connect')` swallows a failed `set_config` silently; consider failing the connection in STK-081.
- `Int8Gen` in schema.ts is only used for `ai_summaries.usage_id`; STK-081 can tidy the column types as repos are ported.

### Scope self-check
- Could the diff be smaller? No; the file list is the plan's.
- Diff size: about +1,000 lines including tests, schema types, ADR and lockfile (the lockfile is the largest part).

## Attempt 2 — 2026-11-11 (REWORK: fixes from security-review.md S1-S9 and the review.md nits; not committed)

### Files touched
| File | Required because |
|---|---|
| `packages/db/test-db/global-setup.ts` | S1: exported `checkAdminUrl` rejects `host`/`hostaddr`/`port` query params; S9: LIKE escaped (`stoktok\_test\_%\_<pid>`), template dropped and run exits 1 if bootstrap/migration fails |
| `packages/db/src/test-db-guard.test.ts` (new) | S1 unit test (`?host=`, `?hostaddr=`, `?port=`, non-local, missing) |
| `packages/db/src/pg/client.ts` | S2: failed session init logs `{event:'db_session_init_failed', code}` and ends the client (pg-pool removes an ended client on release); S5: uses shared `sqlstateOf` |
| `packages/db/src/pg/client.test.ts` | S2 test: code-only log, no host or message leak, client ended |
| `packages/db/src/errors.ts` | S5: new `sqlstateOf` maps only real SQLSTATEs (Node errno such as EPIPE/EPERM are not mapped); `toDataError` uses it |
| `packages/db/src/errors.test.ts` | S5 test |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | S3: TLS sentence (`sslmode=verify-full` off the Docker network, STK-081 must enforce) |
| `packages/db/src/r3-guard.test.ts` | S7a: `NEXT_PUBLIC_` rule widened (DATABASE, DB_, PASSWORD, SECRET); S7c: apps/web importer rule also covers `@stoktok/db/pg`; self-test of both regexes |
| `scripts/check-no-service-key-in-client.sh` | S8: needles `kysely`, `pg-pool`, `pg-connection-string`, `db.invalid` |
| `packages/db/src/pg/upsert.ts`, `upsert.test.ts` | S4: column names must match `/^[a-z_][a-z0-9_]*$/` else plain Error; nit: `jsonb(undefined)` throws |
| `packages/db/src/pg/schema.ts` | nit: `ai_summaries.usage_id` is `Int8 | null`; `Int8Gen` removed |

### Tests added / changed
- `test-db-guard.test.ts` (3), `client.test.ts` (+1, session init failure), `errors.test.ts` (+1), `upsert.test.ts` (+2), `r3-guard.test.ts` (+1).

### Checks (actual output summary)
Local PG 16 via `initdb`/`pg_ctl` on port 54329, `DB_TEST_URL=postgresql://postgres@127.0.0.1:54329/postgres`.
- typecheck: all packages Done, no errors
- lint: all packages Done, no errors
- test: green (worker 295, web 349, db/core/sources/ai suites pass)
- test:db: 4 files, 14 tests passed; with `?host=x` it exits 1 with "refuses DB_TEST_URL with a 'host' query parameter"; no `stoktok_test_*` databases left
- db:check: `db:check OK`
- check:service-key: OK, all 13 needles (including the 4 new) show 0 hits

### Out-of-plan files
None. (`test-db-guard.test.ts` is a new test file inside `packages/db`, needed for S1; it lives under `src/` so the default `pnpm test` runs it without a database.)

### Deviations and notes
- S2 fail-closed relies on `client.end()` running in the rejection handler before the next queued query is sent. pg sends the next query only after the failed one's ReadyForQuery, so the handler normally runs first; pg-pool then discards the ended client on release. Not proven by a real-PG test (a forced failure needs a server-side fault); covered by the unit test with a fake client.
- S5: `sqlstateOf` rejects `^E[A-Z]+$`; no PostgreSQL SQLSTATE class starts with `E`. `instanceof pg.DatabaseError` was avoided because `errors.ts` is shared with the supabase-js path and must not import `pg`.
- S7b (`.cjs/.mts/.cts` in `walk`) not requested; not done.

### Follow-ups (noticed, not done)
- STK-081: enforce the `sslmode` rule from ADR 0010 (`createPgDb` or `check-deploy-env.sh`); enforce that repo `kysely` calls go through `run()` (S5 caveat); optional `lock_timeout` / `idle_in_transaction_session_timeout` in session init (S10); optional `new URL()` check in `createPgDb` (S6).

### Scope self-check
- Only the requested items were changed; no commit made.
