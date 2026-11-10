## Attempt 1 — 2026-11-10
Verdict: PASS

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` clean for core, ai, sources, db, web (next typegen + tsc), worker.
- lint: `pnpm lint` clean for all 6 projects.
- test: core 773, ai 54 (4 files), sources 35, db 167 + 1 todo, worker 292, web 302 passed; 0 failures. Matches impl-log.md.

### Acceptance criteria
Scope: STK-071 per plan.md. The deploy half of AC5 is in STK-072. `.env.example`, `docs/deploy.md`, `deploy/**`, `scripts/check-deploy-env.sh`, `apps/**` and `packages/db/src/{rows.ts,repos/**}` are not in the diff.

- [x] AC1 `packages/ai` (`@stoktok/ai`), `LlmProvider` plus fakes. Evidence: packages/ai/package.json declares deps core `workspace:*` and zod `4.6.7` only, with no db, SDK, server-only or react. types.ts exports LlmProvider, ProviderRequest, ProviderResponse, Msg/Part, ProviderError. fakes.ts exports FakeProvider, FakeLedger, seqRng. The pnpm-lock diff adds only the `packages/ai` importer.
- [x] AC2 reserve → call → settle for each round, refusal with the Vietnamese message and no provider call, worst case including the system prompt, tool defs and schema. Evidence: client.ts:159-213 and these client.test tests: "refused reservation returns budget_exhausted with aiMessage text and 0 provider calls", "each tool round reserves before its provider call", "round-2 refusal after a round-1 tool call…", "reservation equals core worst case over system, tool defs, output schema and messages, and grows with them", "reservation includes providerOverheadTokens", "budgetStatus uses ledger.monthSpend…".
- [x] AC3 prompt-injection defence. Evidence: untrusted.ts uses a 16-byte rng delimiter, redraws on collision and throws after 8 tries, has `sanitizeForDelimiter` and a safe id/kind regex. client.ts:148-154 puts the blocks only in the first user turn and puts the rule in `system`. client.ts:231-237 wraps tool results with the same delimiter. tools.ts handles the read-only allowlist, and the final round sends `tools: []`. Tests that cover this: untrusted.test (all 7), tools.test, plus client.test "system prompt starts with UNTRUSTED_DATA_RULE…", "untrusted blocks are in the first user turn only…", "tool result is wrapped… truncated", "tool not in allowlist…", "invalid tool input…", "non-read tool rejected", "rounds bounded: maxToolRounds + 1…".
- [x] AC4 zod validation, with `invalid_output` settled at its real cost. Evidence: client.ts:321-330 and the tests "schema-invalid JSON settles invalid_output with real cost… no retry", "text that is not JSON while a schema is set…", "stop 'max_tokens' is invalid_output / truncated", "valid JSON returns parsed value; request.output carries the JSON schema".
- [x] AC5 (kept half) a missing key disables only that provider. Evidence: env.ts trims and treats blank as missing (env.test, 3 tests). client.test "only google configured: an anthropic-default task runs on google" and "explicit unavailable provider: provider_unavailable, 0 reserves".
- [x] AC6 r3-guard rules. Evidence: packages/db/src/r3-guard.test.ts:41-72 has 4 rules (key names only in env.ts and env.test.ts, SDK imports only under packages/ai/, the 'use client' regex now covers `@stoktok/ai|server/ai`, and apps/web importers ⊆ server/ai.ts). All pass. `grep "fetch(\|@anthropic-ai\|@google/genai" packages/ai/src` → no hits.
- [x] AC7 checks green, no network. Evidence: the runs above. packages/ai has no fetch and no SDK.
- [x] AC8 a 22023 fails closed. Evidence: client.ts:183-187 has one reserve attempt, no retry and returns `budget_unavailable` with the budget_exhausted text. Tests: "22023 on round 1…", "22023 on round 2 after round 1 settled…", "generic reserve throw…".
- [x] AC9 `over_reservation`. Evidence: client.ts:202-206 and the three tests in `describe('over_reservation')`: ok, then invalid_output (status kept), then provider_error (code kept, still warns).

### Issues
None.

### Rules R1–R10
No violations found. R2: all costs are integer micro-USD via core (BigInt in `worstCaseCostMicroUsd`). R3: the keys are read only in env.ts, and the guard enforces it. R5: overhead and rounds are in `AiConfig`, validated, with defaults marked "verify before go-live". R8: core config.test and cost.test are extended. R9: logs carry only codes, IDs and integers (the log hygiene test). R10: tools are read-only by type and by a runtime check.

### Nits (do not block)
- client.ts:248-256 `runTool` only aborts the signal on timeout. A tool that ignores `signal` can hang `generate`, while `callRound` races a timeout promise. Consider using the same race.
- client.ts:241: assistant turns are fed back without sanitizing, so model-emitted text containing `[/DATA <delim>]` is not stripped. The model writes this text, so the risk is low. Consider running `sanitizeForDelimiter` on assistant text parts.
- client.ts:317-319: when there is no schema, `json` response parts are dropped from `value`.
- r3-guard.test.ts:69: the apps/web importer rule matches only `from '@stoktok/ai…'` with single quotes, so `import('@stoktok/ai')` and double-quoted imports are missed. The 'use client' rule does catch them.
- client.ts validates tool calls twice (impl-log follow-up already notes this).

### Follow-ups (out of scope)
- The ticket areas include `security` and the diff adds prompt-injection and guard code, so the security auditor should run at REVIEW (orchestrator).
- Measure the real `providerOverheadTokens` in STK-070.
