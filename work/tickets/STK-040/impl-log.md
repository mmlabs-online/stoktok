## Attempt 1 — 2026-11-01

### Files touched
| File | Required because |
|---|---|
| packages/core/src/market/adjusted-history.ts (new) | Detection rule + reason constant in core (R1/R8) |
| packages/core/src/market/adjusted-history.test.ts (new) | Unit tests (R8) |
| packages/core/src/index.ts | Export helper and constant |
| apps/worker/src/sources/price-source.ts | `rejectOnOrBefore` ctx and `adjustedCutoff` result (optional fields) |
| apps/worker/src/sources/vci.ts | Compute cut-off, reject bars on or before it, return `adjustedCutoff`; doc comment |
| apps/worker/src/sources/vci.test.ts | Adapter tests |
| apps/worker/src/jobs/eod-sync.ts | Per-symbol cut-off carried across chunks, log lines, `ok` rule |
| apps/worker/src/jobs/eod-sync.test.ts | Job tests (fake source + real VCI adapter with fake fetch); widened fakeSource ctx type |
| apps/worker/test/fixtures/vci/chart-adjusted-mixed.json (new), chart-adjusted-latest.json (new), README.md | Fixtures and inventory |
| docs/adr/0004-vci-eod-price-source.md | Finding and guard; checklist item 3; UNVERIFIED list |

### Tests added / changed
- adjusted-history.test.ts: reason code, all-integer null, one fractional, latest of several/unsorted, each field, undefined date, non-number values
- vci.test.ts (describe "VciPriceSource adjusted history"): mixed response, integer coincidence, bars after cut-off, fractional outside range, invalid t, newest bar fractional, ctx.rejectOnOrBefore, no adjustedCutoff on all-integer
- eod-sync.test.ts (describe "runEodSync adjusted history"): cut-off passed to older chunks, ok true on adjusted-only, newest-window ok false, other reasons flip ok, VCI backfill across chunks (prior rows untouched, only post-cut-off date upserted)

### Checks (actual output summary)
- typecheck: all workspaces Done, no errors (Node 22)
- lint: all workspaces Done, no errors
- test: core 484 passed, db 117 passed + 1 todo, worker 139 passed, web 214 passed

### Out-of-plan files
None. `tcbs.ts` unchanged (typecheck passes).

### Follow-ups (noticed, not done)
- Test names differ slightly from the plan list (describe names carry the context); coverage is the same.

### Scope self-check
- Could the diff be smaller? No
- Diff size: ~+277 / -18 tracked lines plus new files; not committed per instructions
