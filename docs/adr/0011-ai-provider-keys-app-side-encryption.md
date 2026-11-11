# ADR 0011: AI provider keys encrypted app-side (STK-082, supersedes ADR 0009)

Status: accepted (2026-11-11, STK-082). Supersedes [ADR 0009](0009-ai-provider-keys-in-vault.md).

## Context
ADR 0009 stored the AI provider keys in Supabase Vault behind three `security definer` wrappers. The data layer moves to a self-hosted Postgres (ADR 0010), which has no Vault. pgcrypto is rejected (ADR 0010 section 8): the master key would appear in SQL text and logs. The keys are therefore encrypted in the app (`packages/db/src/keyring.ts`) and the database stores only ciphertext.

## Decision
1. **Table.** `public.ai_keys (provider pk, ciphertext bytea, iv bytea, auth_tag bytea, key_version smallint, last4 text, updated_at timestamptz)`. Checks: provider in (`anthropic`, `google`), ciphertext length 20 to 256 (GCM does not pad, so it equals the key length), iv 12 bytes, auth tag 16 bytes, `key_version >= 1` (no default), `last4` is 4 printable ASCII characters. The format of the key itself is checked by `validateAiKeyFormat` in core before sealing; the database cannot see it. RLS on, `service_role` has the four verbs, the rest is revoked (the interim Supabase-shaped model; STK-083 removes roles, grants and RLS from the baseline). There are no `security definer` functions any more, so the db:check allow-list is empty.
2. **Cipher.** AES-256-GCM, a random 12-byte IV per seal, a 16-byte tag. AAD is `utf8("stoktok:ai_keys:v1|" + provider + "|" + key_version)`. The AAD binds the provider (a row copied to the other provider fails) and the key version (editing the column cannot redirect a row). The format is fixed for `key_version = 1` and pinned by a unit test. Only `keyring.ts` calls `createCipheriv` / `createDecipheriv` (r3-guard).
3. **Master key.** `STOKTOK_AI_KEYS_MASTER_KEY`: exactly 32 bytes, canonical base64 (`^[A-Za-z0-9+/]{43}=$`, decode and re-encode equal, not all zero). The strict check rejects the leniency of `Buffer.from(..., 'base64')`. Server-only (R3), read from the passed env object only in `packages/db/src/pg/client.ts` and parsed once per handle. The keyring is `absent` (unset or empty), `invalid` (anything else) or `ok`. `createPgDb` never throws for it; an `invalid` key logs `{event: 'ai_keyring_invalid'}` once with no value. Key bytes live only in a closure; errors have fixed text and no cause.
4. **Access path.** The keyring sits on the handle's internals next to Kysely; `keyringOf(db)` in `pg/access.ts` is called only by `repos/ai-keys.ts` (and test-db). r3-guard enforces the env name, the cipher calls, `keyringOf` and the `keyring` imports, and that no TS/JS file references `ai_key_set`, `ai_key_delete`, `ai_key_secrets` or `vault.*`.
5. **Public functions unchanged.** `saveAiKey`, `deleteAiKey`, `listAiKeyMeta`, `readAiKeySecrets` keep their signatures. Save is an atomic upsert (no advisory lock). `deleteAiKey` and `listAiKeyMeta` need no keyring, so a lost master key can still be cleaned up on Settings.

## Kept from ADR 0009
- **Precedence** (section 3): UI key, then env key, then the provider is disabled.
- **No cache** (section 4): read on every `generate()`.
- **Fail closed** (section 5), now by state:

| Stored rows | Master key | Result |
|---|---|---|
| none | any | `{}`: env fallback |
| some | absent or invalid | `NOT_CONFIGURED`: `provider_unavailable`, no env fallback |
| some | wrong, or any row fails (tag, version, provider, format, last4) | `MAPPING`: `provider_unavailable` |

  `readAiKeySecrets` is all or nothing. A partial map would let the resolver fall back to the env key of the failed provider. Cost: one corrupt row disables both providers until it is deleted on Settings. Per-provider status needs a `packages/ai` signature change (follow-up).
- **Format rule** (section 6): 20 to 256 printable ASCII, no whitespace, no trimming. Errors never echo the key.
- **Empty or invalid decrypted secret** (section 9) fails closed. The decrypted key must also pass the format check and its last 4 characters must equal `last4`.

## Threat model
- Protected: the browser and client bundle (`check:service-key` scans for a sentinel master key), the database and its backups (ciphertext only), SQL text and database logs (key and plaintext are only bound `bytea` parameters).
- Not protected: a compromised web or worker process (it holds the master key and decrypts), anyone with both a database dump and the master key, the host env file.
- The master key is never stored in the database or next to its backups.
- Replacing or deleting a key does not revoke it at the provider.

## Key custody
The master key is a GitHub environment secret `STOKTOK_AI_KEYS_MASTER_KEY` in the `stoktok` environment, written to the host env file by the deploy workflow (STK-084), with a copy in Ming's password manager. It is never committed to the deployment repo. Generate it with `head -c 32 /dev/urandom | base64`.

## Rotation runbook (v1, manual)
1. Delete the stored keys on Settings (or accept that they are discarded).
2. Replace the `stoktok` environment secret (and the password manager copy).
3. Redeploy.
4. Re-enter the keys on Settings.
A multi-version keyring (previous key plus re-seal; `key_version` is reserved for it) is a follow-up.

## Loss procedure
If the master key is lost: delete the stored keys on Settings (delete needs no keyring); the env fallback returns. Then set a new key and re-enter the keys.

## Consequences
- After the cutover the keys are re-entered on Settings, in this order: set the secret, deploy, re-enter.
- Migration `20261111000100_ai_keys_app_encryption.sql` must **never** be applied to the live Supabase project: the running release still calls the Vault wrappers it drops. It refuses a database with a real Vault (guard on the db:check stub's schema comment). It exists for db:check, test:db and the STK-083 baseline.
- The Vault rows on Supabase (`stoktok_ai_key_%`) are cleaned in the STK-084 runbook (or the keys are rotated at the providers). The migration does not touch `vault.*`.
- The Vault stub in `scripts/db-check/bootstrap-roles.sql` stays until STK-083.
- Rolling back (`supabase/rollback/20261111000100_...down.sql`) drops `ai_keys` and does not restore the Vault shape.
- With the master key unset, keys saved on Settings are disabled: save fails with `NOT_CONFIGURED`, and env keys keep working.
