# STK-082 consult: software-architect

## Findings

**Current shape**
- F1. The handle is opaque. `createPgDb(env, profile)` already receives the env object (`packages/db/src/pg/client.ts:27-34`). It hides Kysely behind a non-enumerable `INTERNALS` closure (`client.ts:90-95`), and `kyselyOf` reads that closure only inside `pg/` (`pg/access.ts:17-21`). r3-guard `ACCESSOR` bans `kyselyOf`, the symbol, `getOwnPropertySymbols` and `Reflect.ownKeys` outside `pg/` and `test-db/` (`r3-guard.test.ts:192,223-226`). A keyring can therefore ride on the same closure with no change to any public signature.
- F2. The repo calls the Vault wrappers through `q()`: `ai_key_set` (`repos/ai-keys.ts:33-37`), `ai_key_delete` (`:49-54`) and `ai_key_secrets` (`:69-74`). `listAiKeyMeta` already reads the table directly (`:59-65`). Exports are at `index.ts:81-82`.
- F3. There are three callers and none of them change:
  - `apps/web/server/ai.ts:16`
  - `apps/worker/src/ai.ts:14`
  - `apps/web/server/ai-keys.ts:27,39,52`
  
  Fail-closed behaviour lives in `packages/ai`. `makeProviderResolver` lets a `readStored` rejection propagate (`packages/ai/src/keys.ts:34-46`). `AiClient` catches it, logs only `{event:'ai_key_read_failed', code:'key_read_failed'}` and returns `provider_unavailable` (`packages/ai/src/client.ts:119-125`). So a fail-closed path in the repo only has to **throw**.
- F4. `DataErrorCode` already includes `NOT_CONFIGURED` (`packages/db/src/errors.ts:3`). The web layer maps any save or delete failure to `AI_KEY_DB_ERROR` and logs only the code (`apps/web/server/ai-keys.ts:15-17,29-31`).
- F5. Bytea needs no work. OID 17 falls through to pg's default parser (`pg/types.ts:55-62`), so it arrives as a `Buffer`. `AiKeysTable` is still the Vault shape (`pg/schema.ts:215-221`).
- F6. Test harness: `createPgDb({ [DATABASE_URL_ENV]: url }, profile)` (`test-db/harness.ts:39`). Tests can pass the master key the same way. The unit test fakes the handle as `{} as PgDb` (`repos/ai-keys.test.ts:7`).
- F7. db:check:
  - The old migration aborts without Vault (`supabase/migrations/20261110000200_ai_keys.sql:6-11`). The Vault stub (`scripts/db-check/bootstrap-roles.sql:13-50`) must therefore **stay until STK-083 squashes the chain**.
  - These checks are Vault-specific: `checks.sql:695-700` (columns), `:703-716` (asserts service_role cannot write, which flips now), `:718-801` (SQL round trip and negatives through the wrappers), `:803-822`, `:824-832` (definer allowlist = the 3 wrappers), `:834-845` (Vault stub).
- F8. Deploy:
  - Web and worker read the **same** host env file (`deployment/apps/stoktok/compose.yml:25,49`). The worker is started by `run-job.sh:41-42` through the same compose file.
  - `deploy-stoktok.yml` already has a `stoktok` GitHub environment (`:49`) and a `secrets` step that writes that file from environment secrets with builtins only (`:153-208`). It sits in a 700 directory excluded from Time Machine (`:126-151`).
  - `scripts/check-deploy-env.sh:110-160` enforces the secret↔workflow mapping.
- F9. Deployment repo policy: the README scopes committed secrets to Postgres and backups. It says anyone who can read the repo can read them, including every app's `DEPLOY_REPO_TOKEN` (`deployment/README.md:31-33`). Committed items include the rclone crypt passwords for the offsite backups (`:42,147`). It also says explicitly: "App secrets that aren't Postgres stay where they were … written by each app's deploy workflow from its GitHub environment secrets (see deploy-stoktok.yml)" (`:45-47`). org-admin-api's "no GitHub secrets" applies only to its DB password (`deploy-org-admin-api.yml:17,91-101`).

## Recommendations

**K1. Where the keyring lives (Scope: keyring.ts).**
- Create `packages/db/src/keyring.ts`. It owns `export const AI_KEYS_MASTER_KEY_ENV = 'STOKTOK_AI_KEYS_MASTER_KEY'`, mirroring `DATABASE_URL_ENV` at `client.ts:9`, and it is the only importer of `createCipheriv`/`createDecipheriv` from `node:crypto`.
- API (no key bytes exposed):
  ```ts
  type KeyringState = 'ok' | 'absent' | 'invalid';
  interface AiKeyring { readonly state: KeyringState;
    seal(provider: AiProvider, plaintext: string): { ciphertext: Buffer; iv: Buffer; authTag: Buffer; keyVersion: number };
    open(provider: AiProvider, row: { ciphertext: Buffer; iv: Buffer; authTag: Buffer; keyVersion: number }): string; }
  export function createAiKeyring(env: Record<string, string | undefined>): AiKeyring  // never throws
  ```
- Key the env name and the key bytes only in the closure. Freeze the object, with no enumerable fields, `toJSON` or inspect output that carries the key.
- **Do not export it from `index.ts`.** Keep it off the public surface.

**K2. Reading the master key.**
- Read it in `createPgDb` (`client.ts:27`) from the env object that is passed in, never from `process.env` directly (keeps the pattern at `client.ts:32`). Parse it once per handle.
- Validate strictly, because `Buffer.from(s,'base64')` silently drops bad characters:
  - match `^[A-Za-z0-9+/]{43}=$`;
  - the decoded length must be 32;
  - re-encoding must equal the input;
  - optionally reject 32 zero bytes, to catch placeholders.
- Unset or empty → `absent`. Anything else that fails → `invalid`.
- **Never throw from `createPgDb` for this.** A bad AI key must not take down `getDb()` for the whole web app or every worker job.
- If the state is `invalid`, log once `{event:'ai_keyring_invalid'}` with no value. That tells Ming why AI is down, since `client.ts:123` hides the reason.
- Generate the key with `openssl rand -base64 32`.

**K3. `key_version`, rotation and AAD.**
- v1 has one master key: `CURRENT_KEY_VERSION = 1` in keyring.ts. The migration adds `check (key_version >= 1)`.
- `open()` fails for any `key_version` other than the current one. Do not try other keys.
- Rotation in v1 is a runbook in ADR 0011, not code. With only 2 rows that are cheap to re-enter:
  1. Delete the keys on Settings.
  2. Replace the GitHub secret and redeploy.
  3. Re-enter the keys.
  
  A real multi-key keyring is a follow-up: a `STOKTOK_AI_KEYS_MASTER_KEY_PREVIOUS` + version env, decrypt with old and write with new, plus a one-shot re-seal. The column is reserved for it. This avoids building a rotation framework now.
- **AAD:** the ticket says AAD = provider. I recommend widening it to `utf8("stoktok:ai_keys:v1|" + provider + "|" + key_version)`. This keeps the anti-swap property, adds domain separation, and binds the version column so that editing it cannot downgrade the row. Document the format as fixed per `key_version`.
- **Ciphertext layout:** 12-byte random IV per seal and a 16-byte tag. The migration checks are:
  - `octet_length(iv)=12`
  - `octet_length(auth_tag)=16`
  - `octet_length(ciphertext) between 20 and 256` (GCM preserves length; the format is ASCII)
  - the `last4` regex from `20261110000200_ai_keys.sql:16`
  - the provider list
  
  Random 96-bit nonces are fine at this write volume.
- **After `open()`:** require `validateAiKeyFormat(plain).ok` and `plain.slice(-4) === row.last4`. If either fails, throw `MAPPING` (fail closed). This keeps ADR 0009 §9 (`0009:17`).

**K4. Keeping the public functions unchanged (opaque handle).**
- In `client.ts:94`, return `{ kysely, keyring }` from the `INTERNALS` closure.
- Add `export function keyringOf(db: PgDb): AiKeyring` to `pg/access.ts`, next to `kyselyOf`. It needs the symbol, so it must live in `pg/` (the ACCESSOR guard).
- `repos/ai-keys.ts` is the only non-test caller of `keyringOf`. Signatures at `index.ts:81-82` stay unchanged.
- No cache of decrypted keys (ADR 0009 §4, `0009:12`). `readAiKeySecrets` still runs one select per `generate()`.

**K5. Fail-closed rules (AC "fail-closed rules kept", ADR 0009 §3–6, `0009:11-14`).**

| Function | Keyring state | Rows | Result |
|---|---|---|---|
| `readAiKeySecrets` | any | 0 | `{}` → env fallback |
| `readAiKeySecrets` | `absent` / `invalid` | ≥1 | throw `DataError('NOT_CONFIGURED', …, 'ai keyring unavailable')` → `provider_unavailable` |
| `readAiKeySecrets` | `ok` | ≥1, any row fails (tag, version, format, last4) | throw `MAPPING` for the **whole read**. Never return a partial map: the failed provider would silently fall back to env. |
| `saveAiKey` | not `ok` | – | throw `NOT_CONFIGURED` **before any query**. Plaintext is never written. |
| `saveAiKey` | `ok` | – | one `insert … on conflict (provider) do update … returning last4, updated_at`. The upsert is atomic, so the advisory lock at `20261110000200:45` is not needed. |
| `deleteAiKey`, `listAiKeyMeta` | any | – | work without a keyring. **Delete is the recovery path:** after a lost master key, Ming deletes on Settings and env fallback returns. State this in the ADR. |

- Every error has fixed text and no `cause` (keep `ai-keys.ts:19-23`). Node's GCM error must never be attached.

**K6. How web and worker get the key.**
- No app code changes: both already go through `createPgDb(process.env, …)` (`apps/web/server/db.ts:14`, `apps/worker/src/cli.ts:66`), and both containers share one `env_file` (F8). STK-084 adds one line to the host env file.
- Add `STOKTOK_AI_KEYS_MASTER_KEY=` (no value) to `.env.example`, after `:10`, with "32 bytes base64, server-only, optional: unset disables UI-saved keys".
- Update the comments that say "(Vault)" at `apps/web/server/ai.ts:15` and `apps/worker/src/ai.ts:13`.

**K7. r3-guard (`packages/db/src/r3-guard.test.ts`).**
- `:118-131`: keep the `readAiKeySecrets` allow-list as is and drop `ai_key_secrets` from the regex.
- `:133-143`: replace with "`ai_key_set|ai_key_delete|ai_key_secrets` appear in no TS/JS file".
- `:149-159`: regex becomes just `readAiKeySecrets`.
- `:167-171` (no `vault.*`): keep; it is free and still true.
- New guards:
  - (a) `STOKTOK_AI_KEYS_MASTER_KEY` appears only in `packages/db/src/keyring.ts` and `keyring.test.ts`. Tests use `AI_KEYS_MASTER_KEY_ENV`.
  - (b) `createDecipheriv|createCipheriv` appear only in `keyring.ts` (+test).
  - (c) `keyringOf` appears only in `pg/access.ts`, `repos/ai-keys.ts` and their tests and test-db.
  - (d) `keyring` is imported only by `pg/client.ts`, `pg/access.ts` and `repos/ai-keys.ts` (+tests), and is never re-exported from `index.ts`.
  - (e) `.env.example` has a `STOKTOK_AI_KEYS_MASTER_KEY=` line with an empty value.
  - Add a fixture test for each new regex, as at `:264-297`.
- `scripts/check-no-service-key-in-client.sh:8,14-18`: add the needle `STOKTOK_AI_KEYS_MASTER_KEY`, build with a random sentinel master key (`openssl rand -base64 32`), and grep `.next/static` for the sentinel value.

**K8. Migration, schema and checks (with database-optimizer).**
- Forward migration:
  - drop the 3 functions, then drop and recreate `ai_keys` (stored rows are discarded by design; keys are re-entered after STK-084);
  - leave `vault.*` untouched;
  - add a header comment "do not apply to the Supabase production DB" (see Risks).
- Grants follow the current chain until STK-083: `select, insert, update, delete` for the app role. This flips `checks.sql:708-711`.
- Update `pg/schema.ts:215-221`: `Buffer` for the three bytea columns and `number` for `key_version`.
- checks.sql:
  - new column assertions;
  - constraint negatives (bad iv/tag length, ciphertext length 19/257, `key_version 0`, bad last4, unknown provider);
  - "no `public.ai_key_%` function exists";
  - `security_definer_allowlist` expects `'{}'` (`:829`) and still fails on any new definer function;
  - delete `:718-822` and the Vault-direct check `:834-845` (the stub itself stays until STK-083).
- Crypto round trips move to test-db (`ai-keys.test.ts`, rewritten from the "remove in STK-082" cases) with three handles: a test key, no key, and a wrong key. Cases to cover:
  - round trip of both providers;
  - replace;
  - no rows with no key gives `{}`;
  - rows with no key gives `NOT_CONFIGURED`;
  - rows with the wrong key gives `MAPPING` and no partial result;
  - provider swap (copy the anthropic ciphertext into the google row) fails;
  - `key_version` edit fails;
  - delete works with no key;
  - the DB never contains the sentinel plaintext (`position(… in ciphertext)` and a whole-row text scan).
- Unit tests for keyring.ts cover: strict base64, wrong length, `absent` vs `invalid`, the AAD binding, and that no error text or JSON contains the sentinel or the master key (R8).

**K9. ADR 0011 "AI provider keys encrypted app-side (supersedes 0009)".** Also mark 0009 Superseded, and update ADR 0010 decision 8 (`0010:16`) and the CLAUDE.md Conventions line "Supabase Vault (ADR 0009)".
- **Context:** Vault does not exist on the shared `postgres:17`; there is one owner role and no PostgREST.
- **Decision:**
  - columns and their checks;
  - AES-256-GCM in Node, 12-byte IV, AAD format, `key_version` = 1;
  - master key env and format, read once per handle, `absent`/`invalid` states;
  - access path (`keyringOf` and the r3-guard rules);
  - no definer functions (allowlist empty).
- **Kept from 0009:** §3 precedence, §4 no cache, §5 fail closed with the K5 table, §6 format rule, §9 post-decrypt validation.
- **Threat model:**
  - Protected: plaintext and master key never reach Postgres, so the parameter-logging exposure (`0009:24`) is gone; DB dumps and pgAdmin and superuser access see only ciphertext; the "service key → RPC → plaintext" path (`0009:21`) is gone.
  - Not protected: a compromised web or worker process or host (`docker inspect` shows the env); anyone holding both the master key and a DB copy.
  - Replacing a key here does not revoke it at the provider.
- **Key custody (per Q1):** GitHub environment secret, a copy in Ming's password manager, never stored with the backups.
- **Rotation runbook** (K3) and the loss procedure (delete on Settings, env fallback).
- **Consequences:** keys must be re-entered after the cutover; the order is set the secret, deploy, re-enter.

**K10. Master key storage for deployment (open question): use a GitHub environment secret `STOKTOK_AI_KEYS_MASTER_KEY` in the `stoktok` environment, not a committed file.**
- **Option A (recommended): GitHub environment secret.**
  - The deployment repo's own rule puts non-Postgres app secrets there (`README.md:45-47`).
  - It is not readable by `DEPLOY_REPO_TOKEN` holders.
  - It plugs into the existing `secrets` step (`deploy-stoktok.yml:155-208`): required, format-checked with `^[A-Za-z0-9+/]{43}=$`, written with `printf`.
  - `check-deploy-env.sh` enforces the mapping.
  - Cost: GitHub secrets are write-only, so Ming must keep a copy in a password manager. Loss means re-entering the keys, which is tolerable.
- **Option B (rejected): commit it to `postgres/secrets/apps/stoktok.ai-master-key`.**
  - That repo already holds the DB password and the rclone crypt passwords that decrypt the offsite dumps (F9).
  - One read token would then yield ciphertext, master key and DB access. That is equivalent to storing plaintext and defeats the reason for envelope encryption.
- **Hybrid split for STK-084:** `STOKTOK_DATABASE_URL` is built from the committed password file (the ticket's standard). The master key comes from the environment secret. Both go into the same 600 env file, written in one step.

## Risks
- **Production-safety caveat (AC2):** if this migration is ever applied to the Supabase production DB, the running release's `ai_key_secrets` RPC disappears. Every AI call then fails closed (`provider_unavailable`), with no env fallback, because the RPC errors. The migration header and the PR should say "plain Postgres only, applied at the STK-084 cutover".
- **Real AI keys stay in Supabase Vault after the cutover** (Auth keeps that project alive). Add to the STK-084 runbook: call `ai_key_delete` for both providers on Supabase, or rotate the keys at Anthropic and Google.
- A lost or changed master key with rows present means AI is fully down until Ming deletes the keys on Settings. Mitigations: the one-time `ai_keyring_invalid` log, ADR text, and making the secret required in the deploy workflow.
- Container env is visible through `docker inspect` and `/proc` on the host. This is the same exposure as the DB URL and is accepted for a single-user host.
- The DB stub for Vault must survive until STK-083. If STK-083 lands first, the old migration breaks db:check (as already noted for STK-081 and STK-085).
- If `open()` returned a partial map, a failed provider would silently fall back to env, which violates ADR 0009 §5. The all-or-nothing rule in K5 must have a test.

## Open questions
1. (Ming) Do you confirm the GitHub environment secret plus a password-manager copy (K10 option A) over committing it to the deployment repo?
2. (Ming) Is the v1 rotation runbook (delete, swap, re-enter) acceptable, with a multi-key keyring as a follow-up?
3. (Planner) Widen the AAD to `stoktok:ai_keys:v1|provider|key_version` (recommended) or keep it as the bare provider per the ticket text?
4. (Planner, follow-up) Add a specific UI code for `NOT_CONFIGURED` on save (e.g. "Chưa cấu hình khóa mã hóa"), rather than the generic `AI_KEY_DB_ERROR` (`apps/web/server/ai-keys.ts:31`)? That touches core and web copy, so per R7 it belongs in a follow-up.
5. (database-optimizer) Grants and RLS on the new `ai_keys` in the pre-baseline chain: match the current service_role convention now and let STK-083 normalise it?

Key files:
- /home/user/stoktok/packages/db/src/repos/ai-keys.ts
- /home/user/stoktok/packages/db/src/pg/client.ts
- /home/user/stoktok/packages/db/src/pg/access.ts
- /home/user/stoktok/packages/db/src/r3-guard.test.ts
- /home/user/stoktok/scripts/db-check/checks.sql
- /home/user/stoktok/docs/adr/0009-ai-provider-keys-in-vault.md
- /home/user/deployment/README.md
- /home/user/deployment/.github/workflows/deploy-stoktok.yml
- /home/user/deployment/apps/stoktok/compose.yml
