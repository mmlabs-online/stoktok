Status: READY

# Plan — STK-009: Portfolio dashboard and other assets (slice 1 of 2: dashboard)

> **Scope of this plan:** slice 1 only (see `## Split proposal`). It covers AC1, AC2, AC3, AC5 and AC6 in full, and the **net-worth part** of AC4: assets are read and summed. Asset **CRUD** (list/add/edit/delete pages and server actions) is slice 2, to be a new ticket. The reviewer judges AC4 only on the net-worth formula and the read path.

## Spec summary
`docs/spec-v1.md` §3 F2 Portfolio & assets:
> - Holdings derived from the ledger (never edited directly): quantity, average cost, market value, unrealized/realized P&L.
> - Lot tracking with sellable date (T+2) and status: `pending` / `sellable`.
> - Cash balance and other assets entered manually; total net worth view.
> - Concentration view: weight of each holding; warning above a user-set threshold.

§5: `assets | id, type (cash/other), name, value, as_of`; `settings | fee_rate, tax_rate, concentration_threshold, rule configs`; "Holdings and P&L are **derived** from `transactions` + `corporate_actions` + `lots`, never stored as editable balances."

CLAUDE.md R1 (no calculation in UI), R2 (integer VND), R4 (every market-data record carries `source`/`fetched_at`; stale data never silently treated as current), R5 (market rules and thresholds are configuration). R6 is suspended, so the "behind auth (R6)" part of AC4 is waived. Add no auth code.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Holdings table from core: quantity, sellable quantity, average cost, last close, market value, unrealized P&L (VND and %), weight; realized P&L total. | `portfolio.test.tsx › holdings row renders all columns`. The `buildPortfolio` tests check row fields and `totals.realizedPnl`. The `/` page shows the table on desktop and cards on mobile. |
| 2 | Market value, weights and net worth are computed in `packages/core` from ledger + latest `prices_daily` + assets (R1), with unit tests. | `packages/core/src/portfolio/build-portfolio.test.ts` (all cases below). `apps/web/test/no-calc-in-ui.test.ts` stays green. Inspection: components only call `format*` and read fields. |
| 3 | Holdings above the configured concentration threshold (R5) show a warning. | Core tests `concentration › …` cover the boundary, the exact comparison, a single holding and the NULL → default fallback. `portfolio.test.tsx › over-threshold row shows warning text` and `› concentration banner lists symbols`. `settings.test.ts › getConcentrationThreshold …`. |
| 4 | (slice 1 part) net worth = holdings market value + cash + other assets. | Core tests `net worth › …`. `load-dashboard.test.ts › passes assets into portfolio`. CRUD is deferred to slice 2. |
| 5 | Each price shows its date; stale or missing prices are flagged with DataFreshnessBadge and never silently treated as current (R4). | Core tests `price status › fresh/stale/missing` and `expectedPriceDate › …`. `portfolio.test.tsx › stale row shows "Dữ liệu cũ" and price date`, `› missing-price row shows "—" and "Chưa có dữ liệu"`, `› summary shows incomplete note`. With an empty `prices_daily`, the page shows no 0 ₫ market value and no −100% P&L (`load-dashboard.test.ts › empty prices_daily`). |
| 6 | Empty state when there are no transactions. | `portfolio.test.tsx › empty state links to /transactions/new`. `load-dashboard.test.ts › no transactions → hasTransactions false`. |
| — | No 500 when the fee rate or threshold is unset, or when the ledger is invalid (orchestrator constraint). | `load-dashboard.test.ts › fee rate NULL → feeRateConfigured false, still ok`, `› settings row missing → defaults`, `› ledger OVERSELL → kind 'ledgerError'`. |
| — | Checks (R8) | `pnpm typecheck && pnpm lint && pnpm test` are green. `pnpm build` succeeds, which also proves the page does not query the DB at build time (`force-dynamic`). |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/calendar.ts` | Add `previousTradingDay(date, holidays)` (strictly before; skips weekends and holidays) and `vnMinutesOf(instant)` (minutes since 00:00 VN time, `Intl` with `hourCycle: 'h23'`). | Needed by `expectedPriceDate` (AC5). |
| `packages/core/src/calendar.test.ts` | Tests for the two helpers. | R8 |
| `packages/core/src/portfolio/config.ts` | `DEFAULT_CONCENTRATION_THRESHOLD_PPM = 200_000` and `DEFAULT_PRICE_CUTOFF_MINUTES_VN = 18 * 60`, plus `resolveConcentrationThreshold(ppm: number \| null): number`. | R5: defaults live in config in one place, as `DEFAULT_MARKET_SETTINGS` does. |
| `packages/core/src/portfolio/freshness.ts` | `expectedPriceDate(now, holidays, cutoffMinutesVn)` and `priceStatus(quote \| undefined, expectedDate): 'fresh' \| 'stale' \| 'missing'`. | AC5 / R4 |
| `packages/core/src/portfolio/build-portfolio.ts` | `PriceQuote`, `PortfolioRow`, `PortfolioTotals` and `Portfolio` types, plus `buildPortfolio(input)`. Reuses `valueHoldings`. | AC1–AC5 (R1, R2) |
| `packages/core/src/portfolio/freshness.test.ts` | Tests for `expectedPriceDate` and `priceStatus`. | R8 |
| `packages/core/src/portfolio/build-portfolio.test.ts` | Valuation, weight, concentration, totals and net-worth tests. | R8, AC2 |
| `packages/core/src/index.ts` | Export the new functions, constants and types. | Consumers import from `@stoktok/core`. |
| `packages/db/src/repos/prices-daily.ts` | `getLatestCloses(db, symbols): Promise<Record<string, PriceQuote>>`. Runs one query per symbol: `select('symbol,trade_date,close,source,fetched_at').eq('symbol', s).order('trade_date', {ascending:false}).limit(1).maybeSingle()`, in parallel. Empty input means no queries. | There is no prices repo yet (consult finding 2). |
| `packages/db/src/rows.ts` | Add `PriceDailyRow` (selected columns only). | Row typing |
| `packages/db/src/mappers.ts` | Add `priceQuoteFromRow`: `toSafeInt(close)` with close ≥ 0, a date check on `trade_date`, and a non-empty `source`/`fetched_at` (R4). | R2, R4 |
| `packages/db/src/repos/prices-daily.test.ts` | Tests with `test/fake-client`. | R8 |
| `packages/db/src/repos/settings.ts` | Add `getConcentrationThreshold(db): Promise<number \| null>`. It selects only `concentration_threshold_ppm` and returns null when the row is missing. Leave `COLS`, `SettingsRow` and `settingsToRow` unchanged so `saveSettings` cannot overwrite the column. | AC3 (consult finding 3) |
| `packages/db/src/repos/settings.test.ts` | Tests for `getConcentrationThreshold`. | R8 |
| `packages/db/src/index.ts` | Export `getLatestCloses` and `getConcentrationThreshold`. | Public API |
| `apps/web/server/clock.ts` | Add `nowInstant(): Date`. | `new Date(` is banned in `app/`; the server clock lives here. |
| `apps/web/server/dashboard/load-dashboard.ts` | `loadDashboard(db, now)`. Calls `listTransactions`, `listCorporateActions`, `getEntrySettings`, `listAssets` and `getConcentrationThreshold`, then `buildLedger` (asOf = `vnDateOf(now)`), then `getLatestCloses` (symbols with qty > 0), then `buildPortfolio`. Returns a discriminated union (see Approach). | Server-only data access (R3) with an entry point ready for `requireUser()`. Avoids `loadLedger` → `getSettings` NOT_CONFIGURED (consult finding 5). |
| `apps/web/server/dashboard/load-dashboard.test.ts` | Loader tests that mock `../db`, as in `transactions/handlers.test.ts`. | No-500 guarantees, AC6 |
| `apps/web/components/portfolio/portfolio-summary.tsx` | Stat cards and the notes for incomplete data, stale prices and an unset fee rate. | AC1, AC4, AC5 |
| `apps/web/components/portfolio/holdings-table.tsx` | `md:table` plus `md:hidden` cards, the weight bar, per-row concentration warning and freshness badge, and the summary `role="status"` banner. | AC1, AC3, AC5 |
| `apps/web/components/portfolio/portfolio.test.tsx` | Render tests. | Verification of AC1/3/5/6 |
| `apps/web/app/(app)/page.tsx` | Replace the placeholder with the dashboard server component. Add `export const dynamic = 'force-dynamic'`. | AC1–AC6 |

No migration and no new dependency (no chart library).

## Tests to write
| Test (file › name) | Covers |
|---|---|
| calendar.test.ts › previousTradingDay: Tue→Mon, Mon→Fri, Sat/Sun→Fri, skips consecutive holidays (Tết block) | helper |
| calendar.test.ts › vnMinutesOf: 2026-10-23T10:59Z → 1079, 2026-10-23T11:00Z → 1080, 23:30Z rolls to the next VN day's 06:30 | helper, UTC/VN boundary |
| freshness.test.ts › expectedPriceDate: weekday before cutoff → previous trading day; weekday at/after cutoff → today; Saturday and Sunday → Friday; Monday before cutoff → Friday; holiday today after cutoff → previous trading day; day after a holiday before cutoff skips the holiday; 2026-10-23T23:30Z (VN Saturday 06:30) → Friday 2026-10-23 | AC5 stale definition |
| freshness.test.ts › priceStatus: undefined → missing; tradeDate < expected → stale; = expected → fresh; > expected → fresh | AC5 |
| build-portfolio.test.ts › valuation: MV = qty × close exact for values with intermediates > 2^53; unrealized = MV − totalCost (not avgCost × qty); P&L % negative rounds half away from zero; totalCost 0 → `unrealizedPnlPpm` null | AC1, AC2, R2 |
| build-portfolio.test.ts › rows: qty-0 symbols excluded from rows; sellableQuantity passed through (pending T+2 lot → sellable < quantity); sorted by MV desc, unpriced last by symbol | AC1 |
| build-portfolio.test.ts › weights: denominator = Σ MV of priced holdings; unpriced → `weightPpm` null and excluded from the denominator; raw MVs sum to the denominator; denominator 0 (all prices missing, or all closes 0) → all weights null, no throw; `weightBarPct` in 0..100 | AC1, AC2 |
| build-portfolio.test.ts › concentration: just below → false; exactly equal → false; just above → true; rounded `weightPpm` equals the threshold but exact MV×1e6 > threshold×denom → true; single holding → true; `resolveConcentrationThreshold(null)` → 200 000; explicit 300 000 is honoured; 1 000 000 → never warns; unpriced row → false; `totals.overConcentrated` lists the symbols | AC3, R5 |
| build-portfolio.test.ts › realized: `totals.realizedPnl` sums all holdings including qty-0 ones; `dividendCashNet` is reported separately and is in neither realized P&L nor net worth | AC1 |
| build-portfolio.test.ts › net worth: all priced; one missing (excluded, `missingCount` 1, `complete` false); stale included in MV with `staleCount` 1; all missing (`holdingsMarketValue` 0, `pricedCount` 0, `complete` false, netWorth = cash + other); no assets; several cash rows summed; cash and other split | AC4, AC5 |
| build-portfolio.test.ts › totals unrealized %: Σunrealized / Σcost over priced rows only (not the mean of row %); Σcost 0 → null | AC1 |
| build-portfolio.test.ts › empty ledger → rows [], zeros, `complete` true | AC6 |
| prices-daily.test.ts › getLatestCloses: one query per symbol with eq/order desc/limit 1; maps to PriceQuote; symbol without row omitted; [] → no query; DB error → DataError; negative or non-integer close → MAPPING | data layer |
| settings.test.ts › getConcentrationThreshold: returns value; NULL → null; no row → null; selects only `concentration_threshold_ppm` | AC3 |
| load-dashboard.test.ts › fee rate NULL → ok with `feeRateConfigured` false; settings row missing → ok; threshold NULL → `thresholdPpm` 200 000; empty prices_daily → all rows missing, no MV 0 on rows; ledger OVERSELL → `{kind:'ledgerError'}`; no transactions → `hasTransactions` false; only qty>0 symbols are passed to `getLatestCloses`; assets passed into totals | no-500, AC4, AC6 |
| portfolio.test.tsx › holdings row renders all columns (KL, khả dụng, giá vốn TB, giá + date, giá trị, lãi/lỗ VND and %, tỷ trọng) | AC1 |
| portfolio.test.tsx › over-threshold row shows "Vượt ngưỡng 20,00%"; concentration banner lists symbols | AC3 |
| portfolio.test.tsx › stale row shows "Dữ liệu cũ" and "giá dd/mm/yyyy"; missing row shows "—" for MV/P&L/weight and "Chưa có dữ liệu", never "0 ₫" | AC5 |
| portfolio.test.tsx › summary shows "Chưa tính N mã chưa có giá" and "Gồm N giá cũ"; partial-weights note; fee-rate banner when `feeRateConfigured` false | AC4, AC5 |
| portfolio.test.tsx › weight bar inline width equals `weightBarPct` | AC1 |
| portfolio.test.tsx › empty state: "Chưa có giao dịch" with link to `/transactions/new`; all-closed state shows realized total and "Không còn mã nào đang nắm giữ" | AC6 |

## Approach
1. **Calendar (core).** Add `previousTradingDay` and `vnMinutesOf` next to `addTradingDays` and `vnDateOf`. Core reads no clock; `now` is always passed in.
2. **Config (core, R5).** Put `DEFAULT_CONCENTRATION_THRESHOLD_PPM` and `DEFAULT_PRICE_CUTOFF_MINUTES_VN` in `portfolio/config.ts`. `resolveConcentrationThreshold(null)` returns the default; any 0..1e6 value is used as stored.
3. **Freshness (core, R4).** `expectedPriceDate(now, holidays, cutoff)` works like this: `d = vnDateOf(now)`. If `isTradingDay(d)` and `vnMinutesOf(now) >= cutoff`, it returns `d`; otherwise it returns `previousTradingDay(d)`. `priceStatus` gives missing for no quote, stale for `tradeDate < expected`, and fresh otherwise.
4. **buildPortfolio (core, R1/R2).**
   - Input: `{ holdings, quotes: Record<string, PriceQuote>, assets: {type, value}[], expectedPriceDate, concentrationThresholdPpm }`. `PriceQuote = { symbol, close, tradeDate, source, fetchedAt }`.
   - Call `valueHoldings` with a `{symbol: close}` map built from `quotes`; do not duplicate its logic.
   - Rows: qty > 0 only. Each row is a `ValuedHolding` plus `priceDate | null`, `fetchedAt | null`, `priceStatus`, `unrealizedPnlPpm | null` (`roundDiv(unrealized×1e6, totalCost)`, null if cost 0), `weightPpm | null`, `weightBarPct | null` (integer 0..100 via `roundDiv(weightPpm, 10_000)`) and `overConcentration: boolean`.
   - Denominator = Σ MV of priced rows (fresh and stale). Concentration uses the exact BigInt comparison `mv × 1e6 > threshold × denom`, and only when denom > 0.
   - Totals: `holdingsMarketValue`, `holdingsCostPriced`, `unrealizedPnl`, `unrealizedPnlPpm | null`, `realizedPnl` (all holdings, including qty 0), `dividendCashNet`, `cash`, `otherAssets`, `assetCount`, `netWorth = holdingsMarketValue + cash + otherAssets`, `pricedCount`, `missingCount`, `staleCount`, `complete` (= `missingCount === 0`), `thresholdPpm` and `overConcentrated: string[]`.
   - All sums use `addVnd` and BigInt.
5. **DB.**
   - Add `getLatestCloses` and `priceQuoteFromRow`. The local date regex follows the existing `assetFromRow` pattern.
   - Add `getConcentrationThreshold` as a separate select so the ledger settings path stays unchanged.
   - Export both from the index.
6. **Loader (`apps/web/server/dashboard/load-dashboard.ts`).** Returns one of:
   - `{ kind: 'ledgerError', error: LedgerError }` when `buildLedger` returns `ok: false`. Nothing is thrown, so there is no 500 for a bad ledger.
   - `{ kind: 'ok', portfolio, hasTransactions, feeRateConfigured, expectedPriceDate, assets }` otherwise.

   It uses `getEntrySettings`, never `getSettings`/`loadLedger`, so a NULL fee rate cannot throw. Holidays come from `settings.holidays`, and the cutoff is `DEFAULT_PRICE_CUTOFF_MINUTES_VN`. A `DataError` from the DB itself propagates to Next's error boundary, which matches existing pages.
7. **UI (R1).**
   - **`page.tsx`:** `force-dynamic`, then `loadDashboard(getDb(), nowInstant())`, then render. On `ledgerError` it shows an `EmptyState`-style error: "Sổ giao dịch có lỗi, không tính được danh mục", with a link to `/transactions`.
   - **Summary:** cards in `grid-cols-2 lg:grid-cols-4`. Tổng tài sản is `col-span-2` on mobile. The others are Giá trị cổ phiếu, Tiền mặt + tài sản khác, Lãi/lỗ chưa chốt (VND, with % as sub, tone and glyph via `changeTone`/`TONE_STYLES`) and Lãi/lỗ đã chốt. "Cổ tức nhận (ròng)" is a sub line on the realized card.
   - **Notes under the summary:**
     - "Chưa tính N mã chưa có giá" when `missingCount > 0`.
     - "Gồm N mã dùng giá cũ" when `staleCount > 0`.
     - "Tỷ trọng chỉ tính trên mã có giá" when the data is not complete.
     - A fee banner when `!feeRateConfigured`: "Chưa cài tỷ lệ phí giao dịch — giao dịch không nhập phí được tính phí 0 ₫, giá vốn có thể thấp hơn thực tế."
     - "Lãi/lỗ chưa chốt chưa trừ phí và thuế bán."
   - **Holdings:** the per-row price cell shows `formatPrice(close)`, "giá {formatDate(priceDate)}" and `<DataFreshnessBadge fresh={status==='fresh' ? true : status==='stale' ? false : null} updatedAt={fetchedAt} hideWhenFresh />`. Missing values render through `MoneyText` null → "—". The weight shows the number plus a 4px bar on a shared 0–100 scale, with inline width `${row.weightBarPct}%`. The warning is the AlertTriangle icon plus the text "Vượt ngưỡng {formatPercent(thresholdPpm)}". The summary `role="status"` banner lists the over-concentrated symbols.
   - **Empty states:** no transactions → `EmptyState` "Chưa có giao dịch", with the action "Thêm giao dịch đầu tiên" linking to `/transactions/new`. The summary cards still render, so cash and other assets show. Transactions exist but no open position → "Không còn mã nào đang nắm giữ". `DisclaimerNote` goes at the bottom.
   - Components only format and read fields. They never use arithmetic, comparisons against the threshold, or the clock, which `no-calc-in-ui.test.ts` enforces.
8. **Rules.**
   - R1: all numbers come from core.
   - R2: integers and BigInt.
   - R3: data access through `server/db` only, with no client components touching data.
   - R4: date, badge and incomplete/stale notes. Missing prices are never valued at cost or 0.
   - R5: threshold and cutoff come from config/settings.
   - R6: waived. Add a comment in the loader saying `requireUser()` goes here when R6 is restored.
   - R7: no donut, today's change, sorting, signals or nav changes.
   - R8: tests listed above.

## Specialist input used
- **finance-investment-researcher**
  - Adopted:
    - The core API shape (`buildPortfolio`, `expectedPriceDate`, `PriceQuote`).
    - Exact MV/P&L math and P&L % null at cost 0.
    - Total % computed over priced holdings only.
    - Weight denominator = priced stock MV, with a partial flag.
    - 20% default threshold, strictly-greater exact BigInt comparison.
    - Realized P&L over all symbols; `dividendCashNet` kept separate.
    - Net worth excludes unpriced holdings; stale prices are included but flagged.
    - 18:00 VN cutoff with a previous-trading-day helper.
    - Per-symbol latest-close queries.
    - The banner option for an unset fee rate.
  - Adapted: the threshold is read through a separate `getConcentrationThreshold` instead of extending `COLS`/`SettingsRow`, so `saveSettings` (which upserts `settingsToRow`) can't null it.
  - Deferred:
    - `data_gaps`-based staleness (STK-005 has not landed).
    - "Net if sold" P&L (not in AC).
    - The price-unit sanity assertion. R2 already states integer VND, and a heuristic threshold would reject legitimate low prices; this is recorded as a follow-up for STK-005.
- **data-visualization-engineer**
  - Adopted:
    - The stat-card grid and order, with "Biến động hôm nay" dropped.
    - Dual render as table plus cards.
    - The number plus thin CSS bar on a shared 0–100 scale, with no chart or donut.
    - Per-row warning text plus a summary status banner.
    - Price date plus badge, with "—" for missing values.
    - The incomplete note on net worth.
    - The empty state with a link.
    - The no-calc guard and render tests.
  - Deferred to slice 2: the assets routes, form, handlers and tests (recs 7, 12), and the `/assets` link from the cash card.
  - Rejected for now: the stacked allocation bar (optional, grows the diff, not in AC). No `contrast.test.ts` change, because the bar reuses the existing `warn` and `accent` tokens and no new token is added.

## Assumptions
1. **Weight denominator:** the total market value of priced stock holdings (fresh plus stale), not net worth. It is labelled "Tỷ trọng (danh mục CP)". Unpriced holdings get no weight, and the weights are flagged as partial.
2. **Concentration threshold:** stored and compared in ppm. NULL (or no settings row) falls back to `DEFAULT_CONCENTRATION_THRESHOLD_PPM = 200_000` (20%). A stored 0..1 000 000 is used as-is, and "exceeds" means strictly greater; to effectively disable it, set 1 000 000. STK-010 will expose the setting.
3. **Stale definition:** expected price date = today (VN) if it is a trading day and VN time ≥ 18:00 (`DEFAULT_PRICE_CUTOFF_MINUTES_VN`), otherwise the previous trading day (skipping weekends and `settings.holidays`). A price is stale if `trade_date < expected`. An empty holidays list makes holidays show stale, which fails safe. The cutoff should be revisited when STK-005 fixes the sync time; it becomes a `rule_configs` entry in STK-010.
4. **Stale prices count in totals and net worth**, flagged in the row and in the summary ("Gồm N mã dùng giá cũ"). **Missing prices are excluded** from MV, P&L totals, weights and net worth, never valued at cost or 0, and flagged ("Chưa tính N mã chưa có giá").
5. **Asset semantics:** each `assets` row is one account's current balance (`as_of` = date of that balance), and net worth sums all rows. `cash` covers bank and brokerage cash; gold, deposits, bonds and funds go under `other`, distinguished by name. There are no subtypes and no liabilities in v1, so margin debt cannot be entered and net worth is overstated for margin users. That is a follow-up.
6. **Fee rate NULL:** the dashboard uses `getEntrySettings` (fee 0 for transactions without an entered fee) and shows a non-blocking banner. In practice STK-008 forces a manual fee when the rate is unset, so the impact is limited to fee-less rows.
7. **Realized P&L** is all-time ("Lãi/lỗ đã chốt"), not YTD. Unrealized P&L is gross (no exit fee or sell tax), and the page says so.
8. **Ledger replay errors** (OVERSELL / INVALID_INPUT) render an error state with a link to `/transactions` instead of a 500. DB connectivity errors still go to the Next error boundary, as on other pages.
9. **Holdings sort:** market value descending, unpriced last by symbol. No sortable headers.
10. **Price date display:** `formatDate(tradeDate)` under every price, and the badge `updatedAt` = `fetched_at`.
11. **No nav item for assets** in slice 1. Slice 2 links `/assets` from the dashboard cash card.
12. **No previous close and no "today's change"**, because they are outside the AC.

## Blocking questions
None.

## Split proposal
The whole ticket comes to roughly 1,700 changed lines including tests (core + db + dashboard ≈ 1,100, assets CRUD ≈ 600). That is well over one implement/review cycle.

- **Slice 1, this plan, stays STK-009:** core portfolio, freshness and calendar; the prices_daily and threshold reads; the dashboard loader and page. It covers AC1, AC2, AC3, AC5 and AC6, plus the net-worth formula and assets read path of AC4. It is still above the ~400-line guide, mostly because of tests; the production code is about 500 lines.
- **Slice 2, a new ticket ("Cash and other assets: list/add/edit/delete"):**
  - Routes and pages: `/assets`, `/assets/new`, `/assets/[id]/edit`, `/assets/[id]/delete`.
  - Server actions: `app/(app)/assets/actions.ts`, delegating to `apps/web/server/assets/handlers.ts` with handler tests.
  - Core: `validateAssetInput` (name required, type cash/other, value via `parseIntegerInput` 0..MAX_SAFE_INTEGER, as_of valid and not in the future), plus new message codes (e.g. `ASSET_TYPE_INVALID`, `ASSET_NOT_FOUND`).
  - DB: `getAsset(db, id)` in the assets repo.
  - UI: full-page forms with onSubmit+startTransition, an `isUuid` guard, the delete confirm page, and a link from the dashboard cash card.
  - The rest of AC4 ("list, add, edit, delete via server actions") moves there.

The orchestrator should create the slice 2 ticket and narrow STK-009 AC4 accordingly.

**Follow-ups (not in either slice):** a liabilities/margin asset type; `data_gaps`-aware staleness once STK-005 lands; a price-unit sanity check in the STK-005 adapter; "net if sold" P&L; the allocation bar; a portfolio-value history chart (needs snapshots).
