## Attempt 1 — 2026-11-01

### Files touched
| File | Required because |
|---|---|
| packages/core/src/market/quarters.ts | `isPeriodInWindow` predicate (AC1) |
| packages/core/src/index.ts | export it |
| packages/core/src/market/quarters.test.ts | unit test for it (R8) |
| apps/worker/src/config.ts | `nonFailingRejectReasons` (R5, AC4) |
| apps/worker/src/config.test.ts | pins the default |
| apps/worker/src/jobs/financials-sync.ts | classify rejects, new summary keys, `ok` meaning, log line |
| apps/worker/src/jobs/financials-sync.test.ts | new "run health (STK-041)" tests incl. 11-symbol replay |
| docs/adr/0005-vci-iq-financials-source.md | decision 8, emitted-range sentence |
| apps/worker/README.md | exit-code sentence |

### Tests added / changed
- quarters.test.ts › isPeriodInWindow
- config.test.ts › nonFailingRejectReasons default
- financials-sync.test.ts › run health: before-window, after-window, in-window missing_shares/missing_eps, period-less, unsupported (12 gaps, idempotent, one log line), unsupported plus failing, config-driven list, replay ok true / ok false

### Checks (actual output summary)
- typecheck: green (core, db, web, worker)
- lint: green, no warnings
- test: core 494, db 117 (1 todo), worker 174, web 214 passed; 0 failed

### Out-of-plan files
None. apps/web/next-env.d.ts unchanged.

### Follow-ups (noticed, not done)
- README "Financials sync" section still describes TCBS/ADR 0002 (from STK-039).
- In the "reason list comes from config" test, the empty list yields rejected 12 (4 of the 16 bank rejects are out-of-window), not 16.

### Scope self-check
- Could the diff be smaller? No.
- Diff size: see git diff --stat (about +120 lines incl. tests)
