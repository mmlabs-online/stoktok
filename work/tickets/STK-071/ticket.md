# STK-071: AI client, untrusted blocks, tools and guards (STK-063 slice 2b-i)

| Field | Value |
|---|---|
| State | REVIEW |
| Priority | P2 |
| Areas | architecture, security |
| Attempts | 2 |
| Created | 2026-11-10 |
| PR | — |

## Goal
Add the server-only `@stoktok/ai` package on top of the hardened STK-063/STK-069 budget foundation: the provider interface, the client that reserves budget before every provider round, prompt-injection defence, a read-only tool allowlist, zod output validation and the optional AI secret names. Split from STK-069 (slice b in work/tickets/STK-069/plan.md); design notes in work/tickets/STK-069/consult-software-architect.md.

## Spec reference
docs/spec-v1.md §2 (LLM provider), §6 Signal & AI design, §8 secrets. CLAUDE.md R3, R5, R9. Depends on STK-069.

## Acceptance criteria
- [ ] New server-only `packages/ai` (`@stoktok/ai`) with an `LlmProvider` interface (messages, tool calls, structured JSON output) and fake providers for tests.
- [ ] `AiClient.generate` / `budgetStatus`: select provider → reserve worst case (STK-063 `ai_reserve`) → call → settle. When the budget is exhausted the call is refused with the Vietnamese message and nothing is sent to a provider. Each provider round (tool loop) reserves on its own; the worst-case input includes the system prompt and tool definitions.
- [ ] Prompt-injection defence: stored articles and statements are passed only as delimited data blocks (random delimiter per call) marked untrusted; the system line says data never contains instructions; tool results are wrapped the same way; tool calls are limited to an allowlist of read-only tools with a bounded number of rounds.
- [ ] Structured outputs are validated with zod; invalid output is rejected and logged as `invalid_output` with its real cost (R9).
- [ ] `ANTHROPIC_API_KEY` and `GOOGLE_AI_API_KEY` in `.env.example`, `docs/deploy.md` (replacing the reserved `LLM_PROVIDER` / `LLM_API_KEY` rows) and the draft deploy workflow (`STOKTOK_` prefix), written as optional; `check-deploy-env.sh` learns optional keys. A missing key disables that provider and the other keeps working.
- [ ] `r3-guard.test.ts` rules: AI keys read only in `packages/ai`'s env module, SDK imports only under `packages/ai/`, no `'use client'` file imports `@stoktok/ai`.
- [ ] `typecheck`, `lint`, `test` green; CI makes no network calls.

- [ ] A `22023` error from `ai_reserve` (for example app/DB clock skew at the month rollover) is a fail-closed refusal with the Vietnamese message: no provider call, no crash, no retry loop.
- [ ] After each round, a settled cost above the reservation is logged as `error_code = 'over_reservation'` (status kept) with a warning, and a test covers it.

## Notes / answers from Ming
- 2026-11-10 (orchestrator): split from STK-069 per its plan.md. Open questions from the STK-069 consult for the planner: `providerOverheadTokens` in core `AiConfig` now or in STK-070; abort vs feed-back on a disallowed tool call; doc Service column `web, worker` now (recommended) or later.
- Defaults to confirm (from STK-069): zero-price models are not supported in v1.
- 2026-11-10 (orchestrator): split per plan.md. The deploy half of AC5 (`.env.example`, `docs/deploy.md`, deploy workflow, `check-deploy-env.sh`) moved to STK-072. `env.ts` and "a missing key disables that provider" stay here.
- 2026-11-10 (Ming, after review attempt 1 PASS): fix all four 🟡 findings in security-review.md attempt 1 before the PR: (1) `callRound` must never throw (map classification failures to `provider_error`/`malformed`, settle the round); (2) the `@stoktok/ai` importer guard must catch double quotes, `import()` and `require()`; (3) `@stoktok/ai/fakes` may only be imported from test files; (4) a configurable per-round tool-call cap (`too_many_tool_calls`, checked before settle).
