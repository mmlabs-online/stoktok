# ADR 0009: AI provider keys in Supabase Vault (STK-074 slice a)

Status: accepted for slice (a) of STK-074 (2026-11-10). Slice (b), the Settings "Khóa AI" card and its server actions, is STK-076.

## Context
Spec §7 and CLAUDE.md Conventions said LLM keys live only in the deploy repo's env handling. Ming decided on 2026-11-10 that keys can be entered on Settings, stored encrypted in Supabase Vault, with the STK-072 env keys as the fallback. This ADR records that change; spec §7 and CLAUDE.md are updated to match.

## Decision
1. **Vault plus a metadata table.** The key is a Vault secret named `stoktok_ai_key_<provider>`. `public.ai_keys (provider, secret_id, last4, updated_at)` holds no secret. `last4` is the only part ever shown. The secret name never contains an env variable name.
2. **The first `security definer` functions.** `ai_key_set`, `ai_key_delete` and `ai_key_secrets` are `security definer` with `set search_path = ''` and fully qualified names, because Vault privileges for `service_role` are not guaranteed and this keeps the surface to three functions. Execute is revoked from `public`, `anon` and `authenticated` and granted to `service_role` only (the `from public` revoke is mandatory). `service_role` has `select` only on `ai_keys`; writes go through the wrappers so `last4` and `secret_id` cannot drift. `db:check` asserts this and keeps an allow-list of definer functions in `public` (`security_definer_allowlist`), so any future definer function must be added deliberately.
3. **Precedence** is UI key, then env key, then the provider is disabled. It is resolved once per `generate()` (`resolveAiKeys`, `makeProviderResolver` in `packages/ai`).
4. **No cache.** Keys are read on every `generate()` (one RPC). A cache would serve stale keys across the two processes (web and worker) after a replace or delete. A TTL cache is a follow-up only if latency is measured as a problem.
5. **Fail closed.** If the key read fails, the call returns `provider_unavailable` and does not fall back to env. An empty result (no stored key) falls back to env. Only `{event: 'ai_key_read_failed', code: 'key_read_failed'}` is logged.
6. **Format rule.** 20 to 256 printable ASCII characters, no whitespace, no trimming (`validateAiKeyFormat` in core, repeated in `ai_key_set`). There is no provider-prefix check, so a future key format is not rejected. Errors never echo the key; the repo throws `DataError` with no `cause`.
7. **Access path.** Only `packages/db/src/repos/ai-keys.ts` calls the wrappers; r3-guard restricts `ai_key_secrets` / `readAiKeySecrets` to a fixed file list and forbids any `vault.*` reference in TS/JS.

## Threat model
- Protected: the browser and client bundle, the `anon` and `authenticated` roles, application logs, database backups (ciphertext).
- Not protected: holders of the service role key or DB-owner access, a compromised server process, and database statement logging if `log_statement` is raised to `all` or `mod` (RPC parameters could be logged).
- Replacing or deleting a key here does not revoke it at the provider.

## Consequences
- One extra RPC per AI call.
- `db:check` runs on plain Postgres 16 with a Vault stub (plaintext, TEST ONLY, in `scripts/db-check/bootstrap-roles.sql`), so real encryption and real Vault privileges are checked only by the manual smoke test below. The stub signatures (`vault.create_secret(new_secret, new_name, new_description, new_key_id)`, `vault.update_secret(secret_id, new_secret, new_name, new_description, new_key_id)`, view `vault.decrypted_secrets`) could not be verified offline: verify on the real project.
- The migration refuses to apply when `supabase_vault` is not enabled (no `create extension`).
- Rolling back deletes the stored keys. After a restore into another project, re-enter them.
- Deploy order: apply the migration before deploying an image with this change, otherwise every AI call fails closed (`provider_unavailable`).
- Until STK-076 lands there are no stored keys, so env keys are used.
- The result of smoke step 7 is to be recorded here as an amendment.

## Manual Vault smoke test
Run on the real stoktok Supabase project in the SQL editor after the migration is applied, using only the dummy value below, never a real key (editor history and logs can retain the text).
1. `select extname, extversion from pg_extension where extname = 'supabase_vault';` returns 1 row. If not, enable Vault in the dashboard first.
2. `show log_statement;` returns `none` or `ddl`. If `all` or `mod`, stop and tell the team.
3. `select * from public.ai_key_set('google', 'DUMMY-not-a-real-key-0000');` returns `key_last4 = '0000'`.
4. `select secret = 'DUMMY-not-a-real-key-0000' as is_plaintext from vault.secrets where name = 'stoktok_ai_key_google';` returns `false`.
5. `select provider, secret from public.ai_key_secrets();` returns `google | DUMMY-not-a-real-key-0000`.
6. `set role anon;` then `select * from public.ai_key_secrets();`, `select * from public.ai_keys;`, `select * from vault.decrypted_secrets;`: each fails with permission denied. `reset role;`. Repeat with `set role authenticated;`.
7. Informational: `set role service_role; select count(*) from vault.decrypted_secrets; reset role;`. Record whether it succeeds or is denied.
8. Optional: `POST https://<project>.supabase.co/rest/v1/rpc/ai_key_secrets` with only the anon key returns 401, 403 or 404, not data.
9. `select public.ai_key_delete('google');` returns `true`; `select count(*) from vault.secrets where name like 'stoktok_ai_key_%';` returns `0`.
