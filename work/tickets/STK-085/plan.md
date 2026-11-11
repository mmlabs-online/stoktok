Status: READY

# Plan — STK-085: Data layer on pg + Kysely: port the 17 repos, callers, bundling and guards (STK-080 slice b2)

**Size and shape.** This ticket is well over the ~400-line guide. Estimate:
- about 900 production and config lines changed: the 17 repos, ledger/holdings, helpers, apps, scripts and docs;
- about 1,600 test lines added, mostly new `test-db/` files;
- about 2,000 lines deleted (fake-client tests, `client.ts`, `unwrap`/`fetchAll`).

I still plan it as **one implement/review cycle**, for four reasons:
- The architect's constraint holds: repos, callers and bundling must switch together, or `Db` has to be dual-typed (STK-081 consult R-15).
- About 70 % of the diff applies one pattern (Approach §3) to 17 files.
- Every design decision is already made (STK-081 plan, "Specialist input used"). The implementer makes no open choices.
- The work is cut into **9 ordered commit groups**. Each group has its own gate and test list, so the reviewer can review commit by commit.

`## Split proposal` gives a fallback split in case attempt 1 shows the volume cannot be reviewed.

## Spec summary
- Ticket goal (quoted): "Port all 17 repos to Kysely through `@stoktok/db` (index), with the same exported functions (pageSize options removed as decided)." The requirements list in ticket.md lines 16–49 is binding. It is restated item by item in the Files table.
- Ticket AC1 (first commit, Ming 2026-11-11): "widen `Escaping` in `packages/db/src/pg/access.ts` to `Compilable<unknown> | QueryCreator<Database> | TransactionBuilder<Database> | ConnectionBuilder<Database> | DatabaseIntrospector` with `@ts-expect-error` fixtures for `k.transaction()`, `k.connection()`, `k.with(...)` and `k.introspection` (optionally also reject `any` via `0 extends 1 & T`); extend the r3-guard `log` rule to the shorthand `{ log }`, `{ log, dialect }` and quoted `'log':` forms with self-tests."
- Ticket AC2: "a `q()` callback returns rows or scalars only — no `as any`/`unknown`, no assigning `k`/`trx` to an outer variable, no wrapper objects or functions around `k`/`trx`."
- Ticket AC3–AC9: see the table below.
- CLAUDE.md R2: "Money and prices are integers in VND … No floats for money." R3: "Service role key is server-only … The browser never talks to the DB directly." (This ticket rewrites the R3 text.) R5: market rules and limits are configuration. R7: stay inside the plan. R8: "No PASS without green checks … New or changed `packages/core` logic must have unit tests" (applied here to `packages/db`).
- ADR 0010 §4: "int8 stays a digit string so `toSafeInt` performs the R2 safe-range check, never `Number` or `BigInt`." §5: "No `cause` is attached." §13: "Kysely is reached only through `q()` in `pg/access.ts`, which wraps `run()`."
- STK-081 plan, "Open questions — decided here and binding on STK-085", items 1–5: `listAllOpenGaps` is a single select; fan-outs stay per symbol with `PG_FANOUT_CONCURRENCY = 2`; multi-chunk upserts run in one transaction, except `insertNews`; `Db` is an alias; the `globalThis` cache is always on.
- Release rule (ticket): "STK-081 to STK-083 merge to main but no stoktok release is cut until STK-084."

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | **First commit (G0)**: the widened `Escaping`, the four `@ts-expect-error` fixtures, `any` rejected, and the `log` guard covering the shorthand and quoted forms | `git log --reverse` shows G0 first and touching only `pg/access.ts`, `pg/access.test.ts` and `r3-guard.test.ts`. `pnpm --filter @stoktok/db typecheck` is green. Deleting any one member of `Escaping` makes typecheck fail with TS2578 on its fixture (reviewer mutation on a scratch copy, as in STK-081 attempt 2). `r3-guard.test.ts › S5 regexes catch their fixtures` contains the new must-match strings `{ dialect: new PostgresDialect({ pool }), log }`, `({ log, dialect })`, `({ dialect, 'log': f })` and the must-not-match string `new Kysely({ dialect }); console.log(1)`. |
| 2 | Reviewer rule for every repo port: `q()` callbacks return rows or scalars only | Read every `q(` callback in `packages/db/src/repos/*.ts`, `ledger.ts` and `holdings.ts`. Also `grep -nE "as any\|as unknown\|: any\b" packages/db/src/repos/*.ts packages/db/src/ledger.ts packages/db/src/holdings.ts` must be empty. No `let`/outer variable is assigned `k` or `trx`. No object or function that holds `k`/`trx` is returned. Mapping (`mapRow`, `found`) happens **outside** the callback. |
| 3 | All 17 repos run on Kysely through `q()`. No `@supabase/` import outside `apps/web/server/auth/**`. `fetchAll`, `unwrap`, `unwrapFound` and `fake-client.ts` are deleted | `grep -rn "fetchAll\|unwrapFound\|\bunwrap\b\|fake-client\|createServiceClient" apps packages --include=*.ts --include=*.tsx` is empty (`.next` and `node_modules` excluded). `test-db/repos-ended-handle.test.ts › every exported repo function rejects with DataError on an ended handle`. `r3-guard.test.ts › S5: @supabase/ imports only under apps/web/server/auth/` (new) and the existing S5 kysely/accessor rules stay green. |
| 4 | The test:db behaviour cases from DB-optimizer §D pass, including: the transactions out-of-range-page total, guarded gap updates, the news insert count, every upsert conflict key, the four jsonb round-trips, and the `ai_reserve` concurrency test (mutation proof in the impl-log) | `pnpm test:db` is green. The test names listed under G2–G5 below all exist. The impl-log has the concurrency mutation run (procedure in Approach §6). |
| 5 | Worker lifecycle: no pool on a usage error; `end()` on success and on error; the image smoke with an unreachable DB exits 1 within 20 s and leaks no host or password | `apps/worker/src/cli.test.ts › main: usage error opens no db`, `› main: end() runs once after a successful job`, `› main: end() runs once when the job throws, and the error still propagates`, `› main: an end() rejection does not replace the job result`. `scripts/check-image.sh worker` no-hang step. Local equivalent without Docker: `pnpm --filter @stoktok/worker build && STOKTOK_DATABASE_URL=postgres://smoke:smoke-pw@127.0.0.1:9/smoke timeout 20 node apps/worker/dist/cli.js signals; echo $?` prints `1`, and stderr contains neither `smoke-pw` nor `127.0.0.1`. |
| 6 | The web and worker images resolve `pg` at runtime, and the worker image also resolves `kysely` | The `check-image.sh` probes (CI image job). Locally after `pnpm build`: `ls apps/web/.next/node_modules` shows exactly one `pg-<hash>` entry. `grep -c "from \"pg\"\|from \"kysely\"" apps/worker/dist/cli.js` is ≥ 1, which shows they are imported, not inlined. `grep -c "@stoktok/db" apps/worker/dist/cli.js` is 0. |
| 7 | The listed r3-guard rules pass, with regex self-tests | `pnpm --filter @stoktok/db test -- r3-guard` is green, and the new tests listed under G8 exist. |
| 8 | Production keeps working; no release is cut | `git diff --stat main...HEAD` touches nothing under `.github/workflows/`, `deploy/` or `apps/*/Dockerfile`. No `release/v*` branch or tag is created. |
| 9 | `typecheck`, `lint`, `test`, `test:db`, `db:check`, `check:service-key` and `build` are green | The reviewer runs all of them, plus `pnpm check:deploy-env` (CI runs it, and this ticket edits `.env.example`). |

**Ming verification after merge:** none. No release is cut, so nothing reaches production until STK-084.

## Files to create / modify
Grouped by commit. The implementer may not touch files outside this list without recording why in the impl-log (R7).

**G0 — hardening (first commit, before any repo)**
| File | Change | Required because |
|---|---|---|
| `packages/db/src/pg/access.ts` | `type Escaping = Compilable<unknown> \| QueryCreator<Database> \| TransactionBuilder<Database> \| ConnectionBuilder<Database> \| DatabaseIntrospector` (type imports from `kysely`). Callback type `Promise<NoEscape<T>>` with `type NoEscape<T> = 0 extends 1 & T ? never : T extends Escaping ? never : T`. If the `any` branch breaks inference of an existing positive fixture, drop only that branch and record it in the impl-log (the ticket says "optionally"). | AC1 |
| `packages/db/src/pg/access.test.ts` | Add `@ts-expect-error` fixtures: `k.transaction()`, `k.connection()`, `k.with('x', (d) => d.selectNoFrom((eb) => eb.lit(1).as('a')))`, `k.introspection`, `k as any`. The existing 3 positive and 4 negative fixtures stay. | AC1 |
| `packages/db/src/r3-guard.test.ts` | `KYSELY_CTOR_LOG` tail becomes `(?<![.\w])['"]?log['"]?\s*[:(,}]`. Add the 3 must-match and 1 must-not-match self-tests from STK-081 review attempt 2, Issue 2. | AC1 |

**G1 — shared helpers**
| File | Change | Required because |
|---|---|---|
| `packages/db/src/errors.ts` | Add `found<T>(row: T \| undefined, ctx: Ctx): T`. It throws `DataError('NOT_FOUND', …, 'not found')`. `unwrap`, `unwrapFound` and `fetchAll` stay until G6, because unported repos still use them. | ticket "add a `found()` helper" |
| `packages/db/src/errors.test.ts` | `found` cases | R8 |
| `packages/db/src/pg/config.ts` | `export const PG_FANOUT_CONCURRENCY = 2;` with a comment: ≤ worker `max`, so no caller waits near `connectionTimeoutMillis` | ticket, R5 |
| `packages/db/src/pg/fanout.ts` | **New.** `mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>`. It preserves input order, runs at most `limit` calls at once, and rejects with the first error without starting new items after it. Pure, with no DB import. | fan-out decision |
| `packages/db/src/pg/fanout.test.ts` | **New.** Unit tests | R8 |
| `packages/db/src/pg/upsert.ts` | Add three helpers:<br>- `pickRows<T>(rows: readonly T[], cols: readonly (keyof T & string)[]): T[]`. It builds each row from exactly `cols`; `undefined` becomes `null`, and extra properties are dropped.<br>- `chunkRows<T>(rows, chunkSize): T[][]`, which is `chunkForParams(rows)` with each chunk then sliced by `chunkSize`.<br>- `upsertChunked(db: PgDb, ctx, table, rows, conflict, chunkSize): Promise<void>`. With 0 rows it does nothing. With 1 chunk it runs one `q()` with no transaction. With more than one it runs one `q()` that wraps `k.transaction().execute(async (trx) => { for … await upsertInto(trx, …).execute(); })` and uses only `trx` inside. | ticket "multi-chunk upserts run in one transaction … chunking `chunkForParams` × `chunkSize`", "normalise optional fields to explicit `null`" |
| `packages/db/src/pg/upsert.test.ts` | Unit tests for `pickRows` and `chunkRows` | R8 |
| `packages/db/test-db/upsert.test.ts` | `upsertChunked` cases | real-PG behaviour |

**G2 — ledger repos**
| File | Change | Required because |
|---|---|---|
| `packages/db/src/repos/transactions.ts`, `corporate-actions.ts`, `settings.ts` | Port per Approach §3. `listTransactions` and `listCorporateActions` become a single ordered select. `listTransactionsPage` follows Approach §4. | scope |
| `packages/db/src/ledger.ts`, `holdings.ts` | `import type { PgDb } from './pg/client'` replaces `Db` from `./client`. No logic change. | type switch |
| `packages/db/src/repos/transactions.test.ts`, `corporate-actions.test.ts`, `settings.test.ts`, `src/ledger.test.ts`, `src/holdings.test.ts` | **Delete.** The cases move to test-db. A repo test file is kept only for no-query cases (Approach §5). | ticket "repo behaviour tests move to `test-db/`" |
| `packages/db/test-db/transactions.test.ts`, `corporate-actions.test.ts`, `settings.test.ts`, `ledger-holdings.test.ts` | **New.** See Tests G2 | AC4 |

**G3 — market data**
| File | Change | Required because |
|---|---|---|
| `packages/db/src/repos/prices-daily.ts`, `prices-intraday.ts`, `financials.ts`, `financial-lines.ts`, `symbols.ts`, `data-gaps.ts`, `news.ts`, `signals.ts` | Port per Approach §3. The fan-outs (`getLatestCloses`, `getFirstPriceDates`, `getRecentCloses`, `getLatestIntraday`, `listLatestSignals`) use `mapLimit(…, PG_FANOUT_CONCURRENCY, …)`, one `q()` per item. `listPriceDates`, `listCloseHistory` and `listAllOpenGaps` lose `pageSize` and become one select. Upserts use `pickRows` + `upsertChunked`. `insertGaps` uses `chunkRows` + one transaction when there is more than 1 chunk (same rule). `insertNews` runs one `q()` per chunk with no transaction, and the count is the sum of returned ids. `resolveGaps`/`extendGaps` use `sql\`id = any(${ids}::bigint[])\`` and `resolved_at is null`. The `set` contains `resolved_reason` only when `reason !== undefined`. | scope, binding decisions 1–3 |
| the 8 matching `src/repos/*.test.ts` | Delete or reduce per Approach §5 | test move |
| `packages/db/test-db/prices-daily.test.ts`, `prices-intraday.test.ts`, `financials.test.ts` (financials + financial-lines), `symbols.test.ts`, `data-gaps.test.ts`, `news.test.ts`, `signals.test.ts` | **New** | AC4 |

**G4 — assets, watchlist, lottery**
| File | Change | Required because |
|---|---|---|
| `packages/db/src/repos/assets.ts`, `watchlist.ts`, `lottery.ts` | Port. In lottery, `input()` validation (including `drawNoFromId`) runs **before** `q()`. `lines` is written with `jsonb(...)` on create and update. `upsertLotteryDraws` uses `pickRows` + `upsertChunked` (default `chunkSize` 100 kept). | scope |
| `src/repos/assets-watchlist.test.ts`, `lottery.test.ts` | Delete or reduce per Approach §5 | test move |
| `packages/db/test-db/assets-watchlist.test.ts`, `lottery.test.ts` | **New** | AC4 |

**G5 — AI**
| File | Change | Required because |
|---|---|---|
| `packages/db/src/repos/ai-usage.ts` | Raw `sql` per DB-optimizer E:<br>- `select usage_id, granted, spent_micro_usd from public.ai_reserve(${p}::text, ${m}::text, ${t}::text, ${r}::bigint, ${c}::bigint, ${from}::timestamptz, ${to}::timestamptz)`;<br>- `select public.ai_month_spend(${from}::timestamptz, ${to}::timestamptz) as spent`.<br>`settleAiUsage` becomes `updateTable … where id = … and status = 'reserved' returning id`. Never inside a transaction. `toSafeInt` is kept on every bigint. | ticket, DB-optimizer E |
| `packages/db/src/repos/ai-summaries.ts` | `upsertInto(k, 'ai_summaries', [{ …row, body: jsonb(row.body) }], ['scope','symbol','summary_date']).returning('id')`. `input_ids` is a plain array. The list is ordered by `symbol`. | scope |
| `packages/db/src/repos/ai-keys.ts` | Raw `sql`:<br>- `select key_last4, saved_at from public.ai_key_set(${provider}::text, ${key}::text)`;<br>- `select public.ai_key_delete(${p}::text) as deleted`;<br>- `select provider, secret from public.ai_key_secrets()`.<br>Each goes through `q(db, ctx, …, { map: AI_KEY_MAP })` with `AI_KEY_MAP = (s) => (s === '22023' ? 'VALIDATION' : undefined)`. `listAiKeyMeta` selects `provider, last4, updated_at` from `ai_keys`. Delete `fail()`. The key is only ever a bound parameter (never `sql.lit`/`sql.raw`). | ticket "Vault RPCs stay … 22023 → VALIDATION via the `q()` map hook" |
| `src/repos/ai-usage.test.ts`, `ai-summaries.test.ts`, `ai-keys.test.ts` | Delete or reduce per Approach §5. A reduced `ai-keys.test.ts` keeps the unknown-provider and invalid-format cases. | test move |
| `packages/db/test-db/ai-usage.test.ts`, `ai-summaries.test.ts`, `ai-keys.test.ts` | **New** | AC4 |

**G6 — finish packages/db**
| File | Change | Required because |
|---|---|---|
| `packages/db/src/index.ts` | Drop `createServiceClient` and `type Db` from `./client`. Add `import type { PgDb } from './pg/client'; export type Db = PgDb;`. Do **not** export `createPgDb` from the index: apps import it from `@stoktok/db/pg`, so `apps/web/server/db.ts`'s `export *` cannot hand it to every web file. | ticket "`export type Db = PgDb`" |
| `packages/db/src/client.ts`, `src/client.test.ts`, `test/fake-client.ts` | **Delete** | ticket |
| `packages/db/src/errors.ts`, `errors.test.ts` | Delete `unwrap`, `unwrapFound`, `fetchAll`, the `PgResult` interface and their tests | ticket |
| `packages/db/src/pg/index.ts` | Header comment: the "Kept out of the package index so apps do not bundle pg yet" sentence goes | stale comment |
| `packages/db/package.json` | Remove `@supabase/supabase-js` | ticket |
| `packages/db/test-db/repos-ended-handle.test.ts` | **New.** Dynamic check (architect R-9) | AC3 |
| `pnpm-lock.yaml` | `pnpm install` result | dependency change |

**G7 — apps**
| File | Change | Required because |
|---|---|---|
| `apps/web/server/db.ts` | Lazy, cached on `globalThis[Symbol.for('stoktok.db')]`, unconditionally. `import { createPgDb } from '@stoktok/db/pg'`. `getDb()` returns the cached handle or creates `createPgDb(process.env, 'web')`. `export * from '@stoktok/db'` is kept. `import 'server-only'` stays the first line. The file does not reference the env name. | ticket |
| `apps/web/server/db.test.ts` | **New** | lifecycle evidence |
| `apps/web/server/ai.test.ts`, `ai-keys.test.ts` | Rewrite with `vi.mock('./db', …)` of the repo functions (`readAiKeySecrets`, `aiUsageLedger`, `saveAiKey`, `deleteAiKey`, `listAiKeyMeta`, `DataError` from the real module via `importOriginal`). The same behaviours stay asserted (Tests G7). | ticket |
| `apps/worker/src/cli.ts` | `main` is exported as `main(argv: readonly string[], openDb: () => Db = () => createPgDb(process.env, 'worker'))`, with `import { createPgDb } from '@stoktok/db/pg'`. The handle is created **after** `parseArgs`, inside `try`, with `finally { await db?.end().catch(() => undefined) }`. The entry block calls `main(process.argv.slice(2))`, and the `.catch` is unchanged. `createDbHolidayGapsStore(db)` (no cfg). `createDbNewsStore(db, { insertChunkSize })`. | ticket |
| `apps/worker/src/cli.test.ts` | Add the lifecycle tests | AC5 |
| `apps/worker/src/ai.ts` | `createWorkerAi(opts: { env?: Record<string, string \| undefined>; db: Db })`. `db` is required, with no fallback. `createServiceClient` is no longer imported. | ticket |
| `apps/worker/src/ai.test.ts` | Rewrite with `vi.mock('@stoktok/db', …)` of `readAiKeySecrets` and `aiUsageLedger` | ticket |
| `apps/worker/src/store.ts` | `createDbHolidayGapsStore(db)` with no `cfg`, and `listAllOpenGaps(db, PRICES_GAP_TYPE)`. `createDbNewsStore` opts become `{ insertChunkSize }`, and `listAllOpenGaps(db, NEWS_GAP_TYPE, { source })`. The symbol-chunk loops are **kept** (follow-up). | binding decision 1 |
| `apps/worker/src/store.test.ts` | Drop the `{ pageSize }` expectations and the `pageSize`/`gapsPageSize` opts (lines 134–150) | ticket |
| `apps/worker/src/config.ts` | Remove `HOLIDAY_GAPS_CONFIG.pageSize` and `NEWS_SYNC_CONFIG.gapsPageSize`. The `insertChunkSize` comment becomes "Rows per insert statement." | binding decision 1 |
| `apps/worker/src/config.test.ts` | Delete the test `insertChunkSize < 1000 and gapsPageSize <= 1000` | ticket |

**G8 — bundling, guards, scripts**
| File | Change | Required because |
|---|---|---|
| `apps/web/package.json` | Add `"pg": "^8.23.1"` (same range as `packages/db`). `@supabase/*` stays (auth). | ticket, architect F16 |
| `apps/web/next.config.ts` | `serverExternalPackages: ['@anthropic-ai/sdk', '@google/genai', 'pg']` | ticket |
| `apps/worker/package.json` | Remove `@supabase/supabase-js`. Add `"kysely": "^0.29.8"` and `"pg": "^8.23.1"` (exactly `packages/db`'s ranges). | ticket |
| `apps/worker/tsup.config.ts` | `external: ['pg', 'pg-native', 'kysely']` | ticket |
| `pnpm-lock.yaml` | `pnpm install` | deps |
| `scripts/check-image.sh` | Worker, after the usage smoke:<br>(a) Resolve probe: `docker run --rm -w /app/dist --entrypoint node "$IMAGE" -e "Promise.all([import('pg'),import('kysely')]).then(()=>process.exit(0),()=>process.exit(1))"`.<br>(b) No-hang: `timeout 20 docker run --rm --name "$NAME" -e STOKTOK_DATABASE_URL=postgres://smoke:smoke-pw@127.0.0.1:9/smoke "$IMAGE" signals 2> "$err"`. Require exit 1 (124 means a hang), and require that stderr contains neither `smoke-pw` nor `127.0.0.1`. A `trap` `docker rm -f "$NAME"` covers the timeout case.<br>Web:<br>- Replace `-e SUPABASE_URL… -e SUPABASE_SERVICE_ROLE_KEY=dummy` with `-e STOKTOK_DATABASE_URL=postgres://smoke:smoke@127.0.0.1:9/smoke`.<br>- Extend the alias probe: exactly one top-level entry matching `/^pg-[0-9a-f]+$/` in `.next/node_modules`, imported together with the SDK aliases. | ticket |
| `scripts/check-no-service-key-in-client.sh` | Build line: drop `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY="$SENTINEL"`, the `SENTINEL` variable and its `NEEDLES` entry. The fixed needles (including the text `SUPABASE_SERVICE_ROLE_KEY`) stay. | ticket |
| `packages/db/src/r3-guard.test.ts` | Rules listed in Tests G8. The Vault allow-lists get one **path** entry each: `packages/db/test-db/ai-keys.test.ts`. The rule text and the other entries are unchanged (Assumption A4). | ticket |

**G9 — docs**
| File | Change | Required because |
|---|---|---|
| `.env.example` | New block `# App database (self-hosted Postgres, ADR 0010; server-only, R3)` with `STOKTOK_DATABASE_URL=` and the comment `# e.g. postgres://postgres:postgres@localhost:5432/stoktok`. The `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` lines move under `# Legacy: read only by the running production release until the STK-084 cutover; code on main no longer reads them.` (Assumption A3) | ticket |
| `docs/deploy.md` | Env table only: add the row `` | `STOKTOK_DATABASE_URL` | web, worker | reserved | y | ``. Nothing else. | `check:deploy-env` requires `.env.example` and the table to match (A3) |
| `CLAUDE.md` | Replace only the R3 row text with: "**Database credentials are server-only.** `STOKTOK_DATABASE_URL` is read only in `packages/db/src/pg/client.ts`, via Next.js server code (`apps/web/server/db.ts`) and `apps/worker`. Never in `NEXT_PUBLIC_*`, never in client bundles. The browser never talks to the DB directly." | ticket "CLAUDE.md R3 text" |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | Decision 1: "until STK-081" becomes "until STK-085". New decision **14. Repos (STK-085)**: every repo query goes through `q()`; `Db = PgDb`; per-symbol fan-outs are bounded by `PG_FANOUT_CONCURRENCY`; multi-chunk upserts are atomic except `insertNews`; `listAllOpenGaps` is one select; apps import `createPgDb` from `@stoktok/db/pg` only in `apps/web/server/db.ts` and `apps/worker/src/cli.ts`. Consequences: the slice order reads "STK-081 (handle hardening), STK-085 (port repos and callers, wire apps)", and "Run STK-077 after STK-085". | records the decisions |

**Not touched:**
- `.github/workflows/**`, `deploy/**` and `apps/*/Dockerfile` (deploy plumbing is STK-084);
- migrations, `pg/client.ts`, `pg/schema.ts` (unless typecheck shows a mismatch with a migration, which must then be recorded), `src/mappers.ts`, `src/rows.ts` and `packages/core/**`;
- `apps/worker/src/jobs/**`, including `resolve-holiday-gaps.ts` and its `resolveChunkSize` (follow-up);
- `scripts/check-deploy-env.sh`.

## Tests to write
General rule for every test:db case: each error assertion checks `instanceof DataError`, the expected `code`, and that the message holds no payload values (keys, urls, symbols, the AI key). Each file uses `freshDb()` once in `beforeAll` and `drop()` in `afterAll`.

**G0**
| Test | Covers |
|---|---|
| `src/pg/access.test.ts` typeFixtures: `k.transaction()`, `k.connection()`, `k.with(…)`, `k.introspection`, `k as any` under `@ts-expect-error` | AC1. Typecheck is the assertion. |
| `src/r3-guard.test.ts › S5 regexes catch their fixtures` (extended) | AC1 |

**G1**
| Test | Covers |
|---|---|
| `src/errors.test.ts › found returns the row; undefined throws NOT_FOUND with table.op and no cause` | `found` |
| `src/pg/fanout.test.ts › preserves input order` | |
| `src/pg/fanout.test.ts › never runs more than limit at once` (counter of in-flight deferreds, 7 items, limit 2) | |
| `src/pg/fanout.test.ts › empty input resolves [] without calling fn` | |
| `src/pg/fanout.test.ts › first rejection rejects, and no item starts after it` | |
| `src/pg/upsert.test.ts › pickRows: undefined → null, extra props dropped, key order = cols` | |
| `src/pg/upsert.test.ts › chunkRows: chunkSize 2 over 5 rows → [2,2,1]; params bound wins when smaller; empty → []` | |
| `test-db/upsert.test.ts › upsertChunked: one chunk writes all rows` | |
| `test-db/upsert.test.ts › upsertChunked: a failing later chunk rolls back earlier chunks (VALIDATION, 0 rows)` (prices_daily, chunkSize 2, 5 rows, 5th breaks `low<=…<=high`) | binding decision 3 |

**G2**
| Test | Covers |
|---|---|
| `test-db/transactions.test.ts › listTransactions orders by trade_date, seq and filters by symbol` | |
| `› listTransactionsPage: total = filtered count, offset window correct, newest first` | |
| `› listTransactionsPage: total stays correct when offset is past the end` | AC4 "out-of-range-page total" |
| `› duplicate (source, import_batch_id, external_ref) → CONFLICT; two NULL refs do not conflict` | |
| `› update keeps seq, source, import_batch_id; changes fee and tax, including to null` | |
| `› get/update/delete of an unknown id → NOT_FOUND` | |
| `› seq arrives as a digit string and maps to a number` | R2 |
| `test-db/corporate-actions.test.ts › update is a full replace (cash dividend → split clears amount_per_share, pay_date, record_date)` | |
| `› duplicate (symbol, type, ex_date) on create and update → CONFLICT` | |
| `› ordering ex_date, symbol, id; symbols: [] → []` | |
| `test-db/settings.test.ts › saveSettings leaves rule_configs and concentration_threshold_ppm untouched` | |
| `› saveAppSettings round-trips holidays (empty and non-empty date[], no timezone drift) and rule_configs (jsonb), keeps withholding and cost_method` | jsonb round-trip 1/4 |
| `› fee_rate_ppm null: getSettings → NOT_CONFIGURED, getEntrySettings → feeRateConfigured false` | |
| `› no row: getSettings NOT_CONFIGURED; getEntrySettings, getAppSettings, getMarketRules, getSignalRules, getConcentrationThreshold give defaults/null` | |
| `› id is forced to 1; updated_at does not change on save (documents parity)` | |
| `test-db/ledger-holdings.test.ts`: every case of today's `ledger.test.ts` and `holdings.test.ts`, seeded through `createTransaction` and `saveSettings` | the ported orchestration |

**G3**
| Test | Covers |
|---|---|
| `test-db/prices-daily.test.ts › re-upsert replaces all columns incl. foreign_net → null (conflict key symbol, trade_date)` | conflict key |
| `› duplicate keys in one input: later wins, count = unique.length` | |
| `› chunkSize 2 over 5 rows writes all 5` | |
| `› mixed optional columns in one batch (foreign_net number / null / undefined) succeed; undefined stored as NULL` | pickRows, data-engineer F7 |
| `› volume arrives as a digit string, trade_date as YYYY-MM-DD` | R2 |
| `› latest / first / recent omit or empty symbols without rows; 12 symbols on the worker profile (max 2) all resolve, stats().total ≤ 2` | fan-out |
| `› listPriceDates and listCloseHistory: one select, ascending, inclusive bounds` | |
| `› check violation → VALIDATION` | |
| `test-db/prices-intraday.test.ts › last write wins on (symbol, ts); source and fetched_at replaced; microsecond ts round-trips; latest picks newest ts` | conflict key |
| `test-db/financials.test.ts › financials restatement overwrites values and fetched_at (key symbol, period); fromPeriod filter; empty symbols → []` | conflict key |
| `› financial_lines same line with a different statement replaces it (4-column key); period_kind filter; empty symbols → []` | conflict key |
| `test-db/symbols.test.ts`: the 6 cases of DB-optimizer §D "symbols" | conflict key |
| `test-db/data-gaps.test.ts › resolveGaps leaves an already-resolved row untouched (resolved_at and resolved_reason)` | guarded updates |
| `› resolveGaps without reason keeps resolved_reason; with reason writes it` | guarded updates |
| `› extendGaps does not move a resolved row; to_ts < from_ts → VALIDATION` | guarded updates |
| `› empty ids return without a query` | |
| `› listOpenGaps excludes NULL-symbol gaps; listOpenMarketGaps returns only them` | |
| `› listAllOpenGaps: 2500 rows in one call, ids ascending, no duplicates, includes NULL symbol, source filter` | binding decision 1 |
| `› insertGaps with a NULL symbol and with more rows than one chunk` | |
| `test-db/news.test.ts › new url inserted and counted; existing url skipped, title unchanged, not counted` | news insert count |
| `› in-batch duplicate counts once; chunkSize 2 sums across chunks` | |
| `› symbols text[] round-trips incl. []` | |
| `› a failing later chunk keeps earlier chunks (no transaction) and throws VALIDATION` | documents the `insertNews` exception |
| `› empty input does nothing` | |
| `test-db/signals.test.ts › each of the 4 key columns discriminates; replace updates label (to null), value, reason_codes, inputs_snapshot, computed_at; id and created_at unchanged` | conflict key + jsonb 2/4 |
| `› listLatestSignals returns the newest per rule in ruleIds order, omits rules without rows` | |
| `› a check violation → VALIDATION` | |

**G4**
| Test | Covers |
|---|---|
| `test-db/assets-watchlist.test.ts`: assets CRUD and delete of a missing id → NOT_FOUND; ordering `as_of desc, id`; watchlist duplicate → CONFLICT, bad symbol → VALIDATION, default `group_name` | |
| `test-db/lottery.test.ts › draw replace nulls jackpots; numbers smallint[] → number[] (key game, draw_no)` | conflict key |
| `› ticket lines round-trip as number[][]` | jsonb 3/4 |
| `› duplicate raw_text differing only in whitespace → CONFLICT; sms identity duplicate → CONFLICT, other channel ok` | |
| `› update resets to pending with result columns null; recordResult won gross 0 → VALIDATION` | |
| `› listPending and drawId filter; invalid drawId → VALIDATION` | |

**G5**
| Test | Covers |
|---|---|
| `test-db/ai-usage.test.ts › grant and refusal rows; refused cost 0 does not raise spent` | |
| `› argument validation (zero reserve, window without now(), p_from >= p_to, null) → DataError DB_ERROR pgCode 22023` | |
| `› ai_month_spend: settled cost counted, unsettled at reserve, outside window excluded, empty → 0` | |
| `› settleAiUsage only from reserved; second settle false; ok without cost → VALIDATION; bad errorCode → VALIDATION` | |
| `› ai_reserve concurrency: 12 parallel reserves of 100 under cap 300 → exactly 3 granted seeing {0,100,200}, 9 refused seeing 300, 12 unique ids, month spend 300 (3 rounds)` | freshDb('web', …) with `max: 12` overrides; **mutation proof** |
| `test-db/ai-summaries.test.ts › replace keeps id, advances created_at, replaces body (jsonb) and input_ids` | jsonb 4/4 + conflict key |
| `› template over model clears provider, model, usage_id; model with null provider → VALIDATION; portfolio '' row sorts first; deleting ai_usage nulls usage_id` | |
| `test-db/ai-keys.test.ts › set then list shows last4 and no secret; replace updates last4; delete true then false; readAiKeySecrets round-trips both providers` | marked "remove in STK-082" |
| `› a 22023 from ai_key_set → VALIDATION; message and JSON.stringify(error) contain neither the key nor its last4` | map hook, R3 |
| `src/repos/ai-keys.test.ts` (reduced) `› unknown provider and bad format → VALIDATION with a non-handle db (no query attempted)` | |

**G6**
| Test | Covers |
|---|---|
| `test-db/repos-ended-handle.test.ts › every exported repo function rejects with DataError on an ended handle` | AC3. Table-driven over every index export except the ai-keys functions (covered in `ai-keys.test.ts › ended handle`, to keep the Vault allow-list narrow). Inputs are non-empty so no early return skips the query. |

**G7**
| Test | Covers |
|---|---|
| `apps/web/server/db.test.ts › importing the module creates no handle` | lazy |
| `› getDb() calls the factory once with (process.env, 'web') and returns the same handle` | cache |
| `› after vi.resetModules() a re-imported module returns the same handle without a second factory call` | `globalThis` cache across module instances |
| `apps/web/server/ai.test.ts`: the existing 7 behaviours, with `aiUsageLedger` mocked to return `{ monthSpend: vi.fn().mockResolvedValue(4_000_000), … }` and an assertion that it got `getDb()`'s handle | rewrite |
| `apps/web/server/ai-keys.test.ts`: the existing behaviours | rewrite |
| `apps/worker/src/cli.test.ts › main: usage error opens no db (exitCode 2)` | AC5 |
| `› main: end() runs once after a successful job` | AC5 |
| `› main: end() runs once when the job throws, and the error still propagates` | AC5 |
| `› main: an end() rejection does not replace the job result` | AC5 |
| `apps/worker/src/ai.test.ts › budgetStatus reads monthSpend from aiUsageLedger(db) with the passed db` | rewrite |
| `› generate reads stored keys per call via readAiKeySecrets(db)` | rewrite |
| `› a key-read rejection carrying a sentinel gives provider_unavailable and logs no sentinel` | rewrite |
| `apps/worker/src/store.test.ts`: updated expectations | |

Notes on the G7 tests:
- `apps/web/server/db.test.ts`: mock `@stoktok/db/pg` through a `vi.hoisted` fn and a `vi.mock` factory, with **no** `import … from '@stoktok/db/pg'` (keeps the web-importer guard), and never write the call text `createPgDb(`. `afterEach` deletes `globalThis[Symbol.for('stoktok.db')]`.
- `apps/web/server/ai-keys.test.ts`:
  - save success returns the 4-key result;
  - format, provider and File rejections call no repo function;
  - a repo rejection maps to `AI_KEY_DB_ERROR`;
  - delete true/false;
  - no-leak (results and logs never contain the sentinel; logs are exactly `{event, provider, code}`);
  - `readAiKeyRows` ok, soft-fail with one log, and presence-loader throw.
  - The rpc-name/payload assertions are replaced by "`saveAiKey` called with (db, 'anthropic', key)".
- `apps/worker/src/cli.test.ts`: `openDb` is a fake returning `{ end: vi.fn(), stats }`. `vi.mock('./jobs/medium-signals')` controls the job. `process.exitCode` is restored in `afterEach`.

**G8**
| Test | Covers |
|---|---|
| `src/r3-guard.test.ts › S5: @supabase/ imports (from, import type, import(), require(), side-effect, export-from) only under apps/web/server/auth/` + self-tests (6 must-match, `from '@stoktok/db'` must-not-match) | ticket |
| `› packages/db and apps/worker package.json declare no @supabase/* in any dependency field` | ticket |
| `› SUPABASE_SERVICE_ROLE_KEY appears in no source file` (replaces the old allow-list test) | ticket |
| `› createPgDb( is called only under pg/, test-db/, apps/web/server/db.ts and apps/worker/src/cli.ts` (extends the existing S5 test) | ticket |
| `› pg and kysely ranges in apps/worker and pg in apps/web equal packages/db's` | ticket "with a guard test" |

## Approach
1. **Branch and gates.** Commit groups G0–G9 are committed in order, one commit per group (`STK-085: <summary>`).
   - **G0 and G1** keep the whole workspace green.
   - **G2–G6 are gated on `packages/db` only:** `pnpm --filter @stoktok/db typecheck && … lint && … test && pnpm test:db`. The apps stop typechecking from G2 until G7, because the index then exports functions that take a `PgDb` while the apps still pass a supabase client. This is the cost of no dual-typed `Db` (architect).
   - **G7–G9** restore and then keep the full gate (AC9).
   - Record the per-group gate result in the impl-log.
2. **Type switch.** Ported repos and `ledger.ts`/`holdings.ts` take `db: PgDb` (from `../pg/client`). The `Db` alias lands in G6. App files keep importing `Db` (type only) and do not change (STK-081 decision 4).
3. **Repo pattern** (applies to every port; the reviewer checks against it):
   - `const ctx = { table, op }` stays exactly as today (error messages unchanged).
   - Column lists become `as const` arrays.
   - Reads: `const rows = await q(db, ctx, (k) => k.selectFrom(t).select(COLS).where(…).orderBy(…).execute());`, then mapping outside: `rows.map((r) => mapRow(fromRow, r as XRow, ctx))`.
   - Casting a selected row to the existing `rows.ts`/core row type is allowed where Kysely's type is wider (for example `source: string` vs the literal union), because the mapper validates it. No other casts.
   - Single row: `.executeTakeFirst()` inside `q`, then `found(row, ctx)` outside.
   - Insert/update returning: `.returning(COLS)`.
   - Delete: `.returning('id').execute()` and length 0 → `NOT_FOUND`.
   - Empty-list early returns stay **before** `q` (symbols, data-gaps, financials, financial-lines, corporate-actions `symbols: []`).
   - Id lists use `` sql`id = any(${[...ids]}::bigint[])` ``. Symbol lists use `.where('symbol', 'in', [...symbols])` after the early return.
   - jsonb columns are written only through `jsonb()`; the schema types force it. `text[]`/`smallint[]`/`date[]` take plain arrays.
   - Dates and timestamps are passed as strings, never `Date`.
   - Bigint values reach domain code only through `toSafeInt` (R2). No `Number(` on raw rows.
   - Inside a transaction callback use only `trx`. Never call a repo function or `q` inside another `q`.
   - Imports from `kysely` in repos: only `sql` and types (S5 guard).
4. **`listTransactionsPage`.**
   - A shared `where` builder function is applied inside each `q` callback, so no builder escapes.
   - The page query selects `COLS` plus `` sql<string>`count(*) over()`.as('total') ``, ordered `trade_date desc, seq desc`, with `limit`/`offset`.
   - If `rows.length === 0 && offset > 0`, a second `q` runs `select count(*) as n` with the same filters.
   - `total` comes from `toSafeInt` on the first row's `total` (or on `n`, or 0). Strip `total` from each row before `transactionFromRow`.
5. **Moving tests.** For each repo, every fake-client case either moves to its test-db file or is deleted when the test-db list covers it.
   - Keep a `src/repos/<x>.test.ts` only for cases that make no query (empty-input early returns, input validation such as lottery `drawId`, ai-keys provider and format). Rewrite those to pass `const noDb = {} as PgDb`. Any query attempt then rejects with `DB_ERROR` ("not a PgDb handle" inside `run`), so the expected `VALIDATION` or `[]` proves that no query ran.
   - Every other repo unit test file is deleted. List each kept, moved and deleted file in the impl-log.
6. **`ai_reserve` mutation proof.**
   - Locally, remove the `pg_advisory_xact_lock` statement from `supabase/migrations/20261110000100_ai_reserve_harden.sql`. `global-setup` builds the template from the migrations.
   - Run `pnpm test:db -t "ai_reserve concurrency"`, record that it fails (more than 3 granted), then `git checkout` the file.
   - The edit is never committed (CLAUDE.md: never edit an applied migration).
7. **Worker lifecycle (`cli.ts`).**
   ```ts
   let db: Db | undefined;
   try { db = openDb(); …dispatch…; console.log(…); process.exitCode = … }
   finally { await db?.end().catch(() => undefined); }
   ```
   - A `createPgDb` throw (missing env) has nothing to end and still prints only its message through the existing `.catch`.
   - `end()` is idempotent (STK-081), so a later caller ending it again is safe.
8. **Bundling evidence.** The worker relies on tsup `noExternal: ['@stoktok/db']` also inlining the `@stoktok/db/pg` subpath (Assumption A2). The impl-log records `grep -c "@stoktok/db" apps/worker/dist/cli.js` = 0. If it is not 0, add `/^@stoktok\/db(\/|$)/` to `noExternal` and record it.
9. **Rules.**
   - R1: no UI change.
   - R2: bigint columns are strings, read through `toSafeInt`, and tested (`seq`, `volume`, `ai_month_spend`).
   - R3: `STOKTOK_DATABASE_URL` is read only in `pg/client.ts`. The web handle lives in a `server-only` module. Errors carry no cause. AI keys are bound parameters only. The guards are extended, and `check:service-key` still builds with a sentinel DB URL.
   - R5: `PG_FANOUT_CONCURRENCY` and chunk sizes are configuration.
   - R6: there are no new routes; existing `requireUser()` call sites are untouched.
   - R7: the follow-ups below are not in the diff.
   - R8: tests are listed per group.
   - R9 and R10: not affected.

## Specialist input used
Reused from `work/tickets/STK-081/consult-*.md` and the STK-081 plan. No new consults were run.

- **Adopted**
  - **Binding STK-081 decisions 1–5:**
    - single-select `listAllOpenGaps`, `pageSize` removed;
    - per-symbol fan-outs with `PG_FANOUT_CONCURRENCY = 2`, never `DISTINCT ON` (DB-optimizer A);
    - one transaction for multi-chunk upserts except `insertNews` (data-engineer 7);
    - the `Db` alias;
    - an unconditional `globalThis` cache.
  - **Architect:**
    - R-9 dynamic check: the ended-handle test.
    - R-11 callers: `db.ts`, `cli.ts` `finally`, `ai.ts` `db` required.
    - R-12 bundling: web `pg` dependency and external; worker deps, `external` and the three smokes.
    - R-13 guards: the `@supabase` import rule, the package.json rule, the negative `SUPABASE_SERVICE_ROLE_KEY` rule, the `createPgDb(` allow-list; `check-no-service-key` drops the `SUPABASE_*` vars.
    - R-14 out-of-range page count.
  - **DB-optimizer:**
    - B2 (explicit `null`, via `pickRows`).
    - B3 (empty `IN` early returns, `= any(…::bigint[])`).
    - B4 (`found()` in errors.ts, open question 7).
    - B5 (22023 via the map hook; `ai_reserve` 22023 stays DB_ERROR).
    - B7 (`chunkForParams` × `chunkSize`; counts stay `unique.length`, news counts actual inserts).
    - C (shapes and conflict keys).
    - D (test cases, adjusted for single-select gaps).
    - E (raw-SQL shapes with casts and named columns; the key only as a bound parameter; the leak test).
  - **Data-engineer:**
    - 2 (handle after `parseArgs`, inside `try`, `end().catch` in `finally`).
    - 3 (only `trx` in transactions).
    - 5 (`ai.ts` `db` required, mock-based tests).
    - 7 (normalise optional fields and test with mixed rows).
    - 8 (behaviours to keep: dedupe later-wins, counts, gap guards).
    - 9 (store and config test edits; mock-based `ai.test.ts`).
    - 10 (worker deps).
  - **STK-081 review attempt 2, Issues 1–2, and security review 🟢 1–2:** G0, exactly as specified.
- **Rejected**
  - DB-optimizer B8 ("build outside, execute inside"). Builders are created inside the callback, because returning or holding a builder outside `q` is what the new `Escaping` type forbids. A programming `Error` from `upsertInto` then becomes DB_ERROR. This is accepted; STK-081 Approach 4 already decided it.
  - DB-optimizer C keyset paging for `listAllOpenGaps`: rejected by STK-081 decision 1.
  - Data-engineer 4: removing `linesSymbolChunk`, `financialsSymbolChunk` and `resolveChunkSize`. This is a follow-up (STK-081 plan) and keeps job files out of the diff.
  - Data-engineer 6: collapsing fan-outs. Follow-up.
  - Data-engineer 9: a worker-level test:db store test, and spawning `cli.ts` in a unit test. `test:db` runs only `packages/db`. The lifecycle is covered by `cli.test.ts` with an injected `openDb`, plus the image smoke and the local `node dist/cli.js` command in AC5.
  - Architect R-12: a pnpm `catalog:`. A guard test is used instead (the ticket's choice).

## Assumptions
- **A1. Hotspots.**
  - STK-081 (state DONE) also edited `pg/access.ts`, `pg/access.test.ts`, `errors.ts` and `r3-guard.test.ts`. If its PR is not merged when this branch is cut, expect a rebase. The branch must contain STK-081's code, which it does in the current tree.
  - No other IN_PROGRESS/REVIEW/DONE ticket touches these files.
  - `src/App.tsx` does not apply to this repo.
- **A2. Worker bundling.** tsup's `noExternal: ['@stoktok/db']` also matches the `@stoktok/db/pg` subpath. This is verified by the dist grep (Approach §8), with a recorded fallback.
- **A3. `.env.example` vs `check:deploy-env`.**
  - That check ties `.env.example` to the `docs/deploy.md` table, and the table's required/optional rows to the draft deploy workflow. The workflow is STK-084 plumbing.
  - Removing the `SUPABASE_*` lines here would therefore force a deploy-workflow change. So they stay in `.env.example`, labelled legacy, and `STOKTOK_DATABASE_URL` is added as `reserved` ("not passed to containers until a ticket reads them", which matches "no release until STK-084").
  - Follow-up for STK-084: drop the three `SUPABASE_*` lines and rows, and make `STOKTOK_DATABASE_URL` "required now".
- **A4. Vault allow-lists.** "Vault rules unchanged" is read as "same rules and patterns". The moved ai-keys behaviour test needs its new path, `packages/db/test-db/ai-keys.test.ts`, added to both allow-lists. That is a path update for a moved file, not a widened rule.
- **A5. ai-keys error text.** A 22023 from the key functions now reads `ai_keys.set: validation failed [22023]` instead of `… invalid arguments [22023]` (the map hook's fixed text per code, STK-081 errors.ts). The code (`VALIDATION`) and pgCode are unchanged, and the callers (`apps/web/server/ai-keys.ts`) branch on `code` only.
- **A6. Test DB and the Vault stub.** `test-db` runs over the Supabase-shaped migrations with the Vault stub (`scripts/db-check/bootstrap-roles.sql`), so the ai-keys test:db cases are valid until STK-082/083. They carry a `// remove in STK-082` comment. STK-082 should land before STK-083 (STK-081 follow-up).
- **A7. Intermediate commits.** G2–G6 do not typecheck the apps (Approach §1). Ming merges the PR as a whole. If he wants every commit on main to be green, he can squash-merge. This is not blocking.
- **A8. The web alias.** The Turbopack alias for an external `pg` is a top-level `.next/node_modules/pg-<hex>` entry, by analogy with the SDK aliases at `check-image.sh:54-56`. The implementer confirms it with `ls` after `pnpm build` and adjusts the probe regex if the shape differs, recording that.

## Blocking questions
None.

## Split proposal
**Plan as one ticket** (above): one implement/review cycle, 9 ordered commit groups, each with its own gate and tests. I judge this realistic despite the size: the risky decisions are fixed, and most of the diff is one repeated pattern.

**Fallback, if attempt 1's review shows the diff is unreviewable.** The orchestrator can turn this into two tickets without a dual-typed `Db`, by staging new modules beside the old ones:

| Slice | Scope | Leaves main green? |
|---|---|---|
| **085a** | G0, G1, then G2–G5 written as **new** modules `packages/db/src/repos-pg/*.ts` with the full test-db suite, exported only from `@stoktok/db/pg`. The old `src/repos/*`, the index and the apps are untouched. | Yes: apps do not import the new modules. |
| **085b** | `git mv` `repos-pg` over `repos`, then G6–G9 (index alias, deletions, apps, bundling, guards, scripts, docs). | Yes |

The cost of the fallback is that two implementations exist in main until 085b, plus one rename. I do not recommend it up front.

**Follow-ups (not in this diff, R7):**
- Collapse the per-symbol fan-outs into `unnest … cross join lateral`.
- Remove `linesSymbolChunk`, `financialsSymbolChunk`, `resolveChunkSize`, the worker symbol-chunk loops and their "PostgREST row cap" comments (`store.ts:91,106`, `config.ts:106,113,121`).
- `settings.updated_at` never advances on save (parity kept, documented by a test).
- STK-084:
  - drop the legacy `SUPABASE_*` lines from `.env.example`, the `docs/deploy.md` rows and the workflow;
  - set `STOKTOK_DATABASE_URL` to "required now";
  - confirm the shared Postgres statement-logging settings for `ai_key_set` parameters.
- STK-082 removes the ai-keys test:db cases and their Vault allow-list path.
