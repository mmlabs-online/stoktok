## Attempt 1 — 2026-11-11

Everything is uncommitted in the working tree (the orchestrator commits). The groups below are listed so the diff can be split into the G0–G9 commits if wanted. G0 touches only `packages/db/src/pg/access.ts`, `packages/db/src/pg/access.test.ts` and `packages/db/src/r3-guard.test.ts`; the Vault allow-list path entries and the later guard rules in `r3-guard.test.ts` belong to G5/G8 and would need `git add -p` to separate.

### Files touched

**G0 — hardening**
| File | Required because |
|---|---|
| `packages/db/src/pg/access.ts` | `Escaping` widened (`QueryCreator`, `TransactionBuilder`, `ConnectionBuilder`, `DatabaseIntrospector`); `NoEscape<T>` also rejects `any` (`0 extends 1 & T`). The `any` branch broke no positive fixture, so it stayed. |
| `packages/db/src/pg/access.test.ts` | 5 new `@ts-expect-error` fixtures: `k.transaction()`, `k.connection()`, `k.with(...)`, `k.introspection`, `k as any` (with an eslint-disable for the deliberate `any`) |
| `packages/db/src/r3-guard.test.ts` | `KYSELY_CTOR_LOG` tail `(?<![.\w])['"]?log['"]?\s*[:(,}]`; 3 must-match and 1 must-not-match self-tests |

**G1 — helpers**
| File | Required because |
|---|---|
| `packages/db/src/errors.ts`, `errors.test.ts` | `found()` and its test |
| `packages/db/src/pg/config.ts` | `PG_FANOUT_CONCURRENCY = 2` |
| `packages/db/src/pg/fanout.ts`, `fanout.test.ts` | new `mapLimit` and unit tests |
| `packages/db/src/pg/upsert.ts`, `upsert.test.ts` | `pickRows`, `chunkRows`, `upsertChunked` and unit tests |
| `packages/db/test-db/upsert.test.ts` | `upsertChunked` cases (one chunk; failing later chunk rolls back) |

**G2 — ledger repos**
| File | Required because |
|---|---|
| `packages/db/src/repos/transactions.ts`, `corporate-actions.ts`, `settings.ts` | Kysely port. `corporate-actions.ts` has a small `writable()` helper because `corporateActionToRow` types `amount_per_share` as `Int8` (incl. `bigint`) and the table type takes `number \| string`; it uses `toSafeInt`. |
| `packages/db/src/ledger.ts`, `holdings.ts` | `PgDb` type switch |
| `packages/db/test-db/transactions.test.ts`, `corporate-actions.test.ts`, `settings.test.ts`, `ledger-holdings.test.ts` | new behaviour tests |
| deleted: `src/repos/transactions.test.ts`, `corporate-actions.test.ts`, `settings.test.ts`, `src/ledger.test.ts`, `src/holdings.test.ts` | cases moved to test-db |

**G3 — market data**
| File | Required because |
|---|---|
| `packages/db/src/repos/prices-daily.ts`, `prices-intraday.ts`, `financials.ts`, `financial-lines.ts`, `symbols.ts`, `data-gaps.ts`, `news.ts`, `signals.ts` | Kysely port. `financial_lines` conflict key is the table's real primary key `(symbol, period_kind, period, line)` (4 columns, no `statement`), as the plan's test name says; I did not use a 5-column key. |
| `packages/db/test-db/prices-daily.test.ts`, `prices-intraday.test.ts`, `financials.test.ts`, `symbols.test.ts`, `data-gaps.test.ts`, `news.test.ts`, `signals.test.ts` | new behaviour tests |
| `src/repos/prices-daily.test.ts`, `prices-intraday.test.ts`, `financials.test.ts`, `financial-lines.test.ts`, `symbols.test.ts`, `data-gaps.test.ts`, `news.test.ts`, `signals.test.ts` | **Reduced** to no-query cases with `const noDb = {} as PgDb` (empty-input early returns) |

**G4 — assets, watchlist, lottery**
| File | Required because |
|---|---|
| `packages/db/src/repos/assets.ts`, `watchlist.ts`, `lottery.ts` | Kysely port. `assets.ts` has the same `writable()` helper (`assetToRow` types `value` as `Int8`). Lottery: `input()` validation runs before `q()`; `lines` is written with `jsonb()`; `upsertLotteryDraws` uses `pickRows` + `upsertChunked`. |
| `packages/db/test-db/assets-watchlist.test.ts`, `lottery.test.ts` | new behaviour tests |
| `src/repos/assets-watchlist.test.ts` | **Reduced** to the pure `assetFromRow` invalid-type test |
| `src/repos/lottery.test.ts` | **Reduced**: pure mapper tests stay (draw id, `lotteryDrawFromRow`, `lotteryTicketFromRow`) plus "invalid draw id is VALIDATION before any query" with `noDb` |

**G5 — AI**
| File | Required because |
|---|---|
| `packages/db/src/repos/ai-usage.ts`, `ai-summaries.ts`, `ai-keys.ts` | raw `sql` for `ai_reserve`, `ai_month_spend`, `ai_key_*` (explicit casts and named columns, key only as a bound parameter, `AI_KEY_MAP` for 22023 → VALIDATION); `fail()` deleted; `settleAiUsage` uses `updateTable … where status = 'reserved' returning id` |
| `packages/db/test-db/ai-usage.test.ts`, `ai-summaries.test.ts`, `ai-keys.test.ts` | new tests incl. the concurrency test (ai-keys tests carry `// remove in STK-082`) |
| `src/repos/ai-keys.test.ts` | **Reduced** to unknown-provider and bad-format with `noDb` |
| deleted: `src/repos/ai-usage.test.ts`, `ai-summaries.test.ts` | moved to test-db |

**G6 — finish packages/db**
| File | Required because |
|---|---|
| `packages/db/src/index.ts` | `createServiceClient` dropped; `export type Db = PgDb` |
| `packages/db/src/errors.ts`, `errors.test.ts` | `unwrap`, `unwrapFound`, `fetchAll`, `PgResult` and their tests deleted |
| `packages/db/src/pg/index.ts` | stale header comment |
| `packages/db/package.json` | `@supabase/supabase-js` removed |
| `packages/db/test-db/repos-ended-handle.test.ts` | new dynamic check, plus a test that the call table covers every index export |
| deleted: `src/client.ts`, `src/client.test.ts`, `test/fake-client.ts` (empty `test/` dir removed) | ticket |
| `pnpm-lock.yaml` | `pnpm install` result |

**G7 — apps**
| File | Required because |
|---|---|
| `apps/web/server/db.ts` | lazy, `globalThis[Symbol.for('stoktok.db')]` cache, `createPgDb(process.env, 'web')` from `@stoktok/db/pg` |
| `apps/web/server/db.test.ts` | new (lazy, cache, cache across `vi.resetModules()`) |
| `apps/web/server/ai.test.ts`, `ai-keys.test.ts` | rewritten with `vi.mock('./db', …)` of the repo functions (`importOriginal` for the real `DataError`) |
| `apps/worker/src/cli.ts`, `cli.test.ts` | `main(argv, openDb)` exported; handle opened after `parseArgs` inside `try`; `finally { await db?.end().catch(() => undefined) }`; 5 lifecycle tests |
| `apps/worker/src/ai.ts`, `ai.test.ts` | `db` required, no fallback; test mocks `@stoktok/db` |
| `apps/worker/src/store.ts`, `store.test.ts`, `config.ts`, `config.test.ts` | `pageSize`/`gapsPageSize` removed |

**G8 — bundling, guards, scripts**
| File | Required because |
|---|---|
| `apps/web/package.json`, `apps/web/next.config.ts` | `pg` dep; `serverExternalPackages` adds `pg` |
| `apps/worker/package.json`, `apps/worker/tsup.config.ts` | `@supabase/supabase-js` out; `kysely` and `pg` in (same ranges as `packages/db`); `external: ['pg','pg-native','kysely']` |
| `scripts/check-image.sh` | worker resolve probe and no-hang smoke; web smoke uses `STOKTOK_DATABASE_URL` and probes exactly one `pg-<hex>` alias |
| `scripts/check-no-service-key-in-client.sh` | `SUPABASE_*` build vars, `SENTINEL` and its needle removed |
| `packages/db/src/r3-guard.test.ts` | `@supabase/` import rule, package.json rule, `SUPABASE_SERVICE_ROLE_KEY` appears nowhere, `createPgDb(` allow-list (+2 files), pg/kysely range equality, Vault allow-list path entries for `packages/db/test-db/ai-keys.test.ts` (both lists) |
| `pnpm-lock.yaml` | `pnpm install` result |

**G9 — docs**
| File | Required because |
|---|---|
| `.env.example`, `docs/deploy.md` | `STOKTOK_DATABASE_URL` (table row `reserved`); `SUPABASE_*` kept under a "Legacy" comment |
| `CLAUDE.md` | R3 row text only |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | decision 1 wording, new decision 14, consequences |

### Tests added / changed
- G0: `pg/access.test.ts` typeFixtures (5); `r3-guard.test.ts › S5 regexes catch their fixtures` (extended).
- G1: `errors.test.ts › found …`; `pg/fanout.test.ts` (4); `pg/upsert.test.ts › pickRows`, `› chunkRows`; `test-db/upsert.test.ts › upsertChunked` (2).
- G2: test-db `transactions` (8), `corporate-actions` (4), `settings` (6), `ledger-holdings` (6).
- G3: test-db `prices-daily` (8), `prices-intraday` (1), `financials` (2), `symbols` (6), `data-gaps` (8), `news` (5), `signals` (3). The plan's "12 symbols on the worker profile, `stats().total <= 2`" case is in `prices-daily`.
- G4: test-db `assets-watchlist` (5), `lottery` (7).
- G5: test-db `ai-usage` (6, incl. `ai_reserve concurrency`), `ai-summaries` (2), `ai-keys` (3, incl. ended handle).
- G6: `test-db/repos-ended-handle.test.ts` (2).
- G7: `apps/web/server/db.test.ts` (3); web `ai.test.ts`, `ai-keys.test.ts` rewritten; worker `cli.test.ts` (5 lifecycle), `ai.test.ts` (3), `store.test.ts` updated, `config.test.ts` one test deleted.
- G8: `r3-guard.test.ts` (4 new tests + regex self-tests).
- Kept / reduced unit files (no-query cases): `prices-daily`, `prices-intraday`, `financials`, `financial-lines`, `symbols`, `data-gaps`, `news`, `signals`, `assets-watchlist`, `lottery`, `ai-keys` under `packages/db/src/repos/`. Deleted: `transactions`, `corporate-actions`, `settings`, `ai-usage`, `ai-summaries` (repo tests), `ledger`, `holdings`, `client`.

### `ai_reserve` concurrency mutation proof
Procedure (plan §6): removed the `pg_advisory_xact_lock` line from `supabase/migrations/20261110000100_ai_reserve_harden.sql`, ran `pnpm test:db -t "ai_reserve concurrency"`, then `git checkout` of the file (confirmed identical to the original; never committed).
- Without the lock: `× ai_reserve concurrency … AssertionError: expected [ { usageId: 1, … }, … ] to have a length of 3 but got 5` (5 of 12 reservations granted under a cap that allows 3).
- With the lock restored: the same test passes (3 rounds, exactly 3 granted seeing {0,100,200}, 9 refused seeing 300, 12 unique ids, month spend 300).

### Per-group gates
G0/G1: whole workspace green. G2–G6: `packages/db` only (`typecheck`, `lint`, `test`, `test:db`) — green at each stage; the apps typecheck from G7 on (all green at the end, see below). I worked in one tree and ran the group gates as I went, not as separate commits.

### Checks (actual output summary; final run after all groups)
- typecheck: exit 0 (core, ai, db, sources, web `next typegen && tsc`, worker).
- lint: exit 0.
- test: core 834, sources 35 (1 file skipped, as before), ai 184, db 88, worker 299 (1 file skipped, as before), web 352 — all pass.
- build: exit 0 (web Next build and worker tsup).
- test:db: `Test Files 22 passed (22)`, `Tests 109 passed (109)`, against a local Postgres 16 on TCP (`127.0.0.1:54329`, started with `initdb`/`pg_ctl` the way `db-check.sh` does but with `listen_addresses=127.0.0.1`, since Docker is unavailable and `DB_TEST_URL` needs TCP). Baseline before my changes was 5 files / 24 tests.
- db:check: `db:check OK` (run via `DB_CHECK_URL` on a fresh database of the same server; a second run on an already-migrated database fails, which is a property of `DB_CHECK_URL` mode, not a regression).
- check:service-key: `OK: no secret or AI SDK material in client bundle`.
- check:deploy-env: `OK: deploy env lists consistent`.
- Bundling evidence after `pnpm build`:
  - `ls apps/web/.next/node_modules` → `@anthropic-ai`, `@google`, `pg-ad45e98bb7b7a165` (exactly one `pg-<hex>` entry, so the probe regex `/^pg-[0-9a-f]+$/` fits; A8 confirmed).
  - `grep -c 'from "pg"\|from "kysely"' apps/worker/dist/cli.js` → 6 (imported, not inlined).
  - `grep -c "@stoktok/db" apps/worker/dist/cli.js` → 0. tsup `noExternal: ['@stoktok/db']` already inlines the `/pg` subpath, so no `noExternal` change was needed (A2 confirmed).
- Local equivalent of the image no-hang smoke (`node apps/worker/dist/cli.js signals` with `STOKTOK_DATABASE_URL=postgres://smoke:smoke-pw@127.0.0.1:9/smoke`, under `timeout 20`): exit 1, stderr is only `settings.get: database error`, 0 matches for `smoke-pw` or `127.0.0.1`.
- Not run (need Docker, unavailable): `scripts/check-image.sh web|worker` (the new `pg`/`kysely` resolve probe, the web `pg-<hex>` alias probe inside the image, and the Docker no-hang smoke). I checked the script with `bash -n` and the alias shape and worker exit behaviour with the local commands above; the CI image job is the first real run of the new probes. The worker image installs via `pnpm deploy --prod`, so `pg` and `kysely` come from the worker's `package.json`.
- `git diff --stat` touches nothing under `.github/workflows/`, `deploy/`, `apps/*/Dockerfile` or `supabase/`.

### Out-of-plan files
None. (The plan says "`pg/client.ts`, `pg/schema.ts` unless typecheck shows a mismatch": no mismatch appeared; both are untouched.)

### Deviations from the plan
1. **One working tree, no per-group commits** (the orchestrator commits, per the task).
2. **`financial_lines` conflict key** is the table's 4-column primary key, not 5 (see G3).
3. **Ended-handle tests need a warm-up query.** Kysely's `destroy()` is a no-op on a handle that never ran a query, and a later query then works. `repos-ended-handle.test.ts` and `ai-keys.test.ts` run one query before `end()`. This is a property of the STK-081 handle, not changed here.
4. **`settings.updated_at`** is documented as unchanged on save, as planned (follow-up kept).
5. `corporate-actions.ts` and `assets.ts` carry a 3-line `writable()` helper (reason in the table); `schema.ts` was not touched.
6. The grep `\bunwrap\b` from AC3 still matches a private `unwrap` method in `apps/worker/src/sources/vci-iq-financials.ts` (an unrelated JSON-envelope helper). It is not the deleted db helper; nothing from `@stoktok/db` is named `unwrap`.
7. `saveSettings` with a null fee still writes the row and then throws `NOT_CONFIGURED` (existing behaviour, preserved); tests seed a null-fee row with `.catch(() => undefined)`.

### Follow-ups (noticed, not done)
- Plan follow-ups stand: collapse per-symbol fan-outs into one query; remove `linesSymbolChunk`, `financialsSymbolChunk`, `resolveChunkSize`, the worker symbol-chunk loops and the "PostgREST row cap" comments (`store.ts`, `config.ts`); `settings.updated_at` never advances on save; STK-084 drops the legacy `SUPABASE_*` env lines/rows and sets `STOKTOK_DATABASE_URL` to "required now"; STK-082 removes the ai-keys test:db cases and their Vault allow-list paths.
- `MAPPING` cases that used to be driven by fake rows (for example an invalid stored exchange, an unknown provider row from `ai_key_secrets`) are not reproduced in test-db because table checks prevent such rows; the pure mappers are still covered.
- `db:check` with `DB_CHECK_URL` is not re-runnable on an already-migrated database (pre-existing).

### Scope self-check
- Could the diff be smaller? Not materially: about 70 % of it is the 17-repo port and its moved tests. The deletions (fake-client tests, `client.ts`, `unwrap`/`fetchAll`) are required by the ticket.
- Diff size: 84 files, +2664 / -1918 lines (including the new untracked files counted via `git add -N`).

## Attempt 2 — 2026-11-11 (REWORK; Ming accepted single commit `ba3dc6c`, no history rewrite, no git used)

### Files touched
- `apps/worker/README.md`: env line now says `STOKTOK_DATABASE_URL`, server-only, no service-role key. Required because review/security flagged the stale instruction.
- `apps/web/test/healthz.test.ts`: dropped the stale `SUPABASE_URL` stub; the case is now "answers with no env set". (First tried stubbing `STOKTOK_DATABASE_URL`, but the R3 guard rightly forbids naming it outside `pg/client.ts`.)
- `.env.example`: example URL comment now `postgres://stoktok:<password>@localhost:5432/stoktok`. No values added.
- `scripts/check-image.sh`: worker no-hang smoke captures stdout and stderr (`> "$err" 2>&1`) so the leak grep sees both; `DATABASE_URL` added to the secret-name regex.

### Tests added
None (no logic change).

### Checks
- `bash -n scripts/check-image.sh`: ok
- typecheck, lint: exit 0
- test: core 834, sources 35, ai 184, db 88, worker 299, web 352, all passed
- build: exit 0
- db:check: `db:check OK`
- check:service-key: `OK: no secret or AI SDK material in client bundle`
- check:deploy-env: `OK: deploy env lists consistent`
- test:db not run: nothing under `packages/db` changed.
- No root `format:check` script exists; the one edited TS file was run through oxfmt.

### Out-of-plan files
None beyond the files Ming's note names.

### Follow-ups / not done
- Review nits left unchanged as unreachable or design-only: `writable()` `toSafeInt` outside `q()` (assets, corporate-actions), `getAiMonthSpend` NULL mapping, `INSERT_CHUNK_SIZE` constant, `ai-keys.test.ts` format-rejection test name.
- Security suggestion (blackholed-host smoke) not done.

### Scope self-check
Only the items in Ming's note changed. Nothing committed.
