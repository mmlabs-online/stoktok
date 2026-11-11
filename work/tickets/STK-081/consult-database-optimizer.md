STK-081 DB consult: delta on STK-080 (read-only, nothing edited). I did not repeat STK-080 items (type parsers, roles, migration chain, cutover). Where a STK-080 claim is now confirmed or corrected, I say so.

## Findings

### A. Corrections to the STK-080 caveats (now verified)
- **financial_lines key.** The conflict key is the PK `(symbol, period_kind, period, line)` (20261108000100_financial_lines.sql:13). `statement` is not in the key, so on conflict it is a normal updated column. The dedupe key at financial-lines.ts:37 already matches the PK.
- **symbols payloads.** The two payloads have different column sets (symbols.ts:25 and :37).
  - `setSymbolExchange` sends `{symbol, exchange, updated_at}`.
  - `setSymbolSector` sends `{symbol, sector, sector_source, sector_fetched_at, updated_at}`.
  - `upsertInto` derives its set list from the provided keys (upsert.ts:36-40), so the second never touches `exchange`, as the doc comment at symbols.ts:29 requires.
  - `exchange: null` is not `undefined`, so `keysOf` keeps it (upsert.ts:13-14) and the set overwrites with NULL. This matches symbols.ts:20, "Always overwrites".
- **ai_summaries.created_at.** `AiSummaryInsert.created_at` is a required field (rows.ts:288), and the comment at rows.ts:275 says every column is always sent. `upsertInto` therefore puts `created_at = excluded.created_at` in the set list. That satisfies the "refreshed on replace" comment (ai_summaries.sql:39) with no extra work. The `AiSummariesTable.created_at` type is optional (schema.ts:235). That is harmless but loose.
- **settings payloads.**
  - `saveSettings` (settings.ts:85) sends 8 columns via `settingsToRow` (mappers.ts:172-182). `concentration_threshold_ppm` and `rule_configs` are absent, so the set list leaves them untouched.
  - `saveAppSettings` (settings.ts:139) sends the 10-column `settingsInputToRow` (mappers.ts:221-237), which overwrites `concentration_threshold_ppm` with null when the input is null.
  - Neither payload carries `updated_at`, and there is no trigger on `settings` (only the default at v1_tables.sql:74). So `settings.updated_at` never moves after the first insert today. Keep that parity under R7. Do not "fix" it in this ticket.
- **Pool sizing vs per-symbol fan-out.** The worker profile is `max: 2` and `connectionTimeoutMillis: 5000` (config.ts:16). Several repos fan out `Promise.all` over symbols, one query each: getLatestCloses (prices-daily.ts:12), getFirstPriceDates (:89), getRecentCloses (:114), getLatestIntraday (prices-intraday.ts:12) and listLatestSignals (signals.ts:15).
  - On a full pool, pg-pool queues the waiters, and a waiter that exceeds 5 s gets `timeout exceeded when trying to connect`. A large symbol list plus a slow query can therefore fail on queue time, not on the query.
  - Do NOT replace these with `DISTINCT ON (symbol)`. The PK `(symbol, trade_date)` serves `order by trade_date desc limit 1` per symbol in O(log n). DISTINCT ON scans every row of every symbol, because PG17 has no skip scan.
  - If a single statement is wanted, use `from unnest(${symbols}::text[]) s(symbol) cross join lateral (select … where symbol = s.symbol order by trade_date desc limit n)`. It keeps the index plan and uses one connection.
  - Otherwise keep per-symbol queries and add a bounded concurrency of at most the pool max. The default expectation is per-symbol queries with the pool as the throttle, plus a test with more symbols than `max`.

### B. Cross-cutting translation rules (apply to all 17)
1. **jsonb typing gap in `schema.ts`.**
   - `Json` and `JsonDef` have insert type `string` (schema.ts:9-10), but `jsonb()` returns a `RawBuilder` (upsert.ts:60-63), which is not assignable. The existing test papers over it with `as never` (test-db/upsert.test.ts:67, :74).
   - Fix it once: make the insert and update type `RawBuilder<unknown>`, so a raw object or array on a jsonb column is a compile error. Then repos need no casts.
   - Affected writes: signals.inputs_snapshot (rows.ts:158), ai_summaries.body (rows.ts:286), lottery_tickets.lines (rows.ts:236) and settings.rule_configs (SettingsFullRow).
   - This is required. A JS `number[][]` for `lines` is serialised by pg as a PG array literal `{{1,2},{3,4}}`. That fails `22P02` (VALIDATION) at best, and a flat `number[]` could be mis-stored.
   - By contrast, `text[]`, `smallint[]` and `date[]` columns take plain JS arrays: signals.reason_codes, ai_summaries.input_ids, news.symbols, lottery_draws.numbers and settings.holidays.
2. **Kysely ignores `undefined` in `.values()` and `.set()`.** A field that must be cleared has to be `null`.
   - The core mappers send explicit nulls: corporateActionToRow (mappers.ts:127-137) and updateLotteryTicket (lottery.ts:58-64). So full-replace semantics survive.
   - `tradeFields` (transactions.ts:15-18) always sends fee and tax as null-or-value (mappers.ts:76-77).
   - Add a test per full-replace path (see section D). Do not rely on reading the mappers.
3. **Empty `IN` lists.**
   - Kysely renders `where x in ()` as a syntax error (42601). Every existing early return must survive: symbols.ts:12, :45; data-gaps.ts:10, :58, :66; financials.ts:11; financial-lines.ts:16; corporate-actions.ts:10 (the `symbols` variant only).
   - For ids, prefer a single array parameter: `` sql`id = any(${ids}::bigint[])` ``. A plain array inside a `sql` template is one bind parameter, not expanded.
   - For symbol lists of at most hundreds, `.where('symbol','in',list)` is fine.
4. **Not-found helper.** Kysely has no `maybeSingle`. Add a small `found<T>(row: T | undefined, ctx)` helper in errors.ts that throws `NOT_FOUND`, and use it with `executeTakeFirst()`. `unwrap`, `unwrapFound` and `fetchAll` (errors.ts:31-65) become dead after the port. Remove them and rewrite errors.test.ts with them.
5. **`run()` and the 22023 mapping.**
   - `toDataError` (errors.ts:88-99) maps only 23505, 23502, 23514 and 22P02. ai-keys.ts:22 maps `22023` to VALIDATION "invalid arguments", which `run()` would turn into DB_ERROR.
   - Do not wrap ai-keys in its own try/catch to get around this. The S5 rule is that every call goes through `run()`. Add an optional `map?: (sqlstate) => DataErrorCode | undefined` argument to `run()`, or catch the DataError whose `pgCode === '22023'` and rethrow it as VALIDATION.
   - The ai_reserve 22023 case (harden.sql:26) can stay DB_ERROR with the pgCode, as ai-usage.ts:75 documents ("pgCode survives").
6. **S5 enforcement (r3-guard).** A regex over text can't prove "every kysely call is inside `run()`", so make it structural.
   - Rule 1: in `packages/db/src/repos/*.ts`, excluding tests, every `.execute(`, `.executeTakeFirst(` and `.executeTakeFirstOrThrow(` token must lie within a `run(` callback, or the file must have zero `await` outside `run(`.
   - Rule 2: no repo references `pool` or `.pool`.
   - Rule 3: the only import of `kysely` in a repo file is `sql` (and types).
   - Rule 4: no `log:` option in `new Kysely(` (client.ts:70). See section E.
   - Write the rule as a unit test with a deliberately failing fixture string, like the existing "regex catches" tests (r3-guard.test.ts:62-73, :88-93).
7. **Chunking.**
   - Combine the existing per-repo `chunkSize` with `chunkForParams` (upsert.ts:50-57): `for (const c of chunkForParams(unique)) for (let i = 0; i < c.length; i += chunkSize) …`. Callers keep passing `chunkSize` (store.ts:51, :75, :99, :133, :143).
   - At 8-11 columns, the 500 default is far below the 65,535-parameter limit. That bound is a safety net, not the effective chunk.
   - Return counts stay "rows sent" (`unique.length`), except news, which is the actual insert count.
8. **Reuse one `upsertInto` call per chunk.** It throws a plain `Error` on a programming mistake (mixed column sets, upsert.ts:38). That passes through `run()` as DB_ERROR. Do not wrap the builder call inside `run()`. Build outside and execute inside, so a bug is not mislabelled as a database error. (`toDataError` would wrap it anyway.) State the choice in the plan.

### C. Per-repo SQL shapes and conflict keys (all verified against migrations)

| Repo (file:line today) | Kysely shape | Conflict key (migration) | Column-set semantics |
|---|---|---|---|
| symbols (:14, :25, :36, :48) | `selectFrom('symbols').select(['symbol','exchange']).where('symbol','in',…)`; two `upsertInto('symbols', [row], ['symbol'])` calls | PK `symbol` (symbols.sql:5) | See A. `exchange` check is HOSE/HNX/UPCOM/NULL (symbols.sql:6), so a bad value is 23514 VALIDATION. `created_at` is never in the payload, so it is stable. |
| prices-daily (:16, :44, :73, :93, :117, :140) | per-symbol `orderBy trade_date desc/asc limit 1`; range reads become one `select … order by trade_date`; upsert chunked | PK `(symbol, trade_date)` (v1_tables.sql:90) | All 10 columns. `foreign_net: null` overwrites to NULL. The check `low<=open,close<=high` (:91) gives 23514. |
| prices-intraday (:16, :46) | same pattern | PK `(symbol, ts)` (prices_intraday.sql:11) | All 6 columns. |
| financials (:14, :35) | `where symbol in … and period >= $` | PK `(symbol, period)` (financials.sql:13) | All 8 columns, including `fetched_at` (restatement policy, financials.ts:21-23). |
| financial-lines (:19, :40) | same, plus `period_kind =` | PK 4 columns (financial_lines.sql:13) | All 8 columns; `statement` and `value` are overwritten. |
| signals (:19-27, :53) | per-rule `limit 1`; upsert with `inputs_snapshot: jsonb(...)` | `unique (symbol, rule_id, horizon, signal_date)` (signals.sql:19) | Set list is the 7 non-key columns that `SignalInsert` carries (rows.ts:148-161). `id` and `created_at` are not sent, so they are stable. |
| lottery draws (:112-119) | `upsertInto('lottery_draws', rows, ['game','draw_no'])`; `numbers` is a plain JS array (smallint[]) | PK `(game, draw_no)` (lottery.sql:18) | Mapper sends 11 columns with explicit nulls (mappers.ts:277-293), so a re-upsert without pools nulls the jackpots. `created_at` is not sent, so it is stable. |
| lottery tickets (:29, :38-46, :56-70, :73-90, :95) | plain `insertInto … values({…, lines: jsonb(lines)}).returning(TICKET_COLS)`; updates with `.returning`; list `orderBy purchased_at desc, id asc` | No ON CONFLICT. Two partial unique indexes (lottery.sql:64-70) surface as 23505, mapped to CONFLICT. `lottery_tickets_status_shape` (:51-55) gives 23514. | Update to pending sends `status, prize_tier, gross_vnd, checked_at` as nulls (lottery.ts:58-64), satisfying the check. |
| ai-summaries (:16, :26) | `upsertInto('ai_summaries', [row'], ['scope','symbol','summary_date']).returning('id')` | `unique (scope, symbol, summary_date)` (ai_summaries.sql:18), not the PK | All 11 non-id columns. `body` and `input_ids` need conversion (`jsonb()` and a text[] array). `id` is stable, and `toSafeInt` takes the string id. The model/template check (:20-23) is 23514. |
| settings (:49, :85, :95, :106, :115, :124, :136, :139) | `where id = 1 executeTakeFirst()`; upsert on `['id']` | PK `id smallint check (id = 1)` (v1_tables.sql:64) | See A. `holidays` is `date[]` (v1_tables.sql:69) and is read back through the DATE_ARRAY parser (types.ts:58). `rule_configs` is written with `jsonb()` and read as an object. |
| news (:14) | `upsertInto('news', chunk, ['url'], {ignoreDuplicates: true}).returning('id')`; count = `rows.length` | `url unique` (news.sql:6) | DO NOTHING means first-seen wins. In-batch duplicates are skipped with no 21000 error, because the conflict is DO NOTHING. News is the one repo with no JS dedupe (the others dedupe before upserting). |
| data-gaps (:13-19, :28, :39-41, :52, :60, :67) | selects with `is null`; `insertInto('data_gaps').values(chunk)`; guarded updates | none (identity `id`) | See D. |
| transactions (:24-30, :49-57, :64, :74, :81, :89) | list: one ordered select; page: `count(*) over() as total` or a second count; create/update `.returning(COLS)`; delete `.returning('id')` | `unique (source, import_batch_id, external_ref)` (v1_tables.sql:18). NULLs never conflict, so manual rows never hit it. | Update leaves `source`, `import_batch_id`, `external_ref`, `seq` and `created_at` untouched. |
| corporate-actions (:12-21, :31-36, :53, :61) | one ordered select; insert/update returning | `unique (symbol, type, ex_date)` (v1_tables.sql:42) | Full replace, with explicit nulls (mappers.ts:127-137). |
| assets (:12, :20, :26, :33, :41) | plain CRUD | none | `order by as_of desc, id asc`. |
| watchlist (:11, :18, :24) | `insertInto('watchlist').values({symbol}).returning(COLS)` | PK `symbol` | `group_name` takes its DB default (v1_tables.sql:59). Duplicate is 23505 CONFLICT. |
| ai-usage (:25, :53-66, :71) | see section E | n/a | n/a |
| ai-keys (:34, :47, :54, :64) | see section E | n/a | n/a |

Notes on specific repos:
- **transactions.listTransactionsPage.** With `count(*) over()`, a page past the end returns zero rows and the total is lost. The PostgREST `count: 'exact'` path (transactions.ts:49, :59) returned a real total.
  - Handle it as follows: if `rows.length === 0 && offset > 0`, run a separate `select count(*)` with the same filters. Otherwise take `total` from the first row (a bigint string, so use `toSafeInt`). Do not pass the `total` column into `transactionFromRow`.
  - `seq` and `id` are bigint, so they arrive as strings. The existing `a.seq - b.seq` at transactions.ts:11 works on the mapped `Transaction.seq`, not the raw row.
- **listAllOpenGaps (data-gaps.ts:35-47).** Callers pass `pageSize` (store.ts:64, :144) and must keep compiling. Keep the option but replace `fetchAll` with keyset paging: `where id > $last order by id limit $pageSize`, looped until a short page. That bounds memory like before, needs no offset, and `id` is already the order key. Alternatively accept and ignore the option and do a single select.
- **listPriceDates and listCloseHistory.** Their `pageSize` option (prices-daily.ts:38, :66) becomes unused. Grep shows no caller passes it. Delete the option if all callers allow it, otherwise accept and ignore it.
- **listCorporateActions and listTransactions.** Replace `fetchAll` with a single ordered select: `ex_date, symbol, id` and `trade_date, seq`.
- **lottery `input()` and `canonical()`.** These pure helpers (lottery.ts:15-24) are untouched. Only the call sites change.
- **Date comparisons.** `where trade_date >= $1` with a string parameter is fine. Never pass a JS `Date` for a `date` column.

### D. Test:db cases needed per repo
Use `freshDb()` (test-db/harness.ts:35) per file and a temp table-per-test cleanup (truncate) inside a file. Every case also asserts that the thrown error is a `DataError` with the expected code and no key values in its message.

- **symbols**
  - set_exchange then set_sector keeps the exchange.
  - set_sector then set_exchange(null) keeps the sector columns and provenance.
  - A new row from set_sector has exchange NULL.
  - `created_at` is unchanged and `updated_at` advances.
  - A bad exchange gives VALIDATION (23514).
  - The empty list returns `{}` without a query.
- **prices-daily**
  - A re-upsert replaces all columns, including `foreign_net` to null.
  - Duplicates in one input: the later one wins and the count is `unique.length`.
  - `chunkSize: 2` over 5 rows.
  - `volume` and `date` arrive as a digit string and a `YYYY-MM-DD` string (feed core `toSafeInt` and `toDate`).
  - latest, first and recent, with symbols that have no rows (omitted).
  - More symbols than the pool max (see A).
  - A check violation gives VALIDATION.
- **prices-intraday**
  - Last write wins on `(symbol, ts)`.
  - `fetched_at` and `source` are replaced.
  - A `ts` with microseconds round-trips.
  - latest picks the newest `ts`.
- **financials / financial-lines**
  - Restatement overwrites `fetched_at` and values.
  - For lines: the same line with a different `statement` replaces the statement.
  - `fromPeriod` filter, and `period_kind` filter.
  - The empty-symbols early return.
- **signals**
  - Each of the four key columns discriminates: change one and you get a new row, not a replace.
  - A replace updates label (including to null), value, reason_codes, inputs_snapshot (jsonb object round-trip) and `computed_at`.
  - `id` and `created_at` are unchanged.
  - latest-per-rule ordering by `signal_date`.
  - A suppressed row violating the signals.sql checks gives VALIDATION.
- **lottery**
  - Draw replace nulls the jackpots when the new payload has no pools.
  - `numbers` is smallint[] and returns `number[]`.
  - Tickets: `lines` round-trips as `number[][]` (this proves `jsonb()` is used).
  - Duplicate `raw_text` differing only in whitespace gives CONFLICT.
  - A duplicate sms identity `(game, draw_no, purchased_at, md5(lines::text))` gives CONFLICT, and the same lines on another channel do not.
  - Update resets to pending with nulled result columns.
  - recordResult: won with gross > 0 passes, and won with gross 0 gives VALIDATION via `lottery_tickets_status_shape`.
  - `listPending` and a `drawId` filter.
  - An invalid `drawId` gives VALIDATION without a query.
- **ai-summaries**
  - A replace over the same `(scope, symbol, summary_date)` keeps `id`, advances `created_at`, and replaces `body` and `input_ids`.
  - A template row over a model row clears provider, model and usage_id (all columns sent).
  - A `model` generator with null provider gives VALIDATION.
  - The portfolio row (`symbol = ''`) coexists with a symbol row, and sorts first in `listAiSummariesForDate`.
  - The usage_id FK: deleting the ai_usage row nulls it.
  - An oversize or invalid body gives VALIDATION.
- **settings**
  - saveSettings leaves `rule_configs` and `concentration_threshold_ppm` untouched.
  - saveAppSettings round-trips `holidays` (empty and non-empty `date[]`, raw date strings, no timezone drift), `rule_configs` and the merge keeping `dividend_withholding_rate_ppm` and `cost_method`.
  - `fee_rate_ppm: null` keeps `NOT_CONFIGURED` for `getSettings` and `feeRateConfigured: false` for `getEntrySettings`.
  - The no-row cases for every getter: `getSettings` gives NOT_CONFIGURED, the others give defaults.
  - `id` is forced to 1 (`check (id = 1)`).
  - `settings.updated_at` does not change on save (documents the parity).
- **news**
  - A new url is inserted and counted.
  - An existing url is skipped, its title is unchanged, and it is not counted.
  - A duplicate in the same batch counts once.
  - Multiple chunks (`chunkSize: 2`) sum correctly.
  - `symbols text[]` round-trips, including an empty array.
  - A check violation (a non-http url, news.sql:6) gives VALIDATION.
  - Empty input does nothing.
- **data-gaps (guarded updates)**
  - `resolveGaps` leaves an already-resolved row untouched (both `resolved_at` and `resolved_reason`).
  - With `reason` undefined, an unresolved row's `resolved_reason` is left as it is. With a reason, it is written.
  - `extendGaps` does not move `to_ts` of a resolved row, and a `to_ts` below `from_ts` gives VALIDATION (`to_ts >= from_ts`, v1_tables.sql:100).
  - Empty-ids early return.
  - `listOpenGaps` excludes market-wide (NULL symbol) gaps, and `listOpenMarketGaps` returns only those.
  - `listAllOpenGaps` with `source` and a small `pageSize` across several pages, 2500 rows, ids ascending and no duplicates.
  - `insertGaps` with a NULL symbol, and with more rows than one chunk.
- **transactions**
  - `listTransactions` ordering `trade_date, seq` and the symbol filter.
  - `listTransactionsPage`: the total equals the filtered count, the offset window is correct, and the total is still correct when the offset is past the end.
  - A duplicate `(source, import_batch_id, external_ref)` gives CONFLICT. Two rows with a NULL ref do not conflict.
  - Update keeps `seq`, `source` and `import_batch_id`, and changes fee and tax, including to null.
  - Update and delete of an unknown id give NOT_FOUND.
  - `seq` arrives as a digit string and maps to a number.
- **corporate-actions**
  - Update is a full replace (cash dividend to split clears `amount_per_share`, `pay_date` and `record_date`).
  - A duplicate `(symbol, type, ex_date)` on create and on update gives CONFLICT.
  - Ordering is `ex_date, symbol, id`.
  - `symbols: []` returns `[]`.
- **assets / watchlist**
  - CRUD, with NOT_FOUND on delete of a missing row.
  - Watchlist duplicate gives CONFLICT, and a bad symbol gives VALIDATION.
  - Default `group_name`.

**ai_reserve and ai_month_spend**
- Basic grant and refusal.
  - Granted: a `reserved` row and `spent` before the reservation.
  - Refused: a `refused` row with cost 0 (harden.sql:42-44).
  - A refused row does not increase later `spent` beyond its 0 cost.
- Argument validation (harden.sql:22-27).
  - zero reserve
  - a window that does not contain DB `now()`
  - `p_from >= p_to`
  - null
  - each is a `DataError` with pgCode `22023`.
- `ai_month_spend`.
  - It returns a digit string, and `toSafeInt` accepts it.
  - A settled `cost` is counted instead of the reservation.
  - An unsettled or unknown-cost row is counted at the reserved worst case.
  - Rows outside the window are excluded (`created_at`).
  - A window with no rows gives 0, which is `coalesce` (ai_usage.sql:85).
- `settleAiUsage` is guarded on `status = 'reserved'`.
  - The second settle returns false.
  - Settling a refused row returns false.
  - `ok` without a cost gives VALIDATION via the check at ai_usage.sql:18.
  - `errorCode` regex check (:16).
- **Concurrency test (required by the ticket).**
  - Setup: `freshDb('web')` with `overrides` raising `max` to at least N. Do not use the worker profile with `max: 2`, since that would serialise the callers in the pool instead of at the advisory lock.
  - Window: `now-1h` to `now+1h`, so it contains DB `now()` (harden.sql:25). Use `reserve = 100`, `cap = 300`, and fire N = 12 `reserveAiUsage` calls with `Promise.all`.
  - Assertions:
    1. Exactly 3 are granted and 9 are refused.
    2. The `spentMicroUsd` values seen by the grants are exactly `{0, 100, 200}`, and the refusals see 300.
    3. `sum(coalesce(cost, reserved))` over `status in ('reserved','refused')`, as in the function, is at most 300 afterwards, and `getAiMonthSpend` equals 300.
    4. `usageId` values are unique, with 12 rows in `ai_usage`.
  - Repeat with 3 rounds to reduce flakiness.
  - Without the advisory lock (the check is in plpgsql with a fresh snapshot per statement under READ COMMITTED), more than 3 would be granted. Mutation check: temporarily comment out the lock in a scratch copy and confirm the test fails. State this in the impl-log as the test's proof that it can fail.
  - A second test: a caller-held open transaction is NOT supported. Document that `reserveAiUsage` must never run inside a `db.transaction()`, as the lock would be held longer and `now()` evaluated at transaction start. Enforce it in `ai-usage.ts` by calling on `db.kysely` only, never a transaction handle.

### E. ai_reserve, ai_month_spend and the Vault ai_key_* calls (kept until STK-082)
- **ai_reserve.**
  - Raw SQL with explicit casts: `` sql<AiReserveRow>`select usage_id, granted, spent_micro_usd from public.ai_reserve(${p}::text, ${m}::text, ${t}::text, ${r}::bigint, ${c}::bigint, ${from}::timestamptz, ${to}::timestamptz)` ``.
  - Select named columns, not `*`. The result is a table-function row set, so `rows[0]` is the row, and `reserveAiUsage` (ai-usage.ts:34-35) needs no array-or-object branch any more.
  - The result columns are bigint, so they arrive as strings. `toSafeInt` handles them (ai-usage.ts:39-41).
- **ai_month_spend** is a scalar function. Use `` select public.ai_month_spend(${from}::timestamptz, ${to}::timestamptz) as spent `` and read `rows[0].spent`. Without the alias the column is named `ai_month_spend`. Keep `toSafeInt` (ai-usage.ts:72).
- **ai_key_delete** is also scalar: `` select public.ai_key_delete(${p}::text) as deleted `` and compare `=== true` (ai-keys.ts:49).
- **ai_key_set** returns a table: `` select key_last4, saved_at from public.ai_key_set(${p}::text, ${key}::text) ``. `saved_at` goes through `normalizeTimestamptz` to an ISO string, so the `typeof === 'string'` check at ai-keys.ts:38 still holds.
- **ai_key_secrets** returns a table `(provider, secret)`: `select provider, secret from public.ai_key_secrets()` (ai_keys.sql:96-108).
- **listAiKeyMeta** is a normal select of `provider, last4, updated_at`. Never select or type `secret_id` in repo code.
- The secret is passed as a bound parameter. Never `sql.lit` or interpolation of `key`.
- **Key-leak controls to add (S5 context).**
  - r3-guard rule: no `log:` option anywhere in `new Kysely(` (Kysely's `log` emits parameters).
  - A unit and test:db test: `saveAiKey` with a key that fails server-side (for example a 22023 case) throws a `DataError` whose `message` and `JSON.stringify(e)` contain neither the key nor its last4. Keep `toDataError` attaching no cause (errors.ts:85-86).
  - Keep the r3-guard allow-lists in step with the move: the Vault entry-point test (r3-guard.test.ts:122-134) and the write-wrapper test (:136-145) both match the function name, which survives as `public.ai_key_*` in the SQL string. No change needed, but the file must remain in the allowed set.
  - Server-side logging: if the shared Postgres logs statements with parameters (`log_statement` or `log_min_duration_statement`, with `log_parameter_max_length` at its default of -1), `ai_key_set`'s key parameter would appear in the server log. Ask Ming to confirm the shared Postgres settings in STK-084. It is moot after STK-082 if encryption is app-side.
- **Vault does not exist on the shared `postgres:17`.** Until STK-082 the ai_key_* functions work only against the test harness, because `scripts/db-check/bootstrap-roles.sql` stubs Vault (see STK-080 consult section 5; the stub is what global-setup.ts runs first, per plan.md:68). Consequences:
  - The ai-keys test:db cases are only valid while the stub and the old migration chain exist. Make them explicit "remove in STK-082" cases.
  - Order risk: if STK-083 (baseline squash and stub deletion) lands before STK-082, the ai_key_* test:db cases fail. State the order STK-082 before STK-083, or let STK-082 delete those tests.
  - Production is unaffected, since no release is cut until STK-084.
- **ai-keys test:db cases (against the stub).**
  - set then list meta shows the last4 and no secret.
  - A replace updates the last4.
  - delete returns true, then false.
  - `readAiKeySecrets` round-trips both providers.
  - Unknown provider and short key are VALIDATION.
  - A DEFINER function is called by the pool's role (it has privileges via the grant swap in bootstrap).

### F. Other items in the ticket's scope that touch the DB layer
- **Handle.** The ticket requires `PgDb.pool` not to be a plain enumerable property (ticket AC; client.ts:16, :71).
  - Repos receive `PgDb`, and every query is `db.kysely`.
  - Replace `pool` with `stats(): { total: number; idle: number; waiting: number }`, or define it as non-enumerable (`Object.defineProperty`).
  - The test-db session test uses `totalCount` (plan.md:111). Port it to `stats().total`.
  - A test that `JSON.stringify(pgDb)` and `util.inspect(pgDb)` contain no URL.
- **initSession 'error' listener (ticket AC).** In `SessionClient.initSession` (client.ts:44-58), attach `this.on('error', …)` before `super.connect()` and keep it until after the setup query. Without it, a socket error during setup is an unhandled `'error'` event on a client the pool has not yet adopted, which crashes the process.
  - Test: use `pg_terminate_backend` on the backend while the setup query is pending. Hold the setup with a `pg_sleep` on a pool whose first query is delayed, or terminate in a loop using a second connection filtered by `application_name`. Assert the process survives, the caller sees `db session init failed`, and `stats().total` returns to 0.
  - Keep the `'error'` listener on pooled idle clients (pool.on('error'), client.ts:69).
- **Worker cleanup.** `await end()` in `finally`, including the `.catch` path: `end()` is `kysely.destroy()` (client.ts:71), and a second `end()` must be a no-op or error-safe. Add a test that two `end()` calls do not throw.
- **Money (R2).** bigint money columns arrive as strings, and no repo may convert with `Number()`. Check the new code paths against rows.ts `Int8` and core `toSafeInt` (STK-080 consult section 6).

## Recommendations
1. **Schema typing (R2, R7).** Change the insert and update type of `Json` and `JsonDef` in schema.ts:9-10 to `RawBuilder<unknown>` and drop the `as never` casts in test-db/upsert.test.ts:67, :74. This is the first commit of the ticket.
2. **Port order.** Move repos in this order so each commit passes: (1) symbols, watchlist, assets, corporate-actions, transactions (plain CRUD and the `found()` helper); (2) the six upsert repos (prices-daily, prices-intraday, financials, financial-lines, signals, lottery draws, tickets); (3) news, data-gaps, ai-summaries, settings; (4) ai-usage, then ai-keys; (5) delete `fetchAll`, `unwrap` and `unwrapFound`, `Db`, fake-client.ts and the `@supabase/supabase-js` dependency.
3. **Keep per-symbol fan-out repos as per-symbol (or lateral) queries**, never DISTINCT ON (A). Add a bounded concurrency test.
4. **Add `found()` and the `run()` code-mapping hook (B4, B5).**
5. **Make the S5 r3-guard structural (B6)**, with fixture tests proving it can fail.
6. **Ship the per-repo test:db cases in D**, including the ai_reserve concurrency test with the mutation proof. Each acceptance criterion in the ticket maps to a case: handle (F), initSession (F), S5 (B6), test:db green.
7. **Keep `listAllOpenGaps` as keyset paging on `id`** (C notes), and `listTransactionsPage` with the empty-page count fallback.
8. **Order STK-082 before STK-083**, or have whichever lands first handle the Vault stub tests (E).
9. **Update docs and config in the same PR**: `.env.example`, r3-guard text, the CLAUDE.md R3 wording, ADR 0010 cross-references (ticket scope), and `check-image.sh` with the worker `pg` resolve probe.

## Risks
- **`as never` and jsonb.** Without the typing fix, one missed `jsonb()` on `lines` or `inputs_snapshot` becomes a runtime 22P02 or silently wrong data. The test:db round-trip cases catch it, but only if they exist for all four jsonb columns.
- **Pool starvation.** The worker pool is `max: 2`, and any unbounded `Promise.all` of queries can fail on the 5 s connection timeout (A). It depends on symbol count, so it may appear only in production.
- **Kysely `undefined` handling.** A payload field set to `undefined` is dropped silently and the column keeps its old value. The mappers use `null` today. A future mapper change could break the full-replace behaviour without a type error. The full-replace tests above guard it.
- **Total lost on an empty page** with `count(*) over()` (C notes).
- **Plain `Error` from `upsertInto` on a mixed column set** passes through `run()` as DB_ERROR. A caller that builds rows with an optional property that is sometimes undefined would trigger it at runtime. The per-repo tests with a partial payload cover it.
- **Key exposure paths.** Kysely `log`, server statement logging (E), and any `console.error` of a pg error object. Only the `DataError` is safe to log.
- **Vault dependence** blocks real-PG testing of ai-keys after the stub goes (E). It is a sequencing risk between STK-081, STK-082 and STK-083.
- **Concurrency test flakiness**: it needs an adequate `max` and a window around DB `now()`. A fixed `now()` offset in the test (not a mocked clock) is required because the function reads the DB clock.
- **Collation-dependent ordering** (`order by symbol`, ai-summaries.ts:26) can differ between the old Supabase DB and the new `postgres:17` image. The portfolio `''` row sorts first in every collation, so this is only a risk for symbol ordering among themselves, which are `[A-Z0-9]` only.

## Open questions
1. Do callers pass `pageSize` to `listPriceDates` or `listCloseHistory`? Grep over `apps/` found none (only `listAllOpenGaps`, store.ts:64, :144). Can the option be removed, or must the signatures stay identical? The ticket says "same exported functions and signatures", so I'd keep it and ignore it.
2. For `listAllOpenGaps`, keyset paging on `id` or a single select? I recommend keyset to keep memory bounded. This is a planner decision.
3. Should `settings.updated_at` be refreshed on save? Today it never changes (A). I recommend leaving as is (R7) and listing it as a follow-up.
4. Is `symbols`' `exchange` check list (`HOSE/HNX/UPCOM`) the only place the exchanges live in SQL? It mirrors core EXCHANGES (symbols.sql:11). No action here.
5. What does the shared Postgres log (`log_statement`, `log_min_duration_statement`, `log_parameter_max_length`)? This matters for ai_key_set parameters until STK-082. Ask Ming or check the deployment repo for STK-084.
6. Where should the S5 structural guard live: `r3-guard.test.ts` (reads all files) or a new `repos-guard.test.ts` in `packages/db/src`? I would use a new file, so r3-guard stays about secrets.
7. Should the `found()` helper live in errors.ts next to `unwrapFound`, or in `pg/`? I would use errors.ts, since it is about DataError.

Files referenced (absolute):
- /home/user/stoktok/packages/db/src/repos/*.ts (17 repos)
- /home/user/stoktok/packages/db/src/pg/upsert.ts, client.ts, schema.ts, config.ts, types.ts, index.ts
- /home/user/stoktok/packages/db/src/errors.ts, rows.ts, r3-guard.test.ts
- /home/user/stoktok/packages/db/test-db/harness.ts, upsert.test.ts
- /home/user/stoktok/packages/core/src/db/mappers.ts
- /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql, 20261025000100_symbols.sql, 20261106000100_lottery.sql, 20261108000100_financial_lines.sql, 20261109000100_ai_usage.sql, 20261110000100_ai_reserve_harden.sql, 20261110000200_ai_keys.sql, 20261110000300_ai_summaries.sql
- /home/user/stoktok/apps/worker/src/store.ts
- /home/user/stoktok/work/tickets/STK-080/consult-database-optimizer.md, /home/user/stoktok/work/tickets/STK-081/ticket.md
