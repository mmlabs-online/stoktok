Status: READY

# Plan: STK-069 slice a, ai_reserve hardening and db carry-overs (STK-069a)

**Scope: slice a of 2.** STK-069 is split (see `## Split proposal`). This plan covers only the STK-063 carry-overs listed under the ticket's "Notes / answers from Ming":
- the hardening migration for `ai_reserve`
- the `checks.sql` cases
- widening `Db` and dropping `AiDb`
- prices > 0 in `validateAiConfig`
- the ADR 0008 wording

The `@stoktok/ai` package, the guards, the optional secrets and the `over_reservation` test are slice b (proposed STK-071). That slice needs a client that settles calls, and that client does not exist yet.

## Spec summary
- docs/spec-v1.md §6: "Output is structured JSON validated against a schema before display." / "The LLM receives only stored data …". Slice b.
- docs/spec-v1.md §7: "Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo." Slice b.
- Ticket, Notes (orchestrator, 2026-11-10), quoted. This slice implements these:
  - "Widen the db `Db` type to include `rpc` and drop the local `AiDb` type."
  - "Harden `ai_reserve` with a **new** migration (`create or replace function`; `20261109000100_ai_usage.sql` is merged and must not be edited): raise `22023` when the window does not contain the DB's `now()`, and when `p_reserve_micro_usd = 0`. Require prices > 0 in `validateAiConfig`. Add db-check cases: zero reserve under cap, past window, future window; the existing "reserve 0 at cap" case moves to reserve 1."
  - "Fix ADR 0008 wording: the cap is bounded by one call's estimation error, not "never exceeded"."
- STK-063 security-review.md, attempt 2, open 🟡 items 1 (window vs `now()`), 2 (zero reserve) and 3 (ADR wording).
- Ming's requirement from STK-063: a hard cap of 5 USD per month. CLAUDE.md R3/R6: defence in depth, so the DB enforces the cap whatever the caller passes. R8: green checks.

## Acceptance criteria → verification
| # | Criterion (this slice) | How the reviewer verifies it |
|---|---|---|
| 1 | A new migration `20261110000100_ai_reserve_harden.sql` runs `create or replace` on `public.ai_reserve`. The signature, return type, `security invoker`, `search_path = ''`, lock, sum and insert are unchanged. The guard now also raises `22023` when `p_reserve_micro_usd <= 0`, or when `pg_catalog.now() < p_from or pg_catalog.now() >= p_to`. The file restates `revoke`/`grant` execute. `20261109000100_ai_usage.sql` is byte-identical to `main`. | Read the migration. Then run `git diff main -- supabase/migrations/20261109000100_ai_usage.sql`, which must be empty. Then run `pnpm db:check`, which must be green; `ai_functions_locked` still passes after the replace and after re-apply. |
| 2 | Rollback `20261110000100_ai_reserve_harden.down.sql` restores the slice-1 function body (`create or replace`, guard `p_reserve_micro_usd < 0`, no `now()` check) with revoke/grant. It does not drop anything. | Read the file; its body matches `20261109000100_ai_usage.sql:34-77` except for `or replace`. `pnpm db:check` runs rollback (newest first) → "rollback left 0 tables" passes → re-apply → checks green. |
| 3 | db-check covers the new guards. Zero reserve under the cap → `22023`. Past window → `22023`. Future window → `22023`. `p_to = now()` → `22023` (the window is half-open). A window starting at `now()` is accepted. Rejected calls insert no row. The old "reserve 0 at cap" case becomes "reserve 1 at cap → refused, spent 1000". | `scripts/db-check/checks.sql` › `ai_reserve_gate` has the new `expect_fail` names listed in Tests below. `pnpm db:check` is green. |
| 4 | Every window in `ai_reserve_gate` is derived from `now()`, so no hard-coded month is left. The existing negative cases that used `p_to = now()` now use a window that contains `now()`, so each case fails only for its own reason. | Grep `checks.sql` for a literal `'2026-` inside `ai_reserve_gate`; there must be none. Read the cases at the former lines 570-575: none of them has `now()` as `p_to` except the dedicated `p_to = now()` case. |
| 5 | `Db` is `Pick<SupabaseClient, 'from' \| 'rpc'>`. `AiDb` is removed and the ai-usage repo and its tests use `Db`. | Grep `AiDb` across the repo (excluding `work/`); there must be no hits. Read `packages/db/src/client.ts:3`. `pnpm typecheck` is green; the `{} as Db` fakes in web and worker still compile. |
| 6 | `validateAiConfig` requires every price to be a positive integer. A price of 0 is rejected for both input and output. `AI_CONFIG` stays valid. | `config.test.ts` › "zero input price", "zero output price" (new rows in `validateAiConfig rejects`); "AI_CONFIG is valid" still passes. |
| 7 | With a valid config, the worst-case reservation is always ≥ 1 micro-USD, so a valid caller never sends 0 to the DB. | `cost.test.ts` › "worst case is at least 1 micro-USD for every task and provider in AI_CONFIG" (empty input text). |
| 8 | ADR 0008 no longer says "never exceeded". It states that the cap is bounded by one call's estimation error, and it records the 2026-11-10 hardening (window must contain `now()`, reserve > 0). | Read `docs/adr/0008-ai-budget-reservation.md`: grep for "never exceeded" (no hits); Decision 2 or a new item mentions both guards and the migration file name. |
| 9 | `typecheck`, `lint`, `test` and `db:check` are green. CI makes no network calls. | Run `pnpm typecheck && pnpm lint && pnpm test && pnpm db:check`. CI is green. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `supabase/migrations/20261110000100_ai_reserve_harden.sql` | create: header comment (STK-069, security review items), `create or replace function public.ai_reserve(...)` with the widened guard, revoke/grant execute restated | AC1. The slice-1 migration is merged and must not be edited |
| `supabase/rollback/20261110000100_ai_reserve_harden.down.sql` | create: `create or replace` with the slice-1 body plus revoke/grant | AC2. db-check rolls back newest-first and the next down file drops the function |
| `scripts/db-check/checks.sql` | modify only the `ai_reserve_gate` block: reserve 0 at cap → reserve 1; move the old negative cases onto a window containing `now()`; add the new cases and a row-count assertion | AC3, AC4 |
| `packages/db/src/client.ts` | `Db = Pick<SupabaseClient, 'from' \| 'rpc'>` | AC5 |
| `packages/db/src/repos/ai-usage.ts` | remove `AiDb` and its comment; use `Db` from `../client`; drop the now-unused `SupabaseClient` type import | AC5 |
| `packages/db/src/repos/ai-usage.test.ts` | casts `as unknown as AiDb` → `as Db` (or the fake's `db` directly); import `Db` from `../client` | AC5 |
| `packages/core/src/ai/config.ts` | price check uses `isPosInt`; message "price of <model> must be positive integers" | AC6 |
| `packages/core/src/ai/config.test.ts` | add "zero input price", "zero output price" rows | AC6 |
| `packages/core/src/ai/cost.test.ts` | add the "worst case ≥ 1" test | AC7 |
| `docs/adr/0008-ai-budget-reservation.md` | fix the wording in Decision 4; add the hardening to Decision 2; add an "Amended STK-069 (2026-11-10)" note to the Status line | AC8 |

No other files. The fake client already has `rpc` (`packages/db/test/fake-client.ts:38`). `packages/db/src/index.ts` never exported `AiDb`, so the barrel is unchanged.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `checks.sql` › `ai_reserve_gate`: `select * into r from ai_reserve(..., 1, 1000, w_from, w_to)` → `not r.granted and r.spent_micro_usd = 1000` (replaces "reserve 0 at cap") | AC3 |
| `checks.sql` › `expect_fail('ai_reserve zero reserve under cap', … 0, 1000000, w_from, w_to …, ['22023'])` | AC3, security 🟡 item 2 |
| `checks.sql` › `expect_fail('ai_reserve past window', … 1, 1000000, now() - interval '40 days', now() - interval '10 days' …, ['22023'])` | AC3, security 🟡 item 1 |
| `checks.sql` › `expect_fail('ai_reserve future window', … 1, 1000000, now() + interval '1 day', now() + interval '30 days' …, ['22023'])` | AC3 |
| `checks.sql` › `expect_fail('ai_reserve window ends at now', … 1, 1000000, now() - interval '1 day', now() …, ['22023'])` | AC3, half-open boundary |
| `checks.sql` › "window starting at now is accepted": `ai_reserve(…, 1, 1000000, now(), now() + interval '1 day')` → `granted` | AC3, lower boundary inclusive |
| `checks.sql` › row count of `ai_usage` is the same before and after the block of `expect_fail` calls | AC3: rejected calls leave no row |
| `checks.sql` › existing null from / null to / null cap / null reserve / from >= to / negative reserve: same names and `22023`, but the window is `w_from, w_to` (or `null` where null is the point) | AC4 |
| `config.test.ts` › validateAiConfig rejects › "zero input price", "zero output price" | AC6 |
| `cost.test.ts` › "worst case is at least 1 micro-USD for every task and provider in AI_CONFIG" | AC7 |
| `ai-usage.test.ts`: existing tests, retyped to `Db` | AC5 (no behaviour change) |

## Approach
1. **Migration (AC1).** Copy the function from `20261109000100_ai_usage.sql:34-77` into the new file as `create or replace function`. Change the guard to:
   ```sql
   if p_provider is null or p_model is null or p_task is null
      or p_reserve_micro_usd is null or p_cap_micro_usd is null or p_from is null or p_to is null
      or p_reserve_micro_usd <= 0 or p_cap_micro_usd <= 0 or p_from >= p_to
      or pg_catalog.now() < p_from or pg_catalog.now() >= p_to then
     raise exception 'invalid ai_reserve arguments' using errcode = '22023';
   end if;
   ```
   Leave everything else unchanged. Then restate the two `revoke`/`grant execute` lines for `ai_reserve` with the exact signature. `ai_month_spend` is not touched. `create or replace` with an identical signature keeps the ACL (consult, Finding 6); the restated grants make the file stand on its own. `now()` is the transaction start time, and the row's `created_at default now()` uses the same instant, so the row always lands inside the checked window.
2. **Rollback (AC2).** Write the same file with the slice-1 guard (`p_reserve_micro_usd < 0`, no `now()` terms) and the same revoke/grant. Do not drop the function: `20261109000100_ai_usage.down.sql` runs next and drops it.
3. **checks.sql (AC3, AC4).** Edit only the `ai_reserve_gate` block. `w_from`/`w_to` are already `now() ± 1 day`; keep them. Replace the reserve-0-at-cap case with reserve 1. Rewrite the old negative cases so each one uses a window containing `now()`, for example `now() - interval '1 day', now() + interval '1 day'`. Add the new cases. Use a large cap (1_000_000) for the zero-reserve and window cases, so they show a refusal that the old function would have granted. Count `ai_usage` rows before and after the `expect_fail` group and assert they are equal. Put the "starts at now" positive case last, before `reset role`; the final `delete from public.ai_usage` cleans up.
4. **Db type (AC5).** Make the one-line change in `client.ts`. Remove `AiDb` from the repo and its test. Every real caller passes a `SupabaseClient`, and every test fake is `{} as Db` or `as unknown as Db`, so nothing else changes.
5. **Config (AC6, AC7).** Switch the price check to `isPosInt`. With prices > 0 and `maxOutputTokens > 0`, `worstCaseCostMicroUsd` is ≥ 1 because of the `ceil` rounding. The new test asserts this for every provider/task in `AI_CONFIG`, using empty input. This is pure `packages/core` logic with unit tests (R1, R8).
6. **ADR (AC8).**
   - Decision 4: change "the cap can be reached early, never exceeded" to say that stale rows make the cap reached early.
   - Add a sentence: "Actual spend can exceed the cap by at most the estimation error of a granted call (actual cost − its reservation). Per-round reservation and the `over_reservation` log (STK-071) keep this bounded and visible."
   - Decision 2: add "From `20261110000100_ai_reserve_harden.sql` (STK-069), `ai_reserve` also rejects a zero reservation and a window that does not contain the DB's `now()`; prices must be > 0."
7. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm db:check`.

Rules:
- R3/R6 defence in depth: the DB enforces the cap whatever the caller passes.
- R5: prices stay configuration; only validation changes.
- R2: integer micro-USD, no float change.
- R7: nothing from slice b.
- R8: core change with tests.
- The security auditor runs at REVIEW, because the diff touches a migration and a function.

## Specialist input used
- consult-software-architect Rec 7 (hardening migration, rollback restores the old body, checks windows from `now()`): **adopted**. I also found that the existing negative cases at `checks.sql:572-575` use `p_to = now()`. With the new guard they would still raise `22023`, but for the wrong reason, so this plan moves them to a window containing `now()` (AC4).
- Finding 4 / the Rec 10 `Db` widening: **adopted**.
- Rec 6, second half (prices > 0): **adopted**.
- Rec 6, first half (`providerOverheadTokens`): **deferred to slice b**. It only matters once the client builds requests.
- Rec 10 (split into 069a/069b): **adopted**. The whole ticket is about 1,350-1,550 lines (consult estimate), far over the ~400-line guide, and the hardening is security-sensitive enough to review on its own.
- Recs 1-5, 8, 9 and the `over_reservation` carry-over: **slice b**. They need the client.
- Open question 1 (split): answered by this plan (split). Open questions 2-4 belong to slice b's planning.
- STK-063 security-review attempt 2, items 1-3: **adopted** as AC1, AC3 and AC8.

## Assumptions
- `20261109000100_ai_usage.sql` has been applied only to local throwaway DBs and possibly to Ming's stoktok project. Either way, a forward `create or replace` migration is safe.
- `ai_month_spend` needs no hardening; it is read-only and its window is just a filter.
- A zero price ("free model") is not a supported case in v1. If Ming wants one later, it needs an explicit exception (security review item 3, option b). For Ming to confirm.
- Clock skew between the app and the DB at the month rollover now produces a `22023` error instead of a mis-windowed reservation. Slice b's client should treat that error as `provider_unavailable`/fail-closed, so no call is made. Recorded here for slice b.
- I did not run `pnpm db:check` while planning. The SQL above follows the existing patterns.

## Blocking questions
None.

## Split proposal
The ticket is too large for one implement/review cycle: about 1,350-1,550 lines across a new package, core, db, a migration, deploy drafts and guards (consult, Rec 10). Two slices, each with green checks:

| Slice | Content | Ticket ACs / carry-overs covered |
|---|---|---|
| **a (this plan, STK-069)** | Migration `20261110000100_ai_reserve_harden.sql` plus rollback; `checks.sql` `ai_reserve_gate` cases (zero reserve, past/future window, half-open boundary, windows from `now()`, reserve 1 at cap); `Db` widened to `from \| rpc`, `AiDb` removed; prices > 0 in `validateAiConfig`; ADR 0008 wording | Carry-overs 1-4 in ticket Notes except `over_reservation`; AC7 (checks green). Security review items 1-3 |
| **b (proposed STK-071, "AI client, guards and optional secrets", areas `architecture, security`)** | New `packages/ai` (`@stoktok/ai`): `LlmProvider` types, fakes, `env.ts`, untrusted blocks with a random delimiter, read-only tool allowlist, `AiClient.generate`/`budgetStatus` with per-round reserve/settle and the `over_reservation` log, zod validation → `invalid_output`; `providerOverheadTokens` in core `AiConfig`; optional `ANTHROPIC_API_KEY`/`GOOGLE_AI_API_KEY` in `.env.example`, `docs/deploy.md`, the draft deploy workflow and `check-deploy-env.sh`; `r3-guard.test.ts` rules. Plan from consult-software-architect Recs 1-6, 8, 9 and its open questions 2-4 | Ticket AC1-AC6, AC7; carry-over "settled cost ≤ reserved cost, or log `over_reservation`"; security review slice-2 items (reserve per round, system prompt and tool defs in the worst case) |

Slice b depends on slice a and must follow it. STK-070 (adapters, wiring, usage card) depends on slice b. STK-064/065/066 stay blocked until STK-070 is DONE. The orchestrator should create STK-071 when this slice is DONE and copy ticket AC1-AC7 and the `over_reservation` carry-over into it.
