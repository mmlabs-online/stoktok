# STK-070 security review

## Security review — STK-070, attempt 1

I had no shell, so I could not run `git diff`. I read the files directly: the adapters, `shared.ts`, `providers.ts`, `tools.ts`, `client.ts`, `types.ts`, the fixtures, `package.json`, `pnpm-lock.yaml`, the installed SDK sources and `supabase/migrations/20261109000100_ai_usage.sql`.

**Verdict:** no 🔴 findings. There are two 🟡 findings worth fixing in this ticket (both are small changes inside the adapters) and a few 🟢 notes.

### Findings

**🟡 1. A `final_output` call skips the stop/finish-reason check, so a truncated or refused answer is returned as `stop:'end'`.**
- Locations: `packages/ai/src/adapters/anthropic.ts:61-64` (returns before the `switch (raw.stop_reason)` at :65) and `packages/ai/src/adapters/google.ts:90-93` (returns before `finishReason` at :94).
- Effect: the client never sees `max_tokens`, so its `truncated` check (`client.ts:292`) is skipped. It also never sees `refusal`/`pause_turn` or Gemini `SAFETY`/`MAX_TOKENS`/`MALFORMED_FUNCTION_CALL`. A partial `final_output` input that still passes the Zod schema (optional fields, a cut-off array) is accepted as a complete answer. That weakens R9 / spec §6.2 ("output is schema-validated").
- Usage is still settled correctly, so this does not affect the budget.
- Fix: run the stop-reason mapping first. Return the `final_output` JSON only when the reason is `end_turn`/`stop_sequence`/`tool_use` (Anthropic) or `STOP` (Gemini). Map `max_tokens` → `stop:'max_tokens'` and refusal → `refused, usage`.
- Add one test per adapter: `final_output` + `max_tokens` → `max_tokens`.

**🟡 2. Gemini can settle a call with 0 output tokens when `candidatesTokenCount` is missing but output came back, which releases most of the reservation.**
- Location: `packages/ai/src/adapters/google.ts:28` (`raw.candidatesTokenCount ?? 0`).
- Effect: the reservation is replaced by a too-low `cost_micro_usd`, and the month's spend is undercounted. Treating a missing count as 0 is correct only when there really is no output.
- Fix: if any non-thought part came back and `candidatesTokenCount` is missing, either:
  - use `totalTokenCount - promptTokenCount - toolUsePromptTokenCount` when `totalTokenCount` is a valid integer, or
  - throw `malformed, null`, which keeps the worst case counted.
- Safer still: `output = max(candidates + thoughts, total - prompt - toolUse)`.
- Relates to AC4 ("never returns zeros").

**🟢 3. Both SDKs read their base URL from the environment, so an env var can redirect the API key to another host.**
- `new Anthropic({ apiKey, ... })` at `anthropic.ts:86` reads `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_CUSTOM_HEADERS`. Confirmed in the installed SDK's `client.js:104,133,178`.
- `new GoogleGenAI(...)` at `google.ts:106` reads `GOOGLE_GEMINI_BASE_URL` and `GOOGLE_GENAI_USE_VERTEXAI` (dist `index.mjs:29210,29388`).
- Exploiting this needs control of the env, so the risk is low. It is still cheap to close.
- Fix: pass `baseURL: 'https://api.anthropic.com'`, `authToken: null` (Anthropic) and `httpOptions.baseUrl: 'https://generativelanguage.googleapis.com'`, `vertexai: false` (Google). Fits R3 / spec §7 ("keys only from `readAiEnv`").

**🟢 4. Two `final_output` blocks from Anthropic are not rejected; the last one silently wins.**
- Location: `anthropic.ts:57`. Gemini already rejects this case via `calls > 1` (`google.ts:91`).
- Fix: throw `malformed, usage` if `finalOutput` is already set. One line, plus a test.

**🟢 5. The SDKs are imported statically at module top level (`anthropic.ts:1`, `google.ts:1`).** The plan said "only in the factory branch". No key is affected, because keys come only from `buildProviders(env)` at runtime. But any client import of `@stoktok/ai` would pull both SDKs into the bundle. Anthropic's SDK also throws in the browser unless `dangerouslyAllowBrowser` is set, which helps. Leave this to the STK-073 bundle check; recording it so that check covers it.

### Checks that came back clean
- **API keys are not logged or put in error messages.** `mapThrown` (`shared.ts:40-47`) throws away the SDK error and its message, and `ProviderError` messages are codes only. The adapters log nothing. Gemini sends the key in the `x-goog-api-key` header, not the URL. Anthropic's `ANTHROPIC_LOG` debug output redacts `x-api-key`.
- **Error paths cannot release a reservation.** Missing or invalid usage throws `malformed, null` (`anthropic.ts:47`, `google.ts:65`, `toUsage` at `shared.ts:7-11`). Timeouts and HTTP errors carry `usage: null`. `client.ts:249-260` then settles `costMicroUsd: null`. Spend is `coalesce(cost, reserved)` (migration lines 60 and 85), so the worst case stays counted. Anthropic's `cache_*: null → 0` handling is correct.
- **Text cannot become a tool call.** Only `tool_use` blocks and `functionCall` parts become `tool_call`. Text is never parsed.
- **`final_output` cannot be used to get past the read-only allowlist.** It is never run; it becomes a `json` part that goes through Zod. `assertReadTools` rejects the name (`tools.ts:13`) before any reserve. Every other call goes through `checkToolCall`. Unknown block or part kinds (e.g. `executableCode`, `thinking`) → `malformed`.
- **Output cap and thinking are enforced.** `max_tokens` / `maxOutputTokens` = `outputCap(req)`. Anthropic sends `thinking:{type:'disabled'}`; Gemini sends `thinkingBudget: 0`. `assertNoThinking` runs before the call.
- **SDK retries and timeouts are bounded.** Anthropic: `maxRetries: 0`, `timeout` 60 s. Google: `retryOptions.attempts: 1` (confirmed in the d.ts: "0 or 1 = no retries"). `req.signal` reaches both SDKs. Gemini's `abortSignal` stops the request only on our side, so Google still bills it. That is covered, because a timeout settles with null cost and the reservation stays counted.
- **Untrusted data does not reach the system prompt.** The adapters pass `req.system` through unchanged. Data blocks and tool results stay wrapped in user-role / tool-result content.
- **Fixtures** contain no secrets, keys or URLs. Tests use `'k'` / `'a'` / `'g'`.
- **Dependencies:** `@anthropic-ai/sdk` 1.7.0 and `@google/genai` 3.0.0 are pinned exactly, with integrity hashes in `pnpm-lock.yaml:176,475`. No install scripts (no `requiresBuild` entries). `@modelcontextprotocol/sdk` is an optional peer and is not installed.

### Recommendations
- Fix 🟡1 (AC5/AC6, R9) and 🟡2 (AC4) in this ticket. Each is a few lines in one adapter, plus tests.
- 🟢3 and 🟢4 are one-line hardening changes. Fine in this ticket (adapter scope, R7) or as follow-ups.
- STK-073: the wiring must pass the same `timeoutMs` to `buildProviders` and `AiClient`, or a smaller one to the SDK. The bundle check must cover both SDKs.

### Risks
- A future switch to a model whose thinking cannot be turned off (e.g. Gemini 2.5 Pro) would make `thinkingBudget: 0` fail or be ignored, and thinking tokens would go over the reservation. That shows up only as an `over_reservation` log.
- The fixtures are hand-written, so the real usage shapes (especially Gemini leaving out zero counts) are unverified until they are recorded from live calls.

### Open questions
- None blocking.

## STK-070 security re-review, attempt 2

I had no shell, so I checked the code by reading it against the installed SDKs: `@anthropic-ai/sdk` 1.7.0 and `@google/genai` 3.0.0. I could not run the tests.

**Verdict:** no 🔴 findings. All four fixes from attempt 1 are in place, and I found no regressions. One 🟡 remains: Gemini can still record 0 output tokens in one case. It is a pre-existing issue and a one-line fix. The rest are 🟢.

### Attempt-1 fixes, checked
- **🟡1 Stop reason checked before `final_output`: fixed.**
  - Anthropic (`packages/ai/src/adapters/anthropic.ts:64-86`): the stop reason is mapped first. `max_tokens` and `model_context_window_exceeded` (both valid `StopReason` values in the SDK, `messages.d.ts:4140`) return `{parts:[], stop:'max_tokens'}`, so the client's `truncated` check runs (`client.ts:292`). A refusal returns `refused` with usage. `pause_turn` and unknown reasons return `malformed` with usage.
  - Google (`google.ts:94-102`): refusal reasons are checked first, anything other than `STOP`/`MAX_TOKENS` is `malformed`, and a truncated `final_output` returns empty parts.
  - Tests: `anthropic.test.ts:180-195`, `google.test.ts:163-175`.
- **🟡2 Gemini output-token derivation: fixed for the case raised** (`google.ts:25-35`). When output parts come back without `candidatesTokenCount`, output is now `total − prompt − toolUse`. A missing, negative or non-integer value throws `malformed` with null usage, so the full reservation stays counted (`google.test.ts:177-189`).
- **🟢3 Pinned SDK settings: confirmed in the SDK sources.**
  - Anthropic (`anthropic.ts:95`): an explicit `baseURL` takes precedence over `ANTHROPIC_BASE_URL`, and `_baseURLIsExplicit=true` stops a profile from replacing it (`client.js:104,156,261`). With `apiKey` passed, `env=null`, so `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are not read and the default credential chain is skipped (`client.js:123-138`). `authToken:null` is not counted as a second credential (`!= null`). `logLevel:'off'` is valid and takes precedence over `ANTHROPIC_LOG` (`log.js:11`, `client.js:161-164`).
  - Google (`google.ts:111`): `vertexai:false` takes precedence over `GOOGLE_GENAI_USE_VERTEXAI` and `GOOGLE_GENAI_USE_ENTERPRISE` (`index.mjs:29200-29208`). `httpOptions.baseUrl` takes precedence over `GOOGLE_GEMINI_BASE_URL` (`index.mjs:57-68`). The explicit `apiKey` takes precedence over the env key (`:29342`).
  - `sdk-pins.test.ts:27-35` asserts these settings.
- **🟢4 Duplicate `final_output`: fixed** (`anthropic.ts:59`, test at `anthropic.test.ts:192`). Gemini already rejected it via `calls > 1` (`google.ts:98`).

### Remaining findings
- **🟡 A. Gemini can still record 0 output tokens when Google reports a higher total.** Location: `google.ts:32`, and `google.test.ts:190-193` asserts this behaviour.
  - When there are no visible parts, or when `candidatesTokenCount` is present, `totalTokenCount` is ignored.
  - With `MAX_TOKENS` and empty parts, a response that hit the token cap is recorded as 0 output tokens. That releases the reservation even though tokens were produced (for example hidden thoughts, if a model ignores `thinkingBudget:0`).
  - The undercount is at most `outputCap` per call, but it is exactly the "settles too low" case.
  - Fix: whenever `totalTokenCount` is a valid integer, use `out = max(cand + thoughts, total − prompt − toolUse)`. Change the test to expect the derived value.
  - Ties to AC4.
- **🟢 B. A `null` candidate count is treated as 0** (`google.ts:32-33`). The check uses `=== undefined`, so `candidatesTokenCount: null` with output present gives `null ?? 0 = 0`. Google's JSON normally leaves the field out rather than sending `null`, but `== null` closes this cheaply. Fix A covers it as well.
- **🟢 C. Some environment variables are still read.**
  - `ANTHROPIC_CUSTOM_HEADERS` (`client.js:178-188`) can add request headers. It cannot change the host or read the key.
  - `GOOGLE_GENAI_API_VERSION` (`index.mjs:29397`) can change the API version only.
  - Both need control of the environment, so this is a follow-up note only (R3).
- **🟢 D. Follow-up from attempt 1, still open:** the SDKs are still imported at the top of each adapter file (`anthropic.ts:1`, `google.ts:1`). The STK-073 bundle check must cover both SDKs. STK-073 must also pass the same `timeoutMs` to `buildProviders` and `AiClient`.

### Risks
- The fixtures are still hand-written. How Gemini really reports usage (omitted fields, thoughts with budget 0) is unverified until fixtures are recorded from live calls.
- No tests mock the SDK, so the pinned settings are checked by reading the source, not at runtime. The `sdk-pins` test asserts the constructor arguments, not what the SDK does with them.

### Recommendations
- Fix 🟡A in this ticket (a one-line change in `usageOf` plus updating one test).
- Record 🟢B–D as follow-ups; D belongs to STK-073.

### Open questions
None.
