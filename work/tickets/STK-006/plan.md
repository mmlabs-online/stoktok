Status: READY

# Plan — STK-006: Server data layer for ledger, assets, settings

## Spec summary
- docs/spec-v1.md §4.1: "`web` | Next.js UI and API routes; reads/writes app DB; verifies Authen JWT + allowlist" and "`worker` | Scheduled jobs …".
- docs/spec-v1.md §4.2: "App data lives in a **separate Supabase project**" and "Open question: how the app DB's RLS trusts the Authen JWT (shared JWT secret vs server-side service role with app-level checks)." STK-003 already settled this: RLS is on, there are no policies, and only service_role has grants. So this ticket uses "server-side service role".
- docs/spec-v1.md §5: "`transactions` | id, date, symbol, side, quantity, price, fee, tax, source (`manual`/`import`), import_batch_id", "`corporate_actions` | id, symbol, type, record_date, ratio/amount, applied", "`assets` | id, type (`cash`/`other`), name, value, as_of", "`watchlist` | symbol, group, added_at", "`settings` | fee_rate, tax_rate, concentration_threshold, rule configs", and "Holdings and P&L are **derived** from `transactions` + `corporate_actions` + `lots`, never stored as editable balances."
- CLAUDE.md R1 (no financial calculation outside core), R3 ("Service role key is server-only … Never in `NEXT_PUBLIC_*`, never in client bundles. The browser never talks to the DB directly.").
- CLAUDE.md R6 is suspended by Ming (2026-10-23): "Do not add auth code … Ticket criteria that say … 'calls the auth helper' are waived until R6 is restored. Keep server-only data access anyway (R3 still applies)". So **AC3 is waived** (ticket note agrees). The plan adds no auth code. It only keeps one server entry module, where `requireUser()` can be added later with one call.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Repositories for `transactions`, `corporate_actions`, `assets`, `settings`, `watchlist` use the STK-003 row↔core mappers; no raw rows leak to callers. | The tests in `packages/db/src/repos/*.test.ts` (listed below) pass. Reading the code shows every public repo function returns core domain types (`Transaction`, `CorporateAction`, `LedgerSettings`) or the db package's `Asset` / `WatchlistEntry`. No exported function has a `*Row` type in its return type. `grep -rn "Row\b" packages/db/src/index.ts` shows no row-type exports. |
| 2 | The service-role client lives in a server-only module, a check proves it is not in any client bundle, and no `NEXT_PUBLIC_*` key holds it (R3). | (a) `apps/web/server/db.ts` starts with `import 'server-only'`, and it is the only web file that imports `@stoktok/db`. (b) `packages/db/src/r3-guard.test.ts` passes inside `pnpm test`. It runs static checks on `.env.example`, sources and `'use client'` files. (c) `pnpm check:service-key` passes. It builds web with a sentinel key and finds 0 hits in `apps/web/.next/static`. The implementer records the output in impl-log. |
| 3 | Every web entry point calls the STK-004 auth helper first (R6). | **Waived** (R6 suspended; ticket note). The reviewer checks two things: no auth code was added, and `packages/db/src/ledger.test.ts` contains `test.todo('no query before auth (STK-004)')`. |
| 4 | A ledger read loads transactions + corporate actions + settings and returns core `buildLedger`'s result; no cost/P&L/quantity math outside core (R1). | Tests `ledger.test.ts › passes mapped inputs to buildLedger and returns its Result unchanged` and `› same-day trades reach buildLedger in (tradeDate, seq) order`. The reviewer also reads `packages/db/src/**`: there must be no arithmetic on quantity, price, fee, tax or amounts. The only comparisons allowed are in the sort comparator. |
| 5 | Unit tests with a mocked Supabase client cover mapping, ordering of same-day trades, and the auth-before-query rule. | `pnpm --filter @stoktok/db test` is green. The tests listed below exist and use `packages/db/test/fake-client.ts`. The auth-before-query part is a `test.todo` (waived with AC3). |
| — | Checks green (R8) | `pnpm typecheck && pnpm lint && pnpm test` pass. `pnpm db:check` still passes; the schema is not changed. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/db/package.json` | New `@stoktok/db` package: `type: module`, `sideEffects: false`, `exports: {".": "./src/index.ts"}`, scripts `typecheck`/`lint`/`test` (same as core). Deps: `@stoktok/core: workspace:*` and `@supabase/supabase-js` (current stable, caret like the other deps). Dev deps: `vitest` (same range as core) and `@types/node`. | AC1/AC2. Keeps I/O out of core (consult §1). R8: root `pnpm test` runs it. |
| `packages/db/tsconfig.json` | Same as core, plus `"types": ["node"]` and `include: ["src", "test"]`. | Typecheck. Needs `node:crypto` and `node:fs` (guard test). |
| `packages/db/vitest.config.ts` | Same as core. | Test runner. |
| `packages/db/src/index.ts` | Public exports: `createServiceClient`, `Db` type, `DataError`, every repo function, `loadLedger`, and the `Asset` / `WatchlistEntry` types. No row types. | AC1 (no raw rows leak). |
| `packages/db/src/client.ts` | `export type Db = Pick<SupabaseClient, 'from'>`. `createServiceClient(env)` reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the `env` argument only. It throws `Error('Missing env <NAME>')` with no values in the message, then calls `createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })`. No module-level singleton. | AC2/R3 (consult §2). |
| `packages/db/src/errors.ts` | `DataError` with `code: 'DB_ERROR' \| 'NOT_FOUND' \| 'NOT_CONFIGURED' \| 'CONFLICT' \| 'VALIDATION' \| 'MAPPING'`, plus `table`, `op`, optional `pgCode`, and `cause`. The message is `${table}.${op}: <generic text> [pgCode]` and never includes payloads, error details, the URL or the key. `unwrap(res, ctx)` throws on `error` (23505→CONFLICT; 23502/23514/22P02→VALIDATION; else DB_ERROR) and treats `data === null` with no error as DB_ERROR. `fetchAll(page(from,to), ctx, pageSize = 1000)` loops `.range()` until it gets a short page. `mapRow(fn, ctx)` wraps `RowMappingError` as MAPPING, with the original as `cause`. | Consult §3 (truncation risk), §5. |
| `packages/db/src/rows.ts` | `AssetRow { id; type; name; value: Int8; as_of }` and `WatchlistRow { symbol; group_name; added_at }`, using core's `Int8`. Not exported from the index. | Mappers for assets/watchlist are missing (consult findings). |
| `packages/db/src/mappers.ts` | `assetFromRow` (type check `cash`/`other`; `value` via core `toSafeInt`; `as_of` checked as `YYYY-MM-DD`, see Assumptions), `assetToRow`, `watchlistFromRow`. On bad input they throw core `RowMappingError`. | AC1. Consult §1: trivial mapping with no financial rules, so it stays in the db package. |
| `packages/db/src/repos/transactions.ts` | `listTransactions(db, {symbol?})`, `createTransaction(db, input, meta)`, `updateTransaction(db, id, input)`, `deleteTransaction(db, id)`. Uses an explicit column list. Reads are ordered `trade_date asc, seq asc`, paginated via `fetchAll`, mapped with `transactionFromRow`, then defensively sorted with `compareTransactions` (tradeDate, then seq). Create uses `transactionToInsert` with no caller id: `.insert().select(cols).single()`. Update writes only `trade_date, symbol, side, quantity, price, fee, tax` (taken from `transactionToInsert`'s output) and uses `.eq('id').select(cols).maybeSingle()`, giving NOT_FOUND on null. Delete uses `.delete().eq('id').select('id')`, giving NOT_FOUND on an empty result. | AC1, AC4/AC5 ordering. |
| `packages/db/src/repos/corporate-actions.ts` | `listCorporateActions(db, {symbol?})` ordered `ex_date, symbol, id` and paginated. `createCorporateAction(db, action: Omit<CorporateAction,'id'>, meta: {recordDate?})` creates the id with `randomUUID()` from `node:crypto`. `updateCorporateAction(db, id, action, meta)` does a full replace through `corporateActionToRow` (the doc comment says omitting `recordDate` clears it). `deleteCorporateAction(db, id)`. | AC1. Consult risks (id required; record_date nulling). |
| `packages/db/src/repos/settings.ts` | `getSettings(db)`: `.eq('id',1).maybeSingle()`. A null row → NOT_CONFIGURED. A `RowMappingError` on field `fee_rate_ppm` → NOT_CONFIGURED (with cause). Any other mapping error → MAPPING. `saveSettings(db, s)`: `.upsert(settingsToRow(s), {onConflict:'id'}).select(cols).single()`. | AC1, AC4. |
| `packages/db/src/repos/assets.ts` | `listAssets(db)` (ordered `as_of desc, id`), `createAsset`, `updateAsset`, `deleteAsset` (NOT_FOUND semantics as for transactions). | AC1 (spec F2 "Cash balance and other assets entered manually"). |
| `packages/db/src/repos/watchlist.ts` | `listWatchlist(db)` (ordered by `symbol`), `addToWatchlist(db, symbol)` (relies on the DB default `group_name`; a duplicate → CONFLICT), `removeFromWatchlist(db, symbol)` (NOT_FOUND). | AC1 (spec F3 "Watching (manual)"). |
| `packages/db/src/ledger.ts` | `loadLedger(db, asOf: string): Promise<Result<Ledger>>` uses `Promise.all([listTransactions, listCorporateActions, getSettings])` and returns `buildLedger(txs, cas, settings, asOf)` unchanged. It does not call `new Date()`. | AC4, R1. |
| `packages/db/test/fake-client.ts` | A hand-rolled chainable fake. `from(table)` returns a builder with `select/eq/order/range/insert/update/upsert/delete/single/maybeSingle` that records `{table, method, args}` and is thenable. Responses are queued per test, e.g. `fake.respond({data, error})`. | AC5 (consult §6). |
| `packages/db/src/**/*.test.ts` | See "Tests to write". | AC5, R8. |
| `apps/web/server/db.ts` | New. Line 1 is `import 'server-only'`. `getDb()` creates the client once, lazily, from `process.env` (via `createServiceClient(process.env)`), and the module re-exports the repo functions and `loadLedger`. It has a comment marking where `requireUser()` goes when R6 is restored. **No auth code.** | AC2/R3, and the CLAUDE.md R6 note "adding `requireUser()` later is one call per entry point". |
| `apps/web/package.json` | Add deps `@stoktok/db: workspace:*` and `server-only`. | AC2. |
| `apps/web/next.config.ts` | `transpilePackages: ['@stoktok/core', '@stoktok/db']`. | The db package ships TS source, same as core. |
| `scripts/check-no-service-key-in-client.sh` | New. Picks a sentinel `sb-service-SENTINEL-$RANDOM$RANDOM` and runs `SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY=$SENTINEL pnpm --filter @stoktok/web build`. It then fails if `apps/web/.next/static` is missing, or if `grep -rF` finds the sentinel, `SUPABASE_SERVICE_ROLE_KEY` or `service_role` in it. It prints the hit counts. | AC2 bundle proof (consult §7). |
| `package.json` (root) | Add script `"check:service-key": "bash scripts/check-no-service-key-in-client.sh"`. | AC2 verification command. |
| `pnpm-lock.yaml` | Updated by `pnpm install`. | New deps. |

There are no changes to `packages/core`, `supabase/` or `apps/worker`.

## Tests to write
All tests live in `packages/db` and use `test/fake-client.ts`, except the guard test.

| Test (file › name) | Covers |
|---|---|
| `src/repos/transactions.test.ts › list selects explicit columns and orders trade_date asc then seq asc` | AC5 ordering (query shape) |
| `› list returns same-day rows sorted by seq even if the client returns them out of order` (same `trade_date`, fake returns seq 3 then 2) | AC5 same-day ordering (defensive sort) |
| `› list maps string bigint seq/fee ('123' → 123)` | AC1 mapping, consult §4 |
| `› list throws DataError MAPPING when seq is '9007199254740993'` | Bigint contract |
| `› list with symbol adds eq('symbol', …)` | Filter |
| `› list pages with range until a short page` (pageSize 2: page 1 has 2 rows, page 2 has 1 row → 3 results, ranges `[0,1]`, `[2,3]`) | Truncation risk |
| `› create inserts transactionToInsert payload without id or seq and returns mapped row` | AC1 |
| `› update writes only trade fields and returns NOT_FOUND when no row` | AC1, not-found |
| `› delete returns NOT_FOUND when nothing deleted` | Not-found |
| `src/repos/corporate-actions.test.ts › list orders ex_date, symbol, id and maps cash + stock dividends` | AC1 |
| `› create generates a uuid id and passes recordDate through` | Consult risk (id) |
| `› create maps pg 23505 to CONFLICT` | Errors |
| `src/repos/settings.test.ts › get maps the singleton row (eq id 1)` | AC1 |
| `› get with no row throws NOT_CONFIGURED` | Errors |
| `› get with NULL fee_rate_ppm throws NOT_CONFIGURED with RowMappingError cause` | Errors |
| `› save upserts on id with payload keys excluding rule_configs and concentration_threshold_ppm` | Consult §3 |
| `src/repos/assets-watchlist.test.ts › assets list orders as_of desc, id and maps bigint value` | AC1 |
| `› asset with invalid type throws MAPPING` | Mapping |
| `› watchlist list orders by symbol and maps entries` | AC1 |
| `› addToWatchlist duplicate → CONFLICT; remove missing → NOT_FOUND` | Errors |
| `src/errors.test.ts › unwrap: error → DB_ERROR, 23514 → VALIDATION, null data without error → DB_ERROR` | Consult §5 |
| `› DataError message contains table, op, pg code but not error.details/message payload` | No payload leak |
| `src/client.test.ts › createServiceClient throws naming the missing variable without echoing values` | R3 |
| `› createServiceClient returns a client given both vars` (no network call) | R3 |
| `src/ledger.test.ts › passes mapped inputs to buildLedger and returns its Result unchanged` (`vi.spyOn` or a `vi.mock` of `@stoktok/core` `buildLedger`; assert the args are domain objects and the asOf is passed through) | AC4 |
| `› same-day trades reach buildLedger in (tradeDate, seq) order` (real buildLedger: D0 buy 100@10000; on D5 the fake returns the seq-3 buy 100@20000 before the seq-2 sell 100; expect `ok: true` and a result deep-equal to `buildLedger` on the correctly ordered inputs) | AC4/AC5 |
| `› propagates DataError NOT_CONFIGURED from settings` | AC4 |
| `› test.todo('no query before auth (STK-004)')` | AC3 / AC5 (waived) |
| `src/r3-guard.test.ts › .env.example has no NEXT_PUBLIC_ key` | AC2 |
| `› no source file under apps/ or packages/ (excluding node_modules, .next, dist) contains NEXT_PUBLIC_ next to SERVICE or KEY` | AC2 |
| `› SUPABASE_SERVICE_ROLE_KEY is referenced only in packages/db/src/client.ts (and its tests)` | AC2 |
| `› no file containing 'use client' imports @stoktok/db or server/db` | AC2 |
| `› apps/web/server/db.ts starts with import 'server-only'` | AC2 |

## Approach
1. Scaffold `packages/db` (package.json, tsconfig, vitest config), add the web deps, run `pnpm install`, and update `next.config.ts`.
2. Write `errors.ts` (`DataError`, `unwrap`, `fetchAll`, `mapRow`) and `client.ts`. `fetchAll` gets a comment noting that pages are not snapshot-consistent, which is acceptable for a single user.
3. Write `rows.ts`/`mappers.ts` for assets and watchlist.
4. Write the five repos. Every function takes `db: Db` as its first argument, selects explicit column lists (no `*`), checks `error` before `data` (via `unwrap`), and maps every row through a mapper before returning. R1: repos do no arithmetic on money or quantities. Validation is left to the DB constraints, which surface as VALIDATION.
5. Write `ledger.ts` `loadLedger(db, asOf)`. R1: all calculation is in core `buildLedger`. The caller supplies `asOf`.
6. Write `apps/web/server/db.ts` with `server-only`. R3: the key is read only from `process.env` at runtime, never from `next.config` `env:`, and has no `NEXT_PUBLIC_` prefix. R6: no auth code, only a comment seam.
7. Write the fake client and the tests above. Write the guard test and the bundle-check script. Run `pnpm check:service-key` once and paste the output into impl-log.
8. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm db:check`.

Other rules: R2 (integers only, via `toSafeInt`; JS numbers are sent on write), R5 (no market constants), R7 (follow-ups below go to impl-log, not into the diff), R10 (not affected).

A real-Postgres integration check does not help here. The repos talk to PostgREST, which is not available locally. `pnpm db:check` is run only as a regression check, since the schema is unchanged.

## Specialist input used
From consult-database-optimizer.md:
- **Adopted**
  - §1: a new `packages/db` package with client-first repo functions.
  - §1: assets/watchlist mappers live in the db package.
  - §2: plain supabase-js with session features off; `server-only` only in the web module.
  - §3: explicit columns, `(trade_date, seq)` order, pagination loop, defensive sort, upsert for settings, NOT_FOUND on update/delete.
  - §4: everything goes through `toSafeInt`, with string-bigint tests.
  - §5: `DataError` and `unwrap`, with no payloads in messages.
  - §6: fake builder and the listed test cases.
  - §7: static guard (as a vitest test so it runs in `pnpm test`) and the sentinel bundle check.
  - Risks: generate the UUID in the repo; full replace for corporate-action updates, with the recordDate behaviour documented.
- **Rejected**
  - The `assertAuthorized()` no-op stub, because CLAUDE.md says "Do not add auth code". A comment seam is used instead.
  - The ESLint `no-restricted-imports` rule, because it cannot key on `'use client'`. The guard test covers this.
  - The `.next/server` positive control, because no page imports `server/db` yet, so it would fail spuriously.
  - The package `exports` browser stub, because it is unnecessary, as the consult itself says.
- **Deferred** (follow-ups): validating each element of `holidays`; a settings read for the edit form that tolerates a NULL fee rate; Cloudflare exposure before auth.

## Assumptions
These are non-blocking defaults. **Flag them for Ming.**
- **New workspace package `packages/db`.** This adds a package, not a technology (Supabase is already the stack's DB). If Ming prefers `apps/web/server/` plus duplication in the worker, it is easy to move.
- **Transactions and corporate actions get update and delete in v1.** "As needed" covers fixing typos in manual entries (F1). Editing a past trade changes everything after it, and that is by design, because the ledger replays history.
- **The repo does not accept caller ids on create.** The DB generates ids for transactions; the repo generates UUIDs for corporate actions. The import-path idempotency key is `(source, import_batch_id, external_ref)` and maps to CONFLICT.
- **A NULL `fee_rate_ppm` surfaces as `NOT_CONFIGURED`**, the same as a missing settings row, so the UI can prompt for the TCBS rate.
- **`loadLedger` requires an explicit `asOf`.** No "today in Asia/Ho_Chi_Minh" helper is added here. The first page that uses it adds one, in core.
- **The worker is not wired to `@stoktok/db` in this ticket.** No worker job needs it yet. The package is framework-neutral so the worker can import it later.
- **`isValidDate` is not exported from the core index.** The asset mapper should validate `as_of` with a local `YYYY-MM-DD` regex rather than change core (that would be a core change, R7). If the implementer finds a cleaner option, they record why in impl-log.
- **TS 6 may enforce `noUncheckedSideEffectImports`.** If `import 'server-only'` then fails typecheck, add a minimal `apps/web/server/server-only.d.ts` (`declare module 'server-only';`) and log it.
- **`@supabase/supabase-js` version:** use the current stable major at install time and record the version in impl-log.
- **Security exposure:** until R6 is restored, any future route that calls these repos is unauthenticated. CLAUDE.md already records the go-live decision (STK-004 or Cloudflare Access). Nothing in this ticket adds a route.
- **Line budget:** about 350 lines of source and about 400 lines of tests. That is over the rough guide, but it is one cohesive feature and the tests make up most of it, so it is not split.

## Blocking questions
None.

## Split proposal
None.
