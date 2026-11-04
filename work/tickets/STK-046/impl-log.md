
## Attempt 1 — 2026-11-04

### Files touched
| File | Required because |
|---|---|
| packages/core/src/market/holiday-calendar.ts (new) | AC1/AC2: seeded calendar (38 dates, sources, provisional flags) and `effectiveHolidays` |
| packages/core/src/market/holiday-calendar.test.ts (new) | AC4 calendar, fallback, T+2 and freshness tests |
| packages/core/src/market/price-gaps.ts, price-gaps.test.ts | AC3: `GapResolvedReason`, `holidayOnlyGapIds` and tests |
| packages/core/src/index.ts | Export new symbols |
| packages/db/src/repos/settings.ts, settings.test.ts | AC2: `getSettings`/`getEntrySettings` return effective holidays; `getAppSettings`/saves stay raw |
| packages/db/src/repos/data-gaps.ts, data-gaps.test.ts | `resolveGaps` optional reason; new `listAllOpenGaps` |
| packages/db/src/index.ts | Export `listAllOpenGaps` |
| supabase/migrations/20261105000100_data_gaps_resolved_reason.sql, supabase/rollback/...down.sql (new) | Recorded reason column |
| scripts/db-check/checks.sql | Column, constraint and two expect_fail cases |
| apps/worker/src/jobs/eod-sync.ts, eod-sync.test.ts | EOD splits resolved gaps by reason |
| apps/worker/src/jobs/resolve-holiday-gaps.ts, .test.ts (new) | Cleanup job |
| apps/worker/src/config.ts, store.ts, store.test.ts, cli.ts, cli.test.ts | Config, wiring, CLI entry |
| package.json | `worker:holiday-gaps` script |
| apps/worker/README.md | Holidays section, job, first-run procedure, migration-before-image note, 2024 limit |

### Tests added / changed
- holiday-calendar.test.ts: ISO validity, weekdays only, ascending, years, name/source, provisional flags, 38-date snapshot, effectiveHolidays (empty/null/undefined/union/no dup/no mutation), T+2 across Tet, expectedPriceDate after Tet
- price-gaps.test.ts: holidayOnlyGapIds (6 cases)
- data-gaps.test.ts: resolveGaps with reason; listAllOpenGaps filters, order, paging
- settings.test.ts: effective holidays in getSettings/getEntrySettings (empty, missing row, union); getAppSettings raw; existing expectations updated to effective list
- eod-sync.test.ts: reason captured; holiday gap -> non_trading_day; bar arrived -> data_stored; existing order expectation now has two resolveGaps calls
- resolve-holiday-gaps.test.ts (5 cases), store.test.ts (holiday store, reason passthrough), cli.test.ts (parse cases)

### Checks (actual output summary)
- typecheck: pass (all workspaces)
- lint: pass (all workspaces)
- test: pass (core 516, db 121 + 1 todo, worker 236, web 214)
- db:check: not run, no Postgres server available in the sandbox (psql only). Reviewer to read the SQL.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Re-check HOSE/HNX notices for 2026-11-24 by about 2026-11-17 (D3).
- Source URLs in the seed are copied from the finance consult; all dates need verification on hsx.vn / hnx.vn before go-live.
- EOD gap step now always calls `resolveGaps` twice (the repo returns early on empty ids).

### Scope self-check
- Could the diff be smaller? No; the calendar data and tests are the bulk.
- Diff size: about +650 / -25 lines including the seed table and tests (not measured exactly).
