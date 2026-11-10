## Attempt 1 — 2026-11-10 (slice a)
Verdict: PASS

### Checks (run by reviewer)
- typecheck: exit 0 (all workspaces)
- lint: exit 0
- test: exit 0 — core 766 passed, db 164 passed + 1 todo, sources 35 passed, worker 292 passed, web 302 passed
- db:check: `db:check OK` — apply all → checks → rollback newest-first (`20261110000100_ai_reserve_harden.down.sql` first) → re-apply → checks (after re-apply)
- Matches impl-log.md.

### Acceptance criteria (plan.md, slice a)
- [x] AC1 hardening migration — `supabase/migrations/20261110000100_ai_reserve_harden.sql:4-48`: `create or replace`, same signature/return/`security invoker`/`search_path = ''`/lock/sum/insert; guard adds `p_reserve_micro_usd <= 0` and `pg_catalog.now() < p_from or pg_catalog.now() >= p_to` (lines 22-27); revoke/grant restated (50-51). `git diff origin/main...HEAD -- supabase/migrations/20261109000100_ai_usage.sql` is empty. `ai_functions_locked` passes in both check runs.
- [x] AC2 rollback — `supabase/rollback/20261110000100_ai_reserve_harden.down.sql`: body is identical to `20261109000100_ai_usage.sql:34-77` except `or replace` (verified with `diff`); no drop; revoke/grant restated. db:check rollback + re-apply green.
- [x] AC3 new guard cases — `scripts/db-check/checks.sql` `ai_reserve_gate`: zero reserve under cap, past window, future window, window ends at now (all `22023`); window starting at now granted; reserve 1 at cap refused with spent 1000; row count asserted unchanged. db:check green.
- [x] AC4 windows from `now()` — no `'2026-` literal inside `ai_reserve_gate` (only hits are lines 305-384, other blocks); old negatives moved to `now() ± 1 day`; only "window ends at now" uses `p_to = now()`.
- [x] AC5 `Db` widened — `packages/db/src/client.ts:3` `Pick<SupabaseClient, 'from' | 'rpc'>`; `grep -rn AiDb` (excl. work/, node_modules) → no hits; typecheck green.
- [x] AC6 prices > 0 — `packages/core/src/ai/config.ts:62` uses `isPosInt`; `config.test.ts` › "zero input price", "zero output price" pass; "AI_CONFIG is valid" passes.
- [x] AC7 worst case ≥ 1 — `cost.test.ts` › "worst case is at least 1 micro-USD for every task and provider in AI_CONFIG" passes.
- [x] AC8 ADR — `docs/adr/0008-ai-budget-reservation.md`: no "never exceeded"; Decision 4 states the bound by one call's estimation error; Decision 2 names the migration and both guards; Status line amended.
- [x] AC9 — all four checks green; no network calls added.

### Issues
None.

### Scope
Changed files match the plan's file list. Other changes are orchestrator workflow files (`work/backlog.md`, `work/tickets/STK-069/*`). No slice-b content.

### Rules R1–R10
No violations found. R2: integer micro-USD only. R3: no client-reachable changes. R5: prices stay in config. R8: core change has unit tests.

### Nits (do not block)
- `checks.sql` row-count assertion ("rejected calls inserted rows") cannot fail on its own: `expect_fail` runs each statement in a subtransaction that rolls back on error, and a successful statement already fails `expect_fail`. It works as documentation, not as a separate check.
- "ai_reserve from >= to" (`now()+1d, now()-1d`) also fails the new `now()` check, so it does not isolate the `p_from >= p_to` reason. No inverted window can contain `now()`, so this cannot be fully isolated.

### Follow-ups (out of scope)
- Slice b (proposed STK-071) per plan.md "Split proposal": treat `22023` from clock skew at month rollover as fail-closed in the client.
- Ming to confirm that free (zero-price) models are not supported in v1 (plan Assumptions).
