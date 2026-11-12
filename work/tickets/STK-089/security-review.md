# Security review — STK-089

## Attempt 1 — 2026-11-12

**Verdict: PASS. No 🔴 findings.** There is one 🟡, a follow-up that existed before this ticket, and five 🟢 notes. I read the files directly. I ran nothing (no Bash), so whether the image smoke steps actually work still depends on the CI `images` job.

### Findings

**Secret/URL leakage in migrate error paths: clean**
- `apps/worker/src/migrate.ts:35-43`: only a `MigrationError` message is printed. Anything else prints the fixed text `migrate failed: unexpected error`.
- Every `MigrationError` message in `packages/db/src/pg/migrate.ts` is built from:
  - fixed text, or
  - a version or file name, or
  - `safeDetail()` (`:129-132`), which passes through only `pg.DatabaseError` and `GuardError` messages.
- A failed connect is always the fixed `cannot connect to the database (URL not printed)` (`:144`).
- The `[code]` suffix comes from `sqlstateOf` (`packages/db/src/errors.ts:43-46`). It accepts only a 5-character SQLSTATE and drops Node `E*` codes.
- `migrateFromEnv` (`:218-224`) prints only the env name, never its value.
- `cli.ts:68-71` hands `migrate` off before `parseArgs` and `openDb`. `migrateCommand` never rejects, so the `e.message` catch at `cli.ts:172` can't be reached from `migrate`.
- `apps/worker/src/migrate.test.ts:79-90` uses a sentinel to prove there is no echo, including for a thrown string that isn't an Error.

**`scripts/check-image.sh` (worker block)**
- `:51-60` checks that `migrate` with no URL exits 2 and writes to stderr. `:62-74` checks the unreachable case: `timeout 20`, exit 1, and no `smoke-pw` or `127.0.0.1` in stdout+stderr.
- `:76-79` runs as root and asserts three things in `/app/migrations`: the baseline exists, nothing is a non-regular file (`! -type f` also rejects symlinks and subdirectories), and there is no `*.down.sql`.
- `:80-83` runs as `node` and asserts that `node` can't write the folder or the baseline file.
- `cat "$err"` at `:69` echoes container output into the CI log before the leak grep runs. This is fine because the credential is a dummy.

**🟡 F1: read-only migrations are weak protection while `dist/` and `node_modules/` belong to `node`.** `apps/worker/Dockerfile:30` correctly copies the migrations as root-owned. But `:26-28` give `node` ownership of `./node_modules`, `./dist` and `package.json`. If the runtime process is compromised, it can rewrite `dist/migrate.js` or `node_modules/@stoktok/db` and change which SQL runs or where it comes from. The new control is still correct. The weakness is the existing ownership (STK-037 era) and is outside STK-089's plan (R7).
- Fix as a follow-up: drop `--chown=node:node` on those three COPY lines. The worker writes nothing under `/app`, so this needs checking first. Then extend the check at `check-image.sh:81` to `! test -w /app/dist && ! test -w /app/node_modules`.
- This should be a `debt` issue, not part of this diff.

**🟢 F2: owner role privileges are correct and tested.**
- `packages/db/test-db/owner.ts:27` sets `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, and every run re-applies it (`global-setup.ts:51`), so a role that has drifted gets fixed.
- `owner-role.test.ts:23-57` asserts:
  - every attribute flag;
  - no membership in other roles (`pg_auth_members`);
  - creating a role or database fails with 42501;
  - the database, schema and every relation/function in `public` belong to the owner;
  - `public` has no PUBLIC grant on the schema.
- Role creation runs under `pg_advisory_xact_lock`, with 42710/23505 tolerated and one retry (`global-setup.ts:43-65`).
- The role name isn't a reserved name, and its SQL is checked against `^[a-z_]+$` before being inlined.

**🟢 F3: how the owner password is derived and sent.**
- `owner.ts:9-12`: the password is an unsalted `sha256("stoktok_test_owner:" + adminPassword)`.
  - In CI the admin URL is `postgres:postgres` (`.github/workflows/ci.yml:48`), so anyone who reads the repo can compute the owner password. That's acceptable: the service container is throwaway, and the admin password is just as public.
  - On a developer machine, the role is never dropped and keeps LOGIN with a password anyone can compute whenever the local admin password is the default. If local Postgres is published as `-p 5432:5432` (Docker binds 0.0.0.0 by default), it can be reached from the LAN. The extra risk is about zero, though, because `postgres:postgres` superuser is already reachable the same way.
- `owner.ts:24-28`: the password is checked to be 64 hex characters before going into `ALTER ROLE ... PASSWORD '<hex>'`, so SQL injection isn't possible. The statement is sent in plaintext, so it lands in the server log if `log_statement` is `ddl` or `all`. From that log line someone could brute-force a weak admin password offline. This applies to local and CI only, and I'm noting it, not asking for a change.

**🟢 F4: test-db log output.** `global-setup.ts:100` prints `(e as Error).message` for any setup failure, including Node socket errors. At worst these contain `localhost` or `127.0.0.1` and a port (`checkAdminUrl` allows only local hosts, `:11-24`), never a password. This is acceptable for a test harness. Note that `freshDb`/`emptyDb` return URLs containing the owner password (`harness.ts:39,66`), so tests should never print `t.url`; none do today.

**🟢 F5: the r3-guard migration rule is sound, with two small gaps.** `packages/db/src/r3-guard.test.ts:360-380` limits `runMigrations` and `migrateFromEnv` to the runner, the barrel, `test-db/` and `apps/worker/src/migrate(.test).ts`. It also asserts there are no hits under `apps/web/` and has fixtures for the regex. Gaps:
- (a) The rule matches names, so a computed property such as `ns['run'+'Migrations']` on a namespace import of `@stoktok/db/pg` gets past it. `apps/web/server/db.ts` is allowed to import that module. This limitation is fine for a lint-style guard.
- (b) The new block normalises `\` to `/` (`:367`), but the older blocks don't. The new rule is therefore the only one that holds on Windows, where `path.relative` returns backslashes. This is an inconsistency, not a new hole.
- `scripts/` and `db/` contain no TS/JS today, so the `walk` scope (apps and packages only) misses nothing.

**🟢 F6: image contents.** `.dockerignore` doesn't exclude `db/`. Only `/repo/db/migrations` is copied into the runtime stage, so `db/rollback` never reaches the image, and `check-image.sh:77` would fail if a `.down.sql` were ever copied. The ADR and README mention only the role name, with no credential values.

### Recommendations
1. Accept the STK-089 diff as is. All acceptance criteria in the ticket's security scope are met: the no-echo error paths, the no-leak smoke steps, the role attributes, and the guard.
2. Open a `debt` issue for F1 (root-owned `dist/` and `node_modules/`, plus the extended check). It is outside this plan under R7.
3. Optional, for test-db docs: say that the owner role persists on developer machines with a password anyone can compute when the admin password is the default (F3). Also tell developers to run test:db only against a Postgres that isn't reachable from the LAN.

### Risks
- The image smoke checks have only been syntax-checked locally. Their real proof is the PR's CI `images` job, so confirm it's green before calling this verified.
- The unreachable-database smoke uses `127.0.0.1:9`, which refuses the connection immediately. It doesn't exercise the DNS-failure or connect-timeout paths, but the generic `cannot connect` wrapper covers those in code.

### Open questions
1. Does anything ever write under `/app` at runtime? If not, F1 is a small, safe change. My proposed default is root-owned everything except a writable tmp folder, if one is needed.

No secret values were read or printed during this audit.
