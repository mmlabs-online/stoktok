Status: READY

# Plan — STK-089: Worker `migrate` command, image and schema drift test (STK-087 split, slice 1 of 2)

The ticket as written is too big for one implement/review cycle with a 2-rework cap: about 490 changed lines across the production entry point, the deploy image (which can only be proven in CI), the test:db harness that every real-Postgres test uses, and a parser test. See `## Split proposal`.

**This plan covers slice 1 only:**
- the worker `migrate` command;
- the image `COPY` and the `check-image.sh` smoke and content checks, including the "only regular files" assertion from the ticket notes;
- the r3-guard rule from the ticket notes;
- the `schema.ts` drift test;
- the matching docs.

The owner-role test:db becomes **STK-090** (new). Slice 1 is what STK-084 needs: its `migrate` compose service and `db-migrate-from-supabase.sh` both run the worker image's `migrate` command.

## Spec summary
Ticket `## Goal`, quoted. The parts this slice implements are in **bold**; the rest moves to STK-090.
> - **Worker command.** **New `apps/worker/src/migrate.ts` exports `resolveMigrationsDir(moduleDir, exists)`, which returns the first existing of `resolve(moduleDir, '../migrations')` (image: `/app/dist` → `/app/migrations`) and `resolve(moduleDir, '../../../db/migrations')` (repo, from `src/` or `dist/`), else the first.** **It also exports `migrateCommand(argv, { env, dir, run = migrateFromEnv })`. Any extra argument → usage, exit 2. It prints log lines to stdout. On a `MigrationError` it prints `migrate failed: <message>[ [<code>]]` to stderr with exitCode = `err.exitCode`. On any other error it prints `migrate failed: unexpected error` with exit 1, never the message. On success it sets exit 0.** **`cli.ts` `main`: when `argv[0] === 'migrate'`, delegate before `parseArgs`, without calling `openDb`/`createPgDb`. Add `migrate` to `USAGE`.** **Unit tests in `migrate.test.ts` and `cli.test.ts` …**
> - **Image.** **`apps/worker/Dockerfile`: `COPY --from=build /repo/db/migrations ./migrations` (root-owned, read-only for `node`).** **`.dockerignore`: verified only.** **`scripts/check-image.sh` worker block: `docker run --rm IMAGE migrate` with no URL → exit 2 with non-empty stderr; with `STOKTOK_DATABASE_URL=postgres://smoke:smoke-pw@127.0.0.1:9/smoke` → exit 1 within `timeout 20`, and no `smoke-pw`/`127.0.0.1` in the output; `/app/migrations` contains `20261111000200_baseline.sql` and no `*.down.sql`.** **Docker is not available in the agent session, so this is verified by `bash -n` locally and by the PR's CI `images` job.**
> - Owner-role test:db. [→ STK-090]
> - **Drift test.** **`test-db/schema-drift.test.ts` parses `packages/db/src/pg/schema.ts` … compares, per table, the column-name set and nullability with `information_schema.columns` for `public` (excluding `schema_migrations`) in both directions. It includes a fixture showing the parser flags a missing column and a nullability flip, and a guard that the parse found 18 tables.**
> - **Docs.** ADR 0010 §12 (owner role) [→ STK-090] and README.

Ticket `## Notes / answers from Ming`, 2026-11-12 (from the STK-087 security review attempt 1):
> add an r3-guard rule that only apps/worker (and test-db) import `runMigrations`/`migrateFromEnv`; `check-image.sh` asserts `/app/migrations` holds only regular files.

Ticket `## Acceptance criteria`:
> Production keeps working: no stoktok release is cut until STK-084.
> `typecheck`, `lint`, `test`, `test:db` and `db:check` green; image smoke steps syntax-checked locally and proven by the PR's CI images job.

ADR 0010 §9:
> test-only down files live in `db/rollback` (the runner rejects `.down.sql` in its directory and the image does not ship them).

CLAUDE.md R3:
> `STOKTOK_DATABASE_URL` is read only in `packages/db/src/pg/client.ts` …

## What STK-088 changed (merged since STK-087)
Sources: `work/tickets/STK-088/impl-log.md` and the current files.
- `packages/db/src/migrations-lint.test.ts` has a new tokeniser lookbehind, a block-comment ban, a `stoktok.migrating` set/`set_config` ban, and an exported `BASELINE_DO_RE`. This slice does not touch it.
- **New `packages/db/src/legacy-reference-guard.test.ts`.** It walks the whole repo, skipping `node_modules`, `.git`, `.next`, `dist` and `coverage`. It fails on the text `supabase/migrations` or `supabase/rollback` outside `supabase/`, `work/`, `docs/`, `.claude/` and `scripts/schema-diff.sh`. **Consequence:** no file this slice creates or edits (`apps/worker/**`, `scripts/check-image.sh`, `packages/db/test-db/schema-drift.test.ts`, `db/migrations/README.md`) may contain those strings, including in comments.
- `db/migrations/README.md` now has new lines 3 and 8. Line 5 already says "Applied by the worker `migrate` command (STK-089)". This slice adds one bullet and leaves the existing lines alone.
- `scripts/db-check.sh`:
  - the URL regex refuses an `@` after the host;
  - `DB_CHECK_APP` may not be `stoktok_nobody`/`dbcheck_canary` or a system name;
  - there is a clear connect-failure message.
  - The URL-mode refusal (lines 151-158) is unchanged in substance: it refuses when any non-system database exists, or when the roles `$APP`, `stoktok_nobody` or `dbcheck_canary` exist. This slice creates no database or role, so CI's `db:check` after `test:db` is unaffected (A3).
- `packages/db/src/pg/migrate.ts`: comment-only change on line 187. The exports this slice consumes are unchanged:
  - `migrateFromEnv(env, { dir, log?, lockWaitMs? })`;
  - `MigrationError` with `exitCode: 1 | 2` and `code: string | undefined`;
  - both re-exported from `@stoktok/db/pg` (`pg/index.ts:8`).

## Decisions taken in this plan
| # | Point | Decision | Why |
|---|---|---|---|
| D1 | Split | Slice 1 (this plan): worker command, image, the r3-guard rule, the check-image content assertions, the drift test and docs. **STK-090:** owner-role test:db. | About 340 lines here, about 170 in STK-090. The owner role changes the harness under every real-Postgres test and its interaction with CI's db:check. The image part can only be proven by CI. Keeping them apart limits what a rework restarts. STK-084 needs slice 1 only. |
| D2 | Where the module directory comes from | `cli.ts` computes `dirname(fileURLToPath(import.meta.url))` and passes it to `resolveMigrationsDir(…, existsSync)`. It does this only on the `migrate` branch. `apps/worker/src/migrate.ts` itself never reads `import.meta.url`. | tsup bundles `cli.ts` (with `@stoktok/db` inlined, `tsup.config.ts:7`) to `/app/dist/cli.js`, so `import.meta.url` is that file in the image. Under `tsx src/cli.ts` it is `apps/worker/src/cli.ts`. Keeping it in the entry file avoids any doubt about chunk placement. It also keeps `resolveMigrationsDir` pure and testable. |
| D3 | Exit code | `migrateCommand` sets `process.exitCode` itself (the ticket's wording) and resolves to `void`. It never throws. | Same convention as `main` (`cli.ts:70,158`). |
| D4 | Usage text | `MIGRATE_USAGE = 'usage: cli.ts migrate  (no arguments; reads the database URL from the environment)'`. It does not contain the env-var name. `USAGE` in `cli.ts` gains `migrate` as the first alternative. | r3-guard: the literal `STOKTOK_DATABASE_URL` may appear only in `pg/client.ts`/`client.test.ts`. The missing-URL message already names the variable at runtime through `DATABASE_URL_ENV` (`migrate.ts:221`). |
| D5 | r3-guard rule shape | It matches the identifiers `\b(?:runMigrations\|migrateFromEnv)\b`, not just import statements. Allowed files: `packages/db/src/pg/{migrate,migrate.test,index}.ts`, anything under `packages/db/test-db/`, and `apps/worker/src/{migrate,migrate.test}.ts`. Everything else fails, including `apps/worker/src/cli.ts` and all of `apps/web`. | Identifier matching also catches re-exports, aliases and dynamic imports, where an import regex can be dodged. `cli.ts` only needs `migrateCommand` and `resolveMigrationsDir`. Today's hits (verified by grep) are exactly `pg/migrate.ts`, `pg/migrate.test.ts`, `pg/index.ts`, `test-db/migrate.test.ts` and `test-db/global-setup.ts`. |
| D6 | Image content assertions | One `docker run --entrypoint sh` as the image's default user (`node`) asserts the following. (1) `20261111000200_baseline.sql` is a regular file. (2) No `*.down.sql` anywhere under `/app/migrations`. (3) No entry under `/app/migrations` (`-mindepth 1`) is anything but a regular file: no directories, symlinks or devices. (4) The directory is not writable by `node`, and every entry is owned by root. | (1)–(2) come from the ticket. (3) comes from the ticket note. (4) is the ticket's own "(root-owned, read-only for `node`)" made testable; it costs two lines. |
| D7 | Drift parser placement | The parser and diff are exported pure functions inside `packages/db/test-db/schema-drift.test.ts`, the same pattern as `isAllowed` in `legacy-reference-guard.test.ts`. They run under `test:db` together with their fixtures. The parser fails closed: any non-blank, non-comment line inside a `…Table` body or the `Database` map that does not parse throws. | The ticket names the file. Failing closed means a new syntax (an intersection type, a multi-line `ColumnType<…>`) cannot silently drop a column. |
| D8 | Drift comparison connection | It runs on `freshDb()` and reads `information_schema.columns` through the test's own `pg.Client` on `t.url`. In this slice that is the admin superuser (STK-090 switches it to the owner; the query works for both, because the owner owns every table). | `information_schema.columns` only lists columns the current role has privileges on. The superuser and the owner both see everything. |

## Acceptance criteria → verification
| # | Criterion (this slice) | How the reviewer verifies it |
|---|---|---|
| 1 | `apps/worker/src/migrate.ts` exports `resolveMigrationsDir(moduleDir, exists)`. It returns `resolve(moduleDir, '../migrations')` if that exists, else `resolve(moduleDir, '../../../db/migrations')` if that exists, else the first candidate. | `pnpm test` › `apps/worker/src/migrate.test.ts` › `resolveMigrationsDir` cases (image path, repo from `src`, repo from `dist`, neither exists). |
| 2 | `migrateCommand(argv, { env, dir, run = migrateFromEnv })`: any argument → `MIGRATE_USAGE` on stderr, exit 2, `run` not called. Success → log lines on stdout, exit 0. `MigrationError` → `migrate failed: <message>` plus ` [<code>]` when `code` is set, on stderr, exit = `err.exitCode`. Any other error → `migrate failed: unexpected error`, exit 1, and the error's message appears nowhere. It never throws. | `migrate.test.ts` › `migrateCommand` cases (Tests table). |
| 3 | `main(['migrate', …])` delegates to `migrateCommand(argv.slice(1), …)` before `parseArgs`, and never calls `openDb`. `USAGE` mentions `migrate`. | `pnpm test` › `apps/worker/src/cli.test.ts` › `main: migrate delegates and opens no db`, `USAGE lists migrate`. Read `cli.ts`: the `migrate` branch is the first statement of `main`. |
| 4 | Missing URL → exit 2 before any connection. Unreachable DB → exit 1 with no host or password in the output. | Unit: `migrate.test.ts` › `real migrateFromEnv: missing URL exits 2` and `real migrateFromEnv: unreachable DB exits 1 without leaking`. Image: CI `images` job, check-image steps (criterion 6). |
| 5 | The worker Dockerfile copies `db/migrations` to `/app/migrations`, root-owned (no `--chown`). `.dockerignore` does not exclude `db/`. `db/rollback` is not copied into the runtime stage. | Read `apps/worker/Dockerfile` (one new `COPY` line in the runtime stage, without `--chown`). Read `.dockerignore` (no `db` entry). `grep -n rollback apps/worker/Dockerfile` finds nothing. |
| 6 | `check-image.sh` worker block: (a) `migrate` without a URL exits 2 with non-empty stderr; (b) `migrate` with the unreachable sentinel URL exits 1 within `timeout 20`, with no `smoke-pw`/`127.0.0.1` in stdout or stderr; (c) the D6 content assertions. | `bash -n scripts/check-image.sh` passes locally (output in impl-log). `shellcheck scripts/check-image.sh` if available (not required). **Real proof: the PR's CI `images` job (worker matrix leg) is green.** The reviewer cites the run. |
| 7 | r3-guard: `runMigrations`/`migrateFromEnv` appear only in the D5 allowlist. The guard's regex catches its fixtures. | `pnpm test` › `packages/db/src/r3-guard.test.ts` › `runMigrations / migrateFromEnv appear only in pg/migrate, pg/index, test-db/ and apps/worker/src/migrate`. Negative proof in impl-log: temporarily add `// migrateFromEnv` to `apps/worker/src/cli.ts`, see the test fail, then revert. |
| 8 | Drift test: `schema.ts` and the migrated template agree per table on column-name sets and nullability, in both directions, excluding `schema_migrations`. The parse found 18 tables. Fixtures show a missing column and a nullability flip being flagged. | `pnpm test:db` › `packages/db/test-db/schema-drift.test.ts` (all cases). Negative proof in impl-log: temporarily change `fee: Int8 \| null` to `fee: Int8` in `schema.ts`, see the drift test fail with `transactions.fee`, then revert. |
| 9 | No new file or edited file mentions the legacy supabase migration or rollback paths. | `pnpm test` › `legacy-reference-guard.test.ts` stays green. |
| 10 | Production keeps working: no release is cut. Only the files in the table below change. No change to `release.yml`, `ci.yml`, `apps/web/**`, `db/migrations/*.sql`, `db/rollback/**`, `packages/db/src/pg/**`, `scripts/db-check*` or `packages/db/test-db/{global-setup,harness}.ts`. | `git diff --stat main` lists only the files in the table. No `release/*` branch exists. CI on `main` pushes `:latest`, but production pins tagged digests from `release.yml` (`release.yml:142-143`), so `:latest` is not deployed. |
| 11 | `typecheck`, `lint`, `test`, `test:db` and `db:check` are green. | Run all five: test:db and db:check on local PG16 (`/usr/lib/postgresql/16/bin`; db:check warns about major 16 locally), and CI on 17. Outputs go in impl-log. |

## Ming verification after merge
None. No release is cut, and production is untouched until STK-084. The image steps are proven by the PR's CI `images` job, not by Ming.

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `apps/worker/src/migrate.ts` | **Create.** `MIGRATE_USAGE`, `resolveMigrationsDir`, `migrateCommand` (Approach step 1). Imports `MigrationError` and `migrateFromEnv` from `@stoktok/db/pg`, and `existsSync` is **not** imported here (the caller injects `exists`). | Criteria 1, 2, 4. |
| `apps/worker/src/migrate.test.ts` | **Create.** Unit tests (Tests table). | Criteria 1, 2, 4; R8. |
| `apps/worker/src/cli.ts` | **Modify.** Add imports (`dirname` from `node:path`, `existsSync` from `node:fs`, `fileURLToPath` from `node:url`; `migrateCommand` and `resolveMigrationsDir` from `./migrate`). Add the `migrate` branch as the first statement of `main`. Prefix `USAGE` with `migrate\|`. Nothing else changes. | Criterion 3. |
| `apps/worker/src/cli.test.ts` | **Modify.** Partial `vi.mock('./migrate', …)` (keep the real `resolveMigrationsDir`; mock `migrateCommand`). Add two tests in the `main lifecycle` describe block. The existing tests stay unchanged. | Criterion 3. |
| `apps/worker/Dockerfile` | **Modify.** After line 28, add `COPY --from=build /repo/db/migrations ./migrations` (no `--chown`, so root-owned with the build stage's 644/755 modes). | Criterion 5. |
| `scripts/check-image.sh` | **Modify** the worker block only (lines 21-51): two `migrate` smokes and the D6 content check, inserted before `exit 0` on line 50. Widen the `EXIT` trap to remove both container names. | Criterion 6. |
| `packages/db/src/r3-guard.test.ts` | **Modify.** Add one test after the `databaseUrlFromEnv` test (line 187). | Criterion 7 (ticket note). |
| `packages/db/test-db/schema-drift.test.ts` | **Create.** Parser, diff, fixtures, the 18-table guard and the live comparison. | Criterion 8. |
| `db/migrations/README.md` | **Modify.** Add one bullet after line 5 (Approach step 6). | Keeps the doc true. |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | **Modify.** §10 (line 18): append one sentence. §12 (line 20): append one sentence about the drift test. Line 25 slice order: change "STK-089 (worker `migrate` command and image)" to "STK-089 (worker `migrate` command, image and schema drift test), STK-090 (owner-role test:db)". | Keeps the ADR true (the same practice as STK-083/087). |

Verified only, not edited: `.dockerignore`, which has no `db` entry and excludes `supabase`, `work`, `docs` and `**/dist`.

Do **not** touch:
- `packages/db/src/pg/**`, including `migrate.ts`, `client.ts`, `index.ts` and `schema.ts`. If the drift test finds a real drift, stop and record it in impl-log; do not edit `schema.ts` (A4);
- `packages/db/test-db/global-setup.ts`, `harness.ts` (STK-090), and `migrate.test.ts`;
- `packages/db/src/migrations-lint.test.ts`, `legacy-reference-guard.test.ts`;
- `scripts/db-check.sh`, `scripts/db-check/**`;
- `.github/**`, `.dockerignore`, `apps/web/**`, `db/migrations/*.sql`, `db/rollback/**`;
- `CLAUDE.md`.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `apps/worker/src/migrate.test.ts › resolveMigrationsDir: image layout` | `moduleDir = '/app/dist'`, with `exists` true only for `/app/migrations` → `/app/migrations`. Use `path.resolve` for expected values so the test is OS-independent. |
| `… › resolveMigrationsDir: repo from src and from dist` | `moduleDir = <R>/apps/worker/src` and `<R>/apps/worker/dist`, with `exists` true only for `<R>/db/migrations` → `<R>/db/migrations` in both cases. Also, with `exists = () => false` → the first candidate (`<moduleDir>/../migrations`). With both existing → the first. |
| `… › resolveMigrationsDir: the real repo` | `resolveMigrationsDir(join(__dirname), existsSync)` (the real `apps/worker/src`) equals `join(__dirname, '../../../db/migrations')`, and that directory contains `20261111000200_baseline.sql`. This is a local filesystem read, with no network. |
| `… › migrateCommand: extra argument → usage, exit 2, run not called` | `['x']`, `['--dry-run']`, `['a', 'b']`. `stderr` got `MIGRATE_USAGE`. The `run` spy was not called. `process.exitCode === 2`. |
| `… › migrateCommand: success → exit 0, log lines on stdout` | The fake `run` calls `opts.log('applied 1_x (3 ms)')` and resolves `{ applied: ['1'], ahead: [] }`. `console.log` got that line. `console.error` was not called. `exitCode 0`. The `run` spy received `(env, { dir, log: any function })` with the passed `env` and `dir` unchanged. |
| `… › migrateCommand: MigrationError maps exit code and code suffix` | `new MigrationError('another migration is running', 1)` → stderr `migrate failed: another migration is running`, exit 1. `new MigrationError('migration 1 failed: division by zero', 1, '22012')` → `migrate failed: migration 1 failed: division by zero [22012]`, exit 1. `new MigrationError('X is not set', 2)` → exit 2. |
| `… › migrateCommand: unknown error → fixed text, exit 1, no echo` | `run` rejects with `new Error('connect ECONNREFUSED 127.0.0.1:9 pw-SENTINEL')`. stderr is exactly `migrate failed: unexpected error`. No console call contains `pw-SENTINEL` or `127.0.0.1`. Exit 1. The same holds when `run` rejects with a non-Error (`'boom'`) or throws synchronously. |
| `… › real migrateFromEnv: missing URL exits 2` | `migrateCommand([], { env: {}, dir: <tmp empty dir> })` with the default `run` → exit 2. stderr starts with `migrate failed: ` and ends with `is not set`. No connection is attempted, because the URL check comes first (`migrate.ts:219-223`). |
| `… › real migrateFromEnv: unreachable DB exits 1 without leaking` | `env = { [name]: 'postgres://u:pw-SENTINEL-9@127.0.0.1:9/x' }`, `dir` = a tmp dir with one valid `20990101000000_a.sql`. Build the env key without the literal: import nothing from `pg/client`; use `const name = ['STOKTOK', 'DATABASE', 'URL'].join('_')`. Expect exit 1, stderr starting `migrate failed: cannot connect to the database (URL not printed)`, and neither `pw-SENTINEL` nor `127.0.0.1` in any console call. This hits the local refused port 9, the same assumption as STK-087 A4 and `check-image.sh:41`. It does not go off-host, so the worker's `test/no-network.ts` guard should not object. If that guard blocks raw sockets, mark this one test `.skip` with a comment and record it; the image smoke covers it. |
| `apps/worker/src/cli.test.ts › main: migrate delegates and opens no db` | With `migrateCommand` mocked: `await main(['migrate', 'extra'], openDb)` → `openDb` not called. `migrateCommand` called once with `(['extra'], { env: process.env, dir: <string ending in db/migrations or /migrations> })`. |
| `… › USAGE lists migrate` | `main(['nonsense'])` prints a usage line that contains `migrate`. |
| `packages/db/src/r3-guard.test.ts › runMigrations / migrateFromEnv appear only in pg/migrate, pg/index, test-db/ and apps/worker/src/migrate` | D5. Also regex fixtures: `import { migrateFromEnv } from '@stoktok/db/pg'` and `const { runMigrations: r } = await import('@stoktok/db/pg')` match; `migrateCommand` and `runMigrationsX` do not. |
| `packages/db/test-db/schema-drift.test.ts › parser reads every table of schema.ts` | `parseSchemaTs(readFileSync(<schema.ts>))` has exactly 18 tables, with names equal to the `TABLES` list in `baseline.test.ts` (copy the list). `transactions.fee` is nullable. `transactions.id` is not. `settings.holidays` (`string[] \| undefined` inside `ColumnType`) is not nullable. |
| `… › parser fails closed` | It throws when: a `…Table` body has a line it cannot parse (`  weird line`); the `Database` map names an interface that does not exist; a `…Table` interface is not in the `Database` map; there is no `Database` interface. |
| `… › diff flags a missing column and a nullability flip (fixture)` | A fixture schema text with `interface ATable { x: string; y: number \| null; }` and `Database { a: ATable }`, against fake DB rows `[{a, x, NO}, {a, y, NO}, {a, z, YES}]` → the diff equals (sorted) `['a.y: nullability schema.ts=nullable db=not null', 'a.z: in db, missing in schema.ts']`. Removing `x` from the DB rows → it also has `'a.x: in schema.ts, missing in db'`. A table only on one side → `'b: table in db, missing in schema.ts'` or the reverse. |
| `… › schema.ts matches the migrated database` | On `freshDb()`: `select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name <> 'schema_migrations'`. Assert `diff(parse(schema.ts), rows)` equals `[]`, and that the DB side also has 18 tables. |

## Approach
1. **`apps/worker/src/migrate.ts`.** Header: "Worker `migrate` command (STK-089). The URL is read only inside @stoktok/db/pg (R3); this file never sees it and never prints error objects."
   ```ts
   export const MIGRATE_USAGE = '…';                       // D4
   export function resolveMigrationsDir(moduleDir: string, exists: (p: string) => boolean): string {
     const candidates = [resolve(moduleDir, '../migrations'), resolve(moduleDir, '../../../db/migrations')];
     return candidates.find((p) => exists(p)) ?? candidates[0]!;
   }
   export async function migrateCommand(
     argv: readonly string[],
     { env, dir, run = migrateFromEnv }: { env: Record<string, string | undefined>; dir: string; run?: typeof migrateFromEnv },
   ): Promise<void>
   ```
   - If `argv.length > 0`: `console.error(MIGRATE_USAGE)`, set `process.exitCode = 2`, and return.
   - `try { await run(env, { dir, log: (l) => console.log(l) }); process.exitCode = 0; }`.
   - `catch (err)`:
     - if `err instanceof MigrationError`: `console.error(\`migrate failed: ${err.message}${err.code ? \` [${err.code}]\` : ''}\`)` and `process.exitCode = err.exitCode`;
     - else: `console.error('migrate failed: unexpected error')` and `process.exitCode = 1`.
     - Nothing is rethrown, so the `preserve-caught-error` lint does not apply.
   - Do **not** import `pg`. The S5 guard allows `pg` only under `packages/db/src/pg/` and `test-db/`.
2. **`cli.ts`.** As the first lines of `main`:
   ```ts
   if (argv[0] === 'migrate') {
     await migrateCommand(argv.slice(1), { env: process.env, dir: resolveMigrationsDir(dirname(fileURLToPath(import.meta.url)), existsSync) });
     return;
   }
   ```
   - `USAGE`: `'usage: cli.ts <migrate|eod-prices|…'`, with the rest unchanged.
   - `parseArgs` is unchanged. It still returns usage for `['migrate']`, but `main` never reaches it for that input.
3. **Dockerfile.** Add one line after line 28: `COPY --from=build /repo/db/migrations ./migrations`. The build stage has `COPY . .`, and `.dockerignore` keeps `db/`.
   - `db/migrations/README.md` comes along. That is a regular file; the runner ignores non-`.sql` files (`migrate.ts:107`), and D6 allows it.
   - `db/rollback` is never referenced.
4. **`check-image.sh` worker block**, before `exit 0` (line 50):
   - Define `MNAME="stoktok-smoke-mig-$$"` next to `NAME` (line 37). Change the trap on line 38 to `trap 'docker rm -f "$NAME" "$MNAME" >/dev/null 2>&1' EXIT`.
   - `echo "== smoke: worker migrate without a database URL exits 2"`. Run `docker run --rm "$IMAGE" migrate 2> "$err"`, then the same code/size check as lines 24-31. On failure: `::error::migrate without a URL: expected exit 2 with a message, got $code`.
   - `echo "== smoke: worker migrate with an unreachable database exits 1 without hanging or leaking"`. Run `timeout 20 docker run --rm --name "$MNAME" -e STOKTOK_DATABASE_URL=postgres://smoke:smoke-pw@127.0.0.1:9/smoke "$IMAGE" migrate > "$err" 2>&1`, then the same 124 / ≠1 / leak checks as lines 43-49, with `migrate` in the error texts.
   - `echo "== image ships db/migrations: regular files only, no down files, read-only for the runtime user"`. Run:
     ```bash
     if ! docker run --rm --entrypoint sh "$IMAGE" -c '
       set -e
       test -f /app/migrations/20261111000200_baseline.sql
       test -z "$(find /app/migrations -name "*.down.sql")"
       test -z "$(find /app/migrations -mindepth 1 ! -type f)"
       test -z "$(find /app/migrations ! -user root)"
       test ! -w /app/migrations'; then
       echo "::error::worker image /app/migrations: missing baseline, down file, non-regular entry or writable by node"; exit 1
     fi
     ```
   - Keep `set -uo pipefail` semantics. `find` with `-mindepth` and `! -user` works on the Debian `bookworm-slim` base (GNU findutils).
   - Locally: `bash -n scripts/check-image.sh`. Docker is not available.
5. **r3-guard** (D5):
   ```ts
   const RUNNER_ENTRY = /\b(?:runMigrations|migrateFromEnv)\b/;
   const allowed = (p: string) =>
     ['packages/db/src/pg/migrate.ts', 'packages/db/src/pg/migrate.test.ts', 'packages/db/src/pg/index.ts',
      'apps/worker/src/migrate.ts', 'apps/worker/src/migrate.test.ts'].includes(p) || p.startsWith('packages/db/test-db/');
   ```
   - Assert the list of offending `path`s is `[]`, plus the regex fixtures.
   - `files` already covers `apps/` and `packages/` `.ts/.tsx/.js/.jsx/.mjs` (lines 8-33), and the guard file excludes itself (line 32).
6. **Drift test** (`packages/db/test-db/schema-drift.test.ts`):
   - `export function parseSchemaTs(text: string): Map<string, Map<string, boolean>>` (table → column → nullable):
     - Collect `export interface (\w+Table) \{([\s\S]*?)\n\}` bodies.
     - Each body line, trimmed: skip it if empty or starting with `//`, `/*` or `*`. Otherwise it must match `^(\w+):\s*(.+);$`, else throw `unparsed line in <Iface>: <line>`.
     - nullable is `/\|\s*null\b/.test(type)`.
     - The `Database` body lines must match `^(\w+):\s*(\w+Table);$`, mapping DB table name → interface.
     - Throw on an unknown interface, on an interface not referenced by `Database`, or on a missing `Database`.
   - `export function diffSchema(ts, rows: { table_name: string; column_name: string; is_nullable: 'YES' | 'NO' }[]): string[]` returns sorted messages in exactly the fixture formats above.
   - The tests are as in the Tests table. Use `freshDb()` from `./harness` and a `pg.Client` on `t.url`. Close and drop in `afterAll`/`finally`.
   - Expected result: zero drift. The planner compared all 18 baseline `create table`/`alter table … add` columns with `schema.ts`, including identity columns (implicitly `NOT NULL`) and `ai_summaries.symbol` (`not null default ''`), and found no mismatch.
7. **Docs.**
   - `db/migrations/README.md`: after line 5, add "- Shipped in the worker image as `/app/migrations` (root-owned, read-only; `db/rollback` is never copied). The deploy runs `node dist/cli.js migrate` (`docker run <worker image> migrate`); exit 0 = applied or up to date, 1 = runtime failure, 2 = configuration error. `pnpm --filter @stoktok/worker job migrate` runs it from the repo against `db/migrations`."
   - ADR 0010 §10, append: "The worker image ships `db/migrations` as `/app/migrations`, and its `migrate` subcommand runs the runner (STK-089)."
   - ADR 0010 §12, append: "A `test:db` drift test compares `schema.ts` column names and nullability with the migrated database (STK-089)."
   - ADR 0010 line 25: the slice-order edit from the Files table.
8. **Verify:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm test`;
   - `pnpm test:db` (local PG16 on localhost, `DB_TEST_URL=postgresql://postgres:postgres@localhost:5432/postgres` or the local equivalent);
   - `pnpm db:check` (throwaway cluster, PG16 warning expected);
   - `bash -n scripts/check-image.sh`;
   - the two negative proofs (criteria 7 and 8);
   - `pnpm --filter @stoktok/worker build`, then `ls apps/worker/dist/cli.js` (proves the bundle still builds);
   - `node apps/worker/dist/cli.js migrate x; echo $?` → 2, and `env -u STOKTOK_DATABASE_URL node apps/worker/dist/cli.js migrate; echo $?` → 2. These are the local equivalents of the image smokes, from the repo layout.
   - Record all outputs in impl-log. The PR's CI `images` job is the final proof for criterion 6.

**Rules:**
- **R3:** the worker never reads or prints the URL. It passes `process.env` into `migrateFromEnv`, which reads the URL through `client.ts`. The env-var literal does not appear in any new TS file (D4; the test builds the name by `join`). The new r3-guard rule pins the runner's entry points to the worker command and test-db.
- **R7:** owner role, harness and `schema.ts` edits stay out of this slice.
- **R8:** unit tests for the command and the guard; real-Postgres drift test; all five checks green.
- **R2, R5, R9, R10:** not affected.

## Specialist input used
`work/tickets/STK-083/consult-database-optimizer.md` (no new consult):
- **Adopted (§5):**
  - "The `migrate` subcommand goes in `apps/worker/src/cli.ts`. The worker image's entrypoint is `node dist/cli.js`";
  - "add `COPY --from=build /repo/db/migrations ./migrations`";
  - "Pass the directory as an argument from `cli.ts`, defaulting to the image path, so tests can override it" (D2: `migrateCommand` takes `dir`, and `resolveMigrationsDir` prefers the image path);
  - "`.dockerignore:12` excludes `supabase` already; verify `db/` is not excluded" (verified);
  - "Drift. … Add a `test:db` test comparing its column names and nullability with `information_schema`".
- **Adopted (Risks):** "Image path: if the `migrations` directory is not copied into the worker image, the `migrate` service sees 'migrations directory not found' and exits 2". The check-image content assertion catches this in CI, before any deploy.
- **Moved to STK-090 (§6):** the owner role `stoktok_test_owner`, the template and clones owned by it, `freshDb` connecting as the owner, never dropping the role, and the 42710 race guard.
- **Already done:** §5 runner, lock key, GUC, `schema_migrations`, unit and integration tests (STK-087); static lint (STK-083/088).

## Assumptions
- **A1. Hotspots.**
  - No other ticket is `IN_PROGRESS`, `REVIEW` or `REWORK` (backlog checked). STK-088 is DONE and merged.
  - STK-084 (BACKLOG) will later edit `docs/`, `CLAUDE.md` and the deployment repo, not these files.
  - No `App.tsx`-style hotspot. `apps/worker/src/cli.ts` is edited only at the top of `main` and in `USAGE`.
- **A2. No Docker here.** Criterion 6 is proven only by the PR's CI `images` job. If that job fails, it is a REWORK on `check-image.sh` or the Dockerfile only.
  - The local repo-layout run of `dist/cli.js migrate` (step 8) exercises the same code path, except for the `/app/migrations` resolution.
  - Port 9 on `127.0.0.1` inside the container refuses connections, as the existing smoke on line 41 already relies on.
- **A3. db:check after test:db in CI.** This slice creates no role and no persistent database. `schema-drift.test.ts` uses `freshDb()`, whose databases match the `stoktok\_test\_%\_<pid>` teardown sweep (`global-setup.ts:60`). STK-086's refusal (any non-system database; roles `stoktok`/`stoktok_nobody`/`dbcheck_canary`) is therefore not tripped. STK-090 handles the persistent owner role.
- **A4. No drift expected.** If the live comparison nevertheless reports a mismatch, the implementer must not edit `schema.ts` (it is outside this plan, and it changes repo typings). They record the exact diff lines in impl-log and stop. The orchestrator then decides whether to amend the plan.
- **A5. Release rule.** CI on `main` pushes `stoktok-worker:latest` with the new `/app/migrations` and `migrate` subcommand. Production runs digest-pinned tags written by `release.yml`, and no `release/*` branch is created, so nothing deployed changes. Old images and jobs are unaffected: every existing subcommand path in `main` is unchanged.
- **A6.** The worker's vitest setup (`apps/worker/test/no-network.ts`) is assumed to block only off-host `fetch`, not a refused local TCP connect. If it blocks the `real migrateFromEnv: unreachable DB` test, handle it as described in the Tests table.
- **A7.** `pnpm --filter @stoktok/worker job migrate` loads `.env.local` (`package.json:13`). A developer running it locally migrates whatever `STOKTOK_DATABASE_URL` points at. This is documented in the README bullet and is the intended behaviour, the same as the other jobs.

## Blocking questions
None.

## Split proposal
**Why:** the full ticket comes to about 510 changed lines:
- worker command and its tests: about 170;
- Dockerfile and `check-image.sh`: about 40;
- r3-guard rule: about 15;
- drift test: about 110;
- owner-role test:db (`owner.ts`, `global-setup.ts`, `harness.ts` for `freshDb` and `emptyDb`, the owner test, the role-name guard): about 160;
- docs: about 15.

The owner role reshapes the harness under all ~25 real-Postgres test files and touches the CI ordering with STK-086's db:check. The image steps can only be proven by CI. With a 2-rework cap, carrying both in one cycle risks an escalation that would also hold back the command STK-084 needs.

| Slice | ID | Title | Scope | Depends on |
|---|---|---|---|---|
| 1 (**this plan**) | STK-089 | Worker `migrate` command, image and schema drift test | Everything in this plan (about 340 lines, more than half of them tests). | STK-087, STK-088 (both DONE) |
| 2 | **STK-090** (new; the next free ID, `work/tickets/` checked) | Owner-role test:db (STK-089 split) | See below. Areas: db, security. | STK-089 (both edit ADR 0010 and `db/migrations/README.md`) |

STK-090 scope (from the STK-089 ticket, unchanged unless noted):
- **New `packages/db/test-db/owner.ts`:**
  - `TEST_OWNER_ROLE = 'stoktok_test_owner'`;
  - `ownerPassword(adminUrl)`: sha256 hex of a fixed label plus the decoded admin password, so concurrent runs agree and CI's scram `pg_hba` works;
  - `asOwner(url)`: swaps the userinfo and keeps host, port, database and query;
  - `ensureOwnerRole(adminClient, password)`: inside `begin`, take `pg_advisory_xact_lock` on a fixed bigint key (not `MIGRATION_LOCK_KEY`). Then `create role … login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '<hex>'` if missing, else `alter role` with the same attributes and password. Tolerate 42710 and 23505. Validate the password as `^[0-9a-f]{64}$` before interpolating it. Never drop the role.
  - **Planner addition:** the `alter role` on an existing role re-asserts the NO* flags, so a tampered role cannot stay superuser.
- **`global-setup.ts`:** inside the existing `try`/cleanup:
  - ensure the role;
  - `create database <tpl> owner stoktok_test_owner`;
  - as admin in the template, `alter schema public owner to stoktok_test_owner; revoke all on schema public from public;`;
  - then `runMigrations` with the owner URL.
- **`harness.ts`:**
  - `freshDb` runs `create database x template <tpl> owner stoktok_test_owner` and returns the owner URL;
  - `emptyDb` runs `create database x owner stoktok_test_owner` plus the same two schema statements, and returns the owner URL;
  - create and drop stay on the admin connection. `pg-proxy.ts` keeps using the admin URL for `pg_terminate_backend`.
- **Tests:**
  - new `test-db/owner.test.ts`: a clone's `current_user` is `stoktok_test_owner`, `rolsuper` is false, and `datdba` and the `public` owner are the role;
  - unit tests in `packages/db/src/test-db-guard.test.ts` for `ownerPassword` (deterministic, 64 hex, changes with the admin password, percent-decoded) and `asOwner`;
  - a guard that reads `scripts/db-check.sh` and asserts the role name differs from the `DB_CHECK_APP` default, `NOBODY` and `CANARY_ROLE`, so STK-086's refusal never trips on it. db:check checks only those role names and non-system databases, and test:db drops every `stoktok_test_%_<pid>` database at teardown.
- **Docs:** ADR 0010 §12 (owner role) and a `db/migrations/README.md` test:db bullet.

STK-084 needs only STK-089 (the command and the image). The orchestrator decides whether STK-084 should also wait for STK-090.
