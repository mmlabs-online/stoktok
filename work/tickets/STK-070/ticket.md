# STK-070: Claude and Gemini adapters, wiring and AI usage card (STK-063 slice 3)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | architecture, security, ui |
| Attempts | 0 |
| Created | 2026-11-10 |
| PR | — |

## Goal
Add the real Anthropic (Claude) and Google AI (Gemini) adapters to `@stoktok/ai`, wire the AI client into the web server and the worker, and show this month's AI spend with the 80% warning on Settings. This is slice 3 of the original STK-063 (see work/tickets/STK-063/plan.md "Split proposal").

## Spec reference
docs/spec-v1.md §2 (LLM provider), §6, §8 secrets. CLAUDE.md R1, R3, R5. Depends on STK-071.

## Acceptance criteria
- [ ] Anthropic (`@anthropic-ai/sdk`) and Google (`@google/genai`) adapters inside `packages/ai`, tested with recorded responses and an injected client or fetch (no network in CI). Each adapter sets `maxOutputTokens` and the thinking budget explicitly from config.
- [ ] `apps/web/server/ai.ts` (`import 'server-only'`) and worker wiring; `next.config.ts` `serverExternalPackages` for the SDKs; AI-key sentinels added to `check-no-service-key-in-client.sh`.
- [ ] Settings shows a read-only "Chi phí AI tháng này" card (spent / cap); at 80% it shows a warning; at 100% it shows the refusal state. Formatting only in UI (R1).
- [ ] `typecheck`, `lint`, `test` and the client-bundle check green.

## Notes / answers from Ming
- 2026-11-10 (orchestrator): split from STK-063 per its plan.md. STK-064, STK-065 and STK-066 wait for this ticket.
- Before go-live: re-verify model IDs and prices in `packages/core/src/ai/config.ts`; add a manual sweep for stale `reserved` rows (follow-up).
