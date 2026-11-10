# STK-070: Claude and Gemini adapters in packages/ai (STK-063 slice 3a)

| Field | Value |
|---|---|
| State | DONE |
| Priority | P2 |
| Areas | architecture, security, ui |
| Attempts | 3 |
| Created | 2026-11-10 |
| PR | — |

## Goal
Add the real Anthropic (Claude) and Google AI (Gemini) adapters to `@stoktok/ai`, wire the AI client into the web server and the worker, and show this month's AI spend with the 80% warning on Settings. This is slice 3 of the original STK-063 (see work/tickets/STK-063/plan.md "Split proposal").

## Spec reference
docs/spec-v1.md §2 (LLM provider), §6, §8 secrets. CLAUDE.md R1, R3, R5. Depends on STK-071 and STK-072.

## Acceptance criteria
- [ ] Anthropic (`@anthropic-ai/sdk`) and Google (`@google/genai`) adapters inside `packages/ai`, tested with recorded responses and an injected client or fetch (no network in CI). Each adapter sets `maxOutputTokens` and the thinking budget explicitly from config.
- [ ] `apps/web/server/ai.ts` (`import 'server-only'`) and worker wiring; `next.config.ts` `serverExternalPackages` for the SDKs; AI-key sentinels added to `check-no-service-key-in-client.sh`.
- [ ] Settings shows a read-only "Chi phí AI tháng này" card (spent / cap); at 80% it shows a warning; at 100% it shows the refusal state. Formatting only in UI (R1).
- [ ] `typecheck`, `lint`, `test` and the client-bundle check green.

## Notes / answers from Ming
- 2026-11-10 (orchestrator): split from STK-063 per its plan.md. STK-064, STK-065 and STK-066 wait for this ticket.
- Before go-live: re-verify model IDs and prices in `packages/core/src/ai/config.ts`; add a manual sweep for stale `reserved` rows (follow-up).
- 2026-11-10 (orchestrator): carry-overs from the STK-071 and STK-072 reviews:
  - `apps/web/server/ai.ts` must start with `import 'server-only'` and be the only `apps/web` importer of `@stoktok/ai`; add an r3-guard check for it like the existing `server/db.ts` one.
  - Adapters enforce `maxOutputTokens` and the thinking budget on the provider side (Gemini thinking budgets are soft), and only put valid integer usage into `ProviderError`.
  - Measure or document the real per-provider overhead behind `providerOverheadTokens` (default 1000) and `maxToolCallsPerRound` (default 8).
  - Map a `22023` from `ai_reserve` inside the ledger port adapter if convenient (the client already fails closed on any reserve throw).
  - Keys reach both web and worker (STK-072); the deployment-repo copy of the workflow is updated by Ming by hand.
- 2026-11-10 (orchestrator): split per plan.md. This ticket keeps AC1 and the typecheck/lint/test part of AC4. The web/worker wiring, `next.config.ts`, the client-bundle check and the Settings usage card (AC2, AC3, bundle part of AC4) moved to STK-073.
- 2026-11-10 (Ming, after review attempt 1 PASS): fix before the PR, all from security-review.md attempt 1: 🟡1 run the stop/finish-reason mapping before returning `final_output` (truncated → `max_tokens`, refusal/safety → `refused`); 🟡2 Gemini must not settle 0 output tokens when `candidatesTokenCount` is missing but output came back (derive from `totalTokenCount` or throw `malformed, null`); 🟢3 pin each SDK's base URL and turn off env-driven auth/debug logging (Anthropic `baseURL`, `authToken: null`, `logLevel: 'off'`; Google `httpOptions.baseUrl`, `vertexai: false`); 🟢4 Anthropic rejects a second `final_output` as `malformed`.
- 2026-11-10 (orchestrator, extending Ming's "never settle 0" fix): security review attempt 2 🟡A — whenever `totalTokenCount` is a valid integer, Gemini output tokens = max(candidates + thoughts, total − prompt − toolUse), and a `null` candidate count is treated as missing. Last rework.
