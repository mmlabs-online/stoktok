# STK-073: AI wiring and AI usage card (STK-063 slice 3b)

| Field | Value |
|---|---|
| State | REVIEW |
| Priority | P2 |
| Areas | architecture, security, ui |
| Attempts | 2 |
| Created | 2026-11-10 |
| PR | — |

## Goal
Wire the `@stoktok/ai` client (with the STK-070 adapters) into the web server and the worker, keep the SDKs and keys out of client bundles, and show this month's AI spend with the 80% warning on Settings. Split from STK-070 (see work/tickets/STK-070/plan.md "Split proposal"); design notes in work/tickets/STK-070/consult-software-architect.md (items E–J) and consult-data-visualization-engineer.md.

## Spec reference
docs/spec-v1.md §6, §7 secrets, §9 open question 6. CLAUDE.md R1, R3, R5, R6. Depends on STK-070.

## Acceptance criteria
- [ ] A `UsageLedger` port adapter over the db repo (errors pass through unchanged so `pgCode` survives; a 22023 test).
- [ ] `apps/web/server/ai.ts` starts with `import 'server-only'`, is the only `apps/web` importer of `@stoktok/ai`, gets db access via `./db`, builds the client lazily (nothing at module top level) and works with no AI keys. An r3-guard check pins the first line. Worker: `apps/worker/src/ai.ts` factory with a unit test (no job yet).
- [ ] `next.config.ts`: `@stoktok/ai` in `transpilePackages`, the SDKs in `serverExternalPackages`, the SDKs as direct `apps/web` dependencies at the same exact versions; verified by running the built server or image.
- [ ] `check-no-service-key-in-client.sh` builds with AI-key sentinels and fails on the sentinels, the key names or the SDK API hostnames in `.next/static`.
- [ ] Settings shows a read-only "Chi phí AI tháng này" card (spent / cap, remaining, month) outside the settings form: warning at the configured warn level, refusal state at 100%, an error state (no false zero) when the spend can't be read. All numbers come from core `budgetStatus` / `formatUsdMicro` / `aiMessage`; the threshold mark comes from config (R1, R5). Accessible meter; colour never the only cue.
- [ ] `typecheck`, `lint`, `test` and the client-bundle check green.

## Notes / answers from Ming
- 2026-11-10 (orchestrator): split from STK-070 per its plan.md. STK-064, STK-065 and STK-066 wait for this ticket.
- Before go-live: re-verify model IDs and prices in `packages/core/src/ai/config.ts`; add a manual sweep for stale `reserved` rows (follow-up).
- 2026-11-10 (orchestrator): carry-overs from the STK-070 reviews:
  - Pass the same `timeoutMs` to `buildProviders` and `AiClient` (or a smaller one to the SDK).
  - The client-bundle check must cover both SDKs: they are imported at the top of `packages/ai/src/adapters/*.ts`, so any client import of `@stoktok/ai` would pull them in.
  - The SDKs still read `ANTHROPIC_CUSTOM_HEADERS` and `GOOGLE_GENAI_API_VERSION` from the environment (cannot change host or key); make sure the deploy env does not set them, or note it.
