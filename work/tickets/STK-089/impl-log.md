## Attempt 1 — 2026-11-17

### Files touched
| File | Required because |
|---|---|
| apps/worker/src/migrate.ts (new) | `resolveMigrationsDir`, `migrateCommand` (criteria 1, 2, 4) |
| apps/worker/src/migrate.test.ts (new) | unit tests for the above (R8) |
| apps/worker/src/cli.ts | `migrate` branch first in `main`, `migrate` in `USAGE`, imports (criterion 3) |
| apps/worker/src/cli.test.ts | partial mock of `./migrate`, two new tests (criterion 3) |
| apps/worker/Dockerfile | `COPY --from=build /repo/db/migrations ./migrations`, no `--chown` (criterion 5) |
| scripts/check-image.sh | worker block: two `migrate` smokes, `/app/migrations` content check, wider EXIT trap (criterion 6) |
| packages/db/src/r3-guard.test.ts | runner entry-point guard (criterion 7) |
| packages/db/test-db/schema-drift.test.ts (new) | parser, diff, fixtures, live drift comparison (criterion 8) |
| db/migrations/README.md | one bullet after the "Applied by" line |
| docs/adr/0010-self-hosted-postgres-data-layer.md | §10 and §12 sentences, slice order line |

### Tests added / changed
- apps/worker/src/migrate.test.ts › resolveMigrationsDir (image layout; repo from src and dist, neither, both; the real repo)
- apps/worker/src/migrate.test.ts › migrateCommand (extra argument; success; MigrationError mapping; unknown error no echo; real migrateFromEnv missing URL; unreachable DB without leaking)
- apps/worker/src/cli.test.ts › main: migrate delegates and opens no db; USAGE lists migrate
- packages/db/src/r3-guard.test.ts › runMigrations / migrateFromEnv appear only in pg/migrate, pg/index, test-db/ and apps/worker/src/migrate
- packages/db/test-db/schema-drift.test.ts › parser reads every table; fails closed; diff fixture; schema.ts matches the migrated database

### Checks (actual output summary)
- typecheck: all packages Done, no errors.
- lint: all packages Done, no errors.
- format: the repo has no `format` script or formatter config at the root; not run.
- test: core 834, sources 35, ai 184, db 158, worker 310, web 352, all passed.
- test:db (local PG16 on 127.0.0.1:54389, `DB_TEST_URL=postgresql://postgres@127.0.0.1:54389/postgres`): 25 files, 143 tests passed; schema-drift file: 4/4 passed. Zero drift found.
- db:check: `db:check OK` (PG16 throwaway cluster).
- build: `pnpm build` Done for worker and web. One earlier `next build` run failed transiently (its output pointed at an advisory registry lookup); two reruns, including the full `pnpm build`, succeeded.
- `bash -n scripts/check-image.sh`: ok.
- Worker bundle (`apps/worker/dist/cli.js`, repo layout): `migrate x` exit 2 with usage; no URL exit 2 (`migrate failed: STOKTOK_DATABASE_URL is not set`); `postgres://u:pw@127.0.0.1:9/x` exit 1 (`migrate failed: cannot connect to the database (URL not printed)`, no host or password); against the local PG16 it printed `applied 20261111000200_baseline (78 ms)` and exit 0 (so the `dist` -> `db/migrations` resolution works).
- Negative proofs (both reverted): adding `// migrateFromEnv` to `cli.ts` made the r3-guard test fail with `apps/worker/src/cli.ts`; changing `fee: Int8 | null` to `fee: Int8` made the drift test fail with `transactions.fee: nullability schema.ts=not null db=nullable`.
- Image smokes (criterion 6) not run: no Docker. Left to the PR's CI `images` job.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- The root has no `pnpm format` script, although the implementer rules assume one.
- The throwaway PG data dir (`/var/tmp/pgdata89`) was deleted.
- During verification I ran `git stash` / `git stash pop` once by mistake; the tree was restored in full (stash list empty).

### Scope self-check
- Could the diff be smaller? No.
- Diff size: about +400 / -3 lines (roughly 200 of them tests).

## Attempt 2 (REWORK: fixes requested by Ming after review attempt 1 PASS)

### Files touched
- `scripts/check-image.sh`: `/app/migrations` assertions now use plain `f=$(find ...)` assignments under `set -e`, so a `find` failure fails the check (it was hidden inside `test -z "$(...)"`); added `find /app/migrations -writable` empty (as the runtime user `node`; security-review 🟡1); the no-URL `migrate` smoke runs under `timeout 20` with a hang message on exit 124 (🟢6). Required because both are the listed fixes.
- `packages/db/test-db/schema-drift.test.ts`: `bodyLines` rejects a line with a second `;` (two members on one line throw); new exported `selectNullable` decides nullability from the select position only (top-level `| null`, or the first argument of `ColumnType<>`/`Generated<>`), so `ColumnType<string, string | null, ...>` is not nullable. Fixtures added in the existing parser `describe` (no DB needed): "two members on one line fail closed" and "nullable means the select type is nullable". Required because both are the listed review nits; logic stays in the test-db file.

### Tests added
- The two fixtures above.

### Checks
- `bash -n scripts/check-image.sh`: OK (Docker unavailable; the image assertions are still unproven until CI).
- `pnpm typecheck`, `pnpm lint`: OK. `pnpm test`: core 834, sources 35, ai 184, db 158, worker 310 passed.
- `pnpm test:db` (throwaway PG16 on TCP): 25 files, 145 tests passed.
- `pnpm db:check` (DB_CHECK_URL against the same PG16 server): `db:check OK` (server is 16, not 17).
- No `format` script exists in the repo, so no formatter was run. PG data dir deleted.

### Out-of-plan files
None.

### Follow-ups
None new.

### Scope self-check
Only the listed items changed; no commit, no stash.
