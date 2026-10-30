
# Attempt 1

## Files touched
| File | Required because |
|---|---|
| packages/core/src/market/backfill.ts (new) | `planBackfillChunks`, newest-first chunk planner (AC3) |
| packages/core/src/market/backfill.test.ts (new) | unit tests (R8) |
| packages/core/src/index.ts | export `planBackfillChunks` |
| apps/worker/src/config.ts | 4 backfill config keys (R5) |
| apps/worker/src/jobs/eod-sync.ts | backfill mode: chunked fetch, request cap, per-chunk lastClose chaining, `requestsPlanned`/`requestsMade`/`abortReason` |
| apps/worker/src/jobs/eod-sync.test.ts | backfill tests + daily regression (existing tests unmodified) |
| apps/worker/src/cli.ts | `--backfill [<n>]` parsing, USAGE, pass-through |
| apps/worker/src/cli.test.ts | parseArgs backfill cases |
| apps/worker/README.md | Backfill section |

## Tests added
backfill.test.ts (4), eod-sync.test.ts `backfill` describe (10), cli.test.ts `--backfill` (4). All offline (memory store / fake source).

## Checks
- pnpm typecheck: green (core, db, web, worker)
- pnpm lint: green
- pnpm test: green (worker 93 passed, web 176 passed, db 106 passed + 1 todo, core passed)

## Out-of-plan files
None.

## Follow-ups
As in plan.md (holiday pre-flight; verify TCBS range cap / raw vs adjusted; optional ingest reporting of beyond-limit moves).

## Scope self-check
No auth code, no migration, no change to tcbs.ts/price-source.ts/daily-bar.ts/signals. Not committed (per orchestrator).
