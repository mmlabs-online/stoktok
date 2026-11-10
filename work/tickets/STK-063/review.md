## Attempt 1 — 2026-11-10 (slice 1 of 3)
Verdict: REWORK

### Checks (run by reviewer)
- typecheck: green (all packages, exit 0).
- lint: green (all packages, exit 0).
- test: green. core 763 passed (64 files), db 164 passed + 1 todo, sources 35, worker 292, web 302. Matches impl-log.md.
- db:check: "db:check OK" (apply, checks, rollback, re-apply, checks).
- `git diff --stat origin/main...HEAD -- pnpm-lock.yaml`: empty (no new dependency).
- `grep -rn "claude-\|gemini-" packages/ apps/ --include=*.ts` (excluding `ai/config.ts` and tests): no hits.

### Acceptance criteria (plan, slice 1)
- [x] 1 AI config is static, validated, fail closed. Evidence: `packages/core/src/ai/config.ts:211-257`; `config.test.ts` › "AI_CONFIG is valid", "every model in modelsByTask has a price row", and the 9 "validateAiConfig rejects" cases pass. The model-ID grep is clean.
- [x] 2 Cost is exact BigInt with one ceil, and thinking counts as output. Evidence: `cost.ts:354-365`, `money.ts` `ceilDiv`; `cost.test.ts` (8 usageCost tests), `money.test.ts` › ceilDiv pass.
- [x] 3 Worst-case estimate. Evidence: `cost.ts:383-392`; `cost.test.ts` › UTF-8 bytes ('Đầu tư' = 10), overhead, max output + thinking, and "worst case >= usage" pass.
- [x] 4 VN month window [from, to). Evidence: `budget.ts:105-110`; `budget.test.ts` › mid-month, 16:59:59.999Z/17:00Z rollover, and year rollover pass.
- [x] 5 Levels and gate at 79/80/100%. Evidence: `budget.ts:112-122`; `budget.test.ts` › 3_950_000 ok … 5_500_000 exhausted; fitsBudget cases pass.
- [x] 6 Provider selection. Evidence: `select-provider.ts`; 6 tests pass (defaults, fallback, explicit disabled, none, custom model).
- [x] 7 Vietnamese messages. Evidence: `messages-vi.ts`; `messages-vi.test.ts` (4 tests) pass.
- [x] 8 Migration: RLS on, service_role only, rollback. Evidence: `20261109000100_ai_usage.sql:972-999`; the `ai_usage_columns`, `service_role_can_read_write_ai_usage` and `ai_usage_negatives` checks pass, and rollback/re-apply is green in db:check.
- [ ] 9 Atomic budget gate. The gate logic, privileges and hardening are verified (`ai_reserve_gate`, `ai_functions_locked` green). But the gate **fails open on NULL window arguments**. See Issue 1.
- [x] 10 Usage repo. Evidence: `packages/db/src/repos/ai-usage.ts`; `ai-usage.test.ts` (8 tests) pass. The `AiDb` local type is a documented deviation inside a planned file. Acceptable.
- [x] 11 ADR 0008 covers the SQL-function rationale, hardening, stale-reservation policy, worst-case formula, the over-estimate trade-off and verify-before-go-live prices.
- [x] 12 Checks green, no network, lockfile unchanged.

### Issues
#### Issue 1 — 🔴 blocker — correctness / security (hard cap fails open)
- **Where**: `supabase/migrations/20261109000100_ai_usage.sql:52` (the argument guard in `public.ai_reserve`).
- **Expected**: The cap is "hard", and the gate must fail closed for every bad input. If any argument is NULL, the function must raise `22023` and insert nothing.
- **Actual**: The guard is `if p_reserve_micro_usd < 0 or p_cap_micro_usd <= 0 or p_from >= p_to then raise`. Under SQL three-valued logic, a NULL `p_from` or `p_to` makes the condition NULL, so it does not raise. The sum `where created_at >= NULL` then matches no rows, so `v_spent = 0`, and the call is **granted** whatever the real month spend is. A NULL `p_reserve_micro_usd` or `p_cap_micro_usd` happens to fail closed today, but only by accident (a not-null violation or a NULL `v_granted`). No current caller passes NULL, but once this migration ships, fixing it needs a new migration. That is why it must be fixed now.
- **Fix instruction**:
  1. Change the guard to: `if p_provider is null or p_model is null or p_task is null or p_reserve_micro_usd is null or p_cap_micro_usd is null or p_from is null or p_to is null or p_reserve_micro_usd < 0 or p_cap_micro_usd <= 0 or p_from >= p_to then raise exception 'invalid ai_reserve arguments' using errcode = '22023'; end if;`. You can also declare the function `strict`, but then NULL returns no row instead of raising; prefer the explicit raise.
  2. In `scripts/db-check/checks.sql`, block `ai_reserve_gate` (around line 546), add `pg_temp.expect_fail` cases (as service_role) that call `public.ai_reserve` with `p_from` NULL, with `p_to` NULL and with `p_cap_micro_usd` NULL, each expecting `22023`. Also add `from >= to` and `reserve < 0`, which are not covered today. If `expect_fail` only takes insert SQL, use `select public.ai_reserve(...)` as the statement text.
  3. Re-run `pnpm db:check`.

### Rules R1–R10
No violations found. R2: AI cost is integer micro-USD with BigInt math and one `ceilDiv` in `money.ts`. The planner flagged the USD unit and the ticket requires it. R3: no keys or SDKs. R5: models, prices, cap and thresholds are in `AI_CONFIG`. R7: every changed code file is in the plan's list. The `work/` files are workflow bookkeeping. R8: core logic has tests. R9: no prompt or output columns.

### Nits (do not block)
- `packages/core/src/ai/messages-vi.ts:7`: `Math.ceil(microUsd / 10_000)` uses float division. It is exact for safe integers here and display-only, but `ceilDiv(BigInt(microUsd), 10_000n)` would reuse the single rounding helper. Negative input would render oddly. Either guard it or document it as non-negative.
- `packages/db/src/rows.ts` `AiUsageSettle`: the type allows `costMicroUsd: null` with `status: 'ok' | 'invalid_output'`, and the DB check then rejects it at runtime. A discriminated union would catch this at compile time.
- `budget.test.ts` › "a new month starts at 0 spent" only exercises `fitsBudget(0, …)`. The rollover itself is covered by the window tests, so this is fine. The name just overstates what it checks.

### Follow-ups (out of scope)
- Widen `Db` in `packages/db/src/client.ts` to include `rpc` and drop `AiDb` (slice 2, as the implementer noted).
- Manual sweep for stale `reserved` rows; re-verify model IDs and prices before go-live.
- The security auditor must still run at REVIEW (the diff touches a migration and the first SQL function). No `security-review.md` is in the ticket folder yet.
