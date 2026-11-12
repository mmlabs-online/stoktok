
## Attempt 1 — 2026-11-12

### Files touched
| File | Required because |
|---|---|
| `apps/worker/src/migrate.ts` (new) | `resolveMigrationsDir`, `migrateCommand` (criteria 1-2) |
| `apps/worker/src/migrate.test.ts` (new) | unit tests for the above |
| `apps/worker/src/cli.ts` | delegate `migrate` first in `main`; USAGE; third `migrateDeps` param (criterion 3) |
| `apps/worker/src/cli.test.ts` | `main migrate` cases |
| `apps/worker/Dockerfile` | root-owned `COPY db/migrations ./migrations` |
| `scripts/check-image.sh` | worker block: migrate exit 2, unreachable exit 1 (no leak), layout, read-only checks; trap covers `$NAME-mig` |
| `packages/db/test-db/owner.ts` (new) | owner role name, derived password, URL, ALTER ROLE sql |
| `packages/db/test-db/global-setup.ts` | `ensureOwnerRole` under advisory lock; template owned by the owner, schema re-owned as admin, migrations as owner |
| `packages/db/test-db/harness.ts` | clones and `emptyDb` owned by the owner, return owner URLs |
| `packages/db/test-db/owner-role.test.ts` (new) | real-Postgres owner assertions |
| `packages/db/test-db/schema-drift-parse.ts` (new) | pure parser and compare |
| `packages/db/test-db/schema-drift.test.ts` (new) | real comparison, 18 tables |
| `packages/db/src/test-db-helpers.test.ts` (new) | pnpm test unit tests for owner.ts and the drift parser, with fixtures |
| `packages/db/src/r3-guard.test.ts` | new rule: `runMigrations`/`migrateFromEnv` allowlist (paths normalised to `/`, so it is correct on Windows and Linux) |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | section 12 owner-role text |
| `apps/worker/README.md` | `## Migrations (migrate)` |
| `README.md` | one `docker run ... migrate` line |

### Tests added / changed
- `apps/worker/src/migrate.test.ts` (resolveMigrationsDir x4, migrateCommand x5)
- `apps/worker/src/cli.test.ts` › `main migrate` (3)
- `packages/db/src/test-db-helpers.test.ts` (owner role x4, schema drift parser x3, compareSchema x2)
- `packages/db/src/r3-guard.test.ts` › migration entry points (2)
- `packages/db/test-db/owner-role.test.ts` (4), `packages/db/test-db/schema-drift.test.ts` (1): need Postgres, CI only

### Checks (actual output summary)
- typecheck: clean, all packages.
- lint: clean, all packages.
- test: core 834 pass, ai 184 pass, sources 35 pass, worker 311 pass. packages/db: 150 pass, 18 fail. All 18 are the known pre-existing Windows-only failures (17 in `r3-guard.test.ts` backslash paths, 1 in `pg/migrate.test.ts` symlink EPERM). The new r3-guard tests and test-db-helpers tests pass.
- `bash -n scripts/check-image.sh`: ok. shellcheck not installed.
- test:db, db:check, image smoke: not run locally (no Docker or Postgres). CI on the PR is the proof (A1).

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Drift test part two: compare insertability (Def/Generated/TsDef/JsonDef vs column_default/is_identity) (DB-optimizer R-10).
- STK-084: decide whether "database ahead" exit 0 is acceptable at deploy, and lock_timeout aborts while worker jobs run.
- Not verified locally: A4 (no existing test:db file needs superuser on the clone connection) and A5 (schema.ts matches the baseline); CI will show it.

### Scope self-check
- Could the diff be smaller? No; every file is in the plan.
- Diff size: about +900 / -10 lines including new files and tests.
