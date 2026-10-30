Status: READY

# Plan — STK-031: Daily price gap detection

## Spec summary
- §2.2 Data constraints: "Gaps happen (sleep, Windows Update, network). Gaps must be detected, not silently interpolated."
- §3 F4: "Signals are suppressed if the underlying data is stale or has gaps."
- §4.4 Job schedule: "| Gap detection | After each poll and at EOD |". This ticket covers **EOD only**. The intraday poll does not exist yet.
- §5 Data model: "| `data_gaps` | symbol, from_ts, to_ts, detected_at |". The existing table also has `data_type`, `source`, `fetched_at` and `resolved_at`. No migration is needed.
- CLAUDE.md R4: "Every market-data record carries `source` and `fetched_at`. Stale or gapped data never produces a signal; gaps are recorded." R5: market rules are configuration. Holidays come from `settings.holidays`, and the lookback from `EOD_SYNC_CONFIG.lookbackTradingDays`.
- Ticket notes: reuse the `packages/db/src/repos/data-gaps.ts` repo from STK-014. "No migration planned; a partial unique index on open gaps and a single-run lock are follow-ups."

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Missing trading days for a symbol are written to `data_gaps` with data_type `prices_daily`. Weekends and configured holidays are not gaps. | `price-gaps.test.ts` › "records missing trading days; weekends and holidays are not gaps". `eod-sync.test.ts` › "records a prices_daily gap per missing trading day after the upsert" checks the row: symbol, `data_type: 'prices_daily'`, `from_ts`/`to_ts` from `vnDayBoundsUtc`, `source = source.name`, `fetched_at = run time`. `calendar.test.ts` › `tradingDaysBetween` cases. |
| 2 | Re-running the job does not duplicate open gaps. Dedupe is app-side, and timestamptz values are compared by instant, not by string. | `price-gaps.test.ts` › "an open gap stored as +00:00 matches a new day computed as Z (no re-record)" and "second plan over the same state is empty". `eod-sync.test.ts` › "re-run inserts no new gaps". |
| 3 | Gaps get `resolved_at` when the missing data is later stored. Gaps are never deleted. | `price-gaps.test.ts` › "resolves an open gap once its day is stored", "resolves a gap whose day became a holiday", "multi-day open gap resolves only when every trading day is stored". `eod-sync.test.ts` › "resolves a gap when the bar arrives; gap row kept with resolved_at = fetchedAt". `data-gaps.test.ts` › "resolveGaps only touches unresolved rows" (`.is('resolved_at', null)`). Grep: no `.delete(` in `data-gaps.ts`. |
| 4 | The expected range never starts before the symbol's first stored date or the configured lookback. New listings and newly watched symbols produce no false gaps. | `price-gaps.test.ts` › "no stored data → no gaps", "start clamps to first stored date", "start clamps to windowStart". `eod-sync.test.ts` › "symbol first stored mid-window gets no earlier gaps". |
| 5 | Core trading-day range helpers and gap planning have unit tests. Repos have fake-client tests. Tests use no live network. | The tests listed below exist. `pnpm typecheck && pnpm lint && pnpm test` pass. Worker tests use the in-memory store and fake source only. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/calendar.ts` | Add `tradingDaysBetween(from, to, holidays): string[]` (inclusive; empty if from > to; RangeError on an invalid date). Add `vnDayBoundsUtc(date): { fromTs; toTs }` (00:00:00+07:00 and 23:59:59+07:00, as ISO UTC strings). | AC1, AC4. The writer and the reader share one day-bounds definition. |
| `packages/core/src/calendar.test.ts` | Tests for both helpers. | AC5 |
| `packages/core/src/market/price-gaps.ts` (new) | Pure `planPriceGaps(...)` and `priceGapReadRange(...)`. | AC1–AC4 (R1: logic lives in core) |
| `packages/core/src/market/price-gaps.test.ts` (new) | Planning tests. | AC5 |
| `packages/core/src/signals/inputs.ts` | `vnDayBounds` reuses `vnDayBoundsUtc` (one-line body change, same output). | Writer/reader boundary stays shared (consult: data-engineer). |
| `packages/core/src/index.ts` | Export `tradingDaysBetween`, `vnDayBoundsUtc`, `planPriceGaps`, `priceGapReadRange` and the `PriceGapPlan` type. | Used by the worker |
| `packages/db/src/repos/prices-daily.ts` | Add `listPriceDates(db, symbol, from, to, { pageSize = 1000 })`, paginated with `.range()` until a short page. Add `getFirstPriceDates(db, symbols): Record<string, string>` (one query per symbol, asc, limit 1, maybeSingle; no row → omitted). | AC1, AC3, AC4 |
| `packages/db/src/repos/prices-daily.test.ts` | Fake-client tests for both. | AC5 |
| `packages/db/src/rows.ts` | Add `TradeDateRow { trade_date: string }`. | Typed row for the new reads |
| `packages/db/src/mappers.ts` | Add `tradeDateFromRow` (validates `DATE_RE`, otherwise `RowMappingError`). | Bad row → MAPPING, same as the other repos |
| `packages/db/src/repos/data-gaps.ts` | `resolveGaps` adds `.is('resolved_at', null)`. | AC3: a rerun never overwrites an earlier `resolved_at` |
| `packages/db/src/repos/data-gaps.test.ts` | Assert the new `is` filter. | AC5 |
| `packages/db/src/index.ts` | Export `listPriceDates` and `getFirstPriceDates`. | Wiring |
| `apps/worker/src/jobs/eod-sync.ts` | Move `PRICES_GAP_TYPE` here. Extend `EodStore` and `EodSummary`. Add the gap step after the upsert. | AC1–AC4 |
| `apps/worker/src/jobs/eod-sync.test.ts` | Make the memory store stateful (price dates, first dates, gaps). Add gap tests. | AC5 |
| `apps/worker/src/jobs/medium-signals.ts` | Delete the local `PRICES_GAP_TYPE`; `import { PRICES_GAP_TYPE } from './eod-sync'`. | Shared constant; mirrors `FINANCIALS_GAP_TYPE` in `financials-sync.ts` |
| `apps/worker/src/store.ts` | Wire the new `EodStore` methods: `listOpenGaps(db, PRICES_GAP_TYPE, …)`, `insertGaps`, `resolveGaps`, `listPriceDates`, `getFirstPriceDates`. | Wiring |
| `apps/worker/src/store.test.ts` | Mock the new db functions. Assert the EOD wiring uses `'prices_daily'`. | AC5 |

There is no migration and no change to `cli.ts` or `config.ts`. The existing lookback config is reused.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| calendar.test.ts › tradingDaysBetween: Fri→Tue skips the weekend | AC1 |
| calendar.test.ts › tradingDaysBetween: skips holidays; a range starting on Saturday; from === to (trading day and non-trading day); reversed range → []; invalid date throws | AC1, AC5 |
| calendar.test.ts › vnDayBoundsUtc: `2026-10-20` → `2026-10-19T17:00:00.000Z` / `2026-10-20T16:59:59.000Z`; invalid date throws | AC1 |
| inputs.test.ts (existing) › "gapOverlaps and vnDayBounds use VN days" still passes unchanged | Refactor safety |
| price-gaps.test.ts › records missing trading days; weekends and holidays are not gaps (Fri, Tue stored, Mon missing → [Mon]) | AC1 |
| price-gaps.test.ts › no stored data (firstStoredDate null) → no gaps | AC4 |
| price-gaps.test.ts › start clamps to first stored date (first stored mid-window → nothing earlier) | AC4 |
| price-gaps.test.ts › start clamps to windowStart (first stored long ago) | AC4 |
| price-gaps.test.ts › an open gap stored as `+00:00` matches a day computed as `Z` (not re-recorded) | AC2 |
| price-gaps.test.ts › an open gap that differs only in ms formatting (`.000Z` vs no ms) still matches | AC2 |
| price-gaps.test.ts › second plan over the same state (after applying the first plan) → `{ toRecord: [], toResolve: [] }` | AC2 |
| price-gaps.test.ts › resolves an open gap once its day is stored | AC3 |
| price-gaps.test.ts › resolves a gap whose day became a holiday (no expected trading day left) | AC3 |
| price-gaps.test.ts › multi-day open gap resolves only when every trading day in it is stored; while open it covers its days (no per-day duplicate) | AC2, AC3 |
| price-gaps.test.ts › open gap before windowStart: not re-recorded, resolved when stored, never resolved just for being outside the window | AC3 |
| price-gaps.test.ts › priceGapReadRange extends `from` to the earliest open gap day and `to` to the latest open gap day; with no open gaps it equals the window | AC3 |
| prices-daily.test.ts › listPriceDates: `select('trade_date')`, `eq('symbol')`, `gte/lte('trade_date')`, `order('trade_date', asc)`, `range(0, size-1)`; pages until a short page (pageSize 2, queued responses); bad date → MAPPING; DB error → DataError | AC5 |
| prices-daily.test.ts › getFirstPriceDates: asc + limit 1 + maybeSingle per symbol; no row omitted; empty symbols → no call | AC4, AC5 |
| data-gaps.test.ts › resolveGaps filters `in('id')` and `is('resolved_at', null)` | AC3, AC5 |
| eod-sync.test.ts › records a prices_daily gap per missing trading day after the upsert (row shape incl. source and fetched_at; call order upsert → insertGaps → resolveGaps) | AC1 |
| eod-sync.test.ts › configured holiday inside the window is not a gap | AC1 |
| eod-sync.test.ts › re-run inserts no new gaps | AC2 |
| eod-sync.test.ts › existing open gap with `+00:00` timestamps is not duplicated | AC2 |
| eod-sync.test.ts › resolves a gap when the bar arrives; the gap row is kept with resolved_at = fetchedAt | AC3 |
| eod-sync.test.ts › symbol first stored mid-window gets no earlier gaps; symbol with no stored rows gets none | AC4 |
| eod-sync.test.ts › failed symbol with history still gets a gap for the target date; `ok` is driven only by the existing conditions | Decision D2 |
| eod-sync.test.ts › dryRun: no insertGaps or resolveGaps call; `missingDates` still reported (fetched bars count as present) | Pattern parity |
| eod-sync.test.ts › existing tests still pass unchanged | Regression |
| store.test.ts › createDbEodStore wires listOpenGaps with 'prices_daily', insertGaps, resolveGaps, listPriceDates, getFirstPriceDates | AC5 |

## Approach
1. **Core calendar (R5).** Add `tradingDaysBetween` and `vnDayBoundsUtc` to `calendar.ts`. Holidays are an input, and the helpers use the existing `toUtc` and `isTradingDay`. Change `vnDayBounds` in `signals/inputs.ts` to return `Date.parse` of `vnDayBoundsUtc(fromDate).fromTs` and `vnDayBoundsUtc(toDate).toTs`. The values are identical, so there is no behaviour change.
2. **Core planner** in `packages/core/src/market/price-gaps.ts`. Reuse the `OpenGap` type from `quarters.ts`.
   ```ts
   export interface PriceGapPlan { toRecord: string[]; toResolve: number[] } // dates 'YYYY-MM-DD', gap ids
   export function planPriceGaps(input: {
     windowStart: string; windowEnd: string;
     firstStoredDate: string | null;   // all-time earliest stored trade_date
     storedDates: readonly string[];   // must cover priceGapReadRange(...)
     openGaps: readonly OpenGap[];     // this symbol's open prices_daily gaps
     holidays: readonly string[];
   }): PriceGapPlan
   export function priceGapReadRange(input: { windowStart: string; windowEnd: string; openGaps: readonly OpenGap[] }): { from: string; to: string }
   ```
   - Gap days are `tradingDaysBetween(vnDateOf(new Date(g.fromTs)), vnDateOf(new Date(g.toTs)), holidays)`.
   - **Resolve** an open gap when every one of its gap days is in `storedDates`. If no trading day is left (a holiday was added later), `every` is vacuously true, so the gap resolves with the meaning "no longer expected". Add a code comment for this.
   - A gap is never resolved because it falls outside the window.
   - **Expected days.** If `firstStoredDate` is null, there are none. Otherwise they are `tradingDaysBetween(max(windowStart, firstStoredDate), windowEnd, holidays)`.
   - **Record** each expected day that is not stored and is not covered by a still-open gap. Covered means `Date.parse(g.fromTs) <= dayFromMs && Date.parse(g.toTs) >= dayToMs`, using `vnDayBoundsUtc(day)`. All comparisons use epoch ms, never strings (AC2). Days come from a Set, so there are no duplicates within one run.
   - `priceGapReadRange` returns `from = min(windowStart, earliest gap day)` and `to = max(windowEnd, latest gap day)`. This lets old open gaps resolve when data arrives, for example after the STK-032 backfill.
3. **DB repo.** Add `listPriceDates`, paginated so that long read ranges stay correct under the 1000-row PostgREST cap, and `getFirstPriceDates`, shaped like `getLatestCloses`. Add `.is('resolved_at', null)` to `resolveGaps`. `insertGaps` and `listOpenGaps` are unchanged.
4. **Worker: `runEodSync`.** It stays orchestration only.
   - Export `PRICES_GAP_TYPE = 'prices_daily'` from `eod-sync.ts`, and import it in `medium-signals.ts`.
   - Add to `EodStore`:
     - `listPriceDates(symbol, from, to): Promise<string[]>`
     - `getFirstPriceDates(symbols): Promise<Record<string, string>>`
     - `listOpenGaps(symbols): Promise<OpenGapRecord[]>`
     - `insertGaps(rows: DataGapInsert[]): Promise<void>`
     - `resolveGaps(ids: number[], resolvedAt: string): Promise<void>`
   - After the existing `upsertPricesDaily` (skipped in dry-run), add a gap step:
     1. `openGaps = listOpenGaps(symbols)` and `first = getFirstPriceDates(symbols)`.
     2. For each symbol, compute `range = priceGapReadRange({ windowStart: fromDate, windowEnd: targetDate, openGaps: own })`, then `stored = listPriceDates(symbol, range.from, range.to)`.
     3. Union `stored` with the dates of this run's fetched `rows` for that symbol, and lower `first` to the earliest fetched date if that is earlier. This is a no-op after a real upsert and makes the dry-run report accurate.
     4. Call `planPriceGaps`.
   - Gap rows look like `{ symbol, data_type: PRICES_GAP_TYPE, ...vnDayBoundsUtc(d) as from_ts/to_ts, source: source.name, fetched_at: fetchedAt }` (R4).
   - Writes, only when not dry-run: `insertGaps(gapRows)`, then `resolveGaps(resolveIds, fetchedAt)`. Both run after the upsert, as in financials-sync, so a crash leaves no gap without its rows.
   - The gap step takes `(fromDate, targetDate)` as inputs, so STK-032 can reuse it with a longer window. `targetDate` still comes from the existing `expectedPriceDate(now, holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN)`, so "today before the close" is never expected.
   - Log `missing <SYM>: d1,d2` for each symbol that has new gaps.
5. **Summary.** Add `missingDates: Record<string, string[]>` (newly recorded days per symbol, reported on dry-run too), plus `gapsRecorded` and `gapsResolved` (0 on dry-run). Naming follows `FinancialsSummary`. `ok` is unchanged: a gap is a recorded condition, not a job failure.
6. **Wiring.** Update `createDbEodStore` and its test.
7. Run `pnpm typecheck && pnpm lint && pnpm test` (R8).

Rules:
- **R1:** all date and gap math is in core. The worker only loops and wires.
- **R2:** no money is involved.
- **R3:** worker server-side only.
- **R4:** each gap row has `source` and `fetched_at`. The signals reader already suppresses on overlapping open gaps.
- **R5:** holidays come from settings, the lookback from config and the cutoff from the core default.
- **R7:** the market-wide gaps, index, lock and chunking are follow-ups.
- **R6:** suspended, so no auth code.
- **R9 and R10:** not applicable.

## Specialist input used
- **data-engineer**
  - Adopted:
    - Detection runs inside `runEodSync` after the upsert, and dry-run computes but writes nothing (rec 1).
    - Stored dates are read from the DB after the upsert, and a first-stored-date query is added (rec 2).
    - The expected range is clamped to the all-time first stored date (rec 3).
    - Per-day rows, with a shared `vnDayBoundsUtc` (rec 4).
    - Epoch-ms comparison (rec 5).
    - Resolve rules: on arrival, on a holiday added, multi-day all-or-nothing, a read range extended to old gaps, and the `resolveGaps` guard (rec 6).
    - Failed and rejected days are still gaps (rec 7).
    - The gap step is parameterised by window (rec 9).
    - The test list (rec 10).
  - Adapted: summary fields are `missingDates`, `gapsRecorded` and `gapsResolved`, matching financials naming. I dropped `openGapCount` to keep the diff small.
  - Deferred to follow-ups: market-wide `symbol IS NULL` rows and the "possible missing holiday" log heuristic (rec 8).
- **database-optimizer**
  - Adopted:
    - No migration or index; the PK range scan is enough.
    - Per-symbol date reads with `.range()` pagination.
    - First date by asc limit 1.
    - Per-day granularity.
    - Resolve semantics, including "no longer expected" on a holiday, and never resolving because the lookback shrank.
    - The `${symbol}|ms` style instant comparison. I implemented it as instant coverage, which also absorbs legacy multi-day rows.
    - Fake-client tests check call shape only; behaviour is tested in pure core functions and the in-memory job store.
  - Deferred to follow-ups: the partial unique index, the run lock, `insertGaps` chunking and market-wide gaps.
  - Already handled: the end cutoff is covered by the existing `expectedPriceDate`, so I did not re-derive it.

## Assumptions
- **Granularity: one `data_gaps` row per missing trading day**, with `from_ts` = 00:00:00+07:00 and `to_ts` = 23:59:59+07:00, the same style as `quarterBounds`. Contiguous runs would need split-and-reinsert on partial fill. Per-day keeps the dedupe and resolve rules trivial and the diff smaller.
- "First stored/known date" means the symbol's earliest `prices_daily.trade_date` over all time. In dry-run, this run's fetched bars also count.
- Read cost is one `listPriceDates` call and one `getFirstPriceDates` probe per symbol per run. That is fine for a personal watchlist.
- With `lookbackTradingDays = 20`, new gap rows per run are at most 20 × the number of symbols, so `insertGaps` stays a single request.
- Holiday lookups use `holidays.includes`, which is O(n). That is fine for a list of about 15 holidays a year.
- `OpenGap` from `quarters.ts` (`{id, fromTs, toTs}`) is structurally compatible with `OpenGapRecord`. No new type is needed.

### Needs Ming's decision (safe defaults applied; not blocking)
- **D1 Granularity.** Per-day rows, as above. Contiguous ranges would need partial-resolution logic.
- **D2 Failed or skipped symbols.** Their missing days are recorded as gaps. The gaps are truthful (the data is not stored) and resolve themselves on the next good run. Because of the first-stored floor, a source outage adds about one row per symbol per day, not a flood. The alternative is to record gaps only for symbols fetched this run.
- **D3 Holiday-added resolution.** A gap whose day is later added to `settings.holidays` is resolved, meaning "no longer expected". Otherwise a missing holiday would suppress signals permanently.
- **D4 `ok` flag.** New gaps do not set `ok=false`. Gaps are reported in `missingDates` and `gapsRecorded`.
- **D5 `resolveGaps` guard.** It now filters `resolved_at IS NULL`. This also applies to financials gaps; the change is harmless and makes behaviour stricter.
- **D6 Holiday list quality.** Every missing entry in `settings.holidays` creates a false gap for every symbol until it is fixed. D3 heals those gaps once the holiday is added. The holiday list must be populated before go-live.

### Follow-ups (not in this diff)
- A partial unique index on open gaps, `(symbol, data_type, from_ts, to_ts) WHERE resolved_at IS NULL` (NULLS NOT DISTINCT, PG15+). Existing duplicates must be cleaned up before the index can be built.
- A single-run lock (advisory lock or worker mutex). Without the index and the lock, two overlapping runs can double-insert. Consumers treat "any overlapping open gap" as a boolean, so duplicates are harmless, and resolve uses ids from every matching row.
- Market-wide gaps (`symbol IS NULL`) for a full source outage or a probable missing holiday (STK-021 per the STK-005 plan).
- `insertGaps` chunking for long backfills (STK-032).
- Intraday gap detection "after each poll" (§4.4), once intraday polling exists.
- STK-032 note: backfilled interior holes (for example a suspended symbol) become gaps and block MA signals until they are resolved. That is correct under R4.

## Blocking questions
None.

## Split proposal
None. This is one feature. Estimated size is about 170 lines of product code and about 300 lines of tests.
