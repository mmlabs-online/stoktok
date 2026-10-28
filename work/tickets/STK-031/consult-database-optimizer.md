# consult-database-optimizer — STK-031

## Findings

**Schema (no gaps for this ticket)**
- `prices_daily` has PK `(symbol, trade_date)` with `trade_date date`. A query like `eq(symbol) + gte/lte(trade_date)`, selecting only `trade_date`, is a pure PK range scan and can be index-only. The "first stored date" query (`order trade_date asc limit 1`) is also a cheap PK probe. No new index is needed.
- `data_gaps` has `id`, nullable `symbol`, `data_type`, `from_ts`/`to_ts` (timestamptz), `detected_at`, `source`, `fetched_at` and `resolved_at`. Its only index is `(symbol, from_ts)`.
  - It serves `eq(symbol)` and also `symbol IS NULL`, because btree indexes NULLs. `data_type` and `resolved_at` are filtered after the index lookup.
  - The table is tiny (open gaps per symbol), so this fits for v1. No `resolved_at` partial index is justified yet.
- `settings.holidays` is `date[]`. `settings.ts` exists, so read holidays through the existing repo.

**Existing repos**
- `listOpenGaps(db, dataType, symbols)` already filters `data_type`, `symbol IN`, and `resolved_at IS NULL`. `resolveGaps` only updates `resolved_at`, so gaps are never deleted or edited. `insertGaps` takes `DataGapInsert`. These are reusable as they are.
- There is no dedupe in the repo. It is app-side, and STK-014's financials planning presumably does it. Reuse that pattern.
- `prices-daily.ts` has no range or date-list reader. Only `getLatestCloses` and `getRecentCloses` (limit n) exist.
- The fake client already supports `gte`, `lte`, `range`, `order`, `limit` and `is`. It does not simulate filtering or return value types.

**Dedupe by instant**
- PostgREST returns timestamptz as `2026-10-23T17:00:00+00:00`. JS `toISOString()` gives `...000Z`. String equality will wrongly treat these as different, so duplicates would pile up.
- Compare with `Date.parse(x)` (epoch ms). Key on `${symbol}|${fromMs}|${toMs}`.

## Recommendations

1. **New reads in `prices-daily.ts`** (AC1, AC4)
   - `listTradeDates(db, symbol, from, to): Promise<string[]>`. It selects `trade_date`, uses `eq(symbol)`, `gte(from)`, `lte(to)` and `order(asc)`, and returns date strings.
   - `getFirstTradeDates(db, symbols): Record<string, string>`. It runs one query per symbol (asc, limit 1, maybeSingle), the same shape as `getLatestCloses`.
   - PostgREST caps responses at 1000 rows by default. Query per symbol, and the lookback must stay at or under about 900 trading days. Otherwise page with `.range()` until a short page comes back. Add a guard or test for this.
2. **Pure logic in `packages/core`** (AC5, R1/R5)
   - `tradingDaysBetween(from, to, holidays)`. Use `YYYY-MM-DD` strings and UTC day arithmetic, with no local-TZ `Date`. Skip Saturday and Sunday and holidays.
   - `expectedRange`: start = `max(firstStoredDate, today − lookback)`, end = last completed trading day. Without an end cutoff, a run before the day's EOD sync would record today as a false gap. Use Asia/Ho_Chi_Minh and a configurable cutoff time (R5).
   - `planGaps({missingDays, openGaps, ...})` returns `{toInsert, toResolve}`.
3. **Gap granularity: one gap per missing trading day**
   - Per-day gaps make dedupe a simple key match, and resolution is all-or-nothing.
   - Runs would force split logic. `from_ts`/`to_ts` can't be edited, so a partly filled run would need to be resolved and its remainder re-inserted.
   - Row count is bounded by the lookback. Choose per-day unless the planner objects.
   - Bounds: `from_ts` = 00:00+07 of the day (previous day 17:00Z). `to_ts` = the end of that day, in the same style as the financials gaps (`...59.000Z`). Document this in one core helper.
4. **Resolve semantics** (AC3)
   - Each run, recompute missing days from stored dates. Resolve every open gap whose days are all now stored, using one `resolveGaps` call with a single `resolvedAt`.
   - Also resolve open gaps that now contain no expected trading day, for example because a holiday was added later. In that case `resolved_at` means "no longer expected", not "data arrived". Note this in the code comment and impl-log.
   - Gaps for a symbol whose open gap falls before the new lookback floor stay open. Resolve only on data arrival or holiday, never on lookback shrink.
5. **Migration: none needed now** (confirms the ticket)
   - Correctness holds with sequential runs because list → insert is deduped app-side.
   - Keep these follow-ups:
     - A partial unique index `(symbol, data_type, from_ts, to_ts) WHERE resolved_at IS NULL`, with `NULLS NOT DISTINCT` (PG15+) or a coalesce expression to cover market-wide gaps. Duplicates created in the meantime would block the index build, so a dedupe cleanup is needed first. Don't defer this indefinitely.
     - A single-run lock (advisory lock or worker-level mutex).
   - Mitigation until then: consumers must treat "any open gap overlapping the date" as a boolean, never count rows. Duplicates are then harmless. Resolve all duplicates together by matching on key.
6. **Fake-client tests** (AC5)
   - Repos: assert call shape only, such as `eq('symbol', X)`, `gte('trade_date', from)`, `lte`, `order('trade_date', {ascending:true})`, and `select('trade_date')`. Cover empty input (no call), error → `DataError`, a bad row → MAPPING, and pagination via queued responses if you add it.
   - Real behavior goes in core pure-function tests: weekends, holidays, floor at first date, a cutoff before/after EOD, instant dedupe with `+00:00` vs `Z` and different ms formatting, resolve when filled, resolve when holiday added, and an idempotent second run returning `{toInsert: [], toResolve: []}`.
   - An orchestration test at job level would use a stateful in-memory stub of the repo functions rather than the fake client, since the fake can't filter.

## Risks
- **Race:** overlapping runs (cron overlap or manual run) can double-insert open gaps, as noted above.
- **False gaps:** wrong end cutoff (today before EOD), wrong timezone for date → instant, or missing holiday config. If `settings.holidays` isn't maintained, every unlisted holiday becomes a gap. This is a data-quality issue, so surface it in the job log.
- **R4 impact:** if the provider is down for all symbols, a flood of per-day gaps appears. Consider also writing one market-wide gap (`symbol` NULL), but `listOpenGaps` ignores it, so use `listOpenMarketGaps`. This may be out of scope, so record it as a follow-up.
- **Fetch failure vs missing data:** don't create gaps for symbols whose fetch errored this run unless the intent is to record them. Be explicit.
- **Large inserts:** `insertGaps` sends one request with all rows. Chunk it if a long outage could produce thousands of rows.
- **Resolution:** gaps resolved on "no longer expected" lose the signal of why. This is acceptable for v1.

## Open questions
1. Per-day gaps or contiguous runs? I recommend per-day.
2. What are the lookback length and EOD cutoff time, and where are they configured: `settings.rule_configs` or a core default (R5)?
3. Should a failed fetch or a market-wide outage also write gaps (symbol NULL)?
4. Is "resolved because holiday added" acceptable semantics, or should such gaps be left open?
5. Is `insertGaps` chunking wanted now, or a follow-up?

Files reviewed:
- /home/user/stoktok/work/tickets/STK-031/ticket.md
- /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql
- /home/user/stoktok/packages/db/src/repos/data-gaps.ts
- /home/user/stoktok/packages/db/src/repos/prices-daily.ts
- /home/user/stoktok/packages/db/test/fake-client.ts
