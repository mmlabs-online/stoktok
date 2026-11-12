## Attempt 1 — 2026-11-12
Verdict: PASS

Reviewed commit 3220a96 (`git diff origin/main...HEAD`). Scope is slice 1 per plan.md (runner in packages/db). The worker command, the image, the owner-role test:db and the drift test are STK-089 and are not counted as missing.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0, all 6 workspace projects Done.
- lint: `pnpm lint` exit 0, all projects Done, no warnings printed.
- test: `pnpm test` exit 0. core 834, sources 35 (1 file skipped, as on main), ai 184, db 147, worker 299 (1 file skipped, as on main), web 352 passed. These match impl-log.md.
- build: `pnpm build` exit 0 (web build Done).
- test:db: a throwaway PG 16 cluster on TCP `127.0.0.1:55433` with trust auth. `DB_TEST_URL=postgresql://postgres@127.0.0.1:55433/postgres pnpm test:db` gave 24 files and 137 tests passed, which matches impl-log.md. A verbose run of `test-db/migrate.test.ts` passed all 10 runner tests. Afterwards `pg_database` held only postgres, template0 and template1, so the cleanup sweep also catches `emptyDb()` databases.
- db:check: `pnpm db:check` (throwaway cluster, PG 16) printed `db:check OK` and exited 0.
- `bash scripts/schema-diff.sh`: `A' vs B: identical`. A vs B shows only the expected ai_keys difference. Exit 0.

### Mutation proofs re-run (scratch copy of the tree, original file restored and checked with `cmp`)
| Mutation | Result |
|---|---|
| M1/R4: remove the CRLF normalisation in `checksum` | unit `checksum > known sha256, CRLF and Buffer equivalence` and test:db `checksum mismatch exits 1 and applies nothing` fail. Matches impl-log. |
| M2: disable the transaction-end guard | `a file that commits itself is rejected` fails. Matches impl-log. |
| M4: always treat the lock as acquired | `a held lock blocks until released`, `lock wait times out` and `two concurrent runners apply each file once` fail. Matches impl-log. |
| M5: put `connectionString` in the connect error | unit `unreachable database: exit 1, no URL in message, String() or inspect()` fails. Matches impl-log. |
| Extra: drop `set local lock_timeout` | `session settings inside a migration` fails. |
| Extra: `safeDetail` returns every `err.message` | No test fails. See Nit 1. |
| Extra: lock key set to `'12345'` (below 2^31) | No test fails. See Nit 2. |

Runtime probe, done because no test asserts the server text: a file containing `select 1/0` gives the message `migration 20261111000201 failed: division by zero` with code `22012` and exit code 1. This shows that `err instanceof pg.DatabaseError` holds at runtime with the ESM default import. Connecting to a database that does not exist gives `cannot connect to the database (URL not printed)` with code `3D000` and exit code 1, so neither the host nor the URL is printed.

### Comparison with /home/user/tudocuatui/server/migrator.js
`packages/db/src/pg/migrate.ts` matches TuDo line for line in these places:
- filename regex: `migrate.ts:14` ↔ `migrator.js:9`;
- `checksum`: `:61-64` ↔ `:32-35`;
- `planMigrations` (ahead, missing locally, mismatch, older-than-newest rules): `:68-92` ↔ `:43-71`;
- `readMigrationFiles`: `:94-109` ↔ `:74-89`;
- lock loop and back-off: `:134-143` ↔ `:127-136`;
- per-file sequence (begin, two `set local` timeouts, GUC, file, guard, insert, commit, rollback on error): `:170-184` ↔ `:162-183`;
- `finally` unlock and end: `:189-192` ↔ `:186-189`.

The only differences are the plan's deltas:
- D2: the URL comes from `client.ts` through `databaseUrlFromEnv` (`client.ts:31-37`); `migrateFromEnv` returns exit 2 for a missing or invalid URL (`migrate.ts:196-203`).
- D3: the connect error is a fixed text plus `sqlstateOf` (`:128-130`). Per-file errors pass through `safeDetail` (`:114-117`), which keeps only `pg.DatabaseError` and `GuardError` messages. No `cause` is attached anywhere.
- D4: `MIGRATION_LOCK_KEY = '7865372087'`, which is above 2^31, passed as `$1::bigint` (`:13`, `:136`, `:190`).
- D5: `public.schema_migrations` is schema-qualified (`:146`, `:153`, `:179`).
- D6: the result is `{ applied, ahead }`.
- D7: the timeout constants are `:16-19` (connect 5 s, lock wait 30 s, per file `10s` and `5min`). `application_name` is `stoktok-migrate` and the GUC is `stoktok.migrating`.
- Versions are compared with plain `<`/`>` (`:66`), not `localeCompare`.

### Acceptance criteria
- [x] 1. Exports and a faithful port — evidence: the side-by-side comparison above. The barrel (`pg/index.ts:8-9`) exports `MIGRATION_LOCK_KEY`, `MigrationError`, `checksum`, `migrateFromEnv`, `parseMigrationFilename`, `planMigrations`, `runMigrations` and their types, and does not export `databaseUrlFromEnv`.
- [x] 2. Filename, checksum and plan rules — evidence: `src/pg/migrate.test.ts` › `parseMigrationFilename` (2 accepted names and the 12 rejected cases from the plan, including `.down.sql`, the diacritic and the trailing space), `checksum` (hard-coded sha256, CRLF, Buffer, a lone CR, distinct content), `planMigrations` (6 cases, including no input mutation) and `readMigrationFiles`. All pass.
- [x] 3. Exit codes, with configuration errors raised before any connection — evidence: `readMigrationFiles > invalid name, .down.sql and missing dir are exit 2`, `runMigrations > config errors come before connecting` and `migrateFromEnv > *` pass. The test:db cases cover exit 1.
- [x] 4. No URL or password in output — evidence: the unreachable-database unit test passes (message, `String()`, `inspect(showHidden)` and log calls checked, `cause` undefined). Mutation M5 is caught. `grep connectionString migrate.ts` shows the value used only at `:124`, inside `new pg.Client`, and at `:202`, where it is passed through. The runtime probe printed no host.
- [x] 5. R3 accessor only — evidence: `r3-guard.test.ts` › `databaseUrlFromEnv is used only in pg/client.ts, pg/migrate.ts and their tests; not in the barrel` passes. `STOKTOK_DATABASE_URL` appears in no new file. `createPgDb` keeps its exact `Missing env`/`Invalid env` messages (`client.ts:45`).
- [x] 6. One transaction per file with the timeouts, GUC and app name; rollback; guard — evidence: test:db `session settings inside a migration` (`10s`, `5min`, `stoktok-migrate`, `on`, and the GUC empty after the run), `a failing file rolls back with no row` and `a file that commits itself is rejected` pass. The mutations above are caught.
- [x] 7. Idempotent re-run, checksum mismatch, database ahead — evidence: test:db `fresh apply then idempotent re-run`, `checksum mismatch exits 1 and applies nothing` (including the CRLF-only rewrite) and `database ahead applies nothing` pass.
- [x] 8. Lock serialisation and timeout — evidence: test:db `a held lock blocks until released`, `lock wait times out` and `two concurrent runners apply each file once` pass. Mutation M4 is caught.
- [x] 9. The template is built by the runner and holds only the baseline row — evidence: `global-setup.ts:77-79` calls `runMigrations` only (the hand-rolled loop is gone). test:db `template holds exactly the baseline row` passes. `baseline.test.ts` passes with the one-line `schema_migrations` filter.
- [x] 10. Production untouched — evidence: `git diff origin/main...HEAD --stat` touches none of `apps/`, `scripts/`, `.github/`, Dockerfiles, `.dockerignore`, `db/migrations/*.sql`, `db/rollback`, `migrations-lint.test.ts`, `schema.ts` or `CLAUDE.md`. No release branch exists.
- [x] 11. typecheck, lint, test, test:db and db:check are green — evidence: the Checks section above.

Ming verification after merge: none (plan.md).

### Scope
Every code and doc file in 3220a96 is in the plan's file table. The other changed files are workflow bookkeeping: `work/backlog.md`, the STK-087 `ticket.md` and `impl-log.md` in 3220a96, plus the planning commits' `plan.md`, the STK-089 ticket and the STK-084 dependency line. There is no unjustified out-of-plan change.

### Issues
None.

### Rules R1–R10
No violations found.
- R3: the URL is read only in `client.ts` (accessor plus guard test) and is never logged or carried on an error.
- R5: the timeouts are operational constants (D7), not market rules.
- R7: the diff stays within the plan.
- R8: the checks are green and the new logic has unit and real-Postgres tests.

### Nits (do not block)
1. `migrate.ts:114-117` `safeDetail`: no test checks either branch's text. Forcing it to return every message, or (by reading the code) dropping the `DatabaseError` branch, passes all tests. Two possible additions: assert `e.message` contains `division by zero` in `a failing file rolls back with no row`, and add a unit test that a non-`DatabaseError` thrown inside a file step becomes `unexpected error`. Both can be done in STK-089 alongside the CLI's message handling.
2. `MIGRATION_LOCK_KEY` is not asserted to be above 2^31. A one-line unit test such as `expect(BigInt(MIGRATION_LOCK_KEY) > 2n ** 31n).toBe(true)` would pin D4.
3. impl-log.md says "Not committed, per the caller's instruction", but the work is committed as 3220a96 (by the orchestrator). This is wording only.

### Follow-ups (out of scope)
- Errors raised outside the per-file `try` (the lock query, `create table if not exists public.schema_migrations`, the `select` of applied rows) propagate raw from `runMigrations`, as in TuDo. They are not a `MigrationError`, so there is no `exitCode`. A plausible case is `permission denied for schema public` (`42501`) for a role that does not own `public`. STK-089's CLI maps non-`MigrationError` errors to `migrate failed: unexpected error`, so an operator would lose that server text. Consider wrapping that stage the same way as the per-file step (`safeDetail` plus `sqlstateOf`, exit 1), either in STK-089 or in a small follow-up. The impl-log already noted this.
