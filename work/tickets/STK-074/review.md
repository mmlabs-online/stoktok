## Attempt 1 — 2026-11-10
Verdict: PASS

Scope reviewed: slice (a) only (plan.md). The Settings card and its actions (AC1, AC3, and the "no action returns the key" part of AC7) are STK-076.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0 (all 6 projects Done).
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0. core 785, sources 35, ai 184, db 187 (+1 todo), worker 295, web 317, all passed. These counts match impl-log.md.
- db:check: `pnpm db:check` ran on local PG16 binaries with the Vault stub. It applied all migrations including `20261110000200_ai_keys.sql`, ran the checks, rolled back to 0 public tables, re-applied, and ran the checks again. Output: `db:check OK`.
- check:service-key: `OK: no secret or AI SDK material in client bundle`.

### Acceptance criteria
- [ ] AC1 Settings "Khoá AI" card: deferred to STK-076 per the plan split. Not in scope for this slice.
- [x] AC2 Vault storage, service_role only, no anon/authenticated access to secrets or helpers, migration + rollback + db:check cases.
  - Migration `supabase/migrations/20261110000200_ai_keys.sql`:
    - Vault guard with no `create extension`.
    - `ai_keys` holds no secret, has RLS on, and grants `select` only to service_role.
    - 3 `security definer` functions with `search_path=''` and fully qualified names. The error is a fixed 22023 that never interpolates the key. Advisory lock and orphan clean-up are present.
    - `revoke … from public, anon, authenticated`, then `grant execute` to service_role.
  - Rollback drops the functions, deletes Vault rows (guarded) and drops the table. It never drops the extension or schema, as planned.
  - db:check blocks `ai_keys_columns`, `ai_keys_privileges`, `ai_key_roundtrip`, `ai_key_negatives` (including the sqlerrm no-echo check), `ai_key_functions_locked` (proacl has no PUBLIC; prosecdef; proconfig), `security_definer_allowlist` and `ai_key_vault_direct_denied` (stub only) are all green.
  - Real encryption and privileges depend on the manual smoke test in ADR 0009 (Ming).
- [ ] AC3 Server actions: STK-076. This slice provides `validateAiKeyFormat` (packages/core/src/ai/keys.ts) with unit tests.
- [x] AC4 UI key → env → disabled, with no stale singleton.
  - `packages/ai/src/keys.test.ts` covers precedence, env-only, none, mixed, delete fallback, blank stored value, and fresh reads on every call.
  - `client.test.ts` › resolveProviders covers: called once per generate across tool rounds, picks up a changed key between calls, and `budgetStatus does not call resolveProviders`.
  - `apps/web/server/ai.test.ts`: 2 generates make 2 `readAiKeySecrets` calls, and `getAiBudgetStatus` does not read keys.
  - `apps/worker/src/ai.test.ts`: 2 `ai_key_secrets` rpc calls for 2 generates.
  - Code: `client.ts` generate() resolves once into a local `providers` map before `selectProvider` and before any `ledger.reserve`. `budgetStatus()` is untouched.
- [x] AC5 R3.
  - r3-guard adds two cases: `ai_key_secrets|readAiKeySecrets` may appear only in the 7 allowed files, and no `vault.(secrets|decrypted_secrets|create_secret|update_secret)` reference is allowed in TS/JS under apps/ or packages/.
  - Web wiring imports `readAiKeySecrets` through `./db`, which is `server-only`.
  - `check:service-key` is green.
- [x] AC6 Wording.
  - `docs/spec-v1.md` §7 line 214 and the CLAUDE.md Conventions secrets bullet match the exact text in plan step 10. CLAUDE.md also keeps the existing ".env.example lists keys with no values." sentence, which is reasonable.
  - `docs/adr/0009-ai-provider-keys-in-vault.md` covers context, decision (Vault plus metadata table, definer justification, precedence, no cache, fail closed, format, access path), threat model, consequences (deploy order, rollback deletes keys, unverified stub signatures) and the 9-step smoke test.
  - R1–R10 are unchanged.
- [x] AC7 Checks green. Tests cover:
  - precedence and delete (ai keys.test.ts);
  - format rejection (core keys.test.ts, repo test, SQL `ai_key_negatives`);
  - no secret in repo errors: `DataError` has no `cause`, and message, `String(err)` and JSON contain no sentinel (`packages/db/src/repos/ai-keys.test.ts`);
  - no secret in logs (client, web and worker tests spy on the log/console).

  "No action returns the key" is STK-076.

### Specific review points
- **Fail closed:**
  - `client.ts` uses `catch {}` with no binding and logs only `{event:'ai_key_read_failed', code:'key_read_failed'}`, then returns `provider_unavailable`. There is no env fallback, because `makeProviderResolver` propagates the `readStored` rejection.
  - An empty `{}` result falls back to env.
  - `buildProviders` runs inside the resolver, so an SDK constructor error also fails closed.
- **Vault stub vs the real Supabase Vault API** (checked as far as possible offline):
  - The stub matches the documented Supabase Vault surface:
    - `vault.create_secret(new_secret, new_name default null, new_description default '', new_key_id default null) returns uuid`
    - `vault.update_secret(secret_id, new_secret, new_name, new_description, new_key_id) returns void`
    - `vault.secrets(id, name unique, description, secret, key_id, created_at, updated_at)`
    - view `vault.decrypted_secrets` with a `decrypted_secret` column
  - The migration uses only these.
  - Two things cannot be verified offline. Both are pinned in the ADR and covered by smoke steps 3–5 and 9:
    - whether the definer owner (`postgres`) may `DELETE FROM vault.secrets` on the real project;
    - whether it may read `vault.decrypted_secrets`.
- **Documented deviation (regex repetition limit):** valid. Postgres caps bounded repetition at 255 (RE_DUP_MAX), so `{20,256}` would fail. `char_length(p_key) between 20 and 256` plus `^[\x21-\x7e]+$` is equivalent to the planned rule and matches core (where `/\s/` already fails `[\x21-\x7E]`).
- **Scope:** every changed code file is in the plan's file list. The extra changed files are workflow files only: backlog, ticket, the STK-076 ticket, and the consult/plan/impl-log files.

### Issues
None.

### Rules R1–R10
No violations found. R3: the decrypt path is restricted to server modules and guarded. R6: this slice adds no routes or actions. R7: within the plan. R8: green, and the new core logic has unit tests.

### Nits (do not block)
- `client.ts`: when `resolveProviders` returns a provider registered under the wrong id, generate() throws instead of failing closed. This is acceptable because it is a programming error, and the plan asks for the id check to be kept.
- `makeProviderResolver` builds new SDK clients on every generate(). This is cheap, but worth knowing if call volume grows.

### Follow-ups (out of scope)
- **Smoke test:** Ming runs the ADR 0009 manual Vault smoke test on the real project before an image with this change is deployed. Record step 7 (service_role direct access to `vault.decrypted_secrets`) as an ADR amendment.
- **Deploy order:** apply the migration before the image. Otherwise every AI call returns `provider_unavailable`.
- **db:check rollback coverage:** the cleanup in the checks leaves no Vault rows, so the rollback's Vault-row deletion is never exercised with live data. Consider seeding a key before the rollback step and asserting that `vault.secrets` has no `stoktok_ai_key_%` rows afterwards.
- **STK-076:**
  - call `validateAiKeyFormat` in the actions;
  - use `listAiKeyMeta` only on the page;
  - add the no-echo tests for action results and console output.

## Attempt 2 — 2026-11-10
Verdict: REWORK

### Checks (run by reviewer)
- typecheck: green (all packages, `tsc --noEmit` / next typegen Done).
- lint: green (eslint Done in all packages).
- test: green: core 785, sources 35, ai 184, db 189 (+1 todo), worker 295, web 317. These match impl-log attempt 2.
- db:check: `db:check OK` (all migrations including 20261110000200_ai_keys.sql, checks before and after re-apply).
- check:service-key: `OK: no secret or AI SDK material in client bundle` (0 hits for both SDKs and both API hosts).

### Fixes from Ming's note (security-review attempt 1)
- F1 threat model: done. `docs/adr/0009-ai-provider-keys-in-vault.md:20-26` covers the larger blast radius of a service-role leak and the instruction to rotate at Anthropic and Google. It names the dashboard Vault UI and SQL editor history as decrypt paths and says backups can be decrypted by anyone who restores into the project.
- F2 logging checks: done. Smoke step 2 (ADR:40) and the threat-model bullet (ADR:25) cover log_min_duration_statement, log_parameter_max_length, log_parameter_max_length_on_error and pgaudit.
- F3 smoke steps: **partly done.** Step 5b (positive service_role call, ADR:44) is present. The replace step "3b" was put in the wrong section, see Issue 1.
- F5 fail closed: done. `packages/db/src/repos/ai-keys.ts:69` throws MAPPING on a null or empty secret. Test: `ai-keys.test.ts:113` "a null or empty secret throws MAPPING" passes. Fail-closed handling at the client level was already covered (a DataError leads to `provider_unavailable`). Recorded as ADR decision 9.
- F6 escaped LIKE: done in the rollback (`.down.sql:12`), `checks.sql:681` and smoke step 9.
- F7: done. New r3-guard test `r3-guard.test.ts:118-122` restricts ai_key_set and ai_key_delete to the repo and its test, and it passes. A grep confirms no other TS/JS file names them. The comment in core `keys.ts:1` was reworded so the guard does not flag it. ADR decision 7 now matches what the guard enforces.
- F8: done. Smoke step 5c (ADR:45) checks that the owner of all three functions is `postgres`.
- F10: done. ADR decision 8.

### Acceptance criteria (slice a)
Every criterion that passed in attempt 1 still holds. The attempt 2 code changes are small and additive: one type guard, one guard test, and LIKE escapes. No regression against plan.md. AC6 (an ADR that records Vault, precedence and the threat model) is met for the threat model. The ADR now has a structural defect, which is Issue 1.

### Issues
#### Issue 1 — 🟡 should-fix — F3 replace smoke step is in the wrong section and contradicts step 5
- **Where**: `docs/adr/0009-ai-provider-keys-in-vault.md:14`
- **Expected**: Ming's note asks for a smoke step that tests replace via `ai_key_set`. It should sit in "## Manual Vault smoke test" (ADR:37-49), in an order where every expected value holds.
- **Actual**:
  - "3b. Replace: …" sits inside "## Decision", between decisions 5 and 6. That breaks the decision numbering, and anyone following the smoke test will never run it.
  - It also says "the step 5 query then returns the `1111` value". But if it ran right after step 3, step 5 would return `…1111`, while step 5 expects `DUMMY-not-a-real-key-0000`.
- **Fix instruction**:
  - Delete line 14 from the Decision section.
  - In the smoke test, add it after step 5c, for example as "5d. Replace: `select * from public.ai_key_set('google', 'DUMMY-not-a-real-key-1111');` returns `key_last4 = '1111'`; `select secret_id from public.ai_keys where provider = 'google';` equals the value noted in step 3; `select provider, secret from public.ai_key_secrets();` returns `google | DUMMY-not-a-real-key-1111`; `select count(*) from vault.secrets where name like 'stoktok\_ai\_key\_%';` returns `1`."
  - The last count also proves that no orphan row was left behind.
  - Steps 6–9 then work unchanged, because step 9 deletes whatever value is stored.

### Rules R1–R10
No violations found.

### Nits (do not block)
- Smoke step 2: `show log_parameter_max_length;` has no expected value. Add "(must be `0` unless log_min_duration_statement is -1)" so the check is pass/fail.
- impl-log attempt 2 says "Not committed", but the change is committed in b3f6498.

### Follow-ups (out of scope)
- From attempt 1, still open:
  - Ming runs the smoke test on the real project (now with 5b, 5c and the replace step) and records step 7 as an ADR amendment.
  - Apply the migration before deploying the image.
  - db:check rollback coverage with a seeded Vault row.
- F9 (security review, not in Ming's list): the migration guard could also require `pg_extension` to contain `supabase_vault`, so a plaintext stub on a non-local database cannot be mistaken for Vault.
- F4: after the smoke test, check whether the real `vault.update_secret` blanks the description on replace. This is cosmetic.

## Attempt 3 — 2026-11-10
Verdict: PASS

### Checks (run by reviewer)
- typecheck: green (all packages; web route types generated, worker `tsc --noEmit` Done).
- lint: green (eslint Done in all packages).
- test: green: core 785, sources 35, ai 184, db 189 (+1 todo), worker 295, web 317. Same as attempt 2, which is expected because no code changed.
- Scope: `git diff 9d39ef7 HEAD` touches only `docs/adr/0009-ai-provider-keys-in-vault.md` (+1/−1 lines in the Decision list, step 2 and step 5d), `impl-log.md`, and the orchestrator state rows in `ticket.md` and `backlog.md`. No code, migration or test changed.

### Issue 1 (attempt 2): fixed
- The misplaced "3b. Replace" line is gone from "## Decision". Decisions now run 1–9 with no gap (ADR:9-18).
- Smoke step 5d (ADR:45) comes after 5c and has all four expected checks:
  - `key_last4 = '1111'`;
  - `secret_id` equals the value noted in step 3, which proves an in-place update;
  - `ai_key_secrets()` returns `google | DUMMY-not-a-real-key-1111`;
  - the escaped-LIKE count of `stoktok\_ai\_key\_%` returns `1`, so there is no orphan row.
- Consistent with the other steps:
  - Steps 3–5 still expect the `0000` value. They now run before the replace, so their expected values hold.
  - The 5d count of `1` holds because only `google` is set during the test (no stored keys exist before STK-076).
  - Step 9 deletes whatever value is stored and expects a count of `0`. That is still correct after 5d.
  - The LIKE escaping matches step 9 and the rollback (F6).

### Step-2 expectation for log_parameter_max_length
- The rule "must be `0` if `log_min_duration_statement` is not `-1`" is correct. Postgres logs bind parameters in full (default `-1`) when a statement is logged because of its duration, and `0` suppresses them.
- It is safe. Step 2 already requires `log_min_duration_statement = -1` and `log_statement` to be `none`/`ddl`; a `select ai_key_set(...)` is neither ddl nor mod. So the new clause is a stricter fallback and contradicts nothing. Any value that could log parameters still trips "stop and tell the team".

### Regression versus plan.md
None. The change is docs-only. Every acceptance criterion verified in attempts 1–2 still holds, and AC6 (the ADR records Vault, precedence and the threat model) is now structurally clean.

### Rules R1–R10
No violations found.

### Nits (do not block)
- impl-log attempt 3 says "Not committed" under Out-of-plan files, but it is committed in 580a1ed. This is the same stale-note pattern as attempt 2.
- Step 2: the `log_parameter_max_length` clause is redundant while `log_min_duration_statement` must be `-1`. It could say "(should be `0` as defence in depth)". This is cosmetic.
- Step 2 does not cover a literal typed into the SQL editor. `log_parameter_max_length` only limits bind parameters, not query text. The dummy-only rule in the smoke test intro already covers this.

### Follow-ups (out of scope)
- Ming runs the smoke test (now including 5b, 5c and 5d) on the real project and records the result of step 7 and the F4 description check as an ADR amendment.
- Apply the migration before deploying the image.
- db:check rollback coverage with a seeded Vault row.
- F9: the migration guard could also require `pg_extension` to contain `supabase_vault` on non-local databases.
