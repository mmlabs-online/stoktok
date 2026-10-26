# consult-database-optimizer — STK-014

STK-014 DB consult (read-only). I read the three migrations, checks.sql, the prices-daily and symbols repos, symbols.test.ts, and R2/R4. I did not open test/fake-client.ts or rows.ts in full.

## Findings
- `symbols` (20261025000100) is a table with PK `symbol`, a nullable `exchange` and an `updated_at`. It enables RLS, revokes anon/authenticated, and grants service_role inline. The grants loop in 20261023000200 only covers tables that existed then, so every new table must repeat RLS and grants in its own migration.
- `prices_daily` is the pattern to copy:
  - composite PK `(symbol, trade_date)`;
  - symbol regex check;
  - `source text not null`, `fetched_at timestamptz not null`;
  - table-level sanity checks.
- `upsertPricesDaily` dedupes in memory by key (later row wins), upserts in sequential chunks with `onConflict`, uses no `.select()`, and returns the number of rows sent.
- `setSymbolExchange` upserts only `{symbol, exchange, updated_at}`. PostgREST merge-duplicates updates only the columns sent, so a new `sector` column would not be wiped by it. The reverse also holds: a sector upsert must not send `exchange`, or it will overwrite it.
- `data_gaps` has no unique key, only an index on `(symbol, from_ts)`. It also has `resolved_at`, `detected_at`, and `source`/`fetched_at` NOT NULL. There is no data_gaps repo in `packages/db` yet.
- `checks.sql` has several parts that a new table affects:
  - `tables_exist` is an exact sorted array.
  - The `no_numeric_or_float_columns` check forbids numeric columns, so use integer and bigint only.
  - The `rls_enabled_all_tables`, `no_policies`, and `anon/authenticated_denied` checks loop over all tables. They pick up `financials` automatically.

## Recommendations

### 1. Migration `supabase/migrations/2026102x000100_financials.sql`
This is one file with both the new table and the ALTER on `symbols`.
```sql
create table public.financials (
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
  period text not null check (period ~ '^[0-9]{4}Q[1-4]$'),
  eps integer,                 -- VND per share, may be negative
  bvps integer,                -- VND per share, may be negative (negative equity)
  revenue bigint,              -- VND, may be negative
  net_income bigint,           -- VND, may be negative
  source text not null,
  fetched_at timestamptz not null,
  primary key (symbol, period),
  check (eps is not null or bvps is not null or revenue is not null or net_income is not null)
);
comment on column public.financials.eps is 'VND per share, integer (R2); negative = loss';
comment on column public.financials.revenue is 'VND per quarter (not thousands/millions); guard units in the adapter';
alter table public.financials enable row level security;
revoke all on public.financials from anon, authenticated;
grant select, insert, update, delete on public.financials to service_role;

alter table public.symbols add column sector text check (sector is null or btrim(sector) <> '');
comment on column public.symbols.sector is 'NULL = unknown; free text from source; sector fetched_at/source live in data_gaps or are not tracked in v1';
```
- **Types:**
  - `eps` and `bvps` as `integer` are fine. VND per share is at most about 10^6, and int4 holds 2.1e9.
  - `revenue` and `net_income` must be `bigint`. A large-cap quarter exceeds 2^31 VND by orders of magnitude.
  - All four are nullable. A missing metric is not zero, and the "record, don't fill" criterion implies NULL. Do not add `>= 0` checks.
- **Period check:** `^[0-9]{4}Q[1-4]$` is good. Optionally restrict the year to 1990-2100 in the adapter, not the DDL.
- **At-least-one-metric check:** it blocks empty shell rows. If a period is entirely absent, record a gap instead of a row.
- **Index:** the PK `(symbol, period)` covers the "latest N periods per symbol" query. Period strings sort lexicographically in chronological order, so `order('period', desc)` works. No extra index is needed.
- **Sector as a column on `symbols`:**
  - Sector is 1:1 with symbol and the table already exists, so a separate table is over-modeling.
  - A nullable column avoids a join and reuses RLS and grants.
  - The ticket says "a symbol→sector mapping". A column on `symbols` satisfies that.
  - Caveat: `symbols` has no `source`/`fetched_at`, so sector would be the one market-data value without provenance (R4). Options:
    - (a) Accept it, because sector is slow-changing reference data and not a signal input. Document this in the migration comment.
    - (b) Add `sector_source text` and `sector_fetched_at timestamptz`, with a check that both are set or both are NULL. I recommend (b) because it is cheap and R4 is a hard rule.

    Do not use the symbols `updated_at` as a stand-in.
- **Rollback:** the repo has no down-migration convention in the files I saw. Put the down SQL in a comment block at the top of the migration, or in `supabase/README.md` if that is where the others are. Down SQL: `alter table public.symbols drop column sector[, sector_source, sector_fetched_at]; drop table public.financials;`. It is safe, since the new data is re-fetchable. Check `supabase/README.md` for the convention.

### 2. `scripts/db-check/checks.sql`
- **`tables_exist`:** add `'financials'` in sorted position, between `data_gaps` and `prices_daily`: `assets, corporate_actions, data_gaps, financials, prices_daily, settings, symbols, transactions, watchlist`.
- **Column asserts:**
  - `money_columns_bigint`: add `financials.revenue` and `financials.net_income` as bigint.
  - `qty_price_columns_integer`: add `financials.eps` and `financials.bvps` as integer, nullable.
  - `source_fetched_at_not_null`: add `financials.source` as text NOT NULL and `financials.fetched_at` as timestamptz NOT NULL.
  - `symbols_columns`: add `sector` as text, nullable, plus the sector provenance columns if you take option (b).
- **Bad-row cases in `rejects_bad_rows`**, with `fi` defined like `pd`: `insert into public.financials (symbol, period, eps, source, fetched_at) values `
  - period `'2026Q5'` → 23514
  - period `'2026-Q1'` → 23514
  - period `'26Q1'` → 23514
  - lowercase symbol → 23514
  - all four metrics NULL → 23514
  - NULL source → 23502, and NULL `fetched_at` → 23502
  - sector `''` → 23514
- **Positive and duplicate cases:**
  - Negative eps, bvps, revenue and net_income must be accepted. This guards against someone adding a `>= 0` check later.
  - A duplicate `(symbol, period)` → 23505.
  - A partial row, with only eps set, is accepted.
- **Service role:** add a `service_role_can_read_write_financials` block like the symbols one.
- **Denied loops:** the anon/authenticated insert-default-values loop works unchanged. Table privilege 42501 fires before any NOT NULL violation.

### 3. Repo `packages/db/src/repos/financials.ts`
- Add `FinancialInsert` and `FinancialRow` to `rows.ts`, a mapper to a core type, and exports in `index.ts`.
- `upsertFinancials(db, rows, {chunkSize})`: copy `upsertPricesDaily`, with the key `symbol|period`, `onConflict: 'symbol,period'`, a later duplicate winning, and sequential chunks. Return the number of rows sent.
- On refetch, the upsert overwrites all of a row's columns including `fetched_at`. A restatement therefore updates the values. A NULL in the new payload overwrites a previously stored value. Say so in the doc comment, or have the adapter always send the full row.
- `getFinancials(db, symbols, n = 8)` for the later valuation tickets. This is optional and would be scope creep for R7, so put it in the follow-ups if the ticket doesn't need it.
- `setSymbolSector(db, symbol, sector, source, fetchedAt)` upserts `{symbol, sector, ..., updated_at}` with `onConflict: 'symbol'` and must not include `exchange`. Also consider a bulk `upsertSymbolSectors(db, rows[])`, since the job handles many symbols.
- A new symbols row created via the sector upsert has `exchange` NULL, which is the documented "unknown" state and fine.
- **Fake-client tests**, mirroring symbols.test.ts and prices-daily.test.ts:
  - dedupe, with the later duplicate winning
  - chunking (chunkSize 2 with 5 rows gives 3 upsert calls)
  - `onConflict` equals `'symbol,period'`
  - no `.select()` is called
  - empty input makes no calls
  - an error maps to DataError (23514 → VALIDATION)
  - the sector payload contains no `exchange` key
  - negative values pass through untouched
  - returns the count

### 4. Gaps for missing periods
- **Which periods count as missing:** a period is missing if the source returns no row for a quarter inside the expected window. The window is the last N quarters up to the latest completed quarter, allowing for the usual reporting lag (about 45 days after quarter end, longer for annual-audited Q4 reports).
- **Not-yet-due quarters:** do not record a gap for a quarter that is not yet due.
- **What to write:** `data_type = 'financials'`, `symbol`, and `from_ts`/`to_ts` set to the quarter start and end as UTC timestamps. Gaps live in `data_gaps`, which has no period column, so the period is encoded only by `from_ts`/`to_ts`. Use fixed UTC quarter boundaries, or the dedupe won't work.
- **Source and fetched_at:** the source name, and the fetch time of the response that lacked the row.
- **App-side dedupe:** follow the STK-005 consult. Before inserting, select open gaps with `data_type = 'financials'`, `symbol` in the set, and `resolved_at is null`, and skip any `(symbol, from_ts, to_ts)` already present. This uses the `data_gaps_symbol_from_idx` index.
- **Resolving gaps:** when a later fetch returns the period, set `resolved_at` on the matching gap. If you skip this, gaps stay open forever and the dedupe hides new ones. It is a small update in the same job.
- **Race and idempotency:** the single worker has no concurrent runs, so the race is acceptable. If concurrency is ever added, a partial unique index on `(symbol, data_type, from_ts, to_ts) where resolved_at is null` would make this safe. Do not add it now.
- **Core logic:** the "expected quarters" computation is domain logic and belongs in `packages/core` or the worker, not in the repo layer, with unit tests (R8).
- **Staleness for signals:** R4 says gapped or stale data never produces a signal. The valuation consumer must check for open gaps and `fetched_at` age. That is out of scope here, so list it as a follow-up.

## Risks
- **Units (high):** the TCBS API may return values in billions of VND, or in VND per share but as decimals. Convert in the adapter with explicit guards, and round per the single rule in `packages/core` (R2). Reject non-finite values and anything outside plausible bounds (for example `|revenue| > 1e15`) and record a gap. The synthetic fixtures cannot prove the real units, so flag that the first live run needs a manual check (the sandbox cannot reach Vietnamese hosts).
- **Overwrite semantics:** a refetch with a missing metric nulls out a stored value. Make the adapter's output complete, or document the behavior.
- **Sector without provenance (R4):** see option (b) above.
- **Sector taxonomy:** free text from the source is not stable (ICB vs TCBS naming) and may change or be renamed. Do not add a CHECK enumeration. Treat it as display and grouping data.
- **The `symbols` ALTER:** it takes a brief ACCESS EXCLUSIVE lock, but the table is tiny. A nullable column with no default is metadata-only, so this is fine.
- **Duplicate-gap growth:** if the dedupe is skipped or buggy, open gaps accumulate daily per symbol, since the job runs daily.
- **Migration filename ordering:** use a timestamp later than 20261025000100.

## Open questions
1. Take sector provenance option (a) or (b)? I recommend (b).
2. Does `supabase/README.md` define a rollback convention, such as down SQL in a comment or separate files?
3. Should the at-least-one-metric check stay, or should NULL-only rows be allowed (for example, a row that says the quarter was reported with no figures)? I recommend keeping it.
4. Should `period` be stored as the fiscal quarter label only? Fiscal-year-offset companies are rare on the VN market, so I assume calendar quarters, but this should be stated in the adapter ADR.
5. Where will `getFinancials` be needed first (STK-015+)? If nowhere in this ticket, leave it out (R7).

Relevant files:
- /home/user/stoktok/supabase/migrations/20261025000100_symbols.sql
- /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql
- /home/user/stoktok/supabase/migrations/20261023000200_v1_rls_grants.sql
- /home/user/stoktok/scripts/db-check/checks.sql
- /home/user/stoktok/packages/db/src/repos/prices-daily.ts
- /home/user/stoktok/packages/db/src/repos/symbols.ts
- /home/user/stoktok/packages/db/src/repos/symbols.test.ts
- /home/user/stoktok/packages/db/src/rows.ts
