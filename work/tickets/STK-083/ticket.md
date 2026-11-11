# STK-083: Plain-Postgres baseline migration, migrate runner and db:check rewrite (STK-080 slice d)

| Field | Value |
|---|---|
| State | REVIEW |
| Priority | P1 |
| Areas | db, security |
| Attempts | 1 |
| Created | 2026-11-11 |
| PR | — |

## Goal
Split from STK-080 (see work/tickets/STK-080/plan.md "Split proposal"; consults in work/tickets/STK-080/), re-scoped on 2026-11-11 to the deployment repo's shared-Postgres standard. Scope:

One squashed baseline plus rollback under a new `db/migrations` (old `supabase/` files kept read-only for reference and excluded from runners). No Supabase roles, no Vault, no RLS, no `grant`/`create role` in migrations: the single `stoktok` role owns everything. A Node migrate runner modelled on TuDoCuaTui `server/migrator.js` (forward-only, checksum table, advisory lock, one transaction per file, exit codes 0/1/2, never logs the URL), shipped in the worker image as the `migrate` command. db:check rewritten for the single-owner model: runs migrations as a non-superuser owner role created like `postgres/sql/app-db.sql` in the deployment repo, a `stoktok_nobody` role is denied, `aclexplode` PUBLIC checks, rollback leaves no tables/functions/sequences/types. `test:db` template switched to the baseline. CI Postgres image moves to 17 (production major). A recorded normalised `pg_dump --schema-only` diff vs Supabase (grants and Vault excluded) proves the squash is faithful.

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
CLAUDE.md Stack, R2, R3, R5, R6, R8; ADR 0010 (from STK-080). Reference repos: `mmlabs-online/deployment` (`postgres/`, `apps/tudocuatui/`, `.github/workflows/deploy-tudocuatui.yml`), `mmlabs-online/TuDoCuaTui` (`server/db.js`, `server/migrator.js`, `db/migrations/README.md`, `work/decisions.md` D23–D25). Depends on STK-082.

## Acceptance criteria
- [ ] Every item in the scope above is done, following the shared-Postgres standard.
- [ ] Production keeps working: until STK-084's cutover no stoktok release is cut, and nothing in this slice changes the running release.
- [ ] (from STK-082 plan F2) The baseline reproduces the STK-082 `ai_keys` shape (ciphertext/iv/auth_tag/key_version/last4/updated_at with their checks) without the real-Vault guard, RLS or grants; drops the db:check Vault stub; lists `ai_keys` as an intentional difference from Supabase in the recorded schema diff.
- [ ] `typecheck`, `lint`, `test`, `test:db` and `db:check` green; changed `packages/db` logic has tests.

## Notes / answers from Ming
- 2026-11-11 (orchestrator): split from STK-080 per its plan.md; Ming's decisions are in work/tickets/STK-080/ticket.md (Postgres container on a shared Docker network, squashed baseline, pg + Kysely, accept Supabase Free pausing).
- 2026-11-11 (Ming): re-scoped to the deployment repo's shared-Postgres standard (see above); replaces the earlier interim plan of pointing production at Supabase's Postgres over TLS and the stoktok_owner/stoktok_app role pair.
- Ming's manual step: none (no release is cut for this slice).
- 2026-11-11 (orchestrator, after planning): narrowed to slice 1 (baseline + faithfulness proof + test:db template + CI on PG17) per plan.md; the db:check rewrite moved to STK-086 and the migrate runner to STK-087.
