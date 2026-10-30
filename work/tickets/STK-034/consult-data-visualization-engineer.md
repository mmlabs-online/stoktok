# STK-034 consult: data-visualization-engineer

Builds on the STK-016 consult. I read the ticket, `server/symbols/load-symbol.ts`, `components/symbol/symbol-header.tsx`, `packages/core/src/market/price-gaps.ts`, `daily-bar.ts` and `calendar.ts`, the `getRecentCloses` and `listOpenGaps` repos in `packages/db`, and the R1 scan test. I did not run anything.

## Findings

1. **Gap storage is day-based and already has a pattern to copy.** `data_gaps` rows have `from_ts`/`to_ts` (VN day bounds from `vnDayBoundsUtc`), `symbol` (NULL means market-wide), `data_type` (`prices_daily`, via `PRICES_GAP_TYPE`) and `resolved_at`. `planPriceGaps` only records gaps for trading days after the symbol's `firstStoredDate`. It resolves a gap once its days are stored. Gaps are never deleted.
   - `listOpenGaps(db, type, symbols)` filters by symbol, so it misses market-wide gaps. `listOpenMarketGaps` exists for those.
   - Resolved gaps need no drawing. Their days now have bars.
2. **Existing reads don't fit the chart.** `getRecentCloses(db, [sym], n)` returns the newest n bars in descending order with `{symbol, tradeDate, close, volume, source, fetchedAt}`. There is no date-range read. The loader currently asks for n=2, for the header. `db.ts` only exports `getDb`; the other accessors come from `@stoktok/db`.
3. **The R1 scan covers only `.tsx`** (`components/` and `app/`). It forbids `Math.`, `*100`, `/100`, `/1000`, `reduce(`, `toFixed(`, `new Date(` and `Date.now(`. Every scale, tick and path must come from core or `lib/*.ts`. The component should only emit attributes, e.g. `<path d={seg.d}>` and `<rect x y width height>`.
4. **`buildPriceBoardRow` skips ex-date bars.** It sets `flags.exDate` on the last bar and returns early. Raw closes across an ex-date can show a cliff, and I could not confirm whether TCBS bars are adjusted.

## Recommendations

### 1. Series model in core (AC2)

Add `packages/core/src/market/chart-series.ts`. It should be pure, integer-in and integer-out, and fully unit-tested.

`buildChartSeries({ bars, gaps, range, endDate, firstStoredDate, holidays, exDates, geometry })` returns:

- **`slots[]`**: one per trading day from `rangeStart(endDate, range)` to `endDate`, built with `tradingDaysBetween`. Weekends and holidays are not slots, so they are off-axis. Each slot has `index`, `date`, `x` and a `kind`:
  - `bar`
  - `gap_recorded`: no bar, and the day is covered by an open gap. Use the same instant-containment test as `planPriceGaps`, comparing epoch ms. Market-wide gaps count too.
  - `missing_unrecorded`: no bar, no gap, and the date is on or after `firstStoredDate`.
  - `before_history`: the date is before `firstStoredDate`.
- **`endDate`**: pass `expectedPriceDate`, not the last bar date. A stale feed then shows trailing unrecorded slots honestly.
- **Bar wins over gap.** If a bar exists on a day that also sits inside an open gap (a race before resolve), draw the bar.
- **`segments[]`**: one per contiguous run of `bar` slots, each with `d` (e.g. `M x y L x y…`). Break the line at every non-bar slot, whether recorded or not. A run of exactly one bar becomes a `dots[]` entry, because a one-point path draws nothing. There is no interpolation anywhere.
- **`volumeBars[]`**: `{x, y, w, h}` on a zero baseline in a lower panel (about 25% of the height).
  - `w = max(slotW * 0.7, 1)`.
  - The volume axis gets a single max tick.
- **`priceTicks[]`**: 3 ticks as integer VND. The domain is the min/max of close with about 5% padding, rounded to tick size (`tickSize` already exists). A non-zero line baseline is fine, but the min/max labels must be visible.
- **`xLabels[]`**: 3 or 4 slot indices, with first and last anchored `start` and `end` so they don't clip.
- **`bands[]`**: consecutive non-bar slots merged into runs, `{kind, fromDate, toDate, x, w}`. Enforce `w >= 3` so one day on the 1N range is still visible.
- **`exMarkers[]`**: slot x positions for ex-dates inside the range.
- **`stats`**: first/last close, high/low, bar count, recorded-gap day count, unrecorded-missing day count.

**Ranges.**
- Define `CHART_RANGES = ['1T','3T','6T','1N']` meaning 1, 3, 6 and 12 calendar months. `rangeStart` is calendar-month subtraction done in core, with day clamping, tested at month ends.
- Slot counts are about 22, 63, 125 and 250.
- Parse `?range=` with a pure `lib/chart-range-query.ts`, modelled on `transaction-list-query.ts`. Whitelist the values and fall back to a default (suggest 3T) for anything else.

**Leading `before_history`.** Trim the axis to start at `max(rangeStart, firstStoredDate)` and show the note "Dữ liệu bắt đầu từ dd/mm". Otherwise 6T and 1N look mostly empty before STK-032 backfill, and blank space reads as missing data.
- The chart needs the symbol's overall first stored date to tell "before history" from "real hole". A range-only read can't tell them apart.
- Have `listCloseHistory` also return `firstStoredDate`, or do a separate min query.

### 2. `listCloseHistory` (AC3)

- Signature: `listCloseHistory(db, symbol, fromDate, toDate)`. It selects `symbol,trade_date,close,volume,source,fetched_at`, filters `.gte`/`.lte` on `trade_date`, and orders ascending.
- Use the existing `fetchAll` helper rather than relying on the default 1000-row Supabase cap (250 is safe, but pagination is cheap insurance).
- It returns `StoredClose[]` through `storedCloseFromRow`. Document that the order is ascending, unlike `getRecentCloses`.
- Tests: the range filter, ordering, the empty result, `DataError` mapping, and that the `firstStoredDate` lookup returns null for an unknown symbol.
- In the loader, add `chart` to `SymbolView`. Read history plus `listOpenGaps(db,'prices_daily',[symbol])` and `listOpenMarketGaps`. Extend `loadSymbol` with a `range` argument and call `buildChartSeries`. The loader does no math.

### 3. Rendering

**Elements.**
- The line uses a neutral foreground token (`stroke-current text-fg`, 1.5 to 2 stroke). Do not tint it up or down. Green and red stay on header change values only.
- Volume bars use a muted token with no hue meaning.
- Use `shape-rendering="crispEdges"` on the bars.

**Gap bands.**
- A recorded gap gets a hatched band. The hatch is an SVG `<pattern>` in the warning token, so it is shape, not just colour.
- An unrecorded missing day gets a different shape: a dashed outline or dotted vertical rule with no fill.
- The legend below the chart shows both swatches: "Thiếu dữ liệu (đã ghi nhận)" and "Chưa có dữ liệu".
- Don't put text inside bands. Narrow bands can't hold it, so dates go in the legend and the table.
- Use a static `<pattern id>`. One chart per page makes id collisions a non-issue.

**Ex-dates.**
- Draw a small tick or triangle at the ex-date slot on the axis, with the legend "Ngày GDKHQ".
- Do not break the line there.
- Add a footnote "Giá chưa điều chỉnh" or "đã điều chỉnh". Which one depends on open question 1.

### 4. Mobile at 375px

- Content width is about 343px. Use a fixed logical viewBox of about **360×240** with `width:100%; height:auto`, and font size 10–11 in viewBox units. A 640-wide viewBox would scale text to about 5–6px at 375px.
- Cap the container (`max-w-lg`). On desktop it scales about 1.4×, which still reads fine. The alternative is to put it in the left column of the existing desktop grid.
- Left plot margin is about 40 units for the price labels, with 3 x labels.
- **Density on 1N.** About 250 slots over about 300 plot units is roughly 1.2 units per slot. The line is fine. Volume bars become a dense texture, which is acceptable. Weekly volume aggregation would change the data meaning, so keep daily bars in v1 and note this as a known limit.
- **Tabs** are a `<nav aria-label="Khoảng thời gian">` with 4 `next/link` items in a `grid grid-cols-4`, each at least `min-h-11` (44px). The active one has `aria-current="page"`, plus a non-colour cue (underline or bold). No hand-rolled ARIA tablist, which matches the STK-016 advice.
- **No hover-only interaction.** Tooltips can't work on touch, and the table is the detail view.
- **The table** has 4 narrow columns (date, close, volume, status), so no horizontal scroll at 343px. Wrap it in `max-h-80 overflow-y-auto` with `role="region" tabindex="0" aria-label`. The `<summary>` should be at least 44px high.

### 5. Accessibility (AC4)

- Use `<figure>`. The SVG gets `role="img"` and an `aria-label` from a server-built sentence in a `.ts` helper, using core formatters. Example: "Giá đóng cửa 3 tháng, từ 02/08 đến 30/10: đầu kỳ 125.400, cuối kỳ 131.000, cao nhất …, thấp nhất …. Thiếu 2 ngày đã ghi nhận, 1 ngày chưa có dữ liệu."
- **`role="img"` hides its children from assistive tech.** Put the legend and the table in sibling nodes (`figcaption` and `<details>`), not inside the SVG or the role=img element.
- Table fallback:
  - `<details><summary>Xem dữ liệu dạng bảng</summary>`, with a `<caption>`.
  - `<th scope="col">` and `<th scope="row">` for the date.
  - Newest first, with the order stated in the caption.
  - It lists every slot, including missing ones, with a status text column: "Có dữ liệu", "Thiếu (đã ghi nhận)" or "Chưa có dữ liệu". Add a glyph so status is not colour-only.
  - Rows come from `slots[]`, so the table and chart can't disagree. A core test should assert that.
- R4: show the source and fetched-at of the newest bar in the figcaption. Per-row source is optional.
- Check hatch and line strokes against the tokens already in `contrast.test.ts`. Meaningful graphics need 3:1 (WCAG 1.4.11). The pattern shape carries the meaning, so the colour contrast is a second layer.
- The hatch and dashes are static, so there is no motion issue.

### 6. States

- **Zero bars in range:** `EmptyState` "Chưa có dữ liệu giá trong khoảng này". Keep the tabs, and mention recorded gaps if any.
- **One bar:** a dot plus its volume bar.
- **Only `before_history` slots:** the same as zero bars.
- **Stale feed:** trailing slots show as unrecorded missing, with no interpolation. This is the case the unrecorded kind exists for.

### 7. Tests

- **Core `chart-series`:**
  - Weekends and holidays are off-axis.
  - A gap splits the line.
  - A single bar between two holes becomes a dot.
  - Recorded vs unrecorded vs `before_history` classification.
  - Market-wide gap.
  - Bar-beats-gap.
  - The ms-instant boundary of the VN day.
  - Range start at month end.
  - Empty and one-bar input.
  - Ex-date marker.
  - No NaN and no negative widths.
  - Determinism.
- **`chart-range-query`:** the whitelist and the default.
- **DB:** `listCloseHistory`.
- **Loader:** range argument and fixture gaps, in the style of `load-symbol.test.ts`.
- **Component render tests:**
  - The `aria-label` is present.
  - The table row count equals the slot count.
  - Both gap legends render.
  - `aria-current` is on the active tab.
  - No `<polyline>` or `<path>` spans a gap.
- The R1 scan must stay green.

## Risks

- **Holiday list completeness.** `settings.holidays` is user-maintained. A missing holiday would show as "Chưa có dữ liệu" without being a data fault. The worker's gap planner uses the same list, so they stay consistent. Use neutral wording and don't present it as an error.
- **Raw vs adjusted closes** could show a fake cliff at ex-dates. This is unconfirmed (open question 1).
- **Sparse history before STK-032.** The chart is thin until backfill runs. The `before_history` trimming and the start-date note reduce confusion.
- **Dense 1N bars on mobile.** Texture instead of discrete bars (see section 4).
- **Page exposure without auth** (R6 suspended) is already tracked under STK-018.
- **Scope creep:** tooltips, zoom, a candlestick view and a watch toggle are out of scope (R7). Send them to follow-ups.

## Open questions

1. Are `prices_daily.close` values raw or adjusted for corporate actions? This decides the footnote wording and whether ex-date markers are enough. If the source gives unadjusted prices and a stock dividend or split is in the range, closes could show a false drop.
2. Should the chart's default range be 3T (my suggestion)?
3. Should the trimmed axis (start at the first stored date) be accepted, or should the full range always show with blank leading space?
4. Is 1N daily volume as a dense texture acceptable, or do you want a labelled weekly aggregation (core-computed)?
5. Should `listCloseHistory` return `{bars, firstStoredDate}` together, or should the loader make a separate min-date query? I prefer the former.

Files referenced:
- /home/user/stoktok/work/tickets/STK-034/ticket.md
- /home/user/stoktok/work/tickets/STK-016/consult-data-visualization-engineer.md
- /home/user/stoktok/apps/web/server/symbols/load-symbol.ts
- /home/user/stoktok/apps/web/components/symbol/symbol-header.tsx
- /home/user/stoktok/apps/web/test/no-calc-in-ui.test.ts
- /home/user/stoktok/packages/core/src/market/price-gaps.ts
- /home/user/stoktok/packages/core/src/calendar.ts
- /home/user/stoktok/packages/db/src/repos/prices-daily.ts
- /home/user/stoktok/packages/db/src/repos/data-gaps.ts
