## Attempt 1 — 2026-11-10
Verdict: PASS

Scope reviewed: slice (a) only (plan.md). The Settings card and its actions (AC1, AC3, and the "no action returns the key" part of AC7) are STK-076.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0 (all 6 projects Done).
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0. core 785, sources 35, ai 184, db 187 (+1 todo), worker 295, web 317, all passed. These counts match impl-log.md.
- db:check: `pnpm db:check` ran on local PG16 binaries with the Vault stub. It applied all migrations including `20261110000200_ai_keys.sql`, ran the checks, rolled back to 0 public tables, re-applied, and ran the checks again. Output: `db:check OK`.
- check:service-key: `OK: no secret or AI SDK material in client bundle`.

### Acceptance criteria
- [ ] AC1 Settings "Khoá AI" card: deferred to STK-076 per the plan split. Not in scope for this slice.
- [x] AC2 Vault storage, service_role only, no anon/authenticated access to secrets or helpers, migration + rollback + db:check cases.
  - Migration `supabase/migrations/20261110000200_ai_keys.sql`:
    - Vault guard with no `create extension`.
    - `ai_keys` holds no secret, has RLS on, and grants `select` only to service_role.
    - 3 `security definer` functions with `search_path=''` and fully qualified names. The error is a fixed 22023 that never interpolates the key. Advisory lock and orphan clean-up are present.
    - `revoke … from public, anon, authenticated`, then `grant execute` to service_role.
  - Rollback drops the functions, deletes Vault rows (guarded) and drops the table. It never drops the extension or schema, as planned.
  - db:check blocks `ai_keys_columns`, `ai_keys_privileges`, `ai_key_roundtrip`, `ai_key_negatives` (including the sqlerrm no-echo check), `ai_key_functions_locked` (proacl has no PUBLIC; prosecdef; proconfig), `security_definer_allowlist` and `ai_key_vault_direct_denied` (stub only) are all green.
  - Real encryption and privileges depend on the manual smoke test in ADR 0009 (Ming).
- [ ] AC3 Server actions: STK-076. This slice provides `validateAiKeyFormat` (packages/core/src/ai/keys.ts) with unit tests.
- [x] AC4 UI key → env → disabled, with no stale singleton.
  - `packages/ai/src/keys.test.ts` covers precedence, env-only, none, mixed, delete fallback, blank stored value, and fresh reads on every call.
  - `client.test.ts` › resolveProviders covers: called once per generate across tool rounds, picks up a changed key between calls, and `budgetStatus does not call resolveProviders`.
  - `apps/web/server/ai.test.ts`: 2 generates make 2 `readAiKeySecrets` calls, and `getAiBudgetStatus` does not read keys.
  - `apps/worker/src/ai.test.ts`: 2 `ai_key_secrets` rpc calls for 2 generates.
  - Code: `client.ts` generate() resolves once into a local `providers` map before `selectProvider` and before any `ledger.reserve`. `budgetStatus()` is untouched.
- [x] AC5 R3.
  - r3-guard adds two cases: `ai_key_secrets|readAiKeySecrets` may appear only in the 7 allowed files, and no `vault.(secrets|decrypted_secrets|create_secret|update_secret)` reference is allowed in TS/JS under apps/ or packages/.
  - Web wiring imports `readAiKeySecrets` through `./db`, which is `server-only`.
  - `check:service-key` is green.
- [x] AC6 Wording.
  - `docs/spec-v1.md` §7 line 214 and the CLAUDE.md Conventions secrets bullet match the exact text in plan step 10. CLAUDE.md also keeps the existing ".env.example lists keys with no values." sentence, which is reasonable.
  - `docs/adr/0009-ai-provider-keys-in-vault.md` covers context, decision (Vault plus metadata table, definer justification, precedence, no cache, fail closed, format, access path), threat model, consequences (deploy order, rollback deletes keys, unverified stub signatures) and the 9-step smoke test.
  - R1–R10 are unchanged.
- [x] AC7 Checks green. Tests cover:
  - precedence and delete (ai keys.test.ts);
  - format rejection (core keys.test.ts, repo test, SQL `ai_key_negatives`);
  - no secret in repo errors: `DataError` has no `cause`, and message, `String(err)` and JSON contain no sentinel (`packages/db/src/repos/ai-keys.test.ts`);
  - no secret in logs (client, web and worker tests spy on the log/console).

  "No action returns the key" is STK-076.

### Specific review points
- **Fail closed:**
  - `client.ts` uses `catch {}` with no binding and logs only `{event:'ai_key_read_failed', code:'key_read_failed'}`, then returns `provider_unavailable`. There is no env fallback, because `makeProviderResolver` propagates the `readStored` rejection.
  - An empty `{}` result falls back to env.
  - `buildProviders` runs inside the resolver, so an SDK constructor error also fails closed.
- **Vault stub vs the real Supabase Vault API** (checked as far as possible offline):
  - The stub matches the documented Supabase Vault surface:
    - `vault.create_secret(new_secret, new_name default null, new_description default '', new_key_id default null) returns uuid`
    - `vault.update_secret(secret_id, new_secret, new_name, new_description, new_key_id) returns void`
    - `vault.secrets(id, name unique, description, secret, key_id, created_at, updated_at)`
    - view `vault.decrypted_secrets` with a `decrypted_secret` column
  - The migration uses only these.
  - Two things cannot be verified offline. Both are pinned in the ADR and covered by smoke steps 3–5 and 9:
    - whether the definer owner (`postgres`) may `DELETE FROM vault.secrets` on the real project;
    - whether it may read `vault.decrypted_secrets`.
- **Documented deviation (regex repetition limit):** valid. Postgres caps bounded repetition at 255 (RE_DUP_MAX), so `{20,256}` would fail. `char_length(p_key) between 20 and 256` plus `^[\x21-\x7e]+$` is equivalent to the planned rule and matches core (where `/\s/` already fails `[\x21-\x7E]`).
- **Scope:** every changed code file is in the plan's file list. The extra changed files are workflow files only: backlog, ticket, the STK-076 ticket, and the consult/plan/impl-log files.

### Issues
None.

### Rules R1–R10
No violations found. R3: the decrypt path is restricted to server modules and guarded. R6: this slice adds no routes or actions. R7: within the plan. R8: green, and the new core logic has unit tests.

### Nits (do not block)
- `client.ts`: when `resolveProviders` returns a provider registered under the wrong id, generate() throws instead of failing closed. This is acceptable because it is a programming error, and the plan asks for the id check to be kept.
- `makeProviderResolver` builds new SDK clients on every generate(). This is cheap, but worth knowing if call volume grows.

### Follow-ups (out of scope)
- **Smoke test:** Ming runs the ADR 0009 manual Vault smoke test on the real project before an image with this change is deployed. Record step 7 (service_role direct access to `vault.decrypted_secrets`) as an ADR amendment.
- **Deploy order:** apply the migration before the image. Otherwise every AI call returns `provider_unavailable`.
- **db:check rollback coverage:** the cleanup in the checks leaves no Vault rows, so the rollback's Vault-row deletion is never exercised with live data. Consider seeding a key before the rollback step and asserting that `vault.secrets` has no `stoktok_ai_key_%` rows afterwards.
- **STK-076:**
  - call `validateAiKeyFormat` in the actions;
  - use `listAiKeyMeta` only on the page;
  - add the no-echo tests for action results and console output.
