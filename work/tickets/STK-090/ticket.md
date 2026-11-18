# STK-090: Owner-role test:db (STK-089 split)

| Field | Value |
|---|---|
| State | REWORK |
| Priority | P2 |
| Areas | db, security |
| Attempts | 1 |
| Created | 2026-11-17 |
| PR | — |

## Goal
Split from STK-089 (see work/tickets/STK-089/plan.md "Split proposal"; consult in work/tickets/STK-083/consult-database-optimizer.md §6). Run test:db as a non-superuser owner role so tests prove migrations and repos work without superuser. Scope:

- **New `packages/db/test-db/owner.ts`:**
  - `TEST_OWNER_ROLE = 'stoktok_test_owner'`;
  - `ownerPassword(adminUrl)`: sha256 hex of a fixed label plus the decoded admin password, so concurrent runs agree and CI's scram `pg_hba` works;
  - `asOwner(url)`: swaps the userinfo and keeps host, port, database and query;
  - `ensureOwnerRole(adminClient, password)`: inside `begin`, take `pg_advisory_xact_lock` on a fixed bigint key (not `MIGRATION_LOCK_KEY`). Then `create role … login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '<hex>'` if missing, else `alter role` with the same attributes and password. Tolerate 42710 and 23505. Validate the password as `^[0-9a-f]{64}$` before interpolating it. Never drop the role.
  - **Planner addition:** the `alter role` on an existing role re-asserts the NO* flags, so a tampered role cannot stay superuser.
- **`global-setup.ts`:** inside the existing `try`/cleanup:
  - ensure the role;
  - `create database <tpl> owner stoktok_test_owner`;
  - as admin in the template, `alter schema public owner to stoktok_test_owner; revoke all on schema public from public;`;
  - then `runMigrations` with the owner URL.
- **`harness.ts`:**
  - `freshDb` runs `create database x template <tpl> owner stoktok_test_owner` and returns the owner URL;
  - `emptyDb` runs `create database x owner stoktok_test_owner` plus the same two schema statements, and returns the owner URL;
  - create and drop stay on the admin connection. `pg-proxy.ts` keeps using the admin URL for `pg_terminate_backend`.
- **Tests:**
  - new `test-db/owner.test.ts`: a clone's `current_user` is `stoktok_test_owner`, `rolsuper` is false, and `datdba` and the `public` owner are the role;
  - unit tests in `packages/db/src/test-db-guard.test.ts` for `ownerPassword` (deterministic, 64 hex, changes with the admin password, percent-decoded) and `asOwner`;
  - a guard that reads `scripts/db-check.sh` and asserts the role name differs from the `DB_CHECK_APP` default, `NOBODY` and `CANARY_ROLE`, so STK-086's refusal never trips on it. db:check checks only those role names and non-system databases, and test:db drops every `stoktok_test_%_<pid>` database at teardown.
- **Docs:** ADR 0010 §12 (owner role) and a `db/migrations/README.md` test:db bullet.

## Shared-Postgres standard (deployment repo, Ming 2026-11-11)
Follow how TuDoCuaTui (D23–D25) and org-admin-api use the shared Postgres in `mmlabs-online/deployment`:
- `postgres:17`, reachable only as `postgres:5432` on the external Docker network `db`; no published port, no TLS on that hop.
- One login role + one database per app, same name (`stoktok`), created by `bash postgres/scripts/add-app-db.sh stoktok` (password in `postgres/secrets/apps/stoktok.password`, app listed in `postgres/config/databases`). The role owns its database and schema `public`; it has no CREATEROLE/CREATEDB/superuser. The same role runs the app and the migrations (least-privilege runtime role is a later follow-up, as in TuDo D24).
- The deploy workflow writes the URL into the host env file from the committed password file (no GitHub secret). stoktok keeps the env name `STOKTOK_DATABASE_URL` (STK-080 guards).
- Migrations: a one-shot `migrate` compose service, run by the deploy after a pre-migration dump (`pg-backup /backup.sh`) and before the app is replaced; a failed migration leaves the old release running. Pattern: TuDoCuaTui `server/migrator.js` (plain SQL `YYYYMMDDHHMMSS_name.sql`, forward-only, checksums in a migrations table, advisory lock, one transaction per file).
- Backups: automatic by the `pg-backup` sidecar for every database in `config/databases` (02:00 daily, 7d/4w/6m, offsite at 03:30).
- No RLS for single-user (TuDo D25 pattern).

**Release rule:** STK-081 to STK-083 merge to main but no stoktok release is cut until STK-084; production stays on the current Supabase-backed release until the cutover. There is no interim hop to Supabase's Postgres.

## Spec reference
CLAUDE.md R3, R7, R8; ADR 0010 §12. Depends on STK-089. Does not block STK-084 (orchestrator, 2026-11-17).

## Acceptance criteria
- [ ] Every item in the scope above is done.
- [ ] CI's db:check after test:db still passes (no refused role or database).
- [ ] `typecheck`, `lint`, `test`, `test:db` and `db:check` green.

## Notes / answers from Ming
- 2026-11-17 (orchestrator): split from STK-089 per its plan.md; no manual step for Ming. Test-harness hardening only, so P2 and not a prerequisite for the STK-084 cutover.
- 2026-11-18 (Ming): run STK-090 before the cutover (ADR 0010 order kept, not waived).
- 2026-11-18 (orchestrator): consult skipped — the scope above is already a reviewed design (STK-089 plan split + STK-083 database-optimizer consult §6).
- 2026-11-18 (orchestrator): attempt 1 = REWORK (owner.test.ts connects the owner to the admin DB `postgres`, which fails after URL-mode db:check revokes PUBLIC CONNECT). Rework scope: that blocker, plus security 🟡1 (one line: `alter role … reset all` in the same transaction, with a fake-client assertion). Security 🟡2 (SCRAM verifier instead of plaintext hex), 🟡3 (pre-flight refusal on non-test clusters; document `drop role stoktok_test_owner`), 🟡4 (membership test role leak) and the review's db:check-side-effect doc note → follow-ups in the PR.
