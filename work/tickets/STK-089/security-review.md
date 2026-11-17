# STK-089 security review

## Security review: STK-089, attempt 1

**Verdict: no blocking findings.** There are no 🔴 findings. One 🟡 is a gap between what the content check claims and what it proves, and it is cheap to close. The rest are 🟢 confirmations or hardening notes. I only read the code and ran nothing. The green checks are as `impl-log.md` reports them, and the image steps are proven only once the PR's CI `images` job passes.

### Findings

**🟡 1. The image check does not prove the migration files are read-only for `node`.** `scripts/check-image.sh:79-80`
- `find /app/migrations ! -user root` proves every file is owned by root.
- `test ! -w /app/migrations` proves `node` cannot write to the directory itself.
- Neither line catches a file inside it that is root-owned but group- or world-writable, for example mode 0666 from an unusual checkout umask. `node` could then rewrite a migration without being able to add or remove one. Plan D6(4) and the README (`db/migrations/README.md:6`) both say "read-only".
- In practice git stores only 644/755 and the runner's umask is 022, so the real risk is low. This is a test gap, not a live hole.
- **Fix (one line in the same `sh -c` block, which runs as `node`):** `test -z "$(find /app/migrations -writable)"`. GNU find's `-writable` checks access for the current user. This line could replace `test ! -w /app/migrations`.

**🟢 2. The CLI never prints the URL or a raw error.** `apps/worker/src/migrate.ts:28-36`
- `migrateCommand` prints only three kinds of output:
  - `MigrationError.message`;
  - `code`, which `sqlstateOf` (`packages/db/src/errors.ts:43-46`) restricts to a 5-character SQLSTATE that cannot be an `E…` errno;
  - the fixed text `migrate failed: unexpected error`.
- Every `MigrationError` message is either a constant, a file name already filtered by the filename regex, or the output of `safeDetail` (a server message or fixed text), as I confirmed in STK-087 attempt 2.
- `migrateFromEnv` names the variable only through `DATABASE_URL_ENV` (`packages/db/src/pg/migrate.ts:221`).
- Error objects are never logged and `cause` is never set.
- Tests: the sentinel-password and host checks over both stdout and stderr cover a mocked unknown error, a non-Error rejection, a synchronous throw and the real unreachable-DB path (`apps/worker/src/migrate.test.ts:84-101,118-125`).
- The top-level catch at `apps/worker/src/cli.ts:173-176` prints `e.message`, but the `migrate` branch cannot reach it because `migrateCommand` never throws.

**🟢 3. The `migrate` path opens no app pool.** `apps/worker/src/cli.ts:70-73`
- The branch is the first statement of `main` and returns before `parseArgs` and before `openDb`.
- The default `openDb` is a lambda (`:69`) and is never invoked on this path.
- `@stoktok/db/pg/index.ts` contains only re-exports. In `client.ts` the only `new pg.Pool` is inside a function (`:90`), so importing the barrel creates no pool.
- `apps/worker/src/migrate.ts` does not mention `createPgDb`. The S5 rule (`packages/db/src/r3-guard.test.ts:306-310`) still allows `createPgDb(` only in `cli.ts`, not in `migrate.ts`.
- Test: `apps/worker/src/cli.test.ts:141-147`.

**🟢 4. Exit codes and usage text are correct.**
- The exit codes follow the ticket:
  - 2 for extra arguments, a missing URL or a non-`postgres://` URL (`migrate.ts:20-24`; `pg/migrate.ts:220-222`, before any connection);
  - 2 for directory, file-name, symlink and duplicate-version errors;
  - 1 for connect, lock and SQL failures;
  - 1 for anything unknown;
  - 0 on success, including "up to date".
- `MIGRATE_USAGE` (`migrate.ts:8`) does not echo argv and does not contain the env-var name. `USAGE` (`cli.ts:26`) gains only `migrate|`.
- One note, not a defect: when the database is *ahead* of the image, the command returns exit 0 with a warning (`pg/migrate.ts:173-176`). STK-084's deploy will therefore replace the app with an older image after an exit-0 `migrate`. That design comes from STK-087, so STK-084 should decide on purpose whether this is acceptable.

**🟢 5. The image matches the ticket.** `apps/worker/Dockerfile:29`
- `COPY --from=build /repo/db/migrations ./migrations` has no `--chown`, so the files are root-owned. `/app` comes from `WORKDIR` as root with mode 755, so `node` cannot rename or replace the directory.
- `db/rollback` is never referenced, and `.dockerignore` does not exclude `db/`.
- The check at `check-image.sh:76-78` covers three things: the baseline is present, there are no `*.down.sql` files, and nothing at `-mindepth 1` is anything but a regular file. That last check excludes symlinks, subdirectories and devices, so a copied `rollback/` directory would also fail it. The runner's own `isFile()` check (`pg/migrate.ts:112`) is a second layer.
- Defence-in-depth caveat: `/app/dist` and `node_modules` are owned by `node` (`Dockerfile:26-28`). A compromised `node` process could rewrite `dist/cli.js` anyway, so read-only migrations stop accidents and drift rather than a compromised runtime. This was already the case before this ticket and is out of scope.

**🟢 6. The leak greps cover stdout and stderr.** `scripts/check-image.sh:63-72`
- The unreachable-DB smoke sends `> "$err" 2>&1` into one file, which is grepped for `smoke-pw|127\.0\.0\.1`, under `timeout 20`.
- The trap now also removes `$MNAME` (`:39`), which cleans up the container if `timeout` kills only the docker client.
- The no-URL smoke (`:53`) captures only stderr. There is nothing to leak because no `-e` is passed and the image env has no URL (`:14-16`).
- Optional: wrap `:53` in `timeout 20` like the others, so a regression that hangs cannot stall CI.

**🟢 7. The r3-guard runner rule is a tripwire against accidents, not a boundary.** `packages/db/src/r3-guard.test.ts:189-199`
- **What it catches:** matching identifiers rather than import statements catches named imports, aliases (`{ runMigrations: r }`), `export { migrateFromEnv as x } from …` re-exports, and dynamic `import()` with destructuring. The allowlist is exact.
- **Bypass a: computed key on a namespace object.** For example `import * as p from '@stoktok/db/pg'; p['run' + 'Migrations'](…)`, or `Object.values(await import('@stoktok/db/pg'))`. This needs deliberate evasion. `apps/web/server/db.ts` already imports this barrel, so the runner is reachable from web server code in principle. It is never reachable in client bundles: the "use client" and `server-only` rules still apply.
- **Bypass b: files the walker never reads.** `walk` (`:8-16`) covers only `apps/` and `packages/`, and only `.ts/.tsx/.js/.jsx/.mjs`. It misses `.cts`, `.mts` and `.cjs` files and anything under `scripts/` or at the repo root. The same gap applies to every rule in this file, so it predates this ticket.
- **Follow-up (R7: `packages/db/src/pg/**` is off-limits in this plan):** move `runMigrations` and `migrateFromEnv` off the `./pg` barrel onto a dedicated subpath (for example `@stoktok/db/migrate`). Then guard *imports of that subpath* to `apps/worker/src/migrate.ts` and `test-db/`. A namespace import of `./pg` could then no longer reach the runner. Separately, widen the walker's extensions to `(c|m)?[jt]sx?`.

**🟢 8. The migrations directory cannot be steered by env or argv.** `apps/worker/src/migrate.ts:11-14`, `cli.ts:71`
- The base path is `dirname(fileURLToPath(import.meta.url))`. That is the module's own absolute path, independent of the working directory, argv and env. `process.argv[1]` only decides whether `main` runs.
- `migrateCommand` rejects every argument, so there is no `--dir`.
- Edge case: in the image the fallback candidate resolves to `/db/migrations` (`/app/dist/../../../db/migrations`), which is outside `/app`. It would be used only if `/app/migrations` were missing *and* something were mounted at `/db/migrations`. The content check (`check-image.sh:76`) makes "missing" a CI failure, and mounts are under the deploy repo's control, so this is acceptable.
- Optional hardening: when `moduleDir` is `/app/dist`, return the image path without falling back.

**🟢 9. The drift test and docs are fine.**
- `packages/db/test-db/schema-drift.test.ts` runs a constant query on a throwaway `freshDb()`, interpolates no SQL, and parses only a repo file.
- The README and ADR 0010 text match the code. With 🟡1 fixed, the README's "read-only" claim will also be enforced by CI.

### Recommendations
1. In `check-image.sh`, add `test -z "$(find /app/migrations -writable)"` so the "read-only for `node`" requirement (plan D6(4), ticket Image item) is actually proven (🟡1).
2. Optional: wrap the no-URL `migrate` smoke at `check-image.sh:53` in `timeout 20` (🟢6).
3. Follow-ups for the list, not this diff (R7):
   - move the runner onto its own `@stoktok/db` subpath and guard imports of it;
   - widen the r3-guard walker's file extensions (🟢7).
4. STK-084: decide whether an exit-0 `migrate` when the database is ahead of the image should block replacing the app (🟢4).

### Risks
- These are carried over from STK-087 and accepted under D24: the runtime role owns `schema_migrations`, and a server message can echo a value from the migration text.
- The image assertions are unproven until the PR's CI `images` job (worker leg) is green. Docker was not available in this session.

### Open questions
- Should the image skip the repo-path fallback when it runs from `/app/dist` (🟢8), or is the CI content check enough?

Files reviewed:
- /home/user/stoktok/apps/worker/src/migrate.ts
- /home/user/stoktok/apps/worker/src/migrate.test.ts
- /home/user/stoktok/apps/worker/src/cli.ts
- /home/user/stoktok/apps/worker/src/cli.test.ts
- /home/user/stoktok/apps/worker/Dockerfile
- /home/user/stoktok/.dockerignore
- /home/user/stoktok/scripts/check-image.sh
- /home/user/stoktok/packages/db/src/r3-guard.test.ts
- /home/user/stoktok/packages/db/test-db/schema-drift.test.ts
- /home/user/stoktok/packages/db/src/pg/migrate.ts
- /home/user/stoktok/packages/db/src/pg/index.ts
- /home/user/stoktok/packages/db/src/errors.ts
- /home/user/stoktok/db/migrations/README.md
- /home/user/stoktok/docs/adr/0010-self-hosted-postgres-data-layer.md
- /home/user/stoktok/work/tickets/STK-089/{ticket,plan,impl-log}.md
- /home/user/stoktok/work/tickets/STK-087/security-review.md

## Security review: STK-089, attempt 2

**Verdict: 🟡1 and 🟢6 are both fixed. Nothing blocks.** There are no 🔴 or 🟡 findings. I only read the code (commit d022ace) and ran nothing. Docker was not available here, so the image assertions are proven only once the PR's CI `images` job (worker leg) passes.

### Attempt-1 items
- **🟡1 is fixed.** `scripts/check-image.sh:85-86`
  - `f=$(find /app/migrations -writable); test -z "$f"` runs as `node`, because no `--user` is passed and `apps/worker/Dockerfile:30` sets `USER node`.
  - The runtime base is `node:22-bookworm-slim` (`Dockerfile:23`), which ships GNU findutils, so `-writable` is supported. It checks access for the current user, so a root-owned file with mode 0666, or the directory itself, now fails the check.
  - `:87` (`test ! -w /app/migrations`) is now redundant, since `-writable` also lists the starting directory. It does no harm.
- **🟢6 is fixed.** `scripts/check-image.sh:53,58`
  - The no-URL `migrate` smoke runs under `timeout 20`, and exit 124 has its own hang message. Exit 124 is not 2, so it would also have been caught as a failure without that message.

### Shell correctness (`sh -c` under dash, `set -e`), `:75-87`
- **🟢 A `find` failure now fails the check.**
  - POSIX gives a command made only of an assignment the exit status of its last command substitution, and dash follows that. So a non-zero exit from `find` on `:79/81/83/85` aborts the script under `set -e`.
  - The comment at `:78` is accurate: `test -z "$(…)"` would discard that status.
  - `find`'s stderr is not suppressed, so the cause shows in the CI log.
- **🟢 `set -e` still applies inside the container.** The outer `if ! docker run …` runs on the host, and the inner `sh -c` is a separate process, so the outer `if` does not switch off the inner `set -e`.
  - Outer `bash` has no `-e` (`:4`), and the explicit `if !` handles the exit code correctly.
- **🟢 Quoting is sound.**
  - The single-quoted block contains no `'`.
  - `"*.down.sql"` is double-quoted, so the shell cannot expand the glob.
  - The `#` comment line is harmless inside `sh -c`.
  - Fail-closed: if a subdirectory cannot be read, `find` exits non-zero and the check fails.
- **🟢 Optional, new:** `scripts/check-image.sh:53` runs an unnamed container, so the trap at `:39` cannot remove it.
  - If `timeout` kills the docker client, the container could keep running. `docker run` forwards SIGTERM to it, but node running as PID 1 with no handler ignores SIGTERM.
  - Hosted runners are throwaway, so the impact is negligible. If wanted, add `--name "$UNAME"` and include it in the trap, as `:38-39` already do for `$MNAME`.

### Drift-parser test
- 🟢 I only read the description in impl-log.md:53. The change rejects a second `;` on one line (fail-closed) and decides nullability from the select position only. It interpolates no SQL and needs no DB, so it raises no security concern.

### Recommendations
1. None required for this ticket.
2. Optional: give the `:53` container a name and add it to the trap.
3. Optional: drop `:87`, which is now redundant.

### Risks
- These are unchanged from attempt 1 and accepted under D24.
- The image checks remain unproven until CI is green.

### Open questions
- None.

Files reviewed:
- /home/user/stoktok/scripts/check-image.sh
- /home/user/stoktok/apps/worker/Dockerfile
- /home/user/stoktok/work/tickets/STK-089/impl-log.md
- /home/user/stoktok/work/tickets/STK-089/security-review.md
