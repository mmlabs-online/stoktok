# STK-070 consult: software-architect

## Findings
1. **The neutral types are almost enough.** Three gaps matter for the adapters:
   - `Usage` has only `inputTokens` and `outputTokens`. Cache and thinking tokens have to be folded in by each adapter.
   - `Part` and `ResponsePart` have no field for thinking blocks or thought signatures. Anthropic requires thinking blocks (with their signature) to be sent back on tool-use turns. Gemini 3 requires thought signatures. Thinking plus tools therefore cannot round-trip today.
   - All `thinkingBudgetTokensByTask` values are 0 (`packages/core/src/ai/config.ts:46`). The limit doesn't bite now, but it must be enforced rather than left implicit.
2. **The reserve already assumes total output = `maxOutputTokens + thinkingBudgetTokens`** (`cost.ts:57`). Anthropic's `max_tokens` already includes thinking. For Gemini 2.5, I believe `maxOutputTokens` also caps thoughts, but this must be verified. So the provider-side hard cap should be the sum. That is what makes the soft Gemini thinking budget safe.
3. **The 22023 mapping is effectively done.** `reserveAiUsage` throws `DataError` carrying `pgCode` (`packages/db/src/errors.ts:17`). The client already duck-types `pgCode === '22023'` (`client.ts:151`). The port adapter only needs to let the error through unchanged: no wrapping, no re-throw as a plain `Error`.
4. **The db repo functions already match `UsageLedger` structurally** (`packages/db/src/repos/ai-usage.ts`), and the DB check `^[a-z0-9_]{1,100}$` accepts every code the client emits. The adapter is about 10 lines.
5. **The r3-guard is ready.** It already has the `@stoktok/ai` importer rule, the SDK-only-under-`packages/ai` rule and the key-name rule (`packages/db/src/r3-guard.test.ts:55-73`). What's missing is the "`server/ai.ts` starts with `import 'server-only';`" assertion, copying the `server/db.ts` one at line 48. Note that the "`@stoktok/db` importers in apps/web are only `server/db.ts`" rule (line 51) means **`server/ai.ts` must get the repo functions from `./db`, not from `@stoktok/db`**.
6. **The core helpers for the card already exist.** `BudgetStatus` (spent, cap, remaining, floor percent, level) is in `budget.ts`. `formatUsdMicro` and `aiMessage('budget_warn' | 'budget_exhausted')` are in `messages-vi.ts`. The Settings card needs no new arithmetic.
7. **The worker has no AI job yet.** `index.ts` is a stub. `cli.ts` builds the db with `createServiceClient` directly. "Worker wiring" can only be a factory plus a test until STK-064–066.
8. **The sentinel check proves little for AI keys by itself.** `readAiEnv` reads at runtime, so a build-time sentinel would never be inlined anyway. The useful greps are key names and SDK fingerprints (API hostnames).
9. **pnpm externals risk.** With `serverExternalPackages`, Next emits a runtime `require('@anthropic-ai/sdk')` from `apps/web/.next/server`. Under pnpm's strict layout, a package that is only a dependency of `packages/ai` may not resolve from `apps/web` (or from standalone output).

## Recommendations

### A. Adapter shape (AC1)
- **Factories with an injected client:**
  - `createAnthropicProvider({ apiKey } | { client })`
  - `createGoogleProvider({ apiKey } | { client })`
  - Type the injected client narrowly and structurally: `{ messages: { create(params, opts) } }` and `{ models: { generateContent(params) } }`. Tests pass a fake that returns recorded JSON; only the factory touches `new Anthropic()` / `new GoogleGenAI()`.
  - Add a `buildProviders(env: AiEnv)` that returns `Partial<Record<AiProvider, LlmProvider>>` (a missing key means that provider is absent).
- **Fixtures:** hand-authored, API-shaped JSON in `packages/ai/src/__fixtures__/{anthropic,google}/`. Cover: text, tool_use with several calls, forced JSON, max_tokens, refusal / safety, missing usage, and 429 / 5xx / timeout errors. Add a manual `scripts/record-ai-fixtures.sh` (not run in CI) as a follow-up, like `record-news-fixtures.sh`.
- **Request options for both SDKs:**
  - Pass `req.signal` (Anthropic: `create(params, { signal })`; Gemini: `config.abortSignal`).
  - Set SDK retries to 0 (Anthropic `maxRetries: 0`). Retries outlive the client's `timeoutMs` and hide 429s from the ledger.
  - Set the SDK timeout no higher than the client's timeout.

### B. Anthropic mapping
- **Basics:** `system` → `system`. `Msg` → `messages`: text → `text` block, `tool_call` → `tool_use{id,name,input}`, `tool_result` → `tool_result{tool_use_id,content:text}`. `ToolDef` → `{name, description, input_schema}`, with `$schema` stripped from the zod JSON Schema.
- **Token limits:** `max_tokens = maxOutputTokens + thinkingBudgetTokens`.
- **Thinking:**
  - If the budget is 0, send `thinking: { type: 'disabled' }` explicitly.
  - If it is above 0, the adapter throws `ProviderError('malformed', null)` before calling the API, because thinking cannot round-trip through `Part` yet (Finding 1).
  - Separately, add a core `validateAiConfig` rule: each Anthropic thinking budget must be 0 or ≥ 1024 (the API minimum, verify). Since 0 is the only value the adapter supports today, this rule is preparation.
  - Record "thinking + tools" as a follow-up.
- **Forced structured output: a synthetic tool.** Add a reserved tool `final_output` with `input_schema = jsonSchema`, wrapped as an object if the top level is not `type: object`.
  - Final round (`tools` empty): `tool_choice: { type: 'tool', name: 'final_output' }`.
  - Non-final rounds: add it next to the read tools with `tool_choice: auto`.
  - A `final_output` call maps to `{type:'json', value: input}` with `stop: 'end'`, never to `tool_call`.
  - Guard against a read tool being named `final_output`: throw in the adapter, or add the name to `assertReadTools`.
  - Native Anthropic structured outputs (`output_format`) is an option only if it is GA for Haiku 4.5. Verify before choosing it; the synthetic tool works on every model.
- **Stop reasons:**
  - `end_turn` / `stop_sequence` → `end`
  - `tool_use` → `tool_use` (or `end` if the only call is `final_output`)
  - `max_tokens` / `model_context_window_exceeded` → `max_tokens`
  - `refusal` → throw `ProviderError('refused', usage)`
  - `pause_turn` and unknown values → `ProviderError('malformed', usage)`
- **Usage:**
  - `inputTokens = input_tokens + (cache_creation_input_tokens ?? 0) + (cache_read_input_tokens ?? 0)`. This is conservative: cache reads are overbilled, and cache writes at 1.25× are slightly underbilled. Do not set `cache_control` in this slice.
  - `outputTokens = output_tokens`, which already includes thinking.
- **Errors**, mapped by `status` / `name` so fakes can throw plain objects (add one test with the real SDK error class):
  - 429 and 529 → `rate_limited`
  - `APIConnectionTimeoutError` or an abort → `timeout`
  - other `APIError` → `http`
  - HTTP errors carry `usage: null`

### C. Gemini mapping (`@google/genai`)
- **Basics:** `config.systemInstruction`. Roles `user` / `model`. `tool_call` → `functionCall{id?, name, args}`. `tool_result` → `functionResponse{id?, name, response: { result: text }}` (`response` must be an object). Tools go in `config.tools[{ functionDeclarations }]`, using `parametersJsonSchema` if the pinned SDK has it, otherwise `parameters` (OpenAPI subset). Verify which.
- **Function-call IDs:** 2.5 often returns no `id`. Synthesize stable IDs (`g{round}-{index}`) so the client's `tool_result` IDs pair up.
- **Token limits and thinking:** `maxOutputTokens = maxOutputTokens + thinkingBudgetTokens`, and `thinkingConfig: { thinkingBudget: thinkingBudgetTokens, includeThoughts: false }` set explicitly. 0 disables thinking on 2.5 Flash; 2.5 Pro cannot go to 0, and Gemini 3 uses `thinkingLevel`. Verify both.
- **Structured output:**
  - When `tools` is empty: `responseMimeType: 'application/json'` plus `responseJsonSchema` (or `responseSchema`), and return a `json` part.
  - When tools are present: 2.5 does not allow function calling together with JSON mime. Use the same synthetic `final_output` function as Anthropic, with mode `AUTO`.
- **Finish reasons:**
  - `STOP` → `tool_use` if any `functionCall` parts are present, otherwise `end`
  - `MAX_TOKENS` → `max_tokens`
  - `SAFETY` / `RECITATION` / `BLOCKLIST` / `PROHIBITED_CONTENT` / `SPII`, or `promptFeedback.blockReason` with no candidates → `refused`
  - `MALFORMED_FUNCTION_CALL` / `UNEXPECTED_TOOL_CALL` / `OTHER` / unknown → `malformed`
- **Usage:** `inputTokens = promptTokenCount + (toolUsePromptTokenCount ?? 0)`; `outputTokens = (candidatesTokenCount ?? 0) + (thoughtsTokenCount ?? 0)`. `promptTokenCount` already includes `cachedContentTokenCount`; don't add it twice.
- **Errors:** `ApiError.status` 429 → `rate_limited`; other statuses → `http`; an abort → `timeout`.

### D. Usage validity (shared helper, ticket note)
- Add `toUsage(a, b): Usage | null` that returns `null` unless both values are `Number.isSafeInteger(n) && n >= 0`.
- A 200 response with missing or invalid usage must **throw `ProviderError('malformed', null)`**, never return zeros. Zeros would settle at cost 0 and release the reservation. `null` keeps the worst case counted.
- Test this for each adapter.

### E. Ledger port adapter
- Put `aiUsageLedger(db)` in `packages/db/src/repos/ai-usage.ts` (or next to it). It returns `{ reserve, settle, monthSpend }` bound to `db` and doesn't import `@stoktok/ai`; the structural check happens at the wiring site. Web and worker share it, so there is no duplication.
- Pass errors through unchanged so `pgCode` survives. Add one test: a 22023 from the rpc mock reaches the caller with `pgCode === '22023'`.

### F. `apps/web/server/ai.ts`
- Line 1 is `import 'server-only';`.
- Lazy singleton `getAi()`: `new AiClient({ providers: buildProviders(readAiEnv()), ledger: aiUsageLedger(getDb()), log })`, with `getDb` and `aiUsageLedger` re-exported via `./db`.
- `getAiBudgetStatus(): Promise<BudgetStatus>` that calls `getAi().budgetStatus()`. It must work with **no** AI keys: an empty providers map is valid.
- Nothing may run at module top level, so `next build` never builds providers.
- The `log` adapter writes codes and integers only (R9).
- Add the r3-guard assertion for line 1.

### G. Worker
- Add `apps/worker/src/ai.ts` with `createWorkerAi(env = process.env)`, mirroring the web wiring (`createServiceClient`, `aiUsageLedger`, `buildProviders(readAiEnv(env))`, a console log adapter).
- Add a unit test with an injected env: no keys means no providers, and the client constructs.
- No CLI job yet (R7).

### H. `next.config.ts`
- Add `'@stoktok/ai'` to `transpilePackages` and `serverExternalPackages: ['@anthropic-ai/sdk', '@google/genai']`.
- Also add both SDKs, pinned to exactly the same versions, as direct `apps/web` dependencies so the runtime `require` resolves under pnpm and standalone tracing (Finding 9). Add `@stoktok/ai` to the web and worker `package.json`.
- Verify by running `scripts/check-image.sh`, or the standalone server, and calling a page that imports `server/ai.ts`.

### I. Client-bundle check (`check-no-service-key-in-client.sh`)
- Build with `ANTHROPIC_API_KEY=sk-ant-SENTINEL-$RANDOM…` and `GOOGLE_AI_API_KEY=goog-SENTINEL-$RANDOM…`.
- Grep `.next/static` for:
  - both sentinels;
  - `ANTHROPIC_API_KEY` and `GOOGLE_AI_API_KEY`;
  - the SDK fingerprints `api.anthropic.com` and `generativelanguage.googleapis.com`.
- The fingerprints prove the SDKs are not in the client bundle; they are the meaningful part (Finding 8).

### J. Settings card (AC3, R1)
- `page.tsx` calls `getAiBudgetStatus()` and passes the `BudgetStatus` integers to a server component `AiUsageCard`.
- Display rules:
  - `level === 'warn'` shows `aiMessage('budget_warn', { percent, spentMicroUsd, capMicroUsd })`.
  - `level === 'exhausted'` shows `aiMessage('budget_exhausted', …)`.
  - The amounts use `formatUsdMicro`.
  - If a progress bar is wanted, its width comes from core (for example `Math.min(percent, 100)` in a core `aiBudgetBarPercent`), not from UI arithmetic.
- Fail soft: if `monthSpend` throws, the card shows "Không tải được chi phí AI" and the rest of Settings still renders.
- Tests:
  - the card renders ok / warn / exhausted / error;
  - the page test covers 79% → ok, 80% → warn, 100% → exhausted. The boundaries come from core; the UI does not compare.
- Copy note: the card counts open reservations at their worst case. A call can be refused while the card still shows "warn" (spent + reserve > cap). Say so in a muted line, or accept it.

### K. Overhead measurement (ticket note)
Without live calls this can only be documented. Anthropic publishes a tool-use system-prompt overhead of roughly 300–350 tokens for Claude 4.x (verify). Gemini publishes none. Keep `providerOverheadTokens` at 1000. Add a manual measurement script (`countTokens` on both providers) as a follow-up, and document the numbers in a `config.ts` comment. Keep `maxToolCallsPerRound` at 8 and document why.

## Split: yes, two tickets
Size estimate:
- Adapters with fixtures and tests: about 900–1,300 lines across 2 SDKs, ~25 fixture files, and error / stop / usage tables.
- Wiring, next.config, sentinel, worker factory, ledger adapter and card: about 400–600 lines.

Both trigger the security auditor, but on different surfaces: SDK mapping versus bundle and secrets. One cycle would very likely hit REWORK.
- **STK-070 (keep):** "Claude and Gemini adapters in `packages/ai`". AC1 plus Recommendations A–D and K. It adds the SDK dependencies to `packages/ai` only, plus the core thinking-budget validation rule. No app changes.
- **STK-07x (new):** "AI wiring and AI usage card". This is the old AC2 and AC3: Recommendations E–J. It depends on STK-070, and STK-064–066 then depend on it.

If Ming wants one ticket, order the plan as adapters → ledger → web/worker → bundle check → card, and expect the review to be long.

## Risks
- **pnpm and standalone resolution of externals** (Finding 9). The build passes but the runtime throws `MODULE_NOT_FOUND`. Only a run of the image or the standalone server catches this.
- **Synthetic `final_output` tool:** the model may answer in prose on non-final rounds. The client then tries `JSON.parse` on the text and falls into `invalid_output`. That fails safe but wastes a round. Test it.
- **Thinking above 0 later** will break multi-turn tool use on both providers unless `Part` gains opaque provider metadata (thinking blocks, thought signatures). Fail closed now (Recommendation B).
- **Cache-write tokens** are billed at 1.25× but costed at 1×. That is fine while `cache_control` is unused; it must be revisited if caching is enabled.
- **SDK error shapes change between versions.** Pin exact versions and map by `status` with a safe fallback to `http`.
- **Stale `reserved` rows** inflate the card's spent figure until the sweep follow-up ships.

## Open questions
1. Approve the split into adapters (STK-070) and wiring + card (new)?
2. Structured output: synthetic `final_output` tool on Anthropic, and native JSON schema on Gemini only when there are no tools? Or native Anthropic structured outputs, if GA for Haiku 4.5?
3. Should Anthropic thinking above 0 be hard-rejected now (recommended), or should `Part` gain a provider-opaque field in this ticket?
4. Add the SDKs as direct `apps/web` dependencies (recommended), or rely on tracing alone?

## Must verify (no online access here)
- Current versions of `@anthropic-ai/sdk` and `@google/genai`: option names (`maxRetries`, `abortSignal`, `parametersJsonSchema` / `responseJsonSchema`, `thinkingConfig`), error class names and stop / finish enums.
- Whether Gemini 2.5's `maxOutputTokens` includes thoughts.
- Anthropic's minimum thinking budget (1024) and whether `thinking: {type:'disabled'}` is accepted.
- The Anthropic tool-use overhead token counts.
- Model IDs and prices in `config.ts`.
- Whether Gemini 2.5 allows function calling together with JSON mime.
- Whether Anthropic structured outputs is GA for Haiku 4.5.

Relevant files:
- /home/user/stoktok/packages/ai/src/types.ts
- /home/user/stoktok/packages/ai/src/client.ts
- /home/user/stoktok/packages/ai/src/tools.ts
- /home/user/stoktok/packages/ai/src/env.ts
- /home/user/stoktok/packages/ai/package.json
- /home/user/stoktok/packages/core/src/ai/config.ts
- /home/user/stoktok/packages/core/src/ai/cost.ts
- /home/user/stoktok/packages/core/src/ai/budget.ts
- /home/user/stoktok/packages/core/src/ai/messages-vi.ts
- /home/user/stoktok/packages/db/src/repos/ai-usage.ts
- /home/user/stoktok/packages/db/src/errors.ts
- /home/user/stoktok/packages/db/src/r3-guard.test.ts
- /home/user/stoktok/apps/web/server/db.ts
- /home/user/stoktok/apps/web/next.config.ts
- /home/user/stoktok/apps/web/app/(app)/settings/page.tsx
- /home/user/stoktok/apps/worker/src/cli.ts
- /home/user/stoktok/scripts/check-no-service-key-in-client.sh
- /home/user/stoktok/supabase/migrations/20261109000100_ai_usage.sql
