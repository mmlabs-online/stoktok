# STK-086: db:check rewrite for the single-owner model (STK-083 split)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | db, security |
| Attempts | 0 |
| Created | 2026-11-11 |
| PR | — |

## Goal
Split from STK-083 (see work/tickets/STK-083/plan.md "Split proposal" and decisions; consult in work/tickets/STK-083/consult-database-optimizer.md). Scope:

Vendored byte-identical `scripts/db-check/app-db.sql` with provenance in the header; `db-check.sh` applies `db/migrations` via psql `--single-transaction` **as the owner login** (decision 2), with a one-to-one `db/rollback` parity check, `PG_BIN` default 17 and a PG-major assertion (fail when `CI` is set, warn locally). URL mode: app name `DB_CHECK_APP` (default `stoktok`); refuse when any non-system database exists or the role/db already exists; password via stdin `\set` / `PGPASSWORD`, never argv. `checks.sql` runs as owner: delete the `set local role service_role` and `reset role` pairs; rename `service_role_can_*` to `owner_can_*`; replace the RLS-on and anon checks with RLS-off and `pg_policies` empty; delete `ai_keys_privileges`; replace the role half of `ai_functions_locked`; owner `pg_roles` flags all false; `create role` gives 42501; `pg_extension = {plpgsql}`. New `checks-acl.sql` runs as superuser in the app DB: `stoktok_nobody` denied (has_*_privilege plus `set local role` loops); `aclexplode(coalesce(acl, acldefault(kind, owner)))` with no non-owner grantee on relations, sequences, functions, types, schema `public` and the database; `pg_default_acl` empty; everything owned by the app role. Rollback phase: `pg_class`/`pg_proc`/`pg_type` all 0, and roles and `public` owner/ACL unchanged; then re-apply and re-check. Move `bootstrap-roles.sql` (with the Vault stub) out of db:check to `supabase/legacy/`, and repoint `schema-diff.sh`. Legacy-reference guard test: nothing outside `supabase/`, `work/`, `docs/`, `.claude/` and `scripts/schema-diff.sh` references `supabase/migrations` or `supabase/rollback`. Update the `supabase/README.md` PG16 text. Closes "drops the db:check Vault stub" (F2) and the ticket's db:check scope. Areas: db, security.

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
CLAUDE.md R2, R3, R7, R8; ADR 0010, ADR 0011. Reference: `/home/user/deployment/postgres/sql/app-db.sql`, `/home/user/tudocuatui/server/migrator.js`. Depends on STK-083.

## Acceptance criteria
- [ ] Every item in the scope above is done, following the decisions in STK-083 plan.md.
- [ ] Production keeps working: no stoktok release is cut until STK-084.
- [ ] `typecheck`, `lint`, `test`, `test:db` and `db:check` green; new logic has tests.

## Notes / answers from Ming
- 2026-11-11 (orchestrator): split from STK-083 per its plan.md; no manual step for Ming.
- 2026-11-11 (orchestrator): from STK-083 security review attempt 1 — run the db:check migrations as the non-superuser owner so CI proves every PR applies without superuser; extend db:check ACL checks to pg_class.relacl, pg_namespace.nspacl and extra schemas. (The open question about CONNECT is answered: deployment app-db.sql:25 revokes ALL on the app database from PUBLIC.)
