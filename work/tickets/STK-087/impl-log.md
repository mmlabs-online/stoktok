## Attempt 1 — 2026-11-12

Slice 1 only (runner in packages/db). Not committed, per the caller's instruction. No `pnpm format` script exists in this repo; no formatter was run.

### Files touched
| File | Required because |
|---|---|
| `packages/db/src/pg/migrate.ts` (new) | The runner (criteria 1-4, 6-8). |
| `packages/db/src/pg/client.ts` | `databaseUrlFromEnv` accessor; `createPgDb` uses it with unchanged messages (D2, R3). |
| `packages/db/src/pg/index.ts` | Barrel exports; `databaseUrlFromEnv` not exported. |
| `packages/db/src/pg/migrate.test.ts` (new) | Unit tests (criteria 2-4). |
| `packages/db/src/pg/client.test.ts` | `databaseUrlFromEnv` describe block. |
| `packages/db/src/r3-guard.test.ts` | Accessor guard test (criterion 5). |
| `packages/db/test-db/global-setup.ts` | Template built via `runMigrations`; unused imports dropped. |
| `packages/db/test-db/harness.ts` | `emptyDb()`. |
| `packages/db/test-db/migrate.test.ts` (new) | Real-Postgres runner tests (criteria 6-9). |
| `packages/db/test-db/baseline.test.ts` | Table-list query excludes `schema_migrations`. |
| `db/migrations/README.md` | Line 5 as planned. |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | Slice order and section 12, as planned. |

### Tests added / changed
- `migrate.test.ts` › parseMigrationFilename, checksum (hard-coded sha256), planMigrations, readMigrationFiles, runMigrations (config errors before connecting; unreachable DB leaks no URL in message/String/inspect/log, no cause), migrateFromEnv.
- `client.test.ts` › databaseUrlFromEnv.
- `r3-guard.test.ts` › databaseUrlFromEnv only in pg/client, pg/migrate and their tests; not in the barrel.
- `test-db/migrate.test.ts` › template holds exactly the baseline row; fresh apply then idempotent re-run; session settings; checksum mismatch (and CRLF-only change does not mismatch); failing file rolls back; self-committing file rejected; database ahead; held lock blocks; lock wait times out; two concurrent runners.

### Checks (actual output summary)
- typecheck: clean (0 errors, all packages).
- lint: clean (0 errors, 0 warnings).
- test: core 834, sources 35, ai 184, db 147, worker 299, web 352 passed.
- test:db (PG 16.15 local, TCP 127.0.0.1, trust auth): 24 files, 137 tests passed.
- db:check (PG_BIN=16, throwaway cluster): `db:check OK` (warns on major 16 vs 17; CI uses 17).
- `bash scripts/schema-diff.sh`: `A' vs B: identical`; A vs B shows only the expected ai_keys difference. Unchanged from the base tree (no db/migrations change).
- build: web build Done.

Mutation proofs (each reverted; file restored byte-identical):
- M1 remove CRLF normalisation: unit `checksum` test and test:db `checksum mismatch` test fail.
- M2 remove the transaction-end guard: `a file that commits itself is rejected` fails.
- M4 always-acquire lock: `held lock blocks`, `lock wait times out`, `two concurrent runners` fail.
- M5 put the URL in the connect error: the unreachable-database leak test fails.
- M3 remove the explicit `rollback`: **no test fails**. The failing-file test still passes because `client.end()` in `finally` closes the session and Postgres aborts the open transaction. The rollback is therefore redundant for observable behaviour in this runner (kept as a faithful port); not a gap the plan asked to prove.

### Out-of-plan files
None.

### Deviations
- `// eslint-disable-next-line preserve-caught-error` directives from the plan were not needed (the rule did not fire; the unused directive warned), so they are not present. The cause is still never attached.
- A3: `pg.DatabaseError` exists in typings and at runtime; used as planned.
- A throwaway PG16 cluster was created under `/var/tmp/stk087pg`, stopped and deleted.

### Follow-ups (noticed, not done)
- A non-DatabaseError thrown in the lock loop or `create table` step (for example a dropped socket) propagates raw from `runMigrations`; STK-089's CLI must print a fixed text for non-`MigrationError` errors (already in its scope).

### Scope self-check
- Could the diff be smaller? No.
- Diff size: about +64 / -20 in modified files, plus 3 new files (migrate.ts ~190, two test files).

## Attempt 2 — 2026-11-12 (Ming's post-PASS fixes)

Scope: security-review.md 🟡1, 🟡2 and the named 🟢 items; review.md nits 1 and 2 and the follow-up. Only `migrate.ts` and its tests.

### Files touched
| File | Required because |
|---|---|
| `packages/db/src/pg/migrate.ts` | 🟡1: `readMigrationFiles` rejects a repeated version (exit 2). 🟡2: the body after connect is wrapped so any non-`MigrationError` becomes `migration bookkeeping failed: <safeDetail>` (exit 1, SQLSTATE, no cause); `readFile` failure is exit 2. 🟢9: `readdir` with `withFileTypes`, `isFile()` required (links and dirs exit 2). 🟢8: session `statement_timeout` (new option `queryTimeoutMs`, default 60 s) for bookkeeping queries. 🟢7: per-file `randomUUID()` guard value via `set_config(..., true)`. `safeDetail` exported for its test. |
| `packages/db/src/pg/migrate.test.ts` | Duplicate version, symlink/dir, malformed-URL leak (🟢4), `safeDetail` both branches, lock key > 2^31. |
| `packages/db/test-db/migrate.test.ts` | Guard cannot be re-armed by the file, bookkeeping query timeout/wrapping, exact `division by zero` message, probe now expects a UUID for `stoktok.migrating`. |

### Tests added
- unit: `a duplicate version is exit 2 before anything runs`, `a symlink or directory named like a migration is exit 2`, `malformed URL: connect failure leaks neither password nor host`, `safeDetail`, lock key test.
- test:db: `a file cannot forge the guard by re-arming it after committing`, `a bookkeeping query that hangs is cut off and reported as a MigrationError` (another session holds ACCESS EXCLUSIVE on `schema_migrations`), message assertion in `a failing file rolls back`.
- I dropped a planned "session-level leftover from an earlier file" test: that file is itself rejected (its own `SET` overrides the random value inside its transaction), so the scenario is unreachable.

### Fails-without-fix (run on a scratch copy of the repo, deleted afterwards)
- 🟡1 remove the duplicate check: unit `a duplicate version is exit 2...` fails.
- 🟡2 remove the wrapping (`throw err`): test:db `a bookkeeping query that hangs...` fails (raw DatabaseError, not a MigrationError).
- 🟢 guard fixed to `'on'`: `a file cannot forge the guard...` and the session-settings probe fail.
- 🟢 `isFile()` disabled: the symlink/dir test fails.
- 🟢 session statement_timeout removed: the bookkeeping test fails (hangs to the 30 s test timeout).
- Not mutation-tested: malformed-URL test, `safeDetail` test, lock key test (they pin existing behaviour; the plain-text sentinel test follows M5 of attempt 1).

### Checks (actual)
- typecheck: 0 errors. lint: no errors or warnings.
- test: core 834, sources 35, ai 184, db 152, worker 299, web 352 passed.
- test:db (PG 16 local, TCP 127.0.0.1:5439, trust auth): 24 files, 139 tests passed.
- db:check (PG_BIN=16): `db:check OK`. `bash scripts/schema-diff.sh`: `A' vs B: identical`; A vs B shows only the expected ai_keys difference.
- `pnpm format` run on the changed files (no `format:check` script exists in this repo).
- Not run: build (nothing outside packages/db changed).

### Out-of-plan files
None.

### Follow-ups (not done)
- 🟢3 r3-guard rule limiting who imports the runner, and the `check-image.sh` regular-files assertion: STK-089.
- The per-file guard only blocks files that end the transaction; a file that `commit`s has still committed (known limitation, lint is the primary defence).

### Scope self-check
- Only the three listed files changed. PG data dir `/var/tmp/stk087pg2` and the scratch copy were deleted. Not committed.
