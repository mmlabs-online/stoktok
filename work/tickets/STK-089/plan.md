Status: READY

# Plan — STK-089: Worker migrate command, image, owner-role test:db and schema drift test (STK-087 split)

This plan covers the whole ticket in one slice. `## Split proposal` explains why and gives a fallback.

## Spec summary
The ticket `## Goal` is the scope; it is copied verbatim from `work/tickets/STK-087/plan.md` › "STK-089 scope". The key lines:
> `apps/worker/src/migrate.ts` exports `resolveMigrationsDir(moduleDir, exists)` … and `migrateCommand(argv, { env, dir, run = migrateFromEnv })`. Any extra argument → usage, exit 2. … On a `MigrationError` it prints `migrate failed: <message>[ [<code>]]` to stderr with exitCode = `err.exitCode`. On any other error it prints `migrate failed: unexpected error` with exit 1, never the message.
> `cli.ts` `main`: when `argv[0] === 'migrate'`, delegate before `parseArgs`, without calling `openDb`/`createPgDb`. Add `migrate` to `USAGE`.
> `apps/worker/Dockerfile`: `COPY --from=build /repo/db/migrations ./migrations` (root-owned, read-only for `node`). `.dockerignore`: verified only.
> `check-image.sh` worker block: `migrate` with no URL → exit 2 with non-empty stderr; with `STOKTOK_DATABASE_URL=postgres://smoke:smoke-pw@127.0.0.1:9/smoke` → exit 1 within `timeout 20`, no `smoke-pw`/`127.0.0.1` in the output; `/app/migrations` contains `20261111000200_baseline.sql` and no `*.down.sql`.
> `stoktok_test_owner`: `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, created idempotently under `pg_advisory_xact_lock` on the admin connection, with 42710 (and the concurrent-create 23505) tolerated. Never dropped. Its password is a deterministic value derived from the admin URL's password (sha256, hex) … shared … through a small `test-db/owner.ts`.
> Template: `create database tpl owner stoktok_test_owner`; then in the template as admin, `alter schema public owner to stoktok_test_owner; revoke all on schema public from public;`; then `runMigrations` connecting as the owner. Clones: `create database x template tpl owner stoktok_test_owner`. `freshDb`/`emptyDb` return owner URLs …
> Drift test. `test-db/schema-drift.test.ts` parses `packages/db/src/pg/schema.ts` … compares, per table, the column-name set and nullability with `information_schema.columns` for `public` (excluding `schema_migrations`) in both directions. It includes a fixture showing the parser flags a missing column and a nullability flip, and a guard that the parse found 18 tables.
> Docs. ADR 0010 §12 (owner role) and README.

Ticket notes (orchestrator, from the STK-087 security review):
> add an r3-guard rule that only apps/worker (and test-db) import `runMigrations`/`migrateFromEnv`; `check-image.sh` asserts `/app/migrations` holds only regular files.

ADR 0010 §9:
> test-only down files live in `db/rollback` (the runner rejects `.down.sql` in its directory and the image does not ship them).

Release rule (ticket):
> STK-081 to STK-083 merge to main but no stoktok release is cut until STK-084.

CLAUDE.md R3: the service credentials are server-only; `STOKTOK_DATABASE_URL` is read only in `packages/db/src/pg/client.ts` (r3-guard).

## Decisions taken in this plan
| # | Point | Decision | Why |
|---|---|---|---|
| D1 | **`apps/worker/src/cli.ts` in the r3-guard allowlist for `runMigrations`/`migrateFromEnv`** (the two consults disagree) | **Not in the allowlist, and neither is `cli.test.ts`.** `cli.ts` imports only `migrateCommand` (and the `MigrateDeps` type) from `./migrate`. All defaults (`env = process.env`, `dir = resolveMigrationsDir(...)`, `run = migrateFromEnv`) are filled **inside** `migrateCommand`. `main` gets an optional third parameter `migrateDeps?: Partial<MigrateDeps>` and passes it through unchanged. | The orchestrator note asks for one choke point. With the defaults inside `migrate.ts`, `cli.ts` never needs the names, so the narrower list costs nothing (software-architect R-6). The database-optimizer listed `cli.ts` only because it assumed the defaults would live there. Allowlist: `packages/db/src/pg/{migrate,migrate.test,index}.ts`, `packages/db/test-db/**`, `apps/worker/src/migrate.ts`, `apps/worker/src/migrate.test.ts`. |
| D2 | `migrateCommand` signature | `migrateCommand(argv: readonly string[], deps: Partial<MigrateDeps> = {}): Promise<void>`. `MigrateDeps = { env: Record<string, string \| undefined>; dir: string; run: (env, opts: { dir: string; log: (line: string) => void }) => Promise<unknown> }`. `dir` is resolved lazily (only when not injected) from `dirname(fileURLToPath(import.meta.url))` and `existsSync`. **It never rejects**: the whole body, including default resolution, is inside one try/catch. | Ticket shape, plus testability without touching the real env or network (architect R-1, R-2). It also closes the `cli.ts:166-168` `e.message` leak path (architect finding 4). |
| D3 | Output streams | `migrate` logs go to **stdout** (`console.log`) and failures to **stderr** (`console.error`), as the ticket says. Usage for an extra argument goes to stderr. | Ticket. Documented in the worker README because other jobs log to stderr (architect R-7). |
| D4 | Owner role bootstrap | In `global-setup.ts` on the admin connection, in one transaction: `begin; select pg_advisory_xact_lock($1::bigint)` with key `OWNER_ROLE_LOCK_KEY = '7865372089'` (not `MIGRATION_LOCK_KEY`); if `pg_roles` has no row, `create role stoktok_test_owner`; then **always** `alter role stoktok_test_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '<hex>'`; `commit`. On 42710 or 23505, roll back and retry the whole sequence once. | Ticket, plus DB-optimizer R-1: always setting the password and attributes makes a stale role converge. The alter sits under the lock so two runs on the same admin database never hit "tuple concurrently updated". |
| D5 | Password derivation | `ownerPassword(adminUrl) = sha256('stoktok_test_owner:' + decodeURIComponent(adminUrl.password)).hex`. It works for an empty password. Before the value is inlined into SQL, it is asserted to match `/^[0-9a-f]{64}$/` and the role name to match `/^[a-z_]+$/` (`ALTER ROLE` cannot take a bind parameter). | Ticket and DB-optimizer R-2. |
| D6 | Owner URL | `ownerUrl(admin: URL \| string, db: string): string` copies the admin URL and sets `username`, `password` and `pathname` with the `URL` setters (no string replacement). Host, port and query are kept. | DB-optimizer R-3. |
| D7 | `emptyDb` parity | `emptyDb()` also gets `owner stoktok_test_owner` plus the `alter schema public owner …; revoke all on schema public from public;` step as admin. It returns the owner URL. | DB-optimizer R-5: production (`add-app-db.sh`) does the alter and revoke, so test databases should match. |
| D8 | Where the pure helpers live | `packages/db/test-db/owner.ts` (no `pg` import) and `packages/db/test-db/schema-drift-parse.ts` (pure parser and compare, no `pg`, no fs). Their unit tests, including the ticket's "missing column" and "nullability flip" fixtures, go in **`packages/db/src/test-db-helpers.test.ts`**, which runs under `pnpm test`. `test-db/schema-drift.test.ts` does the real comparison and the 18-table guard. | Postgres is not available on the local Windows host, so `pnpm test` is the only local proof of the parser and the derivation. The fixtures still exist as the ticket asks; they now also run without a DB (DB-optimizer R-11). |
| D9 | Drift parser strictness | Fail closed (DB-optimizer R-8). Inside an `export interface …Table {` block, every non-blank, non-comment line must match `^\s*(\w+):\s*(.+);\s*$`, otherwise it throws with the table and the line. Column names must be unique per table. The table list comes from the `Database` map (`key: InterfaceName;`). Every `…Table` interface must be in the map, and every map value must be a parsed interface. **Nullable** means a top-level `\| null`: the type text has its `<…>` generic bodies stripped (nesting-aware) before testing `/\|\s*null\b/`. `\| undefined` is not null. | Ticket rule ("nullable means the type contains `\| null`"), hardened against `ColumnType<… \| null …>` false positives (DB-optimizer finding 6). |
| D10 | Drift DB query | Runs **as the owner** on a `freshDb()` clone: `select c.table_name, c.column_name, c.is_nullable from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.table_name <> 'schema_migrations'`. Both directions are compared; every failure message names the table and the column. | Ticket and DB-optimizer R-9. |
| D11 | Insertability compare (DB-optimizer R-10) | **Out of scope.** Listed as a follow-up for a `debt` issue. | Not in the ticket (R7). |
| D12 | Image layout checks | Whole-directory copy (README.md included; the runner ignores non-`.sql` files). `check-image.sh` checks, as root: the baseline exists; `find /app/migrations -mindepth 1 ! -type f` is empty; `find /app/migrations -name '*.down.sql'` is empty. As the default user (`node`): `/app/migrations` and the baseline file are not writable. | Ticket, the orchestrator note "only regular files", and both consults (DB R-13, architect R-5). |

## Acceptance criteria → verification
"Local" means the Windows host (no Docker, no Postgres). "CI" means the PR's `ci` and `images` jobs (`.github/workflows/ci.yml`); `test:db` and `db:check` run on the `postgres:17` service there.

| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | `resolveMigrationsDir(moduleDir, exists)` returns the first existing of `resolve(moduleDir,'../migrations')` and `resolve(moduleDir,'../../../db/migrations')`, else the first. | Local `pnpm test` › `apps/worker/src/migrate.test.ts` › `resolveMigrationsDir` cases. |
| 2 | `migrateCommand`: an extra argument gives usage and exit 2 without calling `run`; logs go to stdout; a `MigrationError` gives `migrate failed: <message>[ [<code>]]` on stderr with exit `err.exitCode`; any other error (rejected, thrown synchronously, or not an `Error`) gives `migrate failed: unexpected error` with exit 1 and no echo of the message; success gives exit 0; it never rejects. | Local `pnpm test` › `apps/worker/src/migrate.test.ts` › `migrateCommand` cases (sentinel `postgres://u:SENTINEL-pw@127.0.0.1/x` never appears in any console output). |
| 3 | `main(['migrate', …])` delegates before `parseArgs` and never calls `openDb`; `USAGE` mentions `migrate`. | Local `pnpm test` › `apps/worker/src/cli.test.ts` › `main migrate` cases. Reading `cli.ts` shows the branch is the first statement of `main`. |
| 4 | r3-guard: `runMigrations`/`migrateFromEnv` appear only in the D1 allowlist; nothing under `apps/web/` mentions them; the regex catches its fixtures. | Local `pnpm test` › `packages/db/src/r3-guard.test.ts` › the new test and its regex self-test. `grep -rnE "\b(runMigrations\|migrateFromEnv)\b" apps/worker/src/cli.ts` prints nothing. |
| 5 | The Dockerfile copies `db/migrations` to `/app/migrations` root-owned (no `--chown`), after `dist` and before `USER node`; `.dockerignore` excludes neither `db` nor `*.sql`; `db/rollback` is not copied into the runtime stage. | Read the Dockerfile diff and `.dockerignore` (unchanged). In CI, the `images` › worker › "Image checks" step runs the criterion 6 assertions. |
| 6 | `check-image.sh` worker block: `migrate` with no URL exits exactly 2 with non-empty stderr; with the unreachable URL it exits exactly 1 (not 124) within `timeout 20`, and the combined output has no `smoke-pw` or `127.0.0.1`; `/app/migrations` holds the baseline, only regular files and no `*.down.sql`; `node` cannot write it. | Local: `bash -n scripts/check-image.sh` exits 0 (and `shellcheck scripts/check-image.sh` if it is installed; record if not). CI: the `images (worker)` job is green, and its log shows the new `== smoke: worker migrate …` lines. |
| 7 | `stoktok_test_owner` exists with the D4 attributes, is created idempotently under the advisory lock, is never dropped, and has a password derived per D5. Its name is not one of db:check's refused names. | Local `pnpm test` › `packages/db/src/test-db-helpers.test.ts` › `owner role` cases (derivation, URL swap, name not in `stoktok`/`stoktok_nobody`/`dbcheck_canary`/`postgres`/`pg_*`). CI `pnpm test:db` › `test-db/owner-role.test.ts`. Reading `global-setup.ts` shows no `drop role`. |
| 8 | The template is created `owner stoktok_test_owner`, its `public` schema is re-owned and PUBLIC is revoked as admin, and `runMigrations` connects as the owner; clones and `emptyDb` are owned by the owner and return owner URLs; create/drop stay on the admin connection. | CI `pnpm test:db` › `test-db/owner-role.test.ts` (`current_user`, `session_user`, flags, `datdba`, `nspowner`, every `public` relation owned by the owner, `create role`/`create database` give 42501). All other existing test:db files stay green as the owner. |
| 9 | The drift test compares column names and nullability in both directions for the 18 tables and fails closed; the fixtures prove a missing column and a nullability flip are flagged. | Local `pnpm test` › `packages/db/src/test-db-helpers.test.ts` › `schema drift parser` cases (run against the real `schema.ts` text too: 18 tables). CI `pnpm test:db` › `test-db/schema-drift.test.ts`. |
| 10 | Docs: ADR 0010 §12 describes the owner role; the worker README documents the `migrate` command; the root README shows `docker run … migrate`. | Read the diffs. |
| 11 | Production keeps working; no release is cut. | `git diff --stat main` lists only the files in the table below; no change to `.github/workflows/release.yml`, `db/migrations/*.sql` or `packages/db/src/pg/schema.ts` (unless the drift test finds real drift, see A5). No release branch or tag is created. |
| 12 | `typecheck`, `lint`, `test`, `test:db` and `db:check` are green. | Local: `pnpm typecheck`, `pnpm lint`, `pnpm test`. CI on the PR: the `ci` job (which runs `test:db` then `db:check` on `postgres:17`) and both `images` jobs are green (`gh pr checks <PR>`). R8: no PASS until CI is green. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `apps/worker/src/migrate.ts` | **Create.** `resolveMigrationsDir`, `MigrateDeps`, `MIGRATE_USAGE`, `migrateCommand` (D1–D3). Imports `migrateFromEnv` and `MigrationError` from `@stoktok/db/pg`. Header: "Server-only (R3). One-shot `migrate` command (STK-089). Never prints the URL or an unknown error's message." | Criteria 1–2. |
| `apps/worker/src/migrate.test.ts` | **Create.** Unit tests (no DB, no network, no real env var). | Criteria 1–2. R8. |
| `apps/worker/src/cli.ts` | **Modify.** Add `import { migrateCommand, type MigrateDeps } from './migrate'`. `main(argv, openDb = …, migrateDeps?: Partial<MigrateDeps>)`: first statement `if (argv[0] === 'migrate') { await migrateCommand(argv.slice(1), migrateDeps); return; }`. Prepend `migrate (no flags) | ` to `USAGE`. Nothing else changes. | Criterion 3. |
| `apps/worker/src/cli.test.ts` | **Modify.** Add a `main migrate` describe block. Existing tests are unchanged. | Criterion 3. |
| `apps/worker/Dockerfile` | **Modify.** After the `dist` COPY and before `USER node`: `# root-owned, read-only for node; db/rollback is never copied (ADR 0010 §9)` and `COPY --from=build /repo/db/migrations ./migrations`. | Criterion 5. |
| `scripts/check-image.sh` | **Modify** the worker block only, before `exit 0` (line 50). See Approach step 3. | Criterion 6. |
| `packages/db/test-db/owner.ts` | **Create.** `OWNER_ROLE`, `OWNER_ROLE_LOCK_KEY`, `ownerPassword(admin)`, `ownerUrl(admin, db)`, `ownerRoleSql(password)` (returns the `alter role` statement after the D5 asserts). No `pg` import. | Criteria 7–8 (D4–D6, D8). |
| `packages/db/test-db/global-setup.ts` | **Modify.** `ensureOwnerRole()` (D4) before the template is created. The template is `create database … owner stoktok_test_owner`, then the schema alter/revoke as admin on the template (client ended), then `runMigrations({ connectionString: ownerUrl(admin, TEMPLATE), dir })`. `checkAdminUrl`, cleanup and the error handling are unchanged. | Criteria 7–8. |
| `packages/db/test-db/harness.ts` | **Modify.** `freshDb` clones with `owner stoktok_test_owner` and returns `ownerUrl(...)`; `createPgDb` uses that URL. `emptyDb` per D7. `admin()` and the drop helpers stay on the admin URL. | Criterion 8. |
| `packages/db/test-db/owner-role.test.ts` | **Create.** Real-Postgres owner assertions. | Criteria 7–8. |
| `packages/db/test-db/schema-drift-parse.ts` | **Create.** `parseSchemaTs(text): Map<string, Map<string, boolean>>` (table → column → nullable) and `compareSchema(ts, dbRows): string[]` (D9). Pure. | Criterion 9. |
| `packages/db/test-db/schema-drift.test.ts` | **Create.** Reads `packages/db/src/pg/schema.ts`, parses it, asserts 18 tables, queries per D10 as the owner and expects `compareSchema(...)` to be `[]`. | Criterion 9. |
| `packages/db/src/test-db-helpers.test.ts` | **Create.** `pnpm test` unit tests for `owner.ts` and `schema-drift-parse.ts` (D8). | Criteria 7, 9; local proof without Postgres. |
| `packages/db/src/r3-guard.test.ts` | **Modify.** Add the D1 test and its regex self-test. | Criterion 4. |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | **Modify** §12: append the owner-role sentence (Approach step 7). | Criterion 10. |
| `apps/worker/README.md` | **Modify.** Add a `## Migrations (`migrate`)` section (Approach step 7). | Criterion 10; architect R-7, R-8. |
| `README.md` | **Modify.** In the "Build and run locally" block, add `docker run --rm --env-file apps/worker/.env.local stoktok-worker migrate   # applies db/migrations; exit 0/1/2`. | Criterion 10. |

Do **not** touch:
- `packages/db/src/pg/**` (including `schema.ts`, unless A5 applies);
- `db/migrations/**`, `db/rollback/**`;
- `.dockerignore` (verified only), `.github/**`, `scripts/db-check*`, `apps/web/**`, `CLAUDE.md`.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `apps/worker/src/migrate.test.ts › resolveMigrationsDir: image layout` | `resolveMigrationsDir('/app/dist', (p) => p === resolve('/app/migrations'))` equals `resolve('/app/migrations')`. Expectations are built with `path.resolve` so the test passes on Windows. |
| `… › resolveMigrationsDir: repo layout from src and dist` | With `<root> = resolve('/r')` and `exists` true only for `resolve('/r/db/migrations')`: `moduleDir` `/r/apps/worker/src` and `/r/apps/worker/dist` both give `resolve('/r/db/migrations')`. |
| `… › resolveMigrationsDir: nothing exists → first candidate` | `exists = () => false` gives `resolve(moduleDir, '../migrations')`. |
| `… › resolveMigrationsDir: real repo` | `resolveMigrationsDir(dirname(fileURLToPath(import.meta.url)), existsSync)` equals `resolve(<repo>/db/migrations)`. |
| `… › migrateCommand: extra argument → usage, exit 2, run not called` | `['x']` and `['--dry-run']`: the stderr spy got a line containing `migrate`, `process.exitCode === 2`, and `run` was not called. |
| `… › migrateCommand: success → exit 0, logs to stdout, passes env and dir` | `run` calls `opts.log('applied v')` and resolves. The `console.log` spy saw `applied v`, `console.error` was not called, and `run` got the same `env` object and `{ dir: '/d' }`. Exit 0. |
| `… › migrateCommand: MigrationError mapping` | `new MigrationError('m2', 2)` → stderr `migrate failed: m2`, exit 2. `new MigrationError('m1', 1, '22012')` → `migrate failed: m1 [22012]`, exit 1. |
| `… › migrateCommand: unknown error → fixed text, exit 1, no echo` | Three cases: `run` rejects with `new Error('postgres://u:SENTINEL-pw@127.0.0.1/x')`; `run` throws that error synchronously; `run` rejects with the string `'SENTINEL-pw'`. Each gives exactly `migrate failed: unexpected error` on stderr, exit 1, `migrateCommand` resolves, and no console spy call contains `SENTINEL` or `127.0.0.1`. |
| `… › migrateCommand: default run with env {} → exit 2, no network` | `migrateCommand([], { env: {}, dir: '/nonexistent' })` (real `migrateFromEnv`) → exit 2, stderr starts with `migrate failed:` and ends with `is not set`. |
| `apps/worker/src/cli.test.ts › main migrate: delegates without opening a DB` | `main(['migrate'], openDbSpy, { env: {}, dir: '/nonexistent' })` → exit 2, `openDbSpy` not called. |
| `… › main migrate: extra argument → exit 2, no DB` | `main(['migrate', '--dry-run'], openDbSpy, { run: runSpy })` → exit 2; neither spy called. |
| `… › usage lists migrate` | `parseArgs([])` gives `ok: false` with a usage string containing `migrate`. |
| `packages/db/src/r3-guard.test.ts › runMigrations / migrateFromEnv appear only in the migrate runner, its barrel, test-db and apps/worker/src/migrate(.test).ts` | D1 allowlist. Hits outside → `[]`. Hits under `apps/web/` → `[]` (named assertion). Positive: hits include `packages/db/src/pg/migrate.ts` and `apps/worker/src/migrate.ts`. |
| `… › migrate-entry regex catches its fixtures` | True for `runMigrations(`, `await migrateFromEnv(`, `import { runMigrations as rm } from '@stoktok/db/pg'`; false for `runMigrationsX`, `xmigrateFromEnv`. |
| `packages/db/src/test-db-helpers.test.ts › owner role: name and flags` | `OWNER_ROLE === 'stoktok_test_owner'`, matches `/^[a-z_]+$/`, is not in `['stoktok', 'stoktok_nobody', 'dbcheck_canary', 'postgres']` and does not start with `pg_`. |
| `… › owner role: password derivation` | Deterministic for the same URL. 64 lowercase hex chars. Different admin passwords give different values. Not equal to bare `sha256(adminPassword)`. Works for an admin URL with no password. A percent-encoded password (`p%40ss`) gives the same value as the decoded `p@ss` derivation. |
| `… › owner role: ownerUrl` | From `postgresql://postgres:secret@localhost:5432/postgres?application_name=x`: username `stoktok_test_owner`, password = derivation, pathname `/db1`, host, port and query kept, and the string does not contain `secret`. |
| `… › owner role: ownerRoleSql rejects a non-hex password` | Throws for `"x'; drop"`. For a valid hex value, it contains every D4 attribute keyword. |
| `… › schema drift parser: real schema.ts` | `parseSchemaTs(readFileSync(schema.ts))` has 18 tables equal to the `Database` keys. `transactions.fee` is nullable, `transactions.seq` is not, `settings.holidays` is not (`\| undefined` inside a generic), and `signals.inputs_snapshot` is not. |
| `… › schema drift parser: fails closed` | Throws on an unparseable line inside a `…Table` block (e.g. `foo string`), on a duplicate column, on a `…Table` interface missing from `Database`, and on a `Database` entry naming an unknown interface. |
| `… › schema drift parser: generic null is not nullable` | `x: ColumnType<string \| null, string, string>;` → not nullable; `x: Json \| null;` → nullable. |
| `… › compareSchema fixture: missing column` | TS has `t.{a,b}`, DB has `t.a` → one message naming `t.b` "missing in database". The reverse (a DB-only column) → "missing in schema.ts". A table missing on either side is reported. |
| `… › compareSchema fixture: nullability flip` | TS `a` nullable, DB `is_nullable = 'NO'` → one message naming `t.a` and both values. A match → `[]`. |
| `packages/db/test-db/owner-role.test.ts › a clone connects as the non-superuser owner` | On `freshDb()`, `current_user` and `session_user` are `stoktok_test_owner`. `pg_roles` shows `rolsuper`, `rolcreatedb`, `rolcreaterole`, `rolreplication` and `rolbypassrls` false, `rolcanlogin` true. `pg_auth_members` has no row with `member` = the owner. |
| `… › the owner cannot create roles or databases` | `create role zz_stk089` and `create database zz_stk089` as the owner → `42501`. |
| `… › template and clone are owned by the owner` | `datdba::regrole` of `stoktok_test_tpl_<suffix>` and of the clone is `stoktok_test_owner`. `nspowner` of `public` is the owner. No `public` relation or function has a different owner (proves the migrations ran as the owner). `public`'s ACL has no PUBLIC entry. |
| `… › emptyDb is owned by the owner` | `emptyDb()` URL: `current_user` is the owner, `datdba` is the owner, `public`'s `nspowner` is the owner. |
| `packages/db/test-db/schema-drift.test.ts › schema.ts matches information_schema (names and nullability, both directions)` | D10 query on `freshDb()`. Asserts 18 parsed tables, 18 DB tables and `compareSchema(...)` equal to `[]`. |

Existing test:db files (`baseline`, `migrate`, `session`, repos, …) must stay green unchanged while running as the owner. That is the real proof of the owner swap.

## Approach
1. **Baseline.** On the branch, run `pnpm typecheck`, `pnpm lint` and `pnpm test` before changing anything, and record the results in `impl-log.md`. If something already fails on Windows (for example path separators in `r3-guard.test.ts`), record it and do not fix it (R7). CI on Linux is authoritative.
2. **Worker command** (`apps/worker/src/migrate.ts`, `cli.ts`):
   - `resolveMigrationsDir(moduleDir, exists)` builds the two candidates with `path.resolve` and returns the first existing one, else the first.
   - `migrateCommand(argv, deps = {})`:
     - `try {`
     - If `argv.length > 0`: `console.error(MIGRATE_USAGE)`, exit 2, return.
     - Fill the defaults: `env ?? process.env`; `dir ?? resolveMigrationsDir(dirname(fileURLToPath(import.meta.url)), existsSync)`; `run ?? migrateFromEnv`.
     - `await run(env, { dir, log: (l) => console.log(l) })`, then exit 0.
     - `} catch (e) {` If it is a `MigrationError`: `console.error(\`migrate failed: ${e.message}${e.code ? \` [${e.code}]\` : ''}\`)` and exit `e.exitCode`. Otherwise `console.error('migrate failed: unexpected error')` and exit 1. `}`
     - Never rethrow. Never log `env`, `dir` or the error object.
   - `cli.ts` gets the import, the first-statement branch and the `USAGE` prefix (Files table).
   - R3: the worker never names the env variable. The URL is read only in `pg/client.ts`, through `migrateFromEnv`.
3. **Image.**
   - Dockerfile per the Files table.
   - In `check-image.sh`, insert before `exit 0`, in this order. Never use `set -x`, never echo the URL, and capture stdout and stderr together for leak checks.
     1. `== smoke: worker migrate without a URL exits 2`: `docker run --rm "$IMAGE" migrate 2> "$err"`. Require exactly 2 and a non-empty `$err`. `cat` it.
     2. `== smoke: worker migrate with an unreachable database exits 1 without hanging or leaking`. Comment: "exit 1 (not 2) also proves /app/migrations resolved: the runner reads the directory before connecting." Run `timeout 20 docker run --rm --name "$NAME-mig" -e STOKTOK_DATABASE_URL=postgres://smoke:smoke-pw@127.0.0.1:9/smoke "$IMAGE" migrate > "$err" 2>&1`. 124 → hung error. Anything other than 1 → error. A `smoke-pw|127\.0\.0\.1` hit → leak error.
     3. Extend the existing trap to `trap 'docker rm -f "$NAME" "$NAME-mig" >/dev/null 2>&1' EXIT`, at the point where `NAME` is set (line 38).
     4. `== image: /app/migrations ships only regular forward migrations`: `docker run --rm --user 0 --entrypoint sh "$IMAGE" -c 'test -f /app/migrations/20261111000200_baseline.sql && [ -z "$(find /app/migrations -mindepth 1 ! -type f)" ] && [ -z "$(find /app/migrations -name "*.down.sql")" ]'`, or an `::error::` on failure.
     5. `== image: /app/migrations is read-only for node`: `docker run --rm --entrypoint sh "$IMAGE" -c '! test -w /app/migrations && ! test -w /app/migrations/20261111000200_baseline.sql'`, or an `::error::`.
   - Verify locally with `bash -n scripts/check-image.sh`.
4. **Owner role** (`owner.ts`, `global-setup.ts`, `harness.ts`) per D4–D7.
   - Keep the order from DB-optimizer R-4: create the template as admin → alter/revoke as admin in the template, then **end** that client → `runMigrations` as the owner (its client ends) → clone. `create database … template` fails while the template has sessions.
   - `global-setup.ts` still prints only `(e as Error).message` on failure. A server error message never contains the password.
5. **Drift test** (`schema-drift-parse.ts`, `schema-drift.test.ts`) per D9–D10.
   - In the test, resolve the path to `schema.ts` from `__dirname` (as `baseline.test.ts` does).
6. **r3-guard** per D1. Regex: `const MIGRATE_ENTRY = /\b(?:runMigrations|migrateFromEnv)\b/;`. Paths compare as `relative(ROOT, p)` like the existing tests.
7. **Docs.**
   - ADR 0010 §12, appended: "test:db runs as the non-superuser `stoktok_test_owner` (LOGIN, no SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS). It owns the template, every clone and their `public` schema (PUBLIC revoked, as `add-app-db.sh` does), and the migrations run as it (STK-089). The role is created or updated on each run by the admin connection, is never dropped and holds no data. Its password is sha256 of a label plus the `DB_TEST_URL` password, so a trivial admin password gives a guessable owner password; localhost only. `DB_TEST_URL` must be a superuser."
   - `apps/worker/README.md` `## Migrations (`migrate`)` section:
     - local run `pnpm --filter @stoktok/worker run job migrate` (uses `db/migrations` and `apps/worker/.env.local`);
     - the image uses `/app/migrations`;
     - stdout carries the logs and stderr `migrate failed: …`;
     - exit codes: 0 means applied, up to date or database ahead (warning); 1 is a runtime failure (connect, lock, checksum, failed file); 2 is a configuration error (URL missing or invalid, directory missing, bad file name);
     - expand/contract is required because "ahead" exits 0;
     - STK-084 compose contract: same worker image, `command: ["migrate"]`, `restart: "no"`, `networks: [db]`, `profiles: [migrate]`, `docker compose run --rm migrate`, run after the pre-migration dump and before the app swap; only `STOKTOK_DATABASE_URL` is needed.
   - Root README: one line (Files table).
8. **Verify.** Local: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `bash -n scripts/check-image.sh`. Then commit and push the branch. The orchestrator opens the PR into `main` (draft is fine) so CI runs `test:db`, `db:check` and the `images` jobs. Record the CI run URL and results in `impl-log.md`. A red CI is fixed within this ticket's files.

**Rules:**
- **R3:** the env name stays only in `pg/client.ts` (and in `scripts/check-image.sh`, which r3-guard does not scan; it already holds it). The worker never prints the URL or an unknown error's message. The DDL entry points are confined by the new guard (D1).
- **R7:** only the listed files. Insertability (D11) and anything else go to follow-ups.
- **R8:** unit tests for every new pure function; real-Postgres tests for the owner swap and the drift; all five checks are green (three local, all in CI).
- **R1, R2, R5, R9, R10:** not affected. No money, market rules or AI. The lock key and timeouts are operational.

## Specialist input used
`consult-database-optimizer.md`:
- **Adopted:**
  - R-1 (always alter with the password, under the lock; distinct lock key) → D4.
  - R-2 (labelled derivation; `owner.ts` with no `pg`) → D5, D8.
  - R-3 (`URL` setters) → D6.
  - R-4 (order; close clients before cloning) → Approach step 4.
  - R-5 (`emptyDb` parity) → D7.
  - R-6/R-6b (superuser admin; never dropped; derivable password) → ADR text.
  - R-7 (extra owner assertions: flags, memberships, 42501, `datdba`/`nspowner`) → `owner-role.test.ts`.
  - R-8 (fail closed; table list from the `Database` map) → D9.
  - R-9 (BASE TABLE join; run as the owner; actionable messages) → D10.
  - R-11 (fixtures on the pure compare) → D8.
  - R-12 (inject `moduleDir`/`exists`; exact path cases) → tests.
  - R-13 (layout assertions with `--entrypoint sh`) → D12.
  - R-14 (exact exit codes; combined output for the leak grep) → Approach step 3.
  - R-16b (regex fixtures with `\b`) and R-16c (explicit `apps/web` assertion) → r3-guard tests.
- **Adjusted:** R-16. The allowlist excludes `apps/worker/src/cli.ts` and `cli.test.ts` (D1), because the defaults live in `apps/worker/src/migrate.ts`, so `cli.ts` never names the entry points.
- **Rejected or deferred:**
  - R-10 insertability: not in the ticket; follow-up.
  - R-13 optional filename regex check in the image: the runner already rejects bad names with exit 2, and the unreachable smoke exits 1 only if every name parsed.
  - R-15 extra `.down.sql` unit test: `packages/db/src/pg/migrate.test.ts` › `readMigrationFiles` already parses every entry of the repo's `db/migrations` and rejects `.down.sql`.
- **Open questions:** Q1 no (follow-up); Q2 yes; Q3 whole directory; Q4 yes.

`consult-software-architect.md`:
- **Adopted:**
  - R-1 (injected deps via a third `main` parameter; no `vi.mock`) → D2. The defaults are placed in `migrate.ts`, not `cli.ts`.
  - R-2 (never rejects; sentinel tests; synchronous throw) → D2 and tests.
  - R-3 (`path.resolve` expectations for Windows) → tests.
  - R-4 (COPY placement and comment) → Files table.
  - R-5 (exact codes, not 124, `$NAME-mig` plus an extended trap, root layout checks, non-writable for `node`) → Approach step 3.
  - R-6 (allowlist without `cli.ts`; `apps/web` assertion; regex self-test) → D1.
  - R-7 (USAGE form; streams documented) → D3.
  - R-8 (README: local run, compose contract, exit-code table) → Approach step 7.
  - Finding 2 (exit 1 proves the directory) → the comment in `check-image.sh`.
- **Adjusted:** the architect's R-6 allowed `apps/worker/src/migrate.test.ts` "only if the test names them". It is allowlisted unconditionally, which is harmless because it is a test of the choke point itself.
- **Risks noted, not acted on here:**
  - "database ahead exits 0" and lock contention at deploy time are for STK-084. Open question 1 default: keep 0; documented in the README.
  - The fallback `/db/migrations` path in the image: the risk is negligible, since `check-image.sh` asserts `/app/migrations`.

## Assumptions
- **A1. CI is the only proof for `test:db`, `db:check` and the image smoke.** The local host is Windows with no Docker, Postgres or psql. `ci.yml` runs on `pull_request` and on pushes to `main` only, so the PR must exist before REVIEW can see green checks. The orchestrator opens it (draft is fine) after the first implement push, and the reviewer checks `gh pr checks`. Expect a possible rework round from the CI-only parts (architect risk).
- **A2.** CI's `postgres:17` service image uses `scram-sha-256` for host connections, and the admin (`postgres`) is a superuser, so the derived owner password works over TCP. The plaintext `pg-proxy` in `session.test.ts` forwards SCRAM unchanged (DB-optimizer finding 2).
- **A3.** `db:check` runs after `test:db` on the same cluster. It refuses only on leftover non-system databases (cleanup drops the template and the clones, because `stoktok_test_tpl_<pid>` matches the `stoktok\_test\_%\_<pid>` sweep) or on its own role names. A persistent `stoktok_test_owner` does not trip it (DB-optimizer finding 3; `scripts/db-check.sh:152-154`).
- **A4.** No existing test:db file needs superuser on the clone connection. `pg_terminate_backend` calls go through the admin URL (`harness.ts`, `pg-proxy.ts`). The DB-optimizer grep and mine agree. If one fails in CI only because of privileges, the fix belongs in the harness or test setup (this ticket's scope), and it is recorded in `impl-log.md`.
- **A5.** `schema.ts` currently matches the baseline. I spot-checked `transactions`, `data_gaps`, `settings`, `signals` and `ai_keys`. If the drift test finds real drift, correcting `packages/db/src/pg/schema.ts` to match the baseline is in scope (it is what the test exists for). Record each change in `impl-log.md`. Never change `db/migrations/*.sql`.
- **A6.** Merging makes CI on `main` push a new `:latest` worker image with an extra subcommand and directory. `release.yml` deploys by digest, so production does not change and no release is cut (architect finding 10).
- **A7.** `import.meta.url` in the tsup ESM bundle resolves to a file in `/app/dist` (both consults). Under `tsx` from `src/`, `../migrations` does not exist, so the repo path is used.
- **A8.** The workspace rule "PLAN approval for P1 tickets" is overridden for this project by the stoktok workflow ("No human gate between PLAN and IMPLEMENT (Ming's decision)"). Ming still merges the PR, which is likely High tier because of the DB test harness and the deploy image.

**Follow-ups (for `debt` issues, not this diff):**
- Drift test, part two: compare insertability (`Def<>`/`Generated<>`/`TsDef`/`JsonDef`/`ColumnType<…| undefined>` vs `column_default`/`is_identity`/`is_generated`) (DB-optimizer R-10).
- STK-084: decide whether "database ahead" (exit 0 with a warning) is acceptable in the deploy, and how to avoid `lock_timeout` aborts while worker jobs run (architect risks).

## Blocking questions
None.

## Split proposal
None. The estimated diff is about 600 lines:
- worker command: about 60;
- worker tests: about 130;
- `cli.ts`/`cli.test.ts`: about 30;
- Dockerfile and `check-image.sh`: about 40;
- `owner.ts`, `global-setup.ts`, `harness.ts`: about 90;
- `owner-role.test.ts`: about 60;
- drift parser: about 70;
- drift tests (unit and DB): about 110;
- r3-guard: about 20;
- docs: about 25.

That is above the ~400-line guide, but only about 220 lines are logic. The ticket is already the second slice of STK-087's split, and its pieces are tightly coupled: the drift test runs on owner clones, and the guard covers the new command.

**Fallback if the first review asks for a split:** move the drift test (`schema-drift-parse.ts`, `schema-drift.test.ts` and its unit cases, about 180 lines) into a new ticket. That ticket depends on this one, and STK-084 would then depend on it as well.
