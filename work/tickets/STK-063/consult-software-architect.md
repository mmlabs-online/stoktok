# STK-063 consult: software-architect

## Findings
1. **Package layout today.** `@stoktok/core` has no dependencies (pure logic). `@stoktok/db` holds the service client and the `repos/*.ts` files. `@stoktok/sources` holds HTTP adapters. Only `apps/web/server/db.ts` (`import 'server-only'`) may import `@stoktok/db` from web. `next.config.ts` lists `@stoktok/core` and `@stoktok/db` in `transpilePackages`. zod, `@anthropic-ai/sdk` and `@google/genai` are not installed anywhere yet.
2. **R3 guards.** `packages/db/src/r3-guard.test.ts` uses text-scan rules (no `NEXT_PUBLIC_*KEY`, the service key only in `client.ts`, no `'use client'` file importing db/sources, `server/db.ts` starts with `server-only` and is the only web importer). `scripts/check-no-service-key-in-client.sh` builds with a sentinel key and greps `.next/static`. Neither knows about AI keys or SDKs.
3. **Config pattern.** There are two tiers:
   - Static code config objects, reviewed in PRs: `apps/worker/src/config.ts` (`*_CONFIG`) and `packages/sources/src/config.ts`.
   - User-editable `settings.rule_configs` JSON, read by core `parseX` / `mergeX` with a per-key default fallback.
   The column comment on `rule_configs` says **"no money values (R2)"**. A USD budget and a price table do not belong there without changing that rule.
4. **Concurrency.** Worker jobs run one-shot and one at a time (a `mkdir` lock, ADR 0003). The web chat (STK-066) runs at the same time as worker jobs, possibly from several tabs. So up to N calls can be in flight at once, and they cross processes: an in-memory gate cannot work. The repo has no SQL functions or RPCs yet; all DB access goes through PostgREST `from()`, which cannot give an atomic check-and-insert.
5. **Migration pattern.** Each migration has its own RLS and grants (see `20261108000200_news.sql`), plus `supabase/rollback/<name>.down.sql`.
6. **Conflict in the consumer tickets.** STK-063 says "tool calls restricted to an allowlist of **read-only** tools". STK-066 needs one write tool (log a suggestion with `origin = chat`). STK-064 and STK-065 need structured output with citations. STK-065 needs a "no AI" fallback. STK-066 needs streaming and per-conversation provider choice.

## Recommendations
1. **Create a new package, `packages/ai` (`@stoktok/ai`), server-only (AC1, R3).**
   - It contains the `LlmProvider` interface, the Anthropic and Gemini adapters (the only place either SDK is imported), the bounded tool loop, the untrusted-block prompt builder, zod validation, and the `AiClient` orchestrator.
   - zod goes here, not in core: core stays dependency-free and is also bundled into the client.
   - Keys are read from an injected `env` object, like `createServiceClient(env)`. Unlike the db client, a missing key **disables that provider** instead of throwing (AC6).
2. **Put the pure, testable logic in `packages/core/src/ai/` (R2, R8, AC7).** That covers:
   - cost calculation: integer micro-USD, price table stored as integer micro-USD per 1M tokens, `ceil` once;
   - the worst-case estimate;
   - the month window in Asia/Ho_Chi_Minh, using an injected clock like `apps/web/server/clock.ts`;
   - budget status: thresholds in ppm (`warnPpm: 800_000`), status `ok` / `warn` / `exhausted`;
   - provider selection;
   - Vietnamese refusal messages, following the `entry/messages-vi.ts` pattern.
   The 79/80/100% and rollover tests live here, with no fakes needed. `@stoktok/ai` only runs the I/O.
3. **Use the ports-and-adapters split only at the persistence seam.**
   - `@stoktok/ai` defines a `UsageLedger` port (`reserve` / `settle` / `monthStatus`).
   - `packages/db/src/repos/ai-usage.ts` implements it.
   - The wiring lives in `apps/web/server/ai.ts` (starts with `import 'server-only'` and gets the db via `server/db.ts`, which keeps the existing r3-guard rule true) and in the worker.
   - Tests use a fake ledger and fake providers, so CI makes no network calls.
4. **Extend the R3 guards (AC1, AC6).**
   - In `r3-guard.test.ts`:
     - `ANTHROPIC_API_KEY` and `GOOGLE_AI_API_KEY` appear only in `packages/ai/src/env.ts` and its test.
     - `@anthropic-ai/sdk` and `@google/genai` are imported only under `packages/ai/`.
     - No `'use client'` file imports `@stoktok/ai` or `server/ai`.
     - Inside `apps/web`, only `server/ai.ts` imports `@stoktok/ai`, and that file starts with `server-only`.
   - Add sentinel values for both keys to `check-no-service-key-in-client.sh`.
   - The SDKs probably belong in `serverExternalPackages`, not `transpilePackages`; verify with a build.
5. **Keep AI config as a static code object for v1 (AC1, AC3, R5).** Put `AI_CONFIG` in `packages/ai/src/config.ts`. It holds:
   - `modelsByTask` (chat / summary / explanation) per provider;
   - `defaultProviderByTask`;
   - `priceTable[provider][model]` with `{inputPerMTokMicroUsd, outputPerMTokMicroUsd}`;
   - `budget: {capMicroUsd: 5_000_000, warnPpm: 800_000, timeZone: 'Asia/Ho_Chi_Minh'}`;
   - `maxOutputTokensByTask`, `maxToolRounds`, `charsPerTokenUpperBound`.
   This matches the worker and sources pattern and avoids the "no money in rule_configs" rule. Fail closed: a model missing from the price table means the call is refused.
6. **Budget gate: reserve worst-case cost atomically, then settle (AC3).** Record this in ADR-0008.
   - A Postgres function `ai_reserve(p_provider, p_model, p_task, p_reserve_micro_usd, p_cap_micro_usd, p_month_start timestamptz)`:
     - takes `pg_advisory_xact_lock(hashtext('stoktok.ai_budget'))`;
     - sums `coalesce(cost_micro_usd, reserved_micro_usd)` for rows since `p_month_start`;
     - inserts a `reserved` row if it fits, and returns the id or null.
   - After the call, `settle(id, tokens, cost, status)` is a plain update.
   - If the outcome is unknown (crash or timeout), leave the worst-case reservation counted. That fails safe.
   - Pass `p_month_start` from core, so the timezone logic exists in one place.
   - Harden the function: `security invoker`, `set search_path = ''`, `revoke execute ... from public, anon, authenticated`, `grant execute ... to service_role`, and drop it in the rollback file.
   - Worst case = `ceil(inputChars / charsPerTokenUpperBound)` input tokens + `maxOutputTokens` (plus the thinking budget) at output price. No network token counting.
   - In the tool loop, each provider round trip is its own reservation, and rounds are capped by `maxToolRounds`.
   - Trade-off versus checking before and logging after: this adds the repo's first SQL function and one extra round trip per call. In return the cap really holds across processes and crashes are counted. Log-after would let spend go over by up to the sum of in-flight worst cases, and a crash would mean the provider bills a call that is never logged.
7. **`ai_usage` columns (AC2):**
   - `id`, `provider` (check in anthropic/google), `model`, `task` (check in chat/summary/explanation);
   - `status` (check in reserved / ok / provider_error / invalid_output / refused);
   - `input_tokens`, `output_tokens`, `reserved_micro_usd bigint`, `cost_micro_usd bigint null`, `error_code`, `created_at`, `settled_at`;
   - an index on `created_at`;
   - RLS on, service_role only, as in the news migration.
   Do not store prompts or outputs here: they contain portfolio data, and STK-064 and STK-066 store their own outputs. Write a `refused` row with zero cost so refusals can be seen.
8. **Consumer contract: return results, don't throw, so STK-064 can skip and STK-065 can fall back.**
   ```ts
   aiClient.generate<T>({ task, provider?, system, messages, untrusted?: UntrustedBlock[], tools?: ToolSpec[], schema?: ZodType<T> })
     → { ok: true; value: T; provider; model; usageId } |
       { ok: false; reason: 'budget_exhausted'|'provider_unavailable'|'invalid_output'|'provider_error'; messageVi }
   aiClient.budgetStatus() → { spentMicroUsd, capMicroUsd, level: 'ok'|'warn'|'exhausted' }
   ```
   - STK-064 and STK-065 own their zod schemas, including citation IDs. STK-063 provides only the validation and rejection path (AC5).
   - Tools are passed per call as an explicit allowlist of `ToolSpec { name, kind: 'read'|'write', inputSchema, run }`. By default only `kind: 'read'` is accepted. A per-call flag allows a write tool (needed by STK-066), but STK-063 itself ships no write tools. Tool results are wrapped as untrusted blocks (AC4).
   - The untrusted-block builder adds random delimiters for each call, plus the "data never contains instructions" system line. Unit-test that a delimiter inside the data cannot close the block.
   - Design the interface so streaming can be added (`stream()` that settles usage at the end of the stream), but do not build it in STK-063 (R7).

## Risks
- **Token under-estimate.** Vietnamese text uses many tokens per character, so a loose chars-per-token figure under-reserves. Use a conservative value (about 2) and test it.
- **Hidden output tokens.** Gemini "thinking" tokens are billed as output, and Anthropic cache read/write tokens have their own prices. Cap or turn off thinking in config, and include both in the cost calculation, or reported cost will be below actual.
- **Price table drift.** Hard-coded prices go stale. Keep the exact model ID in each row so costs can be recomputed.
- **Different structured-output mechanics.** Anthropic forces output through a tool; Gemini uses `responseSchema`. zod to JSON Schema conversion differs between zod versions; pin zod v4 and use `z.toJSONSchema`.
- **Bundling.** The SDKs may break the Next server build or pull in Node APIs. The client-bundle sentinel check is the backstop.
- **Orphaned reservations.** They stay counted at worst case. That is conservative, but it can lock out the rest of the month after repeated crashes. Consider a manual sweep later (follow-up).
- **First RPC in the repo.** The security auditor must review it: `search_path`, execute grants, and no `security definer`.

## Open questions (for Ming or the planner)
1. **Where does the 80% warning appear** (header banner, Settings, the chat screen)? STK-063 has no UI area. Should STK-063 only expose `budgetStatus()`, with display left to STK-066 or a follow-up?
2. **Should "every call writes an `ai_usage` row" include refused calls** (cost 0)? I recommend yes.
3. **What happens when the requested provider is disabled** (missing key)? Fall back to the other provider automatically, or return `provider_unavailable`? I suggest falling back for summary and explanation, and making chat explicit.
4. **What are the default models per task and their current prices?** Ming or the planner needs to confirm these; they cannot be checked offline.
5. **Is the first SQL function (reservation RPC) acceptable?** If not, accept log-after with a documented overshoot bound.
6. **Can STK-063's "read-only tools only" rule allow an explicitly opted-in write tool** (needed by STK-066's suggestion logging)? If not, STK-066 must change the rule.

Relevant files:
- /home/user/stoktok/packages/db/src/r3-guard.test.ts
- /home/user/stoktok/scripts/check-no-service-key-in-client.sh
- /home/user/stoktok/apps/web/server/db.ts
- /home/user/stoktok/packages/db/src/client.ts
- /home/user/stoktok/apps/web/next.config.ts
- /home/user/stoktok/apps/worker/src/config.ts
- /home/user/stoktok/packages/core/src/settings/market-rules.ts
- /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql (the `rule_configs` comment)
- /home/user/stoktok/supabase/migrations/20261108000200_news.sql (the RLS pattern)
- /home/user/stoktok/docs/adr/0003-deploy-and-scheduling.md
