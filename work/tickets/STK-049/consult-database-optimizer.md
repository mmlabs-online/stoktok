## STK-049 DB consult (prices_intraday)

I read the existing migrations, the grants file, checks.sql and the rollback pattern. I did not run anything.

### Findings
- **Conventions to copy** (from `20261023000100_v1_tables.sql` and `20261026000200_signals.sql`):
  - Prices are `integer`, volume is `bigint`, and symbols use the `check (symbol ~ '^[A-Z0-9]{1,20}$')` pattern.
  - `source` and `fetched_at` are `not null`.
  - RLS and grants must live in the new migration itself. The grants loop in `20261023000200` only covers tables that existed then, which is the same note the signals migration carries.
  - Rollback is one file per migration in `supabase/rollback/*.down.sql`.
- **checks.sql coupling:** the `tables_exist` check hard-codes the full table list, so adding the table breaks it until you update that list.
- **Other blanket checks that will cover the new table with no edit:**
  - `rls_enabled_all_tables`
  - `no_policies`
  - `no_grants_anon_authenticated_public`
  - the anon/authenticated select and insert denial loop
  - `no_numeric_or_float_columns`
- **`data_gaps_type` for daily prices is `prices_daily`.** The constant is `PRICES_GAP_TYPE` in `packages/core/src/market/price-gaps.ts`, and financials uses `'financials'`. Both are free text, and `data_gaps.data_type` has no check constraint.
- **`ts` meaning:** `prices_daily` is date-keyed and has no `ts`, so `prices_intraday.ts` is new. Define it as the source's quote or trade time, not the fetch time.

### Recommendations

**1. Schema** (migration `2026110x000100_prices_intraday.sql`; pick a timestamp after `20261105000100`)
```sql
create table public.prices_intraday (
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
  ts timestamptz not null,
  price integer not null check (price > 0),
  volume bigint not null check (volume >= 0),
  source text not null check (source <> ''),
  fetched_at timestamptz not null,
  primary key (symbol, ts)
);
comment on column public.prices_intraday.ts is 'source quote/trade time (not fetch time)';
comment on column public.prices_intraday.volume is 'cumulative session volume as reported by the source (confirm)';
create index prices_intraday_fetched_at_idx on public.prices_intraday (fetched_at);
```
- Use integer VND (R2) and no numeric columns.
- `price > 0` is appropriate here. A live quote of 0 means "no trade yet" and should not be stored.
- Add `check (fetched_at >= ts - interval '5 minutes')` only if the source clock is trusted. I would skip it.
- Adding `ref/ceiling/floor` columns is out of scope.

**2. Primary key and upsert**
- The primary key `(symbol, ts)` also serves "latest price per symbol", because it is a btree on `(symbol, ts)`.
- The query `select ... where symbol = $1 order by ts desc limit 1` is an index-only backward scan, and no extra index is needed.
- For many symbols, use `select distinct on (symbol) ... order by symbol, ts desc`, which is also served by the primary key. For about 50 symbols a lateral `limit 1` per symbol is fine too.
- Upsert:
  ```sql
  on conflict (symbol, ts) do update
    set price = excluded.price, volume = excluded.volume, source = excluded.source, fetched_at = excluded.fetched_at
    where excluded.fetched_at > prices_intraday.fetched_at
  ```
  This is idempotent. A repeated poll that returns the same quote time `ts` rewrites one row, and an out-of-order late write does not overwrite newer data.
- If the source gives no trustworthy per-quote `ts`, do not use `now()` as `ts`. That creates a row per call, and the 30 s cadence gives about 600 rows per symbol per session. Either truncate `ts` to the 30 s bucket, or accept the source `ts` and store only when it advances. The planner should decide and test this.
- A supabase-js `upsert` with `onConflict: 'symbol,ts'` cannot express the `where excluded.fetched_at >` guard. If the guard is wanted, use an RPC function or accept last-write-wins. Last-write-wins is acceptable at this scale.

**3. Throttle state**
- Do not use a separate table for the plain "latest fetch" read. `max(fetched_at)` per symbol from `prices_intraday` is enough for "is the stored price fresh".
- That read has two problems:
  - A source call that succeeds but returns an unchanged `ts` (the same quote) would not advance `max(fetched_at)` unless the upsert refreshes `fetched_at`. The upsert above does that, so this case is covered.
  - Failed calls store nothing, so a failing source would be hammered by every tab. You need negative caching.
- It also cannot give an atomic claim. Two concurrent requests both see "stale" and both call the source.
- Recommended: a small table `intraday_fetch_state(symbol text primary key, last_attempt_at timestamptz not null, last_success_at timestamptz, last_error text)`, with the same RLS and grants and `symbol` check.
- Atomic claim, done through an RPC or raw SQL. A supabase-js builder cannot do the conditional update:
  ```sql
  insert into intraday_fetch_state (symbol, last_attempt_at) select s, now() from unnest($1::text[]) s
  on conflict (symbol) do update set last_attempt_at = now()
    where intraday_fetch_state.last_attempt_at <= now() - make_interval(secs => $2)
  returning symbol;
  ```
  The returned symbols are the ones this request won and may fetch. The rest read the stored price. `now()` is transaction time, which is fine here.
- This is a single statement, so row locking makes it atomic across tabs and web replicas. Because it claims on attempt, failures are throttled too.
- Create an RPC function (`security invoker`, `execute` granted to `service_role` only, `revoke ... from public, anon, authenticated`) so the web server can call it. The `no_grants` check looks at table and sequence grants, not function grants, so add an explicit function-privilege check.
- The default-privilege revoke for functions exists, but `PUBLIC` has execute by default on new functions, so revoke it explicitly.
- A batch claim means one source call per symbol set, and the source adapter can batch the symbols it won.
- If you want fewer objects, the claim can be an in-process mutex plus the `max(fetched_at)` check. That is not safe if the web app ever runs two instances, and it is lost on restart. For one Docker container it is acceptable as a fallback. I prefer the table.

**4. Retention**
- Volume is small: about 700 rows per symbol per 6 h session (the 30 s cadence gives 2 rows a minute, so about 720). With about 50 symbols that is about 36k rows a day, or about 13M a year if kept. Pruning is housekeeping, not urgent.
- Policy: keep intraday rows for a limited period (suggest 30 days, as configuration, R5) and rely on `prices_daily` for history.
- Do the pruning in the worker, not in the web server, as a new daily job after EOD: `delete from prices_intraday where ts < now() - interval '30 days'`. The `(symbol, ts)` primary key does not serve a global `ts` range delete, so add `create index prices_intraday_ts_idx on public.prices_intraday (ts)`. This index replaces the `fetched_at` index above, so drop that one unless it is used. A scheduled prune needs a worker ticket, so make it a follow-up (R7) and note the table is unbounded until then.
- Do not use partitioning or pg_cron. That is over-engineering for 36k rows a day.
- Short-term signals (not in scope) will need at least 20 days of history, so 30 days is compatible.

**5. RLS and grants** (in the same migration)
```sql
alter table public.prices_intraday enable row level security;
revoke all on public.prices_intraday from anon, authenticated;
grant select, insert, update, delete on public.prices_intraday to service_role;
```
- Apply the same to `intraday_fetch_state` if you add it.
- There are no policies and no sequences (no identity column).
- `delete` is needed for the prune job.

**6. checks.sql additions**
- Add `intraday_fetch_state` (if used) and `prices_intraday` to the `tables_exist` array, keeping it alphabetically sorted: `assets, corporate_actions, data_gaps, financials, intraday_fetch_state, prices_daily, prices_intraday, settings, signals, symbols, transactions, watchlist`.
- Add to `money_columns_bigint`: `assert_col('prices_intraday','volume','bigint',true)`.
- Add to `qty_price_columns_integer`: `assert_col('prices_intraday','price','integer',true)`.
- Add to `source_fetched_at_not_null`: `source` as `text`/true and `fetched_at` as `timestamp with time zone`/true. Also assert `ts` as `timestamp with time zone`/true.
- Add a `service_role_can_read_write_prices_intraday` block. It should insert, then upsert the same `(symbol, ts)` with a new price and assert one row with the new price, and then assert the stale-write guard if you implement it.
- Add to `rejects_bad_rows`:
  - price 0 (23514)
  - price -1 (23514)
  - lowercase symbol (23514)
  - negative volume (23514)
  - null source (23502)
  - null fetched_at (23502)
  - duplicate `(symbol, ts)` (23505)
  - empty source (23514)
- If you add the claim function, add a check that two claims within the window return the symbol only once, and that anon/authenticated cannot execute it (SQLSTATE 42501).

**7. Rollback**
- `supabase/rollback/<ts>_prices_intraday.down.sql` containing `drop table if exists public.intraday_fetch_state; drop table if exists public.prices_intraday;`.
- Also `drop function if exists` for the claim RPC, first.

**8. data_gaps**
- Do not add intraday rows to `data_gaps` from the web fetch path.
- A failed poll is a transient staleness state, which the UI shows from `fetched_at` age and `intraday_fetch_state.last_error`. It is not a gap in the sense of the spec §2 gap handling.
- If gap recording is wanted later, use a distinct `data_type` such as `'prices_intraday'` (mirroring `prices_daily` and `financials`), market-wide gaps with `symbol` null. Do not reuse `'prices_daily'`: `listAllOpenGaps` and `listOpenMarketGaps` filter on that type, and `eod-sync` resolves them, so mixing would corrupt EOD gap resolution.
- Gap detection across intraday is the existing ticket STK-021.
- Constants belong in `packages/core` like `PRICES_GAP_TYPE`.

### Risks
- Without negative caching (attempt-based claim), a failing or rate-limiting source gets hit by every tab every refresh.
- If `ts` is derived from `now()`, row growth is unbounded relative to the quote rate and `(symbol, ts)` stops deduplicating anything.
- Using `max(fetched_at)` alone for throttling has a race between concurrent requests, which defeats the "at most one source call" acceptance criterion.
- The `tables_exist` check fails until its array is updated.
- Pruning is a worker job. If it is deferred, the table grows without bound until it is implemented.
- Mixing intraday and EOD semantics: a row's `price` is not a close. Readers (dashboard P&L through `packages/core`) must use the latest intraday price only when `ts` is today and within session. Keep that rule in core (R1).

### Open questions
- Does the source (VCI or TCBS public endpoint) return a per-quote trade time to use as `ts`, and is `volume` cumulative for the day? This determines the dedup key and the volume semantics.
- Is the claim table plus RPC acceptable, or should the throttle be an in-process lock (single instance)? I recommend the table.
- Retention window: 30 days OK? (Ming or planner decision; put it in config, R5.)
- Should the prune job be in this ticket or a follow-up? Recommend a follow-up.
- Is the stale-write guard (`where excluded.fetched_at > ...`) required? If yes, it needs an RPC rather than a supabase-js upsert.

### Files referenced
- /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql
- /home/user/stoktok/supabase/migrations/20261023000200_v1_rls_grants.sql
- /home/user/stoktok/supabase/migrations/20261026000200_signals.sql
- /home/user/stoktok/supabase/rollback/20261026000200_signals.down.sql
- /home/user/stoktok/scripts/db-check/checks.sql
- /home/user/stoktok/packages/core/src/market/price-gaps.ts
- /home/user/stoktok/packages/db/src/repos/data-gaps.test.ts
- /home/user/stoktok/work/tickets/STK-049/ticket.md
