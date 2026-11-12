Status: READY

# Plan — STK-087: Migrate runner (STK-083 split, slice 3a)

The full ticket is too big for one implement/review cycle (see `## Split proposal`). **This plan covers slice 1 only:**
- the runner `packages/db/src/pg/migrate.ts` and the R3 URL accessor in `pg/client.ts`;
- the runner's unit tests and real-Postgres integration tests;
- the test:db template built through `runMigrations`.

The worker `migrate` command, the image (Dockerfile `COPY`, `check-image.sh` smoke), the owner-role test:db and the `schema.ts` drift test become **STK-089**.

## Spec summary
Ticket `## Goal` (quoted; the parts this slice implements are in **bold**):
> **`packages/db/src/pg/migrate.ts`, a port of TuDo `migrator.js`: forward-only; `schema_migrations` table; sha256 checksum with CRLF normalisation; advisory lock key above 2^31; GUC `stoktok.migrating`; one transaction per file with `lock_timeout` and `statement_timeout`; dedicated `pg.Client` with `application_name: stoktok-migrate`; exit codes 0/1/2; never logs the URL. URL read only via a new accessor in `pg/client.ts` (R3, r3-guard).** Worker `cli.ts migrate` subcommand with directory resolution (image `../migrations`, repo `db/migrations`). Dockerfile `COPY db/migrations ./migrations`, and verify `.dockerignore`. `check-image.sh` smoke: `migrate` without URL exits 2; with an unreachable DB exits 1 with no leak. [→ STK-089] **Unit tests for `parseMigrationFilename`, `checksum` and `planMigrations`. test:db: … template built via `runMigrations`** [as the owner role → STK-089] … **Integration tests: idempotent re-run; checksum mismatch exits 1; a failing file rolls back with no row; concurrent runners serialise; DB-ahead applies nothing; `schema_migrations` holds exactly the baseline row.** `schema.ts` vs `information_schema` drift test. [→ STK-089]

Ticket `## Shared-Postgres standard`:
> Migrations: a one-shot `migrate` compose service, run by the deploy after a pre-migration dump (`pg-backup /backup.sh`) and before the app is replaced; a failed migration leaves the old release running. Pattern: TuDoCuaTui `server/migrator.js` (plain SQL `YYYYMMDDHHMMSS_name.sql`, forward-only, checksums in a migrations table, advisory lock, one transaction per file).
> **Release rule:** STK-081 to STK-083 merge to main but no stoktok release is cut until STK-084.

STK-083 plan decision 2:
> db:check applies migrations via **psql** … The runner is covered by `test:db`: STK-087 builds the template through `runMigrations`, so every `test:db` run exercises it.

ADR 0010 §9 (as amended in STK-083):
> test-only down files live in `db/rollback` (the runner rejects `.down.sql` in its directory and the image does not ship them).

CLAUDE.md R3:
> `STOKTOK_DATABASE_URL` is read only in `packages/db/src/pg/client.ts` …

## Decisions taken in this plan
| # | Point | Decision | Why |
|---|---|---|---|
| D1 | Split | This slice: runner, accessor, unit and integration tests, template via the runner (as admin, as today). **STK-089:** worker command, image, owner-role test:db, drift test. | About 950 changed lines in total; see `## Split proposal`. |
| D2 | Where env → URL happens | `client.ts` gains `databaseUrlFromEnv(env)`, which returns `{ ok: true, url }` or `{ ok: false, reason: 'missing' \| 'invalid' }`. `createPgDb` uses it, with its current error messages unchanged. `migrate.ts` adds `migrateFromEnv(env, opts)`, which maps `missing`/`invalid` to exit 2. The accessor is **not** exported from the `@stoktok/db/pg` barrel. | The URL never leaves `packages/db/src/pg/`. STK-089's worker command only passes `process.env` and a directory. This is the same shape as `createPgDb(process.env, …)`. |
| D3 | Error text | Include `err.message` in a `MigrationError` only when the error is a server error (`err instanceof pg.DatabaseError`) or the runner's own guard error. Any other error (socket, TLS, URL parse) becomes a fixed text, with no message and no `cause`. Connect failures use the fixed text `cannot connect to the database (URL not printed)` plus the SQLSTATE via `sqlstateOf` if there is one. | TuDo prints any `err.message`. Node socket errors such as `connect ECONNREFUSED 127.0.0.1:9` carry the host, and `client.ts:72-76` already logs the code only. Server messages are kept because operators need them, and they never contain the URL. |
| D4 | Lock key | `MIGRATION_LOCK_KEY = '7865372087'` (bigint, > 2^31), passed as `$1::bigint`. | Consult §5: it cannot collide with `ai_reserve`'s int4 `hashtext('stoktok.ai_budget')`. Advisory locks are per database anyway. |
| D5 | `schema_migrations` location and shape | `public.schema_migrations (version text primary key, name text not null, checksum text not null, applied_at timestamptz not null default now())`, created by the runner with `create table if not exists` while it holds the lock. It is not in the baseline, not in `schema.ts`, and not in db:check (psql path). | TuDo `migrator.js:138-145`; consult §5. |
| D6 | Return value | `runMigrations` resolves to `{ applied: string[]; ahead: string[] }` (versions). It keeps the TuDo log lines. | The integration tests assert on this. STK-089's CLI only needs resolve vs. reject. |
| D7 | Timeouts | Per file: `set local lock_timeout = '10s'`, `set local statement_timeout = '5min'`. Connect timeout 5 s, default lock wait 30 s. These are constants in `migrate.ts`. | TuDo values. These are operational settings, not market rules (R5 does not apply). The pool profiles' 15 s/120 s statement timeouts are wrong for DDL (consult §5). |

## Acceptance criteria → verification
| # | Criterion (this slice) | How the reviewer verifies it |
|---|---|---|
| 1 | `migrate.ts` exports `parseMigrationFilename`, `checksum`, `planMigrations`, `readMigrationFiles`, `runMigrations`, `migrateFromEnv`, `MigrationError` and `MIGRATION_LOCK_KEY`. It is a faithful port of TuDo `migrator.js`, with D2–D7 as the only deltas. | Read `migrate.ts` side by side with `/home/user/tudocuatui/server/migrator.js`. The filename regex `^(\d{14})_([a-z0-9_]+)\.sql$`, the ahead/missing/mismatch/older rules and the per-file transaction sequence match. |
| 2 | Filename, checksum (sha256 hex, CRLF→LF) and plan rules are correct, including the edge cases. | `pnpm test` › `packages/db/src/pg/migrate.test.ts` › `parseMigrationFilename`, `checksum`, `planMigrations`, `readMigrationFiles`. |
| 3 | Exit codes: 2 for configuration errors (URL missing or invalid, directory missing, bad file name including `.down.sql`); 1 for runtime errors (connect, lock wait, mismatch, failed file, guard); a no-op or success resolves. Configuration errors fire before any connection attempt. | `migrate.test.ts` › `migrateFromEnv`, `readMigrationFiles`, `runMigrations config errors come before connecting`; `test-db/migrate.test.ts` cases. |
| 4 | The URL and password are never printed or carried on the error. | `migrate.test.ts` › `unreachable database: exit 1, no URL in message, String() or inspect()` (sentinel password, `127.0.0.1:9`). `migrateFromEnv` with an invalid sentinel URL. `grep -n "connectionString" packages/db/src/pg/migrate.ts` shows it only passed to `new pg.Client`, never to `log` or an error. |
| 5 | R3: `STOKTOK_DATABASE_URL` stays only in `client.ts`/`client.test.ts`. `databaseUrlFromEnv` is used only in `pg/client.ts`, `pg/migrate.ts` and their tests, and is not in the barrel. | `pnpm test` › `r3-guard.test.ts` (existing literal guard plus the new accessor guard). |
| 6 | One transaction per file with the timeouts, the GUC guard and `application_name`. A failing file rolls back and leaves no row. A file that ends the transaction itself is rejected. | `pnpm test:db` › `test-db/migrate.test.ts` › `session settings inside a migration`, `a failing file rolls back with no row`, `a file that commits itself is rejected`. |
| 7 | Idempotent re-run; checksum mismatch → exit 1 and nothing new applied; DB ahead → nothing applied, a warning, resolves. | `test-db/migrate.test.ts` › `fresh apply then idempotent re-run`, `checksum mismatch exits 1 and applies nothing`, `database ahead applies nothing`. |
| 8 | Concurrent runners serialise on the advisory lock; lock wait times out with exit 1. | `test-db/migrate.test.ts` › `a held lock blocks until released`, `lock wait times out`, `two concurrent runners apply each file once`. |
| 9 | The test:db template is built by `runMigrations` from `db/migrations`, and its `schema_migrations` holds exactly the baseline row with the file's checksum. | Read `global-setup.ts` (no hand-rolled `begin; … commit;` loop). `test-db/migrate.test.ts` › `template holds exactly the baseline row`. `baseline.test.ts` stays green. |
| 10 | Production keeps working: no release; no change to `apps/**`, Dockerfiles, `scripts/check-*.sh`, `release.yml`, `ci.yml`, db:check files or `db/migrations/*.sql`. | `git diff --stat main` lists only the files in the table below. No release branch is created. |
| 11 | `typecheck`, `lint`, `test`, `test:db` and `db:check` are green. | Run all five (test:db against local PG16 here; CI on 17). |

## Ming verification after merge
None. No release is cut; production is untouched until STK-084.

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/db/src/pg/migrate.ts` | **Create.** The runner (Approach step 2). | Criteria 1–4, 6–8. |
| `packages/db/src/pg/client.ts` | **Modify.** Add `DatabaseUrlResult` and `databaseUrlFromEnv(env)`; make `createPgDb` lines 34-36 use it with identical messages. | D2, R3, criterion 5. |
| `packages/db/src/pg/index.ts` | **Modify.** Export `runMigrations`, `migrateFromEnv`, `MigrationError`, `MIGRATION_LOCK_KEY`, `parseMigrationFilename`, `checksum`, `planMigrations` and their types. Do **not** export `databaseUrlFromEnv`. Extend the header comment: "the worker `migrate` command (STK-089) imports `migrateFromEnv` / `MigrationError`". | STK-089 consumes these through `@stoktok/db/pg`. |
| `packages/db/src/pg/migrate.test.ts` | **Create.** Unit tests (no DB). | Criteria 2–4. R8. |
| `packages/db/src/pg/client.test.ts` | **Modify.** Add a `databaseUrlFromEnv` describe block. The existing tests stay unchanged. | D2. |
| `packages/db/src/r3-guard.test.ts` | **Modify.** Add one test: `databaseUrlFromEnv` appears only in `packages/db/src/pg/{client,migrate}.ts` and `{client,migrate}.test.ts`, and `pg/index.ts` does not mention it. | Criterion 5 (ticket: "R3, r3-guard"). |
| `packages/db/test-db/global-setup.ts` | **Modify** `migrate()`: replace the read/`begin;…commit;` loop with `runMigrations({ connectionString: tplUrl, dir: join(ROOT, 'db/migrations') })`. Keep the admin connection: the owner role is STK-089. Drop the unused imports (`readdirSync`, `readFileSync`). | Criterion 9; STK-083 decision 2. |
| `packages/db/test-db/harness.ts` | **Modify.** Add `emptyDb(): Promise<{ url: string; drop(): Promise<void> }>`, which creates an empty `stoktok_test_<n>_<SUFFIX>` database (no template) so the cleanup sweep in `global-setup.ts:60` still matches. `drop` mirrors `freshDb`'s drop. | The integration tests need databases with no `schema_migrations`. |
| `packages/db/test-db/migrate.test.ts` | **Create.** Real-Postgres runner tests. | Criteria 6–9. |
| `packages/db/test-db/baseline.test.ts` | **Modify** line 33 only: add `and relname <> 'schema_migrations'` to the table-list query. | The template now carries the runner's table. The 18-table assertion is about the baseline. |
| `db/migrations/README.md` | **Modify** line 5: "Applied by the worker `migrate` command (STK-089) through the runner `packages/db/src/pg/migrate.ts` (`public.schema_migrations`, sha256 checksums with CRLF normalised, advisory lock, one transaction per file), and by `pnpm test:db`, which builds its template with the same runner. `pnpm db:check` applies them via psql." | Keeps the doc true. |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | **Modify.** Line 25 slice order: insert "STK-089 (worker `migrate` command and image)" after STK-087. §12: append "The template is built by the migrate runner (STK-087)." | Keeps the ADR true (same practice as STK-083). |

Do **not** touch:
- `apps/**`, Dockerfiles, `.dockerignore`, `scripts/**`, `.github/**`;
- `db/migrations/*.sql`, `db/rollback/**`;
- `packages/db/src/migrations-lint.test.ts` (STK-088);
- `packages/db/src/pg/schema.ts`;
- `CLAUDE.md`.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `migrate.test.ts › parseMigrationFilename` | Accepts `20261111000200_baseline.sql` → `{ version: '20261111000200', name: 'baseline' }` and `20261111000200_a_1.sql`. Returns `null` for: `20261111000200_baseline.down.sql`, `20261111000200_Baseline.sql`, `2026111100020_x.sql` (13 digits), `202611110002000_x.sql` (15), `20261111000200x.sql`, `20261111000200_x-y.sql`, `20261111000200_x.SQL`, `20261111000200_x.sql ` (trailing space), `20261111000200_bảng.sql` (Vietnamese diacritic), `''`, `dir/20261111000200_x.sql`, `README.md`. |
| `… › checksum` | A hard-coded sha256 hex of `'select 1;\n'` (computed once with `printf 'select 1;\n' \| sha256sum`). CRLF and LF text give the same value. A `Buffer` and a `string` give the same value. A lone `\r` is **not** normalised (`'a\rb'` ≠ `'a\nb'`). Different content gives different values. The result is 64 lowercase hex chars. |
| `… › planMigrations` | Empty/empty → `{ pending: [], ahead: [] }`. Unsorted local input → pending sorted by version. Applied subset → the rest pending. Checksum mismatch → `MigrationError` exitCode 1, message names the version. Applied but missing locally and older than the newest local → throws `missing locally`. Applied newer than every local → `ahead` lists it. Pending older than the newest applied known version → throws `older than the newest applied`. Inputs are not mutated. |
| `… › readMigrationFiles` | Tmp dir with `README.md`, `20261111000300_b.sql` and `20261111000200_a.sql` → two files in version order, with `sql` and `checksum`. `x.sql` → exitCode 2 `invalid migration file name`. `20261111000200_a.down.sql` → exitCode 2. A missing dir → exitCode 2 `migrations directory not found`. The repo's `db/migrations` → contains `20261111000200`/`baseline`, and every entry parses. |
| `… › runMigrations config errors come before connecting` | Missing dir plus an unreachable URL → exitCode 2 (not 1). |
| `… › unreachable database: exit 1, no URL in message, String() or inspect()` | `postgres://u:pw-SENTINEL-9@127.0.0.1:9/x` with a valid tmp dir → `MigrationError`, exitCode 1. `message`, `String(err)` and `inspect(err, { showHidden: true, depth: Infinity })` contain neither `pw-SENTINEL` nor `127.0.0.1`. `err.cause` is undefined. The `log` spy was never called with either string. |
| `… › migrateFromEnv` | `{}` and `{ [DATABASE_URL_ENV]: '' }` → exitCode 2, message `` `${DATABASE_URL_ENV} is not set` ``. A `mysql://u:pw-SENTINEL@h/x` value → exitCode 2 without the sentinel. Use the `DATABASE_URL_ENV` constant, never the literal name (r3-guard). |
| `client.test.ts › databaseUrlFromEnv` | missing/empty → `{ ok: false, reason: 'missing' }`. `http://…`/`mysql://…` → `invalid`. `postgres://…`/`postgresql://…` → `{ ok: true, url }`. A failure result does not contain the value. |
| `r3-guard.test.ts › databaseUrlFromEnv is used only in pg/client.ts, pg/migrate.ts and their tests; not in the barrel` | Criterion 5. |
| `test-db/migrate.test.ts › template holds exactly the baseline row` | On `freshDb()`: `select version, name, checksum from public.schema_migrations` equals `[{ version: '20261111000200', name: 'baseline', checksum: checksum(readFileSync(<baseline>)) }]`. |
| `… › fresh apply then idempotent re-run` | `emptyDb()` and a tmp dir with two files → `applied` = both versions, two rows. The second run → `applied: []`, `log` saw `up to date`, still two rows. |
| `… › session settings inside a migration` | A fixture file `create table probe as select current_setting('lock_timeout') lt, current_setting('statement_timeout') st, current_setting('application_name') app, current_setting('stoktok.migrating') m;` → the row is `10s`, `5min`, `stoktok-migrate`, `on`. After the run, a new admin session sees `current_setting('stoktok.migrating', true)` as null or empty (transaction-local). |
| `… › checksum mismatch exits 1 and applies nothing` | Apply v1. Rewrite v1's content and add v2 → rejects with exitCode 1 `checksum mismatch for applied migration <v1>`. v2's table does not exist; one row. Rewriting v1 with only LF→CRLF does **not** mismatch. |
| `… › a failing file rolls back with no row` | v1 ok; v2 = `create table half (x int); select 1/0;` → exitCode 1, `code` `22012`, message starts `migration <v2> failed:`. `to_regclass('public.half')` is null. Rows = [v1]. |
| `… › a file that commits itself is rejected` | v1 = `create table selfc (x int); commit;` → exitCode 1, message contains `ended the transaction itself`. No row for v1. (The table survives: this is the TuDo limitation; the lint in `migrations-lint.test.ts` is the primary defence. Assert and comment on it.) |
| `… › database ahead applies nothing` | Apply v1, v2. Run with a dir holding only v1 → resolves `{ applied: [], ahead: [v2] }`, `log` saw `database is ahead`, rows unchanged. |
| `… › a held lock blocks until released` | A separate `pg.Client` holds `pg_advisory_lock($1::bigint)` with `MIGRATION_LOCK_KEY`. Start a runner (`lockWaitMs: 10_000`). After about 300 ms, `to_regclass('public.schema_migrations')` is still null. Unlock → the runner resolves with v1 applied. |
| `… › lock wait times out` | Lock held as above; `lockWaitMs: 300` → exitCode 1 `another migration is running`. Nothing created. |
| `… › two concurrent runners apply each file once` | `Promise.all` of two runners on the same `emptyDb()`. v1 = `select pg_sleep(0.5); create table once_t (x int);`. Both resolve. Their `applied` arrays together hold v1 exactly once. One row. |

Every integration test builds its fixture dir with `mkdtempSync(join(tmpdir(), 'stoktok-mig-'))` and removes it in `afterAll`/`finally`. Every `emptyDb()` is dropped.

## Approach
1. **`client.ts` accessor (D2).**
   - Add `databaseUrlFromEnv(env)`: `const url = env[DATABASE_URL_ENV]`. If it is empty, return `missing`. If it does not start with `postgres://` or `postgresql://`, return `invalid`. Otherwise return `{ ok: true, url }`.
   - `createPgDb` calls it and throws the same `Missing env …`/`Invalid env …` messages as today.
   - Add a JSDoc line: "The only reader of the database URL (R3). Used by createPgDb and pg/migrate.ts."
2. **`migrate.ts`** (header: "Server-only (R3). Forward-only migration runner, ported from TuDoCuaTui server/migrator.js (STK-087). Never logs the URL, the config or whole error objects."). Port `migrator.js` with these deltas:
   - TypeScript types: `MigrationRef`, `MigrationFile`, `RunResult`, `RunOptions { connectionString; dir; log?; lockWaitMs? }`.
   - `MigrationError extends Error` with `exitCode: 1 | 2` and an optional `code`. Set `name = 'MigrationError'`.
   - Compare versions with plain string `<`/`>` (14 fixed digits). Do not use `localeCompare`.
   - `runMigrations`:
     - `readMigrationFiles(dir)` first.
     - Then `new pg.Client({ connectionString, connectionTimeoutMillis: 5_000, application_name: 'stoktok-migrate' })` inside the try, with `client.on('error', () => {})` before `connect()`.
     - The lock loop uses `select pg_try_advisory_lock($1::bigint) as ok` with `[MIGRATION_LOCK_KEY]`.
     - `create table if not exists public.schema_migrations (…)` (D5); select from `public.schema_migrations`.
     - On ahead: `log('warning: database is ahead of this image (<versions>); nothing applied')` and return.
     - Per file: `begin`; `set local lock_timeout = '10s'`; `set local statement_timeout = '5min'`; `set local stoktok.migrating = 'on'`; the file text; the guard `select current_setting('stoktok.migrating', true) = 'on' as ok`; `insert into public.schema_migrations …`; `commit`.
     - On error: `rollback` (errors ignored), then throw `MigrationError(\`migration ${v} failed: ${detail}\`, 1, sqlstateOf(err))`, with `detail` as in D3.
     - `finally`: `pg_advisory_unlock($1::bigint)` if locked (errors ignored), then `client.end()` (errors ignored).
     - Log `applied <v>_<name> (<ms> ms)` / `up to date`.
   - `migrateFromEnv(env, { dir, log?, lockWaitMs? })`: `databaseUrlFromEnv(env)` → missing: `MigrationError(\`${DATABASE_URL_ENV} is not set\`, 2)`; invalid: `MigrationError(\`${DATABASE_URL_ENV} is not a postgres:// URL\`, 2)`. Otherwise `runMigrations`.
   - Lint: rethrowing a new error inside `catch` trips `preserve-caught-error`. Use the same targeted `// eslint-disable-next-line preserve-caught-error -- the cause can carry host and credentials` as `client.ts:75`. Never attach `cause`.
3. **Barrel** exports (Files table).
4. **test:db:**
   - `global-setup.ts`: the `migrate()` body becomes the `runMigrations` call (no `log`). On failure it already prints only `(e as Error).message`, which is a safe `MigrationError` message.
   - `harness.ts`: add `emptyDb()`.
   - `baseline.test.ts`: add the one-line filter.
5. **Tests** as listed. In `test-db/migrate.test.ts`, import from `../src/pg/migrate`. Use `pg.Client` on `emptyDb().url` for assertions.
6. **Docs:** README line 5, ADR 0010 lines 25 and 20.
7. **Verify:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db` (local PG16 from `/usr/lib/postgresql/16/bin`, as in prior tickets) and `pnpm db:check`. Record the outputs in `impl-log.md`.

**Rules:**
- **R3:** the URL is read only through `client.ts`. It is passed only to `new pg.Client` and is never logged or carried on an error (D3; criterion 4; the guard test).
- **R2, R5:** not touched (no money, no market rules; D7 timeouts are operational).
- **R7:** worker, image, owner role and drift test stay out (STK-089).
- **R8:** unit tests plus real-Postgres tests; all five checks are green.
- **R10:** not affected.

## Specialist input used
`work/tickets/STK-083/consult-database-optimizer.md` (no new consult):
- **Adopted (§5):**
  - location `packages/db/src/pg/migrate.ts`, exported from `@stoktok/db/pg`;
  - URL through `client.ts` (R3), with exit code 2 and fixed messages;
  - a dedicated `pg.Client` with `application_name: stoktok-migrate`, not `createPgDb`;
  - a lock key above 2^31 (D4);
  - GUC renamed to `stoktok.migrating`;
  - `schema_migrations` in `public`;
  - the unit tests for `parseMigrationFilename`/`checksum`/`planMigrations`;
  - the integration tests (idempotent, mismatch, failing file, concurrency, DB ahead).
- **Adopted (§6):** "Add an assertion that `schema_migrations` holds exactly the baseline row with the matching checksum"; the template is built by `runMigrations`.
- **Adjusted:**
  - §5 error text is stricter than TuDo (D3).
  - §5 "Add it to the `tables_exist` list" is not applicable: db:check applies via psql (STK-083 decision 2).
  - §5 "exclude it in the test:db type guard" is not needed: `schema_migrations` uses only `text` and `timestamptz`, which are already in `types.test.ts`'s `HANDLED` set. Instead, `baseline.test.ts`'s table list excludes it.
- **Moved to STK-089:**
  - §5 worker `migrate` subcommand, directory argument defaulting to the image path, Dockerfile `COPY`, `.dockerignore` check;
  - §5 drift test;
  - §6 owner role `stoktok_test_owner`, template and clones owned by it, `freshDb` connecting as the owner.
- **Already done:** §5 `.gitattributes` (STK-083) and the static lint (STK-083, extended by STK-088).

## Assumptions
- **A1. Hotspots.**
  - STK-088 (BACKLOG) edits `db/migrations/README.md` (lines 3 and 7) and `migrations-lint.test.ts`. This slice edits README line 5 only and does not touch the lint. Expect a trivial rebase if they cross.
  - STK-086 (DONE) touched no file in this list.
  - No `App.tsx`-style hotspot.
- **A2.** test:db in this slice still connects as the admin superuser, as today. The runner itself behaves the same for any role. STK-089 proves the non-superuser path in test:db, and db:check already proves the baseline applies as the owner (STK-086).
- **A3.** `pg.DatabaseError` is exported by `pg@^8.23` (it re-exports `pg-protocol`'s class). If the typings lack it, the implementer may use `sqlstateOf(err) !== undefined` as the server-error test and record that in `impl-log.md`.
- **A4.** Port 9 on `127.0.0.1` refuses connections in this sandbox and on GitHub runners, as `check-image.sh:41` already assumes. The unit test needs no Postgres.
- **A5.** CI runs `test:db` and then `db:check` against the same `postgres:17` service. This slice creates no persistent role, and every `emptyDb()` matches the `stoktok\_test\_%\_<pid>` cleanup pattern, so STK-086's "refuse if a non-system database exists" check is not tripped.
- **A6.** CI on `main` builds `:latest` worker images as today. This slice changes no image content, so the release rule holds trivially.
- **A7.** The deployment contract for STK-084 (informational): the org-admin-api compose shows the pattern, a `migrate` service with `profiles: [migrate]`, `restart: "no"` and `networks: [db]` (`/home/user/deployment/apps/org-admin-api/compose.yml:50-55`). For stoktok that will be the worker image with `command: ["migrate"]` (entrypoint `node dist/cli.js`), delivered by STK-089 (image) and STK-084 (compose). The TuDo compose file named in the task currently has no `migrate` service.

## Blocking questions
None.

## Split proposal
**Why:** the full ticket comes to roughly 950 changed lines:
- runner: about 190;
- accessor and barrel: about 20;
- runner unit tests: about 160;
- runner integration tests: about 220;
- test:db template switch and `emptyDb`: about 30;
- r3-guard: about 12;
- worker command and its tests: about 140;
- Dockerfile and `check-image.sh`: about 35;
- owner-role test:db (role bootstrap, owner URL, clones): about 110;
- drift test with a `schema.ts` parser: about 90;
- docs: about 10.

It spans the production migration path, credentials handling, the deploy image and the test harness. With a 2-rework cap, one cycle would very likely escalate. Slice 1 is self-contained in `packages/db` and is exercised by every test:db run. Slice 2 is the thin production entry point plus the harness hardening.

| Slice | ID | Title | Scope | Depends on |
|---|---|---|---|---|
| 1 (**this plan**) | STK-087 | Migrate runner | Everything in this plan (about 600 lines, of which about 210 are logic and the rest tests). | STK-083 |
| 2 | **STK-089** (new) | Worker `migrate` command, image, owner-role test:db and schema drift test | See the scope list below this table. Areas: db, security, architecture. | STK-087 |

STK-089 scope:
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
