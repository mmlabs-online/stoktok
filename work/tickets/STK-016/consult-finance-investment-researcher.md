# consult-finance-investment-researcher — STK-016

# STK-016 consult: finance-investment-researcher (symbol detail)

## Findings
1. **Price header, already in core.** `buildPriceBoardRow` (`packages/core/src/market/price-board.ts`) gives close, ref, ceiling, floor, change, `changePctPpm`, tone and `status` for one symbol.
   - **Reference** is the previous stored close, used only when it is from the previous trading day. If the last session is an ex-date, has a gap, or has no prior bar, ref, change and limits stay `null` and a flag is set (`exDate`, `gapped`, `noReference`, `exchangeUnknown`, `refOffTick`). Nothing is guessed, which is correct.
   - **Limits:** `priceLimits` applies the per-exchange limit from config (R5) using integer math. It then snaps to the tick table in `DEFAULT_TICK_BANDS`: ceiling rounded down, floor rounded up, tick taken at the raw limit. The tick table is HOSE 10 / 50 / 100 with breaks at 10,000 and 50,000, and HNX and UPCoM 100. This matches exchange practice as I understand it. Both the table and the rounding direction are marked UNVERIFIED in code.
   - **Stale:** ceiling/floor tones fall back to plain up/down colours. `loadWatchlist` (`apps/web/server/watchlist/load-watchlist.ts`) is the pattern to copy: holidays, `expectedPriceDate`, ex-dates from corporate actions, `priceDateDiffers`.
2. **Position and lots, already in core.** `buildLedger` returns:
   - `Holding`: quantity, `sellableQuantity`, `averageCost` (moving weighted-average cost, buy fee included), `realizedPnl`, `dividendCashNet`.
   - `Lot`: `sellableFrom` (T + `settlementDays` trading days; listing date for stock-dividend lots), `status` pending/sellable as of `asOf`, and `costPerShare`. The code says `costPerShare` is "informational, rounded" and is not the cost basis.
   - `valueHoldings` gives **gross** unrealized P&L (market value − total cost), with no estimated sell fee or tax deducted.
   - `buildPortfolio` adds `priceStatus` and `unrealizedPnlPpm`.
3. **Signals.** The `signals` table stores `status`, `label`, `value`, `data_fresh`, `reason_codes` and `inputs_snapshot` (refs with source and fetched_at, params, window, `ma`, `missingDates`).
   - **No read repo exists** (`packages/db/src/repos/signals.ts` only has `upsertSignals`).
   - **No Vietnamese labels exist** for reason codes or rule IDs.
   - `value` units differ by rule: ppm for P/E, P/B and the MA rules; a signed count of quarters for `earnings_growth_trend`.
4. **Chart data.** There is no history read: `getRecentCloses` returns close + volume only (no OHLC) and takes only a row count, not a date range. `listOpenGaps` / `listOpenMarketGaps` exist; market-wide gaps need the second call.
5. **Unknown symbol.** The current page only checks the format with `normalizeSymbol`. Nothing yet defines "unknown".

## Recommendations
- **AC1 (header, R1/R4/R5):** Reuse `buildPriceBoardRow` as is; do not re-derive limits in the UI.
  - Label the header with the session date ("Phiên dd/mm"), since ref/ceiling/floor belong to the session of the last close, not the next one.
  - Show each null-limit flag as a short reason ("Ngày GDKHQ — không tính tham chiếu", "Chưa rõ sàn", "Thiếu phiên trước"). Never show 0 or a blank that looks like a value.
  - Freshness badge from `status`, plus `source` and `fetchedAt`.
- **AC2 (chart, R4):** Add one pure core function, e.g. `buildPriceSeries(bars, fromDate, toDate, holidays, gaps)`.
  - It returns one point per **trading day** (weekends and holidays left out of the axis). Missing days get `close: null` and a `gapId` when a `data_gaps` row covers them; missing days with no recorded gap are marked as unrecorded.
  - Map gap timestamps to VN dates with the existing `vnDayBounds` / `gapOverlaps`.
  - Turn line-connecting off in the chart so nulls stay as breaks. Unit-test it (R8).
  - Range tabs map to trading-day counts or start dates computed in core.
  - New repo: `listCloseHistory(db, symbol, fromDate)` returning OHLCV + source + fetched_at.
- **AC3 (position, R1):** Build the ledger at `vnDateOf(now)` and take this symbol's holding and lots.
  - Building the full ledger (as the dashboard does) keeps numbers identical to the dashboard. One OVERSELL anywhere then blanks the card, so show the ledger error the way the watchlist does.
  - Label unrealized P&L as gross ("chưa trừ phí/thuế bán"). Show realized P&L and dividends received.
  - Price the position with `buildPortfolio` (or `valueHoldings` + `priceStatus`) so a stale price carries its badge.
  - Lots table: acquired date, source (mua / cổ tức CP), remaining quantity, sellable date, status. Show lot cost as "giá mua lô (tham khảo)", or omit it. Do not compute per-lot P&L, since cost basis is per symbol under weighted-average cost.
  - A symbol with quantity 0 but past trades: show "Không còn nắm giữ" plus realized P&L, not an error.
- **AC4 (signals, R4/R9/R10):** New repo `listLatestSignals(db, symbol)`: newest `signal_date` per `rule_id`, horizon medium. Put the visibility decision in core, e.g. `signalVisibility(row, expectedDate, openGaps)`:
  - **Hidden as stale** when `signal_date < expectedPriceDate`. This happens when the worker did not run; such a row can still have `data_fresh = true`, so checking `data_fresh` alone is not enough.
  - **Hidden as stale** when an open price/financials gap (symbol or market-wide) overlaps the stored window (`inputs.window.fromDate..toDate`).
  - **Shown with reasons** when `status = 'suppressed'`. Data reasons read "Dữ liệu cũ/thiếu"; rule reasons read e.g. "Không đủ mã cùng ngành", "EPS ≤ 0".
  - Add a Vietnamese label map for reason codes and rule IDs in `messages-vi`.
  - Format each input with its unit: MA20/MA50 value vs close and distance in %; P/E and sector median with premium in %; growth streak in quarters. Each cited ref shows source and fetched_at.
  - Labels are directions only ("Tích cực / Tiêu cực / Trung tính"), never mua/bán.
  - Show the persistent "Chỉ mang tính tham khảo, không phải khuyến nghị đầu tư" notice (spec §2.3).
- **AC5:** Use `listTransactions(db, { symbol })`, with links to `/transactions?symbol=XXX` (check the query param in `apps/web/lib/transaction-list-query.ts`).
- **AC6:** "Known" = valid format **and** at least one of: a `symbols` row, a watchlist entry, a transaction or corporate action, or a stored price. Otherwise `notFound()`.
  - R6 is waived: no auth code. Keep the loader in `apps/web/server/symbol/` with a `requireUser()` TODO comment, like `load-watchlist.ts`. Use `export const dynamic = 'force-dynamic'`.

## Risks
- **UPCoM reference price.** As I understand it, the UPCoM reference is the previous session's volume-weighted average price, not its close. `buildPriceBoardRow` uses the previous close for every exchange, so UPCoM ref, change, ceiling and floor may be wrong. This is already true on the watchlist. Flag it as a follow-up (R7); the safe interim is to set ref = null for UPCOM or show an "ước tính" mark.
- **Special price-limit cases are not modelled:**
  - First trading day of a new listing, or a stock resuming after 25+ sessions without trading, has wider limits.
  - Very low prices where the ±% band rounds to the reference itself: the exchange widens it to ±1 tick, but core would return ceiling = floor = ref.
  - Leave the current output as is; note it as a follow-up.
- **Ex-dates come only from Ming's own corporate-action entries.** A watched-only symbol's ex-date is unknown, so on that day ref and change are wrong (a false big drop). The chart also shows unadjusted price jumps on ex-dates; the MA signals have the same distortion.
- **Missing holidays look like gaps.** If the configured holiday list is incomplete, holidays appear as missing days and signals get suppressed. Show unrecorded missing days differently from recorded `data_gaps`.
- **Day-level T+2.** VN T+2 shares are usable from the afternoon of T+2. The ledger works by date, so a lot shows as sellable from the morning. Small, but say "từ ngày" rather than implying a specific time.
- **Stale price inflates confidence.** Unrealized P&L on a stale close needs its badge right next to the number, not only in the header.

## Open questions (for Ming / planner)
1. UPCoM reference: accept close-based (labelled as estimated) or hide ref/limits for UPCOM until the feed gives the reference price directly?
2. Unrealized P&L: gross (current core) or net of estimated sell fee + 0.1% tax? A net figure needs a new core function.
3. Chart ranges: which tabs (1T/3T/6T/1N/Tất cả)? Is a close line + volume bars enough for v1, or is OHLC candles wanted?
4. Should an unknown-but-valid symbol (no data at all) give a 404, or a page with an "Thêm vào theo dõi" button?
5. Signals hidden as stale: show the last stored values greyed out with their date, or hide them completely with only the explanation? AC says "hidden"; I recommend fully hidden plus the reason and the last signal date.

Key files: `/home/user/stoktok/packages/core/src/market/price-board.ts`, `/home/user/stoktok/packages/core/src/market/config.ts`, `/home/user/stoktok/packages/core/src/ledger/build-ledger.ts`, `/home/user/stoktok/packages/core/src/portfolio/build-portfolio.ts`, `/home/user/stoktok/packages/core/src/signals/types.ts`, `/home/user/stoktok/packages/core/src/signals/inputs.ts`, `/home/user/stoktok/packages/db/src/repos/{prices-daily,signals,data-gaps}.ts`, `/home/user/stoktok/supabase/migrations/20261026000200_signals.sql`, `/home/user/stoktok/apps/web/server/watchlist/load-watchlist.ts`, `/home/user/stoktok/apps/web/app/(app)/symbols/[symbol]/page.tsx`.
