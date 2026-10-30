# consult-data-engineer — STK-031

# STK-031 consult (data-engineer): daily price gap detection

I read the ticket, the STK-005 data-engineer consult and plan (split proposal), `eod-sync.ts`, `financials-sync.ts`, `data-gaps.ts`, `prices-daily.ts`, `calendar.ts`, `signals/inputs.ts` and the STK-032 ticket. I did not read `planFinancialGaps` or `quarterBounds`, so the reuse points below are inferred from how `financials-sync.ts` calls them.

## Findings
- **Eod-sync has no gap step yet.** `runEodSync` collects bars from the source and calls `upsertPricesDaily` once at the end (skipped in dry-run). It returns no gap fields. The fetch window is `subtractTradingDays(targetDate, lookbackTradingDays - 1)` to `targetDate`. `targetDate` comes from `expectedPriceDate(now, holidays, cutoff)`, so "today before close" is already handled and must not be re-derived.
- **`financials-sync.ts` is the template to copy.** It plans gaps with a pure core function and, in non-dry-run, calls `insertGaps` and then `resolveGaps` after the upsert. A comment there explains why: a crash must leave no gap without its rows. The summary carries `missingPeriods`.
- **The shared repo is thin.** `data-gaps.ts` has `listOpenGaps(dataType, symbols)`, `listOpenMarketGaps`, `insertGaps` and `resolveGaps`. It has no dedupe or planning logic.
  - `resolveGaps` does not guard with `is('resolved_at', null)`. A second run could overwrite an earlier `resolved_at`.
  - `OpenGapRecord` returns `from_ts` and `to_ts` as raw strings. Postgres returns `+00:00` while the code writes `+07:00`, so comparison must use epoch ms.
- **Core calendar gaps.** `calendar.ts` has `isTradingDay`, `addTradingDays`, `subtractTradingDays` and `previousTradingDay`. It has no `tradingDaysBetween` and no `vnDayBoundsUtc`.
- **`PRICES_GAP_TYPE` is defined in the wrong place.** It lives in `medium-signals.ts`, so eod-sync importing it would invert the dependency. Move it to the shared worker or db layer, or core.
- **Signals read these gaps.** `signals/inputs.ts` already derives `missingDates` from stored closes. It adds `price_gap_recorded` for any open gap (own symbol or `symbol` NULL) that overlaps `vnDayBounds(fromDate, signalDate)`. Two consequences:
  - An open gap suppresses signals for as long as it overlaps the window.
  - A phantom gap, for example from a missing holiday, suppresses them with no way to self-heal unless the plan resolves it.
- **`vnDayBounds` ends at `T23:59:59+07:00`.** The STK-005 outline proposed `.999`. `gapOverlaps` works with either, but a gap writer and a gap reader should share one definition.
- **Missing prices-daily repo functions.** `prices-daily.ts` has no `listPriceDates` and no first-stored-date query. The fake client may need `is` and `in` added to its method list. `listOpenGaps` already uses them, so check `fake-client.ts` first.

## Recommendations
1. **Run detection inside `runEodSync`, as a step after the upsert.** It is not a separate job. Detection must see the post-upsert DB state, and a separate job would add scheduling surface (R7).
   - Put the planning in a pure core function (`market/gaps.ts`, `planPriceGaps`). The worker only orchestrates (R1).
   - Order the writes as in financials: upsert, then `insertGaps`, then `resolveGaps`. Skip all gap writes in dry-run, but still compute and report the plan.
   - Add summary fields `gapsOpened`, `gapsResolved`, `missingDatesBySymbol` and `openGapCount`.
   - Do not fold gaps into `ok`. A gap is a recorded condition, not a job failure. A failed or skipped fetch already sets `ok=false`.
2. **Read stored dates from the DB after the upsert, not from the in-memory rows.** Add `listPriceDates(db, symbol, from, to)` and `getFirstPriceDate(db, symbols)` to `prices-daily.ts`.
   - Use `fetchAll`-style pagination if the repo already has it. One year is about 260 rows per symbol, which is under the Supabase 1000-row default, but a backfill of several years is not.
3. **Expected range per symbol.**
   - Start: `max(windowStart, firstStoredDate)`.
   - End: `targetDate`.
   - Keep only trading days from `isTradingDay(d, settings.holidays)`. Add `tradingDaysBetween(from, to, holidays)` to core.
   - Missing days are the expected days that are not stored.
   - A symbol with no stored row (new listing, newly watched) produces no gaps. Report it via `symbolsWithoutBars`, which already exists.
   - Use the symbol's earliest stored date over all time as "first known", not just the earliest in the window. A symbol first stored 3 days ago must not get gaps for the days before that.
4. **One `data_gaps` row per missing trading day.** This matches the STK-005 outline.
   - It makes the dedupe key unambiguous and allows partial resolution.
   - Keep ranges out of v1.
   - Use a core `vnDayBoundsUtc(date)` that returns `{fromTs, toTs}` and is shared with `vnDayBounds`, so the writer and the reader agree.
   - Set `source = source.name` and `fetched_at = run time` (R4). `data_type = 'prices_daily'`, using one exported constant.
5. **Dedupe by epoch ms.** Key on `symbol|Date.parse(from_ts)|Date.parse(to_ts)`.
   - Load open gaps with `listOpenGaps('prices_daily', symbols)`.
   - Dedupe the insert list within the run as well.
   - Add a test where an existing gap has `+00:00` and the new one `+07:00`.
6. **Resolve rules.** Do all of these in one planning pass.
   - Resolve an open gap if its day is now stored.
   - Resolve an open gap if its day is no longer a trading day, for example after a holiday is added to `settings.holidays`. This prevents the permanent signal suppression from a missing holiday.
   - For an open gap that spans multiple days (a possible legacy or manual row), resolve it only if every trading day in it is present.
   - To evaluate old open gaps, query stored dates from `min(windowStart, earliest open gap start)`. Without this, gaps older than the lookback never resolve, and a STK-032 backfill would not clear them.
   - Add `.is('resolved_at', null)` to `resolveGaps`, so a rerun never overwrites an earlier `resolved_at`. Gaps are never deleted.
7. **Failed or rejected fetches.** Gaps describe stored data, so a day missing after a failed fetch or a rejected bar is still a gap.
   - This differs from financials, which treated rejected periods as "known". Prices have no such concept: the stored row either exists or it does not.
   - Do not plan gaps for symbols skipped by the circuit breaker if that would flood the table. Prefer to record them, since they are truthful and self-heal. State the choice in the plan.
8. **Per-symbol only in v1.**
   - The existing signal reader already handles `symbol IS NULL` rows, but nothing writes them.
   - Suggested handling: if every fetched symbol lacks the same trading date, log `possible missing holiday or source outage` in the summary, and still write per-symbol gaps.
   - Market-wide rows stay a follow-up (STK-021 per the STK-005 plan). They complicate resolution.
9. **STK-032 interaction.** Make the gap step a function of `(windowStart, targetDate)`, not of `lookbackTradingDays`.
   - Backfill then reuses it with the longer window.
   - Interior holes in the backfilled history, for example a suspended symbol, become gaps. That is correct under R4, but it will block MA signals for that window until resolved. Mention it in STK-032.
   - Backfill must not produce gaps before the symbol's first returned bar.
   - A backfill run resolves older open gaps through rule 6.
10. **Tests (R8).**
    - Core: `tradingDaysBetween` (weekend and holiday edges, reversed range, a range starting on a weekend) and `planPriceGaps`. Cases: a Friday-to-Tuesday run with Monday missing gives one gap; weekends and holidays are not gaps; start clamping; no stored data gives no gaps; dedupe; resolve on arrival; resolve when a day becomes a holiday; a multi-day open gap.
    - Repos: fake-client tests for `listPriceDates`, `getFirstPriceDate` and `resolveGaps`.
    - Worker: a rerun inserts zero rows, a dry-run writes nothing, and a failed symbol still gets its gap.

## Risks
- **Incomplete holiday list.** Every missed holiday creates a false gap for every symbol, and each one suppresses signals until `settings.holidays` is fixed. Rule 6 mitigates this.
- **No unique index and no single-run lock.** Two overlapping runs (cron plus a manual run) can both insert the same gap. The ticket defers both, so state the limitation in the plan. The follow-up index would be on `(symbol, data_type, from_ts)` where `resolved_at` is null.
- **Phantom gap on the target date.** If cron fires right after the cutoff but before the source publishes, `targetDate` gets a gap that resolves next run. That is acceptable and self-healing, but noisy. A grace buffer is not recommended in v1.
- **Reader and writer boundary drift.** If the writer's `toTs` ends in `.999` and the reader's `vnDayBounds` ends in `:59`, they still overlap. Two separate definitions could still drift, so share one helper.
- **Scaling.** One `listPriceDates` query per symbol is fine for a personal watchlist, but it multiplies with long backfills.
- **Wrong first-known date.** If the first sync ever hits a source outage, the first bar is later than it should be, and the earlier days are never flagged. That is acceptable for v1.

## Open questions
1. Should gaps for symbols skipped by the circuit breaker be recorded (my recommendation), or only gaps for symbols that fetched successfully?
2. Does Ming want per-day rows (recommended) or collapsed ranges? Ranges would need partial-resolution logic.
3. Should the eod-sync summary or exit code distinguish "new gaps opened" from failure? I recommend no change to `ok`.
4. Where should the shared gap type constant live: core, db, or a worker module? `PRICES_GAP_TYPE` is currently in `medium-signals.ts`.
5. Is the settings-driven holiday list reliably populated before go-live? If not, consider a small "holiday check" warning in the summary.

Files: /home/user/stoktok/apps/worker/src/jobs/eod-sync.ts, /home/user/stoktok/apps/worker/src/jobs/financials-sync.ts, /home/user/stoktok/apps/worker/src/jobs/medium-signals.ts, /home/user/stoktok/packages/db/src/repos/data-gaps.ts, /home/user/stoktok/packages/db/src/repos/prices-daily.ts, /home/user/stoktok/packages/core/src/calendar.ts, /home/user/stoktok/packages/core/src/signals/inputs.ts, /home/user/stoktok/work/tickets/STK-005/plan.md, /home/user/stoktok/work/tickets/STK-032/ticket.md
