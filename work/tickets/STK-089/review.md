## Attempt 1 — 2026-11-12
Verdict: PASS

Diff base: `origin/main` (cf2423f, merge of STK-088 PR #66). The diff has 23 files. Every one is in the plan's file table or under `work/` (ticket, backlog, plan, consults, impl-log). CI evidence comes from draft PR #67, run 43223383026, head `5576c8f`, which matches the branch HEAD.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0 (local, Windows).
- lint: `pnpm lint` exit 0 (local).
- test: `pnpm test` exit 1 locally, but only because of the known Windows-only failures in `packages/db`. That package shows 18 failed and 150 passed (168), which matches impl-log.md:35.
  - The 18 failures are 17 pre-existing `r3-guard.test.ts` cases that compare backslash paths (`R3 guard` › server-only … `S5` › @supabase imports) and `pg/migrate.test.ts` › "a symlink or directory named like a migration is exit 2" (EPERM).
  - None of the failing names is new or modified by this diff. The r3-guard change only appends a block at the end of the file. The new `R3 guard: migration entry points (STK-089)` tests and `src/test-db-helpers.test.ts` (9 tests) pass locally.
  - Because the db failure aborted the recursive run, I ran `pnpm --filter @stoktok/worker test` on its own: 22 files (21 passed, 1 skipped), 311 tests passed, including `migrate.test.ts` and `cli.test.ts`.
  - Other local packages: core 834 passed, ai 184 passed, sources 35 passed.
- `bash -n scripts/check-image.sh`: exit 0.
- CI (`gh pr checks 67`): `ci` pass, `images (web)` pass, `images (worker)` pass. All checks ran on headSha 5576c8f.
  - `ci` › `pnpm test` (Linux): `packages/db` 24 files and 168 tests passed. `test-db-helpers.test.ts` ran 9 tests. `r3-guard.test.ts` ran 36, all green on Linux. `apps/worker` ran 311 tests, including `src/migrate.test.ts` (9) and `src/cli.test.ts` (24). `apps/web` ran 352.
  - `ci` › `pnpm test:db` (postgres:17): 26 files and 144 tests passed.
    - The log shows `✓ test-db/owner-role.test.ts (4 tests)` and `✓ test-db/schema-drift.test.ts (1 test)`.
    - All existing files passed while running as the owner: baseline, migrate (12), session (7), ai-keys (15) and the repo tests.
  - `ci` › `pnpm db:check`: `db:check OK`. Re-apply and canaries all ran after test:db on the same cluster, so the persistent `stoktok_test_owner` does not trip it.
  - `images (worker)` › "Image checks": the log shows each new step.
    - `== smoke: worker migrate without a URL exits 2`, which prints `migrate failed: STOKTOK_DATABASE_URL is not set`.
    - `== smoke: worker migrate with an unreachable database exits 1 without hanging or leaking`, which prints `migrate failed: cannot connect to the database (URL not printed)`. This is a real connect failure, not `unexpected error`, so `/app/migrations` resolved and parsed in the bundled ESM build.
    - `== image: /app/migrations ships only regular forward migrations`.
    - `== image: /app/migrations is read-only for node`.
    - The step exited green.

### Acceptance criteria
- [x] 1. `resolveMigrationsDir` returns the image path first, then the repo path, else the first candidate. Evidence: `apps/worker/src/migrate.ts:16-20`; `migrate.test.ts` › `resolveMigrationsDir` (4 cases: image, repo from src and dist, fallback, real repo), green locally and in CI.
- [x] 2. `migrateCommand` mapping. Evidence: `migrate.ts:23-44`.
  - The whole body is inside one try/catch, so it never rejects.
  - A `MigrationError` prints `migrate failed: <msg>[ [code]]` with exit `err.exitCode`.
  - Any other error prints the fixed `unexpected error` text with exit 1.
  - Tests cover usage and exit 2 with `run` not called; success with stdout logs and env/dir passed through; both MigrationError mappings; and three unknown-error shapes (rejected, synchronous throw, non-Error), with a sentinel check that no `SENTINEL`/`127.0.0.1` text is echoed. The default `run` with `env {}` gives exit 2, `... is not set`.
- [x] 3. `main(['migrate'])` delegates first and never calls `openDb`. Evidence: `apps/worker/src/cli.ts:67-71`. The branch is the first statement, before `parseArgs`. `USAGE` (`cli.ts:24`) starts with `migrate (no flags)`. `cli.test.ts` › `main migrate` (3 cases) is green. `grep runMigrations|migrateFromEnv apps/worker/src/cli.ts` prints nothing.
- [x] 4. r3-guard allowlist (D1), the explicit `apps/web` assertion and the regex self-test. Evidence: `packages/db/src/r3-guard.test.ts:359-380`; green in CI and locally (paths are normalised to `/`).
- [x] 5. Dockerfile. Evidence: `apps/worker/Dockerfile:29-30`. It has `COPY --from=build /repo/db/migrations ./migrations` with no `--chown`, placed after `dist`/`package.json` and before `USER node`. `db/rollback` is not copied. `.dockerignore` is unchanged and excludes neither `db` nor `*.sql`.
- [x] 6. `check-image.sh` worker block. Evidence: `scripts/check-image.sh:50-83`. It checks exact exit codes 2 and 1 and treats 124 as a hang. The output is combined for the leak grep. The trap covers `$NAME-mig`. It runs the layout check as root and the writability check as `node`. The CI log above shows every step ran.
- [x] 7. Owner role. Evidence:
  - `test-db/owner.ts` (name, labelled sha256 derivation, `URL`-setter swap, hex-asserted `ALTER ROLE` with all six attributes).
  - `global-setup.ts:42-65`: `pg_advisory_xact_lock` on a distinct key; create if missing, then always alter; retry once on 42710/23505.
  - There is no `drop role` anywhere.
  - Unit tests: `test-db-helpers.test.ts` › `owner role` (4).
  - Real Postgres: `owner-role.test.ts` › flags and no memberships.
- [x] 8. Template and clones owned by the owner.
  - Template: `global-setup.ts:79`, `95-97` (`create database … owner`, then alter/revoke as admin with the client ended, then migrate via `ownerUrl`).
  - Clones and `emptyDb`: `harness.ts:38-39`, `57-66`.
  - `owner-role.test.ts` checks `current_user`/`session_user`, 42501 on `create role`/`create database`, `datdba` of the template and the clone, `nspowner`, no foreign-owned relation or function, and no PUBLIC ACL on `public`. It also covers `emptyDb` ownership. All 4 passed in CI, and the other 25 test:db files stayed green as the owner.
- [x] 9. Drift test.
  - `test-db/schema-drift-parse.ts` fails closed: unparseable line, duplicate column, an interface missing from `Database`, an unknown interface. Nullability is a top-level `| null` after the generics are stripped.
  - `compareSchema` compares both directions, including missing tables.
  - Fixtures for a missing column and a nullability flip: `test-db-helpers.test.ts` › `compareSchema fixtures`.
  - The real `schema.ts` parses to 18 tables equal to the `Database` keys (unit test).
  - `schema-drift.test.ts` passed in CI against `information_schema` (18 tables, no drift), so `schema.ts` needed no change (A5).
- [x] 10. Docs: ADR 0010 §12 owner-role text (`docs/adr/0010-…md:20`); `apps/worker/README.md` `## Migrations (migrate)` with streams, the exit-code table, expand/contract and the STK-084 compose contract; root `README.md:35` `docker run … migrate`.
- [x] 11. No release cut. The diff does not touch `.github/**`, `db/**`, `packages/db/src/pg/**`, `apps/web/**` or `.dockerignore` (`git diff --stat origin/main...HEAD -- …` is empty). No tag or release branch exists.
- [x] 12. `typecheck`, `lint`, `test`, `test:db` and `db:check` are green in CI. Locally, typecheck and lint are green and test is green apart from the known Windows-only failures, which this diff leaves unchanged.

### Issues
None.

### Rules R1–R10
No violations found.
- R3: the worker never names the env variable. The URL is read only through `migrateFromEnv` → `pg/client.ts`. Unknown error messages are never printed (unit sentinel test plus the CI image leak grep). The new guard confines `runMigrations`/`migrateFromEnv` to the runner, its barrel, test-db and `apps/worker/src/migrate(.test).ts`.
- R7: the scope matches the plan.
- R8: the new pure logic (`owner.ts`, `schema-drift-parse.ts`, `migrate.ts`) has unit tests, and the checks are green in CI.
- R1, R2, R4, R5, R6, R9 and R10 are not affected.

### Nits (do not block)
- `test-db/owner.ts:9-12`: the derivation uses only the admin password. Two concurrent `test:db` runs on one cluster with different superuser passwords would overwrite each other's owner password mid-run. This is unlikely for a localhost-only harness, and ADR §12 already notes the derivation.
- `test-db/global-setup.ts`: `ensureOwnerRole` and the template `create database` run outside the `pnpm test:db setup failed:` try block, so their errors reach vitest unformatted. A pg server message never contains the password, so nothing leaks.
- `test-db/schema-drift-parse.ts:11-20`: `stripGenerics` would miscount `=>` in a function type. `schema.ts` has none, and a miscount would most likely surface as a drift failure, not a silent pass.
- `/app/migrations` also ships `db/migrations/README.md`. D12 intends this, and the runner ignores non-`.sql` files.

### Follow-ups (out of scope)
- Drift test part two: compare insertability (`Def`/`Generated`/`ColumnType<…| undefined>` against `column_default`/`is_identity`/`is_generated`) (DB-optimizer R-10). Open a `debt` issue.
- STK-084: decide whether "database ahead" exiting 0 is acceptable at deploy, and how to handle `lock_timeout` while worker jobs run.
- The pre-existing Windows-only failures in `packages/db` (r3-guard backslash paths, symlink EPERM) should get a `debt` issue if one does not exist yet. The new STK-089 guard already shows the fix pattern (`.replace(/\\/g, '/')`).
