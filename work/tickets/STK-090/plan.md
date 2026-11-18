Status: READY

# Plan — STK-090: Owner-role test:db (STK-089 split)

Today `pnpm test:db` builds its template and runs every test as the `DB_TEST_URL` superuser (`global-setup.ts:52-78`, `harness.ts:35-66`). Superuser hides missing privileges. After this ticket the template is migrated, and every test runs, as the non-superuser login `stoktok_test_owner`. The admin connection keeps only cluster-level work: create/drop role and database, `alter schema public owner`, and `pg_terminate_backend`.

## Spec summary
Ticket `## Goal` (the scope, quoted in full in ticket.md lines 15-34). Key lines:
> - `ownerPassword(adminUrl)`: sha256 hex of a fixed label plus the decoded admin password, so concurrent runs agree and CI's scram `pg_hba` works;
> - `asOwner(url)`: swaps the userinfo and keeps host, port, database and query;
> - `ensureOwnerRole(adminClient, password)`: inside `begin`, take `pg_advisory_xact_lock` on a fixed bigint key (not `MIGRATION_LOCK_KEY`). Then `create role … login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '<hex>'` if missing, else `alter role` with the same attributes and password. Tolerate 42710 and 23505. Validate the password as `^[0-9a-f]{64}$` before interpolating it. Never drop the role.
> - **Planner addition:** the `alter role` on an existing role re-asserts the NO* flags, so a tampered role cannot stay superuser.
> - **`global-setup.ts`:** inside the existing `try`/cleanup: ensure the role; `create database <tpl> owner stoktok_test_owner`; as admin in the template, `alter schema public owner to stoktok_test_owner; revoke all on schema public from public;`; then `runMigrations` with the owner URL.
> - **`harness.ts`:** `freshDb` … returns the owner URL; `emptyDb` … plus the same two schema statements, and returns the owner URL; create and drop stay on the admin connection. `pg-proxy.ts` keeps using the admin URL for `pg_terminate_backend`.
> - **Tests:** new `test-db/owner.test.ts` …; unit tests in `packages/db/src/test-db-guard.test.ts` for `ownerPassword` … and `asOwner`; a guard that reads `scripts/db-check.sh` and asserts the role name differs from the `DB_CHECK_APP` default, `NOBODY` and `CANARY_ROLE` …
> - **Docs:** ADR 0010 §12 (owner role) and a `db/migrations/README.md` test:db bullet.

Ticket `## Acceptance criteria`:
> Every item in the scope above is done. CI's db:check after test:db still passes (no refused role or database). `typecheck`, `lint`, `test`, `test:db` and `db:check` green.

Consult `work/tickets/STK-083/consult-database-optimizer.md` §6:
> Create `stoktok_test_owner` (LOGIN, same NO* attributes as `app-db.sql:13`) idempotently. … **Never drop it at teardown.** … **Do not run the full `app-db.sql` there.** It revokes on `postgres` and `template1` … Tests thus run without superuser, which today masks missing privileges.

Ming, 2026-11-18 (ticket notes): "run STK-090 before the cutover (ADR 0010 order kept, not waived)."

## Code verified against the ticket
| Ticket names | Current code | Result |
|---|---|---|
| `global-setup.ts` "existing `try`/cleanup" | `create database ${TEMPLATE}` runs at lines 53-55, **before** `cleanup` is defined (57-66) and **outside** the `try` (67-73). Migration is `migrate(tplUrl)` → `runMigrations({ connectionString: tplUrl, dir })` (77-79). | The role, template creation and schema statements must move inside the `try`, so a failure there still drops the template. Cleanup is defined first. |
| Cleanup sweep | Line 60: `stoktok\_test\_%\_${SUFFIX}` matches the template and every clone; drops databases only. | Unchanged. The role is never dropped. |
| `harness.ts` `freshDb` / `emptyDb` | `freshDb` 35-51 (`create database ${name} template stoktok_test_tpl_${SUFFIX}`, `url = withDb(name)` = admin creds); `emptyDb` 54-66 (`create database ${name}`, admin URL). `drop` uses `admin()` + `pg_terminate_backend`. | Matches. Workers are separate processes and only get `DB_TEST_URL` and `DB_TEST_SUFFIX`; the owner password is recomputed from `DB_TEST_URL` (that is why it must be deterministic). |
| `pg-proxy.ts` | `startPgProxy(targetUrl, adminUrl)`; `terminate()` connects with `adminUrl` (69). Only caller: `session.test.ts:123` passes `process.env.DB_TEST_URL`. | No change. The proxied target becomes the owner URL; SCRAM passes through the plain TCP proxy (no TLS, no channel binding). |
| `test-db-guard.test.ts` | Imports `checkAdminUrl` from `../test-db/global-setup`; runs under `pnpm test` (`vitest.config.ts`: `src/**/*.test.ts`). | Add `describe` blocks here. |
| `scripts/db-check.sh` | `APP="${DB_CHECK_APP:-stoktok}"` (26), `NOBODY=stoktok_nobody` (27), `CANARY_ROLE=dbcheck_canary` (28). URL-mode refusal (151-158): any non-system database, or roles `$APP`, `$NOBODY`, `$CANARY_ROLE`. | `stoktok_test_owner` is none of them; test:db drops its databases at teardown, so db:check is not refused. |
| CI | `ci.yml:24-34`: `postgres:17`, `POSTGRES_PASSWORD: postgres`, port 5432; `test:db` (46-48) runs **before** `db:check` (51-53) and `test:move` (54-56), all on the same server via `localhost`. | The official image's entrypoint sets `host all all all scram-sha-256` (`POSTGRES_HOST_AUTH_METHOD` default since 14) and `password_encryption` is `scram-sha-256`, so the owner needs a real password. `test:move` refuses only its own `stoktok_mv*` / `stoktok_scratch_mv*` names (`test-db-migrate-from-supabase.sh:27-29,67-68`), so the leftover role does not affect it. |
| `db/migrations/README.md` | Line 5 describes test:db building the template with the runner. | Add one bullet after line 5. |
| ADR 0010 §12 | Line 20. | Append one sentence. |
| `MIGRATION_LOCK_KEY` | `'7865372087'` (`pg/migrate.ts:14`). | The owner-role key must differ. |

## What needs superuser today, and how the plan handles it
Checked: `db/migrations/20261111000200_baseline.sql`, `pg/migrate.ts`, `pg/client.ts` session setup, and every file in `packages/db/test-db/`. `grep` finds no `set role`, `create role`, `create extension`, `alter system`, `alter … owner` or `security definer` in `test-db/` or the baseline.

| Item | Needs superuser? | Handling |
|---|---|---|
| Baseline: extensions | No. It creates none. `pg_extension` = `{plpgsql}` (built in). `gen_random_uuid()` (lines 12, 33, 55, 259) is core since PG13, not pgcrypto. The migrations lint bans `create extension`. | None needed. The owner-run template proves it. |
| Baseline: `ai_reserve` (plpgsql) and `ai_month_spend` (sql) | No. Both are trusted languages; PUBLIC has USAGE by default. Neither is `security definer`. `pg_advisory_xact_lock` and `hashtext` are callable by anyone. | None. |
| Baseline: `revoke execute … from public` (437-438), `comment on …` | No. The owner owns the objects. | None. |
| Baseline: create tables, indexes (incl. GIN on `text[]`) in `public` | Needs CREATE on `public`. | The admin makes the owner own `public` in the template (and in `emptyDb`) before migrating. |
| Runner: `set statement_timeout`, `set local lock_timeout`, `set_config('stoktok.migrating', …, true)`, `pg_advisory_lock`, `create table public.schema_migrations` | No (USERSET GUCs, a custom placeholder GUC, public lock functions, CREATE on owned `public`). | None. |
| Pool session `set_config` (`client.ts:78`: TimeZone, DateStyle, statement_timeout, application_name, idle_in_transaction_session_timeout) | No (all USERSET). | None. |
| Tests that change schema: `ai-keys.test.ts:185` (`alter table ai_keys add constraint`), `session.test.ts:97` (`create table race_t`), `migrate.test.ts` (creates tables, `lock table public.schema_migrations`, advisory locks on `emptyDb`) | No, provided the owner owns the tables and `public`. | Clones inherit owner-owned objects from the template; `emptyDb` gets the two schema statements. |
| Catalog reads: `baseline.test.ts` (pg_class/pg_proc/pg_namespace/aclexplode), `types.test.ts:55` and `schema-drift.test.ts` (`information_schema.columns`) | `information_schema.columns` lists only columns the current role owns or has privileges on. | The owner owns every table, so the lists are complete (STK-089 plan D8 already relies on this). |
| `create database`, `drop database`, `create/alter role`, `alter schema public owner` in a database the admin does not own, `pg_terminate_backend` of the owner's backends | **Yes** (or CREATEDB / CREATEROLE / pg_signal_backend). | Stay on the admin connection: `global-setup.ts` (create, cleanup), `harness.ts` `admin()` (create, drop, terminate), `pg-proxy.ts` `terminate()`. |

Expected result: no test needs a change other than the new ones. If a test fails only because it now runs as the owner, that is a real finding: the implementer records it in impl-log and stops (A5). They do not grant privileges or switch the test back to admin.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | `owner.ts` exports `TEST_OWNER_ROLE = 'stoktok_test_owner'`, `OWNER_ROLE_LOCK_KEY` (a fixed bigint string ≠ `MIGRATION_LOCK_KEY`), `ownerPassword`, `asOwner`, `ensureOwnerRole`, `ownPublicSchema`. | Read `packages/db/test-db/owner.ts`. `pnpm test` › `test-db-guard.test.ts` › `owner role lock key differs from MIGRATION_LOCK_KEY`. |
| 2 | `ownerPassword(adminUrl)` = sha256 hex of `OWNER_PASSWORD_LABEL` + the percent-decoded admin password. It is deterministic, 64 lowercase hex, changes with the admin password, and does not depend on host, database path or query. | `pnpm test` › `test-db-guard.test.ts` › `ownerPassword` cases (Tests table). |
| 3 | `asOwner(url)` sets user `stoktok_test_owner` and password `ownerPassword(url)`. Host, port, path and query are unchanged; the admin password is not in the result. | `pnpm test` › `asOwner` cases. |
| 4 | `ensureOwnerRole(client, password)` validates `^[0-9a-f]{64}$` before any query. Inside `begin` it takes `pg_advisory_xact_lock(OWNER_ROLE_LOCK_KEY)`, then creates the role, or alters it with the same NO* attributes and password. It fails closed if the role is a member of any role. It rolls back on error and retries once on 42710/23505. It never drops the role. | Unit (fake client): `ensureOwnerRole` cases. Real PG: `owner.test.ts` › `ensureOwnerRole is idempotent, concurrent-safe and repairs flags`, `… refuses a role with memberships`. `grep -n "drop role" packages/db/test-db` finds nothing. |
| 5 | `global-setup.ts`: inside the `try`, ensure the role, `create database <tpl> owner stoktok_test_owner`, run `ownPublicSchema` as admin in the template, then `runMigrations` with `asOwner(tplUrl)`. Any failure there runs `cleanup` and exits 1. | Read the diff. `pnpm test:db` › `migrate.test.ts › template holds exactly the baseline row` still passes. `owner.test.ts` › `template objects are owned by the owner`. |
| 6 | `freshDb` clones with `owner stoktok_test_owner` and returns the owner URL (and a `pgDb` on it). `emptyDb` creates with `owner stoktok_test_owner`, runs `ownPublicSchema`, and returns the owner URL. Create, drop and terminate stay on the admin connection. | `owner.test.ts` › `freshDb runs as the non-superuser owner`, `emptyDb runs as the owner and can create tables`. Read `harness.ts`. |
| 7 | `pg-proxy.ts` unchanged; `session.test.ts` proxy scenarios pass with an owner target. | `git diff --stat main -- packages/db/test-db/pg-proxy.ts` is empty. `pnpm test:db` › `session.test.ts` green. |
| 8 | The owner is not superuser and cannot escalate: `current_user`, `rolsuper` and the other NO* flags false, `datdba` and `public` owner are the role, no PUBLIC entry on `public`, `create role` / `create database` as owner give 42501. | `owner.test.ts` (Tests table). |
| 9 | The role name differs from db:check's `DB_CHECK_APP` default, `NOBODY` and `CANARY_ROLE`, read from `scripts/db-check.sh`. | `pnpm test` › `test-db-guard.test.ts` › `test owner role never trips db:check's refusal`. |
| 10 | Every existing `test:db` test still passes as the owner. | `pnpm test:db` (all files) green; impl-log has the summary line (file and test counts). |
| 11 | CI's `db:check` and `test:move` after `test:db` still pass. | Local: run `pnpm test:db` then `DB_CHECK_URL=<same local server> pnpm db:check` against the **same throwaway** server, both green (impl-log). Real proof: the PR's CI `ci` job. |
| 12 | Docs: ADR 0010 §12 and a `db/migrations/README.md` test:db bullet. | Read the two diffs. |
| 13 | `typecheck`, `lint`, `test`, `test:db`, `db:check` green. | All five outputs in impl-log (local PG16 warning expected for db:check). CI on 17. |

## Ming verification after merge
None. This is test-harness work only: no release, no production change, no manual step (ticket note 2026-11-17).

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/db/test-db/owner.ts` | **Create.** Constants, `ownerPassword`, `asOwner`, `ensureOwnerRole`, `ownPublicSchema` (Approach step 1). Uses `node:crypto` only. Clients are typed with a minimal `QueryClient` interface (`query(text, params?)`), so `pg` is not imported and the unit tests can pass a fake. | Criteria 1-4. |
| `packages/db/test-db/global-setup.ts` | **Modify** `setup()` (lines 52-75) and `migrate()` (77-79), Approach step 2. `checkAdminUrl`, `withDb` and `withClient` are unchanged. | Criterion 5. |
| `packages/db/test-db/harness.ts` | **Modify** `freshDb` (35-51) and `emptyDb` (54-66), and add an `ownerUrl(db)` helper next to `withDb`, Approach step 3. The `TestDb` shape is unchanged. | Criterion 6. |
| `packages/db/test-db/owner.test.ts` | **Create.** Real-Postgres owner tests. | Criteria 4, 5, 6, 8. |
| `packages/db/src/test-db-guard.test.ts` | **Modify.** Add `describe` blocks for `ownerPassword`, `asOwner`, `ensureOwnerRole` (fake client), the lock key, and the db:check name guard. Existing tests unchanged. | Criteria 1-4, 9; R8. |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | **Modify.** §12 (line 20): append one sentence (step 5). | Ticket "Docs". |
| `db/migrations/README.md` | **Modify.** Add one bullet after line 5 (step 5). | Ticket "Docs". |

Verified only, not edited: `packages/db/test-db/pg-proxy.ts`, `session.test.ts`, `scripts/db-check.sh`, `scripts/test-db-migrate-from-supabase.sh`, `.github/workflows/ci.yml`, `db/migrations/20261111000200_baseline.sql`, `packages/db/src/pg/**`.

Do **not** touch: `packages/db/src/pg/**`, any existing `test-db/*.test.ts`, `scripts/**`, `.github/**`, `db/migrations/*.sql`, `db/rollback/**`, `CLAUDE.md`. New files must not contain the legacy supabase migration or rollback path strings (`legacy-reference-guard.test.ts`) or the literal database env-var name (r3-guard).

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `src/test-db-guard.test.ts › ownerPassword: deterministic 64-hex` | Two calls on `postgresql://postgres:postgres@localhost:5432/postgres` are equal and match `^[0-9a-f]{64}$`. |
| `… › ownerPassword: changes with the admin password, not with host/path/query` | `…:pw1@…` ≠ `…:pw2@…`. `…:pw1@localhost:5432/postgres` = `…:pw1@127.0.0.1:5433/stoktok_test_3_99?application_name=x` (the harness derives it from URLs with different paths). |
| `… › ownerPassword: percent-decoded` | `ownerPassword('postgresql://postgres:p%40ss%3Aw@localhost/postgres')` = `createHash('sha256').update(OWNER_PASSWORD_LABEL + 'p@ss:w').digest('hex')`. A URL with no password still gives 64 hex (local trust setups). |
| `… › asOwner: swaps userinfo, keeps host, port, database and query` | Input `postgresql://postgres:secret-ADMIN@localhost:5433/stoktok_test_1_42?application_name=x`. Output parsed with `new URL`: `username` = `stoktok_test_owner`, `password` = `ownerPassword(input)`, `hostname` `localhost`, `port` `5433`, `pathname` `/stoktok_test_1_42`, `search` `?application_name=x`. The output string does not contain `secret-ADMIN`. |
| `… › ensureOwnerRole: rejects a bad password before any query` | Fake client records queries. For `''`, 63 hex chars, 64 uppercase hex chars, `"a'; drop role x; --"` padded to 64: rejects with `/64 lowercase hex/`, zero queries recorded. |
| `… › ensureOwnerRole: create path` | Fake `pg_roles` lookup returns no row → recorded queries in order: `begin`; `select pg_advisory_xact_lock($1::bigint)` with `[OWNER_ROLE_LOCK_KEY]`; the existence select; `create role stoktok_test_owner login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '<hex>'`; the membership select; `commit`. |
| `… › ensureOwnerRole: alter path re-asserts the NO* flags` | Lookup returns a row → `alter role stoktok_test_owner with login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '<hex>'`; no `create role`; no `drop role` anywhere. |
| `… › ensureOwnerRole: 42710 / 23505 roll back and retry once` | The create throws `{ code: '42710' }` (then a separate case with `'23505'`) → `rollback`, then a second `begin` … `alter role` … `commit`; resolves. If the retry throws again, it rejects. Another error code (`'42501'`) → `rollback`, rejects, no retry. |
| `… › ensureOwnerRole: memberships fail closed` | Membership select returns `n = 1` → `rollback`, rejects with `/member of another role/`. |
| `… › owner role lock key differs from MIGRATION_LOCK_KEY` | `OWNER_ROLE_LOCK_KEY !== MIGRATION_LOCK_KEY` (imported from `../src/pg/migrate`), and it matches `^[0-9]+$` and is > 2^31 (outside `hashtext`'s int4 range, like the migration key). |
| `… › test owner role never trips db:check's refusal` | Reads `scripts/db-check.sh`. Regexes `/^APP="\$\{DB_CHECK_APP:-([a-z0-9_]+)\}"$/m`, `/^NOBODY=([a-z0-9_]+)$/m`, `/^CANARY_ROLE=([a-z0-9_]+)$/m` must each match (fail if the script changes shape). `TEST_OWNER_ROLE` differs from all three captured names. |
| `test-db/owner.test.ts › freshDb runs as the non-superuser owner` | On `freshDb()`, via `pg.Client` on `t.url`: `current_user` = `stoktok_test_owner`; `rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls` all false for `current_user`; `datdba::regrole::text` of `current_database()` = role; `nspowner::regrole::text` of `public` = role; `aclexplode(coalesce(nspacl, acldefault('n', nspowner)))` on `public` has no `grantee = 0` row. |
| `… › template objects are owned by the owner` | Same clone: zero rows in `pg_class` (namespace `public`) with `relowner <> current_user::regrole`, and zero in `pg_proc` with `proowner <> …`. `schema_migrations` is included. |
| `… › the owner cannot escalate` | As the owner: `create role stoktok_test_zz` → 42501; `create database stoktok_test_zz` → 42501. |
| `… › emptyDb runs as the owner and can create tables` | On `emptyDb()`: `current_user`, `datdba`, `public` owner, no PUBLIC entry on `public` (as above); `create table t (x int)` succeeds; `public.schema_migrations` does not exist. |
| `… › ensureOwnerRole is idempotent, concurrent-safe and repairs flags` | Admin client on `DB_TEST_URL`: `alter role stoktok_test_owner createdb`; then `Promise.all` of `ensureOwnerRole` on two separate admin clients with `ownerPassword(DB_TEST_URL)` → both resolve; `rolcreatedb` is false again; a fresh `pg.Client` on `asOwner(<admin URL>)` still connects (password unchanged). `finally`: one more `ensureOwnerRole`. |
| `… › ensureOwnerRole refuses a role with memberships` | Admin: `create role stoktok_test_m_<pid> nologin; grant stoktok_test_m_<pid> to stoktok_test_owner`. `ensureOwnerRole` rejects with `/member of another role/`. `finally`: `revoke …`, `drop role stoktok_test_m_<pid>`, then `ensureOwnerRole` resolves. |

## Approach
1. **`packages/db/test-db/owner.ts`.** Header: "test:db owner role (STK-090). Tests run as this non-superuser login; the admin URL is used only for cluster-level work. The role is never dropped."
   ```ts
   export interface QueryClient { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> }
   export const TEST_OWNER_ROLE = 'stoktok_test_owner';
   export const OWNER_PASSWORD_LABEL = 'stoktok-test-owner:v1:';
   export const OWNER_ROLE_LOCK_KEY = '7865372190'; // ≠ MIGRATION_LOCK_KEY, > 2^31
   const ATTRS = 'login nosuperuser nocreatedb nocreaterole noreplication nobypassrls';
   ```
   - `ownerPassword(adminUrl: string)`: `createHash('sha256').update(OWNER_PASSWORD_LABEL + decodeURIComponent(new URL(adminUrl).password)).digest('hex')`.
   - `asOwner(url: string)`: `const pw = ownerPassword(url); const u = new URL(url); u.username = TEST_OWNER_ROLE; u.password = pw; return u.toString();` Only call it with an admin-credential URL (documented in a one-line comment).
   - `ensureOwnerRole(c: QueryClient, password: string)`:
     - If `!/^[0-9a-f]{64}$/.test(password)` → `throw new Error('owner password must be 64 lowercase hex characters')`. This is before any query.
     - `attempt()`: `begin`; `select pg_advisory_xact_lock($1::bigint)` `[OWNER_ROLE_LOCK_KEY]`; `select 1 from pg_roles where rolname = $1` `[TEST_OWNER_ROLE]`; then `create role ${TEST_OWNER_ROLE} ${ATTRS} password '${password}'` if no row, else `alter role ${TEST_OWNER_ROLE} with ${ATTRS} password '${password}'`; then `select count(*)::int as n from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = $1` and throw `Error('stoktok_test_owner is a member of another role; remove the membership')` if `n > 0`; `commit`. On any error: `rollback` (`.catch(() => {})`) and rethrow.
     - Call `attempt()`. On an error with `code` `42710` or `23505`, call `attempt()` once more (the role now exists → alter path). Any other error is rethrown.
     - Never log or put the password in an error message. No `drop role` anywhere.
   - `ownPublicSchema(c: QueryClient)`: `alter schema public owner to ${TEST_OWNER_ROLE}`, then `revoke all on schema public from public` (two queries). The caller connects as admin to the target database.
2. **`global-setup.ts` `setup()`** after `process.env.DB_TEST_SUFFIX = SUFFIX`:
   - Define `cleanup` first (body unchanged).
   - `try { … } catch` (the existing catch body: print `pnpm test:db setup failed: <message>`, `cleanup`, `exit(1)`). Inside the `try`:
     1. `withClient(adminDb, async (c) => { await ensureOwnerRole(c, ownerPassword(adminDb)); await c.query(\`create database ${TEMPLATE} owner ${TEST_OWNER_ROLE}\`); })`;
     2. `withClient(tplUrl, ownPublicSchema)` (admin creds, template database);
     3. `migrate(asOwner(tplUrl))`. `migrate()` keeps calling `runMigrations({ connectionString, dir })`; the runner closes its client, so the template has no sessions before cloning.
   - `return cleanup`. Import from `./owner`.
3. **`harness.ts`.**
   - Add `function ownerUrl(db: string): string { return asOwner(withDb(db)); }`.
   - `freshDb`: `create database ${name} template stoktok_test_tpl_${SUFFIX} owner ${TEST_OWNER_ROLE}`; `const url = ownerUrl(name)`; `createPgDb` on that URL. `drop` unchanged (admin).
   - `emptyDb`: `admin(async (c) => { await c.query(\`create database ${name} owner ${TEST_OWNER_ROLE}\`); })`, then connect as admin to `withDb(name)` and run `ownPublicSchema` (a small local `pg.Client` block, like `admin()`), and return `url: ownerUrl(name)`. `drop` unchanged.
   - The role already exists (global setup ran first); workers never call `ensureOwnerRole`.
4. **Tests** as in the Tests table. `owner.test.ts` uses `freshDb`/`emptyDb` from `./harness` and `pg.Client`, and closes clients and drops databases in `finally`/`afterAll`. Fake client for the unit tests: a recorder whose `query` returns scripted `rows` or throws scripted `{ code }` objects.
5. **Docs.**
   - ADR 0010 §12, append: "Tests run as the non-superuser login `stoktok_test_owner` (NO* attributes as in `app-db.sql`), which owns the template, every clone and their `public` schema; the `DB_TEST_URL` superuser only creates and drops databases, ensures the role (never dropped) and terminates sessions (STK-090)."
   - `db/migrations/README.md`, new bullet after line 5: "- `pnpm test:db` migrates its template and runs every test as the non-superuser role `stoktok_test_owner` (created or reset by the test setup with a password derived from `DB_TEST_URL`, never dropped), so a migration or repo that needs superuser fails there. The role is not one of db:check's names, so `pnpm db:check` on the same throwaway server still runs."
6. **Verify:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db` (local PG on localhost; record the pg_hba method in use), then `pnpm db:check` in URL mode against the **same** server right after test:db (mirrors CI order, criterion 11), plus the default throwaway-cluster `pnpm db:check`. Record outputs in impl-log. Negative proof for criterion 8: temporarily remove `owner ${TEST_OWNER_ROLE}` from `freshDb`, see `owner.test.ts › freshDb runs as the non-superuser owner` fail on `datdba`, then revert.

**Rules:**
- **R3:** the owner URL is built only in test code from `DB_TEST_URL`; the production env-var name is not referenced (r3-guard). Passwords are never printed: setup failures print only `error.message`, and none of the new messages include the URL or password.
- **R7:** harness and test-db only; no change to `pg/**`, the baseline, scripts or CI.
- **R8:** unit tests for the pure helpers (including `ensureOwnerRole` with a fake client), real-Postgres tests for the role and harness, all five checks green.
- R1, R2, R4, R5, R9, R10: not affected.

## Specialist input used
`work/tickets/STK-083/consult-database-optimizer.md` §6 (no new consult; the orchestrator skipped consults because the scope is already reviewed):
- **Adopted:** owner role with the `app-db.sql:13` NO* attributes, idempotent creation with a race guard (here both the advisory xact lock and 42710 tolerance), never dropped at teardown; template created as admin with `owner <role>`, then `alter schema public owner … ; revoke all on schema public from public` (the `app-db.sql:35-37` steps), migrated as the owner, connection closed before cloning; clones with `owner <role>`, admin keeps create/drop; `pgDb` on the owner URL.
- **Adopted:** "Do not run the full `app-db.sql` there" — only the two schema statements are run; nothing touches `postgres` or `template1`.
- **Already done elsewhere:** "Add an assertion that `schema_migrations` holds exactly the baseline row" (`migrate.test.ts:55-67`, STK-087).
- **Resolved:** "`ai-keys.test.ts` … may reference `supabase` or `set role`; the planner should check them." Checked: it has no `set role`; its only DDL is `alter table ai_keys add constraint` on its own clone (line 185), which the owner may do.
- **Planner additions (kept minimal):** the membership check in `ensureOwnerRole`. The ticket's own addition says a tampered role "cannot stay superuser"; NO* flags alone do not remove a `grant <superuser-role> to stoktok_test_owner`, which would let it `set role` to a superuser. Failing closed there (no automatic revoke) completes that intent in about four lines. Also the two 42501 escalation checks in `owner.test.ts`, which make "nocreatedb nocreaterole" observable.

## Assumptions
- **A1. Hotspots.** No other ticket is `IN_PROGRESS`, `REVIEW` or `REWORK` (backlog checked 2026-11-18). STK-089 (DONE) last edited ADR 0010 and `db/migrations/README.md`; this plan's edits are appends at different lines. STK-094/095/097 (BACKLOG) do not touch `packages/db/test-db/`.
- **A2. `DB_TEST_URL` is a superuser** (CI's `postgres`, and the ADR 0010 §12 local example). Creating and altering a role with these attributes, `alter schema … owner` in a database owned by another role, and terminating the owner's backends need it. A non-superuser admin URL will fail in global setup with Postgres's own message; no extra check is added.
- **A3. Concurrent runs** on one server use the same admin credentials and admin database. Advisory locks are per database, so the lock serialises runs that connect to the same `DB_TEST_URL` database. Two runs with different admin passwords would reset each other's owner password; that is out of scope for a localhost test server.
- **A4. Password exposure.** `create/alter role … password '<hex>'` cannot take a bind parameter. If the statement errors, the server log may show it (`log_min_error_statement`). The value is a one-way hash of the admin password for a local test role, so the risk is accepted. It is never printed by the harness.
- **A5. No hidden superuser dependency is expected** (table above). If an existing test fails only because it now runs as the owner, the implementer records the exact failure in impl-log and stops; the orchestrator decides. No grants, no switching tests back to admin.
- **A6. The leftover role** on a developer's local server owns nothing after teardown (its databases are dropped) and has no special rights. A teardown that crashes leaves `stoktok_test_*_<pid>` databases owned by the role, as today (same sweep scope).
- **A7. Local verification** uses PG16 where available; CI runs 17. PG15+ is assumed (default `public` ownership by `pg_database_owner`); the explicit `alter schema` makes the result the same on both.
- **A8.** `owner.test.ts`'s role-tampering tests briefly change the shared role. With `fileParallelism: false` no other file in the same run is affected; a different concurrent `test:db` process could only be affected during its own global setup, which then repairs the role.

## Blocking questions
None.

## Split proposal
None. Estimate: `owner.ts` ~70 lines, `global-setup.ts` ~15, `harness.ts` ~15, `owner.test.ts` ~90, guard tests ~80, docs ~4 — about 275 lines, more than half tests.
