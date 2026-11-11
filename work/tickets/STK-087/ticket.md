# STK-087: Migrate runner and worker `migrate` command (STK-083 split)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | db, security, architecture |
| Attempts | 0 |
| Created | 2026-11-11 |
| PR | — |

## Goal
Split from STK-083 (see work/tickets/STK-083/plan.md "Split proposal" and decisions; consult in work/tickets/STK-083/consult-database-optimizer.md). Scope:

`packages/db/src/pg/migrate.ts`, a port of TuDo `migrator.js`: forward-only; `schema_migrations` table; sha256 checksum with CRLF normalisation; advisory lock key above 2^31; GUC `stoktok.migrating`; one transaction per file with `lock_timeout` and `statement_timeout`; dedicated `pg.Client` with `application_name: stoktok-migrate`; exit codes 0/1/2; never logs the URL. URL read only via a new accessor in `pg/client.ts` (R3, r3-guard). Worker `cli.ts migrate` subcommand with directory resolution (image `../migrations`, repo `db/migrations`). Dockerfile `COPY db/migrations ./migrations`, and verify `.dockerignore`. `check-image.sh` smoke: `migrate` without URL exits 2; with an unreachable DB exits 1 with no leak. Unit tests for `parseMigrationFilename`, `checksum` and `planMigrations`. test:db: owner role `stoktok_test_owner` (idempotent, 42710-safe, never dropped); template built via `runMigrations` as that role; clones `owner <role>`, and `freshDb` connects as the owner. Integration tests: idempotent re-run; checksum mismatch exits 1; a failing file rolls back with no row; concurrent runners serialise; DB-ahead applies nothing; `schema_migrations` holds exactly the baseline row. `schema.ts` vs `information_schema` drift test. Areas: db, security, architecture.

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
CLAUDE.md R2, R3, R7, R8; ADR 0010, ADR 0011. Reference: `/home/user/deployment/postgres/sql/app-db.sql`, `/home/user/tudocuatui/server/migrator.js`. Depends on STK-083 (independent of STK-086).

## Acceptance criteria
- [ ] Every item in the scope above is done, following the decisions in STK-083 plan.md.
- [ ] Production keeps working: no stoktok release is cut until STK-084.
- [ ] `typecheck`, `lint`, `test`, `test:db` and `db:check` green; new logic has tests.

## Notes / answers from Ming
- 2026-11-11 (orchestrator): split from STK-083 per its plan.md; no manual step for Ming.
