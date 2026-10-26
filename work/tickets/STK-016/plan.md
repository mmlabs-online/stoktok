Status: READY

# Plan — STK-016: Symbol detail screen (slice 1 of 3: header, position, lots, transactions, not-found)

> **Scope of this plan: AC1, AC3, AC5, AC6.** AC2 (chart) and AC4 (signals) are split into slices 2 and 3; see `## Split proposal`. The whole ticket would be roughly 1,400 changed lines including tests, about three times the size of one implement/review cycle.

## Spec summary
- docs/spec-v1.md §3 F2: "Holdings derived from the ledger (never edited directly): quantity, average cost, market value, unrealized/realized P&L." / "Lot tracking with sellable date (T+2) and status: `pending` / `sellable`."
- §3 F3 (header reuses the watchlist row): "Price, change, volume, last update time, data-freshness badge."
- §2.2: "Every price carries a `fetched_at` timestamp and a source." / "Gaps must be detected, not silently interpolated."
- §2.1: "Daily price limits | HOSE ±7%, HNX ±10%, UPCoM ±15%". These are configuration (R5), already applied by core `priceLimits`.
- CLAUDE.md: R1 (no calculation in UI), R2 (integer VND), R3 (server-only DB access), R4 (source + fetched_at), R6 (suspended: no auth code), R7. Price colors: up green, down red, reference yellow, ceiling purple, floor cyan.

## Acceptance criteria → verification
| # | Criterion (ticket) | How the reviewer verifies it |
|---|---|---|
| 1 | Header: last price, change, reference/ceiling/floor with VN colors and freshness badge. | `load-symbol.test.ts › header comes from buildPriceBoardRow` checks FPT HOSE 125,000 vs prev 120,000 → ref 120,000, ceiling 128,400, floor 111,600, `priceDateDiffers: false`. `› ex-date from a corporate action sets flags.exDate`. `› stale close sets status stale and priceDateDiffers`. `symbol-detail.test.tsx › header renders TC/Trần/Sàn with tone classes, "Phiên dd/mm/yyyy", source and update time` and `› header shows "Dữ liệu cũ" and flag reasons when stale/ex-date`. |
| 3 | Position card (quantity, sellable quantity, average cost, unrealized P&L) and lots table with `pending`/`sellable` status and sellable date; all values from core (R1). | `load-symbol.test.ts` position tests (list below): values equal `buildLedger` + `buildPortfolio` output. `symbol-detail.test.tsx` position/lots render tests. The existing `apps/web/test/no-calc-in-ui.test.ts` stays green. Review: there is no arithmetic in the new `.tsx` files. |
| 5 | Transactions for this symbol, linking to the ledger screen. | `load-symbol.test.ts › transactions are this symbol only, newest first, capped, with ledgerHref "/transactions?symbol=FPT"`. `symbol-detail.test.tsx › transactions section links to /transactions?symbol=FPT`. |
| 6 | Unknown symbol → not-found page; data loaded server-side behind auth (R6). | `load-symbol.test.ts › returns null for a symbol with no symbols row, watchlist entry, transaction, corporate action or price` and `› each single source makes the symbol known`. Page: an invalid format or a `null` view → `notFound()` (code review). "Behind auth" is **waived** (R6 suspended, CLAUDE.md). The loader is server-only with a `requireUser()` TODO comment. The page has `export const dynamic = 'force-dynamic'`. |
| 2 | Chart with gaps | **Not in this slice** → slice 2. |
| 4 | Medium-term signals | **Not in this slice** → slice 3. |

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test` all green (R8).

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `apps/web/server/symbols/load-symbol.ts` | **Create.** `loadSymbol(db, symbol, now): Promise<SymbolView \| null>`: reads stored data and delegates to core. | AC1, AC3, AC5, AC6. Same loader pattern as `load-watchlist.ts` (R1, R3). |
| `apps/web/server/symbols/load-symbol.test.ts` | **Create.** Loader tests with mocked `../db`, same style as `load-watchlist.test.ts`. | R8 |
| `apps/web/app/(app)/symbols/[symbol]/page.tsx` | **Modify.** Keep the normalize/`notFound()` front half. Call `loadSymbol(getDb(), normalized, nowInstant())`; `null` → `notFound()`. Render the header, position, lots and transactions sections. Add `export const dynamic = 'force-dynamic'`. | AC1, 3, 5, 6 |
| `apps/web/components/symbol/symbol-header.tsx` | **Create.** Symbol, exchange label, big `Close`, `PriceChange`, the TC/Trần/Sàn grid via `LimitValue`, volume, "Phiên dd/mm/yyyy", `Status`. | AC1 |
| `apps/web/components/symbol/position-card.tsx` | **Create.** Quantity, sellable quantity, average cost, gross unrealized P&L (+ %), realized P&L, net cash dividends. Handles ledger-error, never-held and no-longer-held states. | AC3 |
| `apps/web/components/symbol/lots-table.tsx` | **Create.** Lots with acquired date, source label, remaining/original quantity, "Bán được từ" date and `LotStatusBadge`. Table on desktop, cards on mobile (same pattern as `holdings-table.tsx`). | AC3 |
| `apps/web/components/symbol/symbol-detail.test.tsx` | **Create.** `renderToStaticMarkup` tests for the three components and the transactions link. | R8 |
| `apps/web/components/watchlist/price-board.tsx` | **Modify:** add `export` to `LimitValue`, `Close`, `Status`. No behaviour change. | Reuse instead of copying (viz consult §Findings) |
| `apps/web/components/portfolio/holdings-table.tsx` | **Modify:** add `export` to `Price` and `Pnl`. No behaviour change. | The P&L tone/glyph and the stale badge next to the price are reused in the position card |

No `packages/core`, `packages/db` or migration changes in this slice. Every read already exists: `listTransactions`, `listCorporateActions`, `getEntrySettings`, `listWatchlist`, `getMarketRules`, `getSymbolExchanges`, `getRecentCloses`.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `load-symbol.test.ts › returns null for a symbol with no symbols row, watchlist entry, transaction, corporate action or price` | AC6 |
| `load-symbol.test.ts › each single source makes the symbol known` (one case each: symbols row only (`getSymbolExchanges` returns `{X: null}`), watchlist only, price only, corporate action only, transaction only) | AC6 |
| `load-symbol.test.ts › header comes from buildPriceBoardRow` (ref/ceiling/floor values above; `getRecentCloses` called with `(db, ['FPT'], 2)`) | AC1 |
| `load-symbol.test.ts › ex-date from a corporate action sets flags.exDate` | AC1 |
| `load-symbol.test.ts › stale close sets status stale and priceDateDiffers` | AC1, R4 |
| `load-symbol.test.ts › UPCOM sets refEstimated` | AC1 (label, see Approach 2) |
| `load-symbol.test.ts › position equals core: quantity, sellableQuantity, averageCost, unrealizedPnl` (buy 300 on 2026-10-01 plus buy 100 on 2026-10-22, now Fri 2026-10-23 13:00Z → quantity 400, sellable 300) | AC3, R1 |
| `load-symbol.test.ts › lots: only this symbol, remaining > 0, pending lot has sellableFrom = T+2 trading days (2026-10-26)` | AC3, T+2 pending edge |
| `load-symbol.test.ts › partial sell reduces lot remaining; multiple lots kept in acquired order` | AC3, partial sells / multiple lots |
| `load-symbol.test.ts › stock dividend lot is listed with source stock_dividend` | AC3, stock dividend |
| `load-symbol.test.ts › cash dividend shows in dividendCashNet` | AC3, cash dividend |
| `load-symbol.test.ts › fully sold → kind 'closed' with realizedPnl, no lots` | AC3 |
| `load-symbol.test.ts › watched-only symbol → position kind 'none'` | AC3 |
| `load-symbol.test.ts › no stored price → unrealizedPnl null, priceStatus missing` | AC3, R4 |
| `load-symbol.test.ts › OVERSELL elsewhere in the ledger → position kind 'ledgerError', header and transactions still returned` | AC3 |
| `load-symbol.test.ts › transactions are this symbol only, newest first, capped, with ledgerHref "/transactions?symbol=FPT"` (and `transactionCount` = total for the symbol) | AC5 |
| `symbol-detail.test.tsx › header renders TC/Trần/Sàn with tone classes, "Phiên dd/mm/yyyy", source and update time` | AC1 |
| `symbol-detail.test.tsx › header shows "Dữ liệu cũ" and flag reasons when stale/ex-date; "—" for null limits` | AC1, R4 |
| `symbol-detail.test.tsx › position card shows labels and the "chưa trừ phí, thuế bán" note; stale price badge sits next to P&L` | AC3 |
| `symbol-detail.test.tsx › closed position shows "Không còn nắm giữ" and realized P&L` | AC3 |
| `symbol-detail.test.tsx › lots table shows "Chưa về (T+2) · bán từ 26/10/2026" for pending and "Được bán" for sellable, plus source labels` | AC3 |
| `symbol-detail.test.tsx › ledger error shows the error message and a link to /transactions` | AC3 |
| `symbol-detail.test.tsx › transactions section links to /transactions?symbol=FPT` | AC5 |
| Existing `apps/web/test/no-calc-in-ui.test.ts`, `watchlist.test.tsx`, `portfolio.test.tsx` stay green | R1, the export-only changes |

## Approach
1. **Loader** `apps/web/server/symbols/load-symbol.ts`. Header comment same as `load-watchlist.ts`: "R6 is suspended: when it is restored, call requireUser() at the top of this entry point."
   - One `Promise.all`: `listTransactions(db)` (all of them, so the ledger is identical to the dashboard), `listCorporateActions(db)`, `getEntrySettings(db)`, `listWatchlist(db)`, `getMarketRules(db)`, `getSymbolExchanges(db, [symbol])`, `getRecentCloses(db, [symbol], 2)`.
   - **Known (AC6):** `symbol in exchanges` OR it is in the watchlist OR it has a transaction OR a corporate action OR at least one stored close. Otherwise return `null`.
   - `expected = expectedPriceDate(now, holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN)`.
   - `header`: `buildPriceBoardRow({... exDates from this symbol's CAs})` plus `priceDateDiffers`, the same as the `WatchRow` built in `load-watchlist.ts` (import the `WatchRow` type from there). `refEstimated: exchange === 'UPCOM'`.
   - `buildLedger(txs, cas, entry.settings, vnDateOf(now))`. If it fails → `{ kind: 'ledgerError', error }`. Otherwise find this symbol's `Holding`:
     - no holding → `{ kind: 'none' }`
     - `quantity === 0` → `{ kind: 'closed', holding }`
     - else → `{ kind: 'open', holding, row, lots, settlementDays }`. `row` = `buildPortfolio({ holdings: [holding], quotes: last close ? { [symbol]: last close } : {}, assets: [], expectedPriceDate: expected, concentrationThresholdPpm: DEFAULT_CONCENTRATION_THRESHOLD_PPM }).rows[0]`. Only `quantity`, `sellableQuantity`, `averageCost`, `marketPrice`, `unrealizedPnl`, `unrealizedPnlPpm`, `priceDate`, `fetchedAt`, `priceStatus` are displayed; weight fields are ignored. `lots` = `ledger.lots` for this symbol with `quantityRemaining > 0`, in ledger order. This is selection only, no arithmetic.
   - `transactions`: this symbol's rows from `txs`, reversed (newest first), sliced to `RECENT_TX_LIMIT = 10`. `transactionCount` = the full count. `ledgerHref = listHref({ page: 1, symbol })` from `apps/web/lib/transaction-list-query.ts`.
   - R1: every number comes from core. The loader only filters, selects and passes values through.
2. **Header** `symbol-header.tsx`:
   - h1 with the symbol (mono) and `EXCHANGE_LABELS[exchange]`, or "Chưa rõ sàn".
   - `Close` (exported from price-board) at a larger size. `PriceChange` when change, pct and tone are all non-null, else "—".
   - A 3-up `LimitValue` grid (TC/Trần/Sàn). Glyph, sr-only label and `TONE_STYLES` colors give VN colors without relying on color alone.
   - "KL" volume. "Phiên {formatDate(tradeDate)}" when `tradeDate` is set.
   - `Status` (exported) for update time + source, the stale/missing badge and the flag reasons (GDKHQ, thiếu phiên trước, chưa có phiên trước, lệch bước giá, chưa rõ sàn).
   - When `refEstimated`: a one-line muted note "Tham chiếu UPCoM: ước tính theo giá đóng cửa phiên trước". The orchestrator allowed a tiny label. The real fix is a follow-up.
3. **Position card** `position-card.tsx`, switching on `kind`:
   - `ledgerError`: "Sổ giao dịch có lỗi, chưa tính được vị thế", the error's symbol/date, and a link to `/transactions`.
   - `none`: EmptyState "Chưa có giao dịch với mã này".
   - `closed`: "Không còn nắm giữ", realized P&L and net cash dividends (`MoneyText`).
   - `open`: a `dl` grid with KL, Khả dụng, Giá vốn TB (`formatPrice`), the exported `Price` (shows the stale badge right next to the value), the exported `Pnl` labelled "Lãi/lỗ tạm tính", a muted note "chưa trừ phí, thuế bán", then Lãi/lỗ đã chốt and Cổ tức tiền (net).
   - Tone for realized P&L uses `changeTone` from core, the same precedent as `holdings-table.tsx`.
4. **Lots table** `lots-table.tsx`: rendered only for `open`.
   - Columns: Ngày mua, Nguồn (`buy` → "Mua", `stock_dividend` → "Cổ tức cổ phiếu"), KL còn / KL gốc, Bán được từ (`formatDate(sellableFrom)`), Trạng thái (`LotStatusBadge` with `settlementDays`).
   - Lot cost is **omitted**: cost basis is per symbol under WAC, and `costPerShare` is "informational, rounded" (finance consult §AC3).
5. **Page.** Section order (mobile single column; desktop two columns: header full width, then position + lots | transactions): header, position, lots, transactions.
   - Transactions use the existing `TransactionList rows filtered={false}`, or a section-level EmptyState "Chưa có giao dịch" when empty.
   - Under the list: "Đang hiển thị {formatQuantity(n)}/{formatQuantity(total)} giao dịch gần nhất" and a link "Xem sổ giao dịch" → `ledgerHref`.
   - All UI labels in Vietnamese.
6. **Rules.** R1: no arithmetic in `.tsx`; the scan test enforces it. R2: integers only, formatted by core. R3: only server code calls `getDb()`. R4: header and price show source/fetchedAt and the stale badge. R5: limits, settlement days and holidays come from settings/config. R6: no auth code. R7: anything else goes to follow-ups.

## Specialist input used
- **finance-investment-researcher**
  - Adopted:
    - reuse `buildPriceBoardRow` as is
    - "Phiên dd/mm" session label
    - flag reasons shown as text, never 0
    - full ledger at `vnDateOf(now)` and showing the ledger error
    - gross unrealized P&L labelled as such
    - realized P&L + dividends
    - stale badge next to the P&L
    - omit per-lot cost and per-lot P&L
    - "Không còn nắm giữ" state
    - "known" definition (AC6)
    - `force-dynamic`
    - "bán từ" wording (no time of day)
  - UPCoM risk: only a one-line "ước tính" label now; the real fix is a follow-up.
  - Special price-limit cases and ex-date unknown for watched-only symbols: follow-ups.
  - Chart and signal recommendations are kept for slices 2 and 3 (see Split proposal).
- **data-visualization-engineer**
  - Adopted:
    - export `LimitValue`/`Close`/`Status` instead of copying
    - loader in `server/symbols/`
    - mobile/desktop layout order (minus chart and signals)
    - `TONE_STYLES` glyph + label
    - hide lots when not held
  - Rejected for now: the watch toggle (not in AC; orchestrator: out of scope).
  - Chart (custom SVG, `?range=`, gap bands, a11y table) and signals presentation are kept for slices 2 and 3.

## Assumptions
- Transactions on this page are capped at the 10 most recent. The full list is one click away on the ledger screen (AC5 says "linking to the ledger screen").
- Corporate actions for the symbol are not listed in the transactions section. AC5 says "transactions"; follow-up if wanted.
- The existing convention of `DataFreshnessBadge` (fresh = "Cập nhật …", stale = "Dữ liệu cũ", missing = "Chưa có dữ liệu") counts as the "freshness badge", the same as the watchlist (STK-011).
- Next.js's default not-found page is acceptable for "not-found page"; no custom `not-found.tsx`.
- `buildPortfolio` is reused with a single holding (weight fields ignored) rather than adding a new core function. This keeps the numbers identical to the dashboard.

### Needs Ming's decision (non-blocking; safe defaults applied)
1. Unrealized P&L is **gross** (current core, same as the dashboard), labelled "chưa trừ phí, thuế bán". A net-of-exit-cost figure needs a new core function.
2. UPCoM reference = previous close, marked "ước tính". Should it be hidden for UPCoM until the feed provides the real reference price (UPCoM uses the previous session's average price)?
3. Before go-live (STK-018): this page shows portfolio data with no auth (R6 suspended).

## Blocking questions
None

## Split proposal
The full ticket is about 1,400 changed lines including tests (≈ 3× the guide) and spans three separable pieces. Proposed slices:

**Slice 1 (this plan):** AC1, AC3, AC5, AC6. Loader, header, position, lots, transactions, not-found. No core or db changes.

**Slice 2: price + volume chart (AC2).** Decisions to carry into its plan, per orchestrator guidance and the consults:
- Our own SVG, no new dependency (stack change = Ming).
- `?range=` URL param (1T/3T/6T/1N), server-rendered links with `aria-current`.
- New core `packages/core/src/market/chart-series.ts` with unit tests:
  - one point per trading day (holidays and weekends excluded via `isTradingDay`)
  - missing day → `close: null`, either with `gapId` (matched to `data_gaps` via `vnDayBounds`/`gapOverlaps`) or marked unrecorded
  - one path segment per contiguous run, **never interpolated** (R4)
  - range → start date
  - volume rects on a zero baseline with a minimum width
  - y ticks; gap bands
  - edge cases: empty, one bar, all gaps, a gap at either end
- New db repo `listCloseHistory(db, symbol, fromDate)` (close, volume, source, fetched_at) with a test.
- Gaps from `listOpenGaps(db, 'prices_daily', [symbol])` + `listOpenMarketGaps(db, 'prices_daily')`.
- The component only maps geometry to `<path>`/`<rect>`/`<text>`, in a `<figure role="img">` with a server-built `aria-label`, plus a `<details>` table fallback. Neutral line color; hatched gap pattern labelled "Thiếu dữ liệu dd/mm–dd/mm".
- Raw (unadjusted) closes, stated in a caption.

**Slice 3: medium-term signals (AC4).** Decisions to carry:
- New db repo `listLatestSignals(db, symbol)`: newest `signal_date` per `rule_id`, horizon `medium`, with a mapper and test.
- New core `signalView`/`signalVisibility(row, expectedPriceDate, openPriceGaps)` with unit tests:
  - **hidden as stale** when `signal_date < expectedPriceDate`, or an open price gap (symbol or market-wide) overlaps `inputs.window.fromDate..signalDate` (no window → `signalDate` only)
  - financials gaps rely on the stored reason codes
  - stale rows are fully hidden, showing the reason + the last signal date
  - `status = 'suppressed'` rows are shown muted with their reasons (data reasons warning style, rule reasons neutral)
- Exhaustive Vietnamese `REASON_LABELS` (`satisfies Record<ReasonCode, string>`) and rule-name labels in core.
- Value formatting per unit: ppm → %; growth streak → quarters.
- Inputs in `<details>` listing each `SnapshotRef` (ref, source, fetchedAt). Direction badges "Tích cực/Tiêu cực/Trung tính", never mua/bán (R9, R10).
- `DisclaimerNote` "Chỉ mang tính tham khảo, không phải khuyến nghị đầu tư" (spec §2.3).
- EmptyState when no signals are stored.

The orchestrator should either create follow-up tickets for slices 2 and 3 (moving AC2 and AC4 there), or re-run STK-016 with a new plan per slice. This PR covers AC1, AC3, AC5 and AC6 only.

### Follow-ups (R7, not in any slice)
- UPCoM reference = previous session's average price, not the close (also affects the watchlist).
- Special price-limit cases: new listing / resumed trading, and the ±1-tick widening at very low prices.
- Ex-dates for watched-only symbols are unknown (false big drop on the ex-date).
- Watch / unwatch toggle on the symbol page.
