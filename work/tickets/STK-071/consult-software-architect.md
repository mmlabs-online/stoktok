# STK-071 consult: software-architect (changes since the STK-069 consult only)

Base design: work/tickets/STK-069/consult-software-architect.md (recommendations 1–6, 8, 9).

## Findings
1. **A `22023` reaches the client as a thrown error, not a refusal.** In `packages/db/src/repos/ai-usage.ts`, `reserveAiUsage` calls `unwrap`, and `unwrap` throws `DataError('DB_ERROR', 'ai_usage', 'reserve', …, pgCode '22023')`. That code is not one of the codes it maps (`errors.ts:31-38`). The function raises before its insert (`20261110000100_ai_reserve_harden.sql:22-27`), so the transaction rolls back and **no `ai_usage` row exists**. There is no usage ID and nothing to settle.
2. **`packages/ai` has no dependency on `@stoktok/db`** (earlier Rec 1). So the client can't `instanceof DataError`. It only sees whatever the `UsageLedger.reserve` port throws.
3. **There is only one `error_code` column.** Today `AiUsageSettle` (`packages/db/src/rows.ts:251-257`) has status `ok | provider_error | invalid_output`, a single `errorCode?`, and `inputTokens` / `outputTokens` as non-null numbers. A round can be both `invalid_output` and over its reservation, or `provider_error` with a known usage cost above the reservation. Only one code fits, so the AC needs a precedence rule. The DB check `^[a-z0-9_]{1,100}$` accepts `over_reservation`.
4. **`validateAiConfig` doesn't check `maxToolRounds`** (`packages/core/src/ai/config.ts:52-76`). The client loop depends on it. A value of 0, negative, or NaN would give no rounds or an unbounded loop. The earlier consult missed this.
5. **`providerOverheadTokens` is still missing from `AiConfig`** (earlier Rec 6 / OQ2). Only `perMessageOverheadTokens: 16` exists. Prices > 0 is now on main.
6. **r3-guard excludes itself** (line 19). The new key-name and SDK-import rules can safely contain those literals. The guard walks only `apps/` and `packages/`, so `.env.example` and `docs/` are out of its reach, as intended.
7. `docs/deploy.md:131-132` and `.env.example:16-17` still have `LLM_PROVIDER` / `LLM_API_KEY`. No optional tier exists yet. Everything in earlier Rec 8 still applies.

## Recommendations
1. **22023 fails closed (new AC).** In `AiClient`, wrap `ledger.reserve` in `try/catch`. Any throw:
   - becomes `{ ok:false, reason:'budget_unavailable', messageVi: <the same Vietnamese refusal text>, usageIds: [...earlier rounds] }`;
   - makes no provider call and no retry;
   - logs a warning with `errorCode`. Use `reserve_invalid_args` when duck-typed `(e as {pgCode?:string}).pgCode === '22023'`, otherwise `reserve_failed`. Codes only, no message text.

   Using a separate `reason` from `budget_exhausted` keeps the UI message the same but makes logs and tests tell them apart. Merging them into `budget_exhausted` would also meet the AC.

   Tests for the fake ledger, each also asserting the fake provider's call count is 0:
   - (a) a 22023 on the first round;
   - (b) a 22023 on round 2 after round 1 settled. This is the realistic month-rollover case. Assert that round 1's usage ID is returned.
   - (c) a generic throw.

   Optionally, at STK-070 wiring, map 22023 inside the port adapter so the client never duck-types. This slice doesn't need it.
2. **`over_reservation` precedence (new AC).** After each round, check `cost !== null && cost > reserved`:
   - `ok` → settle `ok` with `errorCode: 'over_reservation'`.
   - `invalid_output` → keep `errorCode: 'over_reservation'`. The status already says the output was invalid.
   - `provider_error` → keep the provider's code (`timeout` / `http` …) and only log the warning, because the failure cause matters more.

   Always emit `log.warn({event:'ai_over_reservation', usageId, reserved, cost})`. Write the precedence in the client and test all three branches; the AC requires at least the `ok` branch. Settle in `finally`. If settle returns `false` or throws, log `settle_failed` and continue fail-safe; the reservation stays counted.
3. **Core touch (small, R5, R8).** Add `isPosInt(cfg.maxToolRounds)` to `validateAiConfig`, with a test. Add `providerOverheadTokens: Record<AiProvider, number>` (default 1000, verify before go-live) now. A test can then force `over_reservation` deterministically by making the fake provider report more usage than the estimate. Deferring it to STK-070 leaves the estimate knowingly low.
4. **The port types live in `packages/ai`.** `UsageLedger.settle` takes `{status, inputTokens, outputTokens, costMicroUsd: number|null, errorCode?}` with the same shape as `AiUsageSettle`, so STK-070's wiring checks structurally. Don't widen `AiUsageSettle` in `packages/db` in this slice (R7).

## Split: yes, split once more
The new ACs add about 150–250 lines of client logic and tests to a slice I already sized at about 1,100–1,300 lines. The deploy/env part is a different review surface: shell and YAML, and it triggers the security auditor on its own.
- **STK-071 (keep the ID): "packages/ai client, untrusted blocks, tools, guards."**
  - AC1–4 and AC6, plus both new ACs.
  - `env.ts` (reads both keys; trimmed-empty counts as missing) and the r3-guard rules belong here, since the key-name rule needs `env.ts`.
  - The core `AiConfig` touch from Rec 3.
  - No `.env.example`, doc, or workflow changes.
- **STK-072 (new): "optional AI secrets in deploy tooling."**
  - AC5 only: `.env.example`, the `docs/deploy.md` optional status and rows (`web, worker`), and the workflow mapping with the charset check that allows empty values.
  - `check-deploy-env.sh` with the optional tier. Delete `LLM_*` from both files together.
  - Small, independent, can go before or after STK-071.

If Ming wants one ticket: order the plan as client → guards → deploy, and expect pressure in review.

## Risks
- **Clock skew at the rollover.** If the app's clock runs ahead of the DB's, every call is refused for the length of the skew. That is the intended fail-closed behaviour, but a large skew blocks AI for the whole skew window. The warning log makes this visible. Don't add an automatic retry or a fallback window.
- **Duck-typing `pgCode`** couples the client to the port's error shape. Treating *any* reserve throw as a refusal keeps it safe even if that shape changes.
- **The refusal row from `ai_reserve`** records the requested reservation in `reserved_micro_usd` with cost 0, while a 22023 writes no row. So 22023 refusals appear only in logs, not in `ai_usage`. That's acceptable; document it in the client's docstring.

## Open questions
1. Approve the 071/072 split?
2. New `reason: 'budget_unavailable'`, or fold it into `budget_exhausted`?
3. The over_reservation precedence for `provider_error` (keep the provider code and only warn): OK?
4. `providerOverheadTokens` now (recommended) or STK-070? This is still open from STK-069.

Relevant files:
- /home/user/stoktok/packages/db/src/repos/ai-usage.ts
- /home/user/stoktok/packages/db/src/errors.ts
- /home/user/stoktok/packages/db/src/rows.ts
- /home/user/stoktok/packages/core/src/ai/config.ts
- /home/user/stoktok/supabase/migrations/20261110000100_ai_reserve_harden.sql
- /home/user/stoktok/packages/db/src/r3-guard.test.ts
- /home/user/stoktok/docs/deploy.md
- /home/user/stoktok/.env.example
