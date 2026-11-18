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

## Attempt 2 — 2026-11-18
Verdict: PASS

Scope (orchestrator note, ticket.md): the Attempt 1 blocker (owner.test.ts connected the owner to the admin DB `postgres`) and security 🟡1 (`alter role … reset all` plus a fake-client assertion). Rework commit 9435d74 (+16/-3 code; files: `packages/db/test-db/owner.ts`, `packages/db/test-db/owner.test.ts`, `packages/db/src/test-db-guard.test.ts`, impl-log).

### Checks (run by reviewer)
Reproduction on one throwaway PostgreSQL 16.15 cluster: `initdb --auth=scram-sha-256`, password superuser `postgres`, TCP on 127.0.0.1:54391, data dir under `/var/tmp` (owned by `postgres`), stopped and deleted afterwards.
- `DB_TEST_URL=… pnpm test:db`: exit 0 — 27 files, 154 tests passed.
- `DB_CHECK_URL=… pnpm db:check` (same server): exit 0, `db:check OK` (no refused role or database).
- `pnpm test:db` again after db:check: exit 0 — 27 files, 154 tests passed. Cluster state afterwards: no `stoktok_test%` databases left; `stoktok_test_owner` has `rolsuper=f`, `rolconfig` null; `has_database_privilege('stoktok_test_owner','postgres','CONNECT') = f` — so the second run really did run with PUBLIC CONNECT revoked on `postgres` (the Attempt 1 failure condition) and passed.
- Negative proof (temporary edit removing the `reset all` line in `owner.ts:42`, reverted with `git checkout`): `src/test-db-guard.test.ts` → 2 failed (`ensureOwnerRole > create path`, `> alter path re-asserts the NO* flags`); real-PG `test-db/owner.test.ts` → 1 failed (`ensureOwnerRole is idempotent, concurrent-safe and repairs flags`, at `expect(s.rows[0].rolconfig).toBeNull()`, owner.test.ts:109). After revert: owner.test.ts 6/6 passed and the leftover `work_mem` setting was cleared.
- typecheck: exit 0.
- lint: exit 0.
- test: exit 0 — core 834, sources 35, ai 184, db 169, worker 310, web 360 passed (matches impl-log Attempt 2).
- check:deploy-env: `OK: deploy env lists consistent`.
- `bash -n scripts/*.sh`: all OK.
- Working tree clean after all runs.

CI (PR #75, REST API): the runs on 2b87abe (`ci`, `images`) concluded `cancelled` — superseded because the PR head moved to 4e8f563 (`STK-090: security review attempt 2`, touches only `work/tickets/STK-090/security-review.md`). On 4e8f563, run 44224519982 `ci` was `in_progress` at review time with typecheck, lint, test, **test:db**, check:service-key, check:deploy-env and **db:check** steps all `success`; `test:move` still running. Orchestrator: confirm the final conclusion before marking the PR ready.

### Acceptance criteria
- [x] Every item in the scope is done — Attempt 1 evidence stands; Attempt 2 adds `reset all` inside the same `begin`/advisory-lock transaction (`packages/db/test-db/owner.ts:42`), fake-client assertions on both paths (`packages/db/src/test-db-guard.test.ts:115,125`), real-PG assertion (`packages/db/test-db/owner.test.ts:106-109`; `set work_mem` then `rolconfig` null).
- [x] CI's db:check after test:db still passes — reproduced locally (test:db → db:check → test:db, all green) and CI 4e8f563 step `pnpm db:check` = success after `pnpm test:db` = success.
- [x] typecheck, lint, test, test:db, db:check green — see Checks.
- [x] Attempt 1 blocker fixed: owner.test.ts no longer calls `asOwner(ADMIN)`; the password check now connects as the owner to a `freshDb()` clone (owner.test.ts:110-116, `freshDb()` at :111). Remaining `asOwner` callers target clones/template only (`harness.ts:20`, `global-setup.ts:71`).

### Issues
None.

### Rules R1–R10
No violations found. R3: admin URL stays in the test harness; the owner password is still validated as 64 hex before interpolation (owner.ts:34). R7: diff limited to the two rework items. R8: changed logic has unit + real-PG tests, and both were shown to fail without the fix.

### Nits (do not block)
- `alter role … reset all` clears role-wide settings only, not per-database ones (`alter role … in database … set`). Harmless here: the owner connects only to freshly created clone/template databases, whose settings disappear when they are dropped.

### Follow-ups (out of scope)
- Carried from the orchestrator note for the PR body: security 🟡2 (send a SCRAM-SHA-256 verifier instead of the plaintext hex), 🟡3 (pre-flight refusal on non-test clusters; document `drop role stoktok_test_owner` as manual cleanup), 🟡4 (membership test can leak `stoktok_test_m_<pid>` if the grant fails), and the Attempt 1 doc note on db:check's side effect (revoking PUBLIC CONNECT on `postgres`).
