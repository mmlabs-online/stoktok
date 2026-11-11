## STK-080 consult: worker data path, supabase-js to direct Postgres

I read the ticket, `packages/db`, `apps/worker/src/{cli,store,ai}.ts`, the AI migrations and the fake client. I did not read the other 14 repos in full; they come from the grep only, so verify them during the swap. I did not read `scripts/db-check.sh`.

### Findings

**1. One seam, so the blast radius is small.**
- `Db = Pick<SupabaseClient,'from'|'rpc'>` (`packages/db/src/client.ts:3`) is the only type repos see. `createServiceClient(env)` (`client.ts:6-14`) is called in three places: `apps/worker/src/cli.ts:73`, `apps/worker/src/ai.ts:11`, `apps/web/server/db.ts:12`.
- Worker jobs never touch the client. `apps/worker/src/store.ts:42-149` is wiring only and takes `db` as an argument. Job code and `*Store` interfaces need no change, only `cli.ts:73` and `ai.ts:11`.
- Every repo is written against the supabase query-builder (`.from().select().eq().in().order().range()`). Keeping the public functions means rewriting the bodies of all 17 repos. It also means replacing `Db` with a small interface (for example `query(text, params)` plus `tx(fn)`).
- A thin shim imitating the builder is a trap. It would keep PostgREST semantics alive and cannot do `onConflict` partial semantics honestly. Use plain parameterised SQL per repo.

**2. Worker jobs and what each writes.**
- **Prices:** `upsertPricesDaily` (`prices-daily.ts:130-144`) dedups by `symbol|trade_date`, later row wins, then upserts in sequential chunks (default 500, from `opts.upsertChunkSize`, `store.ts:51`) and returns `unique.length`. Intraday and lottery draws follow the same pattern (`prices-intraday.ts:46`, `lottery.ts:119`).
- **Signals:** `upsertSignals` (`signals.ts:43-57`) uses the same dedup-and-chunk pattern, keyed on `symbol,rule_id,horizon,signal_date`.
- **Financials:** `financials.ts:35` and `financial-lines.ts:40`, both upserts.
- **News:** `insertNews` (`news.ts:10-18`) uses `onConflict: 'url', ignoreDuplicates: true` with `.select('id')` and counts returned ids as "rows actually inserted".
- **Gaps:** `insertGaps`, `resolveGaps`, `extendGaps` (`data-gaps.ts:50-69`). The updates are guarded by `.in('id', ids).is('resolved_at', null)`.
- **AI usage:** `reserveAiUsage` calls rpc `ai_reserve`, `getAiMonthSpend` calls rpc `ai_month_spend`, and `settleAiUsage` does a guarded UPDATE (`ai-usage.ts:23-73`). The worker AI client also calls rpc `ai_key_secrets` (`ai-keys.ts:64`, used at `apps/worker/src/ai.ts:14`).

**3. PostgREST behaviours the code relies on, and the direct-pg equivalent.**

- **1000-row cap.**
  - It is handled in three ways:
    - `fetchAll` pages with `.range()` (`errors.ts:54-65`) for `listPriceDates`, `listCloseHistory`, `listAllOpenGaps` and `listCorporateActions` (`prices-daily.ts:41,69`, `data-gaps.ts:37`, `corporate-actions.ts:12`).
    - Symbol chunking: `listFinancialLines`, `listFinancials` and `listCorporateActions` are split by `linesSymbolChunk` / `financialsSymbolChunk` (`store.ts:92-98,114-130`).
    - Chunked inserts return at most `chunkSize` ids (`news.ts:7`).
  - With pg the cap disappears, so one query returns everything. Keep the public signatures, including `pageSize` options, but the loops become dead weight.
  - If you want a safety net, use keyset pagination for `listAllOpenGaps` (order by `id`). OFFSET paging over a mutating set is risky, and `resolveGaps` mutates that set. Whole-result is fine at single-user scale.
  - The `store.ts` chunking comments say "PostgREST row cap" (`store.ts:91,106`). They become stale and the chunk configs in `config.ts` can be dropped or kept as parameter-count limits.
  - `.in()` becomes `= ANY($1::text[])`. That also removes the URL-length limit that motivated the chunking.
  - `transactions.ts:49` uses `count: 'exact'` plus `.range()`. Replace it with `count(*) over()` or a second query.

- **`ignoreDuplicates` and upsert.**
  - `news.ts:14` becomes `INSERT ... ON CONFLICT (url) DO NOTHING RETURNING id`. `rowCount` equals the inserted count, which is the same semantics as the current return.
  - Other upserts become `ON CONFLICT (cols) DO UPDATE SET col = EXCLUDED.col, ...`.
  - PostgREST upsert updates every column sent. Generate the SET list from the row keys and exclude conflict columns. Do not hard-code it per table by hand without tests.
  - Rows within one `ON CONFLICT DO UPDATE` statement must not hit the same key twice (error `21000`). The existing in-JS dedup (`prices-daily.ts:136-138`, `signals.ts:49-51`) already protects this. Keep it, and confirm every other upsert (financials, financial-lines, intraday, lottery draws, symbols) has the same dedup. I did not read them.
  - Bulk insert shape: `INSERT ... SELECT * FROM unnest($1::text[], $2::date[], ...)` or `jsonb_populate_recordset($1::jsonb)` removes the 65535 parameter limit and keeps a chunk to one statement.

- **Error shapes to `DataError`.**
  - `unwrap` reads only `res.error.code` (`errors.ts:25-41`). For `pg`, `DatabaseError.code` is the same SQLSTATE, so the mapping `23505`, `23502`/`23514`/`22P02`, otherwise `DB_ERROR` carries over.
  - Replace the `{data,error}` result with a try/catch wrapper (`run(ctx, fn)`) that maps `pg` errors by `e.code`. Non-pg errors, such as connection refused (`ECONNREFUSED`, `57P01`, `08*`), become `DB_ERROR` with the code if present.
  - Keep the rule that messages carry table, op and pg code only (`errors.ts:10`). `pg` error messages and `detail` can echo values (for example a unique-violation detail "Key (url)=(...)"). Never put `e.message` in the DataError text. Be careful with `cause`: `ai-keys.ts:17-24` deliberately avoids `cause` because rpc params could leak. The same applies to pg errors from key writes. Also, `pg` attaches no params to the error, but query text logging must stay off.
  - `unwrapFound` and `.maybeSingle()` map to `rows[0] ?? NOT_FOUND`. `.single()` after insert maps to `RETURNING`.
  - New cases appear: `23503` (FK) and `40001`/`40P01` (serialization and deadlock, relevant to the advisory lock) fall through to `DB_ERROR`. That is acceptable, but decide whether `ai_reserve` should retry. `ai_reserve` raises `22023` for bad args (`ai_reserve_harden.sql:26`), and `ai-keys.ts:22` maps that to VALIDATION.

- **bigint/numeric mapping.**
  - Money columns are `bigint` (`v1_tables.sql:12-13,51,86-87` and others). PostgREST returns JSON numbers. `pg` returns bigint (int8, OID 20) as a **string**, and `count(*)` and `sum()` as bigint too.
  - `toSafeInt` (`packages/core/src/db/mappers.ts:24-35`) already accepts number, bigint and digit strings and rejects values outside the safe range, so most mappers already cope. That is good for R2.
  - Hazards, by direct read of the code:
    - `ai-usage.ts:72` passes the rpc scalar through `toSafeInt`, which is fine.
    - `ai-usage.ts:34-45` expects either an array or an object from the rpc result. Direct SQL (`select * from ai_reserve(...)`) returns `rows[0]` with `usage_id` as a string, and `toSafeInt` handles it.
    - `lottery.ts` and `mappers.ts:232-235` parse ids with `Number(drawId)` after a digit check, which is fine.
    - Mappers that read ids directly, such as `id: row.id` for uuid (`mappers.ts:51-53`), are fine.
    - `settings.ts:98` uses `toSafeInt` for ppm, which is fine.
    - Several columns use `toSafeInt` on `smallint[]` (`mappers.ts:269-270`, `numbers`). `pg` parses int2 as a JS number, so that is fine.
  - Do not globally set `pg.types.setTypeParser(20, BigInt)` or `parseInt`. The silent precision loss would defeat R2. Prefer leaving int8 as string and relying on `toSafeInt`. Add a mapper test for every bigint column that reads a string.

- **Date and timestamp mapping (the larger hazard).**
  - `core` `toDate` explicitly throws when it gets a `Date` and says "configure the driver to return DATE as string (pg type 1082)" (`core/src/db/mappers.ts:37-40`). So the intended design is a type parser for date (OID 1082) returning the raw string.
  - You must also set parser for `date[]` (OID 1182), because `settings.holidays` is `date[]` (`v1_tables.sql:69`). Without it holidays come back as Date objects or fail.
  - **`timestamptz` (OID 1184) is not handled.**
    - Mappers require `typeof row.fetched_at === 'string'` and throw MAPPING otherwise (`mappers.ts:51,107,147,185,254`). `pg` returns `Date` by default, so every R4 check would fail.
    - Return the raw string, or convert with `toISOString()`, but pick one. PostgREST returns `2026-11-10T08:00:00+00:00` and `toISOString` returns `...Z`. Check whether any code or test compares these strings, for example `fromTs` and `toTs` in gaps (`mappers.ts:170`), `computed_at`, and the `fetched_at` shown in UI.
    - Set the session `TimeZone` to UTC (`options: '-c timezone=UTC'` or `SET`) so the raw text has a deterministic offset.
  - `jsonb` and `text[]` come back parsed (`inputs_snapshot`, `body`, `reason_codes`), as before.
  - `numeric` is not used in the migrations I grepped (money is bigint), so no decimal handling is needed. I only grepped `numeric` loosely, so confirm.

- **`ai_reserve` and `ai_month_spend`.**
  - Both are `security invoker`, use `pg_advisory_xact_lock(hashtext('stoktok.ai_budget'))` (`ai_reserve_harden.sql:29`) and are granted only to `service_role` (`:50-51`, `ai_usage.sql:90-93`).
  - They work on plain Postgres unchanged except for the grants. `service_role` does not exist there. Replace with `grant ... to <app_role>`.
  - The advisory lock is transaction-scoped, so it is released at the end of the single statement. This holds for a plain `pool.query('select * from ai_reserve(...)')`, because autocommit makes that one transaction. It does not hold if a caller wraps it in a long transaction.
  - It depends on `pg_catalog.now()` being the transaction start time. In autocommit that is the statement time, so the window check at `:25` is fine.
  - Rewrite cleanly: call it as `select usage_id, granted, spent_micro_usd from public.ai_reserve($1::text,$2::text,$3::text,$4::bigint,$5::bigint,$6::timestamptz,$7::timestamptz)`. Cast explicitly. A string `$4` passed for a `bigint` param works, but a JS number above 2^53 is not an issue here because `toSafeInt` guards the inputs.
  - `ai_key_set`, `ai_key_delete` and `ai_key_secrets` are Vault `security definer` (`20261110000200_ai_keys.sql:27-31,72,99`) and must be reimplemented (`pgcrypto` or app-level AES-GCM). `ai-keys.ts` and `ai.ts:14` keep their function names. The worker reads secrets on every generate (`ai.ts:14`), so the app-level approach (key in env, ciphertext in a table) avoids a DB round trip and a decrypt function exposed in SQL. Prefer that over `pgcrypto`, where the master key would pass through SQL and could land in `pg_stat_statements` and server logs. I did not read the existing `ai_keys` migration body or the `r3-guard` allowed callers, so cover those in the ADR.

### Recommendations

1. **Driver (acceptance criterion 1).**
   - Use `pg` (node-postgres) with a pool and plain parameterised SQL, not a query builder. This is a small fixed set of 17 repos, and the SQL is simple and type-sensitive (int8, date, timestamptz).
   - The alternative is `postgres` (porsager). It is nicer for `unnest` and tagged templates, but its type handling differs: it returns bigint as string and dates as Date by default, and needs custom `types`. `pg` has the clearest, documented parser hooks. This is a choice for the planner and I would not block on it.
   - A query builder such as Kysely adds a dependency and a type layer duplicating `rows.ts`, with little return.
   - Define `Db` as `{ query<T>(sql, params): Promise<{rows:T[], rowCount:number}>; tx<T>(fn): Promise<T> }` so repos stay driver-agnostic and tests can fake it.

2. **Type parsers (R2 and R4).** Configure them on the pool via per-pool `types` config, not by mutating the global `pg.types`, because `apps/web` shares the process-level module. Set `date` (1082) and `date[]` (1182) to raw string, and `timestamptz` (1184) and `timestamp` to a fixed ISO string. Leave int8 as string and rely on `toSafeInt`. Add a test that reads one row of each type from real Postgres.

3. **Error wrapper (criterion 1).** Add `run(ctx, fn)` in `errors.ts` that maps `e.code` the same way as `unwrap`, keeps `DataError` messages free of payloads, and drops `e.message`/`e.detail` from the text. Keep `unwrap` semantics in `ai-keys.ts` (no `cause`).

4. **Batching and transactions (opportunities).**
   - Upserts: each 500-row chunk is already one statement, so there is no change in atomicity. Today a job that fails in chunk 3 leaves chunks 1 and 2 committed (`prices-daily.ts:139-142`). With pg, wrap the chunks in one transaction per call, which makes `upsertPricesDaily` all-or-nothing. That is safe because it is idempotent. Mind that a bigger transaction holds locks longer, which is irrelevant here.
   - Per-symbol fan-out: `getLatestCloses`, `getFirstPriceDates`, `getRecentCloses` and `listLatestSignals` run N queries per symbol with `Promise.all` (`prices-daily.ts:10-30,86-104,107-124`, `signals.ts:13-37`). With a pool of about 5 this is bounded, but one query per call is better: `select distinct on (symbol)` for latest and first, and a `row_number() over (partition by symbol order by trade_date desc)` for `getRecentCloses`. This also fixes the lack of snapshot consistency noted at `errors.ts:52`. It is optional, and it is a behaviour-preserving refactor, so it belongs in a follow-up unless needed. R7 says to keep the diff inside the plan.
   - `insertNews` chunking can be one statement with `unnest`, but keep the `chunkSize` option.
   - Job-level atomicity: the jobs do read, then write rows, then write gaps (insert and resolve). Do not wrap a whole job in one transaction. A source fetch takes time, and the existing design deliberately records gaps even when prices fail.
   - `settleAiUsage` and `ai_reserve` are each atomic; keep them out of larger transactions.

5. **Connection handling in one-shot CLI jobs (`cli.ts`).**
   - `cli.ts:73` creates the client once, and `main()` has no teardown. With `supabase-js` there is nothing to close. With `pg`, an open pool keeps the event loop alive, so the process will hang after `console.log(summary)` (`cli.ts:153-154`). The code sets `process.exitCode` rather than calling `process.exit`, which is good, but a pool needs an explicit `await pool.end()` in a `finally`.
   - Do this around the whole `main` body. The error path `main().catch(...)` (`cli.ts:159`) must also end the pool.
   - Set `max` small for CLI (1 to 3) since jobs are sequential. The worker is one-shot cron, so no long-lived idle connections. `idleTimeoutMillis` and `connectionTimeoutMillis` (about 5 to 10 s) so an unreachable DB fails fast instead of hanging the job. Also attach `pool.on('error', ...)` so an idle-client error does not crash with an unhandled event.
   - `apps/web/server/db.ts:12` has a lazy singleton, so the web needs a global pool (`max` about 5) cached across HMR reloads in dev. Pool budget on one host: web 5 plus a worker of up to 3 per concurrently running job, well below Postgres `max_connections` of 100.
   - `ai.ts:11` creates its own client when none is passed. Make it reuse the CLI pool (`opts.db`) so the job does not open two pools, and make sure whoever creates the pool ends it.
   - If PgBouncer is ever put in front, avoid session-level features. The advisory lock is transaction-level, so it is compatible.
   - Connection string: one `DATABASE_URL`, read from the env object passed in (as `client.ts:5` does), validated and never logged. Error text from `pg` on connection failure can include host and port but not the password. Still map it to a fixed `DataError` text. SSL: decide `sslmode` for Docker network versus host (an open question below).

6. **Roles and grants (criterion 3).**
   - Replace `service_role` grants in `ai_usage.sql:90-93` and `ai_reserve_harden.sql:50-51` with a least-privilege app role. The migrations are merged, and `ai_reserve_harden.sql:1-2` states that merged migrations stay unchanged, so changing them in place conflicts with that convention.
   - Either add a new migration that revokes and re-grants, or accept a rewrite of the baseline since this is a pre-go-live platform move. This is for the architect and DB specialist. Note that `revoke ... from public, anon, authenticated` fails on plain Postgres where those roles do not exist.
   - Rollback files under `supabase/rollback/` and `db:check` need to be re-run on plain Postgres.
   - Also check any `enable row level security` and `auth.*` references (my grep for these on `v1_tables.sql` found none, but I only grepped one file).

7. **Test strategy (criterion 7: tests work without Supabase).**
   - The current fake (`packages/db/test/fake-client.ts:14-53`) mimics the supabase builder: it queues responses and records `{method,args}`. About 17 `*.test.ts` files assert on builder calls (for example `.upsert` args and `onConflict`). They test the wire calls, not behaviour, and do not survive the swap. Rewriting them against a pg-shaped fake (queue of `{rows,rowCount}` or errors, recording SQL text and params) is cheap, but it only verifies that SQL strings are as written. It would not catch wrong SQL, wrong conflict keys, bigint strings or Date parsing.
   - Use both layers:
     - Keep a thin fake for unit tests of logic that is not SQL: dedup, chunking, error mapping (`errors.test.ts`), `unwrapFound` and the DataError shapes, `ai-keys` leak guards.
     - Add real-Postgres integration tests for repos. `db:check` already needs a plain Postgres to apply migrations and rollbacks, so there will be one in CI anyway. Reuse it, with a temporary schema or database per test file, and run the real migrations. This is the only way to verify the upsert conflict keys, `ignoreDuplicates` count semantics, `ai_reserve` locking (run two concurrent reserves and assert the cap holds), type parsers (bigint, date, timestamptz, `date[]`) and rollbacks.
   - Gate it so `pnpm test` still works without a database. For example, skip the integration project when `TEST_DATABASE_URL` is unset, with a separate `test:db` script, and make CI set it (service container `postgres:16`). Requiring the DB for the main `pnpm test` would contradict "repo tests work without Supabase" only loosely (it works without Supabase, but needs Postgres). Decide that explicitly with Ming.
   - Add a concurrency test for `ai_reserve` since it is the money-guarding path (ADR 0008). Today the budget gate is untested against a real lock, because the fake cannot exercise it.

8. **Ordering with STK-077 (AI summaries job).** `ai-summaries.ts` (`:16`), `ai-usage.ts` and `ai-keys.ts` are the three repos that change most (rpc, Vault). Do the driver and repo swap first, then ai-keys storage, then STK-077. Otherwise STK-077 will write new supabase-shaped code that is immediately rewritten.

9. **Deploy plumbing missed by the ticket text.** `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml:160-207` validates `SUPABASE_URL` as `https://host` and `SUPABASE_SERVICE_ROLE_KEY` as `[A-Za-z0-9._-]+`, and writes them to the env file via `printf`. A Postgres URL has `:`, `@`, `/` and `%`, so the existing character check rejects it. It needs a new validation and secret (for example `STOKTOK_DATABASE_URL`), or split host, user, password into separate secrets. Also `printf '%s'` with a password containing special characters needs careful quoting in the env file. `compose.yml:14` and `.env.example:10-13` need updates. `AUTHEN_SUPABASE_*` must remain (login stays on Supabase Auth).

### Risks

- **timestamptz as `Date` (high).** The default `pg` behaviour makes every R4 mapper throw MAPPING, which would break every price, news and signal read. Caught only by real-Postgres tests.
- **int8 as string (medium).** `toSafeInt` copes, but any mapper using `row.x` directly without it, or a `typeof === 'number'` check, would break. Audit all mappers in `mappers.ts`, since I only grepped it.
- **Behavioural drift of upsert (medium).** Hand-written `DO UPDATE SET` lists can silently skip a column. A missing column in the SET list leaves stale data without any error. Generate the list from the row keys and test it.
- **Same-key duplicates in one statement (medium).** `ON CONFLICT DO UPDATE` error `21000` for repos that lack the in-JS dedup (the unread ones).
- **Hung CLI processes (medium).** A pool not ended leaves cron jobs running forever (`cli.ts:153-163`).
- **Leaking secrets in errors (medium).** `pg` error `message` and `detail` can carry key values (`ai_keys` writes) or business values (unique-violation detail). Keep the DataError fixed-text policy and avoid `cause` for key paths.
- **Partial state across chunks (low).** Today a failed chunk leaves earlier chunks committed. A transaction changes that. This is safe because the upserts are idempotent, but state it in the plan so the reviewer does not flag it as a behaviour change.
- **No PostgREST role boundary (medium).** The app role has direct SQL. A SQL injection or an unparameterised string becomes a full DB compromise, where PostgREST used to limit the shape of queries. Require every statement to be parameterised, with no string-built identifiers except from fixed allow-lists (the upsert column list is the exposure).
- **Migration of AI keys (low).** Vault cannot be exported, so the keys must be re-entered. Ming already accepted this.
- **Pool exhaustion (low).** The per-symbol `Promise.all` fan-out is bounded by the pool and will queue, not fail, but watch `connectionTimeoutMillis` interplay.

### Open questions

1. Is the integration-test Postgres acceptable as a required CI service, with `pnpm test` skipping DB tests when `TEST_DATABASE_URL` is unset? Or must `pnpm test` run fully offline, which would leave the repos tested by fakes only?
2. Raw timestamp string format for `timestamptz`: PostgREST-compatible (`+00:00`) or `toISOString()` (`Z`)? Does any stored fixture, UI or test compare these strings? (I did not check the web consumers.)
3. Master key location for AI keys: env file via the deploy repo, or a file mount? App-level AES-GCM versus `pgcrypto` affects whether the worker and web both need the key (both do, `ai.ts:14` and the Settings action).
4. Network path from the Docker Compose containers to the DB on the home server (host network gateway, a compose service, or a TCP host/port), and whether TLS is required on that path. That decides `sslmode` and the URL validation in the deploy workflow.
5. Do the merged migrations get rewritten into a plain-Postgres baseline or amended by a new migration? The `ai_reserve_harden` header says merged migrations stay unchanged.
6. Is the `Db` interface exported publicly, with the web calling `@stoktok/db` repos only? The web uses `createServiceClient` at `apps/web/server/db.ts:2,12`. Confirm that no web code imports supabase-js types from `@stoktok/db` before removing the dependency.
7. Should the per-symbol fan-out queries be collapsed into set-based queries in this ticket, or left as a follow-up (R7)?

Files cited: `/home/user/stoktok/packages/db/src/client.ts`, `/home/user/stoktok/packages/db/src/errors.ts`, `/home/user/stoktok/packages/db/src/repos/{ai-usage,ai-keys,prices-daily,news,signals,data-gaps,corporate-actions}.ts`, `/home/user/stoktok/packages/db/src/mappers.ts`, `/home/user/stoktok/packages/db/test/fake-client.ts`, `/home/user/stoktok/packages/core/src/db/mappers.ts`, `/home/user/stoktok/apps/worker/src/{cli,store,ai}.ts`, `/home/user/stoktok/supabase/migrations/20261110000100_ai_reserve_harden.sql`, `/home/user/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml`.
