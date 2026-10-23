# consult-database-optimizer — STK-006

## Findings
- Schema (supabase/migrations/20261023000100_v1_tables.sql):
  - transactions: `seq` is a bigint identity and unique. Index `(symbol, trade_date, seq)`. `fee`, `tax`, `seq` are bigint.
  - corporate_actions: `amount_per_share` is bigint.
  - assets: `value` is bigint.
  - settings: singleton row with `id = 1`. `holidays` is `date[]`. `concentration_threshold_ppm` and `rule_configs` are not covered by `settingsToRow`.
  - watchlist: PK is `symbol`.
  - `quantity` and `price` are int4.
- RLS migration (20261023000200): RLS is on with no policies. anon and authenticated are revoked. service_role has select/insert/update/delete on the 7 tables, plus sequence usage. The service key is the only way in, which fits R3.
- Mappers (packages/core/src/db/mappers.ts):
  - `toSafeInt` already accepts number, bigint or digit string, and throws `RowMappingError` outside the safe range.
  - `transactionFromRow` and `settingsFromRow` throw `RowMappingError`. `settingsFromRow` throws when `fee_rate_ppm` is NULL.
  - There are no mappers for assets or watchlist. The `rows.ts` types have no `AssetRow` or `WatchlistRow`.
  - `corporateActionToRow` takes an `id`. Core's `CorporateAction` has a required `id`, so the repository must generate a UUID on create.
  - `transactionToInsert` accepts an optional `id` and leaves `seq` to the database.
  - `corporateActionToRow` returns `record_date` as `meta.recordDate ?? null`. An update that does not pass `recordDate` would overwrite it with null.
  - `settingsToRow` returns `id: 1`.
- `buildLedger(transactions, corporateActions, settings, asOf)` returns `Result<Ledger>`.
  - It is pure and takes an explicit `asOf`.
  - It does not sort. Core's replay may sort internally, but the repository must not depend on that.
- Package layout:
  - `@stoktok/core` is exported as `./src/index.ts` and has `sideEffects: false`. It is shared by web (via `transpilePackages`) and worker.
  - `apps/web` and `apps/worker` have no Supabase dependency yet.
  - `.env.example` already has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and no `NEXT_PUBLIC_*` keys.
  - Web has `typecheck`, `lint` and `build` scripts but no `test` script. Core is the only package with vitest.

## Recommendations

**1. Location (AC1, R1, R3).**
- Create a new workspace package `packages/db` (`@stoktok/db`). It depends on `@stoktok/core` and `@supabase/supabase-js`.
- Do not put it in `packages/core`. Core must stay pure and I/O-free, and the supabase dependency would otherwise leak into every core import.
- Layout:
  - `src/client.ts`: `createServiceClient(env)` factory.
  - `src/repos/{transactions,corporate-actions,assets,settings,watchlist}.ts`.
  - `src/ledger.ts`: `loadLedger(db, asOf)`.
  - `src/errors.ts`.
  - `src/index.ts`.
- Add it to `transpilePackages` in `next.config.ts`, the same way core is handled.
- Repository functions take the client as the first argument (`listTransactions(db)`). Do not use module-level singletons. This makes mock injection trivial and lets the worker and web each build their own client.
- Add small `AssetRow` and `WatchlistRow` types, with `assetFromRow` and `watchlistFromRow` mappers. Asset and watchlist mapping contains no financial calculation, so these can live in the db package.
  - If you want a single mapper home, add them to core `db/` with tests, since R8 requires tests for changed core logic.
  - Either is acceptable. Pick one and stay consistent.
- Create a domain type for assets (`{id, type, name, value, asOf}`). Value is an integer VND via `toSafeInt`.

**2. Client choice and server-only enforcement (AC2, R3).**
- Use `@supabase/supabase-js` `createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })`.
- Do not use `@supabase/ssr`. It is for cookie sessions, and there are no user sessions here.
- Read env only inside `createServiceClient`. Throw a clear error naming the missing variable, and never log the key. Never read `SUPABASE_ANON_KEY` in this package.
- Server-only enforcement in layers:
  - Add `import 'server-only'` (the npm `server-only` package) at the top of the web-side entry that touches the client. In the shared package, a bare `server-only` import would break the worker and vitest, because it throws outside the Next react-server condition.
  - Cleanest split: `packages/db` is framework-neutral and has no `server-only` import. `apps/web/src/server/db.ts` imports `'server-only'`, calls `createServiceClient(process.env)`, and re-exports. Only server code (route handlers, server components, actions) imports `apps/web/src/server/db.ts`.
  - Alternatively, use package `exports` conditions so `@stoktok/db` resolves to a throwing stub under the `browser` condition. This adds complexity and is probably unnecessary.
- Keep the `SUPABASE_SERVICE_ROLE_KEY` name without a `NEXT_PUBLIC_` prefix. Next only inlines `NEXT_PUBLIC_*`, so the unprefixed name is never embedded in client code.
- Add an ESLint `no-restricted-imports` rule (or `import/no-restricted-paths`) in `apps/web`. It should forbid importing `@stoktok/db` from any file with `'use client'`, and forbid `NEXT_PUBLIC_*SERVICE*` or `NEXT_PUBLIC_*KEY*` anywhere.
- Writes: the schema has no RLS policies, so every write goes through service_role. Keep write entry points to server actions or route handlers only. Per the ticket, R6 is waived, so leave a single documented seam (`assertAuthorized()` as a no-op stub that throws nothing). That way STK-004 wires in without touching the repos. Do not invent partial auth.

**3. Query shapes and ordering (AC1, AC5).**
- Transactions list: `.from('transactions').select('id,seq,trade_date,symbol,side,quantity,price,fee,tax,source,import_batch_id,external_ref').order('trade_date', {ascending:true}).order('seq', {ascending:true})`.
  - Use an explicit column list, not `*`.
  - Optional `.eq('symbol', s)` uses `transactions_symbol_date_seq_idx`.
  - The unfiltered all-symbol ordering is served by a sort on a small table. A single-user ledger has thousands of rows at most, so no new index is needed.
  - Same-day order is by `seq` (insertion order). Do not rely on `created_at`.
- Corporate actions list: order by `ex_date`, then `symbol`, then `id`, so the order is deterministic. The unique `(symbol,type,ex_date)` makes it total enough.
- Settings get: `.from('settings').select(cols).eq('id',1).maybeSingle()`.
  - Missing row should be a typed `NotConfigured` error, not a crash.
  - A NULL `fee_rate_ppm` surfaces as `RowMappingError` from the mapper. Wrap it as a data error with the original as `cause`.
- Settings update: `.upsert(settingsToRow(...), {onConflict:'id'})`. The mapper writes ledger columns only, so check that upsert on the existing row leaves `concentration_threshold_ppm` and `rule_configs` alone. PostgREST upsert only sets the columns provided, so it is safe. Add a test asserting the payload keys.
- Assets: order by `as_of desc`, then `id`. Watchlist: order by `symbol`.
- Pagination: PostgREST caps responses at the project's `max_rows` (default 1000). A ledger read that silently truncates would produce a wrong cost basis.
  - Page with `.range(from, from+999)` in a loop until a short page, ordered by `(trade_date, seq)` so paging is stable.
  - Or, at minimum, assert `data.length < limit` and throw if the cap is hit.
  - Prefer the loop for `transactions` and `corporate_actions`.
  - Paging across separate requests is not snapshot-consistent. This is acceptable for a single user, but note it in the code.
- Ledger read `loadLedger(db, asOf)`:
  - Fetch the three sources with `Promise.all`.
  - Map them, then return `buildLedger(txs, cas, settings, asOf)` unchanged.
  - `asOf` is an explicit parameter, with a default computed in the caller at an Asia/Ho_Chi_Minh date. Do not call `new Date()` inside the repo, which keeps it testable and keeps date logic out of the data layer.
  - Return the `Result<Ledger>` as-is. Do not compute totals.
- Creates: use `.insert(...).select(cols).single()` to return the mapped row, so the caller sees the generated `seq`.
- Bulk import (later): a single `.insert([...])` preserves array order for the identity `seq`. Document that file order equals array order.
- Updates and deletes: add `.select().maybeSingle()` or check the count. A no-op on a missing id should produce a `NotFound` error, not a silent success.

**4. bigint over PostgREST.**
- PostgREST serialises int8 as JSON numbers, and supabase-js parses with `JSON.parse`. Values above 2^53 lose precision silently, before the mapper sees them.
- Safe-integer VND amounts are fine. Max is about 9.0e15 VND, far above any personal portfolio.
- Always pass bigint columns through `toSafeInt`, which already handles number, bigint and digit string. The type `Int8 = number | bigint | string` already covers this.
- Do not add casts like `Number(row.fee)`. Use the mappers.
- Writes: send plain JS numbers. `toSafeInt`-validated values are safe in JSON. If anything is ever a bigint, `JSON.stringify` throws, so convert at the boundary.
- `date` columns arrive as `'YYYY-MM-DD'` strings via PostgREST, so the mapper's Date guard is satisfied. `date[]` arrives as a string array.
- Add one test with `seq: '9007199254740993'` (string) expecting a `RowMappingError`, and `'123'` expecting 123. This documents the contract.

**5. Error handling.**
- Define `DataError` with `code`: `'DB_ERROR' | 'NOT_FOUND' | 'NOT_CONFIGURED' | 'CONFLICT' | 'MAPPING'`. Keep `cause`, and include the table and operation in the message.
- Map PostgREST error code `23505` to `CONFLICT`. This covers the unique `(source, import_batch_id, external_ref)` for idempotent imports, and `(symbol,type,ex_date)` for corporate actions. Map `23514` and `22P02` to validation errors.
- Rule for throw vs return: repositories throw `DataError` and the web layer converts to a response. `buildLedger`'s `Result` stays a value.
- Never include row payloads, the URL or the key in error messages. Include the Postgres code and a generic message only.
- Always check the `error` field before reading `data`. supabase-js does not throw. A helper `unwrap(res, ctx)` centralises this. Treat `data === null` without an error as a bug, and throw.
- Note the mapper's `RowMappingError` message names `table.field` only, with no values. That is fine to propagate.

**6. Unit tests with a mocked client (AC5).**
- Write a tiny hand-rolled fake query builder in the db package's test helper. It is chainable (`select/order/eq/range/insert/upsert/update/delete/single/maybeSingle`) and records calls into an array. It resolves to `{data, error}` when awaited (implement `then`).
- This gives assertions on the recorded order calls (`['trade_date','seq']`), the column list, and the payload.
- Do not simulate Postgres. Cover:
  - Row to domain mapping, including string bigints.
  - A same-day ordering test. Two rows with the same `trade_date` and `seq` 2 then 1, returned unsorted by the fake. Assert the recorded `.order()` calls are `trade_date asc, seq asc`, and run an end-to-end `loadLedger` with the fake returning rows already sorted per spec. Because the fake does not sort, also include a test that feeds out-of-order rows through the repo and checks the outcome. Either add a defensive `sortTransactions` (tie-break `(tradeDate, seq)`) in the repo after mapping, or accept that the DB does the ordering and prove it by the recorded order clause.
    - Defensive sort is cheap and worth it. It is comparison logic, not financial calculation.
  - Pagination loop (page 1 full, page 2 short).
  - Error mapping (`23505` to `CONFLICT`, `error` set to `DB_ERROR`, null data).
  - Update and delete not-found.
  - A settings upsert payload that contains no `rule_configs` or `concentration_threshold_ppm`.
  - `loadLedger` that calls `buildLedger` with the mapped inputs and passes through the Result unchanged. Spy on `buildLedger`, or use one tiny real scenario with a known expected quantity.
- The auth-before-query AC is waived with R6. Add a placeholder `test.todo('no query before auth (STK-004)')` so it is not forgotten.
- Add a `test` script and vitest devDependency to the new package, since root `pnpm test` must run it (R8).

**7. Proving the service key never reaches a client bundle (AC2, R3).** Use three checks, in CI-friendly order.
- Static check: a vitest or node script under `packages/db` or `apps/web` that greps the sources.
  - No `NEXT_PUBLIC_` string next to `SERVICE_ROLE`.
  - `.env.example` has no `NEXT_PUBLIC_` key at all.
  - `SUPABASE_SERVICE_ROLE_KEY` is referenced only in the one server file (`createServiceClient` or `apps/web/src/server/db.ts`) and in the worker entry.
  - Also grep `'use client'` files for imports of `@stoktok/db` or the server module.
- Bundle check (the real proof): run `pnpm --filter @stoktok/web build` with `SUPABASE_SERVICE_ROLE_KEY` set to a unique sentinel, for example `sb-service-SENTINEL-<random>`.
  - Then grep `apps/web/.next/static` (the client output) for the sentinel, for the string `SUPABASE_SERVICE_ROLE_KEY`, and for `service_role`. Expect zero hits.
  - A positive control is worth adding. Grep `.next/server` and confirm the module does exist there. Alternatively, intentionally verify the check by importing the module from a client component on a scratch branch and seeing the build fail via `server-only`.
  - Put this in a script (`scripts/check-no-service-key-in-client.sh`) and run it in CI after `build`. Record the one-time evidence in impl-log.
- Build-time guard: `server-only` makes `next build` fail if a client component imports the web server module. That is the compile-time enforcement.
- Do not use `process.env.X` destructuring tricks or `next.config` `env:` entries for the key. The `env:` key inlines values into the bundle.

## Risks
- **Silent truncation at max_rows (1000):** a ledger read that drops transactions gives wrong P&L with no error. Mitigate with the paging loop or a hard failure at the cap.
- **Non-snapshot paging:** a write between pages can duplicate or skip a row. Acceptable for a single user, and worth noting in a comment.
- **`corporateActionToRow` nulls `record_date`** when `meta.recordDate` is omitted. A repository `update` built on it would erase `record_date` silently. Either carry `recordDate` through the repository API, or build an explicit partial update.
- **Corporate action create needs an `id`:** the domain type requires one. Generate a UUID in the repo (`crypto.randomUUID()`) and don't let callers pass a fabricated one.
- **Service role bypasses RLS entirely:** with no policies, any bug in a repo method is unconstrained. Keep all writes to explicit columns and validate input through core before insert.
- **Worker key sharing:** the worker holds the same service key. It is server-side, so it is acceptable. Keep it out of images' build args and logs.
- **Waived auth:** until STK-004, any server route that calls a repository is unauthenticated. The Cloudflare Tunnel exposure of those routes is a real risk if the web app is deployed before auth. Ensure no route handlers or actions are exposed in v1 deploys until auth lands, or put Cloudflare Access in front. This should be flagged in the ticket.
- **Dependency choice:** `@supabase/supabase-js` is a new dependency. This is within the stack (Supabase). Pin a version and let the planner confirm.
- **`holidays: row.holidays` is passed through without per-element validation** in `settingsFromRow`. Possibly worth a follow-up (R7: put it in the follow-ups, not this diff).

## Open questions
- New `packages/db` workspace versus a `server/` folder inside `packages/core`? I recommend the former. This needs Ming's or the planner's confirmation, since it adds a package to the stack layout, though not a new technology.
- Do assets and watchlist mappers go in core `db/` (needs tests under R8) or in the db package? Default recommendation is the db package, since they are trivial and contain no financial rules.
- Which `asOf` default does the web layer pass to `loadLedger`: today in Asia/Ho_Chi_Minh? Does core have a helper? I saw none in the index exports.
- What is the PostgREST `max_rows` on the stoktok Supabase project? The paging loop makes this moot, but it determines page size.
- Should the repository expose update and delete for transactions in v1? The ledger replays history, so editing a past trade changes all later results. Spec §4.1 should say. The ticket says "as needed".
- Is a test runner expected for `apps/web`? There is none now. The bundle check can be a shell script and does not need vitest there.
