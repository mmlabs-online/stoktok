Status: READY

# Plan — STK-070: Claude and Gemini adapters in `@stoktok/ai` (STK-063 slice 3a)

> **Scope decision: split.** This plan covers only the adapters (ticket AC1, plus the adapter carry-overs and the overhead documentation). The wiring and the Settings usage card (ticket AC2, AC3) move to a new ticket. See `## Split proposal`. The orchestrator should update the ticket title, ACs and backlog to match.

## Spec summary
- spec-v1 §4 diagram: "News adapters ──► LLM provider (summaries / explanations)". §9 open question 6: "LLM provider (e.g. reuse the provider already used in Ricotdin, or another)". Resolved by STK-063: Anthropic + Google, models and prices in `packages/core/src/ai/config.ts`.
- spec-v1 §6.2: "Output is structured JSON validated against a schema before display." The client (`packages/ai/src/client.ts`) validates the output. The adapters must return the model's JSON unchanged, as a `json` part or as text.
- spec-v1 §7: "Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo." Keys come only from `readAiEnv` (`packages/ai/src/env.ts`). The adapters accept an `apiKey` argument and never read `process.env`.
- CLAUDE.md R3: "Service role key is server-only… never in client bundles." The SDKs are imported only under `packages/ai/`. This is already enforced by `packages/db/src/r3-guard.test.ts:63`.
- CLAUDE.md R5: "Market rules are configuration." By extension (STK-063), models, token limits and the thinking budget come from `AI_CONFIG`. The adapter only uses `req.maxOutputTokens` and `req.thinkingBudgetTokens` and has no limits of its own.
- Ticket AC1: "Anthropic (`@anthropic-ai/sdk`) and Google (`@google/genai`) adapters inside `packages/ai`, tested with recorded responses and an injected client or fetch (no network in CI). Each adapter sets `maxOutputTokens` and the thinking budget explicitly from config."
- Ticket carry-overs: "Adapters enforce `maxOutputTokens` and the thinking budget on the provider side (Gemini thinking budgets are soft), and only put valid integer usage into `ProviderError`." Also: "Measure or document the real per-provider overhead behind `providerOverheadTokens` (default 1000) and `maxToolCallsPerRound` (default 8)."

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Anthropic adapter `createAnthropicProvider` implements `LlmProvider` (`id: 'anthropic'`) using `@anthropic-ai/sdk`, tested with an injected fake client returning recorded-shape responses. No network. | `packages/ai/src/adapters/anthropic.test.ts` passes. Read the tests: the fake client is a plain object, and the SDK constructor appears only in the factory branch that receives `apiKey`. `pnpm --filter @stoktok/ai test` passes offline. |
| 2 | Google adapter `createGoogleProvider` implements `LlmProvider` (`id: 'google'`) using `@google/genai`, tested the same way. | `packages/ai/src/adapters/google.test.ts` passes. |
| 3 | Each adapter sets the provider-side output cap explicitly to `maxOutputTokens + thinkingBudgetTokens`, and sets thinking explicitly from `req.thinkingBudgetTokens`: Anthropic `thinking: {type:'disabled'}`, Gemini `thinkingConfig: {thinkingBudget: 0, includeThoughts: false}`. A budget > 0 is rejected before any API call, because thinking cannot round-trip through `Part` yet. | Tests `anthropic › sets max_tokens and disables thinking from the request`, `google › sets maxOutputTokens and thinkingConfig from the request`, and `* › rejects thinkingBudgetTokens > 0 without calling the API`. The fake client's recorded params are asserted exactly. |
| 4 | Usage is mapped to integer `Usage`. A 200 response with missing or invalid usage throws `ProviderError('malformed', null)` and never returns zeros. `ProviderError` only ever carries valid safe non-negative integer usage, or `null`. | Tests `shared › toUsage rejects NaN, negatives, floats, strings and unsafe integers`, `anthropic › missing usage → malformed with null usage`, `google › missing usageMetadata → malformed with null usage`, and the refusal tests asserting `err.usage`. |
| 5 | Stop/finish reasons, refusals and errors map to `ProviderResponse.stop` / `ProviderErrorCode` per the tables in Approach. | Table-driven tests `anthropic › maps stop_reason …`, `anthropic › maps errors …`, `google › maps finishReason …`, `google › maps errors …`, plus one test per SDK that uses the real SDK error class. |
| 6 | Structured output works with and without tools: a synthetic `final_output` tool (both providers when tools are present; Anthropic always), and native JSON mode on Gemini when no tools are present. `final_output` is a reserved name that a read tool cannot use. | Tests `anthropic › forces final_output on the final round`, `anthropic › final_output call maps to a json part with stop end`, `google › uses responseJsonSchema when there are no tools`, `google › final_output function call maps to json`, `* › final_output mixed with read calls → malformed`, `tools › assertReadTools rejects the reserved name final_output`. |
| 7 | `buildProviders(env: AiEnv)` returns only the providers whose key is present, with SDK retries set to 0 and the SDK timeout at most the client timeout. | `packages/ai/src/providers.test.ts`: `{}` → `{}`; Anthropic key only → only `anthropic`; both keys → both, with ids matching their keys. Construction makes no network call. |
| 8 | An end-to-end check through the real `AiClient`: an adapter with a fake SDK client, plus `FakeLedger`, runs a tool round and then a final JSON round. | Test `anthropic › AiClient round-trip with a tool call then final_output` and the same for google. Both are in the adapter test files. |
| 9 | Overhead defaults are documented: `providerOverheadTokens` and `maxToolCallsPerRound` have a comment stating what they cover, the published figures (verify-before-go-live), and the follow-up measurement script. | Read `packages/core/src/ai/config.ts`. Only comments change. `config.test.ts` stays green. |
| 10 | `pnpm typecheck`, `pnpm lint`, `pnpm test` are green. SDK versions are pinned exactly. | Run the commands. In `packages/ai/package.json` both SDK versions have no `^` or `~`. `r3-guard.test.ts` still passes, so SDK imports stay under `packages/ai/` and no key names appear outside `env.ts`. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/ai/package.json` | Add `@anthropic-ai/sdk` and `@google/genai` as exact-pinned `dependencies` (`pnpm --filter @stoktok/ai add -E …`). Add an `./adapters` export only if index re-exports are not enough (not expected). | AC1, AC10 |
| `pnpm-lock.yaml` | Lockfile update from the add. | AC10 |
| `packages/ai/src/adapters/shared.ts` | New: `toUsage`, `FINAL_OUTPUT_TOOL = 'final_output'`, `wrapOutputSchema` / `unwrapOutput` (wraps a non-object top-level schema as `{value}`), `stripJsonSchemaMeta` (drops `$schema`), `assertNoThinking(req)`, `mapThrown(e, signal)` (status/name → `ProviderErrorCode`), `outputCap(req)`. | AC3–AC6. Shared by both adapters so the rules are defined once. |
| `packages/ai/src/adapters/anthropic.ts` | New: `AnthropicMessagesClient` structural type, `createAnthropicProvider({ client } \| { apiKey, timeoutMs? })`, request/response mapping. | AC1, AC3–AC6 |
| `packages/ai/src/adapters/google.ts` | New: `GoogleModelsClient` structural type, `createGoogleProvider({ client } \| { apiKey, timeoutMs? })`, request/response mapping. | AC2–AC6 |
| `packages/ai/src/providers.ts` | New: `buildProviders(env: AiEnv, opts?: { timeoutMs?: number }): Partial<Record<AiProvider, LlmProvider>>`. | AC7. Consumed by the wiring ticket. |
| `packages/ai/src/__fixtures__/anthropic.ts` | New: hand-authored, API-shaped response objects (typed `as const`). | AC1 ("recorded responses"), no network |
| `packages/ai/src/__fixtures__/google.ts` | New: the same for Gemini `generateContent`. | AC2 |
| `packages/ai/src/adapters/shared.test.ts` | New tests. | AC4, AC5 |
| `packages/ai/src/adapters/anthropic.test.ts` | New tests. | AC1, AC3–AC6, AC8 |
| `packages/ai/src/adapters/google.test.ts` | New tests. | AC2–AC6, AC8 |
| `packages/ai/src/providers.test.ts` | New tests. | AC7 |
| `packages/ai/src/tools.ts` | `assertReadTools` rejects the reserved tool name `final_output` (import the constant from `adapters/shared.ts`). | AC6. Prevents a read tool from colliding with the synthetic output tool. |
| `packages/ai/src/tools.test.ts` | Add one test for the reserved name. | AC6 |
| `packages/ai/src/index.ts` | Export `createAnthropicProvider`, `createGoogleProvider`, `buildProviders` and the two client types. | AC7. The wiring ticket imports these. |
| `packages/core/src/ai/config.ts` | Comments only, on `providerOverheadTokens` and `maxToolCallsPerRound` (no value changes). | AC9, ticket carry-over |

Out of scope here (they belong to the wiring ticket): `apps/web/**`, `apps/worker/**`, `next.config.ts`, `scripts/check-no-service-key-in-client.sh`, `packages/db/**` (ledger port adapter, r3-guard `server/ai.ts` assertion).

## Tests to write
| Test (file › name) | Covers |
|---|---|
| shared.test › toUsage accepts safe non-negative integers | AC4 |
| shared.test › toUsage returns null for NaN, -1, 1.5, '10', undefined, 2**53 | AC4 |
| shared.test › wrapOutputSchema keeps object schemas and wraps array/primitive schemas; unwrapOutput reverses it | AC6 |
| shared.test › stripJsonSchemaMeta removes top-level `$schema` and leaves the rest unchanged | AC1 |
| shared.test › mapThrown: ProviderError passes through; status 429 → rate_limited; status 529 → rate_limited; status 500/400 → http; name AbortError or aborted signal → timeout; name containing `Timeout` → timeout; unknown/non-object → http; usage is always null | AC5 |
| anthropic.test › maps system, text, tool_call→tool_use, tool_result→tool_result and drops empty text parts | AC1 |
| anthropic.test › maps ToolDef to {name, description, input_schema} without $schema | AC1 |
| anthropic.test › sets max_tokens = maxOutputTokens + thinkingBudgetTokens and thinking {type:'disabled'} | AC3 |
| anthropic.test › rejects thinkingBudgetTokens > 0 with ProviderError('malformed', null) and does not call the client | AC3 |
| anthropic.test › passes req.signal to messages.create options | AC1 |
| anthropic.test › text response, end_turn → stop end, text part | AC5 |
| anthropic.test › tool_use with three calls → three tool_call parts, stop tool_use | AC5 |
| anthropic.test › final round with output: tools = [final_output], tool_choice forced; non-final with output: final_output beside read tools, tool_choice auto; no output and no tools: tools omitted | AC6 |
| anthropic.test › final_output call → [json] part, stop end; wrapped schema is unwrapped | AC6 |
| anthropic.test › final_output together with a read tool call → ProviderError('malformed', usage) | AC6 |
| anthropic.test › maps stop_reason: end_turn/stop_sequence → end, tool_use → tool_use, max_tokens/model_context_window_exceeded → max_tokens, refusal → refused (with usage), pause_turn/unknown → malformed (with usage) | AC5 |
| anthropic.test › thinking or redacted_thinking block in the response → malformed (with usage) | AC3 |
| anthropic.test › usage = input + cache_creation + cache_read, output = output_tokens | AC4 |
| anthropic.test › missing or non-integer usage → ProviderError('malformed', null) | AC4 |
| anthropic.test › maps errors: 429, 529, 500, abort, connection timeout | AC5 |
| anthropic.test › maps an instance of the real SDK error class (e.g. `RateLimitError`) to rate_limited | AC5 |
| anthropic.test › AiClient round-trip with a tool call then final_output (FakeLedger, seqRng) | AC8 |
| google.test › maps systemInstruction, roles user/model, functionCall, functionResponse {response:{result}} | AC2 |
| google.test › tools go in config.tools[{functionDeclarations}] using the JSON-schema field of the pinned SDK | AC2 |
| google.test › sets maxOutputTokens = max + thinking and thinkingConfig {thinkingBudget: 0, includeThoughts: false} | AC3 |
| google.test › rejects thinkingBudgetTokens > 0 with ProviderError('malformed', null) and does not call the client | AC3 |
| google.test › passes req.signal as config.abortSignal | AC2 |
| google.test › no tools + output → responseMimeType application/json + response JSON schema; the text comes back as a text part | AC6 |
| google.test › tools + output → final_output function added; final_output call → json part, stop end | AC6 |
| google.test › final_output together with a read call → malformed (with usage) | AC6 |
| google.test › function calls without id get synthetic ids `gsyn_{round}_{i}`; synthetic ids are omitted on the way back; real ids are echoed | AC2 |
| google.test › maps finishReason: STOP → end or tool_use, MAX_TOKENS → max_tokens, SAFETY/RECITATION/BLOCKLIST/PROHIBITED_CONTENT/SPII → refused, MALFORMED_FUNCTION_CALL/UNEXPECTED_TOOL_CALL/OTHER/unknown → malformed; promptFeedback.blockReason with no candidates → refused | AC5 |
| google.test › parts with thought: true are dropped; unknown part kinds → malformed | AC3, AC5 |
| google.test › usage = promptTokenCount + toolUsePromptTokenCount, output = candidates + thoughts (missing candidates/thoughts → 0); missing usageMetadata or promptTokenCount → malformed with null | AC4 |
| google.test › maps errors: ApiError-like status 429 → rate_limited, 500 → http, abort → timeout; plus one test with the real SDK `ApiError` class | AC5 |
| google.test › AiClient round-trip with a tool call then final_output | AC8 |
| providers.test › {} → {}; only anthropic; only google; both, with ids matching keys | AC7 |
| tools.test › assertReadTools rejects a read tool named final_output | AC6 |

## Approach
1. **Dependencies.** Run `pnpm --filter @stoktok/ai add -E @anthropic-ai/sdk @google/genai`. Then read the installed type definitions (`node_modules/@anthropic-ai/sdk/**/*.d.ts`, `node_modules/@google/genai/dist/*.d.ts`) and confirm every option name used below. Wherever a name differs, use the real name and record the difference in `impl-log.md`. Do not invent fields to satisfy the types.
2. **`adapters/shared.ts`** (pure, no SDK imports):
   - `toUsage(input, output): Usage | null` returns null unless both values satisfy `Number.isSafeInteger(n) && n >= 0`.
   - `outputCap(req) = req.maxOutputTokens + req.thinkingBudgetTokens`. This matches the reserve assumption in `packages/core/src/ai/cost.ts`.
   - `assertNoThinking(req)` throws `new ProviderError('malformed', null, 'thinking_unsupported')` when `req.thinkingBudgetTokens !== 0`. The reason is that `Part`/`ResponsePart` cannot carry thinking blocks or thought signatures, which both providers require on tool turns (architect Finding 1). It runs before any client call. All config values are 0 today.
   - `FINAL_OUTPUT_TOOL`, `wrapOutputSchema(schema) → { schema, wrapped }` (a top-level schema that is not `type: 'object'` becomes `{type:'object', properties:{value: schema}, required:['value'], additionalProperties:false}`), `unwrapOutput(input, wrapped)`.
   - `stripJsonSchemaMeta`.
   - `mapThrown(e, signal): ProviderError`. It duck-types `status` and `name`, so fakes can throw plain objects. The result always has `usage: null`.
3. **Anthropic adapter (`adapters/anthropic.ts`).** Imports `@anthropic-ai/sdk` only in the factory branch that builds `new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs })`. The injected type is structural: `{ messages: { create(params, opts?: { signal?: AbortSignal }): Promise<unknown> } }`. The response is treated as `unknown` and narrowed defensively: never trust shapes, and anything unexpected → `malformed`.
   - **Request.**
     - `model`, `system`, `max_tokens: outputCap(req)`, `thinking: { type: 'disabled' }`.
     - `messages`: text → `{type:'text'}` (empty text is dropped), `tool_call` → `tool_use{id,name,input}`, `tool_result` → `tool_result{tool_use_id, content: text}`.
     - `tools`: `ToolDef` → `{name, description, input_schema: stripJsonSchemaMeta(inputSchema)}`.
     - With `req.output`: add `{name: 'final_output', description: 'Return the final answer', input_schema: wrapped}`. `tool_choice` is `{type:'tool', name:'final_output'}` when `req.tools` is empty (final round), else `{type:'auto'}`.
     - With no tools and no output: omit `tools` and `tool_choice`.
     - Call `create(params, { signal: req.signal })`.
   - **Response.**
     - Compute `usage = toUsage(input_tokens + (cache_creation_input_tokens ?? 0) + (cache_read_input_tokens ?? 0), output_tokens)`. The sum is formed only from values that are each valid integers, otherwise null. If null → throw `malformed, null`.
     - Map content blocks: `text` → text part; `tool_use` named `final_output` → json (unwrapped); other `tool_use` → tool_call. `thinking`, `redacted_thinking` or unknown blocks → `malformed, usage`.
     - A `final_output` together with any other tool_use → `malformed, usage`. When `final_output` is present, return `{parts:[json], stop:'end'}`.
     - `stop_reason` mapping: `end_turn`/`stop_sequence` → `end`; `tool_use` → `tool_use`; `max_tokens`/`model_context_window_exceeded` → `max_tokens`; `refusal` → throw `refused, usage`; `pause_turn` or anything else → throw `malformed, usage`.
   - **Errors.** Wrap the `create` call in try/catch and rethrow `mapThrown(e, req.signal)`. A 529 is mapped to `rate_limited`.
4. **Google adapter (`adapters/google.ts`).** Imports `@google/genai` only in the factory branch: `new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } })`. If the installed SDK exposes a retry option, set it to 0; otherwise note in `impl-log.md` that the SDK has no retries to disable (verify). The injected type is `{ models: { generateContent(params): Promise<unknown> } }`.
   - **Request.**
     - `model`.
     - `contents`: role `user`/`model`. text → `{text}`; tool_call → `{functionCall:{name, args: input, id?}}`; tool_result → `{functionResponse:{name, response:{result: text}, id?}}`. `id` is included only when it is not a synthetic `gsyn_` id.
     - `config`: `systemInstruction`, `maxOutputTokens: outputCap(req)`, `thinkingConfig: {thinkingBudget: req.thinkingBudgetTokens, includeThoughts: false}`, `abortSignal: req.signal`.
     - `tools`: `[{functionDeclarations:[{name, description, parametersJsonSchema}]}]`. Use the JSON-schema field if the pinned SDK has it, otherwise `parameters`, and record which.
     - Output handling: if `req.output` and no read tools → `responseMimeType:'application/json'` + `responseJsonSchema` (or `responseSchema`; record which), and no tools. If `req.output` and read tools → add the `final_output` declaration with the wrapped schema. If `req.output` and the final round (no read tools) → native JSON mode as in the first case.
   - **Response.**
     - `usage = toUsage(promptTokenCount + (toolUsePromptTokenCount ?? 0), (candidatesTokenCount ?? 0) + (thoughtsTokenCount ?? 0))`. A missing `usageMetadata` or missing `promptTokenCount` → `malformed, null`. Do not add `cachedContentTokenCount`, because it is already inside `promptTokenCount`.
     - No candidates with `promptFeedback.blockReason` → `refused, usage`. No candidates otherwise → `malformed, usage`.
     - Take `candidates[0].content.parts`. `thought: true` parts are dropped. `text` → text part. `functionCall` named `final_output` → json (unwrapped). Other `functionCall` → tool_call, with `id = functionCall.id ?? \`gsyn_${round}_${i}\``, where `round` = number of assistant messages in `req.messages`. Any other part kind → `malformed, usage`.
     - `final_output` with any other call → `malformed, usage`.
     - `finishReason` mapping: `STOP` → `tool_use` if there are tool_call parts, `end` otherwise (a `final_output` call → `end`); `MAX_TOKENS` → `max_tokens`; `SAFETY`/`RECITATION`/`BLOCKLIST`/`PROHIBITED_CONTENT`/`SPII` → throw `refused, usage`; `MALFORMED_FUNCTION_CALL`/`UNEXPECTED_TOOL_CALL`/`OTHER`/unknown/missing → throw `malformed, usage`.
   - **Errors.** Wrap the call and rethrow via `mapThrown`.
5. **`providers.ts`.** `buildProviders(env, { timeoutMs = 60_000 } = {})` returns an anthropic provider if `env.anthropicApiKey` is set and a google provider if `env.googleAiApiKey` is set. Nothing runs at module top level.
6. **`tools.ts`.** `assertReadTools` throws `TypeError('reserved tool name final_output')`. This runs at the start of `generate()`, before any reserve.
7. **`index.ts`.** Add the exports.
8. **`config.ts` comments (AC9).**
   - `providerOverheadTokens`: covers the provider's hidden tool-use system prompt and the message/tool framing not counted in our UTF-8 byte estimate. Anthropic publishes roughly 300–350 tokens of tool-use system prompt for Claude 4.x models, plus the `final_output` definition (verify-before-go-live). Google publishes no figure. 1000 is a conservative upper bound until measured with each provider's `countTokens` (follow-up script).
   - `maxToolCallsPerRound = 8`: bounds the tool runs and result bytes per round. Gemini and Claude both emit parallel calls; 8 covers the expected read tools of STK-066 (verify against real traffic).
   - No value changes.
9. **Run** `pnpm typecheck && pnpm lint && pnpm test`.

**Rules:**
- R1: no money math in adapters; cost stays in core `usageCostMicroUsd`.
- R2: tokens are integers, validated by `toUsage`.
- R3: SDKs and keys stay in `packages/ai` (existing r3-guard), and the adapter never reads env.
- R5: every limit comes from the request, which comes from `AI_CONFIG`.
- R7: no app wiring.
- R8: tests listed above.
- R9: adapters log nothing, and error messages carry codes only, never prompt or response text.
- R10: not affected.

## Specialist input used
- **software-architect A (factories, injected structural clients, `buildProviders`, retries 0, signal, timeout):** adopted.
- **software-architect A (`scripts/record-ai-fixtures.sh`):** deferred to follow-up. CI uses hand-authored fixtures.
- **software-architect B (Anthropic mapping, synthetic `final_output`, stop/usage/error tables, disabled thinking, reject > 0):** adopted.
- **software-architect B (core `validateAiConfig` "0 or ≥ 1024" rule):** rejected for this slice. The adapters reject any value > 0, so the rule would be untestable preparation based on an unverified API minimum. Revisit with the "thinking + tools" follow-up.
- **software-architect B (native Anthropic structured outputs):** rejected. GA for Haiku 4.5 cannot be verified here, and the synthetic tool works on every model.
- **software-architect B (reserved-name guard):** adopted via `assertReadTools` rather than the adapter, so it fails before any reserve.
- **software-architect C (Gemini mapping):** adopted, with two changes:
  - Thinking > 0 is also rejected on Gemini (thought signatures cannot round-trip). This matches Anthropic and fails closed.
  - Native-JSON responses come back as a text part rather than a pre-parsed json part, so a bad JSON string falls into the client's existing `invalid_output` / `schema_mismatch` path with usage settled.
- **software-architect C (synthetic Gemini IDs):** adopted, with the prefix rule that synthetic IDs are not echoed back.
- **software-architect D (`toUsage`, missing usage → malformed with null):** adopted. For Gemini, a missing `candidatesTokenCount`/`thoughtsTokenCount` is treated as 0, since Gemini omits zero counts, but `promptTokenCount` is required.
- **software-architect K (document overheads, keep defaults, follow-up measurement script):** adopted.
- **software-architect E–J (ledger port, server/ai.ts, worker, next.config, bundle check, card):** moved to the new wiring ticket (see the split).
- **software-architect split recommendation:** adopted.
- **data-visualization-engineer (all items):** moved to the new wiring ticket. Its card recommendations and open questions belong there:
  - placement above the form, outside `SettingsForm`;
  - `role="meter"`;
  - an 80% tick from `warnPpm`;
  - the fail-soft error state;
  - the "configured" flag;
  - `Card` extraction.

## Assumptions
- Fixtures are hand-authored to the documented API shapes, not captured from live calls (no network here). The shapes must be re-checked against real responses before go-live (follow-up: `scripts/record-ai-fixtures.sh`, manual).
- Rejecting a thinking budget > 0 inside the adapter happens after the client has reserved. The client settles that round as `provider_error` with `costMicroUsd: null`, so the worst case stays counted. This is acceptable because thinking > 0 is a config error and no config sets it.
- A `ProviderError` thrown for a refusal or malformed response carries `usage` only when `toUsage` returned non-null.
- `tool_result` is sent to Anthropic as string content, which matches `Part.text`.
- Gemini function responses are sent in a `user`-role content. Verify that the pinned SDK does not require a different role.
- `buildProviders` default `timeoutMs` (60 000) equals the `AiClient` default. The wiring ticket passes the same value to both.
- **Verify before go-live** (cannot be checked offline). The implementer confirms from installed `.d.ts` what can be confirmed and lists the rest in `impl-log.md`:
  - exact SDK versions; option names (`maxRetries`, `timeout`, `httpOptions.timeout`, `abortSignal`, `parametersJsonSchema` vs `parameters`, `responseJsonSchema` vs `responseSchema`, `thinkingConfig`); error class names; the stop/finish enums;
  - whether Anthropic accepts `thinking: {type:'disabled'}` (if not, omit `thinking`, which defaults to off);
  - whether Gemini 2.5's `maxOutputTokens` includes thought tokens;
  - whether `thinkingBudget: 0` disables thinking on `gemini-2.5-flash`;
  - whether Gemini 2.5 allows function calling together with JSON mime type (the plan avoids combining them);
  - whether Anthropic rejects a request whose history has `tool_use` blocks but no `tools` param. This affects a text-only final round after tool use, used only by chat in STK-066. Record it as a risk for STK-066, with no code here;
  - the Anthropic tool-use overhead figures;
  - model IDs and prices in `config.ts`.

## Blocking questions
None. Defaults chosen for Ming to confirm (non-blocking):
1. The split into adapters (STK-070) and wiring + usage card (new ticket). Adopted.
2. Structured output via a synthetic `final_output` tool on Anthropic, and native JSON on Gemini only when there are no tools. Adopted.
3. Thinking budget > 0 is hard-rejected by both adapters until `Part` gains provider-opaque thinking metadata (follow-up). Adopted.

## Split proposal
| Slice | Ticket | Scope | Depends on | Covered by this plan |
|---|---|---|---|---|
| 3a | **STK-070** — Claude and Gemini adapters in `@stoktok/ai` | Ticket AC1 and the adapter part of AC4 (typecheck/lint/test). Architect A–D and K. SDK dependencies in `packages/ai` only. No app changes. | STK-071, STK-072 (DONE) | **Yes** |
| 3b | **STK-073 (new)** — AI wiring and AI usage card | Ticket AC2 and AC3, and the bundle-check part of AC4. It contains: <ul><li>`aiUsageLedger(db)` in `packages/db` (passes `pgCode` 22023 through, with a test);</li><li>`apps/web/server/ai.ts` (`import 'server-only'` first, lazy `getAi()` / `getAiBudgetStatus()`, repo functions via `./db`) and the r3-guard line-1 assertion;</li><li>`apps/worker/src/ai.ts` `createWorkerAi(env)` with a test;</li><li>`next.config.ts` `transpilePackages` + `serverExternalPackages`, with the SDKs as exact-pinned direct `apps/web` dependencies (pnpm/standalone resolution);</li><li>AI-key sentinels plus the `api.anthropic.com` / `generativelanguage.googleapis.com` fingerprints in `check-no-service-key-in-client.sh`;</li><li>the read-only "Chi phí AI tháng này" card (per consult-data-visualization-engineer: outside or above `SettingsForm`, `role="meter"`, an 80% tick from `warnPpm`, fail-soft error state, no UI arithmetic).</li></ul> Open UI questions from that consult (configured flag, `Card` extraction) are answered in its plan. | STK-070 | No |
| — | STK-064, STK-065, STK-066 | Unchanged. They now wait for STK-073 instead of STK-070. | STK-073 | No |

**Follow-ups to record** (not in either diff):
- `scripts/record-ai-fixtures.sh` (manual, live) to replace hand-authored fixtures.
- An overhead measurement script using `countTokens` on both providers.
- Thinking + tools support (provider-opaque thinking blocks and thought signatures on `Part`).
- Anthropic `cache_control` and costing cache writes at 1.25×.
- The stale `reserved` row sweep (already noted on the ticket).
