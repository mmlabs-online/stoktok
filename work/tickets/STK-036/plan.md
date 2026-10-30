Status: READY

# Plan — STK-036: Raw-price guards for MA signal rules

## Spec summary
- docs/spec-v1.md §2.1: "Daily price limits | HOSE ±7%, HNX ±10%, UPCoM ±15% | Ceiling/floor distort technical signals; flag limit-hit sessions" and "Corporate actions | Cash dividends, stock dividends, rights issues". "All values below are **configuration, not hard-coded**".
- docs/spec-v1.md §3 F4: "Medium term … price vs 50/200-day MA". "Signals are suppressed if the underlying data is stale or has gaps." "Each signal stores its inputs (snapshot) so it can be audited later."
- docs/spec-v1.md §5: `corporate_actions | id, symbol, type, record_date, ratio/amount, applied`. The real schema has `ex_date date not null` and `record_date` nullable (`supabase/migrations/20261023000100_v1_tables.sql`). This plan uses `ex_date` (see A1). Updating the spec doc is a follow-up.
- CLAUDE.md R1 (calculation in core only), R2 (integer VND), R4, R5 (price limits come from config), R7, R8.
- Ticket AC1–AC5 (quoted in the table below). Ming 2026-10-30: this ticket must merge before STK-032.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | A pure function in `packages/core` takes a daily close series, the symbol's exchange, the market config price limits and the symbol's `corporate_actions`. It returns `corporate_action_in_window` when a stock dividend or rights issue falls inside the MA window, and `price_jump_beyond_limit` when a day-over-day close move exceeds the exchange's daily limit. | `packages/core/src/signals/raw-price-guard.ts` exports `checkRawPriceWindow` with no I/O and no clock. Tests in `raw-price-guard.test.ts`: "stock dividend with exDate inside (fromDate, toDate] triggers", "exDate == fromDate does not trigger", "exDate == toDate triggers", "future exDate ignored", "cash dividend in window does not trigger", "jump beyond limit triggers". Rights issues cannot be stored today (A3). The type test `type !== 'cash_dividend'` covers them automatically once they can be stored. |
| 2 | Price limits come from market configuration, not literals (R5). When the exchange is null, the widest configured limit is used and the result is flagged. | `grep -n "70000\|100000\|150000\|'UPCOM'" packages/core/src/signals/raw-price-guard.ts` finds nothing. Tests "null exchange uses max configured limit and sets exchangeUnknown" and "null exchange follows a changed config max". |
| 3 | The STK-015 MA rules call the guard and store a suppressed row with the guard's reason instead of an `ok` row. The new reason codes are added to the signal reason list with a defined sort order. | `moving-average.test.ts`: "stock dividend inside window → suppressed corporate_action_in_window, dataFresh true" and "jump inside window → suppressed price_jump_beyond_limit". `RULE_REASONS` ends with `…'value_out_of_range', 'corporate_action_in_window', 'price_jump_beyond_limit'`. Worker test "stock dividend in window → stored row suppressed with reason". |
| 4 | Unit tests: corporate action inside the window, a jump of the limit plus one tick, a null exchange, and a legitimate limit-hit day (exactly at the limit) that does not trigger. | Named tests in `raw-price-guard.test.ts` (see Tests). They use the finance-consult vectors. |
| 5 | `typecheck`, `lint` and `test` pass. | `pnpm typecheck && pnpm lint && pnpm test` |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/signals/raw-price-guard.ts` | **Create.** `resolveLimitPpm`, `isBeyondDailyLimit`, `checkRawPriceWindow` | AC1, AC2 (pure core guard, R1/R5) |
| `packages/core/src/signals/raw-price-guard.test.ts` | **Create.** Guard unit tests | AC4, R8 |
| `packages/core/src/signals/types.ts` | Add the two codes to `RULE_REASONS`. Add `exchange` and `corporateActions` to `SymbolData`. Add `priceLimitPpm` to `RuleContext`. Update the comments. | AC3, data plumbing |
| `packages/core/src/signals/moving-average.ts` | Call the guard on `win.window`. Push its reasons. Add `inputs.guard` and the action refs. | AC3 |
| `packages/core/src/signals/moving-average.test.ts` | Update the `data()` helper. Rewrite the existing cases whose last bar moves ±20% (A9). Add guard integration tests. | AC3, existing tests must stay meaningful |
| `packages/core/src/signals/evaluate.ts` | `EvaluateInput` gains `exchanges`, `corporateActions` and `marketRules`. Fill `SymbolData` per symbol (missing exchange → `null`) and `ctx.priceLimitPpm`. | AC3 plumbing |
| `packages/core/src/signals/evaluate.test.ts` | Pass the new inputs in `input()`. Add a test that a symbol with a stock dividend is routed to its own MA rows. | AC3 |
| `packages/core/src/signals/fixtures.ts` | `symbolData` adds `exchange: 'HOSE'` and `corporateActions: []`. `ctx()` adds `priceLimitPpm: DEFAULT_MARKET_RULES.priceLimitPpm`. | Fixtures must satisfy the new required fields |
| `packages/core/src/signals/growth.test.ts` | The `data()` literal adds `exchange` and `corporateActions`. | Type change only |
| `packages/core/src/index.ts` | Export `checkRawPriceWindow`, `isBeyondDailyLimit`, `resolveLimitPpm` and the result types | Worker/STK-032 reuse (DE rec. 6) |
| `packages/db/src/repos/corporate-actions.ts` | `listCorporateActions` opts gain `symbols?: readonly string[]` (`.in('symbol', …)`). An empty array returns `[]` without a query. | Worker needs actions for the universe |
| `packages/db/src/repos/corporate-actions.test.ts` | Test the symbols filter and the empty-array short-circuit | R8 |
| `apps/worker/src/jobs/medium-signals.ts` | `SignalsStore` gains `getMarketRules`, `getSymbolExchanges` and `listCorporateActions`. The job reads them before evaluating and passes them in. No try/catch. | AC3 plumbing, fail-safe |
| `apps/worker/src/jobs/medium-signals.test.ts` | The memory store implements the new methods. New tests. | AC3, fail-safe |
| `apps/worker/src/store.ts` | Wire the three methods. Corporate actions are read in chunks of `financialsSymbolChunk`. | Plumbing |
| `apps/worker/src/store.test.ts` | Mock the three db functions. Test the wiring and the chunking. | R8 |
| `apps/worker/README.md` | One sentence in the signals section about the new suppression reasons | Operator docs |

No migration. `signals.reason_codes` only checks the format `^[a-z0-9_]{1,60}`, with at most 20 codes.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| raw-price-guard.test › HOSE ref 20,000 → 21,400 (exactly +7%) does not trigger; 21,450 triggers | AC4 at-limit / limit + one tick |
| raw-price-guard.test › HOSE ref 20,000 → 18,600 (exactly −7%) does not trigger; 18,550 triggers | AC4 floor side |
| raw-price-guard.test › HOSE ref 25,400 → 27,150 (snapped ceiling) does not trigger; 27,200 (ceiling + one tick) triggers | AC4: the raw ppm test matches tick-snapped limits |
| raw-price-guard.test › HNX 15,000 → 16,500 and UPCOM 12,300 → 14,100 do not trigger | per-exchange config |
| raw-price-guard.test › null exchange: +12% does not trigger, +16% triggers, `exchangeUnknown: true`, `limitPpmUsed` = max of config | AC2, AC4 null exchange |
| raw-price-guard.test › null exchange follows a changed config max (e.g. HNX set to 200,000 → limitPpmUsed 200,000) | AC2 (no literal) |
| raw-price-guard.test › known exchange: `exchangeUnknown: false`, `limitPpmUsed` = that exchange's ppm | AC2 |
| raw-price-guard.test › stock dividend exDate strictly inside the window triggers `corporate_action_in_window` and cites `corporate_actions:<id>` | AC1, AC4 |
| raw-price-guard.test › exDate == first bar date does not trigger; exDate == last bar date triggers | A2 boundary |
| raw-price-guard.test › exDate after the last bar, or before the first, is ignored | A2 |
| raw-price-guard.test › exDate on a non-trading day inside the window still triggers | A2 (string compare) |
| raw-price-guard.test › cash dividend inside the window does not trigger | A4 |
| raw-price-guard.test › an action for another symbol is ignored | defensive filter |
| raw-price-guard.test › the move into the first bar is not checked (first bar itself +20% vs nothing) | A5 |
| raw-price-guard.test › a pair that is not adjacent trading days (gap) is skipped | A5 |
| raw-price-guard.test › prevClose ≤ 0 is skipped; an off-tick prevClose (e.g. 25,433) does not throw | A6 |
| raw-price-guard.test › both reasons together are returned in REASON_ORDER; `jumps` lists date, prevClose, close and movePpm | AC3 order, snapshot |
| raw-price-guard.test › empty window → no reasons | edge |
| raw-price-guard.test › `isBeyondDailyLimit` is symmetric and uses integer math (large values, e.g. prev 999,999,950) | R2 |
| moving-average.test › stock dividend inside the window → suppressed, reasons `['corporate_action_in_window']`, dataFresh true, label/value null, `inputs.guard` present, ref cited | AC3 |
| moving-average.test › a beyond-limit jump inside the window → suppressed `price_jump_beyond_limit` | AC3 |
| moving-average.test › insufficient_history / price_gap → guard not run (`inputs.guard` null), reasons unchanged | A5 |
| moving-average.test › clean window with null exchange → ok row, `inputs.guard.exchangeUnknown` true | AC2 flag only |
| evaluate.test › corporateActions and exchanges are routed per symbol (only A's MA rows suppressed) | plumbing |
| corporate-actions.test (db) › `symbols` filter uses `.in('symbol', …)`; `symbols: []` returns [] with no request | db change |
| store.test › listCorporateActions is chunked by financialsSymbolChunk; getMarketRules/getSymbolExchanges are wired | wiring |
| medium-signals.test › stock dividend within MA50 window (closeDays 60) → `price_vs_ma_50` row suppressed with `corporate_action_in_window`, `data_fresh` true; suppressedByReason counts it | AC3 end-to-end |
| medium-signals.test › listCorporateActions rejects → run rejects, upsert not called | fail-safe (A8) |
| medium-signals.test › symbol absent from getSymbolExchanges → snapshot `guard.exchangeUnknown` true (never HOSE) | AC2, A7 |

## Approach
1. **Core guard** (`raw-price-guard.ts`, pure, R1/R2/R5):
   - `resolveLimitPpm(exchange: Exchange | null, priceLimitPpm: Readonly<Record<Exchange, number>>): { limitPpm: number; exchangeUnknown: boolean }`. A null exchange gives `Math.max(...EXCHANGES.map((e) => priceLimitPpm[e]))`. Never a literal.
   - `isBeyondDailyLimit(prevClose: number, close: number, limitPpm: number): boolean`. Returns `false` when `prevClose <= 0`. Otherwise it is the BigInt check `|close − prev| × PPM > limitPpm × prev` (strict `>`, so an exact-limit day passes). No `priceLimits()` call, no tick bands, no throw.
   - `checkRawPriceWindow({ symbol, window, exchange, priceLimitPpm, actions, holidays })`:
     - `window` is oldest first.
     - Corporate-action check: actions with `a.symbol === symbol && a.type !== 'cash_dividend' && fromDate < a.exDate && a.exDate <= toDate`, using plain string comparison.
     - Jump check: for each adjacent pair i−1, i inside the window, only if `previousTradingDay(window[i].tradeDate, holidays) === window[i−1].tradeDate`.
     - Returns `{ reasons, exchange, exchangeUnknown, limitPpmUsed, actionRefs: SnapshotRef[] /* {ref:'corporate_actions:<id>'} */, jumps: {date, prevClose, close, movePpm}[] }`. `movePpm` uses `mulDiv`, for the record only. Reasons are ordered by `REASON_ORDER`.
2. **Reason codes** (`types.ts`): append `'corporate_action_in_window'` then `'price_jump_beyond_limit'` to `RULE_REASONS` after `'value_out_of_range'`. `REASON_ORDER` stays `[...DATA_REASONS, ...RULE_REASONS]`, so these rows get `dataFresh = true` (A2b). Update the comment.
3. **Types:**
   - `SymbolData` adds `exchange: Exchange | null` and `corporateActions: readonly CorporateAction[]`, both required.
   - `RuleContext` adds `priceLimitPpm: Readonly<Record<Exchange, number>>`.
   - `EvaluateInput` adds `exchanges: Readonly<Record<string, Exchange | null>>`, `corporateActions: readonly CorporateAction[]` and `marketRules: Pick<MarketRules, 'priceLimitPpm'>`.
   - `evaluate.ts` fills `exchange: input.exchanges[s] ?? null` and filters actions by symbol.
4. **priceVsMa:**
   - After `checkPriceWindow`, when `bars.length > 0`, call the guard with `data.exchange`, `ctx.priceLimitPpm`, `data.corporateActions` and `ctx.holidays`.
   - Push its reasons into `reasons` before the `reasons.length === 0` value gate.
   - Add `guard` (the guard result without `reasons`, or `null` when not run) to `inputs`. Append `actionRefs` to `inputs.refs` (R9 ref style).
   - Other rules are untouched (R7).
5. **DB repo:** add the optional `symbols` filter to `listCorporateActions`. The existing no-arg and `symbol` behaviour is unchanged.
6. **Worker:**
   - The store gains `getMarketRules()`, `getSymbolExchanges(symbols)` and `listCorporateActions(symbols)` (chunked).
   - `runMediumSignals` reads them after the symbol universe is known and before `evaluateMediumSignals`. It passes `marketRules`, `exchanges` and `corporateActions`.
   - Errors propagate, so the run fails before any upsert. Orchestration only (R1).
7. **Docs:** one README sentence. Do not edit the spec (follow-up).
8. Run `pnpm typecheck && pnpm lint && pnpm test` (R8).

R3/R6: no web or route change. R4: the guard only reads stored data and adds no data source. R9/R10: not affected.

**Follow-ups (not in this diff, R7)** for the orchestrator to log:
- (a) Spec §5 `corporate_actions` should list `ex_date, record_date`.
- (b) `rights_issue` support in the schema, validation and ledger (A3).
- (c) An adjusted close series or a cash-dividend threshold (`cashDividendMaxPpm`) per ADR 0001 (A4).
- (d) A corporate-action feed for watched (non-held) symbols. Small stock dividends on watched names go undetected (finance Risk 1).
- (e) An exchange backfill for `symbols.exchange` (mostly null today, so the 15% path is common).
- (f) A note in STK-032 to reuse `isBeyondDailyLimit`.
- (g) First-listing-day and post-suspension limits are not configured.

## Specialist input used
- Finance R-A (ex_date, half-open `(fromDate, toDate]`, boundary tests): **adopted**. The data engineer agrees (`windowFirst < exDate <= windowLast`).
- Finance R-B (trigger on every type except `cash_dividend`, no ratio threshold): **adopted**. It is fail-safe and matches AC1's "stock dividend or rights issue".
- Finance R-B optional cash-dividend snapshot list: **rejected**. It is not in the AC (planner rule 1). It goes to follow-up (c).
- Finance R-C (strict raw BigInt ppm test, no `priceLimits()`, adjacent pairs only, skip prev ≤ 0, test vectors): **adopted** over DE rec. 1's `priceLimits` + try/catch. It is equivalent for on-tick closes, never throws and needs no tick bands. That settles the off-tick fallback question.
- Finance R-D / DE rec. 1 (widest limit from config, `exchangeUnknown` flag in inputs, not a reason): **adopted**.
- Finance R-E / DE rec. 4 (`RULE_REASONS`, so `dataFresh` true, with corporate action before jump): **adopted**. The codes are appended after `value_out_of_range` (DE placement). Finance's placement before `eps_basis_unverified` was not used: the MA rules never emit other rule reasons, so position is cosmetic, and appending keeps the existing order stable.
- Finance R-F / DE rec. 2 (module shape, `inputs.guard`, `corporate_actions:<id>` refs, only `priceVsMa`): **adopted**. Holidays are added to the input so the exported helper is safe outside `checkPriceWindow` (for STK-032).
- DE rec. 2 "run only when no other reasons": **modified**. The guard runs whenever the window is non-empty (that means complete), so all reasons are reported (STK-015 convention, finance R-E).
- DE rec. 3 (store methods, `.in()` filter chunked, fail-safe propagation, missing exchange = null): **adopted**.
- DE rec. 6 (export the per-pair helper): **adopted** as an export only. The STK-032 note is a follow-up.
- DE Q4 (UPCoM reference = VWAP, not close): **accepted as a risk**. It causes false positives, which are fail-safe (A6).

## Assumptions
These are non-blocking planner defaults. **Ming should confirm them in the PR.**
- **A1 – Window date = `ex_date`.** The schema has `ex_date NOT NULL`, and the raw close drops on the ex-date (ngày GDKHQ). `record_date` is not used.
- **A2 – Boundary is half-open `(fromDate, toDate]`** of the N bars actually used. An ex-date on the first bar means the whole window is post-ex, which is consistent. Pinned by tests.
- **A2b – The new reasons are rule reasons (`dataFresh = true`).** The data is fresh and complete, but a raw series is unfit for an MA. This departs from the STK-015 consult table. The `signals.data_fresh` column comment ("stale, gap, missing, insufficient history") supports it. Swapping to `DATA_REASONS` later is a one-line change.
- **A3 – Rights issues cannot be stored** (DB check, core union, `CA_TYPE_UNSUPPORTED`, STK-008 A1). AC1's "rights issue" is therefore covered by (i) the type rule `type !== 'cash_dividend'`, which catches any future type automatically, and (ii) the jump guard for moves beyond the limit. Schema support is follow-up (b).
- **A4 – Cash dividends never trigger** (AC1 names only stock dividend / rights issue). The bias is about ≤3%, which is a known residual risk.
- **A5 – Jump pairs are checked only inside the window, and only between adjacent trading days.** The move into the first bar is excluded, and so are gapped pairs (a gap is already `price_gap`). The fetch is not extended to N+1.
- **A6 – Reference price = previous stored close.** No tolerance is added. False positives on UPCoM (VWAP reference), first listing days and resumptions are accepted as fail-safe.
- **A7 – Null exchange → widest configured limit, flagged in `inputs.guard` only, not a suppression reason.** A symbol absent from `symbols` counts as null, never HOSE.
- **A8 – A failure reading corporate actions, exchanges or market rules aborts the run with no rows written.** No `ok` MA rows are produced without the guard.
- **A9 – Existing `moving-average.test.ts` cases use a ±20% last bar (12,000 / 8,000 after 10,000s).** These now correctly trigger `price_jump_beyond_limit` on HOSE. The implementer rewrites them with in-limit moves and recomputes the expected values. Example: last = 10,500 → ma 10,050, value 44,776; last = 9,500 → ma 9,950, value −45,226. The guard is not weakened and the tests are not given a fake exchange to dodge it.

## Blocking questions
None.

## Split proposal
None. The estimate is about 350–400 changed lines, most of them tests, for one feature (the MA guard plus its plumbing).
