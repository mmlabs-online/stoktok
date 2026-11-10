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
