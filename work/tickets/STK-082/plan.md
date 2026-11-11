Status: READY

# Plan — STK-082: AI provider keys encrypted app-side, replacing Vault (STK-080 slice c)

## Spec summary
Ticket scope (ticket.md "Goal"):
> New forward migration (runs on db:check; becomes part of the STK-083 baseline): `ai_keys(provider pk, ciphertext bytea, iv bytea, auth_tag bytea, key_version smallint, last4, updated_at)` with the format/last4 checks. Drop `ai_key_set/delete/secrets`. AES-256-GCM in `packages/db` (`keyring.ts`, AAD = provider) with master key `STOKTOK_AI_KEYS_MASTER_KEY` (32 bytes base64, server-only). Public functions unchanged via `keyring` on the handle. Fail-closed rules from ADR 0009 §3–6 kept: no stored rows and no key → env fallback; rows but a missing or wrong key → `provider_unavailable`. ADR 0011 supersedes 0009. checks.sql ai_key sections rewritten (definer allowlist empty). r3-guard rewritten (decrypt only in keyring/repo). Deploy plumbing for the master key goes to STK-084.

> **Release rule:** STK-081 to STK-083 merge to main but no stoktok release is cut until STK-084; production stays on the current Supabase-backed release until the cutover.

Ming, 2026-11-11 (after consults):
> (1) the AI master key is a GitHub environment secret `STOKTOK_AI_KEYS_MASTER_KEY` in the `stoktok` environment (written to the host env file by the deploy workflow in STK-084), with a copy in Ming's password manager; never committed to the deployment repo. (2) Rotation in v1 is a manual runbook in ADR 0011 (delete keys on Settings → swap secret → redeploy → re-enter); a multi-version keyring is a follow-up.

Orchestrator note:
> both consults agree the new migration must NEVER be applied to the live Supabase project (the running release still calls the Vault RPCs); the Vault cleanup on Supabase belongs to the STK-084 runbook. The Vault stub in db:check stays until STK-083.

ADR 0009 rules kept (§3 precedence, §4 no cache, §5 fail closed, §6 format rule, §9 empty/invalid decrypted secret fails closed). ADR 0010 §6: `STOKTOK_AI_KEYS_MASTER_KEY` is "server-only (R3), read from a passed env object, referenced only in `packages/db/src/pg/client.ts` (r3-guard)". ADR 0010 §8: "pgcrypto is rejected because the key would appear in SQL text and logs." CLAUDE.md R3, R8.

## Decisions on the open choices
| Choice | Decision | Why |
|---|---|---|
| AAD format | `utf8("stoktok:ai_keys:v1|" + provider + "|" + key_version)` | A strict superset of "AAD = provider": the provider-swap protection the ticket asks for is kept, and the AAD also binds `key_version`, so editing that column cannot redirect a row to another key later. The prefix gives domain separation. It costs nothing. The format is fixed for `key_version = 1` and documented in ADR 0011, and a unit test pins it. |
| `readAiKeySecrets` failure mode | **All or nothing.** Any row that fails (tag, version, provider, format, last4) throws `DataError` `MAPPING` for the whole read. It never returns a partial map. | The public signature `Promise<StoredAiKeySecrets>` must not change (ticket: "Public functions unchanged"). It cannot express "provider X failed". If a failed provider were simply left out of the map, `makeProviderResolver` would fall back to that provider's env key, which is the silent fallback that ADR 0009 §5 forbids. Cost: one corrupt row disables both providers until Ming deletes it on Settings (delete never needs the keyring). Per-provider status is a follow-up because it needs a signature change in `packages/ai`. |
| Rollback depth | **Minimal**: `drop table if exists public.ai_keys;` | It keeps db:check's "0 tables after rollback" invariant, and 0200.down then does nothing (it is fully guarded). A full rebuild of the Vault shape would be about 90 duplicated lines. They would only serve a release that never gets this migration, and the plaintext needed to refill Vault is gone. STK-083 deletes `supabase/rollback` anyway. |
| Vault cleanup: seeded db:check test or runbook only | **Runbook only (STK-084).** The migration does not touch `vault.*`. | The migration is applied only where Vault is the plaintext db:check stub or absent (db:check, test:db, the STK-083 baseline source, the shared postgres:17). A Vault delete there would be dead code against a stub, and it would need a split apply loop in `db-check.sh`, which STK-083 rewrites. Instead the migration gets a **guard that refuses to run on a real Vault**, so it cannot be applied to the Supabase project by mistake (AC2). A test-db test covers the guard. The real cleanup (`delete from vault.secrets where name like 'stoktok\_ai\_key\_%'`, or rotating the keys at the providers) goes to the STK-084 runbook (follow-up F1). |
| Where the env name lives | `AI_KEYS_MASTER_KEY_ENV` is in `pg/client.ts`, next to `DATABASE_URL_ENV`. `keyring.ts` receives the raw string and knows no env names. | This matches ADR 0010 §6 word for word ("referenced only in packages/db/src/pg/client.ts") and the existing r3-guard pattern for `STOKTOK_DATABASE_URL`. |
| When the master key is parsed | Once, inside `createPgDb`. It never throws. | The parse is pure and cheap. A bad AI key must not stop `getDb()` or the worker jobs (architect K2). This is equivalent to the DBA's "lazy" goal: apps without AI still start. |

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | New forward migration `ai_keys(provider pk, ciphertext bytea, iv bytea, auth_tag bytea, key_version smallint, last4, updated_at)` with format/last4 checks | `pnpm db:check` is green. The `ai_keys_columns` and `ai_keys_constraints` checks pass on both runs (before and after rollback/re-apply). Read `supabase/migrations/20261111000100_ai_keys_app_encryption.sql`. |
| 2 | `ai_key_set/delete/secrets` dropped | db:check `ai_key_functions_gone`. r3-guard `the dropped Vault wrappers appear in no TS/JS file`. |
| 3 | AES-256-GCM in `packages/db/src/keyring.ts`, AAD binds the provider, master key `STOKTOK_AI_KEYS_MASTER_KEY` 32 bytes base64, server-only | `keyring.test.ts` (all cases below). r3-guard tests for the env name, cipher calls and keyring importers. `pnpm check:service-key` (sentinel master key absent from `.next/static`). |
| 4 | Public functions unchanged (`saveAiKey`, `deleteAiKey`, `listAiKeyMeta`, `readAiKeySecrets`, types) via keyring on the handle | `git diff packages/db/src/index.ts` is empty. `apps/web/server/ai-keys.ts`, `apps/web/server/ai.ts` and `apps/worker/src/ai.ts` have no code changes (comments only). `pnpm typecheck` is green. |
| 5 | Fail closed: no rows + no key → `{}` (env fallback). Rows + missing/invalid/wrong key → rejection (→ `provider_unavailable`). Never a partial map. | test-db `ai-keys.test.ts`: `no rows, no key → {}`, `rows + no key → NOT_CONFIGURED`, `rows + invalid key → NOT_CONFIGURED`, `rows + wrong key → MAPPING, no partial result`, `one tampered row → whole read rejects`. The existing `packages/ai` tests prove a rejection → `provider_unavailable` (unchanged). |
| 6 | Save without a usable keyring never writes | test-db `saveAiKey with no / invalid master key → NOT_CONFIGURED and the table stays empty`. |
| 7 | ADR 0011 supersedes 0009 | `docs/adr/0011-ai-provider-keys-app-side-encryption.md` exists with the sections listed under Files. The ADR 0009 status line says it is superseded. ADR 0010 §6/§8, spec §7 line, CLAUDE.md Conventions line and `supabase/README.md` no longer describe Vault as current. |
| 8 | checks.sql ai_key sections rewritten; definer allowlist empty | `pnpm db:check` green. Read checks.sql: the Vault round trip, negatives and stub checks are gone, and `security_definer_allowlist` uses the NULL-safe "no definer function exists" form. |
| 9 | r3-guard rewritten (decrypt only in keyring/repo) | `pnpm test` (packages/db `r3-guard.test.ts`), including the new fixture test. |
| 10 | Production keeps working (no release, nothing changes the running release) | The diff touches no `.github/`, Dockerfile, compose or deploy file. The migration header says "never apply to Supabase". test-db `migration refuses a database with a real (non-stub) Vault` passes. |
| 11 | `typecheck`, `lint`, `test`, `test:db`, `db:check` green; changed `packages/db` logic has tests | Run all five. `pnpm check:service-key` also passes. |

## Ming verification after merge
None in this ticket: there is no release until STK-084, and the master key is set during the cutover. The STK-084 items are listed as follow-ups F1–F3.

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `supabase/migrations/20261111000100_ai_keys_app_encryption.sql` | **Create.** Header (ADR 0011; NEVER apply to Supabase; stored keys discarded on purpose; RLS/grants are the interim Supabase shape removed by STK-083). (1) Guard: `if to_regnamespace('vault') is not null and obj_description(to_regnamespace('vault')::oid, 'pg_namespace') is distinct from 'stoktok db:check vault stub' then raise exception 'refusing to apply on a database with Supabase Vault (ADR 0011)'`. (2) `drop function if exists` for the 3 wrappers (exact signatures). (3) `drop table if exists public.ai_keys`. (4) `create table public.ai_keys` with the columns and checks from DBA R-1: provider in ('anthropic','google'); `octet_length(ciphertext) between 20 and 256`; iv = 12; auth_tag = 16; `key_version smallint not null check (key_version >= 1)` with no default; `last4 ~ '^[\x21-\x7e]{4}$'`; `updated_at timestamptz not null default now()`. (5) `comment on table`. (6) `enable row level security`, `revoke all … from public, anon, authenticated, service_role`, `grant select, insert, update, delete … to service_role`. No `vault.*` writes. | Scope: migration, drop the wrappers. AC2 guard. |
| `supabase/rollback/20261111000100_ai_keys_app_encryption.down.sql` | **Create.** `drop table if exists public.ai_keys;` with a header: it deletes stored keys and does not restore the Vault shape. | db:check applies every down file. |
| `packages/db/src/keyring.ts` | **Create.** Pure AES-256-GCM keyring (API under Approach). The only file that calls `createCipheriv`/`createDecipheriv`. Not exported from any barrel. | Scope: keyring.ts. |
| `packages/db/src/keyring.test.ts` | **Create.** Unit tests (below). | R8. |
| `packages/db/src/pg/client.ts` | Add `export const AI_KEYS_MASTER_KEY_ENV = 'STOKTOK_AI_KEYS_MASTER_KEY'`. Build `createAiKeyring(env[AI_KEYS_MASTER_KEY_ENV])`. If the state is `invalid`, `console.error(JSON.stringify({ event: 'ai_keyring_invalid' }))` once, with no value. `INTERNALS` returns `{ kysely, keyring }`. No new throw. | Scope: master key on the handle; ADR 0010 §6. |
| `packages/db/src/pg/client.test.ts` | Add cases (below). | R8. |
| `packages/db/src/pg/access.ts` | Widen the internals type to `{ kysely; keyring }`. Add `export function keyringOf(db: PgDb): AiKeyring` (same "not a PgDb handle" check as `kyselyOf`). | The repo needs the keyring and must stay outside `pg/`. |
| `packages/db/src/pg/schema.ts` | `AiKeysTable`: `provider: string; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; key_version: number; last4: string; updated_at: TsDef`. Fix the doc comment. | Mirrors the migration (schema.ts header rule). |
| `packages/db/src/repos/ai-keys.ts` | Rewrite the bodies; signatures and exports unchanged (behaviour under Approach). Remove `AI_KEY_MAP` (no 22023 source is left). | Scope. |
| `packages/db/src/repos/ai-keys.test.ts` | Keep the 2 existing cases. Add: `listAiKeyMeta`/`deleteAiKey` keep their signatures (type-level smoke test, optional). No `createPgDb` here (r3-guard). | R8. |
| `packages/db/test-db/ai-keys.test.ts` | **Rewrite**: drop the "remove in STK-082" header and the `create or replace function ai_key_set` hack; add the cases below. | R8, scope. |
| `packages/db/test-db/repos-ended-handle.test.ts` | Comment on line 8 only: "keeps the Vault allow-list narrow" → "keeps the decrypt allow-list narrow". | Stale text. |
| `packages/db/src/r3-guard.test.ts` | Rewrite the AI-key guards (below). | Scope: r3-guard rewritten. |
| `scripts/db-check/checks.sql` | Rewrite lines 695–846 (below). | Scope. |
| `scripts/db-check/bootstrap-roles.sql` | Comment only on the Vault stub: "kept only so 20261110000200 applies; delete with the supabase/ chain in STK-083; also the marker the 20261111000100 guard accepts". | DBA R-4; the stub stays. |
| `scripts/check-no-service-key-in-client.sh` | Add the needle `STOKTOK_AI_KEYS_MASTER_KEY`. Build with a random sentinel master key (`node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"`), pass it as `STOKTOK_AI_KEYS_MASTER_KEY=…` to the build and add it to `NEEDLES`. | R3, architect K7. |
| `.env.example` | After line 10: `STOKTOK_AI_KEYS_MASTER_KEY=          # 32 bytes base64 (head -c 32 /dev/urandom \| base64); server-only (R3); optional: unset disables keys saved on Settings (ADR 0011)` | R3 / Conventions. |
| `docs/adr/0011-ai-provider-keys-app-side-encryption.md` | **Create.** Context; Decision (columns and checks; AES-256-GCM, 12-byte random IV, 16-byte tag, AAD format, `key_version = 1`; master key env, format and strict validation, `absent`/`invalid` states, read once per handle; access path `keyringOf` plus the r3-guard rules; no definer functions); Kept from 0009 (§3, §4, §5 with the fail-closed table, §6, §9); Threat model (architect K9); Key custody (GitHub environment secret `stoktok`, a copy in the password manager, never committed, never next to backups); Rotation runbook (delete on Settings → replace secret → redeploy → re-enter); Loss procedure (delete on Settings → env fallback returns); Consequences (keys re-entered after cutover in the order secret, deploy, re-enter; the migration must never be applied to Supabase, with the guard; Vault rows on Supabase cleaned in the STK-084 runbook; one corrupt row disables both providers until deleted). | Scope: ADR 0011. |
| `docs/adr/0009-ai-provider-keys-in-vault.md` | Status line only: "Superseded by ADR 0011 (2026-11-11, STK-082)". | Scope. |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | §8: "implemented in STK-082 (ADR 0011)". §6: append that the master key is written to the host env file from the `stoktok` GitHub environment secret (STK-084), not from the deployment repo. | Keep docs consistent with Ming's Q1 answer. |
| `docs/spec-v1.md` | Line 214 only: Vault → "stored encrypted app-side (AES-256-GCM, master key server-only; ADR 0011)". | Spec mentions Vault as current (CLAUDE.md: the spec is the source of truth; ADR 0009 also updated it). |
| `CLAUDE.md` | Conventions line 128 only: "Supabase Vault (ADR 0009)" → "the `ai_keys` table, encrypted app-side (ADR 0011)". Ming sees it in the PR. | Same reason. |
| `supabase/README.md` | Replace the "Vault" section: 20261110000200 still needs Vault/the stub; 20261111000100 replaces it, is **never applied to the Supabase project**, refuses a real Vault, and exists for db:check/test:db and the STK-083 baseline. | DBA R-2. |
| `packages/core/src/ai/keys.ts` | Line 1 comment only: the DB no longer checks the format (only the ciphertext length 20–256); `validateAiKeyFormat` is the single source. | DBA Finding 1. Comment only, no logic change. |
| `apps/web/server/ai.ts`, `apps/worker/src/ai.ts` | Comment only: "UI-saved keys (Vault)" → "UI-saved keys (encrypted in ai_keys, ADR 0011)". | The comments would be false. |

Do **not** edit `supabase/migrations/20261110000200_ai_keys.sql` (already applied in production; STK-083 squashes it) or its rollback.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `keyring.test.ts › parses a canonical 32-byte base64 key as ok` | `^[A-Za-z0-9+/]{43}=$` + decode = 32 bytes + re-encode equals the input |
| `› undefined and '' are absent` | absent state |
| `› invalid: 24-byte key, 48-byte key, base64url chars (- _), trailing newline/space, missing '=', non-canonical last char, 32 zero bytes, 'not-base64'` | strict validation; `Buffer.from` leniency |
| `› seal/open round trip for anthropic and google; keyVersion 1; iv 12 bytes, tag 16 bytes, ciphertext length = plaintext length` | GCM layout matches the DB checks |
| `› two seals of the same plaintext differ in iv and ciphertext` | random IV per seal |
| `› open with the other provider throws (AAD binds provider)` | anti-swap |
| `› open with keyVersion 2 throws; opening a v1 row whose keyVersion was changed throws` | version binding, single key version |
| `› flipped byte in ciphertext / iv / authTag throws; a different master key throws` | integrity |
| `› AAD format is pinned: raw node:crypto decrypt with AAD 'stoktok:ai_keys:v1|google|1' succeeds` | documented format |
| `› seal/open on an absent or invalid keyring throw a fixed error` | state guard |
| `› no leak: error message, String(e), JSON.stringify(e) contain neither the master key (base64 or hex) nor the plaintext; e.cause is undefined` | R3/R8, no Node GCM error attached |
| `› keyring object is frozen; JSON.stringify and inspect(showHidden, depth Infinity) show neither the master key nor its hex` | opaque |
| `client.test.ts › createPgDb does not throw for an invalid master key and logs {event:'ai_keyring_invalid'} once, with no value` | K2 |
| `client.test.ts › with a master key set, inspect(showHidden)/JSON of the handle do not contain it; Object.keys still ['end','stats']` | opaque handle |
| `client.test.ts › no log when the master key is absent or valid` | log only for invalid |
| `test-db/ai-keys.test.ts › round trip: save both providers with key K1, list shows last4/updatedAt and no secret, read decrypts both; replace updates last4, iv and updated_at; delete true then false` | happy path |
| `› stored row never contains the plaintext: position(convert_to(key,'UTF8') in ciphertext)=0 and the row text has neither the key nor its hex` | encryption at rest |
| `› saving the same key twice gives a different iv and ciphertext` | IV per save |
| `› no rows + no master key → readAiKeySecrets returns {}` | env fallback |
| `› rows + no master key → NOT_CONFIGURED; rows + invalid master key → NOT_CONFIGURED` | fail closed |
| `› rows + wrong master key (K2) → MAPPING, no result` | fail closed |
| `› provider swap (copy the anthropic ciphertext/iv/tag into the google row via SQL) → whole read rejects MAPPING (no partial map)` | AAD and all-or-nothing |
| `› key_version set to 2 via SQL → whole read rejects` | version binding |
| `› last4 edited via SQL so it no longer matches the decrypted key → MAPPING` | ADR 0009 §9 kept |
| `› saveAiKey with no / invalid master key → NOT_CONFIGURED and select count(*) from ai_keys = 0` | no plaintext write |
| `› deleteAiKey and listAiKeyMeta work on a handle with no master key` | recovery path |
| `› two parallel saveAiKey for one provider leave exactly one row that decrypts to one of the two keys` | atomic upsert, no advisory lock |
| `› a DB constraint violation on save (temporary check (false) on ai_keys in its own freshDb) → VALIDATION 23514; message/JSON/String contain neither key nor last4; no cause` | replaces the 22023 hack |
| `› ended handle: all four functions reject DataError DB_ERROR` (keep; readAiKeySecrets on an ended keyed handle too) | existing |
| `› migration refuses a database with a real Vault: in a freshDb, comment on schema vault is 'x', run the 20261111000100 file text in begin…rollback via pg.Client → error message contains 'refusing'; ai_keys is unchanged` | AC2 guard |
| `r3-guard.test.ts` (see Approach step 7) | guards plus fixtures |
| `checks.sql` blocks (see Approach step 6) | DB shape |

## Approach
1. **Migration and rollback** as in Files. Check the drop order: functions, then table, then create. A single transaction comes from `db-check.sh --single-transaction` and `global-setup.ts`.
2. **keyring.ts** (pure, no I/O, no env):
   ```ts
   export type KeyringState = 'ok' | 'absent' | 'invalid';
   export const CURRENT_KEY_VERSION = 1;
   export interface SealedAiKey { ciphertext: Buffer; iv: Buffer; authTag: Buffer; keyVersion: number }
   export interface AiKeyring { readonly state: KeyringState; seal(provider: AiProvider, plaintext: string): SealedAiKey; open(provider: AiProvider, row: SealedAiKey): string }
   export function createAiKeyring(raw: string | undefined): AiKeyring // never throws
   ```
   - The key bytes are held only in the closure. The result is `Object.freeze`d, `state` is the only data property, and there is no `toJSON` or custom inspect that could reveal the key.
   - `seal`: `randomBytes(12)`, `aes-256-gcm`, `setAAD`, 16-byte tag.
   - `open`: rejects `keyVersion !== CURRENT_KEY_VERSION`, and rejects iv/tag of the wrong length before decrypting.
   - Every failure throws `new Error('ai keyring: <fixed reason>')` with no cause (`// eslint-disable-next-line preserve-caught-error` as in `client.ts:73`).
3. **client.ts / access.ts** as in Files.
4. **Repo** (`repos/ai-keys.ts`):
   - `saveAiKey`:
     1. `assertProvider`, then format check (VALIDATION; existing order).
     2. `keyringOf(db)`. If the state is not `ok`, throw `DataError('NOT_CONFIGURED', 'ai_keys', 'set', 'ai keyring unavailable')` before any query.
     3. `seal` outside `q()`.
     4. `q()`: `insertInto('ai_keys').values({...}).onConflict(provider).doUpdateSet({ciphertext, iv, auth_tag, key_version, last4, updated_at: sql\`now()\`}).returning(['last4','updated_at'])`.
     5. Map the result as today (MAPPING on a bad row).
   - `deleteAiKey`: `deleteFrom('ai_keys').where('provider','=',provider).returning('provider')`, then `length > 0`. It needs no keyring.
   - `listAiKeyMeta`: unchanged.
   - `readAiKeySecrets`:
     1. `q()` selects `provider, ciphertext, iv, auth_tag, key_version, last4`.
     2. 0 rows → `{}`.
     3. Otherwise, if the keyring state is not `ok` → NOT_CONFIGURED.
     4. Otherwise, for each row **outside `q()`** (so a crypto error is never turned into DB_ERROR): provider check; `Buffer.isBuffer` checks; `open` inside try/catch → `DataError('MAPPING', …, 'row mapping failed (secret)')` with no cause; then `validateAiKeyFormat(plain).ok` and `plain.slice(-4) === row.last4`, else MAPPING.
     5. Any failure throws, so the result is all or nothing. No cache (ADR 0009 §4). Update the module comment: the upsert is atomic, so no advisory lock is needed.
5. **No app code changes**: web and worker already call `createPgDb(process.env, …)` and share one env file (architect F8/K6).
6. **checks.sql** (DBA R-4):
   - `ai_keys_columns`: provider text, ciphertext/iv/auth_tag bytea, key_version smallint, last4 text, updated_at timestamptz, all NOT NULL; assert that `secret_id` is absent.
   - `ai_keys_privileges`: service_role has select/insert/update/delete; anon/authenticated have none of the four; `relrowsecurity` is true.
   - `ai_keys_constraints`: run as `set local role service_role`, with `decode(repeat('00',n),'hex')` (no pgcrypto). Valid rows at ciphertext length 20 and 256. 23514 for provider 'openai', ciphertext 19/257, iv 11/13, tag 15/17, key_version 0, last4 of 3 chars, 5 chars, with a space, and 'é…'. 23502 for each NULL column. 23505 for a duplicate provider. An upsert `on conflict (provider) do update` leaves one row. `reset role` and delete the rows at the end.
   - `ai_key_functions_gone`: no `pg_proc` in `public` named `ai_key_set|ai_key_delete|ai_key_secrets`.
   - `security_definer_allowlist`: `if exists (select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef) then raise …` (NULL-safe, DBA Finding 5).
   - Delete the old round trip, negatives, functions_locked and `ai_key_vault_direct_denied` blocks.
   - The existing global blocks (`rls_enabled_all_tables`, `no_grants_anon_authenticated_public`, `tables_exist`) must stay green.
7. **r3-guard.test.ts**:
   - (a) `/\breadAiKeySecrets\b/` keeps the current allow-list (rename the test, drop `ai_key_secrets` from it).
   - (b) Replace the write-wrapper test: `/\bai_key_(?:set|delete|secrets)\b/` appears in no TS/JS file. **The word boundary is needed**: `apps/web/server/ai-keys.ts` logs `ai_key_delete_failed`. Fixture: matches `public.ai_key_set(`, does not match `ai_key_delete_failed`.
   - (c) The settings test regex becomes `/readAiKeySecrets/`.
   - (d) Keep the `vault.*` test.
   - (e) `STOKTOK_AI_KEYS_MASTER_KEY` appears only in `packages/db/src/pg/client.ts` and `client.test.ts`.
   - (f) `/\bcreate(?:Dec|C)ipheriv\b/` appears only in `packages/db/src/keyring.ts` and `keyring.test.ts`.
   - (g) `keyringOf` appears only in `packages/db/src/pg/access.ts`, `packages/db/src/repos/ai-keys.ts` and files under `packages/db/test-db/`.
   - (h) An import of a `keyring` module (`/['"](?:\.\.?\/)+keyring['"]/`) appears only in `pg/client.ts`, `pg/access.ts`, `repos/ai-keys.ts`, `keyring.test.ts` and `test-db/`; `packages/db/src/index.ts` and `pg/index.ts` never mention `keyring`.
   - (i) `.env.example` matches `/^STOKTOK_AI_KEYS_MASTER_KEY=\s*(#.*)?$/m`.
   - Add a fixture test for each new regex, as at lines 264–297.
8. **Docs** as in Files.

Rules:
- **R2**: no money here.
- **R3**:
  - The master key is read from the passed env object only in `client.ts`.
  - It is never in `NEXT_PUBLIC_*`.
  - check:service-key scans for the sentinel.
  - Plaintext and master key never reach SQL text (bound Buffer parameters; pgcrypto rejected, ADR 0010 §8).
  - Errors carry no cause.
- **R6**: unchanged; the callers still sit behind `requireUser()`.
- **R7**: only the files listed.
- **R8**: tests above.
- **R10**: unaffected.

## Specialist input used
- **software-architect:**
  - Adopted: K1 (keyring API, not exported), K2 (strict validation, never throw, one-time `ai_keyring_invalid` log), K3 (single version, runbook rotation, widened AAD, post-decrypt format + last4 check), K4 (`keyringOf` in `pg/access.ts`, INTERNALS returns `{kysely, keyring}`), K5 (fail-closed table; all or nothing), K6 (no app code changes, `.env.example`, comments), K7 (r3-guard set; check:service-key), K8 (migration/checks/test-db cases), K9 (ADR 0011 content).
  - Changed: the env-name constant lives in `pg/client.ts`, not `keyring.ts` (ADR 0010 §6 already says client.ts; keyring stays env-free).
  - K10 is settled by Ming (GitHub environment secret) and only recorded in ADR 0011; the plumbing is STK-084.
  - Q4 (UI code for NOT_CONFIGURED) goes to follow-up F4 (R7). Q5: interim service_role grants, normalised by STK-083.
- **database-optimizer:**
  - Adopted: Finding 2 (Vault stub stays), Finding 3 (repeat RLS/revoke after recreate; privilege check covers all four verbs), Finding 4 (flip to direct writes), Finding 5 (NULL-safe allowlist), R-1 table shape and file name, R-2 (never on Supabase, made enforceable with a guard), R-3 minimal rollback, R-4 checks, R-5 test-db cases, R-6 ordering, R-7 repo shape.
  - Rejected:
    - R-1 step 1 Vault delete in the migration and R-4 option 1 seeded split. Runbook only, plus a refuse-on-real-Vault guard; reason in Decisions.
    - Editing the 0200 header comment: never edit an applied migration; only the core comment is updated.
    - R-7 "keyring accepts a version→key map now": Ming chose single-key v1; the column is reserved for it.
  - Open question 3 decided against per-provider status (see Decisions).

## Assumptions
- **AAD widening** relative to the ticket's literal "AAD = provider" is accepted: the orchestrator listed it as the planner's choice, and it keeps the provider binding.
- **No migration of existing keys**: the table is dropped and recreated (ticket: "AI keys are re-entered on Settings after it").
- **The Supabase Vault schema comment** is not `'stoktok db:check vault stub'`, so the guard raises there. If Supabase's vault schema were somehow absent, 0200 could never have applied in production, so the project has Vault.
- **Interim grants**: `select, insert, update, delete` to `service_role` plus RLS keep the db:check role model valid until STK-083 removes roles, grants and RLS from the baseline.
- **Hotspots / rebase**:
  - `packages/db/src/pg/client.ts`, `pg/access.ts` and `r3-guard.test.ts` were edited by STK-081 and STK-085 (both `DONE`). If they are not yet merged when this branch is cut, expect a rebase.
  - STK-083 (BACKLOG) rewrites `checks.sql`, `db-check.sh`, `bootstrap-roles.sql` and squashes migrations. It must run after this ticket and reproduce the new `ai_keys` shape without the Vault guard, RLS or grants (DBA R-6).
  - `src/App.tsx` is not relevant (stoktok).
- `test:db` connects as the superuser from `DB_TEST_URL`, so grants are not exercised there; db:check covers them.

## Follow-ups (not in this diff)
- **F1 (STK-084 runbook):**
  - Generate the key (`head -c 32 /dev/urandom | base64`).
  - Set the `stoktok` environment secret and keep a copy in the password manager.
  - Wire the deploy workflow and `check-deploy-env.sh` (required, format `^[A-Za-z0-9+/]{43}=$`).
  - After cutover: delete `stoktok_ai_key_%` rows from Supabase Vault (or rotate the keys at Anthropic/Google), then re-enter the keys on Settings.
- **F2 (STK-083):** the baseline reproduces `ai_keys`, drops the Vault stub and the guard, and lists `ai_keys` as an intentional difference from Supabase in the schema diff.
- **F3 (STK-084):** confirm `ai_keyring_invalid` never appears in the logs after cutover.
- **F4:** a specific Settings error code for `NOT_CONFIGURED` on save (for example "Chưa cấu hình khóa mã hóa") instead of `AI_KEY_DB_ERROR`.
- **F5:** per-provider read status (a corrupt row should disable only its own provider). Needs a `packages/ai` signature change.
- **F6:** a multi-version keyring (`…_PREVIOUS` key, re-seal) when rotation is needed (Ming Q2).

## Blocking questions
None.

## Split proposal
None. Estimate: about 350 lines of production code and SQL (keyring ~110, repo ~90, client/access ~20, migration and rollback ~45, checks.sql net about −60), plus about 450 lines of tests and docs. That is over the ~400 guide only because of tests and docs. The ticket cannot be split further without a broken intermediate state: the migration, the schema type and the repo must change together, or test:db and db:check fail.
