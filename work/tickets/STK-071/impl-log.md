
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

---

## Attempt 2 (REWORK: four 🟡 findings from security-review.md attempt 1)

### Files touched
| File | Required because |
|---|---|
| packages/ai/src/client.ts | (1) classification moved to `classify()` inside try/catch in `callRound`: any throw settles `provider_error`/`malformed`, usage null; (4) `too_many_tool_calls` check before settle |
| packages/core/src/ai/config.ts | (4) `maxToolCallsPerRound` (default 8) + positive-integer validation |
| packages/core/src/ai/config.test.ts | (4) rejects 0, 1.5, NaN |
| packages/ai/src/client.test.ts | (1) malformed usage/parts/fractional/negative tokens and throwing refine; (4) cap exceeded, nothing run |
| packages/db/src/r3-guard.test.ts | (2) importer regex handles both quotes, `import()`, `require()`, bare import, with a self-test; (3) `@stoktok/ai/fakes` only from `*.test.ts(x)` |

### Checks
- typecheck: clean; lint: clean
- test: core 776, ai 60, sources 35, db 169 (+1 todo), worker 292, web 302 passed

### Out-of-plan files
None (all four fixes were requested by Ming). Not committed.

---

## Attempt 3 (REWORK: review attempt 2, Issue 1)

### Files touched
| File | Required because |
|---|---|
| packages/ai/src/client.ts | Issue 1: provider-error branch of `callRound` computes cost under try/catch; bad `err.usage` settles 0 tokens, `costMicroUsd: null`, keeps `errorCode` |
| packages/ai/src/client.test.ts | Issue 1: `ProviderError('http', usage(-1, 2))` and `usage(1.5, 2)` resolve provider_error, events `['reserve','settle']`, null cost, errorCode http |

### Checks
- typecheck: clean; lint: clean
- test: core 776, ai 62, sources 35, db 169 (+1 todo), worker 292, web 302 passed

### Out-of-plan files
None. Not committed.
