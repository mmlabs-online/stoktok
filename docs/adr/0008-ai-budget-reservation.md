# ADR 0008: AI budget reservation (STK-063 slice 1)

Status: accepted for slice 1 of STK-063 (planner and implementer, 2026-11-10).

## Context
Ming set a hard cap of 5 USD per calendar month (Asia/Ho_Chi_Minh) across Claude and Google AI. AI calls come from two processes: web chat and the worker. The cap check must run before the call and must hold when both run at once.

## Decision
1. **A SQL function does the check and the insert.** PostgREST cannot do an atomic check-and-insert, and an app-side read-then-write would let two processes both pass the check. `public.ai_reserve(...)` takes `pg_advisory_xact_lock`, sums the month, and inserts either a `reserved` row (granted) or a `refused` row with cost 0. `public.ai_month_spend(from, to)` is the read-only sum.
2. **Hardening.** Both functions are `security invoker` with `set search_path = ''` and fully qualified names. Execute is revoked from `public`, `anon` and `authenticated` and granted to `service_role` only. `scripts/db-check/checks.sql` asserts this (`ai_functions_locked`). This is the first SQL function in the repo.
3. **Spend** is `sum(coalesce(cost_micro_usd, reserved_micro_usd))` over `created_at in [from, to)`. The window is computed in `packages/core` (`aiBudgetWindow`), so the database holds no time-zone logic.
4. **Stale reservations stay counted.** A `reserved` row left by a crash or timeout keeps counting at its worst-case estimate. A `provider_error` row with unknown cost (`cost_micro_usd` null) also stays counted. This is fail-safe: the cap can be reached early, never exceeded. A manual sweep tool is a follow-up.
5. **Worst-case formula.** Input tokens are at most the UTF-8 bytes of all input text plus a per-message overhead (a byte-level tokenizer cannot emit more tokens than bytes, so this bounds Vietnamese text without a guessed ratio). Output is `maxOutputTokens + thinkingBudgetTokens` for the task. Both are priced with the same cost function, `ceil((in x inPrice + out x outPrice) / 1,000,000)` micro-USD, rounded once.
6. **Over-estimate trade-off.** Reserving the worst case refuses some calls that would have fit. For one user at 5 USD per month this is accepted.
7. **Prices and model IDs are verify-before-go-live defaults** in `packages/core/src/ai/config.ts`. They could not be checked offline. An unpriced model is refused (`AiConfigError`, `validateAiConfig`).

## Consequences
- Rows never hold prompt or output text (R9).
- Costs are integer micro-USD (no floats). R2 says VND; providers bill in USD, so the ticket's integer micro-USD is used.
- Slices 2 and 3 add the provider client, the adapters and the usage card on top of `reserveAiUsage`, `settleAiUsage` and `getAiMonthSpend`.
