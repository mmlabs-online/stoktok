Status: READY

# Plan — STK-034: Price and volume chart on the symbol screen

## Spec summary
- docs/spec-v1.md §2.2: "Intraday data may be delayed. Every price carries a `fetched_at` timestamp and a source." / "Gaps must be detected, not silently interpolated."
- §3 F2 is cited by the ticket as the home of the symbol screen. The chart itself comes from the UI brief, docs/figma-make-prompts.md line 146: "Price chart …: close price line + volume bars, range tabs 1T / 3T / 6T / 1N … Show a gap marker area if the mock data has a missing-days range." The brief names recharts. The ticket overrides that ("Own SVG, no new dependency"), and STK-016 plan.md also overrides it (Split proposal, slice 2: "Our own SVG, no new dependency (stack change = Ming)").
- STK-016 plan.md, Split proposal slice 2 (carried decisions):
  - `?range=` 1T/3T/6T/1N with `aria-current`
  - one point per trading day
  - a missing day is either recorded (`data_gaps`) or unrecorded
  - one path per contiguous run, never interpolated
  - gaps from `listOpenGaps` + `listOpenMarketGaps`
  - `<details>` table fallback
  - neutral line colour
  - "Raw (unadjusted) closes, stated in a caption"
- CLAUDE.md:
  - R1: no calculation in UI. `apps/web/test/no-calc-in-ui.test.ts` enforces it.
  - R2: integer VND.
  - R3: server-only DB access.
  - R4: source and fetched_at on every record; gaps recorded.
  - R6 is suspended, so no auth code.
  - R7: stay inside the plan.

## Acceptance criteria → verification
| # | Criterion (ticket) | How the reviewer verifies it |
|---|---|---|
| 1 | Price + volume chart with range tabs (`?range=`, server-rendered links). Missing days from `data_gaps` are shown as gaps, never interpolated (R4). | **Range parsing:** `chart-range-query.test.ts` (whitelist, default 3T, invalid → default, array param). **Gap handling:** `chart-series.test.ts` › "a missing day splits the line into two segments" and › "recorded gap day becomes a gap_recorded band". **Rendering:** `price-chart.test.tsx` › "tabs are 4 links with ?range= and aria-current on the active one" and › "no path spans a missing slot". **Loader:** `load-symbol.test.ts` › "chart reads history for the range window and both gap lists". Manual: `/symbols/FPT?range=1N` renders without client JS. |
| 2 | Own SVG with no new dependency. Series and geometry live in `packages/core`: one point per trading day, with holidays and weekends off-axis. Unit tests cover it. Components only map outputs (R1). | `git diff -- '**/package.json' pnpm-lock.yaml` shows no new dependency. `chart-series.test.ts` (full list below). `no-calc-in-ui.test.ts` stays green. Review: `price-chart.tsx` only maps fields to `<path d>`, `<rect>`, `<circle>`, `<text>` and table cells, with no arithmetic. |
| 3 | New db read `listCloseHistory` (date range, close + volume + source + fetched_at), with tests. | `prices-daily.test.ts` › `listCloseHistory` tests (below). |
| 4 | Accessible: a figure summary label and a table fallback. Recorded gaps are distinguished from unrecorded missing days. | **Summary label:** `price-chart-text.test.ts` › "summary sentence lists period, first/last close, high/low, recorded and unrecorded counts". **Rendering:** `price-chart.test.tsx` › "svg has role=img and the summary aria-label", › "table has one row per slot with status text", › "legend shows both gap kinds with different patterns". **Core:** `chart-series.test.ts` › "recorded vs unrecorded classification". |

Checks: `pnpm typecheck`, `pnpm lint` and `pnpm test` must all pass (R8).

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/market/chart-series.ts` | **Create.** Exports `CHART_RANGES`, `DEFAULT_CHART_RANGE`, `ChartRange`, `subtractCalendarMonths`, `chartWindow`, `buildChartSeries` and the types (see Approach). Pure, no I/O. | AC1, AC2 (R1) |
| `packages/core/src/market/chart-series.test.ts` | **Create.** Unit tests. | AC2, R8 |
| `packages/core/src/market/price-gaps.ts` | **Modify.** Add `export const PRICES_GAP_TYPE = 'prices_daily'`. | Web and worker need the same gap type string, so it gets one definition. |
| `packages/core/src/index.ts` | **Modify.** Export the new symbols. | Public API |
| `apps/worker/src/jobs/eod-sync.ts` | **Modify (1–2 lines).** Replace the local `PRICES_GAP_TYPE` const with an import plus re-export from `@stoktok/core`. Behaviour is unchanged. | Removes the duplicate string. The worker's existing tests must stay green. |
| `packages/db/src/repos/prices-daily.ts` | **Modify.** Add `listCloseHistory(db, symbol, from, to, {pageSize})`. | AC3 |
| `packages/db/src/repos/prices-daily.test.ts` | **Modify.** Add the `listCloseHistory` tests. | AC3, R8 |
| `packages/db/src/index.ts` | **Modify.** Export `listCloseHistory`. | AC3 |
| `apps/web/lib/chart-range-query.ts` | **Create.** `parseChartRange(sp)` returns a `ChartRange` (whitelist, default). `chartRangeHref(symbol, range)` returns `/symbols/<enc>?range=<r>`. | AC1 |
| `apps/web/lib/chart-range-query.test.ts` | **Create.** | AC1, R8 |
| `apps/web/lib/price-chart-text.ts` | **Create.** Pure string builders from `ChartSeries.stats`, using core formatters only: `chartSummaryLabel(series, range)`, `chartRangeLabel(range)` (e.g. "3 tháng") and `slotStatusText(kind)`. No arithmetic. | AC4. Keeps text out of the `.tsx` file. |
| `apps/web/lib/price-chart-text.test.ts` | **Create.** | AC4, R8 |
| `apps/web/server/symbols/load-symbol.ts` | **Modify.** `loadSymbol(db, symbol, now, range = DEFAULT_CHART_RANGE)`. Adds `chart: ChartSeries` and `chartRange` to `SymbolView`. Extra reads: `getFirstPriceDates`, `listCloseHistory`, `listOpenGaps`, `listOpenMarketGaps`. | AC1. The loader does no math (R1, R3). |
| `apps/web/server/symbols/load-symbol.test.ts` | **Modify.** Add mocks for the 4 new reads and the chart tests. | R8 |
| `apps/web/components/symbol/price-chart.tsx` | **Create.** Contains `PriceChart` (figure, SVG, legend, figcaption, `<details>` table, empty state) and `ChartRangeTabs` (nav with 4 links). | AC1, AC4 |
| `apps/web/components/symbol/price-chart.test.tsx` | **Create.** Static-markup render tests in the style of `symbol-detail.test.tsx`. | AC1, AC4, R8 |
| `apps/web/app/(app)/symbols/[symbol]/page.tsx` | **Modify.** Accept `searchParams`, call `parseChartRange`, pass the range to `loadSymbol`, render `<PriceChart>` full-width below `SymbolHeader`. | AC1 |

No migrations, no new env, no new dependency.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| chart-series.test.ts › subtractCalendarMonths: 2026-10-30 −1 → 2026-09-30; 2026-03-31 −1 → 2026-02-28; 2024-03-31 −1 → 2024-02-29; 2026-01-15 −3 → 2025-10-15; 2026-10-30 −12 → 2025-10-30 | Calendar-month ranges, day clamp, year wrap, leap year |
| chart-series.test.ts › chartWindow: from = max(monthsBack(end), firstStoredDate), `trimmed` flag, firstStoredDate null → empty window, firstStoredDate > end → empty | Trimmed axis |
| chart-series.test.ts › slots are trading days only: a window over a weekend and a configured holiday has no slot for them | AC2, off-axis |
| chart-series.test.ts › every slot with a bar is kind `bar` and carries close/volume/source/fetchedAt | AC2, R4 |
| chart-series.test.ts › a missing day splits the line into two segments, and no segment's x-range covers the missing slot's x | AC1, R4 (no interpolation) |
| chart-series.test.ts › a single bar between two missing days becomes a dot, not a segment | Edge case |
| chart-series.test.ts › recorded vs unrecorded classification: a symbol gap → `gap_recorded` with gapId; no gap → `missing_unrecorded` | AC4 |
| chart-series.test.ts › market-wide gap (symbol null) marks the day `gap_recorded` | Gap source coverage |
| chart-series.test.ts › bar beats gap: a stored bar inside an open gap is drawn as `bar` | Race before resolve |
| chart-series.test.ts › gap containment uses epoch ms of VN day bounds: a gap ending at 23:59:58+07 does not cover the day, and a gap covering exactly vnDayBoundsUtc does | Boundary |
| chart-series.test.ts › consecutive missing slots of the same kind merge into one band; adjacent bands of different kinds stay separate; band width ≥ 3 | Bands |
| chart-series.test.ts › trailing missing slots up to endDate (stale feed) are `missing_unrecorded` bands at the right edge | R4, stale |
| chart-series.test.ts › volume: one rect per bar slot, none for missing slots, volume 0 → height 0 at the baseline, max volume → full panel height | Volume panel |
| chart-series.test.ts › price ticks are the min and max close of the window; a flat series (min = max) gives finite y and no NaN | Y axis |
| chart-series.test.ts › x labels: first, middle and last slot dates; 1 slot → 1 label | X axis |
| chart-series.test.ts › stats: firstClose/lastClose with dates, high/low, barDays, recordedGapDays, unrecordedDays | AC4 summary input |
| chart-series.test.ts › empty slots and zero bars → `hasData: false`, empty arrays, no throw | Empty state |
| chart-series.test.ts › all numbers finite, widths/heights ≥ 0, x within the plot for 250 slots; same input → deep-equal output | Robustness, determinism |
| chart-series.test.ts › bars outside the window or on a non-trading day are ignored | Input hygiene |
| prices-daily.test.ts › listCloseHistory: eq symbol, gte/lte trade_date, order ascending, paged with range(); maps to StoredClose | AC3 |
| prices-daily.test.ts › listCloseHistory: empty result → [] | AC3 |
| prices-daily.test.ts › listCloseHistory: DB error → DataError; bad row (negative volume) → mapping error | AC3 |
| chart-range-query.test.ts › accepts 1T/3T/6T/1N; missing, lower-case, unknown or array values fall back to 3T (array: first element) | AC1 |
| chart-range-query.test.ts › chartRangeHref encodes the symbol and sets range | AC1 |
| price-chart-text.test.ts › summary sentence lists the period, first/last close, high/low, and recorded and unrecorded counts; no "%" change | AC4 |
| price-chart-text.test.ts › empty series sentence says no data; slotStatusText covers 3 kinds | AC4 |
| load-symbol.test.ts › chart reads history for the range window (from = chartWindow.from, to = expected) and both gap lists with 'prices_daily' | AC1 |
| load-symbol.test.ts › default range is 3T; the passed range is echoed in `chartRange` | AC1 |
| load-symbol.test.ts › no stored prices → listCloseHistory not called, chart.hasData false | Empty state |
| load-symbol.test.ts › market-wide gap from listOpenMarketGaps reaches the chart as gap_recorded | AC1 |
| price-chart.test.tsx › svg has role=img and the summary aria-label; legend and table are siblings outside the svg | AC4 |
| price-chart.test.tsx › tabs are 4 links with ?range= and aria-current="page" on the active one only | AC1 |
| price-chart.test.tsx › table has one row per slot, newest first, with status text for each kind | AC4 |
| price-chart.test.tsx › legend shows both gap kinds; the recorded band uses the hatch pattern, the unrecorded band uses a dashed outline | AC4 |
| price-chart.test.tsx › number of `<path>` line elements equals segments.length (no path spans a missing slot) | AC1 |
| price-chart.test.tsx › caption shows "chưa điều chỉnh", source and latest fetched-at; trimmed window shows "Dữ liệu từ dd/mm/yyyy" | R4, trimmed axis |
| price-chart.test.tsx › no data → EmptyState text and tabs still rendered | Empty state |
| no-calc-in-ui.test.ts (existing) | R1 |

## Approach
1. **Core constant.** Add `PRICES_GAP_TYPE` to `price-gaps.ts` and export it. In `eod-sync.ts`, replace `export const PRICES_GAP_TYPE = 'prices_daily'` with `import { PRICES_GAP_TYPE } from '@stoktok/core'` plus `export { PRICES_GAP_TYPE }`, so `store.ts` and `medium-signals.ts` imports keep working.

2. **Core `chart-series.ts`.** Pure, with no `Date.now`. Reuse `tradingDaysBetween`, `vnDayBoundsUtc`, `mulDiv` and `StoredClose`.
   - **Ranges.**
     - `CHART_RANGES = ['1T','3T','6T','1N'] as const`, with months `{1T:1, 3T:3, 6T:6, 1N:12}`.
     - `DEFAULT_CHART_RANGE = '3T'`.
   - **`subtractCalendarMonths(date, n)`.** Integer string math. The day is clamped to the target month's length. Throws on an invalid date.
   - **`chartWindow({ endDate, range, firstStoredDate })`** returns `{ from, to, trimmed }`:
     - `to = endDate`
     - `rangeStart = subtractCalendarMonths(endDate, months)`; the window is inclusive
     - `from = max(rangeStart, firstStoredDate)` and `trimmed = firstStoredDate > rangeStart`
     - when `firstStoredDate` is null, or after `endDate`, the window is empty (`from > to`)
   - **`buildChartSeries({ bars, openGaps, window, holidays })`** returns `ChartSeries`. `openGaps` are `OpenGap`s from the symbol and market-wide lists. Geometry is a fixed module const `CHART_GEOMETRY`: viewBox 360×240, plot left 44, right 8, top 8, price panel height 150, a separator, volume panel height 48, x-label band at the bottom.
     - **`slots`**: `tradingDaysBetween(window.from, window.to, holidays)`. Each slot is `{ index, date, x, kind, bar? , gapId? }` with `kind ∈ 'bar' | 'gap_recorded' | 'missing_unrecorded'`.
     - **Classification.** A slot is `bar` if a bar has that `tradeDate` (bar beats gap). Otherwise it is `gap_recorded` if an open gap satisfies `Date.parse(fromTs) <= dayStart && Date.parse(toTs) >= dayEnd`. This is the same containment test as `planPriceGaps`, using `vnDayBoundsUtc`. Otherwise it is `missing_unrecorded`. Bars whose date is not a slot are ignored.
     - **Slot x.** `slotW = plotW / slots.length` and `x = plotLeft + (i + 0.5) * slotW`. Coordinates are plain numbers rounded to 2 decimals. They are geometry, not money (R2 applies to the VND values, which stay integers).
     - **Y scale.**
       - `lo`/`hi` are the min/max close of the bar slots.
       - Padding is `pad = max(mulDiv(hi - lo, 5, 100), 1)`, or for a flat series `max(mulDiv(hi, 1, 100), 1)`.
       - y is linear inside the price panel.
       - `priceTicks = [{ value: lo, y }, { value: hi, y }]`, integer VND. The labels are formatted in the component with `formatPrice`.
     - **`segments`.** Contiguous runs of `bar` slots with length ≥ 2 become `{ d: 'M x y L x y …', fromDate, toDate }`. Runs of length 1 become `dots: { x, y, date }`.
     - **`volumeBars`.**
       - Every `bar` slot gets `{ x: center − w/2, y, w, h, date }`, where `w = max(slotW * 0.7, 1)` and `h = volume * panelH / maxVolume`. When `maxVolume = 0`, every h is 0.
       - `volumeMaxTick = { value: maxVolume, y }`.
       - Missing slots get no rect.
     - **`bands`.** Runs of consecutive non-bar slots of the same kind become `{ kind, fromDate, toDate, days, x, w }` with `w = max(days * slotW, 3)`, clamped inside the plot.
     - **`xLabels`.**
       - Slot dates of the first, middle and last slot (deduplicated), with `anchor: 'start' | 'middle' | 'end'`.
       - Each label text is "dd/mm". It is built in core as a string slice; `formatDate` is not reused because it includes the year.
     - **`stats`**: `{ barDays, recordedGapDays, unrecordedDays, first?: {date, close}, last?: {date, close}, high?, low?, latestFetchedAt?, sources: string[] }`.
       - `sources` holds the distinct sources in the window, so the caption lists all of them (finance risk "mixed sources later").
       - `latestFetchedAt` is the maximum by epoch ms.
     - **`hasData`** is `barDays > 0`. The series also echoes `window` (`from`, `to`, `trimmed`).
   - No ex-date markers, no MA lines, no % change in period (see Specialist input).

3. **DB `listCloseHistory(db, symbol, from, to, { pageSize = 1000 })`.**
   - Modelled on `listPriceDates`: `fetchAll` with `select('symbol,trade_date,close,source,fetched_at,volume')`, `.eq('symbol')`, `.gte/.lte('trade_date')`, `.order('trade_date', { ascending: true })` and `.range(lo, hi)`.
   - Maps rows through `storedCloseFromRow`. The JSDoc states that the order is **ascending, unlike `getRecentCloses`**.
   - The first stored date comes from the existing `getFirstPriceDates`, so no new query shape is needed.

4. **Web lib.**
   - `chart-range-query.ts`: the whitelist parser and the href builder.
   - `price-chart-text.ts` builds the Vietnamese strings with `formatPrice`, `formatDate`, `formatQuantity` and `formatDateTime`, for example: "Giá đóng cửa 3 tháng, từ 31/07/2026 đến 30/10/2026: đầu kỳ 125,4, cuối kỳ 131,0, cao nhất …, thấp nhất …. Thiếu 2 ngày đã ghi nhận, 1 ngày chưa có dữ liệu."
   - It contains no % change (finance consult).

5. **Loader.**
   - **Batch 1:** the existing reads plus `getFirstPriceDates(db, [symbol])`.
   - **Core calls:** compute `expected` (existing), then `win = chartWindow({ endDate: expected, range, firstStoredDate })`.
   - **Batch 2**, only if the window is non-empty: `listCloseHistory(db, symbol, win.from, win.to)`, `listOpenGaps(db, PRICES_GAP_TYPE, [symbol])` and `listOpenMarketGaps(db, PRICES_GAP_TYPE)`. Otherwise use empty arrays.
   - Then `chart = buildChartSeries({ bars, openGaps: [...symbolGaps, ...marketGaps], window: win, holidays })`.
   - `known` keeps its current definition: a symbol with only a first-price row already has recent closes. The loader does no math.

6. **Component `price-chart.tsx`** (server component, no `'use client'`).
   - **Structure.**
     - `<section aria-label="Biểu đồ giá">` contains `ChartRangeTabs` and then either the `EmptyState` or a `<figure>`.
     - `ChartRangeTabs` is a `<nav aria-label="Khoảng thời gian">` holding a `grid grid-cols-4` of `next/link` items, each `min-h-11`. The active link has `aria-current="page"` plus bold text and an underline.
     - **Empty state** (`!hasData`): "Chưa có dữ liệu giá trong khoảng này". When `recordedGapDays > 0` it adds "(n ngày thiếu dữ liệu đã ghi nhận)".
   - **The SVG.**
     - `<svg viewBox="0 0 360 240" role="img" aria-label={summary} className="w-full h-auto max-w-lg">`.
     - `<defs><pattern id="gap-hatch">` holds a diagonal line with `className="text-warn" stroke="currentColor"`.
     - Recorded bands: `<rect fill="url(#gap-hatch)">`.
     - Unrecorded bands: `<rect fill="none" stroke="currentColor" strokeDasharray="2 2" className="text-fg-muted">`.
     - Each segment is a `<path fill="none" stroke="currentColor" className="text-fg" strokeWidth={1.5}>`. Each dot is a `<circle r={2}>`.
     - Volume rects use `className="text-fg-muted" fill="currentColor" shapeRendering="crispEdges"`.
     - Tick and x-label `<text fontSize={10}>`.
     - Everything is a direct field mapping.
   - **Siblings of the SVG**, not children of `role=img`:
     - A legend `<ul>` with three entries: "Giá đóng cửa", "Thiếu dữ liệu (đã ghi nhận)" with a hatch swatch, and "Chưa có dữ liệu" with a dashed swatch. Each swatch is a small inline SVG with `aria-hidden`.
     - The `<figcaption>` reads: "Giá đóng cửa chưa điều chỉnh theo cổ tức/quyền · Nguồn: {sources} · Cập nhật {formatDateTime(latestFetchedAt)}". When `window.trimmed` it adds "Dữ liệu từ {formatDate(window.from)}".
     - A `<details><summary className="min-h-11">Xem dữ liệu dạng bảng</summary>` holding a table in a `div role="region" tabIndex={0} aria-label className="max-h-80 overflow-y-auto"`.
   - **The table.** Its caption states the newest-first order. Columns are Ngày (`th scope="row"`), Giá đóng cửa, Khối lượng and Trạng thái (status text plus a glyph). Rows are `[...slots].reverse()`, so the table and the chart come from the same slots.
   - **Colour and contrast.** The component uses no up/down colour. It uses only tokens already covered by `contrast.test.ts` (`fg`, `fg-muted`, `warn`).

7. **Page.**
   - `({ params, searchParams }: { params: Promise<…>; searchParams: Promise<Record<string, string | string[] | undefined>> })`, calling `parseChartRange(await searchParams)`.
   - Render `<PriceChart series={view.chart} range={view.chartRange} symbol={view.symbol} />` between the header and the existing grid, full width.

**Rules.**
- R1: all scale, path, band and tick math is in core. The `.tsx` files only map values, and the R1 scan stays green.
- R2: VND values stay integers. Padding uses `mulDiv`.
- R3: reads happen in server code through `../db`.
- R4: no interpolation, recorded gaps are shown, unrecorded missing days are shown, and the caption shows source and fetched_at.
- R5: holidays come from settings. No market rule is hard-coded.
- R6: no auth code. The existing loader comment is kept.
- R7: ex-date markers, MA overlays, tooltips and the compact volume formatter are out of scope.

## Specialist input used
**Data-visualization-engineer, adopted:**
- core `chart-series.ts` with slots, segments, dots, bands, volume bars and stats
- bar-beats-gap, and gap containment in epoch ms
- market-wide gaps included
- `endDate = expectedPriceDate`
- 360×240 viewBox and `max-w-lg`
- tabs as a nav of links with `aria-current` and 44px targets
- no hover
- a hatched pattern for recorded gaps and a dashed outline for unrecorded days
- legend and table as siblings of `role=img`
- table rows built from `slots`
- `fetchAll` pagination
- trimmed axis with a start-date note
- empty, one-bar and stale-feed states

**Data-visualization-engineer, simplified:**
- The `before_history` kind is dropped. Trimming the window to `firstStoredDate` means that kind can never occur.
- Price ticks are the real min/max closes (2 ticks), not 3 tick-size-rounded ticks. `tickSize` needs an exchange, which can be null.
- X labels are first, middle and last.

**Data-visualization-engineer, rejected:**
- **Ex-date markers.** See the decision below.
- **Returning `{bars, firstStoredDate}` from `listCloseHistory`.** The existing `getFirstPriceDates` already does the second half and is already tested. AC3 asks only for a date-range read of close, volume, source and fetched_at, so a plain `StoredClose[]` keeps the repo single-purpose.

**Finance-investment-researcher, adopted:**
- prices are raw, stated in the caption ("chưa điều chỉnh theo cổ tức/quyền")
- no % change in the period anywhere
- no MA overlays, no up/down colouring
- a missing day has no volume bar; volume 0 is a real zero bar
- the y-domain comes from visible closes only
- range → start uses calendar months from `expected`
- default 3T; invalid → default, not a 404
- no "Tất cả" range
- the caption lists all sources in the window

**Finance-investment-researcher, deferred:**
- Monthly or weekly x labels. Plain first/middle/last labels are enough for the AC.
- The "KL (cp)" unit label. The volume unit is unverified, so the chart says "Khối lượng" without a unit, the same as the header's "KL".
- The ADR 0001 checklist edit. That file is outside this ticket, so it goes to the follow-ups.

**Decision: ex-date markers are out of scope (finance consult adopted; UI consult rejected on this point).**
- None of the four ACs mentions ex-dates or corporate actions. AC1 and AC4 ask only for gaps and the recorded vs unrecorded distinction. Adding markers would go beyond the plan (R7).
- `corporate_actions` covers only actions Ming enters for held symbols. Watched-only symbols would show no markers, which looks like "no corporate action" and so implies false completeness.
- The real hazard, a raw-price cliff on a stock-dividend ex-date, is covered honestly by the "chưa điều chỉnh" caption that STK-016 already decided for this slice.
- Markers go to a follow-up that states the coverage limits.

## Assumptions
**Planner defaults for Ming to confirm in the PR** (none of them blocks):
1. **Default range is 3T.** Both consults recommend it, and it reads well at 375px.
2. **Ranges are calendar months back from `expectedPriceDate`, inclusive, with the day clamped at month end.** They are not fixed trading-day counts. This matches the labels 1T/3T/6T/1N, and tests pin it.
3. **The axis is trimmed.** It starts at `max(rangeStart, firstStoredDate)` and shows the note "Dữ liệu từ dd/mm/yyyy". Leading blank space would otherwise read as missing data before the STK-032 backfill. This matches `planPriceGaps`, which records nothing before the first stored date.
4. **`listCloseHistory` returns ascending `StoredClose[]` only.** The first stored date comes from the existing `getFirstPriceDates`.
5. **1N shows daily volume bars as a dense texture**, with no weekly aggregation (UI consult Q4).
6. **The table shows no per-row source.** The caption lists every source in the window (finance consult Q5).

**Other assumptions:**
- `close` is raw (unadjusted). This is unverified per ADR 0001, so the caption says "chưa điều chỉnh".
- A stored bar on a date that settings mark as a holiday, or on a weekend, is not shown. That would mean the holiday list is wrong. It is a data-hygiene follow-up, not this chart's job.
- With an incomplete holiday list, holidays may appear as recorded gaps (finance finding 3). The chart displays the stored truth and does not try to tell them apart.
- One chart per page, so the static `<pattern id="gap-hatch">` cannot collide.
- Estimated size is about 550 non-test lines and about 1,100 including tests (see Split proposal).

**Follow-ups (not in this diff):**
- Ex-date markers on the symbol chart, from `corporate_actions`, with a note on coverage limits.
- An adjusted price series and MA overlays (gated on ADR 0001).
- Seed the VN holiday calendar for 2025–2026 in settings, before or alongside running STK-032.
- Verify the volume unit (shares?) and whether it includes put-through volume. Add both to ADR 0001's dry-run checklist, then add the "cp" unit label and a compact volume formatter.
- Illiquid/UPCoM no-trade days showing as gaps.
- Before go-live (STK-018): this page exposes portfolio data without auth (R6 suspended).

## Blocking questions
None

## Split proposal
None.
- The estimate (about 1,100 lines including tests, about 550 without) is above the ~400-line guide. However, this ticket is already slice 2 of STK-016 and covers a single feature.
- Splitting it further would leave one slice of core and db code with no user-visible acceptance criterion, plus a second slice of thin components.
- Scope is already trimmed to keep it to one cycle: no ex-date markers, no compact formatter, 2 price ticks, 3 x labels, no new query shape.
- If review flags the size, the fallback split is:
  - Slice A: core `chart-series` + `listCloseHistory` + loader, covering AC2 and AC3.
  - Slice B: component, page and text helpers, covering AC1 and AC4.
