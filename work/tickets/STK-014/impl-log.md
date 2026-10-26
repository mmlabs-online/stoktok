## Attempt 1 — 2026-10-26

Both slices (Commit A steps 1-9 and Commit B steps 10-11) implemented in the working tree. Not committed or pushed (caller's instruction).

### Files touched
| File | Required because |
|---|---|
| supabase/migrations/20261026000100_financials.sql | AC2: `financials` table, sector columns on `symbols`, RLS and grants |
| supabase/rollback/20261026000100_financials.down.sql | db:check rollback |
| scripts/db-check/checks.sql | AC2 checks (tables, columns, bad rows, service role) |
| packages/core/src/market/financials.ts | R1/R2: unit conversion, guards, sector label |
| packages/core/src/market/quarters.ts | period math, quarter bounds, publish lag, gap planning |
| packages/core/src/market/config.ts | R5: `DEFAULT_FINANCIALS_SANITY` |
| packages/core/src/index.ts | exports |
| packages/core/src/market/financials.test.ts, quarters.test.ts | R8 |
| packages/db/src/rows.ts, mappers.ts, index.ts | row types, mappers, exports (db `OpenGap` named `OpenGapRecord` to avoid clashing with the core `OpenGap` type) |
| packages/db/src/repos/financials.ts, data-gaps.ts | repos |
| packages/db/src/repos/symbols.ts | `setSymbolSector` |
| packages/db/test/fake-client.ts | `'is'` added to METHODS |
| packages/db/src/repos/financials.test.ts, data-gaps.test.ts, symbols.test.ts | repo tests |
| apps/worker/src/sources/financials-source.ts, tcbs-financials.ts | AC1 |
| apps/worker/src/jobs/financials-sync.ts | AC3 (upsert, gaps, sector, dry-run) |
| apps/worker/src/config.ts, store.ts, cli.ts | R5 config, store wiring, CLI dispatch |
| apps/worker/src/sources/tcbs-financials.test.ts, jobs/financials-sync.test.ts, store.test.ts, cli.test.ts | tests |
| apps/worker/test/fixtures/tcbs-financials/* | AC4, synthetic and labelled in README |
| package.json | `worker:financials` script |
| apps/worker/README.md | AC5 docs |
| docs/adr/0002-financials-source.md | ADR |

### Tests added / changed
- core: financials.test.ts and quarters.test.ts, all cases in the plan.
- db: financials, data-gaps, symbols (setSymbolSector, payload keys).
- worker: tcbs-financials.test.ts, financials-sync.test.ts, store.test.ts (financials wiring), cli.test.ts.
- Deviation: the plan's `latestExpectedPeriod` boundary examples are off by one (03-31 + 45 days = 05-15, not 05-14). Tests follow the stated definition (last day + lag on or before today): 05-14/45 -> 2025Q4, 05-15/45 -> 2026Q1, 05-14/44 -> 2026Q1.

### Checks (actual output summary)
- typecheck: green (core, db, web, worker).
- lint: green.
- test: core 287 passed; db 89 passed, 1 todo; worker 55 passed; web 148 passed.
- build: green.
- check:service-key: OK, no service key material in client bundle.
- db:check: OK (incl. rollback and re-apply).
- Dry run: scratch script outside the repo (`/tmp/claude-0/-home-user-stoktok/a3b909eb-ece1-56b0-9d9d-9c54d1ddc6ba/scratchpad/dry.mts`) ran `runFinancialsSync` with `dryRun: true`, `TcbsFinancialsSource` and a stubbed fetch serving the synthetic fixtures. Result: ok true, 6 periods fetched, 3 requests, 0 writes, no rejections, no missing periods.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- `listFinancials` and `listOpenGaps` are single queries and subject to the PostgREST 1000-row cap; fine for a small watchlist (12 quarters x symbols), paginate if the watchlist exceeds about 80 symbols.
- The job sleeps `requestDelayMs` before the sector request as well (one extra request per symbol, kept polite).
- Follow-ups listed in the plan remain open.

### Scope self-check
- Could the diff be smaller? No; each file is in the plan's list.
- Diff size: see `git diff --shortstat` (tracked files) plus new files.
