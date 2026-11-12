# STK-087 security review

## Security review: STK-087, attempt 1

**Verdict: no blocking findings.** No 🔴. Two 🟡 should be fixed before STK-089 builds the production entry point on this runner. The rest are 🟢 hardening notes or confirmations. I read the code only and ran nothing; the green checks are as reported in `impl-log.md`.

### Findings

**🟡 1. Duplicate versions are not rejected.** `packages/db/src/pg/migrate.ts:94-109` with `:166-168`.
- If two files share a version (for example `20261111000300_a.sql` and `20261111000300_b.sql`), both parse.
- `planMigrations` puts both in `pending`. The loop's `files.find(f => f.version === m.version)` (`:167`) returns `_a` both times.
- Result: `_a` is applied and recorded. `_a`'s SQL then runs a second time and fails on the `schema_migrations` primary key (23505), so the run exits 1. `_b` never runs.
- Every later run hits `checksum mismatch` (`localByVersion` keeps `_b`).
- It fails closed, but the database is left half-migrated and the deploy wedges.
- Nothing else catches this: `migrations-lint.test.ts` has no duplicate check, and TuDo has the same gap.
- **Fix:** in `readMigrationFiles`, throw `MigrationError('duplicate migration version <v>', 2)` when a version repeats. This fires before any connection. Add a unit test.

**🟡 2. Raw errors escape `runMigrations` outside the per-file block.** `migrate.ts:133-153`.
- These steps are outside the per-file try (`:170-184`): the lock query (`:136`), `create table if not exists` (`:145`), the history `select` (`:153`), and `readFile` in `readMigrationFiles` (`:105`, e.g. EISDIR or a dangling link).
- Their errors propagate as raw `pg.DatabaseError` or Node errors, with no `exitCode`.
- I found no path where these carry the URL: post-connect pg errors are server messages, "Connection terminated unexpectedly", or `read ECONNRESET`, none of which include an address. But a raw `DatabaseError` carries `detail`, `where` and `internalQuery`, and the safety then depends on every caller (`global-setup.ts:70`, STK-089's CLI) never printing more than `.message`.
- The implementer logged this as a follow-up for STK-089. It is a one-line fix and belongs here: wrap the body from `:133` to `:188` so any error that is not a `MigrationError` becomes `MigrationError(\`migration bookkeeping failed: ${safeDetail(err)}\`, 1, sqlstateOf(err))`, with no `cause`.
- Then the contract "only `MigrationError` leaves the runner" is enforced inside `packages/db`.

**🟢 3. R3 holds.**
- `databaseUrlFromEnv` (`client.ts:31-37`) is the only reader.
- `migrate.ts:10,197` and `createPgDb` (`client.ts:44`) are its only callers.
- The failure result never carries the value (`client.test.ts:140-146`).
- The barrel (`pg/index.ts:8`) exports `runMigrations` and `migrateFromEnv` but not the accessor, and `package.json` exports only `.` and `./pg`, so there is no deep-import route.
- `r3-guard.test.ts:182-187` pins this. The env name is printed only as the constant `DATABASE_URL_ENV`.
- Note for STK-089: `runMigrations` takes a raw URL and is public on the barrel. Consider an r3-guard rule that `migrateFromEnv`/`runMigrations` are imported only by `apps/worker` (and `test-db/`), so a web route can never trigger DDL.

**🟢 4. No leaks on the connect path.**
- `migrate.ts:122-130`: `new pg.Client` (URL parsing, including Node's `ERR_INVALID_URL`, whose `input` field holds the full URL), DNS (`ENOTFOUND <host>`), TCP (`ECONNREFUSED ip:port`) and auth (`28P01 … for user "x"`) errors all become the fixed text. Only a validated 5-character SQLSTATE is kept (`errors.ts:43-46` rejects `E…` errno codes), and no `cause` is attached.
- Per-file errors (`:113-117`, `:183`) keep only `DatabaseError.message`, never `detail`, `where`, `hint` or `internalQuery`. Everything else becomes `unexpected error`. If two `pg` copies are ever loaded, `instanceof` fails safe.
- `migrate.test.ts:128-138` checks the message, `String()`, `inspect(showHidden, depth: Infinity)`, `cause` and the log output against a sentinel password and host. The implementer's mutation M5 shows the test can fail.
- Small gap: add a malformed `postgres://` sentinel (e.g. `postgres://u:pw-SENTINEL%ZZ@h:notaport/x`) to cover the URL-parse branch.
- Remaining exposure, accepted: a server message can echo a value from the migration text or a backfilled row (e.g. 22P02 `invalid input syntax …: "abc"`). Migration text is committed code and the logs are deploy logs, so this is acceptable.

**🟢 5. No injection in the runner's own SQL.**
- The `schema_migrations` insert is parameterised (`:179`).
- The lock key is passed as `$1::bigint` (`:136`, `:190`); TuDo interpolated it.
- `:172-174` interpolate only module constants.
- File names must match `^(\d{14})_([a-z0-9_]+)\.sql$` (`:14`, `:103-104`) before use. `version` and `name` are therefore restricted, and the `log` line at `:186` is safe.
- Running the file text as-is (`:175`) is by design; the trust boundary is code review plus `migrations-lint.test.ts`.

**🟢 6. Lock key cannot collide.** `MIGRATION_LOCK_KEY = 7865372087` (`:13`) is above 2^31. Every other advisory lock is the single-argument `pg_advisory_xact_lock(hashtext(...))` (baseline `:405`), whose int4 keys widen into the same bigint space but stay within ±2^31. Locks are also per database. The session lock goes on a dedicated direct `pg.Client` (no pooler), is released in `finally` (`:190`), and is freed when the session ends if that unlock fails.

**🟢 7. The transaction guard works, but uses a fixed value.**
- `:174-178` catches `commit` / `end` / `abort` / `commit and chain` (tested at `test-db/migrate.test.ts:120-129`, which also documents the known limitation that the committed table survives).
- It can be defeated in two ways:
  - a file that runs `commit; begin; set local stoktok.migrating = 'on';`;
  - an earlier file in the same run that ran a session-level `set stoktok.migrating = 'on'`, which then persists past its commit and disarms the guard for every later file.
- The lint blocks the transaction-control part. **Cheap hardening:** set a random value per file (`set_config('stoktok.migrating', $1, true)` with `randomUUID()`) and compare the guard against it. A file cannot forge the value and leftovers never match.

**🟢 8. Timeouts are adequate.**
- Per file: `set local lock_timeout '10s'` and `statement_timeout '5min'` (`:172-173`). A blocked `ALTER` against the live old release therefore fails, and the old release keeps running.
- Connect timeout is 5 s; lock wait is bounded (`:134-143`).
- The bookkeeping queries (`:145`, `:153`) run with the role's default `statement_timeout`, normally none. A hung server would hang the deploy step.
- **Suggestion:** set `query_timeout` on the client, or a session `statement_timeout` such as 60 s before the lock loop, or make sure STK-089/STK-084 wrap `migrate` in a deploy-level timeout.

**🟢 9. Path handling.**
- Names are filtered by the regex, so `..`, `/` and odd extensions cannot reach `join()` (`:105`).
- `.down.sql` and anything else ending in `.sql` that fails the regex exits 2 (`:102-104`). Non-`.sql` files are skipped silently. Note that `_x.SQL` is skipped, not rejected, unlike what the unit test name suggests (`migrate.test.ts:44` tests only the parser).
- Symlinks are followed by `readFile`. A link named like a migration would run its target as SQL, and a directory named `*.sql` throws a raw EISDIR (see 🟡2).
- **Fix:** use `readdir(dir, { withFileTypes: true })` and require `d.isFile()`. Dirents do not follow links, so links and directories get exit 2.
- Risk is low because the image copy is root-owned (STK-089), but the fix is one line.

**🟢 10. test:db harness.**
- `global-setup.ts:69-79` builds the template through the runner. On failure it prints only `.message`, which is safe once 🟡2 is fixed.
- `checkAdminUrl` is unchanged and keeps test:db localhost-only.
- `emptyDb` (`harness.ts:53-66`) uses the `stoktok_test_<n>_<pid>` pattern, so the sweep at `global-setup.ts:60` still matches it.
- Database names come from a counter and the pid, not from input.
- `baseline.test.ts:33` excludes only `schema_migrations` from the table list. The RLS assertion at `:34` still covers every table.
- Integration tests use throwaway credentials and drop their databases in `finally`. Lock tests release in `finally`.
- The runner is still tested as superuser in test:db; the non-superuser path is STK-089 (plan A2).

### Recommendations
1. Reject duplicate versions with exit 2 in `readMigrationFiles`, with a unit test (🟡1; plan criterion 3).
2. Convert every error that is not a `MigrationError` from `runMigrations` into a `MigrationError` with fixed or server-message text and no `cause` (🟡2; criterion 4, R3).
3. Optional, now or in STK-089: a per-file random guard value (🟢7), `isFile()` filtering (🟢9), a timeout for the bookkeeping queries (🟢8), a malformed-URL leak test (🟢4), and an r3-guard rule limiting who imports the runner (🟢3).

### Risks
- `schema_migrations` is owned by the same `stoktok` role that runs the app, so an app-level SQL injection could rewrite migration history. This is the accepted D24 model (least-privilege runtime role is a follow-up). Track it with that follow-up.
- `migrations-lint.test.ts` is the main defence against files that commit themselves; the runtime guard is secondary.

### Open questions
- Should STK-089's `check-image.sh` also assert that `/app/migrations` contains only regular files (no symlinks)? That would cover 🟢9 at image level if the `isFile()` check is not added here.

Files reviewed: `/home/user/stoktok/packages/db/src/pg/migrate.ts`, `/home/user/stoktok/packages/db/src/pg/client.ts`, `/home/user/stoktok/packages/db/src/pg/index.ts`, `/home/user/stoktok/packages/db/src/pg/migrate.test.ts`, `/home/user/stoktok/packages/db/src/pg/client.test.ts`, `/home/user/stoktok/packages/db/src/r3-guard.test.ts`, `/home/user/stoktok/packages/db/test-db/migrate.test.ts`, `/home/user/stoktok/packages/db/test-db/global-setup.ts`, `/home/user/stoktok/packages/db/test-db/harness.ts`, `/home/user/stoktok/packages/db/test-db/baseline.test.ts`, `/home/user/stoktok/db/migrations/README.md`, `/home/user/stoktok/docs/adr/0010-self-hosted-postgres-data-layer.md`. Reference: `/home/user/tudocuatui/server/migrator.js`.
