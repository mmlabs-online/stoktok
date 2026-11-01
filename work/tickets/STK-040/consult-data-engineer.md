## Findings

- **The existing guard is not enough.** `toVnd` with unit `VND` in `packages/core/src/market/daily-bar.ts` already rejects any bar whose o/h/l/c is fractional (`invalid_open` and so on). It judges each bar on its own. The TCB observation shows that is too weak. The two integer-valued bars are probably also adjusted. Only the cut-off rule can reject them, and the adapter cannot do that bar by bar.
- **The adapter is the only place that sees raw fractional values.** Inside `VciPriceSource.fetchDaily`, the job only gets normalized integer bars plus reason strings. The job can't tell "fractional" from other `invalid_*` reasons without parsing reasons, which would be fragile.
- **Chunk order is newest first.** `planBackfillChunks` iterates `end` from the top down, so chunks come out newest to oldest. The daily run is one chunk of `lookbackTradingDays`. This is what makes "carry the cut-off to later (older) chunks" work. The job already carries `lastClose` this way, from the newest chunk to older ones.
- **A cut-off from one chunk covers every older chunk.** If a newer chunk has any fractional bar, every older chunk is entirely on or before that date. Requesting older chunks is then pointless, and they would be rejected whole anyway.
- **Rejected dates do not become gaps in the usual case.** The gap planner only records dates that are missing from storage. Pre-action raw rows are already stored, so rejecting the adjusted copies creates no gap. Raw stored rows are never overwritten, because the rejected bars are never upserted. Only a symbol with no stored history would get gap rows for the rejected dates, and that is correct.
- **Rejected counts flip `ok` to false.** `ok` requires `rejected === 0`. After a corporate action, every daily run would carry rejected bars for about 20 trading days, because the lookback window still contains the fractional bars.

## Recommendations

1. **Put the rule in core as a pure function (R1/R7).** For example `adjustedHistoryCutoff(bars: {tradeDate, open, high, low, close}[]): string | null` in `packages/core/src/market/`. The cut-off is the max trade date of any bar whose o/h/l/c is a finite non-integer number. It needs unit tests, as R8 requires for new core logic.
   - Count a fractional bar anywhere in the response, including outside `[from, to]`. It still proves that all older history is adjusted.
   - A fractional bar with an invalid or missing trade date gives an unknown cut-off. Fail safe by treating the cut-off as `toDate`, so the whole response is rejected.
   - The adapter calls this on the parsed `num()` values before the per-bar loop. Then every bar with `tradeDate <= max(cutoff, ctx.rejectOnOrBefore)` is rejected with one reason, e.g. `adjusted_price_history`.
   - Use that same reason for the fractional bars too, so the root cause is visible. Do not leave them as `invalid_open`.
   - Skip these bars before `normalizeDailyBar`, and still run the duplicate check as today.

2. **Carry the state with a minimal contract change.**
   - Add an optional `rejectOnOrBefore?: string` to the `ctx` parameter of `fetchDaily`. The positional signature does not change, and the field is optional, so other sources and test fakes are unaffected.
   - Add an optional `adjustedCutoff?: string` to `FetchResult`. This is the effective cut-off, already merged with the incoming one.
   - In `eod-sync.ts`, the job keeps `let cutoff: string | undefined` per symbol, next to `lastClose`. After each chunk it updates `cutoff = res.adjustedCutoff ?? cutoff`, and it passes `rejectOnOrBefore: cutoff` in ctx. The job stays orchestration only.
   - Optional optimization: once `cutoff >= chunk.to`, skip the request for that chunk and log it. This saves requests, but it changes the `requestsMade` and `requestsPlanned` semantics, so decide on it in the plan. The simpler choice is to keep making the request and reject the bars. Either way, no adjusted bars get stored.
   - Keep `lastClose` unchanged. Rejected bars never update it, so it stays the oldest accepted close.
   - `lastClose` is also not a substitute for the cut-off. A fully integer response after a split would pass `close_jump` for a ratio under the limit.

3. **Daily 20-day lookback.**
   - The same single-chunk logic applies, so nothing extra is needed. Only bars newer than the latest fractional bar are upserted, and stored raw rows stay.
   - Decide whether `adjusted_price_history` rejections should flip `ok` (see open questions). My default is that they stay visible in `rejectedBySymbol` and a separate count, but do not fail the run. They are expected and harmless, and a red alert for 20 days would train Ming to ignore it. A genuinely suspicious case should stay loud (see the next point).

4. **Latest bar fractional.**
   - The cut-off then equals the newest date and every bar is rejected. Nothing is stored, the target date becomes a recorded gap through the existing gap step, and R4 stale-data logic blocks signals.
   - This case should make `ok` false and log a dedicated message. It means the source now serves adjusted data for the whole history. Add a test for it.

5. **Tests (R8).**
   - Core: the cut-off helper.
   - Adapter: the TCB case (3 fractional bars, then 2 integer bars), an all-integer response, a fractional bar with a bad date, and the latest bar fractional.
   - Job: a two-chunk case where chunk 1 has fractional bars and chunk 2 is all integer, expecting chunk 2 fully rejected.

6. **Docs.** Update ADR 0004's "Raw vs adjusted" section. The "assumed raw" assumption is now known to be wrong. Describe the cut-off rule and its limit.

## Risks

- **Residual false negatives.** A genuinely adjusted bar that happens to be integer and sits newer than the latest fractional bar slips through. Examples are a tiny adjustment factor, or prices rounded to integers by the source. The risk is small because adjustment factors are typically non-round. It can't be closed without overlap-vs-stored-close checks, which are out of scope (R7), so note it.
- **Source rounding.** If VCI ever rounds adjusted prices to integers, the guard goes blind. The ADR step "overlapping dates match stored closes" remains the real validation.
- **Cut-off in the future.** Treat the cut-off as a date string compared lexicographically (`YYYY-MM-DD`), as the rest of the code does. Nothing else is needed.
- **Raw-price discontinuity.** The stored raw history keeps a price break at the corporate action. Handling that is downstream work (corporate-action adjustment in core), not this ticket.
- **Unit-guard overlap.** Do not weaken the existing STK-036 style guards (`price_off_step`, `close_jump`). The new rule runs before them and adds to them.

## Open questions

1. Should `adjusted_price_history` rejections flip `ok` to false? **Proposed default:** no, except when the newest bar is rejected.
2. Skip the remaining older-chunk requests once the cut-off covers the chunk, or fetch and reject? **Proposed default:** fetch and reject. It is simpler, and request counts stay consistent.
3. Should a fractional bar with an unknown date reject the whole response? **Proposed default:** yes.
4. Do you want the rejected-count reporting to carry the cut-off date per symbol in `EodSummary`? This would be a small optional addition, such as `adjustedCutoffBySymbol`. It helps Ming see which symbols had corporate actions. **Proposed default:** yes, log only.

Files read: `/home/spaceM/projects/stoktok/apps/worker/src/sources/vci.ts`, `/home/spaceM/projects/stoktok/apps/worker/src/sources/price-source.ts`, `/home/spaceM/projects/stoktok/apps/worker/src/jobs/eod-sync.ts`, `/home/spaceM/projects/stoktok/packages/core/src/market/daily-bar.ts`, `/home/spaceM/projects/stoktok/packages/core/src/market/backfill.ts`. I only grepped `/home/spaceM/projects/stoktok/docs/adr/0004-vci-eod-price-source.md`. I did not read the STK-036 ticket folder.
