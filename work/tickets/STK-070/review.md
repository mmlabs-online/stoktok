## Attempt 1 — 2026-11-10
Verdict: PASS

### Checks (run by reviewer)
- typecheck: `pnpm typecheck`, all 6 workspaces Done, no errors.
- lint: `pnpm lint`, all 6 workspaces Done, no errors.
- test: `pnpm test`: core 776 passed (64 files); sources 35 passed; ai 150 passed (8 files); db 169 passed + 1 todo; worker 292 passed; web 302 passed. Matches impl-log.md.
- No-network proof: `unshare -rn env -u HTTPS_PROXY -u HTTP_PROXY npx vitest run` in `packages/ai` ran in a namespace with no network, with the proxy vars removed: 8 files, 150 passed.
- Client-bundle check: moved to STK-073 per the ticket note, so not judged here.

### Acceptance criteria
Ticket AC1 and the typecheck/lint/test part of AC4 (AC2, AC3 and the bundle part of AC4 moved to STK-073), checked against plan.md AC1–AC10:
- [x] P1 Anthropic adapter: `createAnthropicProvider`, `id:'anthropic'`, injected structural client. Evidence: `packages/ai/src/adapters/anthropic.ts:83-103`. The SDK constructor appears only in the `apiKey` branch (`:88`). The fake client in `anthropic.test.ts:11-25` is a plain object.
- [x] P2 Google adapter: `createGoogleProvider`, `id:'google'`. Evidence: `google.ts:103-123`; `google.test.ts` passes.
- [x] P3 Output cap and thinking set explicitly from the request. Anthropic `max_tokens: outputCap(req)` and `thinking:{type:'disabled'}` (`anthropic.ts:31-32`). Gemini `maxOutputTokens` and `thinkingConfig:{thinkingBudget, includeThoughts:false}` (`google.ts:37-38`). A budget > 0 is rejected before the client is called (`shared.ts:17-19`). Tests: "sets max_tokens and disables thinking…", "sets maxOutputTokens and thinkingConfig…", and both "rejects thinkingBudgetTokens > 0 without calling the API" (`calls` length 0).
- [x] P4 Usage is integer-only, and missing or invalid usage gives `malformed`/null. Evidence: `shared.ts:7-11`, `anthropic.ts:20-25`, `google.ts:24-32`. Tests: shared `toUsage` table (NaN, -1, 1.5, '10', undefined, 2**53), anthropic and google "missing or invalid usage … null usage". Every `ProviderError` carrying usage takes it from a validated `usageOf`.
- [x] P5 Stop/finish and error mapping follow the plan tables. Evidence: `anthropic.ts:65-79`, `google.ts:93-97`, `shared.ts:40-47`. Tests: table-driven stop_reason and finishReason tests, error tables, real SDK `RateLimitError` and `ApiError` (429/503).
- [x] P6 Structured output. Anthropic always uses a synthetic `final_output` tool: forced on the final round, auto beside read tools. Gemini uses `responseJsonSchema` with no tools, otherwise `final_output`. A mix with read calls gives malformed. `assertReadTools` rejects the reserved name (`tools.ts:13`). Tests are present and pass.
- [x] P7 `buildProviders`: only providers whose key is set, Anthropic `maxRetries:0`, Google `retryOptions.attempts:1` (the SDK documents "0 or 1 = no retries"), timeout default 60 000. Evidence: `providers.ts`; `providers.test.ts` has 4 cases and passes under `unshare -rn`, so construction makes no network call.
- [x] P8 Round-trip through the real `AiClient`: tool call, then `final_output`, with FakeLedger. Tests "anthropic through AiClient › tool call then final_output" and the google one pass; settles are ok.
- [x] P9 Overhead documented in comments only, no value changes. Evidence: `packages/core/src/ai/config.ts:49-55`; core tests green.
- [x] P10 Checks green; SDKs pinned exactly: `packages/ai/package.json` has `"@anthropic-ai/sdk": "1.7.0"` and `"@google/genai": "3.0.0"`, with no `^` or `~`. r3-guard is in the db suite, which is green.

**Mapping vs installed SDK types** (read from `node_modules/.pnpm/@anthropic-ai+sdk@1.7.0_zod@4.6.7/…` and `@google+genai@3.0.0/…/dist/genai.d.ts`):
- Anthropic:
  - `ClientOptions.timeout` and `maxRetries` exist. `maxRetries:0` passes `validatePositiveInteger` (providers.test constructs without throwing).
  - `ThinkingConfigDisabled {type:'disabled'}` exists.
  - `StopReason` = end_turn | max_tokens | stop_sequence | tool_use | pause_turn | refusal | model_context_window_exceeded. All seven are mapped.
  - `Usage.input_tokens: number`; `cache_creation_input_tokens` and `cache_read_input_tokens` are `number | null` (null → 0).
  - Error classes set `name` from `_errorName`, so `APIConnectionTimeoutError` matches `includes('Timeout')`.
- Google:
  - `HttpOptions.timeout` and `retryOptions.attempts` exist.
  - `GenerateContentConfig` has `abortSignal`, `systemInstruction`, `maxOutputTokens`, `responseMimeType`, `responseJsonSchema`, `tools` and `thinkingConfig`; `ThinkingConfig` has `thinkingBudget` and `includeThoughts`.
  - `FunctionDeclaration.parametersJsonSchema` exists; `FunctionCall` has `id?`, `name?`, `args?`.
  - Every `FinishReason` value is handled (unlisted ones such as LANGUAGE, TOO_MANY_TOOL_CALLS and IMAGE_* → malformed, which fails closed).
- No mismatches found.

**Lockfile:**
- Adds `@anthropic-ai/sdk@1.7.0` (deps: `@opentelemetry/api`, `json-schema-to-ts`, `standardwebhooks`) and `@google/genai@3.0.0` (deps: `google-auth-library`, `p-retry`, `protobufjs`, `ws`), plus their transitive packages.
- All entries are registry resolutions with sha512 integrity. There are no tarball or git URLs.
- The only removals are snapshot keys of `next`, `@supabase/supabase-js`, `@supabase/ssr` and `vitest`. They are re-keyed because `@opentelemetry/api` (an optional peer of those packages) is now present in the workspace. Their versions are unchanged. This is expected from `pnpm add` and is not a blocker.

### Scope
- Every code file in the diff is in the plan's file list.
- The other changed files are orchestrator ticket and board bookkeeping for the split: `work/backlog.md`, the `STK-064/065/066/073` tickets, and this ticket's consults, plan and ticket.
- There are no `apps/**` or `packages/db/**` changes.

### Issues
None blocking.

### Rules R1–R10
No violations found.
- R1/R2: no money math in the adapters, and tokens are validated as integers.
- R3: the SDKs and keys stay in `packages/ai`, and the adapters take `apiKey` as an argument.
- R5: limits come from the request.
- R7: within plan.
- R8: tests are present.
- R9: error messages carry codes only, and `mapThrown` drops the provider message.

### Nits (do not block)
- `anthropic.ts:56`: a second `final_output` block silently overwrites the first. Gemini counts it and returns malformed (`google.ts:86-90`). Making Anthropic match would be more consistent.
- `buildParams` in both adapters can send a message whose content is empty when all its parts are empty text. Anthropic rejects empty content with a 400, which maps to `http`. This cannot happen with the current callers.
- `providers.test.ts` does not assert `maxRetries:0` or `attempts:1` on the built clients. These are verified by reading the code only.

### Follow-ups (out of scope)
- **SDK env reads (hardening, fits STK-073).** Both SDKs read env vars themselves, even when `apiKey` is passed:
  - Anthropic reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_LOG` (debug logging can print request bodies) and resolves OpenTelemetry options.
  - `@google/genai` reads `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_GEMINI_BASE_URL`, `GOOGLE_CLOUD_PROJECT` and others.
  - Fix: pass explicit `baseURL`, `logLevel: 'off'` (or a no-op logger) and `vertexai: false`. Alternatively, have the deploy env guarantee these are unset.
- **Truncated `final_output`.** When `final_output` is present, both adapters return `stop:'end'` even if `stop_reason` is `max_tokens` or `refusal` (or `finishReason` is MAX_TOKENS/SAFETY). The client's schema validation catches truncated input as `invalid_output`. Consider letting `max_tokens` or refused take precedence.
- **Gemini overload mapping.** A Gemini 503 (overloaded/UNAVAILABLE) maps to `http`, while Anthropic 529 maps to `rate_limited`. Decide whether 503 should be `rate_limited` for fallback behaviour.
- **Model compatibility.** If Gemini 3.x models replace `gemini-2.5-flash`, function-call `thoughtSignature` parts must round-trip even at thinking 0. This belongs with the "thinking + tools on `Part`" follow-up.
- **Error diagnostics.** `mapThrown` drops every provider detail. Add a sanitised status or error-type code (no body text) for diagnostics.
- **Carried from plan/impl-log:** `scripts/record-ai-fixtures.sh`, a `countTokens` overhead measurement, Anthropic `cache_control` costing, the stale `reserved` sweep, and all items in the impl-log "verify before go-live" list.
