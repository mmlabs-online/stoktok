## Attempt 1 — 2026-11-18
Verdict: REWORK

Reviewed commit 2cfe033 (code). HEAD 8f02c14 adds only `review` and `security-review.md` bookkeeping; `git diff 2cfe033 HEAD` touches no code.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck`, exit 0.
- lint: `pnpm lint`, exit 0.
- test: `pnpm test`, exit 0. core 834, sources 35, ai 184, db 169 (23 files), worker 310, web 360. Matches impl-log.
- test:db: throwaway local PG 16.15. TCP on 127.0.0.1:55432 with `host … scram-sha-256` and a password-authenticated superuser (`R3v!ewPw`). Data dir deleted afterwards.
  - Fresh server: 27 files, 154 tests passed. `owner.test.ts` (verbose) passed all 6.
  - **After `db:check` on the same server: 1 failed | 153 passed.** See Issue 1.
- db:check: `DB_CHECK_URL=<same server> pnpm db:check` right after test:db printed `db:check OK`, exit 0.
- check:deploy-env: `OK: deploy env lists consistent`.
- `bash -n scripts/*.sh`: all OK.
- CI, PR #75 (draft, mmlabs-online/stoktok), run 44223722043 on 8f02c14:
  - typecheck, lint, test, test:db (PG 17), check:service-key, check:deploy-env and db:check: success.
  - test:move: still in progress when this review was written.
  - The run on a60f3be was cancelled (superseded).
  - The PG 17 evidence for criteria 10, 11 and 13 depends on this CI run. test:move's result is not yet known.

### Negative proofs (run by reviewer; temporary edits reverted with `git checkout`, tree clean)
- **`owner` removed from both `create database` statements in `harness.ts`:**
  - `owner.test.ts › freshDb runs as the non-superuser owner` failed with `datdba: "postgres"` (expected `stoktok_test_owner`).
  - `emptyDb runs as the owner…` failed the same way.
  - So the test detects the regression.
- **Role tampered to `superuser createrole createdb replication bypassrls`:** the global setup's `ensureOwnerRole` reset all five flags to false, and `freshDb runs as the non-superuser owner` passed.
- **Role granted membership in `postgres` (superuser), and separately in `pg_write_all_data`:**
  - Setup failed closed: `pnpm test:db setup failed: stoktok_test_owner is a member of another role; remove the membership`, exit 1.
  - No `stoktok_test_*` database was left over.
  - Neither the admin password nor any 64-hex string appeared in the output.
- **Owner password tampered (`alter role … password 'tampered'`):** setup restored it, and the owner tests connected.
- **Password handling:**
  - `owner.ts:34` validates `^[0-9a-f]{64}$` before `begin` and before any interpolation. Unit test `ensureOwnerRole: rejects a bad password before any query` records zero queries.
  - `global-setup.ts` prints only `error.message`.
  - The server log (`log_min_error_statement=error`) had no `password` statement across all runs.
  - test:db output had no admin password.

### Acceptance criteria (plan verification table)
- [x] 1 `owner.ts` exports — evidence: `packages/db/test-db/owner.ts:5-14`, `:33`, `:62`. The guard test `owner role lock key differs from MIGRATION_LOCK_KEY` passes (`7865372190` ≠ `7865372087`, > 2^31).
- [x] 2 `ownerPassword` — evidence: `owner.ts:17-21`. The 3 `ownerPassword` unit tests pass, including percent-decoding and the no-password case.
- [x] 3 `asOwner` — evidence: `owner.ts:24-30`. Unit test `asOwner: swaps userinfo…` passes and asserts that the admin password is absent.
- [x] 4 `ensureOwnerRole` — evidence: `owner.ts:33-59`.
  - The 5 fake-client tests pass: bad password, create path, alter path, 42710/23505 retry once, and memberships fail closed.
  - The real-PG tests `…repairs flags` and `…refuses a role with memberships` pass on a fresh server.
  - The reviewer's negative proofs above also pass.
  - `grep "drop role" packages/db/test-db` finds only the test's own membership role (`owner.test.ts:124`) and a test assertion. The owner role is never dropped.
- [x] 5 global-setup — evidence: `global-setup.ts:65-71`. Role, template, `ownPublicSchema` and the migration as owner all run inside the `try`. Cleanup is defined first (`:54-64`). `template objects are owned by the owner` passes.
- [x] 6 harness — evidence: `harness.ts:42-43` and `:61-71`. Create, drop and terminate stay on `admin()`. `freshDb…` and `emptyDb…` pass.
- [x] 7 `pg-proxy.ts` unchanged — evidence: not in `git diff --stat origin/main...HEAD`. `session.test.ts` is green in test:db.
- [x] 8 no escalation — evidence: `the owner cannot escalate` passes (42501 ×2). The NO* flags, `datdba`, the `public` owner and `public_grants = 0` are asserted at `owner.test.ts:31-48`.
- [x] 9 db:check name guard — evidence: `test owner role never trips db:check's refusal` passes. It reads `scripts/db-check.sh:26-28`.
- [ ] 10 every test:db test passes as the owner — FAILED in the "db:check, then test:db on the same server" order. See Issue 1. Passes on a fresh server and in CI.
- [x] 11 db:check after test:db — evidence: reviewer local run `db:check OK`. CI step `Run pnpm db:check` succeeded. test:move in CI was pending at review time.
- [x] 12 docs — evidence: ADR 0010 §12 (one appended sentence) and the `db/migrations/README.md` bullet at line 6.
- [ ] 13 five checks green — blocked by Issue 1 (test:db goes red deterministically after a URL-mode db:check).

Ming verification after merge: none (plan).

### Issues
#### Issue 1 — 🔴 blocker — test depends on PUBLIC CONNECT on the admin database
- **Where**: `packages/db/test-db/owner.test.ts:106`. The line is `await withClient(asOwner(ADMIN), (c) => c.query('select 1'));`.
- **Expected**: `pnpm test:db` stays green on any local superuser server. That includes one where `pnpm db:check` has run in URL mode. `scripts/db-check.sh:18` documents that db:check revokes CONNECT/TEMPORARY from PUBLIC on `postgres` and `template1` and does not undo it. The README bullet this ticket adds also promises that the two commands coexist on one throwaway server.
- **Actual**:
  - `asOwner(ADMIN)` connects the non-superuser owner to the admin database (`postgres`).
  - After any URL-mode db:check on the same server, that database has `datacl = {postgres=CTc/postgres}`.
  - The test then fails with `FATAL 42501 permission denied for database "postgres"` (`User does not have CONNECT privilege`).
  - Reproduced 7 times in a row, both via `pnpm test:db` (1 failed | 153 passed) and the single file.
  - After `grant connect on database postgres to public` it passes again (6/6), which confirms the cause.
  - On main this order works, because everything runs as the superuser. CI only passes because test:db runs before db:check.
  - The same failure occurs on any server set up the shared-Postgres way (app-db.sql revokes PUBLIC CONNECT on `postgres`).
- **Fix instruction**:
  - Prove the "password unchanged" step by connecting as the owner to a database the owner owns, not to the admin database.
  - For example, in that test, after the repair: `const t = await freshDb(); try { await withClient(t.url, (c) => c.query('select 1')); } finally { await t.drop(); }`. `t.url` is built with `asOwner`, so it still proves the derived password works.
  - Do not grant CONNECT on `postgres`, and do not change db:check.
  - Re-verify in this order on one throwaway server: `pnpm test:db`, then `DB_CHECK_URL=… pnpm db:check`, then `pnpm test:db` again. Record all three in impl-log.

### Rules R1–R10
- No violations found.
- R3: the owner URL is derived from `DB_TEST_URL` in test code only, and the production env-var name is not referenced.
- R7: all changed files are in the plan's file list; no out-of-plan files.
- R8: pure helpers are unit-tested.
- R8 is still not met for test:db while Issue 1 is open.

### Nits (do not block)
- `harness.ts:61-68`: if `ownPublicSchema` throws, the just-created database is only dropped by the global teardown sweep, not by `emptyDb`. That is acceptable (the sweep matches the name).
- `owner.ts:41-46`: when the membership check refuses, the transaction rolls back, so tampered NO* flags also stay until someone removes the membership. This fails closed (setup exits 1) and is documented in security-review.md. Mentioned only for awareness.
- impl-log claims "Not done: the temporary negative proof". The reviewer did it (see above); no action needed.

### Follow-ups (out of scope)
- Consider documenting the order dependency in `scripts/db-check.sh` / ADR 0010 §12. URL-mode db:check permanently changes the server's PUBLIC ACLs on `postgres` and `template1`, which can affect any later non-superuser test.
