## Attempt 1 — 2026-10-29

### Files touched
| File | Required because |
|---|---|
| packages/core/src/calendar.ts | `tradingDaysBetween`, `vnDayBoundsUtc` (plan) |
| packages/core/src/calendar.test.ts | tests for both helpers |
| packages/core/src/market/price-gaps.ts (new) | `planPriceGaps`, `priceGapReadRange` |
| packages/core/src/market/price-gaps.test.ts (new) | planning tests |
| packages/core/src/signals/inputs.ts | `vnDayBounds` reuses `vnDayBoundsUtc` |
| packages/core/src/index.ts | exports |
| packages/db/src/repos/prices-daily.ts | `listPriceDates` (via existing `fetchAll`), `getFirstPriceDates` |
| packages/db/src/repos/prices-daily.test.ts | fake-client tests |
| packages/db/src/rows.ts, mappers.ts | `TradeDateRow`, `tradeDateFromRow` |
| packages/db/src/repos/data-gaps.ts (+ test) | `resolveGaps` adds `.is('resolved_at', null)` |
| packages/db/src/index.ts | exports |
| apps/worker/src/jobs/eod-sync.ts | gap step, `PRICES_GAP_TYPE`, store and summary fields |
| apps/worker/src/jobs/eod-sync.test.ts | stateful memory store, 8 gap tests |
| apps/worker/src/jobs/medium-signals.ts | import `PRICES_GAP_TYPE` from eod-sync |
| apps/worker/src/store.ts, store.test.ts | wiring |

### Tests added / changed
- calendar.test.ts › tradingDaysBetween (3), vnDayBoundsUtc (2)
- price-gaps.test.ts › planPriceGaps (10), priceGapReadRange (2)
- prices-daily.test.ts › listPriceDates (3), getFirstPriceDates (2)
- data-gaps.test.ts › resolveGaps asserts the `is` filter
- eod-sync.test.ts › gap detection (8: record, holiday, re-run, +00:00, resolve, first-date clamp, failed symbol, dryRun)
- store.test.ts › createDbEodStore gap wiring

### Checks (actual output summary)
- typecheck: pass (core, db, worker, web)
- lint: pass
- test: core 365 passed, db 105 passed + 1 todo, worker 74 passed, web 176 passed
- db:check: not run, no migrations

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- As listed in plan.md (unique index, run lock, market-wide gaps, insertGaps chunking, intraday detection).

### Scope self-check
- Could the diff be smaller? No. `listPriceDates` reuses the existing `fetchAll` helper rather than a new loop.
- Diff size: about +351 / -18 tracked, plus 2 new core files. Not committed, per instruction.
