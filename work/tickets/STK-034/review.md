## Attempt 1 — 2026-10-30
Verdict: PASS

### Checks (run by reviewer)
- typecheck: `pnpm typecheck`: core, db, web (with next typegen) and worker all Done, no errors
- lint: `pnpm lint`: all 4 projects Done, no errors or warnings
- test: `pnpm test`: core 36 files / 429 passed; db 14 files / 110 passed + 1 todo; worker 8 files / 94 passed; web 23 files / 197 passed. These match impl-log.md.

### Acceptance criteria
- [x] Price + volume chart with range tabs (`?range=`, server-rendered links). Missing days from `data_gaps` are shown as gaps and never interpolated (R4). Evidence:
  - `chart-range-query.test.ts` covers the whitelist, the 3T default and the array param.
  - `price-chart.test.tsx` › "tabs are 4 links … aria-current only on the active one" and › "draws one path per segment, none spanning a missing slot".
  - `chart-series.test.ts` › "a missing day splits the line into two segments…", › "classifies recorded vs unrecorded" and › "a stored bar beats an open gap".
  - `load-symbol.test.ts` › "reads history for the range window and both gap lists" and › "a market-wide gap reaches the chart as gap_recorded".
  - The component has no `'use client'`. Tabs are `next/link` with hrefs built by `chartRangeHref`.
- [x] Own SVG, no new dependency. Series and geometry live in core with unit tests, and components only map outputs (R1). Evidence:
  - `git diff origin/main...HEAD -- '**/package.json' pnpm-lock.yaml` is empty.
  - `packages/core/src/market/chart-series.ts` builds slots from `tradingDaysBetween`, so weekends and holidays are off-axis (test › "slots are trading days only").
  - `no-calc-in-ui.test.ts` passes. The only arithmetic left in the component is the constant geometry noted in Issue 1.
- [x] New db read `listCloseHistory` (date range, close + volume + source + fetched_at) with tests. Evidence: `packages/db/src/repos/prices-daily.ts:61-83`. `prices-daily.test.ts` › `listCloseHistory` covers the query shape, ascending order, `range(0,999)`, mapping, the empty result, DB_ERROR and MAPPING.
- [x] Accessible: figure summary label and table fallback; recorded gaps are distinguished from unrecorded missing days. Evidence:
  - `<svg role="img" aria-label={chartSummaryLabel…}>`. The legend, figcaption and `<details>` table are siblings of the svg, not children.
  - The table has one row per slot, newest first, with a status column.
  - Recorded gaps use a hatch fill and unrecorded days a dashed outline.
  - Tests: `price-chart.test.tsx` (svg/legend/table tests) and `price-chart-text.test.ts` (summary counts, no "%").

### Issues
#### Issue 1 — 🟡 should-fix — plan conformance (components map only)
- **Where**: `apps/web/components/symbol/price-chart.tsx:64,72` (`height={G.volumeTop + G.volumeHeight - G.priceTop}`) and `:89` (`x={G.plotLeft - 4}`)
- **Expected**: The plan's AC2 verification says the component "only maps fields … with no arithmetic".
- **Actual**: The component computes small constant geometry offsets. These are not financial and the R1 scan stays green, so this does not block.
- **Fix instruction** (next time this file is touched): add `bandY`, `bandHeight` and `tickLabelX` to `CHART_GEOMETRY` in `packages/core/src/market/chart-series.ts` and reference them directly.

### Rules R1–R10
No violations found.
- R1: all scale, path, band, volume and stats math is in core. Formatting uses core formatters.
- R2: VND values stay integers, and padding uses `mulDiv`. The float SVG coordinates are geometry, not money.
- R3: reads go through `apps/web/server/symbols/load-symbol.ts` → `../db`.
- R4: the caption shows source(s) and the latest fetched_at. Missing days are never interpolated.
- R5: holidays come from settings.
- R6: suspended, and no auth code was added.
- R7: every changed file is in the plan's file list (plus workflow files).
- R8: the new core code has unit tests.

### Nits (do not block)
- `price-chart.tsx:89`: `key={t.value}` gives duplicate React keys for a flat series (lo === hi), and the two tick labels overlap. Either key by index, or have core emit a single tick when lo === hi.
- `load-symbol.ts:102-110`: for an empty window the ternary builds `[[], [], []]`, whose element types depend on inference. Explicit typing would read more clearly.
- `chartWindow` for an empty window returns `{from: endDate, to: rangeStart}`, which encodes "empty" through the from > to inversion. A short comment at the return would help.

### Follow-ups (out of scope)
- Those listed in the plan: ex-date markers, adjusted series / MA overlays, seeding the VN holiday calendar, verifying the volume unit and adding a compact formatter, illiquid-day gaps, and auth before go-live (STK-018).
