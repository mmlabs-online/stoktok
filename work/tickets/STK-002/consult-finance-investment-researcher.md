# STK-002 consult: finance-investment-researcher

**Evidence quality.** I could not find a primary TCBS source for how it computes "giá vốn" or how it handles dividends; web searches returned nothing usable. The points below on TCBS behaviour are prevailing Vietnamese broker practice, not verified TCBS documentation, and are marked [unverified]. Vietnamese tax and settlement points come from secondary sources plus general knowledge. Ming should check them against one real TCBS statement.

## Findings

1. **Lot method.**
   - Vietnamese brokers, TCBS included [unverified], show giá vốn as a moving weighted-average cost that includes the buy fee.
   - A sell does not change the average. Each buy, or a stock dividend, re-averages it.
   - The 0.1% sell tax is charged on gross sale value, not on the gain. So FIFO and average cost give the same tax, and the method only changes how realized P&L is reported.
   - Matching TCBS (spec §1: "P&L matches TCBS statement") therefore points to average cost.
2. **Lots are still needed** for sellability (T+2) and for stock-dividend shares that are not tradable yet. Lot quantity and P&L cost are separate concerns.
3. **Cash dividend (Vietnam).**
   - It is quoted as a % of the 10,000 VND par value. For example, 10% means 1,000 VND per share.
   - 5% personal income tax is withheld at source, so the investor receives 95%.
   - Entitlement is based on holdings on the record date. With T+2, the ex-date is one trading day before the record date, so shares bought before the ex-date count even if their lot is still pending.
   - Cash arrives on the payment date, often weeks later.
   - Broker practice [unverified]: most do **not** lower the displayed giá vốn for cash dividends. The exchange adjusts the reference price on the ex-date instead.
   - **This conflicts with CLAUDE.md and the spec**, which say all corporate actions adjust cost basis.
4. **Stock dividend / bonus shares.**
   - The ratio is quoted like 100:20. New shares = floor(held × ratio); fractional shares are normally cancelled with no cash.
   - Total cost stays the same and quantity goes up, so the average goes down.
   - The new shares become sellable on the **listing date of the additional shares**, usually weeks after the record date. This is not T+2.
   - The 5% income tax on these shares (on par value, 10,000 VND/share) is deferred and withheld **when they are sold**. Sources disagree on the exact formula; the timing at sale was kept per an Oct-2025 Ministry of Finance report.
5. **Fees and tax.** A TCBS statement shows the fee and tax actually charged per order. The spec has the user enter fee and tax per transaction, so the **entered amounts should be the truth**. Rates are only needed to fill in defaults or validate entries. The broker's exact rounding mode is unknown.
6. **T+2.**
   - The count is in **trading days**: weekends and exchange holidays (Tết, Hùng Kings, 30/4, 1/5, 2/9, New Year, plus ad-hoc swapped days) are skipped.
   - Shares arrive on T+2 and can be sold that day; the current rule is from the afternoon session, but I'm not certain of the intraday cut-off.
   - Shorter-cycle settlement has been discussed. Keep the number of days in configuration.
7. **Integer overflow risk (R2).** totalCost (around 1e11 VND) × sell quantity (around 1e6) is about 1e17, which is above JavaScript's safe-integer limit (about 9e15). Proportional cost removal needs BigInt for the multiply-then-divide step.

## Recommendations

- **AC3 (lot method):** Use moving weighted-average cost, documented in the plan and flagged to Ming as [unverified vs TCBS].
  - Per symbol, track `totalCost` (integer VND, including buy fees) and `quantity`. Never store or recompute cost from avg × qty.
  - Buy: `totalCost += qty*price + fee`.
  - Sell of q shares: `costRemoved = q === quantity ? totalCost : roundHalfUp(totalCost*q/quantity)`, computed with BigInt. Selling the whole position removes exactly all remaining cost, so no leftover remains.
  - `avgCost = roundHalfUp(totalCost/quantity)`, for display only.
  - Sells reduce lot quantities **oldest sellable lot first** (FIFO by quantity only). That keeps `lots.quantity_remaining` meaningful. `lots.cost_per_share` is informational under average cost.
  - Optional: make `costMethod: 'WAC'` an explicit setting so FIFO can be added later. Don't build FIFO now (R7).
- **AC2 (P&L definitions):**
  - Realized P&L per sell = `q*price − sellFee − sellTax − costRemoved`.
  - Holding realized P&L = sum of those, **plus net cash dividends if treated as income** (see Open questions). Expose dividends as a separate field, e.g. `realizedTrading` and `dividendIncome`.
  - Unrealized P&L = `quantity*marketPrice − totalCost`, with no estimated exit fee or tax. Document this, and maybe expose `estimatedExitCost` separately later.
  - A symbol missing from the price map gives unrealized = null, not 0 (in the spirit of R4).
- **AC4 (cash dividend):** Inputs: `exDate`, `recordDate`, `paymentDate`, `cashPerShare` (VND), and `withholdingRate` (config, default 5%).
  - Entitled shares = holdings from transactions dated before `exDate`, pending lots included.
  - `gross = shares*cashPerShare`, `tax = roundHalfUp(gross*rate)`, `net = gross − tax`.
  - Default treatment is income (cost unchanged), with a setting `cashDividendTreatment: 'income' | 'reduceCost'`. If `reduceCost`, then `totalCost = max(0, totalCost − net)`.
  - Ming must confirm. This is the "most common source of P&L drift" named in the spec.
- **AC4 (stock dividend):** Inputs: `exDate`, `ratio` as an integer pair (e.g. 100:20, not a float), and `listingDate`.
  - `newShares = floor(entitled*num/den)`, with fractions dropped.
  - Create a new lot with cost 0, `sellableFrom = listingDate` (fall back to configured settlement days if missing), and a `source: 'stock_dividend'` tag.
  - `totalCost` stays the same.
  - The deferred 5% tax on sale is not computed in STK-002. The user enters it in the sell's `tax` field, which matches the statement. Add a follow-up to compute or validate it.
- **AC6 (rounding, R2/R5):**
  - Rates are integers in basis points or parts-per-million (e.g. `sellTaxBps = 10`, fee rate from user settings), never floats.
  - One function in core: `applyRate(amount, rateBps) = roundHalfUp(amount*rateBps/10000)` using integer or BigInt math.
  - Make the rounding mode a single named constant/config. Half-up is the default; it is unverified that TCBS uses it. Reconcile against one statement and switch to floor if needed.
  - Entered fee and tax always override computed values.
- **AC1 and AC5 (T+2 and oversell):**
  - `sellableFrom = addTradingDays(tradeDate, settlementDays, isTradingDay)`. The holiday calendar is an **input** (a set of non-trading dates or a predicate) and is never hard-coded (R5). Weekends are excluded by default.
  - Granularity is the date only: a lot is sellable on the sellableFrom date and the intraday session is ignored.
  - The oversell check for a sell on date D compares against Σ remaining quantity of lots with `sellableFrom ≤ D`. Return a typed error `{ code: 'OVERSELL', symbol, date, requested, sellable }`.
  - A buy on day D can never be sold on day D.
- **Event ordering:** process by date. Within a date: corporate-action entitlement (as of exDate) first, then buys/sells in an explicit `seq` order. Tests should cover same-day buy+sell and a sell exactly on T+2 across a weekend and a holiday.
- **AC7 tests to add beyond the list:** sell everything leaves zero cost (no leftover); overflow-sized numbers; stock-dividend lot not sellable before its listingDate; cash dividend with a pending lot entitled.

## Risks

- **TCBS method mismatch.** If TCBS uses FIFO, or excludes buy fees from giá vốn, displayed avg cost and realized P&L will differ from the statement. Total P&L (realized + unrealized) is the same under both methods, so reconciling on the total is a robust fallback check.
- **Cash-dividend treatment.** If it doesn't match TCBS's display, avg cost drifts by the dividend amount per share each year.
- **Deferred stock-dividend tax.** Ignoring it understates sell tax by 500 VND per bonus share sold. That is acceptable only if the user enters the actual tax.
- **Holiday calendar.** An incomplete calendar mislabels lots as sellable early, which matters for later suggestions (spec: "never suggest selling a lot not yet sellable").
- **Settlement rule changes** (shorter cycles, selling shares still in transit) would break the logic if settlement were hard-coded.

## Open questions for Ming

1. On a TCBS statement or app, does giá vốn change after a sell? It shouldn't under average cost. Does it include the buy fee?
2. After a cash dividend, does TCBS's giá vốn go down? This decides `income` vs `reduceCost`. If income, please confirm overriding the CLAUDE.md line "all adjust cost basis".
3. Ming's TCBS fee rate and whether fees are tiered (spec open item 3). Does the statement round fee/tax down or half-up?
4. Is entered fee/tax always authoritative, with rates used only for defaults? I recommend yes.
5. Rights issues are out of STK-002 scope (the ticket ACs list only cash and stock dividends). Add a follow-up: adds cost = subscribed qty × subscription price, with a new lot sellable at the listing date.

Sources (secondary only; no TCBS primary source found):
- [nhadautu.vn – stock dividend PIT deferred to sale (Oct 2025)](https://nhadautu.vn/bo-de-xuat-nop-thue-ngay-khi-nhan-co-tuc-bang-chung-khoan-d99745.html)
- [nhadautu.vn – stock dividend/bonus share PIT](https://nhadautu.vn/nhan-co-tuc-bang-co-phieu-va-co-phieu-thuong-phai-dong-thue-thu-nhap-ca-nhan-d38458.html)
- [lsvn.vn – PIT on stock dividends](https://lsvn.vn/thu-thue-thu-nhap-ca-nhan-doi-voi-co-tuc-chia-bang-co-phieu-nhung-bat-cap-tren-goc-do-phap-ly-va-thuc-tien1620291982.html)

Ticket: /home/user/stoktok/work/tickets/STK-002/ticket.md