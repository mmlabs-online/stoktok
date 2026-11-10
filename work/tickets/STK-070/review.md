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

## Attempt 2 — 2026-11-10
Verdict: PASS

Scope of this attempt: the four security-review attempt 1 fixes Ming asked for (ticket.md, last note), plus a regression check against plan.md. Diff reviewed: `git diff c469b43..HEAD` (attempt 2 commits `5a76d10`, `249bfae`) within `git diff origin/main...HEAD`. Working tree clean.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck`, all 6 workspaces Done, no errors.
- lint: `pnpm lint`, all 6 workspaces Done, no errors.
- test: `pnpm test`: core 776 passed (64 files); sources 35 passed; ai 165 passed (9 files); db 169 passed + 1 todo; worker 292 passed; web 302 passed. Matches impl-log.md attempt 2.
- No network: `unshare -rn env -u HTTPS_PROXY -u HTTP_PROXY npx vitest run` in `packages/ai`: 9 files, 165 passed.

### Acceptance criteria
Ming's note (four fixes):
- [x] 🟡1 Stop/finish reason is mapped before `final_output` is returned.
  - Anthropic `anthropic.ts:64-87`: the switch runs first. `refusal` → `refused, usage`. Unknown or `pause_turn` → `malformed, usage`. `max_tokens`/`model_context_window_exceeded` with `final_output` → `{parts: [], stop:'max_tokens'}`, so the partial JSON is dropped and `client.ts:292` turns it into `invalid_output/truncated`. `end_turn`/`stop_sequence`/`tool_use` → `final_output` with `stop:'end'`. Forced tool choice returns `tool_use`, so the normal path still works.
  - Google `google.ts:94-103`: REFUSED set → `refused`. Anything other than STOP/MAX_TOKENS (including null) → `malformed`. MAX_TOKENS with `final_output` → `{parts: [], stop:'max_tokens'}`.
  - Tests: "anthropic final_output stop handling" (truncated, refusal, unknown reason) and "google final_output stop handling" (MAX_TOKENS, SAFETY, OTHER/null). All pass.
- [x] 🟡2 Gemini no longer settles 0 output tokens when output came back.
  - `google.ts:25-35`: if `candidatesTokenCount` is undefined and the candidate has parts, output = `totalTokenCount - prompt - toolUsePrompt` (thoughts included). A missing, non-integer or negative result → `malformed, null`. With no parts, 0 is kept.
  - Tests: "google missing candidatesTokenCount": derive 170-100-20=50; no total, total below prompt and invalid total each give malformed/null; no parts keeps 0.
- [x] 🟢3 SDK endpoints and env-driven auth/logging are pinned.
  - Anthropic `anthropic.ts:95`: `baseURL: 'https://api.anthropic.com'`, `authToken: null`, `logLevel: 'off'`. I checked the installed SDK `client.js:104,161-163`: explicit `baseURL` replaces the `ANTHROPIC_BASE_URL` default, and `options.logLevel` takes precedence over `ANTHROPIC_LOG`. `LogLevel` includes `'off'`.
  - Google `google.ts:111`: `vertexai: false`, `httpOptions.baseUrl`. In `dist/node/index.mjs:57-68`, `getBaseUrl` returns `httpOptions.baseUrl` before it looks at `GOOGLE_GEMINI_BASE_URL`.
  - Test: `sdk-pins.test.ts` mocks both constructors and asserts these options.
- [x] 🟢4 A second Anthropic `final_output` → `malformed, usage` (`anthropic.ts:58-61`). Test: "second final_output -> malformed with usage".

The changed older Google test:
- [x] `google.test.ts:128`: the case "text output with only `promptTokenCount` → 0 output" now uses no output parts. The change is justified because that exact input is now malformed by design, and the "no total" case in the new describe block covers it. The intent "missing counts → 0 when there is no output" is kept.

Regression check against plan.md (P1–P10):
- [x] The P5 mapping tables are unchanged for responses without `final_output`.
  - Google: the order of checks changed, but the refused set and STOP/MAX_TOKENS do not overlap, so the outcomes are the same.
  - The existing table-driven stop and finish tests still pass.
- [x] P3, P4, P6, P7 and P8 are unchanged.
- [x] The `AiClient` round-trip tests still pass.
- [x] Ticket AC1 and the typecheck/lint/test part of AC4 are still met.

### Scope
- Code changes are limited to `packages/ai/src/adapters/{anthropic,google}.ts` and their tests, plus the new `sdk-pins.test.ts`. All are adapter files in the plan, and the change was requested by Ming.
- The other changes are bookkeeping: `work/backlog.md`, ticket.md and impl-log.md.
- No out-of-plan files.

### Issues
None.

### Rules R1–R10
No violations found.
- R3: endpoints are pinned, and keys come only from the `apiKey` argument.
- R8: every fix has a test.
- R9: truncated or refused structured output is never returned as a complete answer.

### Nits (do not block)
- `google.ts:31-32`: the guard `!ok(raw.totalTokenCount)` duplicates the NaN/negative check on the derived value, and the long ternary is hard to read. A small named helper would be clearer.
- `google.ts:25`: `hasOutput` treats any part as output, including empty text or a thought part. This fails closed (it requires a total), so it is fine.

### Follow-ups (out of scope)
- `usageOf` checks `candidatesTokenCount === undefined`. A `null` value would still go through `?? 0` and settle 0 output tokens. The SDK types the field as `number | undefined`, and proto3 JSON leaves the field out instead of sending null, so this cannot happen today. Using `== null` would close it for free.
- When `candidatesTokenCount` is present, output could be `max(candidates + thoughts, total - prompt - toolUse)`. This was the security review's "safer still" option and was not required.
- The Anthropic SDK still reads `ANTHROPIC_CUSTOM_HEADERS` (`client.js:178`), and `@google/genai` still reads other `GOOGLE_*` env vars (project/location). Clear these in the deploy env, or handle them in STK-073.
- Carry-overs from attempt 1 still apply: STK-073 must cover both SDKs in the bundle check and pass a consistent `timeoutMs`; record the real fixtures from live calls before go-live.

## Attempt 3 — 2026-11-10
Verdict: PASS

### Checks (run by reviewer)
- typecheck: all workspaces pass (no errors).
- lint: all workspaces pass (no errors).
- test: core 776; sources 35 (1 file skipped); ai 168 (9 files); db 169 + 1 todo; worker 292 (1 file skipped); web 302. All green. The impl-log only says "ai suite green" without a count; my run is consistent with it (165 → 168, +3 new tests).

### Acceptance criteria
- [x] Ticket note (security-review attempt 2 🟡A): when `totalTokenCount` is valid, Gemini output = max(candidates + thoughts, total − prompt − toolUse). Evidence: `packages/ai/src/adapters/google.ts:36-39`. Tests: `google.test.ts` "no output parts with a higher total -> derived value" (MAX_TOKENS, empty parts → 60) and "total higher than candidates + thoughts wins" (5+5 vs 30 → 30).
- [x] 🟢B: a `null` candidate count is treated as missing. Evidence: `google.ts:33` (`== null`). Test: "null candidates behaves like missing", both with a total (→ 50) and without one (→ `malformed`, usage null).
- [x] Fail-safe still holds: output present, candidate count missing, derived value negative/invalid/absent → `ProviderError('malformed', null)`. Evidence: `google.ts:38`, `google.ts:75`. Tests: the existing "no total", "total below prompt" and "invalid total" table cases still pass.
- [x] Ticket AC1 and the typecheck/lint/test part of AC4 are still met. The Anthropic adapter, the shared helpers, the SDK pins and the stop/finish mapping are unchanged in `acae129`.

### Scope
- Code changes in `acae129` are limited to `packages/ai/src/adapters/google.ts` (`usageOf`) and `google.test.ts`. The other files are bookkeeping (`work/backlog.md`, ticket.md, impl-log.md). No out-of-plan files.
- Only one existing test changed: it was renamed to "no output parts keeps 0 without a total". The assertion is the same.

### Issues
None.

### Rules R1–R10
No violations found.
- R2: token counts are checked as safe non-negative integers before use, and `toUsage` checks them again.
- R8: every new branch has a test.

### Nits (do not block)
- `google.ts:37`: if candidates are present and `total < prompt + toolUse`, the code silently uses candidates + thoughts instead of rejecting the response (security re-review 🟢C). This matches the ticket note, since max(base, negative) = base, and it never settles below the reported counts. The comment at `:31-32` could state this explicitly.

### Follow-ups (out of scope)
- Security 🟢D: MAX_TOKENS with empty parts and no candidates/thoughts/total settles at 0 output tokens. Optional hardening: pass the finish reason into `usageOf` and fail closed.
- Consider rejecting any response where a valid `totalTokenCount` is below prompt + toolUse (🟢C), if real traffic shows this never happens.
- Earlier carry-overs still apply: record real fixtures before go-live; STK-073 handles bundle checks and the deploy env (`ANTHROPIC_CUSTOM_HEADERS`, `GOOGLE_*`).
