## STK-074 architect consult: AI keys in Vault, UI key first, then env, else disabled

### Findings
1. **Keys are fixed when the client is built.** `AiClient` gets its `providers` in the constructor (`packages/ai/src/client.ts:73-86`).
   - Web keeps one cached `AiClient` (`apps/web/server/ai.ts:9-19`), and `apps/web/server/ai.test.ts:33` asserts `getAi()` returns the same object each time. So today a changed key is only seen after a restart.
   - Worker `createWorkerAi` also builds providers once, from `readAiEnv(env)`. No job calls it yet.
2. **Limits from r3-guard** (`packages/db/src/r3-guard.test.ts`):
   - The strings `ANTHROPIC_API_KEY` / `GOOGLE_AI_API_KEY` may appear only in `packages/ai/src/env.ts` and its test. That includes **Vault secret names, SQL, the ADR and fixtures** if they sit under apps/ or packages/.
   - In apps/web, only `apps/web/server/ai.ts` may import `@stoktok/ai`, and only `apps/web/server/db.ts` may import `@stoktok/db`.
   - The rule against `'use client'` files importing server code matches the substring `server/ai`, so a new `server/ai-keys*` module is covered automatically.
3. **`@stoktok/ai` depends only on `@stoktok/core`.** It cannot read the DB itself, so the stored-key reader has to be passed in.
4. **db:check runs on plain Postgres 16** (`scripts/db-check.sh`, `bootstrap-roles.sql`). The `supabase_vault` extension and `vault` schema are not there, so a migration that calls `vault.create_secret` will fail db:check unless a test-only stub is added.
5. **The current settings form pattern sends the input back.** `failForm(values, …)` returns `values`. The key form must not reuse it.
6. **The bundle check can't catch this kind of leak.** `check-no-service-key-in-client.sh` scans for build-time env sentinels. Keys stored at runtime in the DB never reach the build, so leak protection has to come from structure plus tests.
7. **There is no SECURITY DEFINER function in the repo yet.** ADR 0008 has only invoker functions with `search_path=''` and execute granted to service_role only.

### Recommendations
**Key resolver (AC4, AC5)**
- Add `packages/ai/src/keys.ts`, pure, with no DB and no env names:
  - `type StoredAiKeys = Partial<Record<AiProvider, string>>`
  - `resolveAiKeys(stored, envKeys: AiEnv): { keys: AiEnv; source: Record<AiProvider, 'ui'|'env'|'none'> }`
  - Rule per provider: a valid stored key wins, else the env key, else that provider is disabled.
- Env names stay in `env.ts` only.
- Name Vault secrets after the provider, e.g. `stoktok_ai_key_anthropic` / `stoktok_ai_key_google`. They must never contain the env names.

**Picking up a changed key without restart (AC4)**
- Change `AiClient` to take `providers` **or** `resolveProviders: () => Promise<Partial<Record<AiProvider, LlmProvider>>>`.
- In `generate()`, call it **once at the start and keep the result for every round** of that call, so a mid-call key change can't switch provider/model between rounds.
- `budgetStatus()` must not call it, so the Settings budget card never decrypts keys.
- Keep the web singleton (the existing test stays valid). Wire it in `server/ai.ts` as: `() => readAiKeySecrets(getDb())` → `resolveAiKeys(…, readAiEnv())` → `buildProviders(…)`. Worker does the same with `createServiceClient(env)`.
- **Read the keys on every call; no cache in v1.**
  - Cost: one RPC (tens to ~150 ms) per AI call. AI calls take seconds, are few, and spend is capped at 5 USD/month.
  - Gain: no stale key in either process, no cross-process invalidation to build, and decrypted keys live only for the length of the call.
  - A TTL cache with invalidate-on-save is lower latency but only clears in the web process; the worker would stay stale for up to the TTL. A version stamp still costs one round-trip and adds code.
  - Leave a TTL cache as a follow-up only if latency is ever measured as a problem.
- **If the key read fails, fail closed** for that call: return `provider_unavailable`, log the code only. Do not quietly fall back to env, because UI-first must stay predictable. An empty result (no row) is not a failure and falls back to env.
- SDK clients are cheap to build per call. Keep retries off and the timeout as it is.

**Storage (AC2)**
- Migration:
  - Table `public.ai_keys(provider text primary key check in ('anthropic','google'), secret_id uuid not null, last4 text not null, updated_at timestamptz not null)`, RLS on, all access revoked from public, anon, authenticated.
  - Store `last4` so the Settings page never decrypts.
- Wrapper functions:

  | Function | Returns |
  |---|---|
  | `ai_key_set(p_provider, p_secret)` | `(last4, updated_at)`; creates or updates the Vault secret |
  | `ai_key_delete(p_provider)` | deletes the `vault.secrets` row and the `ai_keys` row |
  | `ai_key_meta()` | provider, last4, updated_at; no secret |
  | `ai_key_secrets()` | provider, decrypted secret, from `vault.decrypted_secrets` |

  - All `SECURITY DEFINER`, owned by postgres, `set search_path = ''`, fully qualified names.
  - Execute revoked from public, anon, authenticated; granted to service_role only.
  - Whether service_role can reach `vault.*` directly on current Supabase needs checking. SECURITY DEFINER works either way. The ADR must justify being the first definer function.
- Validate inside SQL as well (provider allow-list, length/charset) and raise `22023`. Raise with a fixed message that never contains the value.
- Rollback: drop the functions and the table, **and** delete `vault.secrets` rows named `stoktok_ai_key_%` so no orphaned secrets remain.
- db:check:
  - Add a **test-only** stub to `bootstrap-roles.sql`: schema `vault`, a `secrets` table, a `decrypted_secrets` view, `create_secret` / `update_secret` with the real signatures. Mark it like the existing role mimic.
  - Checks: functions locked (pattern of `ai_functions_locked`), definer plus empty search_path, anon/authenticated have no privileges on `ai_keys` or the functions, the no-tables-left rollback check still holds.
  - The migration must not `create extension supabase_vault`; it is preinstalled on Supabase, and the call would break db:check.
- Repo `packages/db/src/repos/ai-keys.ts` with `saveAiKey`, `deleteAiKey`, `listAiKeyMeta`, `readAiKeySecrets`.
- Extend r3-guard so `ai_key_secrets` / `readAiKeySecrets` appear only in that repo, its test, `apps/web/server/ai.ts` and `apps/worker/src/ai.ts`. The Settings page and the actions use only `listAiKeyMeta` / `saveAiKey` / `deleteAiKey`.

**Server actions (AC1, AC3, AC7)**
- `saveAiKeyAction(prev, fd)`:
  1. `requireUser()`.
  2. `provider` must be in the enum.
  3. Validate the raw key without trimming: reject when it isn't `^[\x21-\x7E]{20,256}$`. Format validation can live in `packages/core`, which web already imports freely.
  4. `saveAiKey`, then `revalidatePath`, then redirect to `/settings?aiKey=saved`.
- Return type is a dedicated `AiKeyFormState = { ok: true; provider; last4; savedAt } | { ok: false; provider?; code: 'INVALID_FORMAT'|'SAVE_FAILED' }`, with **no `values`**.
- Delete action: `requireUser()`, provider only.
- The page reads only `listAiKeyMeta`. It may also show the source (UI / env / tắt) through a booleans-only helper exported from `server/ai.ts`. That is optional; skip it if it widens the diff.
- Input field: `type="password"`, `autoComplete="off"`, uncontrolled, never pre-filled.
- Tests to add:
  - Precedence and delete fallback in `resolveAiKeys`.
  - Per-call pickup: change the stub between two `generate()` calls on one client.
  - Fail-closed when the key read fails.
  - Format rejection (space, newline, too short or long).
  - `JSON.stringify` of every action result, plus captured `console.*` output, never contains a sentinel key.

**Logging**
- Log only `{event, provider, code}`: `ai_key_saved`, `ai_key_deleted`, `ai_key_save_failed`, `ai_key_read_failed`.
- Never log the error object from supabase-js or the SDKs, the key, or its last4.
- Add a test that spies on `console` with a sentinel key.

**ADR 0009 "AI provider keys in Supabase Vault"** should cover:
- **Context:** Ming's decision of 2026-11-10 overrides spec §7.
- **Decision:**
  - Vault with service_role-only definer wrappers; the `ai_keys` metadata table.
  - Precedence UI → env → disabled, resolved once per `generate()`.
  - No cache, and why.
  - Fail-closed on read errors.
  - last4 is the only part of a key ever shown.
  - The naming rule (no env names in secret names).
- **Threat model:**
  - Protected: browser/bundle exposure, anon/authenticated DB roles, logs, backups (Vault encrypts at rest).
  - Not protected: anyone holding the service role key or DB-owner access can decrypt; a compromised server process sees the plaintext.
  - Rotation: replacing a key in the UI does not revoke the old key at the provider.
- **Consequences:** one extra RPC per AI call; first definer functions; db:check uses a Vault stub.

**Wording changes (AC6)**
- Spec §7 line 214 → "Secrets: Supabase keys only in the deploy repo's env handling. LLM API keys may be entered on Settings and are stored in Supabase Vault (service_role only, decrypted only on the server). Env keys in the deploy repo are the fallback (ADR 0009). Never in the app repo."
- CLAUDE.md Conventions → "Secrets: only in `.env.local` (git-ignored), the deploy repo, and — for AI provider keys entered on Settings — Supabase Vault (ADR 0009). Keys are never returned to the browser or logged."
- Optionally add one clause to R3: "Vault secrets are read only by server code via `@stoktok/db`."

### Risks
- **Statement logging:** if Postgres runs with `log_statement=all` or pgaudit, or a SQL console is used, the plaintext could show up in DB logs. PostgREST RPC sends parameters bound, but this needs checking. Never set keys through the SQL editor in docs or tests.
- **Vault on vanilla Postgres:** the db:check stub can drift from real Vault signatures. Pin the signatures and note the risk in the ADR.
- **Process memory:** the decrypted key lives in memory for the length of a call. This is accepted under the single-user threat model.
- **Settings page coupling:** if the provider resolver is accidentally called from `budgetStatus` or the Settings page, every render decrypts the keys. Test that it doesn't.
- **Over-strict format check:** a prefix check could reject a valid future key format. Use charset plus length only.
- **Diff size:** migration, rollback, the db:check stub, repo, resolver, the AiClient change, web and worker wiring, actions, card, ADR/docs and security review together are large. A security rework would restart the whole loop, and only 2 reworks are allowed.

### Open questions
1. **Split or one ticket?** I recommend splitting.
   - (a) Storage + resolver: migration, rollback, db:check stub, repo, `resolveAiKeys`, the AiClient change to `resolveProviders`, web and worker wiring, r3-guard additions, ADR, CLAUDE.md and spec §7.
   - (b) Settings "Khoá AI" card + actions + no-echo tests.
   - Slice (a) can be tested end to end with repo-level tests. A single cycle is possible but has a high risk of hitting ESCALATED.
2. When the key read fails, fail closed (my recommendation) or fall back to env? This needs Ming.
3. Should the card show which source is active (UI key / env key / off)? It's useful, but slightly beyond AC1.
4. Saving a key does not check it against the provider (no test API call). Is that OK with Ming? I recommend no check in v1, since a check call costs budget and touches the network.

Files read: `/home/user/stoktok/packages/ai/src/{env,providers,client}.ts`, `/home/user/stoktok/apps/web/server/{ai,ai-budget,db}.ts`, `/home/user/stoktok/apps/worker/src/ai.ts`, `/home/user/stoktok/packages/db/src/{client,r3-guard.test}.ts`, `/home/user/stoktok/apps/web/app/(app)/settings/{page,actions}.tsx|ts`, `/home/user/stoktok/apps/web/server/settings/handlers.ts`, `/home/user/stoktok/scripts/{db-check.sh,db-check/bootstrap-roles.sql,check-no-service-key-in-client.sh}`, `/home/user/stoktok/docs/adr/0008-ai-budget-reservation.md`, `/home/user/stoktok/docs/spec-v1.md` §7.
