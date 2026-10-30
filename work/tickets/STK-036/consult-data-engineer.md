## STK-036 data-engineer consult (read-only)

### Findings

**What the MA rules receive today**
- `apps/worker/src/jobs/medium-signals.ts` reads holidays, signal rules, closes, financials, sectors and gaps, then calls `evaluateMediumSignals` (`packages/core/src/signals/evaluate.ts`). It reads no `corporate_actions`, no exchanges and no market rules.
- `EvaluateInput`, `SymbolData` and `RuleContext` (`signals/types.ts`) carry none of these. Tick bands (`DEFAULT_TICK_BANDS`, `market/config.ts`) are not part of `MarketRules`.
- `priceVsMa` (`signals/moving-average.ts`) calls `checkLatestPrice` and `checkPriceWindow` (`signals/inputs.ts`). `finalizeResult` suppresses on any reason and orders reasons by `REASON_ORDER` = `DATA_REASONS` followed by `RULE_REASONS`.

**What already exists in `@stoktok/db` and core**

| Need | Status |
|---|---|
| Symbol exchange | `getSymbolExchanges(db, symbols)` in `packages/db/src/repos/symbols.ts` exists. It does one query and returns `Record<string, Exchange \| null>`. Symbols with no row are omitted, and null means unknown. It is not on `SignalsStore` or in `store.ts`. |
| Price limits | `getMarketRules(db)` (`repos/settings.ts`) exists and returns `MarketRules.priceLimitPpm` (defaults HOSE 70000, HNX 100000, UPCOM 150000). It is not wired to the signals store. |
| Limit math | `priceLimits({ref, exchange, rules, tickBands})` (`market/price-board.ts`) is pure and tick-snapped. It throws `RangeError` if `ref` is off tick, and it requires a non-null `Exchange`. |
| Corporate actions | `listCorporateActions(db, {symbol?})` (`packages/db/src/repos/corporate-actions.ts`) exists. It has no `symbols[]` filter. With no symbol it pages the whole table, ordered by `ex_date`. It is not on `SignalsStore`. |

**Corporate action shape**
- The `CorporateAction` type (`ledger/types.ts`) has only `cash_dividend` and `stock_dividend`. The DB check constraint is the same. **Rights issue does not exist in the schema**, and `validateCorporateActionInput` rejects it (STK-008 A1). The AC wording "stock dividend or rights issue" can only be met for `stock_dividend` now.
- `ex_date` is NOT NULL. `record_date` is nullable. The domain type maps `exDate` only. `record_date` is passed through `meta` and is not on the domain type.
- Spec §5 lists `record_date`, but the schema and ledger use `ex_date`. `ex_date` is the first day the raw price drops, so it is the correct anchor for a raw-price guard. This settles the open question in the ticket, subject to the finance consult.

**Gap and jump interaction**
- `getRecentCloses(symbols, n = rules.priceVsMa.longDays)` returns exactly the last N stored rows per symbol, not a date range.
- `checkPriceWindow` already requires the window to be complete. Every trading day from `subtractTradingDays(end, days-1)` to the end must be stored. A hole gives `price_gap` and an empty `window`. So when the guard runs on a non-empty window, every adjacent pair is exactly one trading day apart.
- Running the jump check on a gapped series is wrong: a move across 2 or more trading days can legitimately exceed one day's limit. It also adds noise to a window already suppressed. Run the guard only on `win.window` and skip it when the window is empty. A gapped window then reports `price_gap` alone.
- The window has N bars, so only N-1 pairs are available. The move into the first bar (from the bar before the window) is not checked. A jump there sits just outside the MA input and does not distort it. Do not extend the fetch to N+1.
- The corporate action check uses calendar dates against the window bounds `[window[0].tradeDate, window[last].tradeDate]`. It does not depend on gaps.
- A limit-ratio check cannot catch a stock dividend. The exchange resets the reference price at ex-date, so the raw drop is normally inside the limit. This is why the corporate action check is separate and must come first in the design. Cash dividends are out of scope per the AC. They cause a small step, and the guard should not suppress on them.

**Reference price caveat (UNVERIFIED)**
- On HNX and UPCoM the exchange reference price may differ from the previous close (the UPCoM reference is, as I recall, an average price). Using the previous close with exactly ±limit may false-trigger on a real limit-hit day. The tick snap in `priceLimits` (ceiling rounded down, floor rounded up) is itself marked UNVERIFIED in its comment. Ask the finance consult to confirm.

### Recommendations

1. **New pure module `packages/core/src/signals/raw-price-guard.ts`** (AC1, AC2, R1, R5).
   - Signature: `checkRawPriceWindow({ window: StoredClose[], exchange: Exchange | null, rules: Pick<MarketRules,'priceLimitPpm'>, tickBands, actions: readonly CorporateAction[] })`.
   - Return `{ reasons: ReasonCode[]; exchangeUnknown: boolean; offending: {...}[] }`. Keep it separate from `checkPriceWindow`, which stays unchanged.
   - Corporate action check: `type === 'stock_dividend'` and `windowFirst <= exDate <= windowLast`. Filter by symbol inside the function. Decide the boundary: an `exDate` equal to the first bar's date means the drop happened before the first bar, so use `windowFirst < exDate <= windowLast`. Put this in the plan with a test.
   - Jump check: for each adjacent pair, compute `priceLimits({ref: prev.close, ...})`. Flag when `close > ceiling` or `close < floor`. The test cases are exactly at the limit (no flag) and the limit plus one tick (flag).
   - Do not let `priceLimits` throw out of the signals job. An off-tick `prev.close` raises `RangeError`. Catch it and either fall back to plain integer ppm bounds or flag the pair. Put the fallback in the plan. EOD ingestion normally rejects off-step prices, but the guard must still not crash.
   - Null exchange: pick the exchange with the largest `priceLimitPpm` (derive it from config, no literal 'UPCOM'). Use that exchange's tick bands, and return `exchangeUnknown: true`. Record this flag in `inputs` and do not turn it into a reason code. The AC says "flagged", and an extra reason would make every symbol with an unknown exchange look suppressed even when the data is clean.

2. **Plug into `priceVsMa` (`moving-average.ts`) only**, right after `checkPriceWindow`.
   - Run the guard only when `win.window.length > 0` and `reasons` has no other entries. Push the guard reasons into `reasons`, which `finalizeResult` already turns into a suppressed row (AC3).
   - Add `guard: { exchange, exchangeUnknown, corporateActionIds, jumps }` to `inputs`. Cite action IDs as `corporate_actions:<id>` refs (R9 and the existing ref style).
   - Keep the PE, PB and growth rules untouched (R7).

3. **Data plumbing**
   - Add `exchange: Exchange | null` and `corporateActions: CorporateAction[]` to `SymbolData`. Add `exchanges` and `corporateActions` to `EvaluateInput`, and `marketRules` plus `tickBands` to `RuleContext`. `evaluate.ts` fills them per symbol like financials.
   - Add three methods to `SignalsStore`: `getMarketRules()`, `getSymbolExchanges(symbols)` and `listCorporateActions(symbols)`. Wire them in `createDbSignalsStore` from the existing `getMarketRules` and `getSymbolExchanges`.
   - Corporate actions need a small db-repo change: either loop `listCorporateActions` per symbol, or add a `symbols` filter. The `.in()` filter is cleaner and keeps the existing contract. Chunk it like the financials read does (`financialsSymbolChunk`). Keep the db change inside the plan.
   - Fail safe: if reading `corporate_actions` fails, the job must not produce `ok` MA rows. Let the error propagate and abort the run (no rows written), and do not treat it as "no actions". A symbol missing from `getSymbolExchanges` is the same as null. It must not be defaulted to HOSE.

4. **Reason codes** (AC3).
   - Add `corporate_action_in_window` and `price_jump_beyond_limit` to `RULE_REASONS` in `signals/types.ts`, after `value_out_of_range`, in that order. The data is fresh but not usable for the rule, which is the meaning of `RULE_REASONS` and gives `dataFresh = true`.
   - Alternative: put them in `DATA_REASONS` so `dataFresh = false`. A jump beyond the limit may be a bad bar, so the finance consult should decide. I lean to `RULE_REASONS` because a corporate action is not a freshness problem.
   - The DB accepts any `[a-z0-9_]{1,60}` code and at most 20 codes (`20261026000200_signals.sql`). No migration is needed.
   - Update the `types.ts` comments and the `suppressedByReason` summary test.

5. **Tests** (AC4, R8).
   - Core unit tests: stock dividend inside the window; stock dividend outside the window; cash dividend inside the window (no flag); a jump of limit plus one tick; exactly at the limit (no flag), including a floor-side case; null exchange (widest limit and `exchangeUnknown`); an off-tick previous close (no throw).
   - Interaction tests: a gapped window gives only `price_gap`, and a guard failure in the middle of an otherwise complete window gives a suppressed row with the reason.
   - Worker test in `medium-signals.test.ts` with a fake store covering the new methods, plus a case where the corporate-actions read throws.

6. **Backfill hand-off.** Add a one-line note to the STK-032 plan or ticket that its backfill must not use `ctx.lastClose` chaining as the only jump protection (see `consult-data-engineer.md`). It should later reuse the same core jump helper. Reuse is future work and not part of STK-036 (R7). Export the per-pair helper (`isBeyondDailyLimit(prev, close, exchange, ...)`) from core so STK-032 can use it.

### Risks
- **Silent corrupt MA signals** if STK-032 merges first. Ming's decision already makes STK-036 a prerequisite. Enforce it in the backlog.
- **Rights issue absent** from schema and entry validation. The AC cannot be fully met. A rights issue would still show up as a plain jump inside the limit and pass the guard unnoticed. Record this as a follow-up, not as scope.
- **A missing or late corporate action record** means the guard cannot see the distortion. The guard covers only entered actions. The UI/entry flow already requires manual entry. Document that.
- **Exchange data quality.** A mislabelled exchange gives a wrong limit. A stored exchange of null is the common state, because the sector sync never writes exchange (`setSymbolSector` writes only sector columns). Expect many symbols to hit the widest-limit path (UPCoM 15%). That reduces sensitivity for HOSE names, where a 7% limit would catch more.
- **False positives or negatives from the reference price and the tick snap** (UNVERIFIED, see Findings).
- **New listing / first day limits** (HOSE first-day limit differs) are not configured. Windows of 50 or 200 bars rarely include the first listing day, but a freshly backfilled symbol could. Mention it in the plan and leave it out of scope.
- **Performance.** Per-symbol action queries scale with the universe. A chunked `.in()` read keeps it to a handful of queries.

### Open questions
1. Which date defines "inside the window"? I recommend `ex_date` (the first day the raw price drops). The record date is optional and earlier than the drop. Does the finance consult agree, and is the first-bar boundary exclusive as proposed?
2. Should the two reasons be `RULE_REASONS` (`dataFresh = true`) or `DATA_REASONS` (`dataFresh = false`)? Which does the UI expect for a "data" badge?
3. For an off-tick previous close, should the guard fall back to plain ppm bounds or flag the pair?
4. Is the previous close an acceptable reference price on HNX and UPCoM, or does it need a tolerance of one tick?
5. Does the finance consult accept the widest-limit rule for null exchange, with the flag in `inputs` only (not a suppression reason)? This matches STK-015's earlier consult.
6. Is a `symbols` filter on `listCorporateActions` in scope for STK-036's db change, or should the store loop per symbol?
7. Should `cash_dividend` ever count? The AC says no. Confirm.

Files read: `/home/user/stoktok/work/tickets/STK-036/ticket.md`, `/home/user/stoktok/work/tickets/STK-032/consult-data-engineer.md`, `/home/user/stoktok/work/tickets/STK-015/plan.md` (A6), `/home/user/stoktok/apps/worker/src/jobs/medium-signals.ts`, `/home/user/stoktok/apps/worker/src/store.ts`, `/home/user/stoktok/packages/core/src/signals/{types,inputs,moving-average,evaluate}.ts`, `/home/user/stoktok/packages/core/src/market/price-board.ts`, `/home/user/stoktok/packages/core/src/ledger/types.ts`, `/home/user/stoktok/packages/db/src/repos/{corporate-actions,prices-daily,symbols,settings}.ts`, `/home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql`, `/home/user/stoktok/supabase/migrations/20261026000200_signals.sql`.
