
## Attempt 1 — 2026-10-30

### Files touched
| File | Required because |
|---|---|
| packages/core/src/signals/raw-price-guard.ts (new) | AC1/AC2: pure guard, limits from config |
| packages/core/src/signals/raw-price-guard.test.ts (new) | AC4, R8 |
| packages/core/src/signals/types.ts | new reason codes; `exchange`/`corporateActions` on SymbolData; `priceLimitPpm` on RuleContext |
| packages/core/src/signals/moving-average.ts | call the guard, push reasons, `inputs.guard`, action refs |
| packages/core/src/signals/moving-average.test.ts | helper update, A9 rewrite (±20% cases to in-limit), guard integration tests |
| packages/core/src/signals/evaluate.ts | new inputs plumbed per symbol |
| packages/core/src/signals/evaluate.test.ts | new inputs; routing test |
| packages/core/src/signals/fixtures.ts | new required fields |
| packages/core/src/signals/growth.test.ts | type-only literal update |
| packages/core/src/index.ts | exports for worker/STK-032 |
| packages/db/src/repos/corporate-actions.ts (+ .test.ts) | `symbols` filter, empty short-circuit |
| apps/worker/src/jobs/medium-signals.ts (+ .test.ts) | store methods read before evaluate; errors propagate |
| apps/worker/src/store.ts (+ .test.ts) | wiring, chunked corporate action reads |
| apps/worker/README.md | one sentence on the new suppression reasons |

### Tests added / changed
- raw-price-guard.test (all guard cases from the plan), moving-average.test (rewritten first case + 4 guard tests), evaluate.test (routing), corporate-actions.test (symbols filter), store.test (chunking/wiring), medium-signals.test (stock dividend suppressed, rejection fail-safe, unknown exchange).

### Checks (actual output summary)
- typecheck: all 4 workspaces pass
- lint: all pass
- test: core, db (106 passed), worker (78 passed), web (176 passed) all pass

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Those listed in plan.md (a)-(g).

### Scope self-check
- Could the diff be smaller? No.
- Diff size: see git diff --shortstat.
