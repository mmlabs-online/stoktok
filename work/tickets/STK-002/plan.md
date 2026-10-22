Status: READY

# Plan — STK-002: Core ledger — transactions → lots → holdings with P&L

> **Flags for Ming (non-blocking).** Each one is a configurable default, so a different answer means a settings change, not a rewrite:
> 1. **Cost method = moving weighted-average cost (WAC), buy fee included.** Sells use up lot *quantities* oldest-first (FIFO) only for T+2 sellability; FIFO has no effect on cost. Unverified against TCBS. Check on one statement whether giá vốn changes after a sell; under WAC it should not.
> 2. **Cash-dividend default = `reduceCost`.** This follows CLAUDE.md ("all adjust cost basis") and spec §2.1 ("Cost basis adjustment"). The finance consult reports that brokers usually do *not* lower giá vốn, which would mean `income` (also unverified). Both modes are implemented as `settings.cashDividendTreatment`. Total P&L is the same in both; only the split between avg cost and realized differs. If TCBS uses `income`, Ming flips the setting and updates the CLAUDE.md line himself.
> 3. **Rounding = half-up to integer VND**, defined once. TCBS's real rounding mode is unknown.
> 4. **Stock-dividend shares** are sellable from `listingDate`. If none is given, they are sellable from exDate + settlementDays trading days.

## Spec summary
- docs/spec-v1.md §2.1: "All values below are **configuration, not hard-coded**" — "Settlement | T+2: bought shares can be sold from T+2 | Never suggest selling a lot that is not yet sellable"; "Selling tax | 0.1% of sale value | Realized P&L"; "Brokerage fee | Ming's actual TCBS fee rate (user setting) | Cost basis and P&L"; "Corporate actions | Cash dividends, stock dividends, rights issues | Cost basis adjustment; most common source of P&L drift".
- §1.4: "Portfolio P&L in the app matches the TCBS statement after reconciliation (fees, tax and corporate actions included)."
- §3 F1: "Manual entry per transaction: date, symbol, side (buy/sell), quantity, price, fee, tax." "Corporate action entry: cash dividend, stock dividend, rights issue."
- §3 F2: "Holdings derived from the ledger (never edited directly): quantity, average cost, market value, unrealized/realized P&L." "Lot tracking with sellable date (T+2) and status: `pending` / `sellable`."
- §5: `transactions` (id, date, symbol, side, quantity, price, fee, tax, …), `corporate_actions` (id, symbol, type, record_date, ratio/amount, applied), `lots` (id, symbol, buy_transaction_id, quantity_remaining, cost_per_share, sellable_from). "Holdings and P&L are **derived** from `transactions` + `corporate_actions` + `lots`, never stored as editable balances."
- CLAUDE.md R1, R2, R5, R8; market rules table ("Corporate actions | Cash dividend, stock dividend, rights issue — all adjust cost basis").

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Lots with `sellableFrom` and status `pending`/`sellable` as of a date, from transactions + settings (fee rate, sell tax, settlement days) | `build-ledger.test.ts › T+2 pending lot` (pending on T+1, sellable on T+2), `› T+2 across weekend and holiday`, `› missing fee/tax filled from settings`; `calendar.test.ts › addTradingDays …` |
| 2 | Holdings per symbol: quantity, sellable quantity, average cost, realized P&L; unrealized P&L given a price map | `build-ledger.test.ts › single buy then sell` and `› multiple lots with partial sell` check `quantity`, `sellableQuantity`, `totalCost`, `averageCost`, `realizedPnl`. `valuation.test.ts › unrealized P&L from price map` and `› missing price gives null` |
| 3 | Sells use up lots by a documented method | Method documented in the JSDoc of `buildLedger` and in this plan (WAC cost, FIFO lot quantity). `› multiple lots with partial sell` checks that the average cost is unchanged after a sell and that the oldest lot is reduced first. `› selling entire position removes all cost` |
| 4 | Cash and stock dividends adjust holdings/cost basis as documented | `› cash dividend reduceCost (default)`, `› cash dividend income mode`, `› cash dividend entitles pending lot`, `› cash dividend larger than cost clamps to zero`, `› stock dividend adds zero-cost lot, lowers average`, `› stock dividend lot pending until listingDate`, `› stock dividend fractional shares dropped` |
| 5 | A sell above the sellable quantity is rejected with a typed error | `› oversell returns OVERSELL error` (asserts `{ ok: false, error: { code: 'OVERSELL', transactionId, symbol, date, requested, sellable } }`), `› sell of pending (T+1) shares is oversell`, `› same-day buy then sell is oversell` |
| 6 | All money and prices are integer VND; rounding defined once | `money.test.ts › roundDiv half-up` and `› applyRatePpm`; `› rejects non-integer money (INVALID_INPUT)`; `› overflow-sized values stay exact` (BigInt path). Reviewer greps `packages/core/src` and finds no `Math.round`/`toFixed`/float rates outside `money.ts` |
| 7 | Unit tests cover single buy/sell, multiple lots with partial sell, T+2 pending, cash dividend, stock dividend, oversell | All of the above. `pnpm typecheck && pnpm lint && pnpm test` green (R8) |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/money.ts` | create | Single rounding rule (`ROUNDING_MODE = 'half-up'`), `roundDiv(numer: bigint, denom: bigint): bigint`, `mulDiv(a, b, c): number` (exact BigInt multiply-then-divide, returns a safe integer), `applyRatePpm(amount, ratePpm)`, `assertVnd(value, field)` (AC6, R2) |
| `packages/core/src/money.test.ts` | create | Tests for the rounding rule |
| `packages/core/src/calendar.ts` | create | `isTradingDay(date, holidays)` and `addTradingDays(date, n, holidays)` on `'YYYY-MM-DD'` strings. Weekends are skipped; holidays are an input (R5) |
| `packages/core/src/calendar.test.ts` | create | Calendar tests |
| `packages/core/src/ledger/types.ts` | create | Input/output types: `Transaction`, `CorporateAction` (discriminated union), `LedgerSettings`, `Lot`, `Holding`, `Realization`, `LedgerError`, `Result` |
| `packages/core/src/ledger/settings.ts` | create | `DEFAULT_MARKET_SETTINGS` (settlementDays 2, sellTaxRatePpm 1000, dividendWithholdingRatePpm 50000, cashDividendTreatment 'reduceCost', costMethod 'WAC', holidays []). `estimateFees(side, quantity, price, settings)` |
| `packages/core/src/ledger/build-ledger.ts` | create | `buildLedger(transactions, corporateActions, settings, asOf)`: replay → lots, holdings, realizations, or a typed error (AC1–5) |
| `packages/core/src/ledger/build-ledger.test.ts` | create | Ledger scenario tests (AC7) |
| `packages/core/src/ledger/valuation.ts` | create | `valueHoldings(holdings, priceMap)` → market value and unrealized P&L (AC2) |
| `packages/core/src/ledger/valuation.test.ts` | create | Valuation tests |
| `packages/core/src/index.ts` | modify | Re-export the public API. Keep `describeCore` |

No DB, migration, or UI files. `index.test.ts` stays unchanged.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| money.test.ts › roundDiv half-up (positive, exact .5, below .5, negative numerator symmetric) | AC6 |
| money.test.ts › applyRatePpm: 0.1% of 12,345,000 = 12,345; 0.15% of 1,000,333 rounds half-up | AC6 |
| money.test.ts › mulDiv exact for 1e11 × 1e6 / 3e6 (beyond 2^53 intermediate) | AC6, overflow |
| money.test.ts › assertVnd rejects 1.5, NaN, unsafe integer | AC6 |
| calendar.test.ts › addTradingDays Mon+2 = Wed; Thu+2 = Mon; Fri+2 = Tue | AC1 |
| calendar.test.ts › addTradingDays skips a listed holiday | AC1, R5 |
| calendar.test.ts › rejects malformed date string | input safety |
| build-ledger.test.ts › single buy then sell (realized = qty·price − fee − tax − cost; position closed, holding remains with qty 0 and realized P&L) | AC2, AC7 |
| build-ledger.test.ts › multiple lots with partial sell (two buys at different prices; partial sell; oldest lot reduced first; average cost unchanged by the sell; costRemoved is proportional) | AC3, AC7 |
| build-ledger.test.ts › selling entire position removes all cost (no leftover VND after three uneven buys) | AC3 |
| build-ledger.test.ts › T+2 pending lot (asOf = T+1 → pending, sellableQuantity 0; asOf = T+2 → sellable) | AC1, AC7 |
| build-ledger.test.ts › T+2 across weekend and holiday | AC1 |
| build-ledger.test.ts › missing fee/tax filled from settings; entered fee/tax override settings | AC1 |
| build-ledger.test.ts › events after asOf are ignored | AC1 |
| build-ledger.test.ts › cash dividend reduceCost (default): totalCost −= net; dividendCashNet reported; realized excludes it | AC4, AC7 |
| build-ledger.test.ts › cash dividend income mode: totalCost unchanged; realizedPnl includes net dividend | AC4 |
| build-ledger.test.ts › cash dividend entitles pending lot (bought before exDate, not yet sellable) and excludes a buy on exDate | AC4 |
| build-ledger.test.ts › cash dividend larger than cost clamps totalCost to 0, excess goes to realized P&L | AC4 edge |
| build-ledger.test.ts › stock dividend adds zero-cost lot, lowers average (100:20 on 1,000 shares → +200, totalCost unchanged) | AC4, AC7 |
| build-ledger.test.ts › stock dividend fractional shares dropped (100:15 on 1,010 → +151) | AC4 |
| build-ledger.test.ts › stock dividend lot pending until listingDate; fallback to exDate + settlementDays when listingDate is missing | AC1, AC4 |
| build-ledger.test.ts › oversell returns OVERSELL error | AC5, AC7 |
| build-ledger.test.ts › sell of pending (T+1) shares is oversell | AC5 |
| build-ledger.test.ts › same-day buy then sell is oversell | AC5 |
| build-ledger.test.ts › rejects non-integer money (INVALID_INPUT) | AC6 |
| build-ledger.test.ts › same-date ordering uses seq then id (deterministic) | ordering |
| build-ledger.test.ts › does not mutate inputs | purity |
| valuation.test.ts › unrealized P&L from price map (qty·price − totalCost) | AC2 |
| valuation.test.ts › missing price gives null marketValue/unrealizedPnl, not 0 | AC2, R4 spirit |

## Approach
1. **money.ts (R2 rounding, defined once).** Internally all intermediate products use `bigint`. `roundDiv` rounds half away from zero. Exported number values are always checked with `Number.isSafeInteger`. Rates are integer **ppm** (parts per million; 0.1% = 1000). Ppm is used instead of bps so fee rates like 0.015% can be expressed exactly. No floats anywhere.
2. **calendar.ts.** Pure date-string arithmetic in UTC (`Date.UTC`) on `'YYYY-MM-DD'`. `addTradingDays(d, n, holidays)` steps forward and counts only weekdays not in `holidays`. Holidays come from settings (R5).
3. **types.ts.**
   - `Transaction { id: string; seq: number; tradeDate: string; symbol: string; side: 'buy'|'sell'; quantity: number; price: number; fee?: number; tax?: number }`.
   - `CorporateAction`:
     - `{ type: 'cash_dividend'; id; symbol; exDate; payDate?; amountPerShare /* gross VND */ }`
     - `{ type: 'stock_dividend'; id; symbol; exDate; ratio: { held: number; received: number }; listingDate? }`
   - `LedgerSettings { feeRatePpm; sellTaxRatePpm; settlementDays; holidays: readonly string[]; dividendWithholdingRatePpm; cashDividendTreatment: 'reduceCost'|'income'; costMethod: 'WAC' }`.
   - `Lot { id; symbol; source: 'buy'|'stock_dividend'; sourceId; acquiredOn; quantityOriginal; quantityRemaining; costPerShare /* informational, rounded */; sellableFrom; status: 'pending'|'sellable' }`.
   - `Holding { symbol; quantity; sellableQuantity; totalCost; averageCost: number|null; realizedPnl; dividendCashNet }`.
   - `Realization { sellTransactionId; symbol; quantity; proceedsNet; costRemoved; realizedPnl }`.
   - `LedgerError`:
     - `{ code: 'OVERSELL'; transactionId; symbol; date; requested; sellable }`
     - `{ code: 'INVALID_INPUT'; id; field; message }`
   - `Result<T> = { ok: true; value: T } | { ok: false; error: LedgerError }`.
   - Rights issue is left out of the union; adding it later is non-breaking.
4. **settings.ts.** Holds `DEFAULT_MARKET_SETTINGS` (`Omit<LedgerSettings,'feeRatePpm'>`; the fee rate is a user setting and has no default). `estimateFees` returns `{fee, tax}`: fee = applyRatePpm(qty·price, feeRatePpm); tax = sell ? applyRatePpm(qty·price, sellTaxRatePpm) : 0. A transaction's entered `fee`/`tax` always wins over the estimate.
5. **build-ledger.ts — the replay (pure; inputs are not mutated).**
   - Validate all inputs: integers, quantity > 0, price/fee/tax ≥ 0, valid dates, ratio > 0. The first failure returns `INVALID_INPUT`.
   - Take events with date ≤ `asOf` and sort them by `(date, kind: corporate action before trade, seq, id)`. A corporate action is dated at its `exDate`, so holdings "before exDate" are entitled, pending lots included.
   - Per symbol, keep state `{ lots[], quantity, totalCost, realizedPnl, dividendCashNet }`.
   - **Buy:** add a lot `lot:<txId>` with `sellableFrom = addTradingDays(tradeDate, settlementDays, holidays)`. `totalCost += qty·price + fee`.
   - **Sell on date D:** sellable = Σ remaining of lots with `sellableFrom ≤ D`. If qty > sellable, return `OVERSELL`.
     - `costRemoved = qty === quantity ? totalCost : mulDiv(totalCost, qty, quantity)`.
     - `proceedsNet = qty·price − fee − tax`; `realized = proceedsNet − costRemoved`.
     - Reduce the sellable lots oldest-first by `(acquiredOn, seq/id)`.
   - **Cash dividend:** entitled = current quantity (all lots).
     - `gross = entitled·amountPerShare`; `withheld = applyRatePpm(gross, withholdingPpm)`; `net = gross − withheld`. `dividendCashNet += net`.
     - `reduceCost`: `totalCost = max(0, totalCost − net)`; any excess is added to `realizedPnl`.
     - `income`: `realizedPnl += net`.
     - No effect if entitled = 0.
   - **Stock dividend:** `newShares = floor(entitled·received / held)` (BigInt).
     - If > 0, add lot `lot:<actionId>` (source `stock_dividend`, costPerShare 0, `sellableFrom = listingDate ?? addTradingDays(exDate, settlementDays)`).
     - `totalCost` is unchanged.
   - **Output:** open lots only (`quantityRemaining > 0`), with status computed against `asOf`.
     - Holdings for every symbol seen. `averageCost = quantity > 0 ? roundDiv(totalCost, quantity) : null`. `sellableQuantity` is as of `asOf`.
     - Realizations in event order.
   - JSDoc on `buildLedger` documents the method (AC3/AC4).
6. **valuation.ts.** `valueHoldings(holdings, prices: Readonly<Record<string, number>>)` returns each holding plus `marketPrice | null`, `marketValue | null`, and `unrealizedPnl = marketValue − totalCost | null`. Estimated exit fee/tax are not subtracted (documented).
7. **index.ts** re-exports the public API.
8. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`.

Rules:
- **R1:** all calculation is in `packages/core`.
- **R2:** integer VND, BigInt intermediates, one rounding module.
- **R5:** settlement days, tax rate, fee rate, withholding rate, holidays and dividend treatment are all settings.
- **R7:** no DB, UI, rights issue or FIFO cost method.
- **R8:** tests listed above.
- R3, R4, R6, R9 and R10 are not touched (no server or market data). R4's spirit is kept: a missing price gives `null`.

## Specialist input used
**finance-investment-researcher**
- Adopted:
  - WAC cost with `totalCost` tracked as the authoritative value, a BigInt `mulDiv`, and full-position sell removing exactly all cost.
  - FIFO lot-quantity consumption for sellability.
  - Entered fee/tax take priority over rates.
  - Rates as integers. **Changed to ppm** instead of bps so fractional-bps broker rates fit.
  - Ex-date entitlement with pending lots included; 5% withholding as config.
  - Stock-dividend zero-cost lot sellable at `listingDate`.
  - Unrealized = null when the price is missing.
  - Event ordering and the extra edge tests.
- Adopted with change:
  - `cashDividendTreatment` setting is adopted, but the **default is `reduceCost`, not `income`**. A planner cannot override CLAUDE.md/spec wording. Flagged to Ming (Flag 2).
- Deferred:
  - Deferred 5% PIT on bonus shares at sale. The user enters it in the sell `tax`; follow-up.
  - Rights issue. Follow-up.

**database-optimizer**
- Adopted:
  - Lots derived in core from a replay, never an input.
  - camelCase types that mirror the DB columns; `'YYYY-MM-DD'` dates; opaque string ids with deterministic lot ids.
  - `seq` tie-break.
  - Discriminated-union corporate actions with `exDate`/`payDate`; `applied` kept out of core.
  - Per-sell realization records; typed `Result` error; injected trading calendar.
- Rejected:
  - **FIFO for cost.** The finance consult's TCBS-matching argument wins, and the setting `costMethod: 'WAC'` keeps FIFO addable later. The two consults agree on FIFO *quantity* consumption, which is adopted.
  - **Stock-dividend shares inherit the parent's `sellableFrom`.** Real bonus shares list weeks later, so `listingDate` is used, with a fallback.
  - **Per-lot `costTotalRemaining` and largest-remainder allocation.** Not needed under WAC; cost is per symbol.
- Passed to the future DB ticket (follow-ups): `bigint` money columns; `ex_date`/`pay_date`/`listing_date`; split `amount_per_share`/`ratio_*`; constraints and indexes.

## Assumptions
- A1. Cost method is WAC including the buy fee, with FIFO lot-quantity consumption (Flag 1).
- A2. Cash dividend default is `reduceCost` (CLAUDE.md/spec), with `income` available (Flag 2). In both modes `dividendCashNet` is reported, and total P&L (realized + unrealized) is identical.
- A3. Cash dividends are applied on `exDate`. `payDate` is carried but has no effect on P&L in this ticket. Input `amountPerShare` is gross VND per share; withholding comes from settings.
- A4. Stock-dividend ratio is an integer pair `{ held, received }` (100:20 → held 100, received 20). Fractions are dropped with no cash.
- A5. Sellability is checked by date only; the intraday session is ignored. A lot is sellable on its `sellableFrom` date.
- A6. Odd lots are not enforced in the ledger (board-lot rounding is a suggestions concern).
- A7. `asOf` excludes events dated after it. A sell is validated against sellability on its own trade date, not on `asOf`.
- A8. Fully sold symbols remain in holdings with quantity 0 and averageCost null, so realized P&L is visible. Lots with 0 remaining are omitted.
- A9. Rounding is half-up (Flag 3). Unrealized P&L excludes the estimated exit fee/tax.
- A10. Rights issues are out of scope (the ticket AC lists only cash and stock dividends).
- A11. Inputs are VND integers already scaled (125.40k → 125400). Parsing and scaling belong to the import/UI tickets.

## Blocking questions
None. The open points (TCBS cost method, cash-dividend treatment, rounding mode, fee rate) are handled as settings with flagged defaults, which the ticket AC explicitly allows.

Follow-ups for the backlog (not in this diff):
- Rights issue support.
- Computing or validating the deferred 5% PIT on bonus shares at sale.
- DB schema notes from the database consult.
- Exchange holiday calendar data source.
- Reconcile against one real TCBS statement and resolve Flags 1–3.

## Split proposal
None. This is one spec feature (ledger → holdings). Estimated ~350 lines of source plus ~400 lines of tests. Tests are most of the size, so this is within one cycle.
