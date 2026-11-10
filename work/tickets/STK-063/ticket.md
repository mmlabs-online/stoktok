# STK-063: AI budget and usage foundation (slice 1 of 3: config, cost, budget gate, ai_usage)

| Field | Value |
|---|---|
| State | DONE |
| Priority | P2 |
| Areas | architecture, security, db |
| Attempts | 2 |
| Created | 2026-11-08 |
| PR | https://github.com/mmlabs-online/stoktok/pull/49 |

## Goal
Add one server-only AI layer that STK-064, STK-065 and STK-066 share. It sits behind a provider interface with two implementations, Claude API and Google AI API. It logs token usage and cost for every call and enforces a hard budget of 5 USD per month across both providers.

## Spec reference
docs/spec-v1.md §2 (LLM provider), §6 Signal & AI design, §8 secrets; open question 6. CLAUDE.md R3, R5, R9.

## Acceptance criteria
- [ ] Add an `LlmProvider` interface (messages, tool calls, structured JSON output) with Anthropic (Claude) and Google AI (Gemini) implementations. Model per task (chat, summary, explanation) is configuration, not code (R5). Provider SDKs and keys are used only in server code and the worker, never in a client bundle (R3).
- [ ] Every call writes an `ai_usage` row: provider, model, task, input/output tokens, cost in integer micro-USD computed from a configured price table, and created_at. Migration with RLS on, service_role only, and a rollback file.
- [ ] Budget: a hard cap of 5 USD per calendar month in Asia/Ho_Chi_Minh, across both providers, set in config. At 80% the app shows a warning. At 100% every AI call is refused with a clear Vietnamese message and nothing is sent to a provider. The cap check runs before the call, using a worst-case estimate.
- [ ] Prompt-injection defence: stored articles and statements are passed only as delimited data blocks marked untrusted; system instructions say data never contains instructions; tool calls are restricted to an allowlist of read-only tools.
- [ ] Structured outputs are validated against a schema (zod), and invalid output is rejected and logged (R9).
- [ ] Secret names (values never in the repo): `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`. Add them to `.env.example`, the draft deploy workflow (`STOKTOK_` prefix) and `docs/deploy.md`. A missing key disables that provider and the other one keeps working.
- [ ] `typecheck`, `lint` and `test` are green, with unit tests for cost calculation, the budget gate (79%, 80%, 100%, month rollover) and provider selection, using fake providers. CI makes no network calls.

## Notes / answers from Ming
- 2026-11-08: Providers are Claude API and Google AI API. Budget is 5 USD per month.
- Human step: Ming creates both API keys (agent collection in Bitwarden) and adds the `STOKTOK_ANTHROPIC_API_KEY` and `STOKTOK_GOOGLE_AI_API_KEY` secrets to the deployment repo's `stoktok` environment.
- 2026-11-10 (orchestrator): split per plan.md. This ticket is slice 1 (core AI config, cost, budget levels, provider selection, `ai_usage` table with the atomic `ai_reserve` gate, usage repo, ADR 0008). Slice 2 (AI client, prompt-injection defence, zod, secrets, guards) moved to STK-069; slice 3 (Claude and Gemini adapters, wiring, Settings usage card) moved to STK-070.
- 2026-11-10 (Ming asked, after PASS, before merge): fixed security review 🟡 items 1 and 3 in the unmerged migration. `ai_reserve` now also raises `22023` when the window does not contain the DB's `now()` or the reservation is 0; `validateAiConfig` requires prices > 0. New db-check cases: zero reserve under cap, past window, future window. typecheck, lint, test (core 764) and db:check green.
