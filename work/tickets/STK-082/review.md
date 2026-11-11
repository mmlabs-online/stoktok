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

## Attempt 2 — 2026-11-11
Verdict: PASS

Reviewed commit d640e68 (`git diff 85902a3 HEAD`, i.e. everything since the attempt 1 review).

### Checks (run by reviewer)
- lint: `pnpm lint` exit 0, all workspaces Done.
- test: `pnpm test` exit 0. core 834, sources 35, ai 184, db 108 (20 files), worker 299, web 352 passed. Identical to attempt 1 and matches impl-log attempt 2.
- typecheck: `pnpm typecheck` exit 0 (extra; no code changed).
- build, test:db, db:check, check:service-key: not re-run. No code, SQL, script or config file changed since attempt 1, where all were green.

### Scope
`git diff --stat 85902a3 HEAD`: `docs/adr/0011-ai-provider-keys-app-side-encryption.md` (+5/-2), `work/tickets/STK-082/impl-log.md` (attempt 2 section), plus orchestrator bookkeeping in `ticket.md` (Ming's note, Attempts 2) and `work/backlog.md` (attempts 2). No code changed. Nothing else changed.

### Ming's note vs ADR text
🟡2 (cutover), ADR 0011 Consequences bullet 3:
- [x] New keys at Anthropic and Google, entered on Settings (not the old values), then the old keys revoked. In that order.
- [x] `stoktok_ai_key_%` Vault rows deleted only after the rollback window closes (proposed 14 days, as in security-review.md), with the reason (an early delete makes a rollback silently drop to env keys or no keys).
- [x] "or" replaced by "and": the bullet explains that deleting Vault rows does not purge Supabase backups/PITR, so the provider keys are replaced as well.

🟡3 (master-key rotation), ADR 0011 Rotation runbook:
- [x] Step 1: "or accept that they are discarded" is gone. Old-key rows are not discarded; reads fail with `MAPPING`, and both providers stay disabled until the rows are deleted.
- [x] Step 5: on suspected master-key compromise, rotate the provider keys too.
- [x] Step 6: backups (7d/4w/6m, matching the pg-backup retention) hold old-key ciphertext. Either rotate the provider keys or destroy the old master-key copy once those backups have aged out.

### ADR vs code behaviour
- Rows sealed under another key → `MAPPING`: `packages/db/src/repos/ai-keys.ts:89-93`. `keyring.open` throws on a GCM auth failure, which is rethrown as `DataError('MAPPING', 'ai_keys', 'read', …)`.
- Both providers disabled: `readAiKeySecrets` is all-or-nothing (`ai-keys.ts:70-99`; any row failing throws, never a partial map). The resolver turns the throw into `provider_unavailable` (attempt 1 fail-closed matrix), so the env fallback does not engage for either provider. The ADR's "both providers stay disabled" is correct.
- Delete without a key: `deleteAiKey` (`ai-keys.ts:53-57`) never calls `keyringOf`, so step 1 and the Loss procedure ("delete needs no keyring") are both correct.

### Issues
None.

### Rules R1–R10
No violations. R7: doc-only, inside the plan's ADR file and Ming's note.

### Nits (do not block)
- Rotation steps 5 and 6 overlap a little (both may say to rotate provider keys). They are still accurate. Merging them into one step would be tighter.
- impl-log attempt 2 says "not committed", but the orchestrator committed it as d640e68. This is bookkeeping only.

### Follow-ups (out of scope)
- The STK-084 ticket should carry the same cutover order (new provider keys → revoke old → delete Vault rows after the rollback window), as security-review.md 🟡2 asks ("one runbook line in ADR 0011 and in STK-084"). The ticket.md edit is orchestrator-owned.
