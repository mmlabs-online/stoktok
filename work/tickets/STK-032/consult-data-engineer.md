# STK-032: data-engineer consult (read-only)

The raw-price guards do not exist yet, and I found no hard blocker for planning, though three decisions are needed first.

## Findings

**Raw-price guards (STK-015 A6): not in the codebase.**
- A grep of `packages/core/src/signals` finds no `corporate_action_in_window` or `price_jump_beyond_limit`, and no use of `corporate_actions`, exchange limits or a jump check.
- `SignalReasons` in `packages/core/src/signals/types.ts` has only `price_missing`, `price_stale`, `insufficient_history`, `price_gap` and `price_gap_recorded` as price reasons.
- `packages/core/src/signals/inputs.ts` checks only history length and gaps.
- STK-015 plan A6, its impl-log and the review all record the guards as a deferred follow-up "before or with STK-032".
- STK-032's ticket has no criterion for them, and `work/backlog.md` has no separate ticket for them.
- The only jump check today is `normalizeDailyBar`'s `close_jump`, in `packages/core/src/market/daily-bar.ts`. It is a 5x ratio against `lastClose` (`DEFAULT_PRICE_SANITY.maxCloseJumpRatio`), meant to catch 1000x unit errors. It would not catch a 7% limit breach or a 2:1 stock dividend.

**Current EOD path (`apps/worker/src/jobs/eod-sync.ts`, `cli.ts`, `sources/tcbs.ts`).**
- `parseArgs` accepts only `--dry-run`, and `lookbackTradingDays` is 20 in `config.ts`.
- `runEodSync` already does most of the work: watchlist ∪ held symbols, one `fetchDaily` call per symbol, `requestDelayMs`, `maxConsecutiveFailures`, `getJson` retries, `upsertPricesDaily`, and a gap step.
- `upsertPricesDaily` is `onConflict: 'symbol,trade_date'`, so re-runs add no rows. That satisfies the idempotence criterion, but existing rows are overwritten with the new source and `fetched_at`.
- The `ok` flag is false if any bar is rejected.
- `ctx.lastClose` is the latest stored close. That is correct for a 20-day catch-up. For a 260-day backfill it is the wrong reference. Old bars are compared with today's close, so a stock that has moved more than 5x in a year is rejected as `close_jump`. Otherwise the check does nothing. Backfilled bars are never checked against each other.
- The TCBS source is still marked UNVERIFIED: `bars-long-term` response shape, raw vs adjusted prices and unit are unconfirmed (ADR 0001). The sandbox cannot reach the host. A year of history is the first time that assumption matters for signals.
- "Chunked by date range" costs one request per symbol per chunk. Nothing is known about the source's maximum range per request, so the chunk size is an unknown.

**Gap interaction.**
- `planPriceGaps` is fed `windowStart = fromDate`, so a 260-day window will write `data_gaps` rows for every missing trading day. That is wanted for real gaps.
- Holidays come from `settings.holidays`. STK-015's review warns that an incomplete list (Tết) would produce one false `price_gap` per holiday for every symbol, and each would be persisted as a gap. This is a worse failure than in the signals job, because it writes rows. See Risks.

## Recommendations

1. **Make the guards a precondition, not a quiet dependency.**
   - The cleanest option is to split them into their own ticket (core, finance and data) that STK-032 depends on. Alternatively, add them to STK-032 as slice 1.
   - Scope: a pure `packages/core` function that, for a close series plus exchange limits plus `corporate_actions`, returns `corporate_action_in_window` and `price_jump_beyond_limit`.
   - Unit tests: stock-dividend ex-date inside the window, a jump beyond the limit plus one tick, a null exchange (use the widest limit and flag it), and a legitimate limit-hit day that must not trigger.
   - Wire the function into the MA rules in `inputs.ts` or `moving-average.ts`.
   - Add the reason codes to `DATA_REASONS` or `RULE_REASONS` with their sort order (R4, R5, R8).
   - Limits come from market config, not literals (R5).
2. **Backfill mode in `cli.ts` and `eod-sync.ts` (AC1).**
   - Parse `--backfill <n>` and `--dry-run` together. `n` must be a positive integer with an upper bound from config. Reject other flags, and update the `USAGE` string.
   - Add `backfillTradingDays` (260), a chunk size in trading days and `maxRequests` to the config (R5).
   - Compute `fromDate` as `subtractTradingDays(targetDate, n - 1, holidays)`.
3. **Chunk and bound the requests (AC3).**
   - Build the date ranges in `packages/core` as a pure function and unit-test it.
   - Compute the request count up front as symbols × chunks. Log it and abort before any request if it exceeds `maxRequests`.
   - Reuse the existing delay between requests, not just between symbols.
   - Keep the circuit breaker, but count consecutive failures per request and not per symbol.
4. **Validation for backfill (AC2).**
   - Do not pass the latest stored close as `lastClose` for older chunks.
   - Either chain `lastClose` through the bars in date order within a symbol, or skip `lastClose` and rely on the new core jump guard. A cleaner design is a core helper that validates a whole series. I recommend this, so that backfill and daily sync share one rule.
   - Rejected bars must still make `ok` false, so a bad backfill is visible.
5. **Idempotence and write behaviour.**
   - A backfill run overwrites `source` and `fetched_at` on existing rows. That matches the daily sync, so keep it, but say so in the plan.
   - A row that is already stored and now fails validation should be kept. Never delete.
   - Make `--dry-run` fetch and validate, and write nothing, including no gaps (as today).
6. **Holiday safety.**
   - Confirm that `settings.holidays` covers the full window (about 10–12 months including Tết) before running. Add a pre-flight check that warns when the same missing date appears for all symbols, and do not record gaps for such a date.
   - STK-015's review already suggests this check.
7. **Tests (AC4).** Use fixtures only, with the no-network guard (`apps/worker/test/no-network.ts`). Cover:
   - chunking and request-count bounding;
   - re-run idempotence with a fake store;
   - a rejected bar mid-series;
   - circuit-breaker abort;
   - dry-run writing nothing;
   - `parseArgs` cases.
8. **Docs.** Update `apps/worker/README.md` with the backfill command and a note that it is run once, manually, and not scheduled.

## Risks

- **Unverified source behaviour.** The `bars-long-term` range cap, the raw vs adjusted prices and the unit are all unconfirmed. If the feed returns adjusted prices, the `priceStepVnd` check usually rejects them (`price_off_step`), so the failure mode is bars rejected, not silently wrong. If it returns raw prices, the MA is wrong across any stock dividend, which is why the guards are required.
- **Guards missing means silent wrong signals.** Once 200+ bars exist, MA rules start returning `ok` rows computed across ex-rights drops. Do not run the backfill in production until the guards are merged.
- **Holiday list gaps** would write false `data_gaps` rows for every symbol and suppress signals. Seed and verify the VN holidays first.
- **The `maxCloseJumpRatio` of 5 is too loose** to be the only protection, and with a stale `lastClose` it can reject valid history.
- **Source blocking.** A one-off 260-day pull is the largest request volume so far. Without the request cap and delay, this is where a block would happen. R4 applies: a failed or partial chunk leaves a gap, never a guess.

## Open questions

1. Do the guards become their own ticket that STK-032 depends on, or a first slice of STK-032? This is Ming's decision. I recommend a separate ticket, because it is core, finance-reviewed logic with its own tests.
2. Does TCBS `bars-long-term` return a full year in one request? If not, what is the maximum range? The ADR says this is unverified. Is there any way to confirm it before implementation, such as a recorded fixture from Ming's machine? The plan should treat the chunk size as config.
3. Are raw prices confirmed? The ADR says "assumed raw". A one-off fixture with a known ex-date would settle it.
4. Does `settings.holidays` already cover the last 12 months, including Tết?
5. For the guards: which exchange limits apply when `symbols.exchange` is null? STK-015's finance consult says use the widest configured limit and flag it. Is that still accepted?
6. Is the default backfill length 260 trading days, enough for MA200 plus margin? The window needs 200 consecutive bars ending at the as-of date, so 260 leaves about 60 days of slack for holidays and gaps.

Files read: `/home/user/stoktok/work/tickets/STK-032/ticket.md`, `/home/user/stoktok/apps/worker/src/jobs/eod-sync.ts`, `/home/user/stoktok/apps/worker/src/cli.ts`, `/home/user/stoktok/apps/worker/src/config.ts`, `/home/user/stoktok/apps/worker/src/sources/tcbs.ts`, `/home/user/stoktok/apps/worker/src/sources/price-source.ts`, `/home/user/stoktok/packages/core/src/market/daily-bar.ts`, `/home/user/stoktok/packages/core/src/market/config.ts`, `/home/user/stoktok/packages/core/src/signals/types.ts`, `/home/user/stoktok/packages/core/src/signals/inputs.ts`, `/home/user/stoktok/packages/db/src/repos/prices-daily.ts`, and the STK-015 plan and consult notes.
