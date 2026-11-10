## STK-074 database consult (read-only)

### Findings
- **Migration, grant and check conventions (from the files I read)**
  - Existing pattern: RLS on, no policies, `revoke all ... from public, anon, authenticated`, grant to `service_role` (`supabase/migrations/20261109000100_ai_usage.sql`, `20261023000200_v1_rls_grants.sql`).
  - Functions use `security invoker` and `set search_path = ''`. Each is followed by `revoke execute ... from public, anon, authenticated` and `grant execute ... to service_role` (`20261110000100_ai_reserve_harden.sql`).
  - Every migration has a matching `rollback/*.down.sql`.
- **Checks use the real function and table names**
  - The `checks.sql` check `ai_functions_locked` is scoped by `proname in ('ai_reserve','ai_month_spend')` and asserts `not prosecdef`. Naming new wrappers `ai_key_*` will not trip it.
  - `tables_exist` is an exact list, so `ai_keys` must be added to it.
  - `anon_denied` and `authenticated_denied` loop over every public table, so a new table is covered automatically.
  - `no_policies` and `rls_enabled_all_tables` apply to a new table automatically.
- **How `db:check` runs** (`scripts/db-check.sh`)
  - It applies `bootstrap-roles.sql` (test only), then the migrations in a single transaction each, then `checks.sql`.
  - Next it applies the rollbacks in reverse order and requires `count(*) = 0` public tables, re-applies the migrations, and re-runs the checks.
  - In CI it runs against the `postgres:16` service image over `DB_CHECK_URL`. Locally it starts a throwaway cluster from the PG binaries.
- **Vault is not available in either environment.**
  - Neither the plain `postgres:16` image nor a stock local cluster has `supabase_vault` or `pgsodium`. There is no `vault` schema, so `vault.create_secret` and `vault.decrypted_secrets` do not exist there.
  - A migration containing `create extension supabase_vault` would fail in CI.
  - A migration with only plpgsql functions that mention `vault.*` in their bodies still applies, because plpgsql does not resolve relations at create time. It only fails when the function is called.
- **Vault API, from memory of Supabase docs; please verify on the real project**
  - `vault.create_secret(new_secret, new_name, new_description, new_key_id) returns uuid`.
  - `vault.update_secret(secret_id uuid, new_secret, new_name, new_description, new_key_id)`.
  - `vault.decrypted_secrets` is a view with a `decrypted_secret` column. `vault.secrets.name` is unique.
  - There is no `delete_secret`; you `delete from vault.secrets where id = ...`.
  - The `vault` schema is not exposed through PostgREST.

### Recommendations
1. **Use Vault plus a small metadata table, not an app table of ciphertext (AC2).** Hand-rolled crypto would need its own key management and would be worse. Vault encrypts at rest and `pg_dump` contains only ciphertext. Name secrets `stoktok_ai_key_<provider>`.
2. **Metadata table `public.ai_keys`:**
   - Columns: `provider text primary key check in ('anthropic','google')`, `secret_id uuid not null`, `last4 text not null check (char_length(last4)=4)`, `updated_at timestamptz not null default now()`.
   - It holds no secret, so the web server can read it with a plain `select` as `service_role`; no `ai_key_meta` function is needed.
   - Add RLS enabled, no policies, `revoke all ... from public, anon, authenticated`, and `grant select, insert, update, delete ... to service_role`, copying the `ai_usage` pattern.
   - Do not add a foreign key into `vault.secrets`. It would couple rollback to the extension. Reconcile in code instead.
3. **Three wrapper functions in `public`** (SQL or plpgsql; they are what supabase-js and the worker reach through rpc):
   - `ai_key_set(p_provider text, p_key text) returns void`:
     - Re-validate in the DB: provider is allowed, key matches `^[\x21-\x7e]{16,512}$` (no whitespace or newlines, printable ASCII).
     - Take `pg_advisory_xact_lock(hashtext('stoktok.ai_key.'||p_provider))`.
     - If an `ai_keys` row exists, call `vault.update_secret(secret_id, p_key)`. Otherwise call `vault.create_secret(p_key, name, 'stoktok '||provider)` and insert the row.
     - Compute `last4 = right(p_key,4)` and `updated_at = now()` inside the function so metadata cannot drift. If the row exists but the vault secret is gone (a manual delete), recreate it.
   - `ai_key_get(p_provider text) returns text`: `select decrypted_secret from vault.decrypted_secrets where name = ...`, or null if none. This is the only decrypting path and the only caller is the server key resolver.
   - `ai_key_delete(p_provider text) returns void`: `delete from vault.secrets where id = ...` plus `delete from public.ai_keys`, in one function.
   - Errors must be generic with `errcode '22023'`. Never put `p_key` in a `raise` message.
4. **SECURITY DEFINER is needed here, unlike `ai_reserve`.**
   - Reason: stock Supabase restricts the `vault` schema, and direct `delete from vault.secrets` or `vault.create_secret` by `service_role` is not guaranteed. I recall `service_role` having some vault access but could not verify it.
   - Definer functions run as the migration owner (`postgres`), who has vault access.
   - Required pattern: `security definer set search_path = ''`, every object schema-qualified (`vault.`, `public.`, `pg_catalog.`), owned by the migration role.
   - Immediately after each function, run `revoke all on function ... from public, anon, authenticated; grant execute ... to service_role;`.
   - The `from public` revoke is essential. The default `PUBLIC` execute would otherwise expose a definer function that returns decrypted keys. The `alter default privileges` in the RLS migration does not remove `PUBLIC`.
5. **`db:check` testing: add a test-only vault stub to `scripts/db-check/bootstrap-roles.sql`.**
   - Create the stub only if `pg_available_extensions` has no `supabase_vault`. Guard with that, or skip the stub if `vault.secrets` already exists, so a local Supabase still works.
   - Contents:
     - schema `vault`;
     - a `vault.secrets(id uuid default gen_random_uuid(), name text unique, description text, secret text, created_at, updated_at)` table;
     - a `vault.decrypted_secrets` view exposing `secret as decrypted_secret`;
     - `vault.create_secret` and `vault.update_secret` with the real signatures.
   - Do not grant `service_role` anything on the stub `vault` schema (`revoke all` on schema vault and the objects in it). That way the checks prove the wrappers work through the definer, and that direct access fails with 42501 for `anon`, `authenticated` and `service_role`.
   - If Vault turns out to grant `service_role` direct access on the real project, drop that last assertion for `service_role` only.
   - Do not create the stub in a migration, so the production schema is untouched.
   - New cases in `checks.sql`:
     - **tables_exist** updated for `ai_keys`.
     - **ai_key_columns** (`assert_col`).
     - **ai_key_roundtrip** as `service_role`: set returns a key via get; set again replaces it; the meta `last4` and `updated_at` change; delete removes both the vault secret and the metadata row; get after delete is null.
     - **ai_key_negatives** via `expect_fail` (22023): bad provider, key with a space, a newline, too short, too long, null.
     - **ai_key_functions_locked**:
       - `anon` and `authenticated` cannot execute, and `service_role` can.
       - `proacl` is not null and has no grantee 0 (PUBLIC).
       - Every `ai_key_%` function has `prosecdef` and `proconfig` containing `search_path=""`.
       - A generic version for all public `security definer` functions would be stronger.
     - **ai_keys_no_secret_leak**: `last4` is the only key-derived column in `ai_keys`; a metadata row contains no full key.
     - **ai_key_anon_denied**: anon and authenticated get 42501 on `execute ai_key_get` and on `select` from `ai_keys`.
   - Since the checks run in one rolled-back transaction, secret rows created in the stub vanish at the end.
6. **Limits of the stub, and what to do about them.** The stub cannot prove real encryption or real vault privileges. Add a manual smoke step to the ticket verification, for example `supabase db reset` locally or a staging project. It should confirm that `vault.secrets.secret` differs from the plaintext, that `anon` and `authenticated` cannot call the wrappers or read the vault, and that `ai_key_get` returns the saved value. Optionally add a conditional check in `checks.sql` that runs only when the real `supabase_vault` extension is present.
7. **Migration `<ts>_ai_keys.sql`:**
   - No `create extension`. Supabase projects normally have Vault enabled; confirm in the dashboard, and document that in `supabase/README.md`. If it is not enabled, the plan could add a guarded `create extension if not exists supabase_vault` run by Ming, outside the migration.
   - Comment that `ai_keys` holds no secrets and that `ai_key_get` is the only decrypt path.
8. **Rollback `<ts>_ai_keys.down.sql`:**
   - `drop function if exists` for the three functions.
   - `do $$ begin if to_regclass('vault.secrets') is not null then delete from vault.secrets where name like 'stoktok_ai_key_%'; end if; end $$;` (before dropping `ai_keys`; to be safe, delete by `ai_keys.secret_id` first).
   - `drop table if exists public.ai_keys`.
   - Do not drop the extension or schema.
   - Rolling back deletes stored keys. This is deliberate, and the migration comment and ADR should say so. Re-apply asks Ming to re-enter the keys.
9. **App-side points tied to the ACs:**
   - Resolve keys on every call, or with a TTL of a few seconds, through `ai_key_get`. Do not cache in a module singleton (AC4). One rpc per AI call is negligible.
   - The server action returns only `{provider, last4, updated_at}` (AC1).
   - Pass the key only as an rpc parameter and never in a URL.

### Risks
- **Logging of parameters.** The default `log_parameter_max_length_on_error = 0` keeps bound values out of error logs. `log_statement = 'all'` or similar self-hosted settings could log rpc bodies. Confirm that the Supabase project does not set them, and add `set log_statement = 'none'` on the setter if that is permitted.
- **SECURITY DEFINER with a returning-secret function.** A missing `revoke from public` or a wrong `search_path` would be a direct key leak. The `proacl` and `proconfig` checks above guard against that, and the security auditor should see them.
- **Backups and restore.** `pg_dump` contains ciphertext only. Keys restored into a different Supabase project, or after the project's root key changes, are unreadable. Treat re-entering the keys as the recovery path (document it in the ADR).
- **Stub drift.** The stub could diverge from the real vault signatures, so the manual smoke step in the plan is mandatory.
- **Single-user trust.** Any user in the project's Auth with an authenticated session can reach the save action through the app, which is the same trust boundary as R6; the DB layer itself is closed to them.

### Open questions
1. Is `supabase_vault` enabled on the stoktok Supabase project, and which version (recent versions no longer depend on pgsodium)?
2. Does `service_role` have direct privileges on `vault.secrets` and `vault.decrypted_secrets` on the real project? If yes, the wrappers could be `security invoker`, but I would still use definer for the delete and for locking the surface down.
3. Should `last4` be stored in the DB (recommended) or derived at read time? Deriving it means decrypting on every Settings page load, which is worse.
4. Should the DB constrain key length and charset (as I propose), or leave provider-specific format checks to the app? The app-side check will still need to exist for friendly errors.

Files read: `/home/user/stoktok/work/tickets/STK-074/ticket.md`, `/home/user/stoktok/scripts/db-check.sh`, `/home/user/stoktok/scripts/db-check/bootstrap-roles.sql`, `/home/user/stoktok/scripts/db-check/checks.sql`, `/home/user/stoktok/supabase/migrations/20261109000100_ai_usage.sql`, `/home/user/stoktok/supabase/migrations/20261110000100_ai_reserve_harden.sql`, `/home/user/stoktok/supabase/migrations/20261023000200_v1_rls_grants.sql`, `/home/user/stoktok/supabase/rollback/20261109000100_ai_usage.down.sql`, `/home/user/stoktok/.github/workflows/ci.yml`, `/home/user/stoktok/supabase/README.md`.
