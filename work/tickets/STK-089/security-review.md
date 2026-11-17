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
