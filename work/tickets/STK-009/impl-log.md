## Attempt 1 — 2026-10-23

Slice 1 only (dashboard). Assets CRUD is STK-030 and was not built. R6 suspended: no auth code added.

### Files touched
| File | Required because |
|---|---|
| packages/core/src/calendar.ts | `previousTradingDay`, `vnMinutesOf` (AC5) |
| packages/core/src/calendar.test.ts | tests for the two helpers (R8) |
| packages/core/src/portfolio/config.ts (new) | R5 defaults and `resolveConcentrationThreshold` |
| packages/core/src/portfolio/freshness.ts (new) | `expectedPriceDate`, `priceStatus` (R4) |
| packages/core/src/portfolio/freshness.test.ts (new) | R8 |
| packages/core/src/portfolio/build-portfolio.ts (new) | MV, weights, concentration, totals, net worth in core (R1/R2). Also exposes `totals.nonStockAssets` (cash + other) so the UI does no addition |
| packages/core/src/portfolio/build-portfolio.test.ts (new) | R8, AC2 |
| packages/core/src/index.ts | exports |
| packages/db/src/repos/prices-daily.ts (new) | `getLatestCloses` |
| packages/db/src/repos/prices-daily.test.ts (new) | R8 |
| packages/db/src/rows.ts | `PriceDailyRow` |
| packages/db/src/mappers.ts | `priceQuoteFromRow` (R2, R4) |
| packages/db/src/repos/settings.ts | `getConcentrationThreshold` (separate select; `COLS`, `saveSettings` unchanged) |
| packages/db/src/repos/settings.test.ts | tests for it |
| packages/db/src/index.ts | exports |
| apps/web/server/clock.ts | `nowInstant()` |
| apps/web/server/dashboard/load-dashboard.ts (new) | loader; discriminated result, uses `getEntrySettings` so no NOT_CONFIGURED 500 |
| apps/web/server/dashboard/load-dashboard.test.ts (new) | no-500 guarantees, AC4/AC6 |
| apps/web/components/portfolio/portfolio-summary.tsx (new) | stat cards and notes |
| apps/web/components/portfolio/holdings-table.tsx (new) | table + cards, weight bar, warnings, freshness |
| apps/web/components/portfolio/portfolio.test.tsx (new) | render tests |
| apps/web/app/(app)/page.tsx | dashboard page, `force-dynamic` |

### Tests added / changed
- calendar.test.ts › previousTradingDay (weekday/weekend/Tết block), vnMinutesOf (cutoff boundary, UTC rollover)
- freshness.test.ts › expectedPriceDate (7 cases), priceStatus
- build-portfolio.test.ts › valuation, rows, weights, concentration (boundary/exact/threshold/null default), realized, net worth, totals %, empty ledger
- prices-daily.test.ts › getLatestCloses (query shape, omitted symbol, empty input, DB error, MAPPING)
- settings.test.ts › getConcentrationThreshold
- load-dashboard.test.ts › 8 cases (fee NULL, row missing, threshold default, empty prices, OVERSELL, no txs, symbols passed, assets in totals)
- portfolio.test.tsx › 7 cases (columns, warning + banner, bar width, stale, missing, summary notes, no notes when complete)
- Not written: the plan's empty-state render test. The empty states are inline in `page.tsx` (an async server component calling the DB), so it is covered only by `load-dashboard.test.ts › no transactions → hasTransactions false`. A render test would need the page extracted into a component.

### Checks (actual output summary)
- pnpm install: lockfile up to date, nothing to install
- typecheck: pass (core, worker, db, web)
- lint: pass (one `no-useless-assignment` in `previousTradingDay` found and fixed, then re-run green)
- test: core 17 files / 169 tests; db 9 files / 47 passed + 1 todo; web 10 files / 89 tests; all pass
- build: pass; `/` is dynamic (ƒ), so no DB query at build time
- check:service-key: OK, no service key material in client bundle

### Out-of-plan files
- packages/db/test/fake-client.ts — added `'limit'` to the fake query-builder METHODS; `getLatestCloses` chains `.limit(1)` and the fake did not support it.

### Follow-ups (noticed, not done)
- Extract the dashboard page body into a component so the empty states can have render tests.
- From the plan: liabilities/margin asset type; `data_gaps`-aware staleness once STK-005 lands; price-unit sanity check in the STK-005 adapter; "net if sold" P&L; allocation bar; value-history chart.
- `unrealizedPnlPpm` throws RangeError (not safe integer) if a position's P&L is more than about 9e9 times its cost. This is unrealistic with real data.

### Scope self-check
- Could the diff be smaller? No. Every file is in the plan, plus the one fake-client line.
- Diff size: see `git diff --shortstat` (new files are untracked). Nothing committed or pushed, per instructions.
