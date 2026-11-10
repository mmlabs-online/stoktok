# STK-069: Harden ai_reserve and db carry-overs (STK-063 slice 2a)

| Field | Value |
|---|---|
| State | DONE |
| Priority | P2 |
| Areas | architecture, security |
| Attempts | 1 |
| Created | 2026-11-10 |
| PR | — |

## Goal
Add the server-only `@stoktok/ai` package on top of the STK-063 budget foundation: the provider interface, the client that reserves budget before every provider call, prompt-injection defence, a read-only tool allowlist, zod output validation and the AI secret names. This is slice 2 of the original STK-063 (see work/tickets/STK-063/plan.md "Split proposal").

## Spec reference
docs/spec-v1.md §2 (LLM provider), §6 Signal & AI design, §8 secrets. CLAUDE.md R3, R5, R9. Depends on STK-063.

## Acceptance criteria
- [ ] New server-only `packages/ai` (`@stoktok/ai`) with an `LlmProvider` interface (messages, tool calls, structured JSON output) and fake providers for tests.
- [ ] `AiClient.generate` / `budgetStatus`: select provider → reserve worst case (STK-063 `ai_reserve`) → call → settle. When the budget is exhausted the call is refused with the Vietnamese message and nothing is sent to a provider. Each provider round (tool loop) reserves on its own; the worst-case input includes the system prompt and tool definitions.
- [ ] Prompt-injection defence: stored articles and statements are passed only as delimited data blocks (random delimiter per call) marked untrusted; the system line says data never contains instructions; tool results are wrapped the same way; tool calls are limited to an allowlist of read-only tools with a bounded number of rounds.
- [ ] Structured outputs are validated with zod; invalid output is rejected and logged as `invalid_output` with its real cost (R9).
- [ ] `ANTHROPIC_API_KEY` and `GOOGLE_AI_API_KEY` in `.env.example`, `docs/deploy.md` (replacing the reserved `LLM_PROVIDER` / `LLM_API_KEY` rows) and the draft deploy workflow (`STOKTOK_` prefix), written as optional; `check-deploy-env.sh` learns optional keys. A missing key disables that provider and the other keeps working.
- [ ] `r3-guard.test.ts` rules: AI keys read only in `packages/ai`'s env module, SDK imports only under `packages/ai/`, no `'use client'` file imports `@stoktok/ai`.
- [ ] `typecheck`, `lint`, `test` green; CI makes no network calls.

## Notes / answers from Ming
- 2026-11-10 (orchestrator): split from STK-063 per its plan.md. Carry-overs from STK-063 review and security review:
  - Widen the db `Db` type to include `rpc` and drop the local `AiDb` type.
  - Harden `ai_reserve` with a **new** migration (`create or replace function`; `20261109000100_ai_usage.sql` is merged and must not be edited): raise `22023` when the window does not contain the DB's `now()`, and when `p_reserve_micro_usd = 0`. Require prices > 0 in `validateAiConfig`. Add db-check cases: zero reserve under cap, past window, future window; the existing "reserve 0 at cap" case moves to reserve 1. Security review 🟡 items 1 and 3. (An in-place fix was pushed to PR #49 after it was merged, so it never reached `main`; it was reverted on the session branch.)
  - Harden `ai_reserve` with a new migration: reject a window that does not contain the DB's `now()`, and reject `p_reserve_micro_usd = 0` (and require prices > 0 in `validateAiConfig`). Security review 🟡 items 1 and 3.
  - Fix ADR 0008 wording: the cap is bounded by one call's estimation error, not "never exceeded".
  - Test that settled cost ≤ reserved cost, or log a breach as `error_code = 'over_reservation'`.
- 2026-11-10 (orchestrator): split per plan.md. This ticket is slice a: the `ai_reserve` hardening migration, `Db` widened to `rpc`, prices > 0, ADR 0008 wording. The AI client, guards and optional secrets (ticket AC1–AC7) moved to STK-071.
