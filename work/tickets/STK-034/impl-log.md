
## Attempt 1 — 2026-10-30

### Files touched
| File | Required because |
|---|---|
| packages/core/src/market/chart-series.ts (new) | Pure series/geometry: ranges, window, slots, segments, bands, volume, stats (AC1, AC2, R1) |
| packages/core/src/market/chart-series.test.ts (new) | Unit tests for the above (R8) |
| packages/core/src/market/price-gaps.ts | Shared `PRICES_GAP_TYPE` constant |
| packages/core/src/index.ts | Public exports |
| apps/worker/src/jobs/eod-sync.ts | Import + re-export `PRICES_GAP_TYPE` from core (no duplicate string) |
| packages/db/src/repos/prices-daily.ts | `listCloseHistory` (AC3) |
| packages/db/src/repos/prices-daily.test.ts | `listCloseHistory` tests |
| packages/db/src/index.ts | Export `listCloseHistory` |
| apps/web/lib/chart-range-query.ts (+ .test.ts, new) | `?range=` whitelist and href builder |
| apps/web/lib/price-chart-text.ts (+ .test.ts, new) | Vietnamese summary / status strings |
| apps/web/server/symbols/load-symbol.ts (+ .test.ts) | Loader reads history and gaps, builds `chart` |
| apps/web/components/symbol/price-chart.tsx (+ .test.tsx, new) | Chart, tabs, legend, caption, table fallback |
| apps/web/app/(app)/symbols/[symbol]/page.tsx | `searchParams` -> range, render `PriceChart` |

### Tests added / changed
- chart-series.test.ts: months/clamp/leap, chartWindow, off-axis days, gap split, dot, recorded vs unrecorded, bar beats gap, epoch-ms containment, bands, trailing band, volume, ticks/flat, x labels, stats, empty, ignored bars, 250-slot robustness
- prices-daily.test.ts › listCloseHistory (query shape + mapping, empty, errors)
- chart-range-query.test.ts, price-chart-text.test.ts, price-chart.test.tsx, load-symbol.test.ts › loadSymbol chart (4 tests)

### Checks (actual output summary)
- typecheck: all 4 workspace projects Done, no errors
- lint: all Done, no errors or warnings
- test: core 429 passed; db 110 passed (1 todo); worker 94 passed; web 197 passed (23 files)

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Ex-date markers, adjusted series / MA overlays, VN holiday seed, volume unit verification (as in plan).

### Scope self-check
- Could the diff be smaller? No; a bounded feature as planned.
- Diff size: about +1,000 lines including tests.
