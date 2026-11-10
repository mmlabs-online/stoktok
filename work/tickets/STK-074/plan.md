Status: READY

# Plan — STK-074 (slice a): AI keys in Supabase Vault — storage, resolver, wiring, rule docs

> This plan covers **slice (a) only**: storage and key resolution. The Settings "Khóa AI" card and its server actions are slice (b), described under `## Split proposal`. ACs 1 and 3 are deferred to slice (b) and must not be implemented here (R7).

## Spec summary
- Ticket goal: "Let Ming enter the Anthropic and Google AI API keys on the Settings screen, store them encrypted in Supabase Vault, and have the server-side AI client use them (falling back to the STK-072 env keys), without a key ever reaching the browser or the logs."
- Spec §7 (line 214), **which this ticket changes by Ming's decision (2026-11-10)**: "Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo."
- CLAUDE.md Conventions: "Secrets: only in `.env.local` (git-ignored) and the deploy repo." This is also changed by Ming's decision.
- CLAUDE.md R3: "Service role key is server-only. Used by Next.js server code and `apps/worker` only. … The browser never talks to the DB directly."
- Ticket notes, Ming 2026-11-10: "(2) Storage = Supabase Vault (encrypted, service_role only, decrypted only on the server). (3) Precedence = UI key first, STK-072 env keys as fallback."

## Acceptance criteria → verification
| # | Criterion (ticket) | How the reviewer verifies it |
|---|---|---|
| 1 | Settings "Khoá AI" card: paste/save/replace/delete; show only last 4 + date | **Slice (b), not in this plan.** This slice only provides `listAiKeyMeta` / `saveAiKey` / `deleteAiKey` (repo-tested), which return last4 and date and never the key. |
| 2 | Keys in Vault, service_role only; anon/authenticated have no access to secrets or helper functions; migration + rollback + db:check cases | `pnpm db:check` passes, with the new blocks `ai_keys_columns`, `ai_keys_privileges`, `ai_key_roundtrip`, `ai_key_negatives`, `ai_key_functions_locked`, `security_definer_allowlist` and `ai_key_vault_direct_denied` (stub only). The rollback leaves 0 public tables. Ming also runs the **manual Vault smoke test** below on the real Supabase project and records the results in `impl-log.md` or a follow-up note. |
| 3 | Save/delete server actions: `requireUser()`, format validation, no echo | **Slice (b).** This slice adds the shared format validator `validateAiKeyFormat` in core (unit-tested). Slice (b) calls it from the actions. |
| 4 | UI key wins, else env, else disabled; web and worker pick up changes without a restart | `packages/ai/src/keys.test.ts` (precedence and delete fallback). `client.test.ts` › "resolveProviders is called on every generate" and "picks up a changed key between calls". `apps/web/server/ai.test.ts` › "generate reads stored keys on every call". `apps/worker/src/ai.test.ts` gets the same test. |
| 5 | R3 holds; r3-guard and client-bundle check pass; new server modules covered | `pnpm test` (r3-guard with new cases: decrypting entry points only in the allowed files, no `vault.*` reference in TS). `pnpm check:service-key` is green. No new web module is added in this slice; wiring goes into the existing `apps/web/server/ai.ts`. |
| 6 | CLAUDE.md Conventions + spec §7 updated; ADR records Vault, precedence, threat model | Diff shows `docs/adr/0009-ai-provider-keys-in-vault.md`, the spec §7 line 214 replacement and the CLAUDE.md Conventions secrets line, with the exact wording given in Approach step 10. |
| 7 | typecheck, lint, test, db:check, client-bundle check green; tests cover precedence, delete, format rejection, no action returns key | `pnpm typecheck && pnpm lint && pnpm test && pnpm db:check && pnpm check:service-key` all green. Tests in this slice cover precedence, delete, and format rejection in core, the repo and SQL. They also cover no secret in repo errors or logs. "No action returns the key" belongs to slice (b) (there are no actions here). |

### Manual Vault smoke test (Ming, on the real stoktok Supabase project, after the migration is applied)
db:check runs on plain Postgres 16 with a Vault **stub**, so real encryption and real Vault privileges can only be checked here. Run this in the SQL editor using **only the dummy value below, never a real key**. SQL editor history and logs can retain the text.
1. `select extname, extversion from pg_extension where extname = 'supabase_vault';` should return 1 row. If there is none, enable Vault in the dashboard first. The migration refuses to apply without it.
2. `show log_statement;` should return `none` or `ddl`. If it returns `all` or `mod`, stop and tell the team, because RPC parameters could be logged.
3. `select * from public.ai_key_set('google', 'DUMMY-not-a-real-key-0000');` should return `key_last4 = '0000'`.
4. `select secret = 'DUMMY-not-a-real-key-0000' as is_plaintext from vault.secrets where name = 'stoktok_ai_key_google';` should return `false` (encrypted at rest).
5. `select provider, secret from public.ai_key_secrets();` should return `google | DUMMY-not-a-real-key-0000`.
6. `set role anon;`, then `select * from public.ai_key_secrets();`, `select * from public.ai_keys;` and `select * from vault.decrypted_secrets;`. Each must fail with permission denied. Then `reset role;`. Repeat with `set role authenticated;`.
7. (Informational, for the ADR.) `set role service_role; select count(*) from vault.decrypted_secrets; reset role;`. Record whether it succeeds or is denied.
8. Optional: `POST https://<project>.supabase.co/rest/v1/rpc/ai_key_secrets` with only the anon key should return 401/403/404, not data.
9. `select public.ai_key_delete('google');` should return `true`. `select count(*) from vault.secrets where name like 'stoktok_ai_key_%';` should return `0`.

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `supabase/migrations/20261110000200_ai_keys.sql` | **Create.** Vault presence guard, table `public.ai_keys`, three `security definer` wrappers, revokes and grants | AC2 storage |
| `supabase/rollback/20261110000200_ai_keys.down.sql` | **Create.** Drop the functions, delete the `stoktok_ai_key_%` Vault rows (guarded), drop the table | AC2 rollback |
| `scripts/db-check/bootstrap-roles.sql` | **Modify.** Append a TEST-ONLY Vault stub, created only when the `vault` schema is absent | db:check runs without Vault (consult-database-optimizer §5) |
| `scripts/db-check/checks.sql` | **Modify.** Add `ai_keys` to `tables_exist` and add the new check blocks | AC2 db:check cases |
| `supabase/README.md` | **Modify.** Short "Vault" section: the migration requires `supabase_vault`, db:check uses a stub, link to the manual smoke test in ADR 0009 | Operator documentation for the new dependency |
| `packages/core/src/ai/keys.ts` | **Create.** `AI_KEY_LENGTH`, `validateAiKeyFormat` | One shared format rule for the repo (now) and actions (slice b) |
| `packages/core/src/ai/keys.test.ts` | **Create.** Unit tests | R8, AC7 format rejection |
| `packages/core/src/ai/index.ts` | **Modify.** Export the above | Public API |
| `packages/db/src/repos/ai-keys.ts` | **Create.** `saveAiKey`, `deleteAiKey`, `listAiKeyMeta`, `readAiKeySecrets`; types `AiKeyMeta`, `StoredAiKeySecrets` | AC2 data access |
| `packages/db/src/repos/ai-keys.test.ts` | **Create.** Repo tests with a fake client | AC2/AC7, no-secret-in-errors |
| `packages/db/src/index.ts` | **Modify.** Export the repo functions and types | Public API |
| `packages/db/src/r3-guard.test.ts` | **Modify.** New guard cases (see Tests) | AC5 |
| `packages/ai/src/keys.ts` | **Create.** `resolveAiKeys`, `makeProviderResolver`, types `StoredAiKeys`, `AiKeySource` | AC4 precedence, per-call resolution |
| `packages/ai/src/keys.test.ts` | **Create.** | AC4/AC7 |
| `packages/ai/src/client.ts` | **Modify.** `AiClientOptions` accepts `providers` **or** `resolveProviders`; resolve once per `generate()`; fail closed on read error | AC4, no stale singleton |
| `packages/ai/src/client.test.ts` | **Modify.** Add the resolver tests | AC4 |
| `packages/ai/src/index.ts` | **Modify.** Export `resolveAiKeys`, `makeProviderResolver` and types | Public API |
| `apps/web/server/ai.ts` | **Modify.** Wire `resolveProviders: makeProviderResolver(() => readAiKeySecrets(getDb()), () => readAiEnv(), { timeoutMs })`. Keep the singleton | AC4 web |
| `apps/web/server/ai.test.ts` | **Modify.** Extend the `./db` mock with `readAiKeySecrets`; add tests | AC4 |
| `apps/worker/src/ai.ts` | **Modify.** Same wiring with the worker's `db` and `env` | AC4 worker |
| `apps/worker/src/ai.test.ts` | **Modify.** Add tests | AC4 |
| `docs/adr/0009-ai-provider-keys-in-vault.md` | **Create.** ADR | AC6 |
| `docs/spec-v1.md` | **Modify.** §7 line 214 only | AC6 (Ming's decision, ticket notes) |
| `CLAUDE.md` | **Modify.** Conventions "Secrets" bullet only | AC6 (Ming's decision, ticket notes) |

No other file may be touched without a note in `impl-log.md`. `.env.example` and `scripts/check-no-service-key-in-client.sh` stay unchanged: env key names are unchanged and the bundle check already covers the sentinels.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `packages/core/src/ai/keys.test.ts` › accepts a 20-char and a 256-char printable-ASCII key | bounds |
| › rejects empty, `undefined`/non-string → `AI_KEY_EMPTY` | format |
| › rejects leading/trailing space, inner space, `\n`, `\r\n`, `\t` → `AI_KEY_WHITESPACE` (no trimming) | AC3/AC7 format rejection |
| › rejects 19 and 257 chars → `AI_KEY_LENGTH` | bounds |
| › rejects non-ASCII (`ã`, zero-width space U+200B) → `AI_KEY_CHARSET` | charset |
| › the result object never contains the input (`JSON.stringify(result)` lacks the sentinel) | no echo |
| `packages/db/src/repos/ai-keys.test.ts` › saveAiKey calls rpc `ai_key_set` with `{p_provider, p_key}` and maps `{key_last4, saved_at}` → `{provider, last4, updatedAt}` | repo |
| › saveAiKey with an invalid format throws `DataError('VALIDATION')` **without calling rpc**; message has no sentinel | format before DB |
| › saveAiKey with rpc error `{code:'22023', message:'…SENTINEL…', details:'…SENTINEL…'}` throws a DataError whose `message`, `String(err)`, `JSON.stringify(err)` and `err.cause` (must be `undefined`) contain no sentinel | no secret in errors |
| › saveAiKey / deleteAiKey reject a provider outside `AI_PROVIDERS` without calling rpc | allow-list |
| › deleteAiKey calls `ai_key_delete` and returns the boolean | delete |
| › listAiKeyMeta selects exactly `provider, last4, updated_at` from `ai_keys` and maps rows | meta never decrypts |
| › readAiKeySecrets maps `[{provider, secret}]` → `{ anthropic?, google? }`; empty → `{}` | read |
| › readAiKeySecrets with an unknown provider row throws a MAPPING DataError with no secret in the message or cause | mapping |
| › readAiKeySecrets with an rpc error throws a DataError with no cause and no sentinel | fail-closed input |
| `packages/ai/src/keys.test.ts` › resolveAiKeys: stored and env both set → stored key, source `ui` | AC4 precedence |
| › env only → env key, source `env` | fallback |
| › neither → key absent, source `none` | disabled |
| › mixed: stored anthropic + env google → both, sources `ui`/`env` | per provider |
| › after delete (stored `{}`) with env → env; without env → `none` | AC7 delete |
| › blank/whitespace stored value is treated as absent | robustness |
| › makeProviderResolver calls `readStored` and `readEnv` on **every** invocation; a stored change between two calls is reflected (provider ids differ) | AC4 no cache |
| › makeProviderResolver propagates a `readStored` rejection (does not fall back to env) | fail-closed contract |
| `packages/ai/src/client.test.ts` › constructor throws TypeError when both or neither of `providers`/`resolveProviders` are given | API |
| › resolveProviders is called once per generate, even across tool rounds | stable within a call |
| › picks up a changed key between two generate calls on one client (first google, then anthropic) | AC4 |
| › resolveProviders rejects → `provider_unavailable`; `ledger.reserve` not called; one warn `{event:'ai_key_read_failed', code:'key_read_failed'}`; captured log JSON has no sentinel from the error message | fail closed, no leak |
| › resolveProviders returns `{}` → `provider_unavailable`, no `ai_key_read_failed` log | empty ≠ failure |
| › resolved provider registered under the wrong id throws | id check kept |
| › budgetStatus does not call resolveProviders | Settings budget card never decrypts |
| `apps/web/server/ai.test.ts` › getAiBudgetStatus does not call readAiKeySecrets | coupling risk |
| › getAi().generate calls readAiKeySecrets on each call (2 calls → 2 reads) | AC4 web |
| › readAiKeySecrets rejects with a sentinel message → result `provider_unavailable`; spied `console.*` output has no sentinel | fail closed, no log leak |
| (existing) getAi returns the same instance; getDb called once | unchanged |
| `apps/worker/src/ai.test.ts` › generate reads stored keys per call via `db.rpc('ai_key_secrets')`; rpc error → `provider_unavailable`, no sentinel in console | AC4 worker |
| `packages/db/src/r3-guard.test.ts` › `ai_key_secrets` / `readAiKeySecrets` appear only in the allowed files (list in Approach step 7) | AC5 |
| › no TS/JS file under apps/ or packages/ references `vault.` objects (`vault\.(secrets|decrypted_secrets|create_secret|update_secret)`) | Vault only through the SQL wrappers |
| `scripts/db-check/checks.sql` blocks (listed in Approach step 3) | AC2 |

## Approach
1. **Core format rule** (`packages/core/src/ai/keys.ts`):
   - `export const AI_KEY_LENGTH = { min: 20, max: 256 } as const`.
   - `validateAiKeyFormat(raw: unknown): { ok: true } | { ok: false; code: 'AI_KEY_EMPTY' | 'AI_KEY_WHITESPACE' | 'AI_KEY_LENGTH' | 'AI_KEY_CHARSET' }`. Checks run in that order. No trimming. Accept only `^[\x21-\x7E]{20,256}$`. There is no provider-prefix check, so a future key format is not rejected. The result never contains the input. The SQL check repeats the same bounds and charset. Add a comment in both places pointing to the other.
2. **Migration `20261110000200_ai_keys.sql`** (consult-database-optimizer §2–4, §7):
   - Header comment: `ai_keys` holds no secret; `ai_key_secrets()` is the only decrypt path; rollback deletes stored keys deliberately (ADR 0009).
   - Guard: `do $$ begin if pg_catalog.to_regclass('vault.secrets') is null then raise exception 'supabase_vault is required: enable Vault on the project first'; end if; end $$;`. **No `create extension`.**
   - `create table public.ai_keys (provider text primary key check (provider in ('anthropic','google')), secret_id uuid not null unique, last4 text not null check (last4 ~ '^[\x21-\x7e]{4}$'), updated_at timestamptz not null default now());` plus `comment on table`.
   - `alter table … enable row level security; revoke all on public.ai_keys from public, anon, authenticated, service_role; grant select on public.ai_keys to service_role;`. service_role **reads only**. Writes go only through the wrappers, so `last4`/`secret_id` cannot drift. The explicit revoke from service_role undoes Supabase's default grants (mimicked in bootstrap).
   - `public.ai_key_set(p_provider text, p_key text) returns table (key_last4 text, saved_at timestamptz)`, plpgsql:
     - `security definer`, `set search_path = ''`, every name schema-qualified.
     - Validate provider (`in ('anthropic','google')`) and key (not null, `p_key ~ '^[\x21-\x7e]{20,256}$'`). On failure `raise exception 'invalid ai key arguments' using errcode = '22023'`, a fixed message that never interpolates `p_key`.
     - `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('stoktok.ai_key.' || p_provider))`.
     - Name = `'stoktok_ai_key_' || p_provider`.
     - If an `ai_keys` row exists and its `secret_id` exists in `vault.secrets`: `perform vault.update_secret(v_id, p_key)`.
     - Otherwise: `delete from vault.secrets where name = v_name` (orphan clean-up), then `v_id := vault.create_secret(p_key, v_name, 'stoktok AI provider key')`.
     - Upsert `public.ai_keys (provider, secret_id, last4 = pg_catalog.right(p_key, 4), updated_at = pg_catalog.now())`.
     - Return the pair. Distinct OUT column names avoid plpgsql ambiguity with table columns.
   - `public.ai_key_delete(p_provider text) returns boolean`, plpgsql, definer, same validation and lock:
     - `delete from vault.secrets where id = (row's secret_id) or name = v_name`.
     - `delete from public.ai_keys where provider = p_provider`.
     - Return whether an `ai_keys` row existed.
   - `public.ai_key_secrets() returns table (provider text, secret text)`, plpgsql, definer, stable:
     - `return query select k.provider, d.decrypted_secret from public.ai_keys k join vault.decrypted_secrets d on d.id = k.secret_id`.
     - This is the single decrypt path: one round-trip for both providers. It replaces the db consult's per-provider `ai_key_get`.
   - After each function: `revoke all on function … from public, anon, authenticated; grant execute on function … to service_role;`. The `from public` revoke is mandatory.
   - No `alter function … set log_statement` (superuser-only GUC on Supabase; the smoke test checks it instead).
3. **db:check:**
   - In `bootstrap-roles.sql`, append a block marked `-- TEST ONLY (never a migration): minimal stand-in for Supabase Vault so the ai_key_* wrappers can be exercised. It stores plaintext; real Vault encrypts.` It runs `do $$ … if pg_catalog.to_regnamespace('vault') is null then …` and creates:
     - schema `vault` with `comment on schema vault is 'stoktok db:check vault stub'`;
     - `vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, description text not null default '', secret text not null, key_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`;
     - view `vault.decrypted_secrets as select s.*, s.secret as decrypted_secret from vault.secrets s`;
     - `vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null) returns uuid`;
     - `vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null) returns void`.

     It then revokes all on the schema, its tables and views, and execute on its functions from `public` (no grants to anon/authenticated/service_role). Pin the signatures in the ADR as "verify on the real project".
   - In `checks.sql`:
     - `tables_exist`: insert `'ai_keys'` before `'ai_usage'`.
     - `ai_keys_columns`: `assert_col` for the 4 columns (`text`, `uuid`, `text`, `timestamp with time zone`, all not null).
     - `ai_keys_privileges`: service_role has `select` and no `insert`/`update`/`delete` on `public.ai_keys` (`has_table_privilege`). anon/authenticated have none.
     - `ai_key_roundtrip` (as `service_role` via `set local role`; `reset role` for vault-table inspection):
       - set google key A (≥20 chars) → `key_last4 = right(A,4)`; `ai_key_secrets()` returns A.
       - set again B → same `secret_id`, secret B, last4 changed, `updated_at` not earlier, exactly 1 `vault.secrets` row named `stoktok_ai_key_google`.
       - delete → `true`; no google row in `ai_key_secrets()`, `ai_keys` or `vault.secrets`; delete again → `false`.
       - orphan: as postgres insert a `vault.secrets` row named `stoktok_ai_key_anthropic`, then `ai_key_set('anthropic', …)` succeeds with exactly 1 such row.
       - clean up.
     - `ai_key_negatives` (as service_role, `expect_fail … array['22023']`):
       - provider `'openai'`, provider null, key null, key with a space, with `chr(10)`, with `chr(9)`, 19 chars, 257 chars, non-ASCII, and `ai_key_delete('openai')`.
       - Then assert no `ai_keys` rows were created.
       - Plus one explicit block that catches the error of `ai_key_set('google', '<sentinel> with space')` and asserts `position('<sentinel>' in sqlerrm) = 0`.
     - `ai_key_functions_locked`: for the 3 signatures, anon/authenticated cannot execute and service_role can. `proacl` is not null and `aclexplode(proacl)` has no grantee `0` (PUBLIC). `prosecdef` is true and `'search_path=""' = any(proconfig)`.
     - `security_definer_allowlist`: the set of `prosecdef` functions in `public` is exactly `{ai_key_set, ai_key_delete, ai_key_secrets}`, so any future definer function must be added deliberately.
     - `ai_key_vault_direct_denied`: runs only when `obj_description('vault'::regnamespace, 'pg_namespace') = 'stoktok db:check vault stub'`. anon, authenticated and service_role each get `42501` on `select * from vault.decrypted_secrets` and `select vault.create_secret('x')`. On a local Supabase (`DB_CHECK_URL`) it is skipped; the manual smoke test covers that.
4. **Rollback `20261110000200_ai_keys.down.sql`:**
   - Drop the 3 functions (`if exists`, with signatures).
   - Run `do $$ begin if pg_catalog.to_regclass('vault.secrets') is not null then if pg_catalog.to_regclass('public.ai_keys') is not null then delete from vault.secrets where id in (select secret_id from public.ai_keys); end if; delete from vault.secrets where name like 'stoktok_ai_key_%'; end if; end $$;`
   - `drop table if exists public.ai_keys;`
   - Never drop the extension or the schema.
5. **Repo `packages/db/src/repos/ai-keys.ts`:**
   - `saveAiKey(db, provider, key): Promise<AiKeyMeta>`:
     - Allow-list the provider via `AI_PROVIDERS`.
     - Call `validateAiKeyFormat`; on failure throw `DataError('VALIDATION','ai_keys','set','invalid key format')`.
     - `rpc('ai_key_set', { p_provider, p_key })`.
   - `deleteAiKey(db, provider): Promise<boolean>`.
   - `listAiKeyMeta(db): Promise<AiKeyMeta[]>` via `from('ai_keys').select('provider, last4, updated_at')`.
   - `readAiKeySecrets(db): Promise<StoredAiKeySecrets>` (`Partial<Record<AiProvider, string>>`) via `rpc('ai_key_secrets')`.
   - **Errors:** this module does **not** use `unwrap` (it attaches `cause: res.error`). It uses a local helper that throws `new DataError(code, 'ai_keys', op, fixedText, pgCode)` with **no cause**, so PostgREST `message`/`details`, which could echo parameters, never ride along. Mapping errors name the field only. Nothing in this module logs.
6. **Resolver `packages/ai/src/keys.ts`** (consult-software-architect "Key resolver"):
   - `type StoredAiKeys = Partial<Record<AiProvider, string>>`, `type AiKeySource = 'ui' | 'env' | 'none'`.
   - `resolveAiKeys(stored, env: AiEnv): { keys: AiEnv; source: Record<AiProvider, AiKeySource> }`. Per provider: a non-blank stored value wins, else the env value, else absent. This module contains no env variable names (they stay in `env.ts`).
   - `makeProviderResolver(readStored: () => Promise<StoredAiKeys>, readEnv: () => AiEnv, opts: { timeoutMs: number }) => () => Promise<Partial<Record<AiProvider, LlmProvider>>>`. On each call it reads both, resolves, and runs `buildProviders`. No caching. A `readStored` rejection propagates.
7. **AiClient** (`client.ts`):
   - `AiClientOptions` becomes a union: `{ providers: ProviderMap; resolveProviders?: never } | { resolveProviders: () => Promise<ProviderMap>; providers?: never }`, plus the common fields. The constructor throws `TypeError` if neither or both are given at runtime, and keeps the id check for static `providers`.
   - In `generate()`, after the existing input assertions and the `fail` helper, and before `selectProvider`:
     ```ts
     let providers: ProviderMap;
     try { providers = this.resolveProviders ? await this.resolveProviders() : this.providers; }
     catch { this.log.warn({ event: 'ai_key_read_failed', code: 'key_read_failed' }); return fail('provider_unavailable'); }
     ```
     Run the id check on `providers`, then use this local map for the whole call (all rounds).
   - `budgetStatus()` is unchanged and never resolves providers.
   - r3-guard allow-list for `ai_key_secrets|readAiKeySecrets`: `packages/db/src/repos/ai-keys.ts`, `packages/db/src/repos/ai-keys.test.ts`, `packages/db/src/index.ts`, `apps/web/server/ai.ts`, `apps/web/server/ai.test.ts`, `apps/worker/src/ai.ts`, `apps/worker/src/ai.test.ts`.
8. **Wiring:**
   - `apps/web/server/ai.ts`: keep the lazy singleton and replace `providers:` with `resolveProviders: makeProviderResolver(() => readAiKeySecrets(getDb()), () => readAiEnv(), { timeoutMs: AI_TIMEOUT_MS })`. Import `readAiKeySecrets` from `./db` (`export *` already re-exports it), so the "only server/db.ts imports @stoktok/db" guard holds.
   - Worker: `const db = opts.db ?? createServiceClient(env)`, used for both the ledger and `makeProviderResolver(() => readAiKeySecrets(db), () => readAiEnv(env), …)`.
9. **ADR 0009 "AI provider keys in Supabase Vault"** (consult-software-architect ADR outline + db risks). It covers:
   - **Context:** Ming 2026-11-10 overrides spec §7.
   - **Decision:**
     - Vault plus the `ai_keys` metadata table.
     - The first `security definer` functions, with justification: Vault privileges for service_role are not guaranteed, and the definer locks the surface.
     - `search_path=''`, the PUBLIC revoke, and the db:check allow-list.
     - Precedence UI → env → disabled, resolved once per `generate()`.
     - No cache, and why (one RPC per call vs. stale keys across two processes).
     - Fail closed on read errors; an empty result falls back to env.
     - last4 is the only part ever shown.
     - Secret names `stoktok_ai_key_<provider>` never contain env names.
     - Format rule of 20–256 printable ASCII and no trimming.
   - **Threat model:**
     - Protected: browser/bundle, anon/authenticated roles, app logs, backups (ciphertext).
     - Not protected: holders of the service role key or DB-owner access, a compromised server process, and DB statement logging if `log_statement` is raised.
     - Replacing a key does not revoke the old one at the provider.
   - **Consequences:**
     - One extra RPC per AI call.
     - db:check uses a stub, so the manual smoke test (copied from this plan) is mandatory.
     - Rollback deletes stored keys. After a restore into another project, re-enter the keys.
     - Deploy order: apply the migration before deploying an image with this change, otherwise every AI call fails closed (`provider_unavailable`).
     - The result of smoke step 7 is recorded as a follow-up amendment.
10. **Wording (AC6), exact text:**
    - spec §7 line 214 → `- Secrets: Supabase keys only in the deploy repo's env handling, never in the app repo. LLM API keys may be entered on Settings and are stored in Supabase Vault (service_role only, decrypted only on the server); env keys in the deploy repo are the fallback (ADR 0009). Never in the app repo.`
    - CLAUDE.md Conventions → `- Secrets: only in \`.env.local\` (git-ignored), the deploy repo, and — for AI provider keys entered on Settings — Supabase Vault (ADR 0009). Keys are never returned to the browser or logged.`
    - No change to R1–R10.
11. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm db:check && pnpm check:service-key`. Docker is unavailable; db:check uses the local PG16 binaries.

Rules:
- **R3:** decrypt only in server code via `@stoktok/db`. The guard tests restrict the entry points, and no `'use client'` file can import them (existing guard).
- **R6:** no new routes or actions in this slice.
- **R7:** UI and actions are deferred.
- **R8:** tests listed above.
- **R1, R2, R5:** not affected. No money; key-format bounds are defined once in core.
- **R10:** not affected.

## Specialist input used
- **software-architect:**
  - Adopted: the split (a)/(b); `resolveAiKeys` in `packages/ai`; `resolveProviders` resolved once per `generate()`; no cache; fail closed; `budgetStatus` never resolves; keep the web singleton; ADR 0009 outline; wording for spec and CLAUDE.md; r3-guard additions; logging only `{event, code}`; no provider test call.
  - Adapted: format check in core with the architect's bounds 20–256 and no trim.
  - Not taken in this slice: `ai_key_meta()` function (replaced by a plain select on `ai_keys`, per the db consult). Optional source display → slice (b).
- **database-optimizer:**
  - Adopted: Vault plus the `ai_keys` metadata table with `last4`; no FK into vault; definer wrappers with `search_path=''` and the PUBLIC revoke; advisory lock; orphan re-create; generic 22023 errors; Vault stub in `bootstrap-roles.sql` guarded by schema absence and with no grants; the listed checks plus the `proacl`/`proconfig` assertions and a generic definer allow-list; rollback deleting vault rows; no `create extension`; the mandatory manual smoke test.
  - Changed:
    - A single `ai_key_secrets()` instead of per-provider `ai_key_get`, to keep one RPC per call.
    - Length 20–256 instead of 16–512, to match core.
    - service_role gets `select` only on `ai_keys` (stricter than the suggested full DML), because writes go through the wrapper.
    - A Vault-presence guard in the migration so a missing extension fails loudly.
  - Rejected: `set log_statement = 'none'` on functions (needs superuser on Supabase); a smoke step checks it instead.
- **data-visualization-engineer:** entirely for slice (b): placement outside `SettingsForm`, password input attributes, no `values` echo, inline two-step delete, row states, `hasEnvFallback`. Carried into the split proposal; not used here.

## Assumptions
(All are defaults for Ming to confirm. None blocks this slice.)
1. **Fail closed on key-read errors.** If `ai_key_secrets()` fails, the AI call returns `provider_unavailable` and does not fall back to env. An empty result (no stored key) falls back to env.
2. **No provider test call on save** (cost and network). A "test key" button is a follow-up.
3. **No cache:** keys are read on every `generate()`. A TTL cache is a follow-up only if latency is measured as a problem.
4. **Key format:** 20–256 printable ASCII, no whitespace, **no trimming**, so a pasted key with a trailing newline is rejected with a clear message in slice (b). There is no prefix check.
5. **UI spelling "Khóa"** (old-style accent placement, consistent with the existing "Xóa", "Hủy") for slice (b) labels, e.g. card title "Khóa AI", instead of the ticket's "Khoá".
6. `supabase_vault` is enabled on the stoktok project. The migration refuses to apply otherwise (smoke step 1).
7. Supabase's `log_statement` is `none`/`ddl` (smoke step 2).
8. The Vault function signatures in the stub match the installed version. This was not verifiable offline; the smoke test confirms it.
9. Rolling back the migration deletes the stored keys. This is acceptable; Ming re-enters them.
10. No AI feature calls `generate()` yet, so the extra RPC and fail-closed behaviour have no user-visible impact until chat or explanations ship.

## Blocking questions
None.

## Split proposal
The full ticket (migration, stub, checks, repo, resolver, AiClient change, wiring, guards, ADR and docs, plus the UI card, actions and component tests) is well over ~400 changed lines. It also triggers the security auditor, and a security rework would restart a very large diff with only 2 reworks allowed (consult-software-architect, Risks: "Diff size").

| Slice | Scope | ACs | This plan |
|---|---|---|---|
| **(a) STK-074: storage + resolver** | Migration and rollback, db:check Vault stub and checks, `packages/db` ai-keys repo, core `validateAiKeyFormat`, `resolveAiKeys`/`makeProviderResolver`, `AiClient.resolveProviders`, web and worker wiring, r3-guard additions, ADR 0009, spec §7 and CLAUDE.md wording, supabase/README note, manual Vault smoke test | AC2, AC4, AC5, AC6; AC7 (precedence, delete, format) | **Yes** |
| **(b) follow-up ticket (suggested STK-075): Settings "Khóa AI" card** | Card `components/settings/ai-keys-card.tsx`, a sibling **outside** `SettingsForm`, placed after `AiUsageCard`, one `<form>` per provider. `saveAiKeyAction`/`deleteAiKeyAction` with `requireUser()` first, a provider allow-list, `validateAiKeyFormat`, and a dedicated `AiKeyFormState` with no `values` echo. Logs only `{event, provider, code}`. `revalidatePath`. The page reads only `listAiKeyMeta` plus a booleans-only `hasEnvFallback`/source helper from `server/ai.ts`. Password input attributes (`type=password`, `autoComplete="new-password"`, password-manager ignore attributes, uncontrolled, cleared on success **and** error). Inline two-step delete. Row states: not set, UI, env fallback (no last4 shown), UI + env. Tests: JSON of every action result and spied `console.*` contain no sentinel; rendered HTML never contains the key; states; delete confirmation; r3-guard covers any new `server/` module | AC1, AC3, AC5 (new modules), AC7 (no action returns the key) | No |

Until slice (b) lands, behaviour is unchanged in practice: there are no stored keys, so env keys are used.
