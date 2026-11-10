Status: READY

# Plan — STK-063: AI provider layer (Claude + Google AI) with budget cap and usage log

**Scope: slice 1 of 3. This slice covers the budget and usage foundation: the pure AI cost, budget and provider-selection logic in `packages/core`, the `ai_usage` table, the atomic reservation functions and the usage repo.** The provider interface, SDK adapters, prompt-injection defence, zod validation, secrets and UI are in slices 2 and 3 (see `## Split proposal`). The whole ticket is roughly 2,000+ changed lines across 5 packages plus deploy files. That is far over one implement/review cycle.

## Spec summary
- docs/spec-v1.md §6.1: "**Rules (code)** produce signals from data. Deterministic, testable. … **LLM** writes the summary and explanation from the stored inputs only."
- docs/spec-v1.md §6.2: "Output is structured JSON validated against a schema before display." (slice 2)
- docs/spec-v1.md §7: "Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo." (slice 2)
- docs/spec-v1.md §9 open question 6: "LLM provider (e.g. reuse the provider already used in Ricotdin, or another)." Ming answered this in the ticket (2026-11-08): "Providers are Claude API and Google AI API. Budget is 5 USD per month."
- The spec does not define a budget or an AI usage table (§5 has no AI table). The ticket is the only source for both (consult-database-optimizer, Findings).
- CLAUDE.md R5: "Market rules are configuration, never hard-coded". The ticket applies this to "Model per task (chat, summary, explanation) is configuration, not code (R5)".
- CLAUDE.md R2: "Money and prices are integers in VND … No floats for money. Rounding rules are defined once in `packages/core`." The ticket's AC2 asks for "cost in integer micro-USD". This slice follows that: integers only, and the rounding helper lives in `packages/core/src/money.ts`.

Ticket ACs this slice implements, quoted:
- AC2: "Every call writes an `ai_usage` row: provider, model, task, input/output tokens, cost in integer micro-USD computed from a configured price table, and created_at. Migration with RLS on, service_role only, and a rollback file." This slice delivers the table, the price table, the cost function and the write functions. Slice 2 makes every call use them.
- AC3, logic part: "a hard cap of 5 USD per calendar month in Asia/Ho_Chi_Minh, across both providers, set in config. At 80% the app shows a warning. At 100% every AI call is refused … The cap check runs before the call, using a worst-case estimate." This slice delivers the config, the month window, the levels, the worst-case estimate and the atomic DB gate. The refusal path is slice 2. The warning UI is slice 3.
- AC1, config part: "Model per task (chat, summary, explanation) is configuration, not code (R5)."
- AC7, part: "unit tests for cost calculation, the budget gate (79%, 80%, 100%, month rollover) and provider selection … CI makes no network calls."

## Acceptance criteria → verification
| # | Criterion (this slice) | How the reviewer verifies it |
|---|---|---|
| 1 | AI config is one static object in core (R5): models per task per provider, default provider per task, price table (integer micro-USD per 1M tokens), budget `{capMicroUsd: 5_000_000, warnPpm: 800_000, timeZone: 'Asia/Ho_Chi_Minh'}`, max output tokens and thinking budget per task. Every configured model has a price row (fail closed). | `packages/core/src/ai/config.test.ts` › "AI_CONFIG is valid", "every model in modelsByTask has a price row", "validateAiConfig rejects an unpriced model / cap <= 0 / warnPpm outside 1..999999 / non-integer price / another time zone". `grep -rn "claude-\|gemini-" packages/ apps/ --include=*.ts` shows model IDs only in `packages/core/src/ai/config.ts` and its tests. |
| 2 | Cost = ceil((inputTokens × inPrice + outputTokens × outPrice) / 1,000,000) micro-USD, exact BigInt, rounded once. Thinking tokens count as output. | `cost.test.ts` › "1M input tokens of claude-sonnet-4-5 = 3_000_000", "1 token rounds up to 1 micro-USD, not 0", "ceil applied once on the sum, not per part", "thinking tokens priced as output", "unpriced model throws AiConfigError", "negative / non-integer tokens throw", "very large counts stay exact". `money.test.ts` › `ceilDiv` cases. |
| 3 | Worst-case estimate before the call: input tokens ≤ UTF-8 bytes of all input text + per-message overhead; output = maxOutputTokens + thinkingBudget for the task; priced with the cost function. | `cost.test.ts` › "worst case uses UTF-8 bytes (Vietnamese 'Đ' counts 2 bytes)", "adds per-message overhead", "adds max output + thinking at output price", "worst case >= the cost of any usage within the bounds". |
| 4 | Month window is the calendar month in Asia/Ho_Chi_Minh, as `[from, to)` UTC instants. | `budget.test.ts` › "2026-11-30T16:59:59.999Z is in November", "2026-11-30T17:00:00Z is December (rollover)", "2026-12-31T17:00:00Z rolls the year to 2027-01", "window is [2026-11-01T00:00+07, 2026-12-01T00:00+07)". |
| 5 | Budget levels: `ok` < 80%, `warn` ≥ 80% and < 100%, `exhausted` ≥ 100%. Gate: refuse when spent ≥ cap or spent + worst case > cap. | `budget.test.ts` › "79% (3_950_000) is ok", "3_999_999 is ok", "80% (4_000_000) is warn", "4_999_999 is warn", "100% (5_000_000) is exhausted", "over cap is exhausted", "fits: spent + reserve == cap is allowed", "refused when spent + reserve > cap", "refused at 100% even with reserve 0", "a new month starts at 0 spent (rollover)". |
| 6 | Provider selection: an explicit provider is used if enabled, else `provider_unavailable` (no silent switch). With no explicit provider, use the task default, or fall back to the other enabled provider. Neither enabled → `provider_unavailable`. Returns the configured model for the task. | `select-provider.test.ts` › "default for summary is google", "default disabled → falls back to anthropic", "explicit anthropic disabled → provider_unavailable", "none enabled → provider_unavailable", "model comes from config for the task". |
| 7 | Vietnamese messages for refusal and warning (used by slices 2 and 3). | `messages-vi.test.ts` › "budget_exhausted names the cap in USD and says it resets on the 1st", "warn shows percent and spent/cap", "every AiMessageCode has a non-empty message", "formatUsdMicro(4_000_000) = '4,00 USD'". |
| 8 | `ai_usage` migration: columns from AC2 plus status/reservation columns, integer and bigint only, RLS on, service_role only, index on `created_at`, and a rollback file. | `pnpm db:check` green. New `checks.sql` blocks: `tables_exist` includes `ai_usage`; `ai_usage_columns` (types and not-null); `service_role_can_read_write_ai_usage`; `ai_usage_negatives` (bad provider, empty model, bad task, bad status, negative tokens or cost, `ok` with null cost, `reserved` with cost, `refused` with cost > 0). The existing anon/authenticated loops cover the new table automatically. The rollback leaves 0 tables. |
| 9 | Atomic budget gate across processes: `public.ai_reserve(...)` takes an advisory xact lock, sums `coalesce(cost_micro_usd, reserved_micro_usd)` in the window, and inserts a `reserved` row (granted) or a `refused` row with cost 0. `public.ai_month_spend(from, to)` returns the sum read-only. Both are `security invoker`, `set search_path = ''`, and executable only by service_role. | `checks.sql` › `ai_reserve_gate`: under cap → granted; two sequential reserves that together exceed the cap → the second is refused and a `refused` row is written; at cap → refused; reserve 0 at cap → refused; a row from last month is not counted; `ai_month_spend` matches. `ai_functions_locked`: `has_function_privilege('anon'/'authenticated', …, 'execute')` is false and true for service_role; `prosecdef` is false; `proconfig` contains `search_path=""`. The rollback drops both functions. |
| 10 | Usage repo in `@stoktok/db`: `reserveAiUsage`, `settleAiUsage`, `getAiMonthSpend`, with errors mapped to `DataError` and no payload in messages. | `packages/db/src/repos/ai-usage.test.ts` (fake client with `rpc`) › "reserve calls rpc ai_reserve with the window and cap", "granted / refused mapping", "settle updates by id and status = reserved only", "settle with cost null keeps the reservation counted (status provider_error)", "month spend maps int8 to a safe integer", "errors → DataError without the payload". |
| 11 | ADR records the reservation decision, the stale-reservation policy and the over-estimate trade-off. | `docs/adr/0008-ai-budget-reservation.md` exists and covers: why a SQL function (cross-process), the hardening, that orphaned `reserved` rows stay counted, the worst-case formula, and that prices must be re-verified before go-live. |
| 12 | Checks green, no network in CI. | `pnpm typecheck && pnpm lint && pnpm test` and `pnpm db:check` pass. No new npm dependency in this slice (`git diff --stat pnpm-lock.yaml` is empty). |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/ai/config.ts` | create | `AI_CONFIG`, the types `AiProvider`, `AiTask`, `AiConfig`, `PriceRow`, and `validateAiConfig` (AC1, AC3, R5) |
| `packages/core/src/ai/cost.ts` | create | `usageCostMicroUsd`, `worstCaseCostMicroUsd`, `utf8ByteLength`, `AiConfigError` (AC2, AC3) |
| `packages/core/src/ai/budget.ts` | create | `aiBudgetWindow(now)`, `budgetLevel`, `budgetStatus`, `fitsBudget` (AC3) |
| `packages/core/src/ai/select-provider.ts` | create | `selectProvider` (AC6, AC7) |
| `packages/core/src/ai/messages-vi.ts` | create | `aiMessage(code, params)` and `formatUsdMicro`, Vietnamese text (AC3) |
| `packages/core/src/ai/index.ts` | create | barrel, same as `news/index.ts` |
| `packages/core/src/ai/config.test.ts`, `cost.test.ts`, `budget.test.ts`, `select-provider.test.ts`, `messages-vi.test.ts` | create | R8 unit tests (AC7) |
| `packages/core/src/money.ts` | modify | add `ceilDiv(numer: bigint, denom: bigint)`, so rounding is defined once in core (R2) |
| `packages/core/src/money.test.ts` | modify | `ceilDiv` tests |
| `packages/core/src/index.ts` | modify | `export * from './ai';` |
| `supabase/migrations/20261109000100_ai_usage.sql` | create | table, index, comments, RLS and grants, `ai_reserve` and `ai_month_spend` with revoke/grant execute (AC2, AC3) |
| `supabase/rollback/20261109000100_ai_usage.down.sql` | create | drop both functions, then the table (AC2) |
| `scripts/db-check/checks.sql` | modify | table list plus the new column, read/write, negative, gate and privilege checks; otherwise `db:check` fails on the table list |
| `packages/db/src/repos/ai-usage.ts` | create | reserve, settle and month-spend functions over the service client |
| `packages/db/src/repos/ai-usage.test.ts` | create | repo tests with the fake client |
| `packages/db/test/fake-client.ts` | modify | add `rpc(fn, args)` to the fake (no repo uses `rpc` yet) |
| `packages/db/src/rows.ts` | modify | `AiUsageSettle` row type and the `ai_reserve` result row type |
| `packages/db/src/index.ts` | modify | export the repo functions and types |
| `docs/adr/0008-ai-budget-reservation.md` | create | the first SQL function in the repo, recorded as the architect recommended |

The implementer must not touch other files. In particular: no `packages/ai`, no SDKs, no zod, no `.env.example`, deploy or r3-guard changes, and no web UI. Those are slices 2 and 3.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `money.test.ts` › "ceilDiv: exact, rounds up positive remainders, 0 stays 0, denom <= 0 throws" | R2 rounding helper |
| `config.test.ts` › "AI_CONFIG is valid" | AC1 |
| `config.test.ts` › "every model in modelsByTask has a price row" | fail closed |
| `config.test.ts` › "validateAiConfig rejects: unpriced model, cap <= 0, non-integer cap, warnPpm 0 or 1_000_000, non-integer or negative price, timeZone not Asia/Ho_Chi_Minh, maxOutputTokens <= 0" | config shape |
| `cost.test.ts` › "1M input tokens of claude-sonnet-4-5 = 3_000_000 micro-USD" | price × tokens |
| `cost.test.ts` › "1 output token of gemini-2.5-flash = ceil(2.5) = 3 micro-USD" | rounding up |
| `cost.test.ts` › "ceil applied once on the summed numerator" | single rounding |
| `cost.test.ts` › "thinking tokens are priced as output" | hidden output tokens (architect, Risks) |
| `cost.test.ts` › "0 tokens = 0" | edge |
| `cost.test.ts` › "unpriced model throws AiConfigError" | fail closed |
| `cost.test.ts` › "negative, fractional or unsafe token counts throw RangeError" | input guard |
| `cost.test.ts` › "worst case uses UTF-8 bytes: 'Đầu tư' counts 10 bytes" | under-estimate risk for Vietnamese |
| `cost.test.ts` › "worst case adds perMessageOverheadTokens × messageCount" | estimate |
| `cost.test.ts` › "worst case adds (maxOutputTokens + thinkingBudgetTokens) at output price for the task" | estimate |
| `cost.test.ts` › "worst case ≥ usageCostMicroUsd for any usage within the bounds" (table of 5 cases) | the reservation never under-covers |
| `budget.test.ts` › "window for 2026-11-15T05:00Z is [2026-10-31T17:00:00.000Z, 2026-11-30T17:00:00.000Z)" | VN month |
| `budget.test.ts` › "2026-11-30T16:59:59.999Z → November; 2026-11-30T17:00:00.000Z → December" | rollover |
| `budget.test.ts` › "2026-12-31T17:00:00.000Z → [2026-12-31T17:00Z, 2027-01-31T17:00Z)" | year rollover |
| `budget.test.ts` › "79% ok / 3_999_999 ok / 80% warn / 4_999_999 warn / 100% exhausted / 110% exhausted" | AC3 thresholds |
| `budget.test.ts` › "fitsBudget: spent + reserve == cap allowed; > cap refused; spent >= cap refused even with reserve 0" | gate semantics (mirrors SQL) |
| `budget.test.ts` › "budgetStatus returns spent, cap, remaining (never negative), percent, level" | slice 3 display input |
| `select-provider.test.ts` › "summary/explanation default google, chat default anthropic" | config defaults |
| `select-provider.test.ts` › "default disabled, other enabled → other provider with its model for the task" | fallback (AC6 "the other one keeps working") |
| `select-provider.test.ts` › "explicit provider disabled → provider_unavailable" | no silent switch for an explicit choice |
| `select-provider.test.ts` › "no provider enabled → provider_unavailable" | edge |
| `select-provider.test.ts` › "returns the configured model, not a hard-coded one" (custom config) | R5 |
| `messages-vi.test.ts` › "formatUsdMicro: 4_000_000 → '4,00 USD', 1 → '0,01 USD' (rounded up), 0 → '0,00 USD'" | display |
| `messages-vi.test.ts` › "budget_exhausted text contains '5,00 USD' and 'ngày 1 tháng sau'" | AC3 Vietnamese refusal |
| `messages-vi.test.ts` › "budget_warn text contains the percent and spent/cap" | AC3 warning text |
| `messages-vi.test.ts` › "every AiMessageCode has a non-empty message" | completeness |
| `ai-usage.test.ts` › "reserveAiUsage calls rpc('ai_reserve') with provider, model, task, reserve, cap, from, to" | repo wiring |
| `ai-usage.test.ts` › "granted row → {granted: true, usageId, spentMicroUsd}; refused row → {granted: false, …}" | mapping |
| `ai-usage.test.ts` › "settleAiUsage updates by id with eq('status','reserved') and sets settled_at; returns false when no row matched" | no double-settle |
| `ai-usage.test.ts` › "settle with costMicroUsd null keeps the reservation counted" | unknown-outcome policy |
| `ai-usage.test.ts` › "getAiMonthSpend maps an int8 string to a safe integer" | int8 handling |
| `ai-usage.test.ts` › "errors → DataError (VALIDATION / DB_ERROR), message has no model or payload" | error hygiene |
| `checks.sql` › `ai_usage_columns`, `service_role_can_read_write_ai_usage`, `ai_usage_negatives`, `ai_reserve_gate`, `ai_functions_locked` | DB contract (AC8, AC9) |

## Approach
1. **Money helper (R2).** Add `ceilDiv(numer, denom)` for BigInt values to `money.ts`, next to `roundDiv`, with tests. AI cost uses ceil, which is conservative for a hard cap. Every other money path keeps half-up.
2. **Config (R5) in `packages/core/src/ai/config.ts`.** Follow the `news/config.ts` pattern. This is static, reviewed config, not `settings.rule_configs` (that column's comment says "no money values"; consult-software-architect, Finding 3). Defaults, all marked `// verify before go-live (prices as of 2026-11; check provider pricing pages)`:
   - `modelsByTask`: `anthropic: {chat: 'claude-sonnet-4-5', summary: 'claude-haiku-4-5', explanation: 'claude-haiku-4-5'}`, `google: {chat: 'gemini-2.5-flash', summary: 'gemini-2.5-flash', explanation: 'gemini-2.5-flash'}`.
   - `defaultProviderByTask`: `{chat: 'anthropic', summary: 'google', explanation: 'google'}`.
   - `priceTable` (integer micro-USD per 1M tokens): `claude-sonnet-4-5 {in: 3_000_000, out: 15_000_000}`, `claude-haiku-4-5 {in: 1_000_000, out: 5_000_000}`, `gemini-2.5-flash {in: 300_000, out: 2_500_000}`.
   - `maxOutputTokensByTask`: `{chat: 2000, summary: 1500, explanation: 1000}`. `thinkingBudgetTokensByTask`: all `0` (thinking off; slice 3 adapters must pass it to the SDK). `perMessageOverheadTokens: 16`. `maxToolRounds: 4` (used by slice 2).
   - `budget: {capMicroUsd: 5_000_000, warnPpm: 800_000, timeZone: VN_TIME_ZONE}`.
   - `validateAiConfig(cfg)` returns a list of errors. A test asserts it is empty for `AI_CONFIG`. Each pure function takes the config as a parameter (default `AI_CONFIG`), so tests can inject a config.
   - Note: core is also bundled into the client. The price table is not secret, so this is fine (R3 covers keys only).
3. **Cost (`cost.ts`).** `usageCostMicroUsd(cfg, model, {inputTokens, outputTokens})` returns `ceilDiv(in×inPrice + out×outPrice, 1_000_000)` as a safe integer. Throws `AiConfigError` for an unpriced model. `worstCaseCostMicroUsd(cfg, task, model, {inputUtf8Bytes, messageCount})`: input tokens = bytes + overhead × messages; output = maxOutput + thinking. This deliberately replaces the architect's "chars / 2" with UTF-8 bytes. A byte-level tokenizer cannot produce more tokens than bytes, so the bound holds for Vietnamese without a guessed ratio. `utf8ByteLength(...texts)` uses `TextEncoder`. Prompt caching is not used in v1: there are no cache-token fields (Assumption 4).
4. **Budget (`budget.ts`).**
   - `aiBudgetWindow(now)` → `{fromTs, toTs}`: take the VN year and month via `vnDateOf(now)`, then build `${YYYY-MM}-01T00:00:00+07:00` and the same for the next month, as ISO UTC strings. This matches `vnDayBoundsUtc`, which assumes a fixed +07:00 with no DST.
   - `budgetLevel(spent, cfg)`: `exhausted` if spent ≥ cap; `warn` if spent × 1_000_000 ≥ cap × warnPpm (BigInt); else `ok`.
   - `fitsBudget(spent, reserve, cap)` = `spent < cap && spent + reserve <= cap`.
   - `budgetStatus(spent, cfg)` → `{spentMicroUsd, capMicroUsd, remainingMicroUsd, percent, level}`.
   - The clock is injected (`now: Date`). The caller passes one `now` per call (consult-database-optimizer, Risks).
5. **Provider selection (`select-provider.ts`).** `selectProvider({task, requested?, enabled: readonly AiProvider[]}, cfg)` → `{ok: true, provider, model} | {ok: false, reason: 'provider_unavailable'}`. Rules are in AC row 6.
6. **Messages (`messages-vi.ts`).** Codes: `budget_exhausted`, `budget_warn`, `provider_unavailable`, `provider_error`, `invalid_output`. Follow the `entry/messages-vi.ts` pattern. `formatUsdMicro` rounds up to cents and uses a comma decimal (`vi-VN`), for example "4,00 USD".
   - Exhausted text: "Đã dùng hết ngân sách AI tháng này ({cap}). Các tính năng AI sẽ mở lại vào ngày 1 tháng sau."
   - Warn text: "Đã dùng {pct}% ngân sách AI tháng này ({spent} / {cap})."
7. **Migration `20261109000100_ai_usage.sql`.** Copy the news pattern (consult-database-optimizer, Findings).
   - Columns:
     - `id bigint generated always as identity primary key`
     - `created_at timestamptz not null default now()`, `settled_at timestamptz`
     - `provider text not null check (provider in ('anthropic','google'))`
     - `model text not null check (char_length(model) between 1 and 100)`
     - `task text not null check (task ~ '^[a-z][a-z_]{0,49}$')`. Open format, so STK-064 to STK-066 can add tasks through config (R5, DB consult).
     - `status text not null check (status in ('reserved','ok','provider_error','invalid_output','refused'))`
     - `input_tokens integer not null default 0 check (>= 0)`, `output_tokens integer not null default 0 check (>= 0)`
     - `reserved_micro_usd bigint not null check (>= 0)`, `cost_micro_usd bigint check (>= 0)`
     - `error_code text check (error_code ~ '^[a-z0-9_]{1,100}$')`
   - Row checks:
     - `reserved` ⇒ cost null and settled_at null;
     - `ok`/`invalid_output` ⇒ cost not null and settled_at not null;
     - `refused` ⇒ cost = 0;
     - `provider_error` ⇒ settled_at not null (cost may be null = unknown, so the reservation stays counted).
   - Index on `(created_at)`. A table comment says rows never hold prompt or output text. Then RLS on, `revoke all … from public, anon, authenticated`, `grant select, insert, update, delete … to service_role`.
   - `public.ai_reserve(p_provider text, p_model text, p_task text, p_reserve_micro_usd bigint, p_cap_micro_usd bigint, p_from timestamptz, p_to timestamptz) returns table (usage_id bigint, granted boolean, spent_micro_usd bigint)`, `language plpgsql security invoker set search_path = ''`. Steps:
     1. Raise `22023` if reserve < 0, cap <= 0 or from >= to.
     2. `perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('stoktok.ai_budget'))`.
     3. Sum `coalesce(cost_micro_usd, reserved_micro_usd)` from `public.ai_usage` where `created_at >= p_from and created_at < p_to`.
     4. If `spent < cap and spent + reserve <= cap`, insert a `reserved` row and set granted = true. Otherwise insert a `refused` row (reserved = the requested amount for audit, cost 0, settled_at now()) and set granted = false.
     5. Return the row.
   - `public.ai_month_spend(p_from timestamptz, p_to timestamptz) returns bigint`, `language sql stable security invoker set search_path = ''`.
   - For both functions: `revoke execute … from public, anon, authenticated; grant execute … to service_role`.
   - Rollback: `drop function if exists public.ai_reserve(text,text,text,bigint,bigint,timestamptz,timestamptz); drop function if exists public.ai_month_spend(timestamptz,timestamptz); drop table if exists public.ai_usage;`.
   - Security: no `security definer`; the security auditor reviews this at REVIEW (migration plus first RPC; consult-software-architect, Risks).
8. **`checks.sql`.** Add `ai_usage` to the sorted `tables_exist` array. It sorts first: `array['ai_usage','assets',…]`. Add the five blocks from the test table. For `ai_reserve_gate`, run as `set local role service_role` with cap 1000:
   - reserve 600 → granted;
   - reserve 500 → refused, and a `refused` row with cost 0 exists;
   - settle the first row to cost 400, then reserve 600 → granted (400 + 600 = 1000);
   - reserve 0 → refused (at cap);
   - insert a row dated in the previous window, check it is not counted, and check `ai_month_spend` = 1000.
   Clean up and `reset role`. `ai_functions_locked` uses `has_function_privilege` and `pg_proc.prosecdef` / `proconfig`.
9. **Repo `packages/db/src/repos/ai-usage.ts`.**
   - `reserveAiUsage(db, {provider, model, task, reserveMicroUsd, capMicroUsd, window})` calls `db.rpc('ai_reserve', {...})`.
   - `settleAiUsage(db, id, {status: 'ok'|'provider_error'|'invalid_output', inputTokens, outputTokens, costMicroUsd: number|null, errorCode?})` runs `update … eq('id', id).eq('status','reserved').select('id')` and returns whether a row was updated. It sets `settled_at` to `new Date().toISOString()`, or to an injected `now`; prefer injecting `now` to match the clock rule.
   - `getAiMonthSpend(db, window)` calls `db.rpc('ai_month_spend', …)`.
   - Use `unwrap` and `toSafeInt` like the other repos. Extend `fake-client.ts` with `rpc(fn, args)`, which records `{table: fn, method: 'rpc', args: [args]}` and returns the thenable builder.
   - These functions are the persistence half of the architect's `UsageLedger` port. Slice 2 defines the port in `@stoktok/ai` and adapts these functions to it.
10. **ADR 0008.** Record: why a reservation (cross-process web chat plus worker; PostgREST cannot do an atomic check-and-insert), the function hardening, the stale-reservation policy, the worst-case formula, and "prices and model IDs are verify-before-go-live defaults".
11. Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm db:check`.

Rules:
- R1: no UI in this slice.
- R2: integers only (micro-USD); ceil is defined once in `money.ts`.
- R3: no keys or SDKs here.
- R4: not market data.
- R5: models, prices, cap and thresholds are config.
- R7: the file list is strict.
- R8: core tests are listed above.
- R9: rows store no prompts or outputs.
- R10: untouched.

## Specialist input used
- consult-software-architect:
  - Rec 2 (pure logic in `packages/core/src/ai/`): **adopted**.
  - Rec 5 (static `AI_CONFIG`): **adopted, but in `packages/core/src/ai/config.ts` instead of `packages/ai/src/config.ts`**. Core functions need it, `packages/ai` does not exist until slice 2, and `core/news/config.ts` is the same pattern.
  - Rec 6 (reserve/settle via a SQL function with an advisory lock, `security invoker`, `search_path = ''`, execute grants, month start passed in from core): **adopted**. The DB consult's `[from, to)` window is used.
  - Rec 7 (columns, a `refused` row with cost 0, no prompts): **adopted**, with the DB consult's open `task` format.
  - Rec 6 worst-case formula "chars / 2": **replaced** by UTF-8 bytes, a strict bound with no guessed ratio.
  - Recs 1, 3, 4 and 8 (`packages/ai`, `UsageLedger` port, R3 guards, consumer contract): **deferred to slice 2**.
  - Rec 4 (bundle sentinel, `serverExternalPackages`): **deferred to slice 3**.
  - Open questions 1 to 6: answered under Assumptions.
- consult-database-optimizer:
  - Schema pattern, bigint money and integer tokens, btree on `created_at` with no expression index, the `[from, to)` window computed outside SQL, the advisory-lock reservation, a refused row at the cap, the checks.sql table list and the new cases, rollback order (functions before the table): **adopted**.
  - Open-format `task` check: **adopted**.
  - Reaper for stale reservations: **rejected for now**. They stay counted (fail safe, both consults' safest option). A manual sweep is a follow-up.
  - `greatest(cost, reserved)` with reserved reset to 0 on settle: **replaced** by `coalesce(cost, reserved)` with reserved kept for audit (architect's version). Same effect, and the estimate is kept.
  - `price_version` column: **rejected**. The exact model ID is stored, so costs can be recomputed (architect, Risks).
  - Caller-entity FK: **rejected** (no target yet; DB consult agrees).

## Assumptions
Non-blocking. Ming should confirm 1 to 4.
1. **80% warning placement (consult open question 1).** The smallest in-scope place is a read-only "Chi phí AI tháng này" card on the existing **Settings** page (`/settings`): spent / cap, percent, and the Vietnamese warning at ≥ 80% or the exhausted text at 100%. It needs no new route, no shell change, and only `requireUser()`, which already exists. It is built in **slice 3**. STK-066 also shows usage on `/chat` per its own AC. This slice provides `budgetStatus()` and the message text.
2. **Default models and prices (consult open question 4).** The values in Approach step 2 come from public pricing as known to the planner and cannot be checked offline. They are labelled "verify before go-live" in code and in ADR 0008, the same way CLAUDE.md treats the market rules. Changing them is a config-only edit. An unpriced model is refused (fail closed).
3. **Read-only tools vs STK-066 (consult open question 6).** STK-063 implements exactly what its AC says: tools must be `kind: 'read'`, and the client rejects anything else (slice 2). STK-066 needs a suggestion-logging write tool; it already updates spec and rules, so it adds that single exception there and records it. STK-063 does not pre-build a write opt-in (R7, "Quote, don't invent").
4. **Fallback when a key is missing (consult open question 3).** A call without an explicit provider falls back to the other enabled provider, for every task ("A missing key disables that provider and the other one keeps working"). An explicitly requested provider (STK-066's per-conversation choice) is never silently switched; that returns `provider_unavailable`.
5. **Refused calls are logged (consult open question 2)** as `status = 'refused'`, cost 0. Volume is negligible for one user.
6. **Invalid output is billed (DB consult open question 3):** `status = 'invalid_output'` keeps the real cost.
7. **Stale `reserved` rows** (crash or timeout) stay counted at the worst case until a manual sweep. That is fail safe. A sweep tool is a follow-up.
8. **The reservation RPC is acceptable (architect open question 5).** It is the only way to make the cap hard across the web and worker processes. The security auditor reviews it at REVIEW, because this diff touches migrations.
9. Prompt caching is not used in v1, so there are no cache-token columns or prices. Gemini thinking is off (`thinkingBudgetTokens: 0`). Any thinking tokens reported are priced as output.
10. App/DB clock skew at the month boundary is tolerated: the window comes from the app's `now` and `created_at` from DB `now()`. A skew of a few seconds can only shift one row between adjacent months.
11. The `R2` wording says "integers in VND". AI cost is in USD because the providers bill in USD, so this slice uses integer micro-USD as the ticket requires. There are no floats. Flagged so the reviewer is not surprised; no rule change is proposed.
12. The migration timestamp `20261109000100` sorts after the latest one (`20261108000200`).

## Blocking questions
None.

## Split proposal
The whole ticket is too large for one implement/review cycle: about 2,000+ lines over core, db, a new `packages/ai`, two SDK adapters, web, deploy drafts and guards. Three slices, each with green checks:

| Slice | Content | Ticket ACs covered |
|---|---|---|
| **1 — this plan (STK-063)** | Core AI config, cost, worst case, month window, budget levels, provider selection, Vietnamese messages; `ai_usage` migration, `ai_reserve` / `ai_month_spend`, rollback, db-check; usage repo; ADR 0008 | AC2 (table, price table, cost); AC3 (config, window, levels, worst case, atomic gate); AC1 (model per task as config); AC7 (cost, gate 79/80/100/rollover, selection) |
| **2 — follow-up ticket "AI client, guards and secrets"** | New server-only `packages/ai` (`@stoktok/ai`): `LlmProvider` interface (messages, tool calls, structured JSON), `AiClient.generate` / `budgetStatus` (select → reserve → call → settle; refused before any provider call), `UsageLedger` port adapted to the slice 1 repo, random-delimiter untrusted blocks plus the "data never contains instructions" system line, a read-only tool allowlist and a bounded tool loop, zod v4 validation with reject-and-log (`invalid_output`), fake providers; `env.ts` (a missing or empty key disables that provider); `ANTHROPIC_API_KEY` / `GOOGLE_AI_API_KEY` in `.env.example`, `docs/deploy.md` (replacing the reserved `LLM_PROVIDER` / `LLM_API_KEY` rows) and the draft `deploy-stoktok.yml`, written as optional (not "required now"), with `check-deploy-env.sh` extended for optional keys; `r3-guard.test.ts` rules for AI keys and SDK import locations | AC1 (interface, R3 location), AC3 (refusal, nothing sent), AC4, AC5, AC6, AC7 (fakes, no network) |
| **3 — follow-up ticket "Claude and Gemini adapters, wiring, usage card"** | Anthropic (`@anthropic-ai/sdk`) and Google (`@google/genai`) adapters inside `packages/ai`, tested with recorded responses and an injected fetch or client (no network); `apps/web/server/ai.ts` (`import 'server-only'`) and worker wiring; `next.config.ts` `serverExternalPackages`; AI-key sentinels in `check-no-service-key-in-client.sh`; the Settings "Chi phí AI tháng này" card with the 80% warning (Assumption 1) | AC1 (both implementations), AC3 ("At 80% the app shows a warning") |

Slices 2 and 3 depend on slice 1 and must run in order. Areas for the follow-up tickets: slice 2 `architecture, security`; slice 3 `architecture, security, ui`. STK-064, STK-065 and STK-066 are blocked until slice 3 is DONE.

Follow-ups, not part of any slice: a manual sweep for stale `reserved` rows; re-verify model IDs and prices before go-live.
