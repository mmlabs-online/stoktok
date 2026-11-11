# STK-088: Migration-lint tokeniser gaps and legacy-reference guard (STK-086 split)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | db, security |
| Attempts | 0 |
| Created | 2026-11-11 |
| PR | — |

## Goal
Split from STK-086 (see work/tickets/STK-086/plan.md "Split proposal"; findings from the STK-083 security review attempt 2 and review attempt 2). Scope:

STK-088 scope, in `packages/db/src/migrations-lint.test.ts` and a new `packages/db/src/legacy-reference-guard.test.ts`:
- **Lint** (from the STK-083 security review attempt 2 and review attempt 2):
  - A shared identifier-character lookbehind `(?<![A-Za-z0-9_$\u{80}-\u{10FFFF}])` (with the `u` flag) before both the dollar-tag and the E-string alternatives. This closes `$` inside identifiers, as in `x$a$`, and non-ASCII identifier prefixes.
  - A non-ASCII dollar-tag class, `[A-Za-z_\u{80}-\u{10FFFF}][A-Za-z0-9_\u{80}-\u{10FFFF}]*`.
  - A ban on block comments in migrations: any `/*` token or leftover `/*` is flagged as `block comment`. This also closes the nested-comment bypass.
  - An exported shared `BASELINE_DO_RE` const, used by both `baseline is plain create` and the fixture test.
  - Fixtures for each item:
    - `select 1 as x$a$; grant select on t to public; -- $a$`;
    - `select $é$ -- $é$; grant select on t to public;`;
    - `/* /* */ ' */ commit; -- '`;
    - `/* x */ select 1;` (flagged);
    - `select '/*';` (not flagged).
  - Add one line to `db/migrations/README.md`: "no block comments".
- **Legacy-reference guard:** walk the repo, skipping `node_modules`, `.git`, `.next`, `dist` and `coverage`. Fail if any file outside `supabase/`, `work/`, `docs/`, `.claude/` and `scripts/schema-diff.sh` contains `supabase/migrations` or `supabase/rollback`. The frozen `db/migrations/20261111000200_baseline.sql` (its provenance comment on line 1) is allowlisted by exact path. Reword `db/migrations/README.md:3` to "the old `supabase/` migration history". Add a fixture showing the matcher flags `ls supabase/migrations/*.sql`.

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
CLAUDE.md R3, R7, R8; ADR 0010. Depends on STK-086; run after STK-087 (both edit `packages/db/src/migrations-lint.test.ts`).

## Acceptance criteria
- [ ] Every item in the scope above is done, with a fixture per lint case.
- [ ] Production keeps working: no stoktok release is cut until STK-084.
- [ ] `typecheck`, `lint`, `test`, `test:db` and `db:check` green.

## Notes / answers from Ming
- 2026-11-11 (orchestrator): split from STK-086 per its plan.md; no manual step for Ming. Optional nits for its planner: `reset session authorization`, `set_config(E'role'`.
