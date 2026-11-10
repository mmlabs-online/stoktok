# STK-069 security review

## STK-069 attempt 1 (slice a): security review

**Verdict: no 🔴 blockers.** STK-063 items 1 (window must contain `now()`) and 3 (zero reservation, prices > 0) are fixed, and both have negative tests. The ADR wording is fixed too. Nothing regressed. I could only read files: I did not run `git diff` or `checks.sql`. I checked the new migration line by line against the merged `20261109000100_ai_usage.sql`.

### Findings

**Fixes confirmed**
- 🟢 **Item 1, the window must contain `now()`** (`supabase/migrations/20261110000100_ai_reserve_harden.sql:25`): the check `pg_catalog.now() < p_from or pg_catalog.now() >= p_to` raises `22023`.
  - It tests the same value that gets stamped on the row. `created_at` defaults to `now()`, which is the transaction start time, and so is `pg_catalog.now()`. So the row always falls inside the window that was summed. The cap-bypass is closed.
  - The guard runs before the advisory lock and the insert, so a rejected call leaves no row.
- 🟢 **Item 3, zero reservation** (`:24`): `p_reserve_micro_usd <= 0` now raises `22023` whether or not spend is under the cap.
- 🟢 **Prices > 0** (`packages/core/src/ai/config.ts:48,61-65`): `isPosInt` requires safe integers > 0 for both the input and output price.
- 🟢 **Tests** (`scripts/db-check/checks.sql:565-583`):
  - New cases: zero reserve under the cap, past window, future window, and a window ending at `now()`. The last one tests the half-open upper bound, which is deterministic because `now()` is fixed inside the transaction.
  - The old "reserve 0 at cap" case is now "reserve 1 at cap" (`:565-566`).
  - The positive case where the window starts at `now()` is granted (`:582-583`).
  - `:581` checks that rejected calls inserted no rows.
  - Every negative case goes through `expect_fail`, which also fails if the statement succeeds.
- 🟢 **ADR 0008** (`docs/adr/0008-ai-budget-reservation.md:10,12`): "never exceeded" is gone. The ADR now says the cap is bounded by one granted call's estimation error, and records the new guards. STK-071 isn't in `work/backlog.md` yet, but `plan.md:125` tells the orchestrator to create it. It's a forward reference, not a broken one.

**Function hardening**
- 🟢 **The function is otherwise unchanged** (`20261110000100_ai_reserve_harden.sql:4-48`):
  - It is still `security invoker` with `set search_path = ''`.
  - Every name is schema-qualified (`pg_catalog.*`, `public.ai_usage`).
  - Signature and return type are unchanged, so `create or replace` succeeds and no overload is created.
  - The rest of the body matches the slice-1 version exactly: lock before the sum, `coalesce(cost, reserved)`, and the refused row with cost 0.
- 🟢 **Grants are restated** (`:50-51`) with the exact signature. `create or replace` keeps the existing owner and ACL anyway, so this is harmless defence in depth. `ai_functions_locked` (`checks.sql:588-606`) still covers privileges, `prosecdef` and `proconfig`.

**Rollback**
- 🟢 **Correct** (`supabase/rollback/20261110000100_ai_reserve_harden.down.sql`):
  - It restores the slice-1 body exactly. Only the guard differs: `< 0`, and no `now()` check.
  - It restates the grants and is idempotent.
  - Running it before `20261109000100_ai_usage.down.sql` is fine, since that file drops the function.
  - As expected, rolling back re-opens items 1 and 3.

**Widening `Db` to include `rpc`**
- 🟢 **No new exposure** (`packages/db/src/client.ts:3`).
  - The change is type-only. At runtime `createServiceClient` already returned a full service-role `SupabaseClient`.
  - `Db` is reached in web only through `apps/web/server/db.ts`, which starts with `import 'server-only'`.
  - The only `.rpc(` calls are the two literal names in `packages/db/src/repos/ai-usage.ts:25,71`, and both functions are executable by `service_role` only.
  - `service_role` bypasses RLS but not function EXECUTE privileges, so the grants still decide who can call them.

**Remaining cap-bypass paths (accepted by design, for the record)**
- 🟢 **The cap and the reserve amount both come from the caller** (`p_cap_micro_usd`, `p_reserve_micro_usd`). The service role can also write `ai_usage` directly, for example by settling a lower cost. Whoever holds the service role is trusted (R3), so this isn't a weakness of the function.
- 🟢 **The table CHECK still allows `reserved_micro_usd = 0`** (`20261109000100_ai_usage.sql:14`, `>= 0`). This only matters for direct inserts by the service role; every path through `ai_reserve` now writes > 0. Tightening it to `> 0` is optional and would belong in a later migration, not this diff (R7).
- 🟡 **Clock skew at the month rollover** now raises a `22023` error instead of booking a reservation in the wrong month. That fails closed, which is correct.
  - Today `reserveAiUsage` surfaces this as a generic `DataError`.
  - Slice b (STK-071) must treat it as "no call" with the Vietnamese message, not as a crash or a retry loop. This is already noted at `plan.md:111`; carry it into STK-071's acceptance criteria.

### Recommendations
1. Accept slice a as is (R3/R6 defence in depth; covers STK-063 security review items 1 and 3).
2. Give STK-071 these acceptance criteria:
   - Map the `22023` error from `ai_reserve` to a fail-closed refusal with no provider call.
   - Add the `over_reservation` settle check.
   - Reserve once per tool round, and include the system prompt and tool definitions in the input size.
   - Set `maxOutputTokens` and the thinking budget explicitly in every adapter.
3. Optional follow-up, not in this diff: a migration changing the `ai_usage.reserved_micro_usd` CHECK to `> 0`. It wouldn't conflict with refused rows, because those also carry the requested reserve, which is now always > 0.

### Risks
- Low: very little money is at risk (5 USD cap, one user). The only remaining overshoot is one call's estimation error, which is documented and will be detected in slice b.
- I didn't execute `checks.sql`. The `expect_fail` cases under `set local role service_role` were already shown to work in STK-063 attempt 2, but confirm the db-check job is green.

### Open questions
- None blocking. Ming still needs to confirm, as carried over from STK-063, that going over the cap by up to one call's estimation error is acceptable.

### Files reviewed
- /home/user/stoktok/supabase/migrations/20261110000100_ai_reserve_harden.sql
- /home/user/stoktok/supabase/rollback/20261110000100_ai_reserve_harden.down.sql
- /home/user/stoktok/supabase/migrations/20261109000100_ai_usage.sql
- /home/user/stoktok/scripts/db-check/checks.sql (lines 1-17, 540-606)
- /home/user/stoktok/packages/db/src/client.ts
- /home/user/stoktok/packages/db/src/repos/ai-usage.ts
- /home/user/stoktok/apps/web/server/db.ts
- /home/user/stoktok/packages/core/src/ai/config.ts
- /home/user/stoktok/packages/core/src/ai/budget.ts
- /home/user/stoktok/docs/adr/0008-ai-budget-reservation.md
- /home/user/stoktok/work/tickets/STK-069/ticket.md and plan.md (grep)
