## Attempt 1 — 2026-11-10 (slice 1 of 3)

### Files touched
| File | Required because |
|---|---|
| packages/core/src/ai/config.ts | AI_CONFIG, types, validateAiConfig (R5) |
| packages/core/src/ai/cost.ts | usageCostMicroUsd, worstCaseCostMicroUsd, utf8ByteLength, AiConfigError |
| packages/core/src/ai/budget.ts | month window, levels, fitsBudget, budgetStatus |
| packages/core/src/ai/select-provider.ts | provider selection |
| packages/core/src/ai/messages-vi.ts | Vietnamese refusal and warning text |
| packages/core/src/ai/index.ts | barrel |
| packages/core/src/ai/{config,cost,budget,select-provider,messages-vi}.test.ts | R8 unit tests |
| packages/core/src/money.ts, money.test.ts | ceilDiv (rounding defined once, R2) and its test |
| packages/core/src/index.ts | `export * from './ai'` |
| supabase/migrations/20261109000100_ai_usage.sql | table, RLS, grants, ai_reserve, ai_month_spend |
| supabase/rollback/20261109000100_ai_usage.down.sql | rollback |
| scripts/db-check/checks.sql | table list plus ai_usage columns, read/write, negatives, gate, locked-functions checks |
| packages/db/src/repos/ai-usage.ts, ai-usage.test.ts | reserve, settle, month-spend repo and tests |
| packages/db/test/fake-client.ts | added rpc() to the fake |
| packages/db/src/rows.ts | AiReserveRow, AiUsageSettle |
| packages/db/src/index.ts | exports |
| docs/adr/0008-ai-budget-reservation.md | ADR |

### Tests added / changed
- core: money.test › ceilDiv; ai/config, cost, budget, select-provider, messages-vi tests as listed in the plan (45 tests in ai/ plus 1 ceilDiv).
- db: repos/ai-usage.test (8 tests).
- checks.sql: ai_usage_columns, service_role_can_read_write_ai_usage, ai_usage_negatives, ai_reserve_gate, ai_functions_locked.

### Checks (actual output summary)
- typecheck: green, all packages.
- lint: green, all packages.
- test: core 763 passed, db 164 passed (1 todo), sources 35, worker 292, web 302; all green.
- db:check: "db:check OK" (apply, checks, rollback, re-apply, checks).
- pnpm-lock.yaml unchanged (I ran `pnpm install --frozen-lockfile` only because node_modules was missing).

### Out-of-plan files
None. Deviations inside planned files:
- `packages/core` type libs have no `TextEncoder`/`structuredClone`, so `utf8ByteLength` counts UTF-8 bytes by code point and the tests clone via JSON.
- `Db` (`Pick<SupabaseClient,'from'>`, in the unplanned `client.ts`) has no `rpc`. The repo declares `AiDb = Pick<SupabaseClient,'from'|'rpc'>` locally instead of editing `client.ts`.
- `settleAiUsage(db, id, settle, now)` takes `now` as a required injected argument.

### Follow-ups (noticed, not done)
- Widen `Db` in `packages/db/src/client.ts` to include `rpc` and drop `AiDb` (slice 2).
- Manual sweep for stale `reserved` rows; re-verify model IDs and prices before go-live.

### Scope self-check
- Could the diff be smaller? No; every file is in the plan.
- Diff size: about +1,000 lines new, 153 added / 17 removed in modified files.

## Attempt 2 — 2026-11-10 (REWORK: review attempt 1, Issue 1)

### Files touched
| File | Required because |
|---|---|
| supabase/migrations/20261109000100_ai_usage.sql | Issue 1: `ai_reserve` argument guard now raises 22023 on any NULL argument (fails closed) |
| scripts/db-check/checks.sql | Issue 1: `ai_reserve_gate` block gains expect_fail cases (service_role) for NULL from/to/cap/reserve, from >= to, reserve < 0, each expecting 22023 |

### Checks
- typecheck, lint: green.
- test: core 763, db 164 (1 todo), sources 35, worker 292, web 302; all passed.
- db:check: "db:check OK".

### Out-of-plan files
None.

### Follow-ups
None new. Review nits left untouched (out of rework scope).

### Scope self-check
Only the two files named in Issue 1 changed.
