# consult-database-optimizer — STK-015

## Findings
- Existing pattern (`20261026000100_financials.sql`): table, RLS and grants all live in the new migration, because the grants loop in `20261023000200` only covers the tables that existed then. Symbol regex `^[A-Z0-9]{1,20}$`, `source` and `fetched_at` are NOT NULL, and the PK is the natural key.
- Repo pattern: upsert dedupes by key (later wins), then does sequential chunks with `onConflict` and no `.select()`. It returns the count of rows sent. Errors go through `unwrap` and `mapRow`.
- `db:check` (`scripts/db-check/checks.sql`) has hard-coded or enforced items that a new table will break:
  - `tables_exist` compares against an exact array. Add `'signals'` between `settings` and `symbols`, in alphabetical order.
  - `no_numeric_or_float_columns` forbids numeric and float types.
  - The RLS, no-policies, no-grants and anon/authenticated denied-insert loops iterate over every table automatically. They pass if the migration does `enable rls` and `revoke`.
- The fake client supports select, eq, in, gte, lte, is, order, limit, range, insert, update, upsert, delete, single, maybeSingle. It has NO `lt`, `gt`, `not`, `neq` or `or`, so repo queries must stay within that set or extend `packages/db/test/fake-client.ts` (a small, safe change).
- Reading inputs:
  - `getRecentCloses` runs one query per symbol, with `limit(n)`.
  - `listFinancials(db, symbols, fromPeriod)` and `listOpenGaps(db, 'prices'|..., symbols)` are already batched with `in`.
  - Sector is not yet exposed by a batched repo function. Check `symbols.ts`; it needs a `listSectors` function that selects `symbol,sector` with `in` or a full list.
  - A single `in(symbols)` query for 200 closes would hit PostgREST's default `max-rows` of 1000. The truncation is silent: 5 symbols × 200 = 1000, so any more symbols lose rows. Do not batch closes across symbols.

## Recommendations

### DDL (new migration, e.g. `20261027000100_signals.sql`)
```sql
create table public.signals (
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
  rule_id text not null check (rule_id ~ '^[a-z0-9_]{1,60}$'),
  horizon text not null check (horizon in ('medium')),   -- widen later by migration; short/long are not v1
  signal_date date not null,          -- trade_date of the latest close used (NOT now()::date), see Risks
  label text check (label in ('bullish','bearish','neutral')),   -- direction; NULL iff suppressed
  value bigint,                       -- NULL iff suppressed
  data_fresh boolean not null,
  suppressed_reason text,
  inputs_snapshot jsonb not null,
  source text not null default 'stoktok-signals',   -- R4; or a rule-set version like 'rules-v1'
  computed_at timestamptz not null,   -- supplied by the job, like fetched_at
  created_at timestamptz not null default now(),
  primary key (symbol, rule_id, horizon, signal_date),
  check (jsonb_typeof(inputs_snapshot) = 'object' and pg_column_size(inputs_snapshot) <= 16384),
  check (suppressed_reason is null or (length(suppressed_reason) between 1 and 200 and suppressed_reason = btrim(suppressed_reason))),
  -- suppressed <=> no value, no label, and a reason; emitted => value + label + reason NULL
  check ((suppressed_reason is null) = (value is not null and label is not null)),
  check ((suppressed_reason is null) = (value is not null) ),
  check (suppressed_reason is null or data_fresh is not null)
);
create index signals_date_idx on public.signals (signal_date desc, symbol);  -- "latest signals" listing
alter table public.signals enable row level security;
revoke all on public.signals from anon, authenticated;
grant select, insert, update, delete on public.signals to service_role;
```
- Column choices:
  - `signal_date` as a real column is better than an expression index, because PostgREST `onConflict` needs plain columns. The PK is the idempotency key, and a re-run overwrites the row.
  - `value`: signed `bigint` in ppm (parts per million) of the rule's natural ratio. Examples: price/MA − 1, the P/E discount vs sector, EPS growth. Ratios are computed in core (R1, R2) as integers. Document the unit per `rule_id` in a `comment on column`. If a rule's ratio is undefined (negative EPS), suppress with a reason rather than storing a sentinel.
  - Deduplicate the two overlapping checks above: keep only `(suppressed_reason is null) = (value is not null and label is not null)`. I wrote both for clarity.
  - `data_fresh`: NOT NULL. A suppressed row for stale data has `data_fresh=false`. A suppressed row for other reasons (negative EPS, missing quarters) can have `data_fresh=true` with a reason. This keeps staleness separate from other suppression reasons (AC3).
  - `suppressed_reason`: store a stable code, not free text, for example `price_stale`, `price_gap`, `financials_stale`, `financials_gap`, `insufficient_history`, `negative_eps`, `sector_unknown`, `peers_insufficient`. Optionally add a check on the code list. The list will grow, so I would leave it as the format check above and keep the vocabulary in core as a typed union.
  - `inputs_snapshot`: the object check is cheap, and the size cap stops runaway snapshots. Snapshot the derived input values with their IDs, not 200 raw closes: the MA values, the last close and its `trade_date`, the period labels and EPS values used, the `fetched_at` of each input, the peer set (symbols plus their P/E) and the gap ids. Also snapshot the rule parameters used, so the audit survives later settings changes. Each row should stay under 4 KB. The 16 KB cap is generous; the size check is a guard.
  - Do not reference `settings` in the snapshot by FK. Copy the values.
- Suppressed rows are stored as `value null`, `label null` and a reason, so the audit trail covers every symbol and rule per day.

### db:check updates
- Update the `tables_exist` array.
- Add `signals_columns` using `assert_col`:
  - `value` is `bigint`, nullable.
  - `signal_date` is `date`, NOT NULL.
  - `data_fresh` is `boolean`, NOT NULL.
  - `inputs_snapshot` is `jsonb`, NOT NULL.
  - `computed_at` and `source` are NOT NULL.
- Add `service_role_can_read_write_signals`, modelled on the financials check.
- Add `rejects_bad_rows` cases, expecting 23514 unless noted:
  - lowercase symbol
  - bad `rule_id`
  - `horizon` 'long'
  - label 'buy' (the action word is not allowed; R9 says the AI never decides the action, and the rule label is a direction)
  - suppressed with a value
  - not suppressed with a null value
  - empty or untrimmed reason
  - `inputs_snapshot` that is a JSON array
  - `inputs_snapshot` null (23502)
  - an oversized snapshot
  - duplicate PK (23505)
  - null `data_fresh` (23502)
- No other check changes are needed. The numeric check is satisfied because `value` is bigint.

### Rollback
Check how the repo documents rollback for the other migrations (a comment block or a down file) and match it. For this migration it is only `drop table public.signals;`. It is safe because nothing references it. If `symbols` is not touched, there is nothing else to undo.

### Repo `packages/db/src/repos/signals.ts`
- `SignalInsert` and `SignalRow` in `rows.ts`, with a mapper in `mappers.ts` (bigint arrives as a string, so map it to a safe int as the other mappers do).
- `upsertSignals(db, rows, {chunkSize=500})`: copy `upsertFinancials` with the key `symbol|rule_id|horizon|signal_date` and `onConflict: 'symbol,rule_id,horizon,signal_date'`. All columns are overwritten on a re-run, including `computed_at`, `inputs_snapshot` and `suppressed_reason`. The count returned is the number of rows sent.
- `listSignals(db, {symbols, signalDate})`: `.in('symbol', …).eq('signal_date', d)`, with `[]` when there are no symbols. Add `listLatestSignals(db, symbols)` only if the Settings or UI tickets need it. Do not add `lt`, `gt` or `not` to repo queries.
- Fake-client tests, modelled on `financials.test.ts`:
  - dedupe with the later row winning, chunking (3 chunks for 5 rows at chunkSize 2), the `onConflict` string, and no `select`
  - an empty input makes no call
  - 23514 maps to VALIDATION, and 23505 or another unexpected code maps to its mapped DataError
  - `listSignals` calls `in` and `eq` with the right arguments, maps bigint strings and null (suppressed) rows, and gives MAPPING on a row missing `source`
  - an empty symbols list makes no call

### Reading inputs efficiently
- Closes: keep the per-symbol `getRecentCloses(db, [symbol], 200)` pattern. It runs one indexed PK-range query per symbol (`order trade_date desc limit 200`), which is cheap for a watchlist-sized universe. Run these with bounded concurrency (for example 5–10 at a time) rather than unbounded `Promise.all` if the universe exceeds a few dozen symbols. If a batched query is wanted later, it must paginate with `range` to get past the 1000-row cap.
- 200 closes are enough for the 200-day MA, but a gap or a young symbol gives fewer rows. Core must return `insufficient_history` when fewer than 200 closes exist. Do not compute a partial MA.
- Financials: one call, `listFinancials(db, symbols, fromPeriod)`, where `fromPeriod` is computed from the latest period minus 8 quarters. The result is at most 8 × N rows. This exceeds 1000 rows at about 125 symbols, so use chunks of 100 symbols or fewer.
- Gaps: one `listOpenGaps(db, 'prices', symbols)` and one for 'financials', each with `in`. The query is small. Include market-wide gaps (symbol NULL); the current function filters by `in('symbol')` and misses `symbol IS NULL`, so check what the data-gap logic already does. This is a real hole, because R4 says a market-wide gap must suppress too.
- Sector and peers: add `listSectors(db)` selecting `symbol,sector` from `symbols` in one query. This is a small table. Peer P/E needs the latest close and the latest EPS for each peer. Reuse the same batched reads over the peer universe, not a per-peer query.
- Peer universe: peers must come from the same stored data and the same freshness filter. Suppress `pe_vs_sector` and `pb_vs_sector` with `peers_insufficient` when a sector has fewer than N fresh peers (N is a setting, R5).

## Risks
- Idempotency date: `signal_date` must derive from the data (the last close's `trade_date`), not from the clock. A job run at 00:30 the next day, or a retry after midnight, would otherwise write a second row for the same data. If a run happens on a non-trading day, the key stays the same and the row is simply rewritten.
- Stale input: if the latest close is old, `signal_date` is still the old date. Suppression on staleness then collides with the earlier row for that date. This is acceptable: the rewritten row reflects the latest knowledge. But decide whether staleness is measured against the expected trading day. Taking `today` from the clock inside core breaks purity, so pass `asOf` into the rules.
- Overwrite loses history: a re-run replaces `inputs_snapshot`. That is fine for idempotency, and `computed_at` shows when. If audit history of revisions matters, it needs an append-only table, which I do not recommend for v1.
- EPS basis is UNVERIFIED (see the `financials.eps` comment and ADR 0002). P/E, earnings growth and the trend rule depend on it. If the basis is quarterly, TTM must be summed in core. Record the assumed basis in the snapshot.
- Float in core: ratios must be integer ppm computed with an explicit rounding rule defined once in `packages/core` (R2). Do not use JS floats for the stored value.
- Safe integer: ppm of a ratio can be large for tiny denominators. Guard against overflow beyond `Number.MAX_SAFE_INTEGER`, and suppress with a reason.
- Settings: new rule parameters in `settings` are a second migration change. Keep them as integer columns with check constraints, or as one jsonb with a schema check. Prefer typed integer columns for consistency with `fee_rate_ppm`. `db:check` has settings assertions that may need updating. The RLS and grants for `settings` already exist.
- Silent PostgREST truncation at 1000 rows applies to financials and to any batched read. Chunk symbols.
- R9 and R10: `label` is a direction of a rule, not a recommended action, so use 'bullish'/'bearish'/'neutral' rather than 'buy'/'sell'. This keeps the rules from deciding the action.
- R6 is suspended, so the table needs no auth code. Server-only access (service_role) is kept, so no policies are added and `no_policies` still passes.

## Open questions
1. Should `horizon` start as the single value 'medium', or an open set? The check above is closed. The ticket names only the medium term, so widening later is cheap.
2. Is `value` one number per rule, or do some rules need two (for example P/E and the sector median)? If the latter, keep `value` as the primary measure and put the other in the snapshot. Confirm the per-rule unit.
3. Do you want the `label` column at all, or derive the direction in the UI from `value` and the rule parameters? Storing it is better for audit, but it duplicates the parameter-dependent logic. R1 says the UI must not compute it, so I recommend storing it.
4. Should `suppressed_reason` be a closed code list enforced by a check, or a free-form text with a format check? I recommend free-form plus a typed union in core.
5. Market-wide gaps (`symbol IS NULL`): does the existing gap logic already count them as blocking, and which `data_type` values are used for prices and financials? I did not verify this in `data-gaps.ts` beyond the list function.
6. Retention: should old signals be pruned? Not for v1, but the table grows at symbols × rules × days, which is small.

Relevant files:
- /home/user/stoktok/supabase/migrations/20261026000100_financials.sql
- /home/user/stoktok/supabase/migrations/20261023000200_v1_rls_grants.sql
- /home/user/stoktok/scripts/db-check/checks.sql
- /home/user/stoktok/packages/db/src/repos/financials.ts
- /home/user/stoktok/packages/db/src/repos/prices-daily.ts
- /home/user/stoktok/packages/db/src/repos/data-gaps.ts
- /home/user/stoktok/packages/db/test/fake-client.ts
- /home/user/stoktok/packages/db/src/rows.ts
