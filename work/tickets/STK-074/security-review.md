# STK-074 security review

## Security review: STK-074, attempt 1 (slice a: AI keys in Vault)

**Verdict:** No 🔴 findings. The SQL surface is tight. Three 🟡 items should be fixed before PASS: two are documentation and smoke-test changes, and one is a log-config check. I read the files directly (no Bash in this run), so I did not run `git diff` and did not check the tests by executing them.

### What holds (checked, no action needed)
- **Definer hygiene:** all three functions in `supabase/migrations/20261110000200_ai_keys.sql` have:
  - `security definer` and `set search_path = ''`, with every relation and function schema-qualified (`public.`, `vault.`, `pg_catalog.`). Types and operators resolve through implicit `pg_catalog`. There is no dynamic SQL.
  - The grants at :110-115: revoke from `public, anon, authenticated`, grant execute to `service_role` only.
  - db:check (`checks.sql:716-745`) checks `prosecdef`, `search_path=""`, `proacl` not null and no PUBLIC grantee (0). It also adds a definer allow-list.
- **Table:** RLS is on and `ai_keys` has `revoke all … service_role` followed by `grant select` (:22-24). `last4` and `secret_id` cannot drift.
- **Input validation:**
  - Providers are allow-listed in SQL (:40, :80), in the table CHECK and in the repo.
  - The key is checked for null, length 20–256 (`char_length`) and ASCII `\x21-\x7e`, the same rule as `packages/core/src/ai/keys.ts:7-13`.
  - Errors use the fixed text `'invalid ai key arguments'` with code 22023, which never interpolates `p_key`. The sentinel test is at `checks.sql:702-709`.
- **Locking:** `ai_key_set` and `ai_key_delete` take a per-provider `pg_advisory_xact_lock` (:45, :84). The name `stoktok.ai_key.*` is distinct from `stoktok.ai_budget`. The orphan path, replace path (same `secret_id`) and double delete are tested.
- **Repo errors** (`packages/db/src/repos/ai-keys.ts:20-24`): `fail()` throws a `DataError` with fixed text and the pg code only, with no `cause`. It never calls `unwrap`.
- **Client logging:** `client.ts:118-125` uses a bare `catch {}` and logs only `{event, code}`, then returns `provider_unavailable`. It fails closed with no env fallback. `budgetStatus()` (:98) never resolves providers.
- **Wiring:** `apps/web/server/ai.ts` is `server-only` and imports through `./db`, which is also `server-only`. The worker uses its own service client. The SDK adapters run with `logLevel: 'off'`.
- **Docs:** the spec §7 and CLAUDE.md wording match plan step 10.
- **Rollback** (`supabase/rollback/20261110000200_ai_keys.down.sql`): drops the functions first, then the Vault rows (guarded by `to_regclass`), then the table. It never drops the extension or the schema.

### Findings

🟡 **F1: The ADR threat model leaves out the main new exposure.** (`docs/adr/0009-ai-provider-keys-in-vault.md:17-20`)
- Before this change, a leaked service role key gave DB access but not the AI keys, which lived only in env on Ming's server.
- Now anyone with the service role key can `POST https://<project>.supabase.co/rest/v1/rpc/ai_key_secrets` from anywhere and get both keys in plaintext. The blast radius of a service-role leak has grown.
- The ADR should say this plainly and add: "on a service-role-key leak, rotate the AI keys at Anthropic and Google too."
- It should also name two more decrypt paths that "DB-owner access" only hints at: the Supabase dashboard's Vault UI (any Supabase account login) and SQL editor history.
- "Backups (ciphertext)" should read "ciphertext, decryptable by anyone who can restore into this project, since Supabase holds the root key".
- Ties to AC6: the threat model must be honest.

🟡 **F2: The smoke test checks only `log_statement`, but other logging can capture RPC parameters.** (ADR :34, plan :28)
- PostgREST sends the key as a bind parameter. `log_min_duration_statement` (when ≥0) logs bind parameters in full by default (`log_parameter_max_length = -1`).
- `log_parameter_max_length_on_error` and `pgaudit` with `pgaudit.log_parameter = on` can do the same.
- Fix: extend step 2 to `show log_min_duration_statement; show log_parameter_max_length; show log_parameter_max_length_on_error; select extname from pg_extension where extname='pgaudit';` (plus `show pgaudit.log; show pgaudit.log_parameter;` if pgaudit is present). Stop if any of these could log parameters. Add the same to the ADR "Not protected" line.
- Ties to AC2 and to the "never reach the logs" goal.

🟡 **F3: The Vault stub can hide a real privilege problem, and the smoke test does not cover the update path.**
- In db:check the definer functions are owned by the throwaway cluster's superuser. So the round-trip proves the wrappers work without `service_role` Vault rights, which is good. It proves nothing about what the real owner (`postgres`, non-superuser on Supabase) is allowed to do in Vault.
- `ai_key_vault_direct_denied` (`checks.sql:747-759`) only re-checks the stub's own revokes (`bootstrap-roles.sql:48-50`). It is self-fulfilling. It is correctly labelled, but it should not be counted as evidence.
- The smoke test covers create (step 3), read (step 5) and delete (step 9) on the real Vault. It never calls `ai_key_set` a second time, so `vault.update_secret` and the orphan `delete from vault.secrets` in `ai_key_set` (migration :55-57) never run as `postgres` on the real project.
- Fix: add a smoke step "3b: `ai_key_set('google','DUMMY-not-a-real-key-1111')`, then check that `secret_id` is unchanged, `last4 = '1111'` and step 5 returns the new value".
- Also add a positive call as `service_role`: `set role service_role; select provider from public.ai_key_secrets(); reset role;`. Step 6 only proves the denials.
- Ties to AC2.

🟢 **F4: The real `vault.update_secret` signature may differ from the stub.** (migration :55, `bootstrap-roles.sql:37`) In some Vault versions `update_secret` has `new_description text DEFAULT ''`, which would blank the description on every replace. The stub uses `DEFAULT null`, which would hide this. The effect is cosmetic, but it is a second sign the stub signature is unverified. Covered by the F3 step.

🟢 **F5: A null `decrypted_secret` silently falls back to env.** (`packages/db/src/repos/ai-keys.ts:67-70`)
- `secret` is not type-checked. A null value passes through, `present()` in `packages/ai/src/keys.ts:9` treats it as absent, and the call falls back to the env key. That is fail-open, not fail-closed.
- Fix: `if (typeof r.secret !== 'string' || r.secret === '') throw new DataError('MAPPING', TABLE, 'read', 'row mapping failed (secret)')`, plus one test.
- Ties to the fail-closed rule (ADR decision 5).

🟢 **F6: The `like` patterns treat `_` as a wildcard.** At rollback :12 (and `checks.sql:681`, smoke step 9), `like 'stoktok_ai_key_%'` matches any single character where the name has `_`. Use `like 'stoktok\_ai\_key\_%'` so the rollback can only delete stoktok's own secrets.

🟢 **F7: ADR decision 7 says more than the guard enforces.** (ADR :15) It says "Only `ai-keys.ts` calls the wrappers", but r3-guard (`packages/db/src/r3-guard.test.ts:104-116`) only restricts `ai_key_secrets` and `readAiKeySecrets`. Nothing restricts `ai_key_set` or `ai_key_delete`. Either reword the ADR, or add both names to the guard now (slice b will add the callers in `server/`).

🟢 **F8: Function ownership is implicit and never checked.**
- Nothing pins or checks the owner. If the migration is ever applied by a role other than `postgres`, the definer runs with that role's Vault rights.
- Fix: add a smoke step `select proname, proowner::regrole from pg_proc where proname like 'ai\_key\_%';` and expect `postgres`.

🟢 **F9: The stub is guarded only by "vault schema absent" and a localhost host check.** (`bootstrap-roles.sql:16`, `scripts/db-check.sh:20-24`)
- If someone pointed `DB_CHECK_URL` at a port-forwarded Vault-less database, a plaintext `vault` stub would be created there for good. The migration guard (:8) would then accept it, and keys would be stored in plaintext.
- Low likelihood. One way to make it impossible: the migration guard also requires `pg_extension` to contain `supabase_vault` unless the stub marker comment is present. Then a stub on a real project at least shows up in review.

🟢 **F10: Document that `ai_key_set` must never use `rpc(..., { get: true })`.** That would put the key in the URL, where the API gateway logs it. The current code uses the default POST (repo :34), so this is only a note for slice (b) and the ADR.

### Recommendations (ordered)
1. Fold F1 and F2 into the ADR threat model and the smoke test (AC6, AC2).
2. Add smoke steps 3b, the positive `service_role` call and the ownership query (F3, F8). Ming must record the results before the migration counts as verified.
3. Make the F5 type check fail closed, with a test (R8).
4. F6 and F7 are one-line fixes; do them in this attempt if the rework is open anyway.

### Risks
- Real Vault grants for `postgres` (update and delete on `vault.secrets`, execute on `update_secret`) cannot be checked offline. If any is missing, replace or delete fails in production. It fails closed (`DB_ERROR`), so this breaks the feature but leaks nothing.
- Deploy order: an image deployed before the migration means every AI call returns `provider_unavailable`. The ADR documents this.

### Open questions
- The ADR (:3) calls slice (b) **STK-076**, but the plan proposes **STK-075**. Which ID is correct?
- Has the manual smoke test (including step 7, `service_role` direct access to `vault.decrypted_secrets`) been run? `impl-log.md` should record the results. The ADR amendment is still pending.

## STK-074 security re-review, attempt 2

**Verdict:** No 🔴 findings. One 🟡 regression must be fixed before PASS: smoke step 3b is in the wrong place in the ADR. All the other targeted fixes are confirmed. I read the files directly and did not run any tests or checks.

### Confirmed fixed
- **F1, threat model:** `docs/adr/0009-ai-provider-keys-in-vault.md:22-24` now states that a leaked service role key exposes the AI keys, and tells Ming to rotate them at Anthropic and Google. It also lists the dashboard Vault UI, SQL editor history and the restore-decryptable backups.
- **F2, logging checks:** smoke step 2 (`ADR:40`) and the threat model (`:25`) now cover `log_min_duration_statement`, `log_parameter_max_length`, `log_parameter_max_length_on_error` and pgaudit.
- **F3, partly fixed:** step 5b, the positive `service_role` call, is at `ADR:44`. The replace step is misplaced (see N1).
- **F5, null/empty secret:** `packages/db/src/repos/ai-keys.ts:69` throws `MAPPING` on a null or empty secret, and the test is at `ai-keys.test.ts:113-117`. The client's bare `catch` maps this to `provider_unavailable`, so it fails closed.
- **F6, LIKE patterns:** the escaped pattern is used at `supabase/rollback/20261110000200_ai_keys.down.sql:12`, `scripts/db-check/checks.sql:681` and smoke step 9 (`ADR:49`). Step 5c also uses an escaped pattern.
- **F7, guard scope:** `packages/db/src/r3-guard.test.ts:118-122` now restricts `ai_key_set` and `ai_key_delete` to the ai-keys repo and its test. ADR decision 7 (`:16`) now matches what the guard enforces. The guard only scans TS/JS files, so the SQL files are not affected.
- **F8, ownership:** smoke step 5c (`ADR:45`) checks that all three functions are owned by `postgres`.
- **F10, GET note:** recorded as ADR decision 8 (`:17`).

### New findings
🟡 **N1: Smoke step 3b is in the Decision list, not the smoke test.** (`docs/adr/0009-ai-provider-keys-in-vault.md:14`)
- The "3b. Replace" text sits between decisions 5 and 6. The smoke procedure (`:37-49`) still has no replace step.
- So `vault.update_secret` and the orphan-delete path in `ai_key_set` still never run as `postgres` on the real project. This was the main point of F3 and AC2.
- Moving it to just after step 3 would also break the procedure. Steps 4 and 5 expect the value `…0000`, but after 3b the stored value would be `…1111`.
- Fix: delete line 14 from Decisions and add the step to the smoke list after 5c, as "5d". It should:
  - run `ai_key_set('google','DUMMY-not-a-real-key-1111')`;
  - check that `key_last4 = '1111'` and that `secret_id` is unchanged from step 3;
  - check that `ai_key_secrets()` returns the `…1111` value;
  - optionally check that the Vault `description` was not blanked, which covers F4.

🟢 **N2: Cosmetic.** The plan's smoke step 9 (`work/tickets/STK-074/plan.md:35`) still uses the unescaped `like`. The ADR is the authoritative procedure, so no code impact.

### Still open from attempt 1
- **F4, update_secret signature (🟢):** the real `vault.update_secret` signature is still unverified offline. It is checked once the N1 step is in the smoke procedure and Ming runs it.
- **F9, stub guard (🟢):** not addressed. A `vault` stub could still be created on a non-local database that has no Vault. The migration guard still accepts any `vault` schema without checking `pg_extension` for `supabase_vault`. Low likelihood; acceptable as a follow-up.
- **Manual smoke test:** not yet run on the real project. The step 7 amendment to the ADR is also still pending. It needs Ming.

### Risks
The real Vault grants for `postgres` stay unverified until the corrected smoke test is run. If one is missing, the feature fails closed (`DB_ERROR`) and nothing leaks.

### Recommendations
1. Fix N1 now (AC2 and the F3 intent). It is a docs-only change.
2. Log F9 as a follow-up ticket (R7).
