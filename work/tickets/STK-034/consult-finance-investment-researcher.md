# STK-034 finance consult: price and volume chart (builds on the STK-016 consult)

## Findings
1. **Prices are raw, and nothing adjusts them.** ADR 0001 assumes TCBS bars are unadjusted, and this is still UNVERIFIED. `normalizeDailyBar` (`packages/core/src/market/daily-bar.ts`) stores the source values as they arrive. On a stock-dividend or bonus ex-date the raw close drops by about 1/(1+ratio), and on a cash-dividend ex-date by about D/P (1–3%). STK-036 (`packages/core/src/signals/raw-price-guard.ts`) handles this for **signals only**: an MA window containing a non-cash ex-date or a jump beyond the daily limit is suppressed. The chart has no such guard. It will show the cliff as a real move.
2. **Ex-date data is partial.** `corporate_actions` covers only actions Ming enters for held symbols (`cash_dividend` / `stock_dividend`; rights issues can't be stored). For watched-only symbols, ex-dates are unknown. `load-symbol.ts` already loads `symbolCas` (ex-dates) for the header.
3. **Holidays default to empty** (`packages/core/src/ledger/settings.ts:11`, `holidays: []`).
   - `planPriceGaps` uses the same list, so a STK-032 backfill over a holiday period missing from Ming's settings (e.g. Tết 2026) **records those days as `data_gaps`**.
   - The chart would then show Tết as a hatched "Thiếu dữ liệu" band, and as a *recorded* gap, not an unrecorded one.
4. **Gaps are expected only from the first stored date.** `planPriceGaps` records nothing before a symbol's first stored date. `getFirstPriceDates` already exists in `packages/db/src/repos/prices-daily.ts`.
5. **Volume** is a non-negative safe integer (`invalid_volume` otherwise), stored as `bigint`.
   - The unit is assumed to be shares (the TCBS fixtures show values like 1,200,000), but this is not verified the way the price unit was.
   - It's also unknown whether it includes put-through (thỏa thuận) volume.
6. **History depth.** The STK-032 backfill defaults to 260 trading days (about 1 year), with a maximum of 520. Without a backfill, the daily sync covers only a short lookback.
7. **The existing core pieces are enough:** `isTradingDay`, `tradingDaysBetween`, `subtractTradingDays`, `vnDateOf`, `vnDayBoundsUtc` (`packages/core/src/calendar.ts`) and `StoredClose` (`price-board.ts:12`). No new calendar logic is needed.

## Recommendations
**What the chart must show**
- **AC1/AC2, R4: anchor the x-axis end at `expectedPriceDate`, not at the last stored bar.** A stale symbol then shows its missing trailing days as a gap at the right edge, rather than a line that looks current.
- **AC2: x-axis.** One slot per trading day from `tradingDaysBetween(start, expected, holidays)`.
  - Start at `max(rangeStart, firstStoredDate)`, matching the `planPriceGaps` semantics.
  - Caption "Dữ liệu từ dd/mm/yyyy" when the history is shorter than the range, so a short history doesn't render as months of "unrecorded missing".
- **AC1/AC4: three point kinds**, decided in core:
  - `stored`
  - `missing` + `gapId` (covered by a `data_gaps` row, symbol or market-wide)
  - `missing` + unrecorded
- **AC2: volume panel.**
  - A missing day has **no bar**, never a zero-height bar. A stored bar with `volume = 0` is a real zero: draw it as a zero bar, and say so in the table.
  - Zero baseline, linear scale, neutral colour.
  - Do not colour bars up/down: that needs a reference price, which is wrong on ex-dates and for UPCoM (see the STK-016 consult).
- **Volume unit (AC4, labels).** Label it "KL (cp)" and format it compactly in core ("1,2 tr", "850 N").
  - Mark the shares unit UNVERIFIED next to `TCBS_PRICE_UNIT`, and add it to ADR 0001's dry-run checklist.
- **Price axis (AC2, R1, R2).**
  - Take the y-domain from visible stored closes only, with a non-zero baseline and labelled min/max.
  - Format values with the existing core VND formatter (the VN convention is thousand-VND display, e.g. 125,4).
  - All scale math goes in `chart-series.ts`, since `no-calc-in-ui.test.ts` forbids `Math.` and `*100` in `.tsx` files.
- **Caption (AC4, R4).** "Giá đóng cửa chưa điều chỉnh theo cổ tức/quyền", plus `source` and the latest `fetched_at` of the displayed bars.
- **Ranges (AC1).**
  - `?range=1T|3T|6T|1N`, default **3T**. An invalid value falls back to the default, not a 404.
  - Range → start date is computed in core: calendar months back from `expected`, snapped to the next trading day. Fixed trading-day counts (21/63/126/252) would also work; pick one and pin it with tests.
  - Leave out "Tất cả" (not in the brief; history is at most about 2 years).
  - Load only that range (`listCloseHistory(db, symbol, from, to)`).
- **x labels (AC2).** Use the first trading day of each month for 3T/6T/1N and weekly for 1T, computed in core.

**What the chart must not show**
- **No interpolation.** Never connect the line across a gap; draw one path per contiguous run (R4).
- **No range return / "% thay đổi trong kỳ"** in the chart, the `aria-label` or the table.
  - On raw prices across a stock-dividend ex-date it reports a false loss, and it leaves out dividends.
  - The `aria-label` gives first/last close with dates, high/low, and gap counts (recorded vs unrecorded) only.
- **No adjusted series, and no cut or break at ex-dates.** The raw bars are real stored data. Don't "fix" them in the UI or in core here (that is ADR 0001's follow-up).
- **No ex-date markers in this ticket (R7).** They are not in any AC, and they would be incomplete for watched-only symbols, which implies false completeness.
  - Follow-up: "Ex-date markers on symbol chart (from corporate_actions; note coverage limits)".
- **No MA overlays (R7).** They are not in the AC.
  - An overlay computed on raw closes would also show MA values over windows that STK-036 suppresses for signals, so the chart and signals would disagree.
  - Follow-up, gated on an adjusted series.
- No jump/limit-hit markers, no OHLC candles, no tooltips/zoom (no JS), no up/down colouring of the line.

## Risks
- **Fake cliffs.** A stock dividend shows as a −20…−50% drop. The caption is the only mitigation. Medium likelihood for held names; Ming may misread it as a loss.
- **Holiday gaps.** With an empty or incomplete holiday list, Tết and other holidays show as *recorded* gaps (Finding 3). That is honest but noisy.
  - The chart should not try to tell them apart.
  - Suggested follow-up: seed the VN holiday calendar for 2025–2026 in settings, before or alongside running STK-032.
- **Illiquid / UPCoM names.** If TCBS omits no-trade days, these show as many gaps. This is correct per R4, but it looks like a data failure. Note it in the follow-ups and don't solve it here.
- **Volume semantics unverified:** whether it is in shares, and whether it includes put-through. A ×10 unit error or double counting would mislead without anyone noticing.
- **Mixed sources later.** When a fallback source is added, the caption must list every source in range, not just the latest.

## Open questions
1. Default range: 3T (recommended) or 1N?
2. Range → start: calendar months (recommended, matches the labels) or fixed trading-day counts?
3. Should the follow-up for a seeded VN holiday calendar be raised now, since it directly affects how honest this chart is once STK-032 runs?
4. Confirm that ex-date markers and MA overlays are follow-ups (recommended), not additions to STK-034's AC.
5. Should the table fallback show each row's `source` and `fetched_at`, or should only the caption carry them? I recommend the caption, plus a per-row source only if more than one source is present.

Key files:
- /home/user/stoktok/packages/core/src/calendar.ts
- /home/user/stoktok/packages/core/src/market/price-gaps.ts
- /home/user/stoktok/packages/core/src/market/daily-bar.ts
- /home/user/stoktok/packages/core/src/market/price-board.ts
- /home/user/stoktok/packages/core/src/signals/raw-price-guard.ts
- /home/user/stoktok/packages/core/src/ledger/settings.ts
- /home/user/stoktok/packages/db/src/repos/prices-daily.ts
- /home/user/stoktok/apps/web/server/symbols/load-symbol.ts
- /home/user/stoktok/docs/adr/0001-eod-price-source.md
- /home/user/stoktok/work/tickets/STK-016/plan.md (Split proposal, slice 2)
