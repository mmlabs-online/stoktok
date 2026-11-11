## STK-081 consult (worker side, slice b): delta on the STK-080 data-engineer consult

I read `cli.ts`, `store.ts`, `ai.ts`, `store.test.ts`, `ai.test.ts`, `config.ts:70-125`, `data-gaps.ts`, the job `resolve-holiday-gaps.ts`, and slice a's `packages/db/src/pg/{client,config,upsert}.ts`. I did not open the other repos or the job tests.

### Findings

1. **`PgDb.end()` is not idempotent, and it is the lifecycle hinge.**
   - `end: () => kysely.destroy()` (`pg/client.ts:71`) calls `pool.end()`. pg-pool throws "Called end on pool more than once" on a second call.
   - The ticket wants `await end()` in `finally` including the `.catch` path, and `ai.ts` reusing the CLI pool. Both paths could end it twice.
   - Recommendation: make `end()` idempotent by memoizing the promise inside `createPgDb`. Add a test: `end()` twice resolves, and `pool.totalCount` is 0.

2. **`cli.ts` pool lifecycle.**
   - `db` is created at `cli.ts:73` and every job branch (`:75-152`) shares it. Output and `process.exitCode` are set at `:153-154`. `main().catch` at `:159-162` only logs.
   - The pool must be created after the `parseArgs` early return (`:66-70`, exit code 2). Today the client is built after it, so keep that order. Otherwise a usage error opens a pool that is never ended.
   - `createPgDb` throws synchronously on a missing or invalid `STOKTOK_DATABASE_URL` (`client.ts:25-26`). That happens at `:73`, so wrap it too. The `.catch` already prints `e.message`, which is the fixed text there, so no leak.
   - Recommended shape: `const db = createPgDb(process.env, 'worker'); try { …branches…; console.log(…); process.exitCode = … } finally { await db.end() }`.
   - `end()` in `finally` must not mask the job result. Wrap it as `await db.end().catch(() => undefined)`, otherwise a drain error replaces the original error, or a successful summary with exit code 0.
   - The `.catch` at `:159` then needs no end of its own, provided `finally` covers every post-creation path. The ticket's "including the `.catch` path" is satisfied if `createPgDb` is inside `main`'s `try`. Do not hoist the pool to module scope just to end it in `.catch`.
   - `cli.test.ts` imports `parseArgs` and guards `main` with the entry check (`:158`), so it is unaffected. Add one test that the entry path exits (see test 4 below).

3. **Pool sizing versus code shape (`pg/config.ts:16`).**
   - The worker profile is `max: 2`. A chunked upsert transaction holds one connection. The fan-outs (finding 6) are `Promise.all` over symbols. The AI ledger and key reads (finding 5) use the same pool.
   - Nothing deadlocks while a transaction callback only uses its own `trx` connection. A callback that calls back into the pool-level `db` while holding a connection (for example `await db.kysely…` inside `transaction().execute`) would take the second connection, and a nested pair of them would hang until `connectionTimeoutMillis` (5 s).
   - Rule for the repos: inside a transaction callback use only `trx`.
   - `statementTimeoutMs` is 120 s for the worker. A single 500-row chunk is far below it, but one transaction over all chunks counts per statement, not per transaction. That is fine.

4. **Stale chunk and page configs once the 1000-row cap is gone.**
   - Dead (remove the field, the passing at `cli.ts`, and the `store.ts` loops):
     - `linesSymbolChunk` (`config.ts:106-107`, comment cites the cap; used at `cli.ts:109`, `store.ts:86,94-95`).
     - `financialsSymbolChunk` (`config.ts:113-114`; used at `store.ts:107,116-117,126-127`, in the signals store, for both financials and corporate actions).
     - `gapsPageSize` and `HOLIDAY_GAPS_CONFIG.pageSize` (`config.ts:119-120,204`; `store.ts:64,144`; `cli.ts:87`).
     - The `{ pageSize }` options on `listAllOpenGaps`. The repo signature can keep an ignored option for caller compatibility, but there is no reason to once store.ts stops passing it. Remove them in this slice because callers are all in the worker (store.ts) and the tests below.
   - Still useful:
     - `upsertChunkSize: 500` (`config.ts:25,78,93,112`). It is not a cap workaround. It bounds statement size and bind parameters. With `upsertInto`, a 500-row chunk of about 15 columns is under 65,535 parameters.
     - `chunkForParams` (`upsert.ts:50`) already derives a safe chunk size from the column count. Keep `chunkSize` as an upper bound and apply `chunkForParams` on top, or drop the config and use `chunkForParams` alone.
     - `resolveChunkSize: 200` (`config.ts:121-122`, `resolve-holiday-gaps.ts:50-51`). The comment says "keep the request URL short". That reason is gone. The loop is harmless, but it is now N separate autocommit statements.
     - Recommendation: remove the job-side loop in `resolve-holiday-gaps.ts:50-52` and call `resolveGaps(ids)` once (`= ANY($1::bigint[])`).
     - If you keep it, note that it is job logic outside the repo (R7: touching a job changes `resolve-holiday-gaps.test.ts:51-54`, the "ids are sent in chunks" test). My view: remove it, because it is the same dead-weight class as the rest and the test is small.
   - `config.test.ts:45-47` asserts `insertChunkSize < 1000` and `gapsPageSize <= 1000`. It is a cap guard and must be deleted or rewritten. Check the other config tests for cap assertions (`:5` is unrelated).
   - `news.ts:7` comment ("under the PostgREST 1000-row cap") and `store.ts:91,106` comments go too.
   - Keep `insertChunkSize` only if you keep chunked news inserts; one `insert … on conflict do nothing returning id` per chunk of 200 is fine.

5. **`ai.ts` reusing the CLI pool.**
   - `createWorkerAi` currently falls back to `createServiceClient(env)` when `db` is absent (`ai.ts:11`). It is not called from `cli.ts` today (STK-073 plan: no job uses it).
   - Port it by making the handle mandatory, `{ env?; db: PgDb }`, with no fallback that creates a pool. The caller (the future job in `cli.ts`) passes the same `db`. A fallback that creates its own pool would have no owner to end it and would hang the process, which is exactly the leak finding 1 guards against.
   - The ticket text says "reuse the CLI pool", so make `db` required.
   - `ai.ts:14,15` pass `db` to `readAiKeySecrets` and `aiUsageLedger`. Both are repo-level and take `PgDb` after the port. The ledger calls `ai_reserve`, `ai_month_spend`, and the guarded `settle` update. Each is its own statement, so keep them outside any caller transaction (STK-080 recommendation 4, still holds).

6. **Per-symbol fan-out.**
   - They are `getLatestCloses`, `getFirstPriceDates`, `getRecentCloses` (`prices-daily.ts:10-30,86-104,107-124`) and `listLatestSignals` (`signals.ts:13-37`), `Promise.all` per symbol.
   - With `max: 2` they queue on the pool and still complete, but they now cost N round trips and N pool checkouts, and there is no common snapshot.
   - Which worker jobs rely on them: `getLatestCloses` and `getFirstPriceDates` in EOD (`store.ts:47,53`), `getRecentCloses` in the signals job (`store.ts:113`).
   - Option for this slice (my recommendation): port 1:1 first with the same `Promise.all` shape (R7 and "same exported functions and signatures"), then collapse only the three prices fan-outs in the same PR if each gets a test-db test, because the collapsed SQL is where the risks are (below).
   - Defer `listLatestSignals`, which the web owns, to a follow-up.
   - If collapsing:
     - Latest and first: `select distinct on (symbol) … where symbol = any($1::text[]) order by symbol, trade_date desc|asc`.
     - Recent: `row_number() over (partition by symbol order by trade_date desc) <= $n`.
     - The result must still key by symbol and sort exactly as the current mappers expect (check ascending or descending output in `prices-daily.ts:107-124` before changing).
     - A symbol with no rows must still be absent (or whatever the current code returns, for example `{}` entries).
     - An empty `symbols` array must short-circuit before the query, as the current functions do (verify), since `= any('{}')` is fine but needless.

7. **Transactions for chunked upserts.**
   - Sequential chunk loops in `upsertPricesDaily` (`prices-daily.ts:130-144`), `upsertSignals` (`signals.ts:43-57`), `upsertFinancials` (`financials.ts:28-35`), `upsertFinancialLines` (`financial-lines.ts:33-40`), `upsertPricesIntraday` (`prices-intraday.ts:39-46`), `upsertLotteryDraws` (`lottery.ts:109-119`), and `insertNews` (`news.ts:10-18`).
   - Do wrap the multi-chunk upserts in `db.kysely.transaction().execute(trx => …)` through `run()`. They are idempotent. All-or-nothing is a real gain, because a half-written EOD batch followed by a failure otherwise leaves rows the gap logic then treats as present.
   - For single-chunk inputs, skip the transaction (one statement is already atomic). That keeps the common small case at one round trip.
   - `insertNews` is the exception. Its return is a count of inserted rows and the job treats it as "what actually landed". With `on conflict (url) do nothing returning id`, a later chunk failing after a transaction rollback means count 0 and a thrown error, which the job already surfaces. Decide and record it: a transaction here is consistent with the others, but is not needed. I would leave `insertNews` as plain sequential chunks (no behaviour change) unless you want uniformity.
   - Within one `insertNews` statement, duplicate urls are harmless (DO NOTHING, no `21000`), but the returned count would be of distinct inserts, which is the right count. The current code does not dedup (`news.ts:10-18`). Do not add a dedup that changes the count semantic.
   - Other repos' in-JS dedup stays (`prices-daily.ts:136-138`, `signals.ts:49-51`) because `DO UPDATE` with a repeated key raises `21000` (`upsert.ts:25`). Confirm financials, financial-lines, intraday and lottery also dedup (the STK-080 open point). The `upsertInto` helper does not dedup.
   - Return count must stay `unique.length` (prices, signals) or the existing semantic per repo, not `rowCount` summed over chunks, unless they are the same. Check that `rowCount` of an `on conflict do update` counts updated plus inserted rows (it does), so both agree, but keep `unique.length` to avoid drift.
   - Transaction callbacks must use `trx` only (finding 3).
   - `upsertInto` throws a plain `Error` (not `DataError`) when rows have different columns (`upsert.ts:38`). Optional fields (for example a missing `volume` on some rows) would make every real batch fail. Check which row types have optional fields and normalise them to explicit null in the repo before calling `upsertInto`, or one row with a `null` and another with `undefined` will throw. This is the likeliest runtime break in the worker, so test it with mixed rows.

8. **Repo behaviours the worker jobs rely on and must keep.**
   - **Dedup, later row wins:** prices and signals, same key sets. Keep the order of "last occurrence wins".
   - **Return counts:**
     - `upsertPricesDaily` and `upsertSignals` return `unique.length`.
     - `insertNews` returns the number actually inserted.
     - The `store.test.ts` mocks check `2`, `7` and `4` are passed through, so only the repo tests change.
   - **Gap guards:**
     - `resolveGaps`: `resolved_at is null` guard, and `resolved_reason` written only when a reason is given (`data-gaps.ts:57-62`). The financials store calls it without a reason (`store.ts:78,102,147`), so SQL must not null-out an existing reason (do not `set resolved_reason = $n` with a null).
     - `extendGaps`: only open rows, `to_ts` only (`:65-69`).
     - Each needs a test-db test that a second run does not overwrite an earlier `resolved_at`.
     - `ids = any($1::bigint[])`. `data_gaps.id` is `bigint`: ids come back from pg as strings, and `openGapFromRow` uses `toSafeInt`. Passing JS numbers for ids is fine. Check the mapper handles a string id. `store.ts:56,65,78,102,147` pass these ids straight back to `resolveGaps`.
   - **`listAllOpenGaps`:**
     - It orders by `id` (`data-gaps.ts:41`) and the `source` filter is optional (`:40`). Whole-result with `order by id asc`.
     - It includes `symbol is null` rows, unlike `listOpenGaps`, which filters by symbol (`:9-22`) and misses market-wide gaps. `listOpenMarketGaps` exists for the latter. Do not merge the three.
     - An empty `symbols` still short-circuits to `[]` (`:10`). Keep that, otherwise `= any('{}')` returns the same, but skip the round trip.
   - **`listPriceDates` and `listCloseHistory`** (`prices-daily.ts:41,69`): the dead `pageSize` option becomes unused. If a test passes `{ pageSize: 2 }` (`prices-daily.test.ts:150`), that test moves to test-db with no paging.
   - **Timestamp string format:** the mappers need strings (`mappers.ts:51,107,147,185,254`) and `fromTs`/`toTs` are fed to `new Date(...)` in `resolve-holiday-gaps.ts:45`. Slice a's `normalizeTimestamptz` (`pg/types.ts:7`) covers it, so the type test should include `data_gaps.from_ts` and `to_ts`.

9. **Worker tests and the old fake client.**
   - The worker tests do not import `fake-client.ts`. `store.test.ts:4-33` mocks the whole `@stoktok/db` module with `vi.fn` and passes `{} as Db` (`:40,52,...`). It never exercises the supabase builder.
   - It survives the swap with mechanical edits: `Db` becomes `PgDb` (`:2` and each `{} as Db`), and `createDbSignalsStore` opts lose `financialsSymbolChunk` etc.
   - It is dead-config tests that need real change:
     - Delete the chunk tests at `:39-47` (`linesSymbolChunk`), `:93-101` and `:102-113` (`financialsSymbolChunk`).
     - Replace them with one-call assertions: `listFinancialLines` called once with all symbols, `listCorporateActions` once with `{ symbols }`.
     - `:130-141` and `:143-157`: drop `{ pageSize }` from the expected `listAllOpenGaps` args (`:137`, `:150`).
   - `ai.test.ts:10,16,24` use `{ rpc } as unknown as Db` and assert on rpc names and payloads (`:11-12,19`, a `{data,error}` shape). Those assertions are tied to supabase and must be rewritten.
   - Two options:
     - Mock the repo functions as `store.test.ts` does: `vi.mock('@stoktok/db')` for `readAiKeySecrets` and `aiUsageLedger`, and assert the wiring (same `db` passed, keys read per `generate`, key-read error gives `provider_unavailable` and logs no secret).
     - That keeps `ai.test.ts` a pure unit test with no DB. Recommended.
     - SQL behaviour (`ai_reserve`, `ai_month_spend`, key reads) is already `test-db` territory.
   - The sentinel leak test (`:21-29`) should make the mocked `readAiKeySecrets` reject with an error whose message contains the sentinel, and still assert the log has no sentinel.
   - Worker `test-db`: there is a gap at job level. Add one worker-level test that runs a job-wired store against the real DB.
     - Suggested: `createDbEodStore(pgDb, …)` doing `upsertPricesDaily` with mixed optional columns and duplicates, `insertGaps`, `resolveGaps` twice, then `await db.end()` and `expect(pool.totalCount).toBe(0)`.
     - Do not start the real `cli.ts` there.
   - `cli.test.ts` pool-lifecycle test: spawn `cli.ts` via `tsx` with a bad `STOKTOK_DATABASE_URL` (a port with nothing listening, `ECONNREFUSED`) and `news --dry-run`. Assert it exits non-zero within a few seconds (`connectionTimeoutMillis` 5 s), proving no hang. Mark it test-db or e2e, not unit, if it needs a process spawn.

10. **Dependencies and build.**
    - `apps/worker/package.json:23` has `@supabase/supabase-js`. Remove it.
    - Add `pg` and `kysely` as worker runtime deps, even though they are reached via `@stoktok/db`, because tsup externalises them and the `check-image.sh` resolve probe resolves from the worker's own `node_modules`. Without them the worker image can fail at `ERR_MODULE_NOT_FOUND` after the build is green.
    - The `store.ts` and `cli.ts` imports of `Db`/`createServiceClient` (`store.ts:29`, `cli.ts:2`, `ai.ts:2-3`) are the only worker source changes besides config.

### Recommendations (tied to the acceptance criteria)

- **Criterion "`await end()` in `finally`"** (`cli.ts:73,153-163`): make `end()` idempotent and swallow drain errors (findings 1, 2). Test pool count 0 after `end()`.
- **Criterion "ai.ts reuse the CLI pool"** (`ai.ts:9-11`): `db` required, no fallback pool (finding 5). Rewrite `ai.test.ts` by mocking the repo functions.
- **Criterion "delete `fetchAll`"** (`errors.ts:54-65`, `errors.test.ts:3,31`): remove the function and its test, and every `pageSize` option and caller (`data-gaps.ts:35-44`, `prices-daily.ts:38-52,66-80`, `corporate-actions.ts:12`, `transactions.ts:22`, config entries per finding 4).
- **`transactions.ts:22-49`:** `count: 'exact'` and `.range()` become `count(*) over()`. Confirm that for an empty page past the end the total is 0, not the real count, and test the page-past-the-end case in test-db (STK-080 raised the equivalent, repeated here because window-count returns no row at all when the page is empty).
- **Criterion "repo behaviour tests move to `test-db/`":** for the worker-used repos, one test each:
  - every upsert conflict key: prices_daily, signals, financials, financial_lines, prices_intraday, lottery_draws;
  - news insert count with a duplicate url inside the batch and an existing url;
  - guarded gap updates (`resolveGaps` with and without a reason, `extendGaps`);
  - mixed optional columns in one batch (finding 7);
  - `listAllOpenGaps` includes null symbol rows and respects `source`.
- Remove the dead config fields and comments, then fix `config.test.ts:45-47` (finding 4).
- **Criterion "typecheck/lint/test green":** after dropping config fields, `cli.ts:87,109` and `store.ts` opts types change, so the typecheck catches any miss.

### Risks

- **Double `pool.end()` throws** (finding 1). Medium: it surfaces as a failed cron run after a successful job.
- **Pool hang on error before the `try`** (finding 2). Medium: a cron job stays alive. A unit-test-only check would not catch it.
- **`upsertInto` batch with differing optional keys throws** (`upsert.ts:38`). High likelihood for rows from adapters that leave optional fields undefined. Normalise per repo and test.
- **Nested pool use inside a transaction callback** can wait for `connectionTimeoutMillis` (5 s) at `max: 2` (finding 3). Low, but a review item.
- **A resolve with a reason set to null** would clear an earlier `resolved_reason` (finding 8). Low, and tested above.
- **All-or-nothing upserts change behaviour on partial failure** (earlier chunks no longer persist). Not a regression, because the writes are idempotent, but say so in the plan so the reviewer does not flag it.
- **Removing config tests removes the only guards against a future cap regression.** Acceptable once the cap is gone.
- **Collapsing the fan-outs changes empty-symbol and ordering results** if not matched exactly (finding 6). Defer if the diff grows.

### Open questions

1. Should the multi-chunk upserts share one transaction per call, with single-chunk skipping it as recommended, or should every upsert go through `transaction()` for uniformity? Record the choice in the plan.
2. `resolve-holiday-gaps.ts:50-52`: remove the job-side `resolveChunkSize` loop (a job-file change, small test change) or leave it as harmless dead config? I recommend removal.
3. Collapse `getLatestCloses`, `getFirstPriceDates` and `getRecentCloses` into set queries in this slice, or port 1:1 and defer (R7)? The STK-080 answer was a follow-up. Is that still the plan?
4. `createWorkerAi`: confirm `db` becomes required (no fallback pool). Nothing else calls it at present.
5. Do the worker `test-db` tests live in `apps/worker/test-db/` or in `packages/db/test-db/` with worker wiring imported? I assumed the former for the store-level test, but check how the `test-db` project is configured.

Files cited: `/home/user/stoktok/apps/worker/src/{cli,store,ai,config}.ts`, `/home/user/stoktok/apps/worker/src/{store,ai,config}.test.ts`, `/home/user/stoktok/apps/worker/src/jobs/resolve-holiday-gaps.ts`, `/home/user/stoktok/apps/worker/package.json`, `/home/user/stoktok/packages/db/src/repos/data-gaps.ts`, `/home/user/stoktok/packages/db/src/pg/{client,config,upsert}.ts`.
