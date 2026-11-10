## Attempt 1 — 2026-11-10

### Files touched
| File | Required because |
|---|---|
| packages/ai/package.json | Exact-pinned `@anthropic-ai/sdk` 1.7.0 and `@google/genai` 3.0.0 (`pnpm add -E`) |
| pnpm-lock.yaml | Lockfile update from the add |
| packages/ai/src/adapters/shared.ts | toUsage, outputCap, assertNoThinking, wrap/unwrap output schema, stripJsonSchemaMeta, mapThrown, FINAL_OUTPUT_TOOL |
| packages/ai/src/adapters/anthropic.ts | `createAnthropicProvider` |
| packages/ai/src/adapters/google.ts | `createGoogleProvider` |
| packages/ai/src/providers.ts | `buildProviders` |
| packages/ai/src/__fixtures__/anthropic.ts, google.ts | Hand-authored API-shaped responses (not recorded live) |
| packages/ai/src/adapters/shared.test.ts, anthropic.test.ts, google.test.ts, providers.test.ts | Planned tests |
| packages/ai/src/tools.ts, tools.test.ts | Reserved name `final_output` rejected in `assertReadTools` |
| packages/ai/src/index.ts | Exports for the wiring ticket |
| packages/core/src/ai/config.ts | Comments only on providerOverheadTokens / maxToolCallsPerRound |

### Tests added / changed
- shared.test: toUsage (valid / NaN, -1, 1.5, '10', undefined, 2**53), schema wrap/unwrap, stripJsonSchemaMeta, mapThrown table + aborted signal
- anthropic.test: request mapping, ToolDef mapping, max_tokens/thinking/signal, thinking>0 rejected without call, tool_choice forced/auto, response text/tools/final_output (incl. unwrapped), mixed final_output malformed, stop_reason table, thinking blocks, usage sum, invalid usage, error table, real `RateLimitError`, AiClient round-trip
- google.test: contents/roles/ids mapping, functionDeclarations, config caps/thinkingConfig/signal, thinking>0 rejected, JSON mode vs final_output tool, synthetic ids, finishReason table, no-candidates/blockReason, thought parts, usage mapping and invalid usageMetadata, error table, real `ApiError`, AiClient round-trip
- providers.test: {} / anthropic only / google only / both
- tools.test: reserved name `final_output`
- All use injected fake clients and fixtures; no network.

### Checks (actual output summary)
- typecheck: all workspaces pass (no errors)
- lint: all workspaces pass (no errors)
- test: core 776 passed; sources 35 passed; ai 150 passed (8 files); db 169 passed + 1 todo; worker 292 passed; web 302 passed

### SDK facts confirmed from installed .d.ts
- Versions: `@anthropic-ai/sdk` 1.7.0, `@google/genai` 3.0.0 (pinned exactly).
- Anthropic: `new Anthropic({ apiKey, maxRetries, timeout })` exist (ClientOptions). `thinking: {type:'disabled'}` is a valid `ThinkingConfigParam`. `tool_choice` `{type:'tool', name}` / `{type:'auto'}` valid. `StopReason` = end_turn | max_tokens | stop_sequence | tool_use | pause_turn | refusal | model_context_window_exceeded (matches the mapping table). Usage has `input_tokens`, `output_tokens`, `cache_creation_input_tokens | null`, `cache_read_input_tokens | null` (null handled as invalid? no: `?? 0` treats null as 0). Error classes exist and are exported: `APIError` (has `status`), `RateLimitError` (429), `OverloadedError` (extends InternalServerError), `APIUserAbortError`, `APIConnectionTimeoutError`. Per-request `signal` option used as second arg of `messages.create`.
- Google: `httpOptions.timeout` and `httpOptions.retryOptions.attempts` exist; "0 or 1 = no retries", so `attempts: 1` is set (default is 5). `GenerateContentConfig` has `abortSignal`, `maxOutputTokens`, `systemInstruction`, `thinkingConfig {includeThoughts, thinkingBudget}` ("0 is DISABLED"), `responseMimeType`, `responseJsonSchema`, `tools`. `FunctionDeclaration.parametersJsonSchema` exists (used instead of `parameters`). `FunctionCall`/`FunctionResponse` have optional `id`, `name`, `args`/`response`. `FinishReason` enum includes STOP, MAX_TOKENS, SAFETY, RECITATION, LANGUAGE, OTHER, BLOCKLIST, PROHIBITED_CONTENT, SPII, MALFORMED_FUNCTION_CALL, IMAGE_SAFETY, UNEXPECTED_TOOL_CALL and more (unlisted ones, e.g. LANGUAGE, map to malformed). Usage metadata fields: promptTokenCount, candidatesTokenCount, thoughtsTokenCount, toolUsePromptTokenCount, cachedContentTokenCount. `ApiError` has numeric `status`. `promptFeedback.blockReason` exists.
- Difference from plan: Google `retryOptions.attempts` exists, so retries are set (not "no retries to disable").

### Still verify-before-go-live (not checkable offline)
- Fixture shapes vs real responses (follow-up: record script).
- Whether the API accepts `thinking: {type:'disabled'}` on the configured Claude models (the type allows it).
- Whether Gemini 2.5 `maxOutputTokens` includes thought tokens; whether `thinkingBudget: 0` disables thinking on `gemini-2.5-flash`; whether a Gemini model allows `responseMimeType` JSON when the history contains functionCall parts (final round after tool use uses JSON mode with no tools).
- Whether Anthropic rejects history with `tool_use` blocks but no `tools` param (risk for STK-066 text-only final round after tool use).
- Anthropic returns `cache_*` tokens as null; adapter treats null as 0 via `?? 0`. Real traffic should confirm.
- Anthropic tool-use overhead figures, model IDs and prices in config.ts.
- Real error `name` values: `mapThrown` matches `AbortError` or names containing `Timeout`; Anthropic classes set `name` from `_errorName` (class names such as `APIConnectionTimeoutError`), but `APIUserAbortError` is only mapped via the aborted signal. Verify with real aborts.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- `scripts/record-ai-fixtures.sh` (manual, live); overhead measurement script with `countTokens`; thinking + tools support on `Part`; Anthropic cache_control costing; stale `reserved` row sweep.
- Gemini `LANGUAGE` finish reason is mapped to malformed; consider whether it should be refused.

### Scope self-check
- Could the diff be smaller? No; every file is in the plan list.
- Diff size: ~+390/-17 in tracked files (mostly pnpm-lock.yaml) plus new adapter, fixture and test files.

## Attempt 2 (REWORK: security-review attempt 1 findings 1-4)

### Files touched
- `packages/ai/src/adapters/anthropic.ts`: stop-reason mapping now runs before `final_output` is returned (truncated -> `max_tokens` with no parts, refusal -> `refused`, unknown -> `malformed`); a second `final_output` block -> `malformed` with usage; SDK pinned with `baseURL`, `authToken: null`, `logLevel: 'off'`.
- `packages/ai/src/adapters/google.ts`: finish-reason mapping before `final_output` (same rules); when output parts came back and `candidatesTokenCount` is missing, output tokens = `totalTokenCount - prompt - toolUsePrompt` (thoughts included), otherwise `malformed` with null usage; SDK pinned with `vertexai: false`, `httpOptions.baseUrl`.
- `packages/ai/src/adapters/anthropic.test.ts`, `google.test.ts`: new cases for each finding; one old Google assertion (text output with only `promptTokenCount` -> 0 output) changed to use no output parts, since that case is now `malformed`.
- `packages/ai/src/adapters/sdk-pins.test.ts` (new): mocks both SDK constructors and asserts the pinned options.

Shared helpers unchanged. SDK option names confirmed in installed .d.ts (`ClientOptions.baseURL/authToken/logLevel` incl. `'off'`; `GoogleGenAIOptions.vertexai`, `HttpOptions.baseUrl`).

### Checks
- typecheck, lint: all workspaces pass
- test: ai 165 passed (9 files); core 776; sources 35; db 169 + 1 todo; worker 292; web 302

### Out-of-plan files
None. Not committed (as instructed).
