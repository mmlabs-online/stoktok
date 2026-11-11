# Review — STK-082

## Attempt 1 — 2026-11-11
Verdict: PASS

Reviewed commit 87fed4f (`git diff origin/main...HEAD`).

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0, all workspaces Done.
- lint: `pnpm lint` exit 0, all workspaces Done.
- test: `pnpm test` exit 0. core 834, sources 35, ai 184, db 108 (20 files), worker 299, web 352 passed. Matches impl-log.
- build: `pnpm build` exit 0 (apps/web Done).
- test:db: ran against a throwaway Postgres 16 started with initdb/pg_ctl on TCP `127.0.0.1:54331` (no Docker), `DB_TEST_URL=postgresql://postgres@127.0.0.1:54331/postgres`. Result: 22 files, 122 tests passed. Matches impl-log. (My first run failed with ECONNREFUSED because the sandbox removed the postgres user's access to the data directory mid-run. Server log: `PANIC: could not open file .../global/pg_control: Permission denied`. This was environmental. I moved the cluster to a `mktemp -d` directory and the re-run was green.)
- db:check: `pnpm db:check` exit 0, `db:check OK`. It applies the full chain, including `20261111000100_ai_keys_app_encryption.sql`, then runs the checks, rolls back, re-applies and checks again.
- check:service-key: exit 0, `OK: no secret or AI SDK material in client bundle`. The build ran with a random sentinel master key, and the needles include `STOKTOK_AI_KEYS_MASTER_KEY`.
- check:deploy-env: exit 0, `OK: deploy env lists consistent`.
- format: there is no format script in this repo, so it was not applicable.

### AAD mutation proof (re-run by reviewer, on a copy of the repo; the working tree was not touched)
- Mutant 1: the AAD drops the provider (`stoktok:ai_keys:v1||${keyVersion}`). `keyring.test.ts` gives 3 failed / 9 passed. The failures are `open with the other provider throws`, `the AAD format is pinned` and `errors carry neither...`. In test-db `ai-keys.test.ts`, `provider swap ... no partial map` fails (1 failed / 15 passed). This matches the impl-log claim exactly.
- Mutant 2 (extra): `readAiKeySecrets` skips a row that fails to open (`continue`, which gives a partial map). 4 test-db tests fail: wrong key, provider swap, tampered row, key_version 2.
- Mutant 3 (extra): the `keyring.state !== 'ok'` guard is removed from `saveAiKey`. `saveAiKey with no or an invalid master key: NOT_CONFIGURED and nothing is written` fails.

### Fail-closed matrix (ADR 0009 §5 kept, ADR 0011)
| Rows | Master key | Behaviour | Evidence |
|---|---|---|---|
| none | absent / invalid | `{}` (env fallback) | `repos/ai-keys.ts` returns `{}` before the keyring check; test-db `no rows and no master key: readAiKeySecrets returns {}` (both absent and invalid) |
| some | absent / invalid | `NOT_CONFIGURED` | test-db `rows and no master key, or an invalid one: NOT_CONFIGURED` |
| some | wrong | `MAPPING`, no cause | test-db `rows and a wrong master key` |
| some | ok, one row bad (swap / tag / version / last4) | whole read rejects with `MAPPING` | 4 test-db cases; mutant 2 shows the all-or-nothing behaviour is pinned |
| save | absent / invalid | `NOT_CONFIGURED`, 0 rows written | test-db case; mutant 3 |
| delete / list | absent | work (recovery path) | test-db `deleteAiKey and listAiKeyMeta work on a handle with no master key` |
A rejection reaches `AiClient.generate` and becomes `provider_unavailable` with no env fallback. `packages/ai/src/keys.ts:36-46` propagates the rejection; `packages/ai/src/client.ts:119-124` catches it and returns `fail('provider_unavailable')`. Both files are unchanged.

### Migration guard (never applied to Supabase production)
I applied `20261111000100_ai_keys_app_encryption.sql` with `psql --single-transaction` to scratch databases:
- no `vault` schema (the shared postgres:17 case): applies.
- a `vault` schema with no comment (what Supabase Vault looks like): `ERROR: refusing to apply on a database with Supabase Vault (ADR 0011)`, exit 3, and `ai_keys` was not created.
- a `vault` schema with the comment `'stoktok db:check vault stub'`: applies.
The guard is the first statement, and the `drop function`s come after it. The guard uses `is distinct from`, so any comment other than the exact stub marker, including NULL, refuses. test-db `migration guard › refuses a database with a real (non-stub) Vault` passes. No `.github/`, Dockerfile, compose or deploy workflow changes; `.github/workflows/{ci,release}.yml` do not apply `supabase/migrations`. The migration header (lines 4-5), `supabase/README.md` and ADR 0011 "Consequences" all say it must never be applied to Supabase.

### Public functions unchanged
- `git diff origin/main...HEAD -- packages/db/src/index.ts packages/db/src/pg/index.ts apps/web/server/ai-keys.ts packages/ai` is empty.
- `apps/web/server/ai.ts` and `apps/worker/src/ai.ts` have comment-only changes (one line each).
- The signatures of `saveAiKey`, `deleteAiKey`, `listAiKeyMeta` and `readAiKeySecrets` are identical (`packages/db/src/repos/ai-keys.ts`), and typecheck is green.

### Acceptance criteria
- [x] 1 New forward migration with format/last4 checks. Evidence: `supabase/migrations/20261111000100_ai_keys_app_encryption.sql:25-33`; db:check `ai_keys_columns`, `ai_keys_constraints` and `ai_keys_privileges` pass on both runs.
- [x] 2 `ai_key_set/delete/secrets` dropped. Evidence: migration lines 20-22; db:check `ai_key_functions_gone`; r3-guard `the dropped Vault wrappers ... appear in no TS/JS file`.
- [x] 3 AES-256-GCM in `packages/db/src/keyring.ts`, the AAD binds the provider, and the master key is 32 bytes of base64 and server-only. Evidence: `keyring.test.ts` 12/12; r3-guard env-name, cipher, `keyringOf` and import guards; check:service-key; mutant 1.
- [x] 4 Public functions unchanged. See above.
- [x] 5 Fail closed, never a partial map. See the matrix and mutants 2-3.
- [x] 6 Save without a usable keyring never writes. Evidence: test-db `saveAiKey with no or an invalid master key ... nothing is written`.
- [x] 7 ADR 0011 supersedes 0009. Evidence: `docs/adr/0011-...md`, the ADR 0009 status line, ADR 0010 §6/§8, the spec line, CLAUDE.md Conventions and `supabase/README.md`.
- [x] 8 checks.sql ai_key sections rewritten; the definer allowlist is empty and NULL-safe. Evidence: `scripts/db-check/checks.sql` `security_definer_allowlist` uses `if exists (... prosecdef)`; db:check green.
- [x] 9 r3-guard rewritten. Evidence: `packages/db/src/r3-guard.test.ts`, with fixtures for every new regex; db tests 108 pass.
- [x] 10 Production keeps working. There are no deploy/CI/compose changes, and the guard was proven above.
- [x] 11 typecheck, lint, test, test:db and db:check are green, and check:service-key passes. Changed `packages/db` logic is tested (keyring.test.ts, client.test.ts, test-db/ai-keys.test.ts).

Ming verification after merge: none for this ticket (per plan). F1-F3 go to STK-083/084.

### Scope
Every changed file is in the plan's file list, except the two out-of-plan files below. Both are justified in impl-log:
- `docs/deploy.md`: one env-table row. `check:deploy-env` diffs this table against `.env.example`, so it fails without the row. Verified green with it.
- `packages/db/test-db/types.test.ts`: adds `bytea` to `HANDLED`. The test enumerates every column type in public, so the new bytea columns require it. pg returns a Buffer, and the round-trip tests cover it.
`work/backlog.md` and `ticket.md` are orchestrator bookkeeping.

### Issues
None.

### Rules R1–R10
No violations found.
- R3: the master key is read only in `packages/db/src/pg/client.ts:92` from the passed env object. It is not in `NEXT_PUBLIC_*` and is absent from the client bundle (check:service-key). Plaintext and ciphertext are bound parameters only. Errors carry no cause.
- R7: in plan (see Scope).
- R8: checks green, and logic tests were added.

### Nits (do not block)
- `packages/db/src/repos/ai-keys.ts` (`saveAiKey`): `keyring.seal` is outside `q()`. A seal failure (practically impossible with an `ok` keyring) would throw a plain `Error('ai keyring: seal failed')` instead of a `DataError`. `apps/web/server/ai-keys.ts` still maps it to `AI_KEY_DB_ERROR` with code `unknown` and leaks nothing. Wrapping it as `DataError('MAPPING', …)` would be more uniform.
- The test-db guard test covers only the refusal. The no-`vault`-schema path (the shared postgres:17 case) is exercised only implicitly. I verified it manually above. STK-083 removes the guard anyway.
- No rows with an *invalid* master key gives the env fallback, with only the one-time `ai_keyring_invalid` log. This matches the ticket and the ADR 0011 table. Worth watching in F3.

### Follow-ups (out of scope)
- F1-F6 as listed in plan.md and impl-log: STK-084 runbook and deploy wiring, including changing `docs/deploy.md` `STOKTOK_AI_KEYS_MASTER_KEY` from `reserved` to required with a format check; the STK-083 baseline; the `ai_keyring_invalid` log watch; a Settings `NOT_CONFIGURED` error code; per-provider read status; a multi-version keyring.
- This diff touches migrations, env and secrets, so the `security-ai-generated-code-auditor` should run at REVIEW per CLAUDE.md. No `security-review.md` exists for this ticket yet.
