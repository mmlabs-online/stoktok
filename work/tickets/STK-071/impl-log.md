
## Attempt 1 — 2026-11-10

### Files touched
| File | Required because |
|---|---|
| packages/ai/package.json, tsconfig.json, vitest.config.ts | AC1/AC7 new package (copy of sources' config; deps core + zod 4.6.7) |
| packages/ai/src/types.ts | AC1 LlmProvider, ports, ProviderError, result types |
| packages/ai/src/env.ts | AC5 (kept part), AC6 sole reader of the two AI keys |
| packages/ai/src/untrusted.ts | AC3 delimiter, wrap, sanitize, truncate |
| packages/ai/src/tools.ts | AC3 read-only allowlist checks |
| packages/ai/src/client.ts | AC2-AC4, AC8, AC9 AiClient |
| packages/ai/src/fakes.ts | AC1 FakeProvider, FakeLedger, seqRng |
| packages/ai/src/index.ts | AC1 barrel |
| packages/ai/src/{env,untrusted,tools,client}.test.ts | plan tests |
| packages/core/src/ai/config.ts, cost.ts | providerOverheadTokens, maxToolRounds validation, optional provider in worst case |
| packages/core/src/ai/config.test.ts, cost.test.ts | R8 |
| packages/db/src/r3-guard.test.ts | AC6 four guard rules |
| pnpm-lock.yaml | new importer only (+16 lines) |

### Tests added / changed
- ai: env.test, untrusted.test, tools.test, client.test (54 tests, all plan rows incl. 22023, over_reservation, timeout, log hygiene)
- core: config.test (maxToolRounds, providerOverheadTokens rejects), cost.test (provider overhead once)
- db r3-guard: AI key names, SDK imports, extended 'use client' regex, apps/web importers of @stoktok/ai

### Checks (actual output summary)
- typecheck: clean for all packages
- lint: clean for all packages
- test: core 773, ai 54, sources 35, db 167 (+1 todo), worker 292, web 302 passed; no failures

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- client.ts validates tool calls twice (in the round classifier for settle, again to get the parsed input); could return the parsed input from the classifier if STK-070 touches it.
- `truncateUtf8` appends no marker (result is hard-capped at maxResultBytes).

### Scope self-check
- Could the diff be smaller? No; plan sized it as one surface.
- Diff size: ~+1400 / -5 lines including tests and lockfile. Not committed (orchestrator commits).
