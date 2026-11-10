# Impl log: STK-069 (slice a)

## Attempt 1

### Files touched
| File | Required because |
|---|---|
| supabase/migrations/20261110000100_ai_reserve_harden.sql (new) | AC1: `create or replace` of `ai_reserve`, guard rejects reserve <= 0 and a window not containing `now()`; grants restated |
| supabase/rollback/20261110000100_ai_reserve_harden.down.sql (new) | AC2: restores slice-1 body, no drop |
| scripts/db-check/checks.sql | AC3/AC4: `ai_reserve_gate` only; reserve 1 at cap, windows derived from `now()`, new cases, row-count assertion |
| packages/db/src/client.ts | AC5: `Db` = `Pick<SupabaseClient, 'from' \| 'rpc'>` |
| packages/db/src/repos/ai-usage.ts | AC5: `AiDb` removed, uses `Db` |
| packages/db/src/repos/ai-usage.test.ts | AC5: retyped to `Db` |
| packages/core/src/ai/config.ts | AC6: prices must be positive integers |
| packages/core/src/ai/config.test.ts | AC6: zero input/output price rows |
| packages/core/src/ai/cost.test.ts | AC7: worst case >= 1 test |
| docs/adr/0008-ai-budget-reservation.md | AC8: wording and hardening note |

### Tests added
- checks.sql: zero reserve under cap, past window, future window, window ends at now (all 22023), rows unchanged after rejections, window starting at now granted, reserve 1 at cap refused.
- config.test.ts: zero input price, zero output price.
- cost.test.ts: worst case >= 1 for every provider/task.

### Check results
- `pnpm typecheck`: green
- `pnpm lint`: green
- `pnpm test`: green
- `pnpm db:check`: `db:check OK` (rollback newest-first, re-apply, checks after re-apply)

### Out-of-plan files
None.

### Follow-ups
- `git diff main -- 20261109000100_ai_usage.sql` is non-empty only because the local `main` lacks that file; the file is unmodified in the working tree (not in `git status`).

### Scope self-check
Only plan files touched; nothing from slice b. Not committed (orchestrator commits).
