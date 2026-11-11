## Attempt 1 — 2026-11-11

### Files touched
| File | Required because |
|---|---|
| supabase/migrations/20261111000100_ai_keys_app_encryption.sql (new) | New ai_keys shape, drops the 3 wrappers, guard that refuses a real Vault |
| supabase/rollback/20261111000100_ai_keys_app_encryption.down.sql (new) | db:check applies every down file; minimal `drop table` |
| packages/db/src/keyring.ts (new) | AES-256-GCM keyring, only cipher caller |
| packages/db/src/keyring.test.ts (new) | R8 unit tests |
| packages/db/src/pg/client.ts | `AI_KEYS_MASTER_KEY_ENV`, keyring built once per handle, `ai_keyring_invalid` log |
| packages/db/src/pg/client.test.ts | keyring-on-handle cases |
| packages/db/src/pg/access.ts | internals widened, `keyringOf` |
| packages/db/src/pg/schema.ts | `AiKeysTable` mirrors the migration |
| packages/db/src/repos/ai-keys.ts | bodies rewritten, signatures unchanged, `AI_KEY_MAP` removed |
| packages/db/test-db/ai-keys.test.ts | rewritten for the new shape and fail-closed cases |
| packages/db/test-db/repos-ended-handle.test.ts | stale comment (line 8) |
| packages/db/src/r3-guard.test.ts | AI-key guards rewritten, new guards and fixtures |
| scripts/db-check/checks.sql | ai_key sections rewritten, empty definer allowlist |
| scripts/db-check/bootstrap-roles.sql | comment only on the Vault stub |
| scripts/check-no-service-key-in-client.sh | sentinel master key + needle |
| .env.example | `STOKTOK_AI_KEYS_MASTER_KEY=` |
| docs/adr/0011-ai-provider-keys-app-side-encryption.md (new) | ADR |
| docs/adr/0009-...md, docs/adr/0010-...md, docs/spec-v1.md, CLAUDE.md (line 128), supabase/README.md | docs no longer describe Vault as current |
| packages/core/src/ai/keys.ts, apps/web/server/ai.ts, apps/worker/src/ai.ts | comment-only edits |

### Tests added / changed
- keyring.test.ts: all 12 cases of the plan (parsing ok/absent/invalid, round trip and layout, random IV, provider AAD, version binding, tamper, pinned AAD, absent/invalid state, no leak, frozen object).
- pg/client.test.ts: invalid key does not throw and logs once, no log for absent/valid, handle stays opaque.
- test-db/ai-keys.test.ts: round trip, no plaintext at rest, IV per save, no rows + no key -> {}, rows + no/invalid key NOT_CONFIGURED, wrong key MAPPING, provider swap, tampered row, key_version 2, last4 mismatch, save without keyring writes nothing, delete/list without key, parallel saves, constraint violation 23514 (no leak), ended handle, migration guard on a real Vault.
- r3-guard.test.ts: readAiKeySecrets allow-list, dropped wrappers in no file (with fixtures), master key env name, cipher calls, keyringOf, keyring imports/barrels, .env.example entry.
- checks.sql: ai_keys_columns, ai_keys_privileges, ai_keys_constraints, ai_key_functions_gone, security_definer_allowlist.
- Mutation proof: AAD changed to omit the provider -> keyring tests `open with the other provider`, `AAD format is pinned`, `errors carry neither...` fail, and test-db `provider swap` fails. Restored; keyring tests 12/12 green again.

### Checks (actual output summary)
Postgres 16 started on TCP 127.0.0.1:54329 via initdb/pg_ctl (as `postgres`, `--auth=trust`), `DB_TEST_URL=postgresql://postgres@127.0.0.1:54329/postgres`; data directory deleted afterwards.
- typecheck: all workspaces Done, no errors.
- lint: all workspaces Done, no errors.
- format: no `format` script exists in this repo; not run.
- test: core 834, sources 35, ai 184, db 108 (20 files), worker 299, web 352 passed.
- build: apps/web build Done.
- test:db: 22 files, 122 tests passed.
- db:check: `db:check OK` (both runs, including after rollback/re-apply).
- check:service-key: OK, 0 hits for the sentinel master key and `STOKTOK_AI_KEYS_MASTER_KEY`.
- check:deploy-env: OK (after the docs/deploy.md row, see below).

### Out-of-plan files
- docs/deploy.md: one row `STOKTOK_AI_KEYS_MASTER_KEY | web, worker | reserved | y` in the env table. `check:deploy-env` fails without it (it diffs the table against .env.example).
- packages/db/test-db/types.test.ts: added `'bytea'` to the `HANDLED` set (line 17). The test failed on the new bytea columns; pg returns Buffer untouched and the new round-trip tests cover it.

### Follow-ups (noticed, not done)
- F1 (STK-084): runbook items from plan.md (generate key, environment secret, deploy workflow, `check-deploy-env.sh` format check, Vault row cleanup on Supabase). docs/deploy.md lists the new variable as `reserved`; STK-084 should change it to required.
- F2 (STK-083): baseline reproduces ai_keys without Vault guard, RLS or grants; remove the Vault stub.
- F3 (STK-084): confirm `ai_keyring_invalid` never appears after cutover.
- F4: specific Settings error for `NOT_CONFIGURED` on save.
- F5: per-provider read status. F6: multi-version keyring.
- The repo has no `format` script, so "run pnpm format" in the implementer rules is a no-op here.

### Scope self-check
- Could the diff be smaller? No; the two out-of-plan edits are one table row and one set member.
- Diff size: about +475 / -227 tracked lines, plus new files (keyring.ts ~100, keyring.test.ts ~130, ADR ~60, migration ~45). Not committed.
