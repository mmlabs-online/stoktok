## Consult (database-optimizer) for STK-089: owner-role test:db, drift test, migrations dir handling

I read `global-setup.ts`, `harness.ts`, `pg-proxy.ts`, `baseline.test.ts`, the head of `test-db/migrate.test.ts`, `schema.ts`, `r3-guard.test.ts`, `ci.yml`, `db-check.sh` (refusal logic), the worker `Dockerfile` and `tsup.config.ts`, `readMigrationFiles`, and the STK-083 consult §5–§6. Nothing was run.

### Findings

1. **The scope in the ticket matches the STK-083 consult §6.** `global-setup.ts` and `harness.ts` are as STK-087 left them: the template is built as admin through `runMigrations`, and clones and `emptyDb` use the admin URL.
2. **No test-db file needs superuser, as far as I could grep.** I found no `set role`, `create extension`, `session_authorization` or `alter system`. The only `pg_terminate_backend` users are `pg-proxy.ts:69` and the harness drop helpers, and both stay on the admin connection. `session.test.ts` passes `base.url` as the proxy target and `DB_TEST_URL` as the admin URL, so a SCRAM login as the owner through the plaintext proxy works.
3. **CI and `db:check` do not collide.**
   - `ci.yml:46-53` runs `test:db` and then `db:check` on the same PG17 service.
   - `db-check.sh:152-156` refuses only on leftover non-system databases, or on the roles `$APP`, `stoktok_nobody` and `dbcheck_canary`.
   - A persistent `stoktok_test_owner` therefore does not trip it. A crash that skips `cleanup()` (leaving databases behind) would, but that is pre-existing.
4. **PG15+ schema ownership.** In a fresh database, `public` is owned by `pg_database_owner`, so the database owner can create objects in it even without `alter schema … owner`. That is why `emptyDb` would work without it, but production's `add-app-db.sh` does the alter and the revoke. For parity, apply the same two statements to `emptyDb`'s database as admin.
5. **Baseline assertions survive the owner swap.** `baseline.test.ts:55-58` needs at least one ACL entry and no PUBLIC entry beyond USAGE. After `alter schema public owner to X; revoke all … from public`, the ACL is `X=UC/X`, so the test passes.
6. **`schema.ts` shape for the parser** (`packages/db/src/pg/schema.ts`):
   - Columns are `name: Type;` lines, one per line.
   - Types are aliases (`Int8`, `TsDef`, `Json`, `JsonDef`, `Def<T>`, `Generated<T>`) and inline `ColumnType<string[], string[] | undefined, string[]>` (lines 65, 130, 196, 237).
   - Every nullable column is currently `X | null` at top level.
   - **Pitfall:** a nullable jsonb would have to be `Json | null`. A `| null` hidden inside a `ColumnType<…>` generic must not count as nullable. Strip the generic bodies, or require that `| null` appear after the last top-level token.
   - `holidays` and the other array columns contain `| undefined`, which is not null.
7. **Migrations dir handling is already sound.**
   - `readMigrationFiles` (`migrate.ts:107`) filters `*.sql` only, so `README.md` is ignored.
   - It throws exit 2 on a bad name (including `.down.sql`), and on any non-regular file via Dirent, so symlinks and directories are rejected.
   - The worker is a tsup ESM build (`tsup.config.ts`). Both entries land in `dist/`, and a shared chunk is in the same directory. So `dirname(fileURLToPath(import.meta.url))` gives `/app/dist` in the image and `apps/worker/src` or `dist` in the repo.
   - `../migrations` and `../../../db/migrations` both resolve as the ticket states (from `apps/worker/src`, `../../..` is the repo root).
8. **The Dockerfile has no migrations COPY yet.**
   - `ENTRYPOINT ["node","dist/cli.js"]` already makes `docker run IMAGE migrate` work.
   - `dist` is `--chown=node:node`. The new `COPY --from=build /repo/db/migrations ./migrations` has no chown, so it is root-owned, which matches the ticket.
   - This copies `README.md` into the image as well. It is harmless because the runner ignores non-`.sql` files.

### Recommendations

**Owner role (`test-db/owner.ts`, `global-setup.ts`, `harness.ts`)**

- **R-1: set the password on every run, not just on create.**
  - Do `begin; select pg_advisory_xact_lock(<const>); create role … if it is missing (check pg_roles); alter role … LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '<hex>'; commit`.
  - Then a stale role from an older run (different admin password, or wrong attributes) converges instead of silently diverging.
  - Inline the password as a literal. It is hex-only, so it is safe; `ALTER ROLE` cannot take a bind parameter.
  - Keep the 42710 and 23505 tolerance. The advisory lock is per database, so two runs with different admin databases are not serialised, and roles are cluster-wide.
  - Use a lock key distinct from `MIGRATION_LOCK_KEY`.
- **R-2: password derivation.**
  - Use `sha256('stoktok_test_owner:' + decoded admin password).hex()`. The label means it is not a bare hash of the admin password.
  - It still works when the admin URL has no password (trust auth), because the password is always set.
  - Put it in `owner.ts` with no `pg` import, so `harness.ts` in the Vitest worker processes can import it cheaply.
  - Put the role name, the derivation and the userinfo-swap helper in `owner.ts`.
- **R-3: build the owner URL with the `URL` setters**, `u.username = …; u.password = …`, never by string replacement. `withDb` in the harness then composes with it. Keep the admin helper for create, drop and the sweep.
- **R-4: template sequence** (close every connection before cloning, because `create database … template` fails while the template has sessions):
  1. As admin, `create database tpl owner stoktok_test_owner`.
  2. As admin, connect to `tpl`, then `alter schema public owner to stoktok_test_owner; revoke all on schema public from public;` and end that client.
  3. `runMigrations` as the owner URL.
- **R-5: apply step 2 to `emptyDb` too**, by connecting to the new database as admin. Otherwise PG<15 or a changed default gives different results from production.
- **R-6: a superuser admin is required.** `create database … owner X` needs superuser, or membership in X plus CREATEDB. The CI and README `DB_TEST_URL` is superuser, so just document it in the README.
- **R-7: add tests beyond the ticket's two assertions.**
  - Check `current_user`, `session_user` and `rolsuper=false`, plus `rolcreatedb`, `rolcreaterole`, `rolreplication` and `rolbypassrls` all false.
  - Check the role belongs to no other role (`pg_auth_members`).
  - Check `create role zz` and `create database zz` give 42501 as the owner. This mirrors the STK-083 consult §3 `expect_fail` checks and is cheap.
  - Check the template's and a clone's `datdba` and `nspowner` of `public`, so the harness cannot quietly go back to admin.
- **R-6b (docs): the README must say `stoktok_test_owner` is created in the cluster and never dropped, and that it holds no data.** It lives only on localhost, via the existing host guard in `checkAdminUrl`.

**Drift test (`test-db/schema-drift.test.ts`)**

- **R-8: fail closed.**
  - The parser must throw on any line inside an interface that it cannot parse. A silently skipped column is how drift hides.
  - Assert unique column names per table.
  - Assert that the `Database` map has the same 18 entries as the interfaces.
  - Build the table list from the `Database` map (key → interface), not from interface-name case conversion.
- **R-9: join `information_schema.tables` with `table_type='BASE TABLE'`** and `table_schema='public'`, and exclude `schema_migrations`. Compare both directions, with messages that name the table and column, so a failure is actionable. Run it as the owner so privileges do not hide columns.
- **R-10 (optional, about 10 lines): also compare insertability.** `Def<>`, `Generated<>`, `TsDef`, `JsonDef` and `ColumnType<…| undefined>` should correspond to `column_default is not null`, `is_identity = 'YES'` or `is_generated = 'ALWAYS'`. This is the other half of drift (a column that is required in TS but defaulted in SQL, or the reverse). I would include it only if the plan budget allows; the ticket asks for names and nullability only.
- **R-11:** the fixtures (a missing column, a nullability flip) should run the pure compare function, with no DB.

**Migrations dir and image (`resolveMigrationsDir`, `Dockerfile`, `check-image.sh`)**

- **R-12: compute `moduleDir` once**, in `cli.ts` (or `migrate.ts`), from `dirname(fileURLToPath(import.meta.url))`, and inject it. `resolveMigrationsDir(moduleDir, exists)` stays pure, with `exists` injected. Test it with the exact strings `/app/dist`, `<repo>/apps/worker/src` and `<repo>/apps/worker/dist`, plus the both-missing case. In that case it returns the first candidate, so `readMigrationFiles` reports "migrations directory not found" with exit 2.
- **R-13: `check-image.sh` assertions on `/app/migrations`.**
  - The baseline file is present: `test -f`.
  - No `*.down.sql` anywhere: `find /app/migrations -name '*.down.sql'` is empty.
  - `find /app/migrations -mindepth 1 ! -type f` is empty.
  - Optionally, every `*.sql` name matches `^[0-9]{14}_[a-z0-9_]+\.sql$`.
  - Plain `docker run … find` needs `--entrypoint`, because the image entrypoint is `node`.
  - Use `--entrypoint sh` or `--entrypoint find`. The `-bookworm-slim` image has both.
  - Alternatively, put the baseline check in the `migrate` smoke itself.
- **R-14: no-URL and unreachable-host smokes** match the `migrateFromEnv` exit-code design: exit 2 when the URL is missing, and exit 1 with no `smoke-pw` or `127.0.0.1` in the output when the host is unreachable.
  - Keep `timeout 20` (connect timeout is 5 s) and compare the exit code exactly, not just non-zero.
  - Capture stdout and stderr together for the leak grep.
- **R-15: the "no `.down.sql`" guarantee is by construction** (`db/rollback` is a different directory). A cheap local guard: a vitest unit test that `readdirSync('db/migrations')` has no `.down.sql` and every `.sql` parses.

**r3-guard** (the orchestrator note from the STK-087 security review)

- **R-16: new rule in `packages/db/src/r3-guard.test.ts`.** `runMigrations` and `migrateFromEnv` may appear only in these files:
  - `packages/db/src/pg/migrate.ts`
  - `packages/db/src/pg/migrate.test.ts`
  - `packages/db/src/pg/index.ts`
  - `apps/worker/src/migrate.ts`
  - `apps/worker/src/migrate.test.ts`
  - `apps/worker/src/cli.ts`
  - `apps/worker/src/cli.test.ts`
  - `packages/db/test-db/**`
- **R-16b: add a fixture test** that the regex catches `runMigrations(`, `migrateFromEnv` and the `{ runMigrations as x }` import form, but not `runMigrationsX`. Use `\b`.
- **R-16c: also assert that `apps/web/**` never mentions them.** That is covered by the allow-list, but name it explicitly, since the web app must never hold DDL.

### Risks

- **Concurrent test:db runs on one cluster** (for example a dev running two worktrees) are safe for the role thanks to R-1, but the template and clone names are per-PID, so they are fine. One caveat: `create database … template` takes a share lock on the template. It is fine because each run has its own template.
- **A persistent login role with a password derived from the admin password.**
  - The risk is low: it is localhost-only and the database holds nothing.
  - If a dev's admin password is trivial, the owner password is derivable. Say so in the README rather than hide it.
- **Slice size.** The ticket has four deliverables plus the r3-guard rule. Putting `owner.ts` and the drift parser's pure functions in separate small files keeps the review readable.
- **Owner-role exposure.** Tests that passed only because admin was a superuser (for example a repo doing something implicitly privileged) will now fail. The grep found none, but the only way to be sure is to run `pnpm test:db` locally. The plan should list that run as an explicit verification step, on PG16 locally and on 17 in CI.
- **Image smoke cannot run here (no Docker).** So `bash -n` plus careful quoting matters. The smoke must not print `$STOKTOK_DATABASE_URL`, including via `set -x`.
- **`.dockerignore`:** the ticket says "verified only". Verify that it neither excludes `db` nor `db/migrations/*.sql`, for example through a blanket `*.sql` pattern.

### Open questions (each with a proposed default)

1. Should the drift test include the insertability check (R-10)? Default: no for names and nullability only, and open a `debt` issue.
2. For the owner role password, accept the sha256 derivation from the admin password? Default: yes, with the label prefix from R-2.
3. Copy the whole `db/migrations` directory into the image, including `README.md`, or only `*.sql`? Default: copy the directory as the ticket says. The runner ignores non-`.sql` files, and `check-image.sh` asserts only regular files.
4. Apply the schema-owner alter and revoke to `emptyDb` (R-5)? Default: yes, for production parity.

Relevant files: `packages/db/test-db/global-setup.ts`, `packages/db/test-db/harness.ts`, `packages/db/test-db/baseline.test.ts`, `packages/db/src/pg/schema.ts`, `packages/db/src/pg/migrate.ts`, `packages/db/src/r3-guard.test.ts`, `apps/worker/Dockerfile`, `apps/worker/tsup.config.ts`, `scripts/db-check.sh`, `.github/workflows/ci.yml`.
