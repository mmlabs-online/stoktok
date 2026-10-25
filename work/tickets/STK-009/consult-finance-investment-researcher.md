# consult-finance-investment-researcher — STK-009

## Findings
1. **Core already has most of the pieces.** `buildLedger` (`packages/core/src/ledger/build-ledger.ts`) returns per-symbol `Holding` records with `quantity`, `sellableQuantity`, `totalCost`, `averageCost` (rounded, or null when qty=0), `realizedPnl` and `dividendCashNet`. Closed positions stay in the list with qty 0, so their realized P&L is kept. `valueHoldings` (`packages/core/src/ledger/valuation.ts`) takes `Record<string, number>` prices and returns `marketPrice/marketValue/unrealizedPnl`, or null when a price is missing. It does not carry the price date or freshness, and has no %, weights, totals or net worth. `money.ts` has `mulDiv`, `roundDiv` (half away from zero, BigInt), `addVnd` and `PPM`. `formatPercent` takes ppm. `calendar.ts` has `isTradingDay`, `addTradingDays` (forward only) and `vnDateOf`. There is **no previous-trading-day helper**.
2. **There is no prices_daily repo.** `packages/db/src/index.ts` exports transactions, corporate actions, settings, assets and watchlist only. `prices_daily` has `(symbol, trade_date)` as PK, an integer `close`, and `source`/`fetched_at` NOT NULL, so R4 is met at the schema level. STK-005 is BACKLOG, so in practice the table is empty.
3. **The concentration threshold is not wired up.** `settings.concentration_threshold_ppm` is a nullable integer (0..1e6) with no default. The settings repo `COLS`, `SettingsRow` and `settingsFromRow` don't read it, and the comment says it is "managed elsewhere". STK-010 (Settings screen) is BACKLOG.
4. **Assets.** `type in ('cash','other')`, `value bigint >= 0`, `as_of date`. There is no subtype and no liabilities. The repo has list/create/update/delete. The index `(type, as_of desc)` hints at snapshot history, but nothing defines whether rows are snapshots or one row per account.
5. **The dashboard will hard-fail with no fee rate.** `loadLedger` calls `getSettings`, which throws `NOT_CONFIGURED` when `fee_rate_ppm` is NULL. The column has no default and there is no Settings UI yet. STK-008 avoided this with `getEntrySettings`.
6. **`DataFreshnessBadge`** (`apps/web/components/data-freshness-badge.tsx`) is presentational. It takes `fresh: true|false|null` (null shows "Chưa có dữ liệu") plus `updatedAt`, so core must decide freshness.

## Recommendations
Proposed core API, in a new `packages/core/src/portfolio/` (AC2, R1):
```ts
interface PriceQuote { symbol: string; close: number; tradeDate: string; source: string; fetchedAt: string }
expectedPriceDate(now: Date, holidays: readonly string[], cutoffMinutesVn: number): string
buildPortfolio({ holdings, quotes: Record<string, PriceQuote>, assets: {type:'cash'|'other'; value:number}[],
                 expectedPriceDate, concentrationThresholdPpm }) → { rows, totals }
```
Each row is a `ValuedHolding` plus `priceDate`, `priceStatus: 'fresh'|'stale'|'missing'`, `unrealizedPnlPpm|null`, `weightPpm|null` and `overConcentration`. Totals are `holdingsMarketValue`, `holdingsCostPriced`, `unrealizedPnl`, `unrealizedPnlPpm|null`, `realizedPnl`, `dividendCashNet`, `cash`, `otherAssets`, `netWorth`, `missingCount`, `staleCount`, `complete`. Reuse `valueHoldings` inside it rather than duplicating it.

**Valuation math (integer VND, R2):**
- Market value = `qty × close`, which is exact, so no rounding is needed (`mulDiv(q, p, 1)`, as now).
- Unrealized P&L (VND) = `marketValue − totalCost`, which is also exact. Never use `averageCost × qty`, because `averageCost` is rounded.
- Unrealized % (ppm) = `roundDiv(unrealized × 1e6, totalCost)`. Return **null when `totalCost === 0`**. This happens when a position came only from stock dividends or when `reduceCost` dividends drove cost to 0.
- Total unrealized % = Σunrealized / Σcost over **priced holdings only**. It must not be an average of the row %s.
- Label unrealized P&L as gross (before exit fee and 0.1% sell tax), as the core comment already says. An optional "net if sold" via `estimateFees` is out of scope unless the plan wants it.
- Use one rounding rule everywhere: half away from zero via `roundDiv`. Do not force rounded weights to sum to 100%, and never display a "total weight" built from rounded row weights.

**Weights (AC1, AC3):**
- Denominator = total market value of **priced stock holdings**, not net worth. This is the standard portfolio-weight convention. F6 also treats "cash" and "weights" as separate inputs, and diluting by cash would hide concentration. Show stocks/cash/other as a share of net worth separately at the totals level, if wanted.
- Holdings with no price get `weightPpm = null`.
- When any holding has no price, mark weights "partial" (`totals.complete = false`), because the other weights are then overstated.

**Concentration warning (AC3, R5):**
- Store and compare in **ppm**, consistent with the existing settings columns.
- Default `DEFAULT_CONCENTRATION_THRESHOLD_PPM = 200_000` (20%), as a core config constant used when the column is NULL. 20–25% single-name is a common cap for concentrated personal portfolios.
- "Exceeds" means strictly greater. Compare exactly with BigInt cross-multiplication, `mv × 1e6 > threshold × denom`, not on the rounded `weightPpm`, so boundary cases don't flip on rounding.
- Add `concentration_threshold_ppm` to the settings repo read path; this is a minimal db change.
- A single holding is 100% and will warn. That is acceptable, but test it.

**Realized P&L (AC1):** total realized = Σ `holding.realizedPnl` over **all** symbols, including qty-0 rows. Hide qty-0 rows from the holdings table. Show `dividendCashNet` as a separate line ("Cổ tức nhận (ròng)"). Never add it to realized P&L, because under `reduceCost` it is already in cost. Never add it to net worth either.

**Net worth (AC4):**
- Net worth = Σ market value of priced holdings + Σ cash + Σ other.
- Don't add realized P&L or dividends. Ming's entered cash already reflects them, so adding them double-counts.
- Unpriced holdings are **excluded**, never valued at cost, because cost silently treated as current violates R4. Flag with "chưa tính N mã chưa có giá".
- Treat each asset row as one account's current balance and sum all rows (see open questions). Gold, term deposits, bonds and fund certificates go under `other`, distinguished by `name`. Show `as_of` per asset.

**Stale and missing prices (AC5, R4):**
- **Missing** (no row): value, P&L and weight are null; badge `fresh=null`; the row is excluded from totals and counted in `missingCount`.
- **Stale** (present but `tradeDate < expectedPriceDate`): use the last close in market value, totals and weights, but flag the row (`fresh=false`) and the totals ("gồm N giá cũ"). That is flagged, so it is not "silently treated as current". Show `tradeDate` next to every price, and pass `fetchedAt` to the badge.
- `expectedPriceDate`, a pure function that gets `now` passed in (core never reads the clock):
  - Take the VN date from `vnDateOf(now)`.
  - If that date is a trading day and VN time ≥ cutoff, expected = today. Otherwise expected = the previous trading day, skipping weekends and `settings.holidays`.
  - Cutoff is configurable (R5), e.g. in `rule_configs`. Default it to after the STK-005 sync time, e.g. 18:00, so 15:00–18:00 isn't falsely stale.
  - This needs a new `previousTradingDay` (or `subtractTradingDays`) helper in `calendar.ts`.
  - An empty holidays list makes Tết show stale. That fails safe (false stale, never false fresh), but note it.
  - Optionally treat an unresolved `data_gaps` row covering the expected date as stale. This can be deferred since STK-005 hasn't landed.

**prices_daily repo:** add `getLatestCloses(db, symbols)` in `packages/db` that returns `PriceQuote`s. supabase-js has no `DISTINCT ON`, so run parallel per-symbol `order(trade_date desc).limit(1)` queries; there are few holdings. Avoid a new view or migration in this ticket (R7). Map with `toSafeInt`.

**Fee rate unset:** don't let the dashboard 500. Either use the `getEntrySettings` approach with a banner "Chưa cài phí giao dịch — giá vốn có thể thấp hơn thực tế" (transactions with a NULL fee then cost 0 fee), or show a clear blocking empty state. The planner should pick one explicitly.

**Unit tests (R8, AC2):**
- MV/P&L exact for large values (> 2^53 intermediates) through BigInt.
- P&L % for a negative P&L rounds half away from zero; `totalCost=0` gives null %.
- Weights sum check (raw MV); weights null for unpriced; denominator excludes unpriced.
- Concentration: just-below, exactly-at (no warn), just-above (warn), cases where rounded ppm equals the threshold but the exact value exceeds it, a single holding, threshold NULL falls back to the default.
- Realized total includes closed (qty 0) symbols; qty-0 rows are excluded from the table rows; `dividendCashNet` is not in realized P&L or net worth.
- Net worth with: all priced; one missing (excluded, `complete=false`); all missing / empty prices_daily (holdings MV = 0 shown as incomplete, net worth = cash + other); no assets; multiple cash rows.
- Stale vs fresh vs missing classification.
- `expectedPriceDate`: weekday before/after cutoff, Saturday/Sunday gives Friday, Monday before cutoff gives Friday, a holiday-adjacent date, a UTC/VN boundary (e.g. 23:30 UTC).
- `previousTradingDay` across holidays.
- Empty ledger gives empty rows and zero totals (AC6).

## Risks
- **Fee-rate NOT_CONFIGURED will break the dashboard** until STK-010 exists or the DB is seeded. This is the highest practical risk.
- **The empty `prices_daily` table means AC1/AC5 can't be demoed with real data.** Tests must use fixtures, and the UI must render "no price" states, not 0 ₫ or −100% P&L. Showing 0 market value as a real loss is the main correctness trap.
- **Weights are misleading when some prices are missing.** The partial flag is required, not optional.
- **Assets semantics.** If rows are treated as snapshots but summed, cash is double-counted. A margin loan or other debt can't be entered (`value >= 0`), so net worth is overstated for anyone using TCBS margin.
- **Price units.** If STK-005 stores prices in thousand VND, market value is off by 1000×. Add a sanity assertion in the repo mapper or a test fixture to make the R2 assumption visible.
- **No auth (R6 suspended).** The dashboard shows full net worth; this matters for STK-018 exposure.

## Open questions (for Ming / planner)
1. Weight denominator: priced stock holdings (recommended) or net worth?
2. Concentration default: is 20% (200,000 ppm) OK? Should a NULL/0 threshold mean "use default" or "disabled"?
3. Assets: is each row one account's current balance that gets summed (recommended), or dated snapshots where only the latest per name counts? Should "other" get subtypes (gold, deposit, bond, fund) now or later? Is a liabilities/margin type needed?
4. Stale cutoff time and tolerance: is 18:00 VN with stale = older than the expected trading day OK? Should we wait for the STK-005 schedule?
5. Dashboard behaviour while the fee rate is unset: a banner with estimated cost, or a blocking state?
6. Should stale prices count in totals and net worth (recommended, flagged), or be excluded like missing ones?
7. Show a "net if sold" P&L (after fee + 0.1% tax) in v1, or gross only?

Key files: /home/user/stoktok/packages/core/src/ledger/valuation.ts, /home/user/stoktok/packages/core/src/ledger/build-ledger.ts, /home/user/stoktok/packages/core/src/money.ts, /home/user/stoktok/packages/core/src/calendar.ts, /home/user/stoktok/packages/db/src/repos/settings.ts, /home/user/stoktok/packages/db/src/ledger.ts, /home/user/stoktok/packages/db/src/repos/assets.ts, /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql, /home/user/stoktok/apps/web/components/data-freshness-badge.tsx
