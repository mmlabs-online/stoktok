## Attempt 1 — 2026-11-05

### Files touched
| File | Required because |
|---|---|
| packages/core/src/market/refresh-view.ts (new) | Refresh contract and session/label decisions in core (R1/R5) |
| packages/core/src/market/refresh-view.test.ts (new) | R8 |
| packages/core/src/format.ts, format.test.ts | `formatTime` (VN HH:mm:ss) |
| packages/core/src/index.ts | Export new functions and types |
| apps/web/lib/refresh-scheduler.ts, .test.ts (new) | DOM-free scheduler and fake-timer tests |
| apps/web/components/price-refresh-bar.tsx, .test.tsx (new) | Client bar and its markup tests |
| apps/web/app/(app)/prices/actions.ts (new) | Interim `refreshPricesAction` (requireUser, no source call) |
| apps/web/test/refresh-action.test.ts (new) | R6 order and no-source check |
| apps/web/server/{dashboard,watchlist,symbols}/load-*.ts and tests | `refreshBar` built server-side |
| apps/web/components/symbol/symbol-header.tsx | `refresh` slot; "Phiên" moved beside h1 |
| apps/web/app/(app)/page.tsx, watchlist/page.tsx, symbols/[symbol]/page.tsx | Place the bar |

### Tests added / changed
- core refresh-view.test.ts: session state, msUntilNextSessionOpen, storedOnlyRefreshResult, all bar-view states, boundaries, oldest-wins, missing, failed labels, announcements, note/interval
- core format.test.ts › formatTime
- web lib/refresh-scheduler.test.ts (13 tests: interval, closed, wake-up, hidden/visible, no overlap, refreshNow, throttle, stop, reject, busy, dispose)
- web components/price-refresh-bar.test.tsx (states, failed, status region, button, busy, note, smoke)
- web test/refresh-action.test.ts
- load-dashboard / load-watchlist / load-symbol tests › refreshBar

### Checks (actual output summary)
- typecheck: all workspaces Done, no errors
- lint: all workspaces Done, no errors
- test: core 593 passed, sources 24, db 128, worker 229, web 295 passed (38 files)
- build: apps/web build Done (next build)

### Out-of-plan files
None. `useEffectEvent` is available in the installed React and passed lint, so no ref fallback was needed.

### Follow-ups (noticed, not done)
- Per the plan: per-row time, offline state, jsdom DOM tests, button cool-down (after STK-050).
- STK-050 should replace only the body of `refreshPricesAction`.

### Scope self-check
- Could the diff be smaller? No.
- Diff size: about +900 lines including tests (git not available here; no commit made, as instructed).

## Attempt 3 (REWORK 2: security-review findings 1 and 2)

Files touched
- apps/web/lib/refresh-scheduler.ts: failure backoff (interval, 2x interval; the 3rd consecutive failure stops polling until "Làm mới", which resets the count; success resets); `replan()` added; `onBusy(false)` now always runs, including after dispose. Required by findings 1 and 2.
- apps/web/components/price-refresh-bar.tsx: scheduler is created once per mounted bar (`[]` deps); view changes call `replan()` instead of dispose/recreate, so a new scheduler can never overlap an in-flight call. Required by finding 2.
- apps/web/lib/refresh-scheduler.test.ts: tests for backoff timing, stop after 3, button reset, success reset, dispose mid-call clears busy, replan.

Notes
- Intervals derive from the configured `intervalMs` (R5); no literals in components. `MAX_FAILURES = 3` is a scheduler constant.
- The stopped state reuses the existing "failed" label (no new core label); the Làm mới button stays active.
- `replan` is ignored while failures > 0 so server data cannot cancel backoff/stop.

Checks: typecheck OK, lint OK, test OK (web 38 files / 299 tests passed), build OK.
Out-of-plan files: none. Follow-ups: optional distinct "stopped" label in core. Not committed (as instructed).

## Attempt 3 (REWORK 3: review attempt 2, issues 1 and 2)

Files touched
- apps/web/lib/refresh-scheduler.ts: backoff wait is now `intervalMs * 2 ** failures` (60 s after the 1st failure, 120 s after the 2nd, stop at the 3rd). `expectOpen = sessionOpen || nextInMs > 0` is recorded in `plan()` and used in the failure branch, so a failure while closed (lunch press, failed wake-up) still backs off and retries. Required by issues 1 and 2.
- apps/web/lib/refresh-scheduler.test.ts: backoff test rewritten with exact timing (60 000 - 1 / 60 000, 120 000 - 1 / 120 000, then no calls for 20 intervals; replan-ignored and button-reset kept); "success resets" timings updated (fail, 60 s, ok, 30 s, fail, 60 s); "keeps polling" test waits 60 s; new test for a failed wake-up while closed. Required by issues 1 and 2.

Checks: typecheck OK, lint OK, test OK (web 38 files / 300 tests), build OK.
Out-of-plan files: none. Follow-ups: as in review.md. I did not commit.
