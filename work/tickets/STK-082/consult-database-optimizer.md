## STK-082 consult: database-optimizer (read-only)

Files read: ticket.md, `supabase/migrations/20261110000200_ai_keys.sql`, its rollback, `scripts/db-check.sh`, `scripts/db-check/{checks,bootstrap-roles}.sql`, `packages/db/src/repos/ai-keys.ts`, `test-db/{ai-keys.test.ts,harness.ts,global-setup.ts}`, `pg/{schema,types}.ts`, `r3-guard.test.ts` (grep only). I did not run anything.

### Findings

1. **Facts about the current state.**
   - `ai_keys` today is `provider pk, secret_id uuid not null unique, last4, updated_at` (0200:13-18), with RLS and `revoke all` (0200:22-24).
   - `service_role` has SELECT only. All writes go through three SECURITY DEFINER functions (0200:28-108, grants at 110-115).
   - The 0200 header and `packages/core/src/ai/keys.ts:1` both say the format regex "repeats" the SQL check, so they must be kept in sync. After this change the DB can no longer see the plaintext, so the 20-256 and printable-ASCII rules live only in `validateAiKeyFormat`. Update both comments.
   - `AiKeysTable` in `packages/db/src/pg/schema.ts:216-221` still has `secret_id`.

2. **The Vault stub must stay until STK-083.**
   - 0200:8-11 raises if `vault.secrets` is missing, and `db-check.sh:49,54` and `global-setup.ts:79-84` apply every file in `supabase/migrations` in order.
   - The stub is the only thing that lets 0200 apply on plain PG16. Removing it now breaks `db:check` and `test:db` at step one.

3. **`drop table` + `create table` loses the grants, the revoke and RLS.**
   - Default privileges give anon, authenticated and service_role ALL on new tables (`bootstrap-roles.sql:9`, same as Supabase).
   - A recreated `ai_keys` would therefore expose `ciphertext` to anon and authenticated unless the migration repeats the RLS and revoke block (0200:22-24).
   - The existing `ai_keys_privileges` check (checks.sql:703-716) only tests SELECT for anon and authenticated. It would not catch an INSERT, UPDATE or DELETE leak.

4. **The repo now writes the table directly.**
   - The old design had service_role write nothing directly, and checks.sql:708-712 asserts that.
   - With app-side crypto the repo does upsert and delete itself. That check is now wrong and must flip, and the migration must grant service_role insert, update and delete.
   - This is a temporary Supabase-shaped grant. STK-083 removes all grants, RLS and roles from the baseline.

5. **The empty definer allowlist has a NULL trap.**
   - checks.sql:827-829 does `array_agg(...)` and then `got is distinct from array[...]`.
   - With zero definer functions `array_agg` returns NULL, and `NULL is distinct from '{}'::text[]` is true. A naive `array[]::text[]` comparison would always raise.
   - Use `if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef) then raise ... end if`, or `coalesce(got, '{}')`.

6. **Rollback chain.**
   - `db-check.sh:50,58-60` applies every DOWN file in reverse sort order, expects 0 public tables, then re-applies UP.
   - The new down file runs first, then 0300's, then 0200's.
   - 0200.down (rollback/20261110000200_ai_keys.down.sql:2-16) is fully guarded with `if exists` and `to_regclass`, so it is safe after the new down has already dropped the table.
   - 0300 (ai_summaries) does not reference `ai_keys` (no match in grep), so the order is safe.

7. **STK-083 ordering.**
   - Already agreed in the STK-081 plan (work/tickets/STK-081/plan.md:237) and STK-085 plan A6: STK-082 lands before STK-083.
   - `test-db/ai-keys.test.ts:1` carries `// remove in STK-082`.

8. **Driver parsing needs no change.**
   - `types.ts:53-65` only overrides date, timestamptz and their arrays. bytea therefore arrives as `Buffer` and smallint as `number` under pg defaults.
   - Update the schema.ts types accordingly: `Buffer` for the three bytea columns, `number` for `key_version`, and `Generated`/`TsDef` for `updated_at`.

### Recommendations

**R-1. Forward migration** (AC "new forward migration"). Name it `supabase/migrations/20261111000100_ai_keys_app_encryption.sql`, so it sorts after 20261110000300.
- Do not `alter table`: the old `secret_id not null unique` and existing rows make an in-place alter awkward. Drop and recreate in one transaction.
- Order of statements:
  1. Guarded Vault cleanup first, while `ai_keys` still exists:
     ```sql
     do $$ begin
       if to_regclass('vault.secrets') is not null then
         delete from vault.secrets where id in (select secret_id from public.ai_keys)
            or name like 'stoktok\_ai\_key\_%';
       end if;
     end $$;
     ```
     This is a no-op on Postgres 17 without Vault. Do not `create extension` or touch the schema.
  2. `drop function if exists public.ai_key_secrets(); public.ai_key_delete(text); public.ai_key_set(text,text);`
  3. `drop table public.ai_keys;`
  4. `create table public.ai_keys` (columns below).
  5. Repeat the Supabase-shaped hardening for the interim: `alter table ... enable row level security; revoke all ... from public, anon, authenticated, service_role; grant select, insert, update, delete ... to service_role;`. Header comment: "interim Supabase shape, removed by the STK-083 baseline".
- New table:
  ```sql
  provider    text primary key check (provider in ('anthropic','google')),
  ciphertext  bytea not null check (octet_length(ciphertext) between 20 and 256),
  iv          bytea not null check (octet_length(iv) = 12),
  auth_tag    bytea not null check (octet_length(auth_tag) = 16),
  key_version smallint not null check (key_version >= 1),
  last4       text not null check (last4 ~ '^[\x21-\x7e]{4}$'),
  updated_at  timestamptz not null default now()
  ```
- Why those checks:
  - GCM is length-preserving and keys are 20-256 printable ASCII (1 byte per char), so ciphertext length is exactly the key length. That keeps a length guard in the DB.
  - 12-byte IV and 16-byte tag are fixed by GCM.
  - No default on `key_version`; the keyring always writes it.
- A `comment on table` should say: ciphertext only, written by the repo, AAD = provider.
- Existing keys are not migrated: SQL has no master key, and the ticket says keys are re-entered after STK-084.

**R-2. Do not apply this migration to the production Supabase project** (AC "production keeps working").
- Today's release calls `ai_key_set` and `ai_key_secrets` via RPC (`apps/worker/src/ai.ts:13`; the write wrappers are allow-listed in the web ai-keys module and its tests, and r3-guard.test.ts:133-141 restricts them to those files). Applying the migration there would break it.
- State in the migration header, the ticket and `supabase/README.md`: "never apply to the Supabase project; it exists for db:check/test:db and the STK-083 baseline."
- Put the Vault cleanup for the live Supabase project in the STK-084 cutover runbook: `delete from vault.secrets where name like 'stoktok\_ai\_key\_%';`, with the old keys rotated at Anthropic and Google if the old project outlives the cutover (the Supabase project stays for Auth).

**R-3. Rollback** `supabase/rollback/20261111000100_ai_keys_app_encryption.down.sql`.
- Minimal option (recommended): `drop table if exists public.ai_keys;`. It leaves db:check's "no tables after rollback" invariant intact, and 0200.down then no-ops cleanly. State in the header that rolling back deletes the stored keys (as ADR 0009 did) and that the Vault-shaped functions are not restored, because Vault cannot be repopulated without the plaintext.
- Full-fidelity option: re-create the 0200 table and functions in the down file (about 90 duplicated lines). I judge it not worth it, since the old shape would exist only to serve a release that never receives this migration.

**R-4. `db:check` changes (checks.sql).**
- Columns (695-701): assert `ciphertext`/`iv`/`auth_tag` as `bytea`, `key_version` as `smallint`, `last4` as `text`, `provider` as `text`, `updated_at` as `timestamp with time zone`, all NOT NULL. Also assert `secret_id` does not exist (an `information_schema` query).
- Privileges (703-716): flip the "no direct writes" rule. Require service_role select, insert, update and delete. Require anon and authenticated to have none of the four, plus `relrowsecurity` true.
- Replace the 718-771 roundtrip and 773-801 negatives with constraint tests, run as `set local role service_role` so the new write grant is proven, then `reset role` and clean up. They are all statically-sized bytea tests using `decode(...)`/`repeat`/`gen_random_bytes` or `'\x00'::bytea`:
  - Valid row: 20- or 256-byte ciphertext, 12-byte iv, 16-byte tag, version 1.
  - Bad `provider`: `'openai'` -> 23514.
  - Ciphertext of 19 and 257 bytes -> 23514.
  - iv of 11 and 13 bytes -> 23514.
  - auth_tag of 15 and 17 bytes -> 23514.
  - `key_version` 0 -> 23514.
  - `last4` of 3 chars, 5 chars, one containing a space, and `'é'` -> 23514.
  - Any NULL column -> 23502.
  - Duplicate provider -> 23505.
  - Upsert (`on conflict (provider) do update`) replaces and keeps one row.
- Replace 803-822 with a "functions gone" check: no `pg_proc` rows named `ai_key_set`, `ai_key_delete` or `ai_key_secrets`.
- Definer allowlist (824-832): keep the check and make the expected set empty, with the NULL-safe form from Finding 5. It stays valuable as a guard against future definer functions and survives into STK-083 unchanged.
- Remove `ai_key_vault_direct_denied` (834-846): it only tested the stub's own grants, which existed to justify the definer design. Keep the stub itself (bootstrap-roles.sql:13-52) and add a comment: "kept only so 0200 applies; delete with the supabase/ chain in STK-083".
- **Vault cleanup needs a seeded test.** `db-check.sh` applies all UP files in one call (line 54), so the guarded Vault delete in R-1 step 1 never sees data. Two options:
  1. Split the apply loop at the new migration, seed `vault.secrets` (a `stoktok_ai_key_google` row) and an old-shape `ai_keys` row, apply the new migration, then assert both are empty.
  2. Drop the Vault delete from the migration and rely on the R-2 runbook.
  I prefer option 1 (about 8 lines of shell), because the ticket scope names the Vault drop. If the orchestrator prefers a smaller diff, option 2 is acceptable but should be recorded.

**R-5. `test:db` for the new repo** (`packages/db/test-db/ai-keys.test.ts`; remove the stale "remove in STK-082" comment on line 1; `keyring` test-db cases run against the real migrated schema).
- Round trip: save for both providers, `listAiKeyMeta` returns `last4`/`updatedAt` and no ciphertext or plaintext, `readAiKeySecrets` decrypts both. Replace updates `last4`, `updated_at` and `iv`. Delete returns true then false.
- The stored row contains neither the key nor its last 4 in `ciphertext` (check the bytea does not contain the plaintext bytes).
- IV uniqueness: the same key saved twice gives different `iv` and `ciphertext`.
- AAD binding: swap the two providers' rows with raw SQL (`update` ciphertext, iv, auth_tag), then `readAiKeySecrets` must fail closed. This directly tests "AAD = provider".
- Wrong master key: handle with another key and rows present rejects with a DataError that the caller maps to `provider_unavailable`. No rows and no key returns `{}` (env fallback). Rows but no key rejects.
- Tamper: flip a byte of `auth_tag`, `ciphertext` and `iv`, and set an unknown `key_version`; each rejects.
- No leak: error text and `JSON.stringify(error)` contain neither the key, the master key nor `last4` (keep the current SENTINEL pattern from lines 36-48). Rewrite the `create or replace function ai_key_set` hack (line 39) with a constraint-violation case: `saveAiKey` of a valid-format key where the DB rejects (for example, a unit-level test that the repo maps 23514 to VALIDATION), or a repo-level test against a deliberately failing keyring.
- Ended-handle test (lines 50-61) stays. Add the keyring-less handle case.
- Parsing: assert the repo handles `Buffer` input and output, since types.ts does not override bytea.
- Concurrency: two parallel `saveAiKey` calls for the same provider leave exactly one row. The upsert is atomic, so the old advisory locks (0200:45,84) are no longer needed; say so in the repo comment.
- r3-guard (`r3-guard.test.ts:118-170`): rewrite for decrypt-only-in-keyring/repo as the ticket plans. The "no `vault.*` reference in TS/JS" rule (168-170) can stay. Also assert `ai_key_set|ai_key_delete|ai_key_secrets` appear nowhere in TS after the change.

**R-6. Ordering.**
- STK-082 merges before STK-083. STK-083's squash must then reproduce the new `ai_keys` shape and must not contain Vault, RLS, grants or the three functions.
- STK-083's recorded `pg_dump --schema-only` diff should list `ai_keys` as an intentional difference against Supabase: its old Vault-shaped column set is expected to differ from production. This avoids the diff reading as a faithful-squash failure.
- STK-083 deletes: the Vault stub, the 0200 and new migration files from the runner (kept as read-only reference), `supabase/rollback`, the `db:check` vault guards, and any remaining `ai_key_*` test references.
- Within STK-082, the KEEP list is the bootstrap Vault stub and the 0200 migration files. Deleting 0200 now would also break the interim chain for the still-Supabase-shaped test DB.

**R-7. Repo and keyring behaviour that the DB design depends on.**
- Upsert: `insert ... on conflict (provider) do update set ciphertext=excluded.ciphertext, iv=..., auth_tag=..., key_version=..., last4=..., updated_at=now() returning last4, updated_at`. Delete: `delete from ai_keys where provider=$1 returning provider`, boolean from the row count.
- AES-256-GCM: random 12-byte IV per encryption via `crypto.randomBytes`, 16-byte tag, AAD = provider. Consider AAD = provider plus `key_version` so a version cannot be silently rewritten. It is optional, but cheap.
- Plaintext must never be in SQL text: bound parameters only (as in ai-keys.ts:20-22).
- Fail-closed (ADR 0009 §3-6): no rows plus no master key means env fallback. Rows plus missing or wrong key, an unknown `key_version`, or a bad tag means `provider_unavailable`, with no env fallback.
- `key_version` is the rotation hook: `keyring` should accept a map version -> key for a later STK, with only version 1 now.
- Master key parsing: base64, exactly 32 bytes, validated lazily when first used by `saveAiKey` or `readAiKeySecrets` (never at import time), so apps and workers without AI usage still start. Save with an invalid or missing key must throw a DataError and never store plaintext.

### Risks

- **High.** A reviewer or Ming applies the new migration to the live Supabase project: the running release's RPC calls fail. R-2 mitigates it; the header and README must say so loudly.
- **Medium.** Dropping the table without repeating RLS and revoke silently exposes `ciphertext` to anon and authenticated in the interim Supabase shape (Finding 3). The privilege check must cover all four verbs.
- **Medium.** The empty-allowlist NULL pitfall (Finding 5) either fails every run or, if "fixed" carelessly, becomes a no-op check.
- **Medium.** The Vault cleanup is untested in db:check unless the seeded split (R-4 option 1) is done; a typo there would only show on a real Supabase project, where we will not run the migration.
- **Low.** The DB no longer enforces key format. Only the ciphertext-length guard remains, so `validateAiKeyFormat` in core is the single source of truth. The 0200 comment and `keys.ts:1` must be updated.
- **Low.** The down file loses stored keys and does not restore the Vault shape (accepted; see R-3).
- **Low.** One corrupt row can blind both providers if `readAiKeySecrets` decrypts all rows in one call (see open questions).

### Open questions

1. Rollback depth: minimal drop (recommended) or full-fidelity recreation of the Vault shape (R-3)?
2. Vault cleanup: seeded split in `db-check.sh` (R-4 option 1) or the cutover runbook only (option 2)?
3. On a decrypt failure for one provider, should `readAiKeySecrets` throw for all providers (the old all-or-nothing behaviour) or return per-provider failures so the other provider still works? ADR 0009 §5 says fail closed, which favours per-provider status. Needs a call in the plan.
4. Is the AAD exactly the provider string, or provider plus `key_version` (Recommendation R-7)? The ticket says provider.
5. Master key storage (ticket line 39): the deployment repo next to the DB password file, or a GitHub environment secret. From the DB side either works. Note that backups (`pg-backup`) contain only ciphertext, so the master key must not be stored in the same backup set; losing it means re-entering the keys on Settings, which the ticket already accepts.

Relevant paths:
- /home/user/stoktok/supabase/migrations/20261110000200_ai_keys.sql
- /home/user/stoktok/supabase/rollback/20261110000200_ai_keys.down.sql
- /home/user/stoktok/scripts/db-check.sh
- /home/user/stoktok/scripts/db-check/checks.sql
- /home/user/stoktok/scripts/db-check/bootstrap-roles.sql
- /home/user/stoktok/packages/db/src/repos/ai-keys.ts
- /home/user/stoktok/packages/db/src/pg/schema.ts
- /home/user/stoktok/packages/db/src/r3-guard.test.ts
- /home/user/stoktok/packages/db/test-db/ai-keys.test.ts
- /home/user/stoktok/packages/db/test-db/global-setup.ts
- /home/user/stoktok/packages/core/src/ai/keys.ts
