# STK-063 security review

## STK-063 attempt 1: security review (slice 1)

**Verdict: no blockers (🔴 none).** Access control and function hardening are correct. I found three 🟡 hardening gaps in `ai_reserve`. Each can let a reservation through without the cap holding. Two of them need a wrong or null window from a caller, which no current code produces. One ADR claim needs correcting. This was a read-only review. I checked by reading the files only, not by running `git diff` or `checks.sql`.

### Findings

**What is correct (🟢)**
- 🟢 **RLS and table grants** (`supabase/migrations/20261109000100_ai_usage.sql:29-31`): RLS is on with no policies. All privileges are revoked from `public`, `anon` and `authenticated`, and only `service_role` gets CRUD. The existing checks in `scripts/db-check/checks.sql` (`rls_enabled_all_tables`, `no_policies`, `no_grants_anon_authenticated_public` for tables and sequences, `anon_denied`/`authenticated_denied` on every table) cover the new table automatically.
- 🟢 **Function hardening** (`:43-45`, `:80-81`, `:88-91`): both functions are `security invoker` with `search_path = ''`, and every name is schema-qualified, including `pg_catalog.pg_advisory_xact_lock`, `hashtext` and `now`. Execute is revoked from `public`, `anon` and `authenticated` and granted to `service_role` only. `checks.sql:574-592` (`ai_functions_locked`) asserts privileges, `prosecdef` and `proconfig`. Because the functions are invoker, they can't widen access beyond what `service_role` already has. No definer-escalation path.
- 🟢 **Atomicity** (`:56-62`): the transaction-scoped advisory lock is taken before the `SELECT sum`. Under READ COMMITTED each plpgsql statement takes a fresh snapshot, so a waiting caller sees the reservation committed by the one before it. The gate matches `fitsBudget` in core.
- 🟢 **Fail-safe accounting**: `coalesce(cost, reserved)` keeps rows that are stale `reserved`, or `provider_error` with unknown cost, counted at the worst case. `settleAiUsage` (`packages/db/src/repos/ai-usage.ts:55-70`) only updates rows still `reserved`, so it settles once and can't reopen a row. The CHECKs (`:17-20`) block impossible state combinations.
- 🟢 **Integer money**: amounts are `bigint` micro-USD in SQL. Core uses BigInt with a single `ceilDiv` rounding (`packages/core/src/ai/cost.ts:26-29`). The repo converts bigint results with `toSafeInt`. No floats on the money path. Using micro-USD instead of VND (R2) is a deliberate decision recorded in ADR 0008.
- 🟢 **No prompt or output text stored (R9)**: `error_code` is limited to `^[a-z0-9_]{1,100}$` and `task` to a slug. Free text can't leak into the table.
- 🟢 **Secrets**: none in the diff. `.env.example` has an empty `LLM_API_KEY=` and no `NEXT_PUBLIC_*` key, and the `r3-guard.test.ts` guard still applies.
- 🟢 **Rollback** (`supabase/rollback/20261109000100_ai_usage.down.sql`): drops the functions before the table, uses the exact signatures, and is idempotent.

**Cap-bypass and overspend paths (🟡)**
1. 🟡 **A window that doesn't contain the DB's `now()` bypasses the cap** (`20261109000100_ai_usage.sql:58-66`). The caller sets the window `[p_from, p_to)`, but the new row's `created_at` is the DB's `now()`. If the window is for a past or future month (caller bug, app/DB clock skew near the VN month rollover, or a stale `now` passed to `aiBudgetWindow`), the sum leaves out the current month. The reservation is granted and lands outside the window that was checked.
   - Fix: after the argument check, add `if pg_catalog.now() < p_from or pg_catalog.now() >= p_to then raise exception ... using errcode = '22023'; end if;`
   - Add a negative case to `ai_reserve_gate` in `checks.sql`.
2. 🟡 **Null arguments aren't rejected** (`:52`). With `p_from` or `p_to` null, `p_from >= p_to` is null, so no error is raised. The `where` clause then matches no rows, so spent is 0, and with a non-null reserve and cap the call is granted. Null reserve or cap fails closed today, but only by accident (a NOT NULL violation, or the refused branch).
   - Fix: declare the function `strict`. It then returns no rows on any null, and the repo already throws `no data returned` (`ai-usage.ts:39`). Or add explicit `is null` checks to the raise condition.
3. 🟡 **A zero reservation is granted while under the cap** (`:52`, `:62`). `p_reserve_micro_usd = 0` passes, so a caller that skips `worstCaseCostMicroUsd` gets an unbounded call. Nothing in slice 1 produces 0, but `validateAiConfig` allows a price of 0.
   - Fix: require `p_reserve_micro_usd > 0` in SQL, and require prices > 0 in config (or document free models as an explicit exception).
4. 🟡 **The ADR's "never exceeded" claim is too strong** (`docs/adr/0008-ai-budget-reservation.md:12`). The gate caps spend at cap plus whatever one call costs beyond its reservation. Settlement records the actual cost, which can exceed the reservation if the estimate misses anything:
   - **System prompt and tool schemas**: they are billed as input tokens, so the byte count must include them.
   - **Tool rounds**: `maxToolRounds: 4` (`config.ts:44`). Each provider round needs its own reservation, or the reservation must be multiplied by the number of rounds.
   - **Gemini 2.5 Flash thinking**: it is on by default. `thinkingBudgetTokensByTask = 0` only holds if the adapter sets `thinkingConfig.thinkingBudget: 0` and `maxOutputTokens`.
   - **Tiered long-context pricing**: some provider price tiers rise above a context-length threshold.
   - Fix: reword the ADR to "bounded by one call's estimation error". Carry these items as slice 2 acceptance criteria.

**Minor**
- 🟢 Unlike the `signals` migration (`20261026000200_signals.sql:41-43`), this migration doesn't revoke or grant on `ai_usage_id_seq` explicitly. It's harmless: identity inserts don't need sequence privileges, default privileges were revoked in `20261023000200`, and `checks.sql:207-209` would catch a stray grant. Mentioned only for consistency.

### Recommendations
- **Slice 1, small and inside the plan (R7):** add items 1–3 to `ai_reserve` with matching negative cases in `checks.sql`. This keeps R6/R3 defence in depth and makes the cap hold at the DB layer whatever the caller passes.
- **ADR 0008:** correct the wording per item 4.
- **Slice 2 acceptance criteria (follow-ups):**
  - Reserve once per provider round.
  - Include the system prompt and tool definitions in `inputUtf8Bytes`.
  - Set `maxOutputTokens` and the thinking budget explicitly in every adapter.
  - Assert in a test that settled cost ≤ reserved cost, or log a breach as `error_code = 'over_reservation'`.
- Make sure `@stoktok/db`'s AI repo is only imported by server code and the worker (R3). There are no callers yet.

### Risks
- With a 5 USD cap and one user, the worst realistic outcome is overshooting by one call's estimation error, or a month's spend counted in the wrong window if the clocks disagree. That's low-dollar, but it breaks Ming's "hard cap" requirement.
- `hashtext('stoktok.ai_budget')` is a global advisory-lock key. A future lock using the same key would serialise against it. That's acceptable; just document the key.

### Open questions
- Is going over by up to one call acceptable to Ming, or must the cap be strict (which would require pricing every round)?
- Will chat with tools reserve per round or once per conversation turn? This decides the bound in item 4.

### Files reviewed
- /home/user/stoktok/supabase/migrations/20261109000100_ai_usage.sql
- /home/user/stoktok/supabase/rollback/20261109000100_ai_usage.down.sql
- /home/user/stoktok/scripts/db-check/checks.sql (lines 186-233, 501-592)
- /home/user/stoktok/packages/db/src/repos/ai-usage.ts
- /home/user/stoktok/packages/db/src/rows.ts (lines 244-257)
- /home/user/stoktok/packages/core/src/ai/budget.ts, cost.ts, config.ts
- /home/user/stoktok/docs/adr/0008-ai-budget-reservation.md

## STK-063 attempt 2: security re-review

**Verdict: no blockers (🔴 none).** The null-argument fix (attempt-1 item 2) is correct and tested, and nothing regressed. Attempt-1 items 1, 3 and 4 are still open (all 🟡). This was a read-only review: I read the files and did not run `checks.sql` or `git diff`.

### Findings

**Fix confirmed**
- 🟢 **Item 2 (null arguments) is resolved.** In `supabase/migrations/20261109000100_ai_usage.sql:52-56`, all seven arguments are now checked with `is null` before the comparisons, and the function raises `22023`. A null window can no longer give `spent = 0` and a granted reservation. Null reserve or cap now fails on purpose instead of by accident through a NOT NULL error (`23502`). The check runs before the advisory lock and the insert, so a rejected call leaves no row behind.
- 🟢 **New negative cases** (`scripts/db-check/checks.sql:570-575`) cover null `p_from`, null `p_to`, null cap, null reserve, `from >= to` and a negative reserve. Each expects `22023` through `pg_temp.expect_fail` (`:6-17`), which also fails if the statement succeeds. `ai_reserve` is not overloaded, so the untyped `null` literals resolve without ambiguity.

**No regressions**
- 🟢 The signature is unchanged (`:34-42`). `security invoker` and `search_path = ''` are still set (`:44-45`). The revoke/grant lines at `:90-93` still match the signature exactly, so `ai_functions_locked` (`checks.sql:580-598`) still applies. The rollback signature is unaffected.
- 🟢 Lock-before-sum ordering, `coalesce(cost, reserved)` accounting and the refusal path (`:58-76`) are unchanged.
- 🟢 Low-risk note, not verified by running: `expect_fail` is now called under `set local role service_role` (`checks.sql:554`), which no earlier block does. It should work, because the default-privilege revoke in `20261023000200_v1_rls_grants.sql:19` covers only schema `public`, so `pg_temp` functions keep PUBLIC execute. If the run fails with `42501` on `expect_fail`, move the `reset role` above line 570.
- 🟢 Minor gap: null `p_provider`, `p_model` and `p_task` are rejected in code (`:52`) but have no negative cases. Optional.

**Attempt-1 🟡 items still open**
1. 🟡 **The window is not checked against the DB's `now()`** (`20261109000100_ai_usage.sql:52-62`). A past or future window (caller bug, or clock skew at the VN month rollover) still sums the wrong month, and the reservation is granted. The new row then lands outside the window that was checked. Fix: add `or pg_catalog.now() < p_from or pg_catalog.now() >= p_to` to the condition at `:52-54`, plus a negative case such as `ai_reserve(..., now() - interval '40 days', now() - interval '10 days')` → `22023`.
2. 🟡 **A zero reservation is still granted under the cap** (`:54` still tests `p_reserve_micro_usd < 0`). The new test at `checks.sql:565-566` only shows that 0 is refused when spend is already at the cap, because `v_spent < cap` is false there. Below the cap, a 0 reservation is still granted, so a call with no cost bound goes through. Fix: change the test to `p_reserve_micro_usd <= 0` and add a case with reserve 0 under the cap → `22023`. Also make `validateAiConfig` require prices > 0, or document free models as an explicit exception. Line 565 would then need to expect `22023` too.
3. 🟡 **ADR 0008 still says "never exceeded"** (`docs/adr/0008-ai-budget-reservation.md:12`). Reword it to say the cap is bounded by one call's estimation error. Carry these into slice 2 as acceptance criteria: reserve per tool round, count system prompt and tool schemas in the input bytes, and set `maxOutputTokens` and the thinking budget explicitly in each adapter.

### Recommendations
- Apply items 1 and 2 in this ticket. They are two small edits to `ai_reserve`, each with one negative case, and stay inside the plan (R7). The DB then enforces the hard cap whatever the caller passes (R3/R6 defence in depth).
- Fix the ADR wording (item 3). The slice 2 points go to the follow-ups list.

### Risks
- Low money at risk: a 5 USD cap with one user. But items 1 and 2 each leave a path where the "hard cap" is not enforced in the DB.

### Open questions
- Is this migration still unmerged and not applied to any shared or remote DB? Editing it in place is only safe if so. Otherwise items 1 and 2 need a new `create or replace` migration.
- Does Ming accept going over the cap by up to one call's estimation error (carried over from attempt 1)?

### Files reviewed
- /home/user/stoktok/supabase/migrations/20261109000100_ai_usage.sql
- /home/user/stoktok/scripts/db-check/checks.sql (lines 6-17, 520-598)
- /home/user/stoktok/supabase/migrations/20261023000200_v1_rls_grants.sql (lines 17-19)
- /home/user/stoktok/docs/adr/0008-ai-budget-reservation.md
- /home/user/stoktok/work/tickets/STK-063/security-review.md
