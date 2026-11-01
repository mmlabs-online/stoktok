Status: READY

# Plan — STK-040: Reject adjusted-price history in VCI responses

## Spec summary
- docs/spec-v1.md §2.2: "Gaps happen (sleep, Windows Update, network). Gaps must be detected, not silently interpolated."
- docs/spec-v1.md §4.3: "One interface per data type (`PriceSource`, `FinancialsSource`, `NewsSource`); each implementation is swappable." / "Every record stores `source` and `fetched_at`."
- CLAUDE.md R2: "Money and prices are integers in VND … No floats for money."
- CLAUDE.md R4: "Every market-data record carries `source` and `fetched_at`. Stale or gapped data never produces a signal; gaps are recorded."
- ADR 0004 "Raw vs adjusted": "Assumed raw (vnstock sends no adjust flag). Must be checked … before trusting history." The first live dry-run on 2026-11-01 showed this assumption is wrong (ticket notes: TCB fractional 2026-10-05..2026-10-28, integer on 2026-10-29/30; AGR similar up to ~2026-10-08).
- Ticket goal: "When a response contains a bar with a non-integer price, every bar on or before the latest such date is rejected, including bars whose adjusted values happen to be whole numbers."

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | In one VCI response, a non-integer o/h/l/c on any bar rejects every bar dated on or before the latest such bar, with reason `adjusted_price_history`, integer-valued bars included | `vci.test.ts › adjusted history: mixed response rejects every bar on or before the latest fractional bar` and `… integer-valued bar older than the latest fractional bar is rejected too`; core `adjusted-history.test.ts` cases |
| 2 | Bars after the cut-off go through the existing core normalization and guards unchanged | `vci.test.ts › adjusted history: bars after the cut-off are normalized as before` (one post-cut-off bar off-step → still `price_off_step`; others accepted); all existing `vci.test.ts` tests still pass unchanged |
| 3 | During `--backfill`, a cut-off found for a symbol also rejects its bars in older chunks of the same run | `eod-sync.test.ts › backfill › adjusted cut-off from the newest chunk is passed as rejectOnOrBefore to older chunks` (fake source) and `runEodSync with VciPriceSource › backfill: fractional bars in the newest chunk reject the all-integer older chunk` (real adapter, fixture fetch) |
| 4 | Rejected bars are never written; stored rows for those dates stay unchanged; missing dates recorded as gaps by existing logic; nothing filled | Same VCI backfill job test: memory store seeded with `prior` rows for rejected dates → those rows keep `source === undefined` (not overwritten), no rows upserted for dates ≤ cut-off, `missingDates` produced only by the existing gap step |
| 5 | ADR 0004 records the 2026-11-01 finding and documents the guard | Read `docs/adr/0004-vci-eod-price-source.md` "Raw vs adjusted" section: finding (adjusted before latest corporate action, raw after), cut-off rule, backfill carry-over, `ok` behaviour, known limits |
| 6 | Tests use fixtures + no-network guard only; cover mixed response, integer coincidence, backfill across chunks; checks green | New fixtures under `apps/worker/test/fixtures/vci/`; no real `fetch` (existing `global fetch is blocked` pattern / `test/no-network.ts` setup unchanged); `pnpm typecheck && pnpm lint && pnpm test` pass |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/market/adjusted-history.ts` (new) | `ADJUSTED_HISTORY_REASON = 'adjusted_price_history'` and pure `adjustedHistoryCutoff(bars, unknownDateCutoff)` | R1/R8: the detection rule is domain logic, lives in core with unit tests (consult rec. 1) |
| `packages/core/src/market/adjusted-history.test.ts` (new) | Unit tests for the helper | R8 |
| `packages/core/src/index.ts` | Export the helper and constant | Worker imports from `@stoktok/core` |
| `apps/worker/src/sources/price-source.ts` | `fetchDaily` ctx gains optional `rejectOnOrBefore?: string`; `FetchResult` gains optional `adjustedCutoff?: string` | Carry the cut-off between chunks with a non-breaking contract change (consult rec. 2) |
| `apps/worker/src/sources/vci.ts` | Compute cut-off before the per-bar loop; reject bars ≤ effective cut-off with `ADJUSTED_HISTORY_REASON`; return `adjustedCutoff`; update the UNVERIFIED doc comment re raw/adjusted | AC 1, 2 |
| `apps/worker/src/sources/vci.test.ts` | New adapter tests (see below) | AC 1, 2, 6 |
| `apps/worker/test/fixtures/vci/chart-adjusted-mixed.json` (new) | TCB-like response: fractional, integer-coincidence, fractional, then two raw integer bars | AC 1, 2, 6 |
| `apps/worker/test/fixtures/vci/chart-adjusted-latest.json` (new) | Response whose newest bar is fractional | Newest-window `ok` rule |
| `apps/worker/test/fixtures/vci/README.md` | List the two new fixtures (still synthetic, modelled on the 2026-11-01 dry-run) | Fixture inventory stays accurate |
| `apps/worker/src/jobs/eod-sync.ts` | Per-symbol `cutoff` carried across chunks via ctx; log line per symbol with a cut-off; `ok` excludes `adjusted_price_history` rejections except the newest-window case; update `EodSummary.ok` doc comment | AC 3, 4; consult rec. 2–4 |
| `apps/worker/src/jobs/eod-sync.test.ts` | New job tests (fake source + VCI adapter) | AC 3, 4, 6 |
| `docs/adr/0004-vci-eod-price-source.md` | Rewrite "Raw vs adjusted"; adjust dry-run checklist item 3 and the UNVERIFIED list | AC 5 |

`apps/worker/src/sources/tcbs.ts` is **not** changed: its `ctx: { lastClose?: number }` parameter stays assignable to the widened interface (optional field). If typecheck disagrees, widening its parameter type is the only allowed edit there — record it in impl-log.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `adjusted-history.test.ts › all-integer bars → null` | No false positive |
| `… › one fractional bar → its date` | Basic cut-off |
| `… › several fractional bars → the latest date, regardless of array order` | Max date, unsorted input |
| `… › fractional in any of open/high/low/close counts` | Each field (4 cases) |
| `… › fractional bar with undefined date → unknownDateCutoff (and max with dated ones)` | Fail-safe (consult Q3) |
| `… › non-number values (string, null, NaN, Infinity) are ignored` | Only finite non-integer numbers count; garbage stays for core's own `invalid_*` reasons |
| `vci.test.ts › adjusted history: mixed response rejects every bar on or before the latest fractional bar` | AC 1 (`chart-adjusted-mixed.json`): first three bars rejected `adjusted_price_history`, last two accepted, `adjustedCutoff` = third bar's date |
| `vci.test.ts › adjusted history: integer-valued bar older than the latest fractional bar is rejected too` | AC 1 integer coincidence. The coincidence bar must be on the 10-VND step and pass every other guard, so only the new rule can reject it |
| `vci.test.ts › adjusted history: bars after the cut-off are normalized as before` | AC 2 — inline body: fractional bar, then an off-step integer bar (`price_off_step`) and a good bar (accepted) |
| `vci.test.ts › adjusted history: fractional bar outside [from, to] still sets the cut-off` | Consult rec. 1 bullet 1 |
| `vci.test.ts › adjusted history: fractional bar with an invalid t rejects the whole response` | Consult Q3 default |
| `vci.test.ts › adjusted history: newest bar fractional → every bar rejected, adjustedCutoff = that date` | `chart-adjusted-latest.json` |
| `vci.test.ts › adjusted history: ctx.rejectOnOrBefore rejects integer bars on or before it; result carries it as adjustedCutoff` | AC 3 adapter side |
| `vci.test.ts › all-integer response → no adjustedCutoff field` | Unchanged behaviour (assert on `chart-ok.json` result having no `adjustedCutoff`) |
| `eod-sync.test.ts › backfill › adjusted cut-off from the newest chunk is passed as rejectOnOrBefore to older chunks` | AC 3 job side: ctx of calls 2 and 3 contain `rejectOnOrBefore`; `lastClose` behaviour unchanged |
| `eod-sync.test.ts › runEodSync with VciPriceSource › backfill: fractional bars in the newest chunk reject the all-integer older chunk` | AC 3, 4: older chunk's bars all rejected `adjusted_price_history`; `prior` rows unchanged; only post-cut-off dates upserted; `ok` true |
| `eod-sync.test.ts › adjusted_price_history rejections alone keep ok true; rejected and rejectedBySymbol still report them` | Consult Q1 default |
| `eod-sync.test.ts › newest window with a cut-off and zero accepted bars → ok false and an error log` | Consult rec. 4 |
| `eod-sync.test.ts › other rejection reasons still flip ok false alongside adjusted ones` | `ok` rule not weakened |

## Approach
1. **Core helper (R1, R2, R8).** In `packages/core/src/market/adjusted-history.ts`:
   ```ts
   export const ADJUSTED_HISTORY_REASON = 'adjusted_price_history';
   export function adjustedHistoryCutoff(
     bars: readonly { tradeDate: string | undefined; open: unknown; high: unknown; low: unknown; close: unknown }[],
     unknownDateCutoff: string,
   ): string | null
   ```
   A bar is fractional if any of o/h/l/c is `typeof 'number'`, finite and `!Number.isInteger`. Result = max (lexicographic `YYYY-MM-DD`) of the fractional bars' dates, where a fractional bar without a date counts as `unknownDateCutoff`. No fractional bar → `null`. Pure, no I/O.
2. **Contract (`price-source.ts`).** `fetchDaily(symbol, fromDate, toDate, ctx: { lastClose?: number; rejectOnOrBefore?: string })`; `FetchResult.adjustedCutoff?: string` = effective cut-off (own cut-off merged with `ctx.rejectOnOrBefore`), present only when defined. Document both in JSDoc.
3. **Adapter (`vci.ts`).** After the shape checks and before the loop: build the parsed list once (`tradeDate` derived exactly as today, values via `num()`), over **all** bars including those outside [from, to]. `own = adjustedHistoryCutoff(parsed, toDate)`; `effective = max(own, ctx.rejectOnOrBefore)` (either may be absent). In the loop, keep today's order: out-of-range skip → duplicate check → **new:** if `effective` defined and `tradeDate !== undefined && tradeDate <= effective` → push `{ tradeDate, reason: ADJUSTED_HISTORY_REASON }` and `continue` → otherwise `normalizeDailyBar` unchanged. Bars with no valid date keep going to `normalizeDailyBar` (→ `invalid_trade_date`). Return `{ bars, rejected, ...(effective ? { adjustedCutoff: effective } : {}) }`. The empty-list early return is unchanged.
4. **Job (`eod-sync.ts`, orchestration only).** Per symbol, next to `lastClose`: `let cutoff: string | undefined`. Pass ctx `{ ...(lastClose !== undefined ? { lastClose } : {}), ...(cutoff !== undefined ? { rejectOnOrBefore: cutoff } : {}) }` so existing ctx-equality tests keep passing. After each chunk: `cutoff = res.adjustedCutoff ?? cutoff`. `lastClose` logic unchanged (rejected bars never update it). Count `adjustedRejected` (rejections with `ADJUSTED_HISTORY_REASON`). For the **first (newest) chunk** of a symbol: if `res.adjustedCutoff !== undefined && res.bars.length === 0`, add the symbol to a local `adjustedNewest` list and log `error: <symbol>: newest window is all adjusted history (cut-off <date>)`. After the symbol loop, for each symbol with a cut-off, log `adjusted history <symbol>: bars on or before <date> rejected`. `ok` becomes `failed === 0 && skipped === 0 && rejected - adjustedRejected === 0 && adjustedNewest.length === 0 && ledgerError === undefined`. No new `EodSummary` fields; `rejected` / `rejectedBySymbol` keep counting everything. Request counting unchanged (fetch-and-reject).
5. **Fixtures.** `chart-adjusted-mixed.json`, symbol `TCB`, five consecutive days 2026-10-26..2026-10-30 (verify each `t` maps via `vnDateOf`; `1792429200` = 2026-10-20 in existing fixtures, +86400 per day): day 1 fractional (e.g. o 22701.14), day 2 all-integer on-step (coincidence), day 3 fractional, days 4–5 integer raw. Prices within the sanity band, on the 10-VND step for integer bars, consistent `low ≤ open/close ≤ high`. `chart-adjusted-latest.json`: same days, last bar fractional.
6. **Job VCI test.** Use a `fetchImpl` that answers per request body (`to`): newest chunk → a fractional bar plus a later integer bar; older chunk → all-integer on-step bars. Memory store `prior` holds rows for the older chunk's dates. Backfill config as in the existing backfill tests (`backfillChunkTradingDays: 5`, `backfillTradingDays: 12`, three chunks).
7. **ADR 0004.** Replace "Assumed raw" with: finding from the 2026-11-01 dry-run (adjusted before the latest corporate action, raw after; TCB/AGR examples); the cut-off rule; backfill carry-over; `ok` behaviour; limits (integer-valued adjusted bars newer than the latest fractional bar are not caught; if VCI ever rounds adjusted prices the guard is blind — checklist item 4 remains the real validation; a wrong-unit feed now reports `adjusted_price_history` rather than `invalid_*`, and still fails the run via the newest-window rule). Update checklist item 3 to "`rejected` contains only `adjusted_price_history` reasons, and `ok` is true". Remove "raw-vs-adjusted" from the UNVERIFIED list only to the extent observed (keep "whether integer bars after the cut-off are really raw" as unverified).

Rules: R1 (detection in core; job only orchestrates), R2 (no adjusted float ever stored; integer bars ≤ cut-off also not stored), R4 (no fill; gaps through the existing gap step, `source`/`fetched_at` unchanged), R5 (no market rule added — the reason code is not a market parameter), R7 (no TCBS change, no storing adjusted prices, no BCG "no bars" handling), R8 (core unit tests + green checks).

## Specialist input used
From `consult-data-engineer.md`:
- Rec. 1 (core pure function, count fractional bars outside [from,to], fail-safe on unknown date, one reason for fractional and integer bars, check before `normalizeDailyBar`, duplicate check unchanged) — **adopted**.
- Rec. 2 (optional `rejectOnOrBefore` ctx + optional `adjustedCutoff` result; job carries per symbol; `lastClose` unchanged) — **adopted**.
- Rec. 2 optional skip of older-chunk requests — **rejected** per Q2 default (fetch and reject; `requestsPlanned`/`requestsMade` semantics stay).
- Rec. 3 / Q1 (adjusted rejections do not flip `ok`) — **adopted** as a reversible default; otherwise every daily run would exit 1 for ~20 trading days after any corporate action, and the planned `--backfill` would always "fail".
- Rec. 4 (newest bar fractional → `ok` false + dedicated log) — **adopted**, operationalised as "newest chunk has a cut-off and zero accepted bars".
- Q3 (unknown-date fractional bar rejects the whole response) — **adopted**.
- Q4 (cut-off per symbol) — **adopted as log only**, no new `EodSummary` field.
- Rec. 5 tests and Rec. 6 ADR — **adopted**.
- Risks (residual false negatives, source rounding, no weakening of `price_off_step` / `close_jump`) — recorded in ADR; guards untouched.

## Assumptions
- Ming accepts the consult defaults Q1–Q4 above. All are reversible (a one-line change to the `ok` expression or the log), so they are not blocking.
- "Non-integer" means a finite JS number that is not an integer after `num()` parsing; digit strings like `"22701.14"` already become numbers via `num()`. Non-numeric garbage stays with core's existing `invalid_*` / `missing_*` reasons.
- The cut-off is per symbol and per run only; it is not persisted between runs. The daily 20-day lookback re-detects it on its own while the fractional bars are in the window. Once they leave it, older adjusted history is no longer fetched in daily mode.
- The TCBS adapter does not get this guard (ticket scope is VCI).
- Fixtures stay synthetic (modelled on the dry-run values in the ticket); no recorded live capture is needed for this ticket.

## Blocking questions
None

## Split proposal
None (estimated ~250–350 changed lines including tests, fixtures and ADR).
