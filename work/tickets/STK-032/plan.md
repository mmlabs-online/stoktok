Status: READY

# Plan — STK-032: Historical daily price backfill

> **Re-planned 2026-10-30.** The earlier version was BLOCKED on Q1 (raw-price guards). Ming answered **option (a)**: the guards are their own ticket, STK-036, and STK-032 merges after it. STK-036 is now merged on `main` (review PASS, 2026-10-30), so the ordering precondition is met. The backfill scope is the same as before. The changes are listed in "Changes from the BLOCKED version" at the end.

## Spec summary
- docs/spec-v1.md §4.3: "One interface per data type (`PriceSource`, …); each implementation is swappable." "Every record stores `source` and `fetched_at`."
- docs/spec-v1.md §4.4: "EOD OHLCV sync | After market close" and "Gap detection | … and at EOD". The backfill is a one-off manual mode of the EOD sync, not a new scheduled job.
- CLAUDE.md R2 (integer VND), R4 ("Every market-data record carries `source` and `fetched_at`. Stale or gapped data never produces a signal; gaps are recorded."), R5 (tuning is configuration).
- Ticket goal: "A one-off backfill fills `prices_daily` with about one year of history for watchlist ∪ held symbols, so the 50/200-day MA signals (STK-015) have enough data."
- Ticket note (Ming): "raw-price guards (stock-dividend or out-of-limit jumps inside the MA window) must land with or before this backfill".
- Ticket note (Ming, 2026-10-30): "**Answer to plan Q1: option (a).** Raw-price guards go in a separate ticket, STK-036. STK-032 is merged after STK-036, and the backfill is not run before STK-036 lands."
- STK-036 (merged) added `checkRawPriceWindow`, `isBeyondDailyLimit` and `resolveLimitPpm` in `packages/core/src/signals/raw-price-guard.ts`. `priceVsMa` now suppresses rows with `corporate_action_in_window` / `price_jump_beyond_limit` when the MA window crosses a stock dividend or a beyond-limit jump. That protection is in the **signals layer** and works on whatever history is stored, so the backfill does not need to call it.

## Acceptance criteria → verification
| # | Criterion (ticket) | How the reviewer verifies it |
|---|---|---|
| 1 | `pnpm worker:eod --backfill <tradingDays>` (default from config, e.g. 260) fetches and upserts history through the existing `PriceSource` and validation path; `--dry-run` works with it. | `cli.test.ts › parseArgs backfill cases` (with n, without n → config default, with `--dry-run` in either order, and rejections for 0, negative, non-integer, above the cap, `--backfill` on `financials`/`signals`, and unknown flags). `eod-sync.test.ts › backfill: fromDate = subtractTradingDays(target, n-1)` and `› backfill: bars go through source.fetchDaily and are upserted with source/fetched_at`. `› backfill dry-run writes nothing (no upsert, no gaps)`. The `USAGE` string and the README show the command. |
| 2 | Idempotent: re-running adds no rows; existing rows are overwritten only with the same validation rules as the daily sync. | `eod-sync.test.ts › backfill re-run adds no rows` (memory store, same row count after two runs). `› backfill rejected bar mid-series is not written and the stored row is kept; ok=false`. Code check: backfill calls the same `source.fetchDaily` → `normalizeDailyBar` with `DEFAULT_PRICE_SANITY`. There is no second validation path (in particular, `isBeyondDailyLimit` is **not** added to the write path, see Approach 4), and no delete is ever issued. |
| 3 | Gentle on the source: requests chunked by date range with the existing delays/retries/circuit breaker; the request count is bounded and logged. | `market/backfill.test.ts › planBackfillChunks` cases. `eod-sync.test.ts › backfill: requests = symbols × chunks, logged before the first request`. `› backfill: aborts before any request when planned requests > maxBackfillRequests`. `› backfill: sleeps requestDelayMs between every request`. `› backfill: circuit breaker counts consecutive failed requests and skips the rest`. Retries are unchanged (`getJson` via `TcbsPriceSource`). |
| 4 | Tests use fixtures and the no-network guard only. | Every new test uses the in-memory store or fake source in `eod-sync.test.ts`, or the existing `test/fixtures/tcbs/*.json` with `test/no-network.ts`. A grep of the diff finds no real `fetch` and no hosts. `pnpm test` is green offline. |
| — | R8 | `pnpm typecheck`, `pnpm lint` and `pnpm test` are green. The new core function has unit tests. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/market/backfill.ts` (new) | Pure `planBackfillChunks(fromDate, toDate, chunkTradingDays, holidays): { from: string; to: string }[]`. It splits the inclusive trading-day range from `tradingDaysBetween` into consecutive chunks of at most `chunkTradingDays` trading days, **newest first**. An empty range gives `[]`. A `chunkTradingDays` that is not a positive integer throws `RangeError`. | AC3. The date math lives in core, not the worker (R1 spirit, shared calendar) |
| `packages/core/src/market/backfill.test.ts` (new) | Unit tests for the above | AC3, R8 |
| `packages/core/src/index.ts` | Export `planBackfillChunks` | Used by the worker |
| `apps/worker/src/config.ts` | Add to `EOD_SYNC_CONFIG`: `backfillDefaultTradingDays: 260`, `backfillMaxTradingDays: 520`, `backfillChunkTradingDays: 60`, `maxBackfillRequests: 500` | AC1 (default from config) and AC3 (bound). R5 |
| `apps/worker/src/jobs/eod-sync.ts` | Add an optional `backfillTradingDays?: number` to `EodDeps`. When it is set, use it as the window instead of `lookbackTradingDays` and fetch per symbol per chunk (see Approach). Add `requestsPlanned`, `requestsMade` and an optional `abortReason` to `EodSummary`. Daily behaviour is unchanged (one chunk, current `lastClose`). | AC1–3 |
| `apps/worker/src/jobs/eod-sync.test.ts` | New backfill tests. Existing tests must pass unmodified. | AC1–4 |
| `apps/worker/src/cli.ts` | `parseArgs` accepts `eod-prices [--dry-run] [--backfill [<n>]]`. `ParsedArgs` gains `backfillTradingDays?: number`. Update the `USAGE` string. `main` passes the value to `runEodSync`. | AC1 |
| `apps/worker/src/cli.test.ts` | parseArgs backfill cases | AC1 |
| `apps/worker/README.md` | Add a "Backfill (one-off, manual, not scheduled)" section covering: the command, the dry-run-first rule, the request count, the holiday check on `missingDates`, and a note that MA rows crossing a stock dividend or a beyond-limit jump are suppressed by the STK-036 guards (`corporate_action_in_window`, `price_jump_beyond_limit`), so suppressed MA rows right after a backfill are expected, not a bug. | AC1. Ops safety |

No migration, no DB package change (`upsertPricesDaily` and `onConflict: 'symbol,trade_date'` are reused), and no change to `tcbs.ts`, `price-source.ts`, `daily-bar.ts` or anything under `packages/core/src/signals/` (STK-036 code is used as is, and not called from the backfill).

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `backfill.test.ts › 260 days / chunk 60 → 5 chunks, newest first, contiguous, no overlap, union = tradingDaysBetween` | AC3 |
| `backfill.test.ts › range smaller than chunk → 1 chunk equal to the range` | AC3 |
| `backfill.test.ts › chunk boundaries skip weekends and holidays (no chunk starts or ends on a non-trading day)` | AC3 |
| `backfill.test.ts › from > to → []; chunk 0 / 1.5 / negative → RangeError` | AC3 edge cases |
| `cli.test.ts › eod-prices --backfill 260 → backfillTradingDays 260` | AC1 |
| `cli.test.ts › --backfill without n → config default; with --dry-run before or after` | AC1 |
| `cli.test.ts › --backfill 0 / -5 / 2.5 / abc-as-value / > backfillMaxTradingDays → usage` | AC1 |
| `cli.test.ts › signals --backfill / financials --backfill / unknown flag → usage` | AC1 |
| `eod-sync.test.ts › backfill: fromDate = subtractTradingDays(target, n-1, holidays) and fetch calls cover exactly the chunk ranges per symbol` | AC1, AC3 |
| `eod-sync.test.ts › backfill: rows upserted with source.name and fetchedAt` | AC1, R4 |
| `eod-sync.test.ts › backfill dry-run: no upsert, no insertGaps/resolveGaps, missingDates still reported` | AC1 |
| `eod-sync.test.ts › backfill re-run adds no rows (memory store row count unchanged)` | AC2 |
| `eod-sync.test.ts › backfill: rejected bar in a middle chunk is not written, the prior stored row for that date is kept, ok=false, rejectedBySymbol lists it` | AC2 |
| `eod-sync.test.ts › backfill lastClose: newest chunk gets the stored latest close; each older chunk gets the oldest accepted close of the chunk after it; no accepted bar → previous reference carried` | AC2 (same rule, correct reference) |
| `eod-sync.test.ts › backfill: requestsPlanned = symbols × chunks, logged before the first fetch` | AC3 |
| `eod-sync.test.ts › backfill: planned > maxBackfillRequests → zero fetches, zero writes, ok=false, abortReason 'request_cap_exceeded'` | AC3 |
| `eod-sync.test.ts › backfill: sleep(requestDelayMs) before every request except the first` | AC3 |
| `eod-sync.test.ts › backfill circuit breaker: maxConsecutiveFailures failed requests → remaining requests not made; partially fetched symbol in failedSymbols, untouched symbols in skippedSymbols; fetched bars still upserted` | AC3, R4 |
| `eod-sync.test.ts › daily mode unchanged: one request per symbol, requestsPlanned = symbols` | Regression |

## Approach
1. **Core chunk planner (R1, R5).** Write `planBackfillChunks` on top of `tradingDaysBetween`, with holidays as an input. Newest-first order means a run cut short by the circuit breaker still leaves the most recent history, which is the part MA200 needs (a window ending at the as-of date).
2. **Config (R5).** Add the four keys above. The TCBS `bars-long-term` maximum range per request is unverified (ADR 0001), so `backfillChunkTradingDays` is a config value. 60 trading days is about 3 months, so 260 days takes 5 requests per symbol.
3. **CLI.** `--backfill` is optional-valued. If the next token is a decimal integer string, it is `n`. Otherwise `n = backfillDefaultTradingDays`. `n` must be an integer in `[1, backfillMaxTradingDays]`, otherwise the CLI prints the usage message and exits with code 2. `--backfill` is allowed only for `eod-prices`. A repeated flag is rejected.
4. **eod-sync backfill mode.**
   - `window = backfillTradingDays ?? lookbackTradingDays`, and `fromDate = subtractTradingDays(targetDate, window - 1, holidays)`.
   - Chunks: in backfill mode, `planBackfillChunks(fromDate, targetDate, backfillChunkTradingDays, holidays)`. In daily mode, a single `{from: fromDate, to: targetDate}`, which is the current behaviour.
   - `requestsPlanned = symbols.length × chunks.length`. Log it as `backfill: <S> symbols × <C> chunks = <R> requests`. If it is above `maxBackfillRequests`, return `ok:false, abortReason:'request_cap_exceeded'` before any fetch or write.
   - Loop over symbols, then over chunks. `sleep(requestDelayMs)` comes before every request except the first. The consecutive-failure counter is per request and resets on success. Once it reaches `maxConsecutiveFailures`, no further requests are made. A symbol with at least one failed or unmade chunk goes in `failedSymbols` if it had a failure, otherwise in `skippedSymbols`. Its successfully fetched bars are kept (R4: missing chunks become recorded gaps, never guesses).
   - **Validation reference (AC2 "same validation rules").** The same `normalizeDailyBar`, sanity config and `close_jump` ratio apply. Only the reference close is chosen per chunk. The newest chunk uses the stored latest close (exactly as the daily sync does). Each older chunk uses the oldest accepted close of the chunk after it. This fixes the consult's finding that a 260-day window compared with today's close wrongly rejects valid history. The rule itself is not loosened or tightened.
   - **STK-036 `isBeyondDailyLimit` is not reused here (decision, R7).** STK-036's follow-up (f) suggested reusing it in STK-032. I checked it against the ACs. Adding a ±7/10/15% check to the backfill write path would make backfill validation **different from** the daily sync, which breaks AC2 ("the same validation rules as the daily sync"). It would also drop real history (limit-hit days, ex-rights drops) that the signals layer is designed to see and suppress on. None of the ACs need it, because the MA protection Ming asked for is already done at signal time by `checkRawPriceWindow` on the stored series. So the backfill only writes validated raw bars, and STK-036 handles the MA. If Ming later wants beyond-limit bars reported at ingest, that is a follow-up for both sync modes together.
   - The upsert, `ok` semantics and the gap step are unchanged. `windowStart = fromDate`, so real gaps across the year are recorded. Dry-run writes nothing, gaps included.
5. **Write behaviour (stated per consult §5).** Re-running overwrites `source` and `fetched_at` on existing rows, as the daily sync does. A bar rejected now is simply not written, so the stored row is kept. Nothing is ever deleted.
6. **README.** Add the backfill section: run `--dry-run` first and check `requestsPlanned`, the closes in VND, and `missingDates`. If the same date is missing for every symbol, the holiday list is incomplete: fix `settings.holidays` before the real run. Also note that after the backfill, MA rows whose window crosses a stored stock dividend or a beyond-limit move are suppressed by the STK-036 guards. That is expected. The old "do not run before the guards are merged" warning is no longer needed, because STK-036 is on `main`.
7. **Rules.** R2: no conversion added, and integer VND comes from the existing path. R3: worker only. R4: `source`/`fetched_at` on every row, and gaps are recorded. R5: all limits are config. R6: suspended, no auth. R7: no guard logic or guard wiring, no holiday pre-flight code, no source change. R8: core tests listed. R10: read-only market data.

## Specialist input used
From `consult-data-engineer.md`:
- **Adopted:**
  - Rec. 2: the CLI and config keys, `fromDate` via `subtractTradingDays`.
  - Rec. 3: the core chunk planner, request count computed up front, the cap, and the delay and circuit breaker applied per request.
  - Rec. 4: no stale `lastClose` for old chunks. I chose chaining (newest → oldest) over a new series validator, because chaining keeps exactly the daily-sync rule (AC2) and adds no new validation logic. The consult's alternative ("skip `lastClose` and rely on the new core jump guard") is not used. The STK-036 guard lives at signal time and is not a write-path validator (see Approach 4).
  - Rec. 5: overwrite stated, rejected bars keep stored rows, dry-run writes nothing.
  - Rec. 7: the test list.
  - Rec. 8: the README.
- **Resolved outside this ticket:**
  - Rec. 1 (the guards) and consult Q1: done in STK-036, per Ming's answer (a). Consult Q5 (null exchange → widest configured limit, flagged) was settled in STK-036 (its A7).
- **Not adopted here, recorded as follow-ups (R7, not in the ACs):**
  - Rec. 6: a holiday pre-flight check that skips dates missing for all symbols. It changes gap semantics. It is replaced by a README dry-run check.
- **Open questions:** Q2, Q3, Q4 and Q6 are handled as assumptions (below).

From STK-036 (`work/tickets/STK-036/plan.md`, `review.md`): its follow-up (f) "reuse `isBeyondDailyLimit` in STK-032" was considered and **declined** for the reason in Approach 4.

## Assumptions
- **A1.** The TCBS range cap is unknown (consult Q2). `backfillChunkTradingDays = 60` is a conservative default and lives in config. If a chunk is silently truncated, the gap step records the missing days (R4), which is visible on dry-run.
- **A2.** Raw vs adjusted prices are unverified (consult Q3). The backfill neither assumes nor corrects either. If prices are raw, MA correctness across stock dividends and beyond-limit jumps is handled by the STK-036 guards. Cash dividends are a known residual bias of ≤3% (STK-036 A4).
- **A3.** Holiday coverage (consult Q4) is an operational precondition, checked through the dry-run's `missingDates` (README). No code.
- **A4.** The default of 260 trading days (consult Q6) follows the ticket's "e.g. 260". 200 bars plus about 60 of slack. The cap is 520.
- **A5.** The STK-036 guards only see corporate actions that are stored in `corporate_actions` (today, mostly held symbols). A stock dividend on a watched-only symbol is caught only if the move goes beyond the limit (STK-036 follow-up (d)). This is a known STK-036 residual risk and is out of scope here.
- **A6.** `maxBackfillRequests = 500`, for example 100 symbols × 5 chunks, which takes about 8 minutes at 1 s delay. Ming's watchlist plus holdings is assumed to be well under that.

## Blocking questions
None. Q1 was answered by Ming (option (a), 2026-10-30), and STK-036 is merged.

## Split proposal
None. About 250–350 changed lines, one feature.

### Follow-ups (not in this diff)
- Holiday pre-flight: warn on, and do not record, a date that is missing for every symbol (consult Rec. 6, STK-015 review).
- Verify the TCBS `bars-long-term` range cap and raw vs adjusted prices with a recorded fixture from Ming's machine, then update ADR 0001 and `backfillChunkTradingDays`.
- Optional (Ming to decide): report beyond-limit day-over-day moves at ingest with `isBeyondDailyLimit`, as a log or warning only, in **both** the daily and backfill modes, so that validation stays identical. This replaces STK-036 follow-up (f).

### Changes from the BLOCKED version
- Status changed from BLOCKED to READY. Q1 is recorded as answered (a), and the Blocking question is removed.
- The README note changed from "do not run before the guards are merged" to "suppressed MA rows after a backfill are expected (STK-036 reasons)".
- The plan now states explicitly that STK-036's `isBeyondDailyLimit` is not reused (AC2, R7).
- A2 and A5 are updated to point at STK-036. The guards follow-up is removed, and the ingest-reporting follow-up is added.
- Files, tests and the approach for the backfill itself are unchanged.
