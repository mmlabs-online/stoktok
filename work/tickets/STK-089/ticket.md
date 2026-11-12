# STK-089: Worker migrate command, image, owner-role test:db and schema drift test (STK-087 split)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | db, security, architecture |
| Attempts | 0 |
| Created | 2026-11-12 |
| PR | — |

## Goal
Split from STK-087 (see work/tickets/STK-087/plan.md "Split proposal"; consult in work/tickets/STK-083/consult-database-optimizer.md §5–§6). Scope:

- **Worker command.**
  - New `apps/worker/src/migrate.ts` exports `resolveMigrationsDir(moduleDir, exists)`, which returns the first existing of `resolve(moduleDir, '../migrations')` (image: `/app/dist` → `/app/migrations`) and `resolve(moduleDir, '../../../db/migrations')` (repo, from `src/` or `dist/`), else the first.
  - It also exports `migrateCommand(argv, { env, dir, run = migrateFromEnv })`. Any extra argument → usage, exit 2. It prints log lines to stdout. On a `MigrationError` it prints `migrate failed: <message>[ [<code>]]` to stderr with exitCode = `err.exitCode`. On any other error it prints `migrate failed: unexpected error` with exit 1, never the message. On success it sets exit 0.
  - `cli.ts` `main`: when `argv[0] === 'migrate'`, delegate before `parseArgs`, without calling `openDb`/`createPgDb`. Add `migrate` to `USAGE`.
  - Unit tests in `migrate.test.ts` and `cli.test.ts`: `main(['migrate'])` opens no DB; extra argument → exit 2; exit codes are mapped; no message echo for unknown errors; dir resolution for the image path and the repo path (src and dist).
- **Image.**
  - `apps/worker/Dockerfile`: `COPY --from=build /repo/db/migrations ./migrations` (root-owned, read-only for `node`).
  - `.dockerignore`: verified only (`db` is not excluded; `db/rollback` is not copied into the runtime stage).
  - `scripts/check-image.sh` worker block:
    - `docker run --rm IMAGE migrate` with no URL → exit 2 with non-empty stderr;
    - with `STOKTOK_DATABASE_URL=postgres://smoke:smoke-pw@127.0.0.1:9/smoke` → exit 1 within `timeout 20`, and no `smoke-pw`/`127.0.0.1` in the output;
    - `/app/migrations` contains `20261111000200_baseline.sql` and no `*.down.sql` (ADR 0010 §9: "the image does not ship them").
  - Docker is not available in the agent session, so this is verified by `bash -n` locally and by the PR's CI `images` job.
- **Owner-role test:db.**
  - `stoktok_test_owner`: `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, created idempotently under `pg_advisory_xact_lock` on the admin connection, with 42710 (and the concurrent-create 23505) tolerated. Never dropped.
  - Its password is a deterministic value derived from the admin URL's password (sha256, hex), so concurrent runs agree and CI's scram `pg_hba` works. The derivation is shared by `global-setup.ts` and `harness.ts` through a small `test-db/owner.ts`.
  - Template: `create database tpl owner stoktok_test_owner`; then in the template as admin, `alter schema public owner to stoktok_test_owner; revoke all on schema public from public;`; then `runMigrations` connecting as the owner.
  - Clones: `create database x template tpl owner stoktok_test_owner`. `freshDb`/`emptyDb` return owner URLs (userinfo swapped); create and drop stay on the admin connection.
  - Test: a clone's `current_user` is `stoktok_test_owner` and `rolsuper` is false.
  - The role name is not one of STK-086's refused names.
- **Drift test.** `test-db/schema-drift.test.ts` parses `packages/db/src/pg/schema.ts`:
  - every `export interface …Table { col: type; }` plus the `Database` map;
  - nullable means the type contains `| null`.
  - It compares, per table, the column-name set and nullability with `information_schema.columns` for `public` (excluding `schema_migrations`) in both directions.
  - It includes a fixture showing the parser flags a missing column and a nullability flip, and a guard that the parse found 18 tables.
- **Docs.** ADR 0010 §12 (owner role) and README.

STK-084 additionally depends on STK-089.

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
CLAUDE.md R3, R7, R8; ADR 0010. Depends on STK-087.

## Acceptance criteria
- [ ] Every item in the scope above is done, following STK-087 plan.md decisions.
- [ ] Production keeps working: no stoktok release is cut until STK-084.
- [ ] `typecheck`, `lint`, `test`, `test:db` and `db:check` green; image smoke steps syntax-checked locally and proven by the PR's CI images job.

## Notes / answers from Ming
- 2026-11-12 (orchestrator): split from STK-087 per its plan.md; no manual step for Ming.
