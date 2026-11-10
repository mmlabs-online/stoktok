## Attempt 1 — 2026-11-10

Slice (a) only. The Settings card and actions are STK-076 (the plan's "STK-075" follow-up).

### Files touched
| File | Required because |
|---|---|
| supabase/migrations/20261110000200_ai_keys.sql | AC2: Vault guard, `ai_keys`, 3 definer wrappers, revokes/grants |
| supabase/rollback/20261110000200_ai_keys.down.sql | AC2 rollback |
| scripts/db-check/bootstrap-roles.sql | TEST-ONLY Vault stub |
| scripts/db-check/checks.sql | `ai_keys` in tables_exist plus the new check blocks |
| supabase/README.md | Vault section |
| packages/core/src/ai/keys.ts, keys.test.ts, index.ts | shared key format rule, tests, export |
| packages/db/src/repos/ai-keys.ts, ai-keys.test.ts, index.ts | repo (no `cause` on errors), tests, export |
| packages/db/src/r3-guard.test.ts | two new guard cases |
| packages/ai/src/keys.ts, keys.test.ts, index.ts | resolver and precedence, tests, export |
| packages/ai/src/client.ts, client.test.ts | `resolveProviders` per generate(), fail closed |
| apps/web/server/ai.ts, ai.test.ts | wiring and tests |
| apps/worker/src/ai.ts, ai.test.ts | wiring and tests |
| docs/adr/0009-ai-provider-keys-in-vault.md | ADR plus the manual smoke test |
| docs/spec-v1.md, CLAUDE.md | exact wording from the plan (step 10), plus "`.env.example` lists keys with no values." kept in CLAUDE.md |

### Tests added / changed
- core keys.test.ts (6), db repos/ai-keys.test.ts (11), ai keys.test.ts (8), ai client.test.ts › resolveProviders (7), web server/ai.test.ts (+3), worker ai.test.ts (+2), r3-guard (+2).
- db:check blocks: ai_keys_columns, ai_keys_privileges, ai_key_roundtrip, ai_key_negatives, ai_key_functions_locked, security_definer_allowlist, ai_key_vault_direct_denied (stub only).
- All key values in tests are obvious `DUMMY-...` sentinels.

### Checks (actual output summary)
- typecheck: green (all 6 projects).
- lint: green.
- test: core 785, sources 35, ai 184, db 187 (1 todo), worker 295, web 317; all passed.
- db:check: "db:check OK" (local PG16 binaries, Vault stub; apply, checks, rollback to 0 tables, re-apply, checks).
- check:service-key: "OK: no secret or AI SDK material in client bundle".

### Deviation from the plan
- The migration tests length with `char_length(p_key) between 20 and 256` plus a `^[\x21-\x7e]+$` regex. Postgres caps a regex repetition count at 255, so `{20,256}` fails.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Ming runs the manual Vault smoke test (ADR 0009) on the real project and records step 7 as an ADR amendment. The stub signatures of `vault.create_secret` / `vault.update_secret` are unverified offline.
- Slice (b) STK-076: card and actions; call `validateAiKeyFormat` from the actions.

### Scope self-check
- Could the diff be smaller? No; every file is listed in the plan.
- Diff size: see `git diff --shortstat` (tracked files) plus 10 new files.

## Attempt 2 (REWORK: security-review attempt 1 findings F1, F2, F3, F5, F6, F7, F8, F10)

### Files touched
| File | Required because |
|---|---|
| docs/adr/0009-ai-provider-keys-in-vault.md | F1 threat model, F2 logging checks, F3 smoke steps 3b/5b, F8 step 5c, F7 wording, F10 note, F5 decision 9, F6 escaped LIKE |
| packages/db/src/repos/ai-keys.ts, ai-keys.test.ts | F5: null/empty secret throws MAPPING, plus test |
| packages/db/src/r3-guard.test.ts | F7: ai_key_set / ai_key_delete limited to the ai-keys repo and its test |
| packages/core/src/ai/keys.ts | comment reworded so it no longer names ai_key_set (guard) |
| supabase/rollback/20261110000200_ai_keys.down.sql, scripts/db-check/checks.sql | F6: `like 'stoktok\_ai\_key\_%'` |

### Checks
typecheck, lint green; test: core 785, sources 35, ai 184, db 189 (+1 todo), worker 295, web 317 passed; db:check OK; check:service-key OK.

### Out-of-plan files
None beyond the list above (all within the rework scope). Not committed.
