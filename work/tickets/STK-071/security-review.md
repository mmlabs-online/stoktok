# STK-071 security review

## STK-071 security review, attempt 1

I had no shell, so I could not run `git diff`, the tests or typecheck. I read these files directly: `packages/ai/src/{client,untrusted,tools,env,types,index,fakes}.ts`, `packages/ai/package.json`, `packages/core/src/ai/cost.ts`, `packages/db/src/r3-guard.test.ts` and the `ai_usage`/`ai_reserve` migrations. Prompt-injection points below are heuristic, medium confidence.

**Verdict: no 🔴 findings. Nothing blocks a PASS.** There are four 🟡 findings (two can be fixed in this ticket) and a few 🟢 hardening notes.

### Findings

**Prompt-injection defence: holds**
- 🟢 Stored data cannot close its block. `newDelimiter` (`untrusted.ts:12-18`) draws a 128-bit `randomBytes` delimiter and redraws until no block, system or caller text contains it (`client.ts:115`). So no data text can contain the real closing marker.
- 🟢 Tool results are handled after the delimiter is fixed:
  - they are truncated, then delimiter-stripped repeatedly, then wrapped (`client.ts:198-203`, `untrusted.ts:21-25`);
  - the strip runs after the truncation, so truncation cannot rebuild the marker;
  - a model that copies the delimiter into a tool input that the tool echoes back is also covered.
- 🟢 Data never reaches the system prompt. The system prompt is `UNTRUSTED_DATA_RULE + input.system` (`client.ts:116`), and blocks go only into `messages[0]` (`client.ts:119`). Block id/kind are checked against `SAFE` (`untrusted.ts:28`), so header injection is not possible.
- 🟢 `input.system` and the caller's text in `messages[0]` are trusted by contract, and nothing enforces it. A consumer (STK-064/065/066) that puts article text into `system` would bypass the defence. This can't be fixed in this package; it belongs in those consumers' plans and reviews (R9).
- 🟢 Optional hardening: `UNTRUSTED_DATA_RULE` (`untrusted.ts:3-4`) refers to markers generically. Naming the real delimiter in the system line ("only markers carrying `<delim>`") would make a fake `[DATA x … trusted]` header inside a block less convincing. The delimiter is not secret from the model, so this costs nothing.

**Tool allowlist: holds**
- 🟢 Lookup is an exact name match against the tools passed to that call. Input is zod-parsed, and the parsed data is what reaches `run` (`tools.ts:26-31`). The check runs both before settle (`client.ts:277-280`) and again before running (`client.ts:189`). The final round sends `tools: []` and rejects any tool call (`client.ts:128`, `276`). The loop is capped at `maxToolRounds + 1` calls (`client.ts:126`), and `validateAiConfig` now requires that value to be a positive integer.
- 🟡 **No cap on tool calls per round** (`client.ts:188`). One response can contain hundreds of `tool_call`s, and every one is run in sequence against the DB. The budget gate still holds, because the next round's reservation grows with the results and would be refused. But the DB load and run time are unbounded. Fix: add `cfg.maxToolCallsPerRound` (R5), and fail anything above it as `provider_error`/`too_many_tool_calls` before settle.
- 🟢 `kind: 'read'` is a label the tool declares about itself (`tools.ts:10`), not proof that it only reads. R10 depends on reviewing each tool in STK-064/065/066.
- 🟢 `runTool` (`client.ts:215-223`) aborts the signal but does not race it, so a tool that ignores `signal` hangs `generate`. The provider path does race (`client.ts:236-244`). Use the same `Promise.race` here.
- 🟢 A tool name of 60–64 characters passes `TOOL_NAME` (`tools.ts:4`). The kind then becomes `tool:<name>`, which is longer than 64 and fails `SAFE`, so `wrapUntrusted` throws at `client.ts:203` after the tool has run. This fails closed but crashes. Cap tool names at 59 in `assertReadTools`.

**Budget gate: holds**
- 🟢 Every provider call is preceded by a granted reservation in the same round (`client.ts:141-156`). Any reserve throw, including a duck-typed `pgCode === '22023'`, returns `budget_unavailable` with no retry and no provider call. A refusal returns before the call.
- 🟢 The worst case covers the system prompt, the tool definitions, the JSON schema, all messages and the provider overhead (`client.ts:129-138`).
- 🟢 Ledger semantics are fail-safe. Spend is `sum(coalesce(cost, reserved))` (`supabase/migrations/20261109000100_ai_usage.sql:25`). So a timeout or error with no usage (cost `null`), a failed settle, or a row that is never settled all stay counted at the worst case. A settle failure only logs (`client.ts:174-179`), which is correct.
- 🟢 Over-reservation is handled as planned: warn, and `over_reservation` unless the status is `provider_error` (`client.ts:170-173`). The cap can be overrun by at most one round's excess, and the next reserve then refuses.
- 🟡 **`callRound` is documented as "Never throws", but it can** (`client.ts:225` vs `262-297`). Lines 262-297 are outside any try:
  - a missing `res.usage` or `res.parts`;
  - non-integer or negative tokens (`assertCount` RangeError);
  - a zod refine that throws.

  Any of these makes `generate` throw with the row still `reserved` forever. It stays counted, so the budget is not bypassed, but the audit status is wrong and the caller gets a throw instead of a `GenerateResult`. The plan's step 7.7 said settle in `finally`; line 167 is outside one. Fix: wrap the classification in try/catch and map failures to `provider_error`/`malformed` with `usage: null`.

**Secrets and logging: clean**
- 🟢 `env.ts:12-19` is the only module that names the keys. Nothing logs them, and `AiClient` never touches env. `ai/package.json` has no `NEXT_PUBLIC_*`. Even if the package were bundled for the client by mistake, Next does not inline non-public `process.env`.
- 🟢 Logs are typed down to event, code, ids and integers (`types.ts:113-115`). The `log hygiene` test (`client.test.ts:407-418`) plants system, block, tool and output strings and checks none of them appears. Tool, provider and reserve error messages are swallowed, not logged.

**R3 guard (`packages/db/src/r3-guard.test.ts`): adequate for this slice, with gaps**
- 🟢 The key-name rule (`:55-61`), the SDK rule (`:63-67`), the `'use client'` regex (`:41-46`) and the apps/web importer rule (`:69-72`) are all in place.
- 🟡 **The importer rule (`:70`) only matches `from '…'` with single quotes.** It misses `"@stoktok/ai"` in double quotes, `import('@stoktok/ai')` and `require(...)`. Reuse the SDK regex shape from `:64`, with both quote styles.
- 🟡 **`@stoktok/ai/fakes` can be imported from production code** (`package.json:9`). `seqRng` (`fakes.ts:75-78`) yields a fully predictable delimiter. Passed as `rng`, or a `FakeLedger` passed as `ledger`, it would silently defeat both the injection defence and the budget gate. Add a guard rule: `@stoktok/ai/fakes` may only be imported from `*.test.ts`.
- 🟢 The SDK regex misses a bare side-effect import (`import '@anthropic-ai/sdk'`) and other SDK names (`openai`, `@google/generative-ai`, `@ai-sdk/*`). Low risk, since nobody imports any SDK yet.
- 🟢 The `'use client'` rule only catches direct imports; a shared module that imports `@stoktok/ai` and is pulled into a client component gets through. This is mitigated once `apps/web/server/ai.ts` is the only allowed importer and starts with `import 'server-only'`. STK-070 must add that file, plus a guard for it like the existing `server/db.ts` check (`:48-53`).

### Recommendations
1. Fix in this ticket (small, no scope change): catch errors in the `callRound` classification (AC2 and the plan's "settle in finally"), and make the `@stoktok/ai` importer regex quote- and dynamic-import-aware (AC6).
2. Fix in this ticket or as a follow-up: a guard that limits `@stoktok/ai/fakes` to tests (AC6/R3), and a per-round tool-call cap in `AiConfig` (AC3 "bounded", R5).
3. Follow-ups:
   - cap tool names at 59 characters;
   - race the tool timeout;
   - name the delimiter in the system rule;
   - **STK-070:** a `server-only` `apps/web/server/ai.ts` and its guard; adapters must enforce `maxOutputTokens` and the thinking budget on the provider side (Gemini thinking budgets are soft), or `over_reservation` will become routine;
   - **STK-064/065/066:** a review item that no stored or fetched text goes into `system` or the caller's text, and a per-tool R10 check.

### Risks
- The injection defence is only as strong as the consumers' discipline about `input.system` and the caller's text. The client cannot enforce that.
- `over_reservation` can push monthly spend past the cap by up to one round's excess.

### Open questions
- Should a refusal caused by a 22023 or a reserve throw leave a trace beyond logs (for example a counter)? It writes no `ai_usage` row today. This is acceptable in single-user v1, but it is the one place where budget enforcement events cannot be audited.

## STK-071 security re-review, attempt 2

I read these files directly: `packages/ai/src/{client,tools,index,types}.ts`, `packages/ai/package.json`, `packages/ai/src/client.test.ts` (lines 240–360), `packages/core/src/ai/{config,cost}.ts` and `packages/db/src/r3-guard.test.ts`. I did not run the tests, typecheck or git diff.

**Verdict: no 🔴 findings. All four attempt-1 🟡 fixes are in place. One 🟡 gap of the same kind is left.**

### Attempt-1 🟡 fixes

1. **The provider-response checks in `callRound` no longer throw: fixed.** `client.ts:262-270` wraps the new `classify` (`:274-312`) in a try/catch. A failure settles as `provider_error` with code `malformed`, cost `null` and 0 tokens. A `null` cost is still counted at the reserved amount in the budget ledger, so the budget stays safe. Tests at `client.test.ts:328-347` cover missing usage, missing parts, fractional tokens, negative tokens and a refine that throws, and they check the reserve → settle order.
2. **The `@stoktok/ai` importer rule now catches both quote styles, `import()`, `require` and bare imports: fixed.** See `r3-guard.test.ts:69-73`. A self-test of the regex is at `:75-81`. Subpaths (`/fakes`) are matched too.
3. **`@stoktok/ai/fakes` can only be imported from tests: fixed.** See `r3-guard.test.ts:83-88`. The regex is broad and also matches the name in comments or strings, so it errs on the safe side. `packages/ai/src/index.ts` does not re-export the fakes.
4. **Cap on tool calls per round: fixed.**
   - The setting `maxToolCallsPerRound` is in config: `config.ts:24`, default 8 at `:49`. `:79` validates it as a positive integer, and tests are at `config.test.ts:37-39`.
   - `client.ts:290` enforces it before settle and before any tool runs, failing the call as `provider_error` with code `too_many_tool_calls`, at the real cost.
   - The test at `client.test.ts:243-256` confirms that no tool runs and the provider is called only once.

### New or remaining findings

- 🟡 **`client.ts:252`: the error path can still throw.** `usageCostMicroUsd(model, err.usage, …)` runs inside the `catch` at `:245`, which the new try/catch does not cover.
  - **How it happens:** an adapter (STK-070) throws `ProviderError('rate_limited', {inputTokens: undefined or 1.5 or -1, …})`. `assertCount` then throws a RangeError and `generate` throws.
  - **Effect:** the `ai_usage` row stays `reserved` forever, and the caller gets an exception instead of a `GenerateResult`.
  - **Not affected:** the budget. A reserved row stays counted.
  - **Fix:** wrap the cost calculation, for example `const cost = safeCost(err.usage)` that returns `null` (and 0 tokens) on a throw, and add a test case with `new ProviderError('http', usage(-1, 2))`. This is the gap attempt 1 flagged, on the error branch.
- 🟢 **`client.ts:264-269`: real usage is discarded on `malformed`.** When `res.usage` is valid but something later in `classify` throws (for example a schema refine), the real tokens are dropped and the round is counted at the reserved worst case. This errs on the safe side, so it is acceptable; only the audit is less precise.
- 🟢 **`r3-guard.test.ts:70`: the importer regex has small gaps.** It misses backtick template imports (`` import(`@stoktok/ai`) ``) and relative paths into `packages/ai/src` from `apps/web`. Package `exports` block deep subpaths such as `@stoktok/ai/src/client`, but not relative paths. Low risk.
- 🟢 **The fakes rule only checks the package name.** A non-test file inside `packages/ai` that does `import './fakes'` would not be caught. Today only `client.test.ts:16` and `untrusted.test.ts:2` do this. Optionally, extend the rule to match `\./fakes['"]` in non-test files under `packages/ai/src`.
- No regressions found:
  - `classify` keeps the order: max_tokens, then the final-round check, then the cap, then per-call allowlist/zod validation, then output.
  - `generate:188-190` checks each call again before running it.
  - The new error codes (`malformed`, `too_many_tool_calls`) satisfy the DB check `^[a-z0-9_]{1,100}$` (`supabase/migrations/20261109000100_ai_usage.sql:16`).

### Attempt-1 🟢 follow-ups still open
- Tool names are not capped at 59 characters: `tools.ts:4` is still `{1,64}`. A name of 60–64 characters still makes `wrapUntrusted` throw at `client.ts:203` after the tool has run and after settle.
- `runTool` (`client.ts:215-223`) still only aborts and does not race the timeout, so a tool that ignores the signal hangs `generate`.
- `UNTRUSTED_DATA_RULE` still does not name the real delimiter (`client.ts:116`).
- The SDK regex (`r3-guard.test.ts:64`) still misses bare `import '@anthropic-ai/sdk'` and other SDK names (`openai`, `@google/generative-ai`, `@ai-sdk/*`).
- **STK-070:** a `server-only` `apps/web/server/ai.ts` plus a guard for it like `:48-53`. Adapters must enforce `maxOutputTokens` and the thinking budget on the provider side, and must validate the usage in `ProviderError` (see the 🟡 above).
- **STK-064/065/066:** no stored or fetched text in `input.system` or the caller's text. Each tool needs an R10 check, because `kind: 'read'` is a label the tool gives itself.
- The attempt-1 open question, auditing refusals caused by a reserve throw or 22023, now has a documented answer at `client.ts:59-63`: these refusals are logged only. Whether that is enough is still Ming's call; no counter has been added.

### Recommendation
Fix the 🟡 at `client.ts:252` in this ticket. It is a one-line wrap plus one test, and it completes AC2's "callRound never throws" contract. Everything else can go to follow-ups.
