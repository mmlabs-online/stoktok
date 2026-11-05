## Attempt 1 — 2026-11-05

### Files touched
| File | Required because |
|---|---|
| packages/core/src/lottery/{types,config,combinations,tax,check,summary,index}.ts | New pure lottery domain module (AC1-AC5) |
| packages/core/src/lottery/{config,combinations,tax,check,summary}.test.ts | Plan test list (AC6) |
| packages/core/src/money.ts, money.test.ts | `floorDiv` (BigInt-exact) for jackpot shares, tests |
| packages/core/src/index.ts | Re-export lottery API and `floorDiv` |

### Tests added / changed
- All tests listed in the plan for config, combinations, tax, check, summary, money (floorDiv).

### Checks (actual output summary)
- typecheck: green (all workspaces; ran `pnpm install --frozen-lockfile` first, node_modules was missing)
- lint: green (all workspaces)
- test: green (core 646 passed; sources 24, db 128, worker 229, web 300)

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Fixed prize amounts and Power bao range are unverified defaults (plan A5); check against vietlott.vn before go-live.

### Scope self-check
- Could the diff be smaller? No.
- Diff size: ~+900 lines (about half tests), 0 removed.
