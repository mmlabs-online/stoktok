Status: READY

# Plan — STK-086: db:check rewrite for the single-owner model (STK-083 split, slice 2a)

This ticket is too big for one implement/review cycle (see `## Split proposal`). **This plan covers slice 1 only:**
- the db:check rewrite: vendored `app-db.sql`, migrations run as the owner, the `checks.sql` rewrite, the new `checks-acl.sql` with self-test canaries, and the rollback phase;
- the move of `bootstrap-roles.sql` and the `schema-diff.sh` repoint;
- the README updates.

The migration-lint gaps and the legacy-reference guard test go to a new ticket, **STK-088**. Both are TypeScript unit tests that run in `pnpm test` and are independent of the bash/SQL work.

## Spec summary
Ticket `## Goal` (quoted; the parts this slice implements are in **bold**):
> **Vendored byte-identical `scripts/db-check/app-db.sql` with provenance in the header; `db-check.sh` applies `db/migrations` via psql `--single-transaction` as the owner login (decision 2), with a one-to-one `db/rollback` parity check, `PG_BIN` default 17 and a PG-major assertion (fail when `CI` is set, warn locally). URL mode: app name `DB_CHECK_APP` (default `stoktok`); refuse when any non-system database exists or the role/db already exists; password via stdin `\set` / `PGPASSWORD`, never argv. `checks.sql` runs as owner: delete the `set local role service_role` and `reset role` pairs; rename `service_role_can_*` to `owner_can_*`; replace the RLS-on and anon checks with RLS-off and `pg_policies` empty; delete `ai_keys_privileges`; replace the role half of `ai_functions_locked`; owner `pg_roles` flags all false; `create role` gives 42501; `pg_extension = {plpgsql}`. New `checks-acl.sql` runs as superuser in the app DB: `stoktok_nobody` denied (has_*_privilege plus `set local role` loops); `aclexplode(coalesce(acl, acldefault(kind, owner)))` with no non-owner grantee on relations, sequences, functions, types, schema `public` and the database; `pg_default_acl` empty; everything owned by the app role. Rollback phase: `pg_class`/`pg_proc`/`pg_type` all 0, and roles and `public` owner/ACL unchanged; then re-apply and re-check. Move `bootstrap-roles.sql` (with the Vault stub) out of db:check to `supabase/legacy/`, and repoint `schema-diff.sh`.** Legacy-reference guard test … [→ STK-088]. **Update the `supabase/README.md` PG16 text. Closes "drops the db:check Vault stub" (F2) and the ticket's db:check scope.**

Ticket `## Notes / answers from Ming` (orchestrator, from the STK-083 reviews):
> **run the db:check migrations as the non-superuser owner so CI proves every PR applies without superuser; extend db:check ACL checks to pg_class.relacl, pg_namespace.nspacl and extra schemas.** (The open question about CONNECT is answered: deployment app-db.sql:25 revokes ALL on the app database from PUBLIC.)

> **add column-level PUBLIC ACL (pg_attribute.attacl) and empty pg_default_acl checks**; migration lint: `$` inside identifiers …, nested/any block comments …, shared do-block regex const. [lint → STK-088]

> non-ASCII dollar tags (`$é$`) also bypass the lint tokeniser [→ STK-088]; **add a catalog check that allows no ACL entry except the owner's (plus PUBLIC USAGE on schema public), which catches grants to any role.**

Ticket `## Shared-Postgres standard`:
> The role owns its database and schema `public`; it has no CREATEROLE/CREATEDB/superuser. The same role runs the app and the migrations.

> **Release rule:** … no stoktok release is cut until STK-084.

STK-083 plan decision 2:
> **psql**, one `--single-transaction -f` per file, logged in as the owner role (implemented in STK-086).

STK-083 plan decision 3:
> **Vendor it** (STK-086) as a byte-identical copy at `scripts/db-check/app-db.sql`. Record its provenance (deployment-repo path, sha256, copy date) in the `db-check.sh` header, not inside the file.

STK-083 plan, "Two corrections for STK-086":
> `expect_fail('create database zz')` … raises 25001, not 42501. Assert `rolcreatedb = false` instead. `create extension pgcrypto` would **succeed** for the database owner … Rely on the lint plus `pg_extension = {plpgsql}` instead.

## Decisions taken in this plan
| # | Point | Decision | Why |
|---|---|---|---|
| D1 | PUBLIC on schema `public` in the owner-only rule | **Strict in db:check.** No PUBLIC entry at all on `public`. | The ticket note allows "PUBLIC USAGE on schema public" because `test:db` (`baseline.test.ts:55-58`) does not run `app-db.sql`. db:check runs the real `app-db.sql`, and its line 37 (`REVOKE ALL ON SCHEMA public FROM PUBLIC`) removes that entry, so production has none. db:check can therefore be stricter than test:db and match production exactly. |
| D2 | PUBLIC USAGE on **types** | **Allowed** (the only carve-out). Any other non-owner entry on a type fails. | `acldefault('T', owner)` is `{=U/owner, owner=U/owner}`. Every table row type and array type in `public` carries PUBLIC USAGE by default, and the baseline cannot revoke it: the lint bans `grant`, the "exactly two revokes" test forbids more revokes, and the baseline is frozen. Type USAGE gives no data access: it still needs schema USAGE, which D1 proves PUBLIC lacks. The rule still catches grants to any named role. Relations, sequences, functions, the schema and the database stay strictly owner-only. |
| D3 | Proving the ACL checks are not vacuous | **Built-in canaries.** db-check.sh runs `checks-acl.sql` once per injected violation, in a psql `--single-transaction` that is never committed. Each run must fail with its expected `CHECK FAILED: <name>`. | This is the R8 "new logic has tests" for SQL checks. In STK-083 the reviewer proved this by hand on a scratch copy; this makes the proof run on every PR. Every violation is rolled back, because the failed check aborts the transaction. |
| D4 | URL-mode cleanup | On exit, URL mode drops what **it** created: database `$APP` (`with (force)`), roles `$APP`, `stoktok_nobody` and `dbcheck_canary`. It only does this after its own refusal checks have passed. It does **not** undo `app-db.sql:29-30`, the revokes on `postgres`/`template1`. This is documented. | Without the cleanup, the "refuse when the role/db already exists" rule would make URL mode single-use on a developer's server. CI uses a throwaway service container either way. |
| D5 | Owner connection in URL mode | Built as `postgresql://$APP@$HOST:$PORT/$APP` from the parsed host and port, with `PGPASSWORD` set only on that command. The superuser connection to the app DB uses `DB_CHECK_URL` with only its path swapped. Refuse a `DB_CHECK_URL` whose query string sets `host`, `hostaddr` or `port`, as `checkAdminUrl` does in `global-setup.ts:16-18`. | libpq lets URI query parameters override the authority, so a `?host=` would bypass the localhost check. psql's `-U` cannot override the user in a URI. |
| D6 | Split | Lint gaps and the legacy guard test → **STK-088**. | See `## Split proposal`. |

## Acceptance criteria → verification
| # | Criterion (this slice) | How the reviewer verifies it |
|---|---|---|
| 1 | `scripts/db-check/app-db.sql` is byte-identical to the deployment repo's file, and its provenance (path, sha256, copy date, deployment commit if available) is in the `db-check.sh` header. | `cmp scripts/db-check/app-db.sql /home/user/deployment/postgres/sql/app-db.sql` exits 0. `sha256sum` of the file equals the value in the header. |
| 2 | db:check bootstraps via the vendored `app-db.sql` (role `$APP`, database `$APP`), with the password fed on stdin (`\set password …`). The password never appears in any argv, and no `-e`/`-a` echo flag is used. | Read `db-check.sh`: the password is only in a bash variable, the `printf` builtin piped to psql stdin, and a `PGPASSWORD=` prefix on owner commands. There is no `set -x` and no `-v password=`. `grep -n 'password' scripts/db-check.sh` shows only those uses. |
| 3 | Migrations in `db/migrations` (and rollbacks in `db/rollback`) are applied with psql `--single-transaction` **as the owner login**, not as the superuser. File names are validated, and the parity between the two directories is one-to-one. | `pnpm db:check` prints `owner role flags: f|f|f|f|f` and `apply 20261111000200_baseline.sql (as stoktok)`. `checks.sql › runs_as_owner` passes. **Negative proof (scratch copy of the repo):** append `select pg_catalog.pg_read_file('postgresql.conf');` to the baseline; `bash scripts/db-check.sh` must fail with 42501. Add a stray `db/rollback/20990101000000_x.down.sql`; db:check must fail with a parity message before applying anything. |
| 4 | `PG_BIN` defaults to `/usr/lib/postgresql/17/bin`, falling back to 16 and then `pg_config --bindir`. The server major must be 17: a mismatch is a hard failure when `CI` is set and a warning otherwise. | Run `pnpm db:check` here (PG 16 only): it prints a `WARNING … expected 17` line and ends `db:check OK`. Run `CI=true pnpm db:check`: it exits 1 with the major-version error. CI's run on `postgres:17` passes. |
| 5 | URL-mode safety: `DB_CHECK_APP` (default `stoktok`, must match `^[a-z][a-z0-9_]*$`); refuse a non-local host or a `host`/`hostaddr`/`port` query parameter; refuse if any database other than `postgres`/`template0`/`template1` exists, or if role `$APP`, `stoktok_nobody` or `dbcheck_canary` exists; clean up its own objects on exit (D4). | On a throwaway TCP cluster (`initdb --auth-local=trust --auth-host=scram-sha-256`, `postgres` password set, `-c listen_addresses=127.0.0.1 -p <port>`):<br>(a) `DB_CHECK_URL=postgresql://postgres:<pw>@127.0.0.1:<port>/postgres pnpm db:check` ends `db:check OK`, which proves the scram password path for the owner;<br>(b) run it again: OK again (cleanup worked);<br>(c) `createdb x` then run: refused, exit 1, nothing created;<br>(d) `create role stoktok` then run: refused;<br>(e) `?host=other` appended: refused;<br>(f) `DB_CHECK_APP='Bad-Name'`: refused. |
| 6 | `checks.sql` runs as the owner: no `set local role`/`reset role`; `owner_can_*` labels; RLS **off** on every table and `pg_policies` empty; no anon/authenticated/service_role checks; `ai_keys_privileges` gone; `ai_functions_locked` keeps the definer/search_path half and checks that the owner can execute; owner `pg_roles` flags all false; `create role` → 42501; `pg_extension = {plpgsql}`. | `grep -nE "set local role|reset role|service_role|anon|authenticated|ai_keys_privileges|rls_enabled" scripts/db-check/checks.sql` finds nothing. `pnpm db:check` passes. **Negative proof (scratch):** append `alter table public.watchlist enable row level security;` to the baseline → `CHECK FAILED: rls_disabled_all_tables`. |
| 7 | `checks-acl.sql` (superuser, connected to the app DB) asserts:<br>- everything in `public`, the schema and the database is owned by `$APP`;<br>- `stoktok_nobody` has no privilege on tables, columns, sequences, functions, the schema or the database, and `set local role` select/insert gives 42501 on every table;<br>- owner-only ACLs on relations and sequences, columns (`attacl`), functions, types (D2), schema `public` (D1) and the database;<br>- `pg_default_acl` is empty;<br>- there are no extra schemas.<br>Each set-based check has a non-vacuous row-count guard. | `pnpm db:check` passes, and the canary step (criterion 8) proves that each named check fires. Read `checks-acl.sql`: every `aclexplode` call uses `coalesce(<acl>, acldefault(<kind>, <owner>))`, except `attacl`, where NULL means "no column grants". |
| 8 | Canaries: each injected violation makes `checks-acl.sql` fail with its own check name, and nothing is committed. | `pnpm db:check` prints `canary <name>: caught` for every canary listed in Approach step 6 (13, or 12 if the implementer drops one with a recorded reason). **Negative proof (scratch):** change one canary's expected name to a wrong one → db:check exits 1 with "failed for another reason". |
| 9 | Rollback phase: the down files are applied in reverse as the owner. Afterwards `pg_class`/`pg_proc`/`pg_type` in `public` are `0|0|0`, and the role flags plus the owner and ACL of `public` and of the database equal the snapshot taken right after bootstrap. Then the migrations are re-applied and both check files run again. | `pnpm db:check` prints `after rollback: 0|0|0` and `snapshot unchanged`, then `checks (after re-apply)` and `acl checks (after re-apply)`, and ends `db:check OK`. **Negative proof (scratch):** delete one `drop table` line from the down file → db:check exits 1 at the `0|0|0` assertion. |
| 10 | The Vault stub is out of db:check (F2). `bootstrap-roles.sql` has moved to `supabase/legacy/bootstrap-roles.sql`, and `schema-diff.sh` uses the new path and still proves faithfulness. | `test ! -e scripts/db-check/bootstrap-roles.sql`. `grep -rniE "vault|supabase/" scripts/db-check.sh scripts/db-check/` finds nothing (the vendored `app-db.sql` contains neither word). `bash scripts/schema-diff.sh` exits 0 with `A' vs B: identical` and `0|0|0`. |
| 11 | Docs: the `supabase/README.md` banner and the "Checking the schema" and Vault sections are updated (no stale "Postgres 16" or `scripts/db-check/bootstrap-roles.sql` text). `db/migrations/README.md` gains a short "Checking" section: owner model, URL-mode rules and side effect (D4), PG17. | Read both files. `grep -n "Postgres 16\|scripts/db-check/bootstrap" supabase/README.md` finds nothing. |
| 12 | Production keeps working: no release is cut. | `git diff --stat main` touches nothing under `apps/`, no Dockerfile, no `release.yml`, no `.github/workflows/ci.yml`, no `scripts/check-*.sh`. No release branch is created. |
| 13 | `typecheck`, `lint`, `test`, `test:db` and `db:check` are green; schema-diff still passes. | Run all five, plus `bash scripts/schema-diff.sh`. CI on the PR is green (db:check in URL mode on `postgres:17` with `CI=true`). |

## Ming verification after merge
None. No release is cut; production is untouched until STK-084.

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `scripts/db-check/app-db.sql` | **Create.** Byte-identical copy of `/home/user/deployment/postgres/sql/app-db.sql` (`cp`, never retyped). | Criterion 1; STK-083 decision 3. |
| `scripts/db-check.sh` | **Rewrite.** See Approach steps 1–8. | Criteria 1–5, 8, 9. |
| `scripts/db-check/checks.sql` | **Modify.** See Approach step 4. | Criterion 6. |
| `scripts/db-check/checks-acl.sql` | **Create.** See Approach step 5. | Criteria 7, 8. |
| `scripts/db-check/bootstrap-roles.sql` → `supabase/legacy/bootstrap-roles.sql` | **Move** (`git mv`). Change only the line 13 comment: "Moved from scripts/db-check in STK-086. Used only by scripts/schema-diff.sh for the STK-083 faithfulness proof; never by db:check, test:db or any runner." | Criterion 10. |
| `scripts/schema-diff.sh` | **Modify** line 64 to point at `$ROOT/supabase/legacy/bootstrap-roles.sql`. Nothing else. | Criterion 10. |
| `supabase/README.md` | **Modify.** Banner: "db:check no longer applies them (STK-086)". Replace "## Checking the schema" with a two-line pointer to `db/migrations/README.md`. In "## Vault", change the stub path to `supabase/legacy/bootstrap-roles.sql` ("used only by `scripts/schema-diff.sh`") and drop "which STK-083 deletes". | Criterion 11 (ticket: "Update the `supabase/README.md` PG16 text"). |
| `db/migrations/README.md` | **Modify.** Line 5: drop "(STK-086)". Add a "## Checking (`pnpm db:check`)" section of about 8 lines: throwaway PG17 cluster or `DB_CHECK_URL`; the vendored `app-db.sql`; migrations and `checks.sql` as the owner; `checks-acl.sql` and canaries as superuser; rollback and re-apply; the PG-major rule; URL-mode refusals, cleanup and the permanent `postgres`/`template1` revoke side effect (use a throwaway server only). | Criterion 11. |

Do **not** touch:
- `db/migrations/*.sql` and `db/rollback/*.sql`;
- `packages/**`, including `migrations-lint.test.ts` (it moves to STK-088);
- `apps/**`, Dockerfiles, `.github/workflows/*`, `package.json`;
- `CLAUDE.md` and the ADRs.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `checks.sql › runs_as_owner` | `current_user` is the database owner (`datdba`) and not a superuser, so db-check.sh cannot silently run the migrations or checks as superuser. |
| `checks.sql › owner_role_flags` | `rolsuper`, `rolcreaterole`, `rolcreatedb`, `rolreplication` and `rolbypassrls` are all false for `current_user` (mirrors `app-db.sql:13`; replaces the `create database` expect_fail, per the STK-083 correction). |
| `checks.sql › owner_cannot_create_role` | `pg_temp.expect_fail('owner_cannot_create_role', 'create role dbcheck_zz', array['42501'])`. |
| `checks.sql › extensions_plpgsql_only` | `array_agg(extname order by extname)` from `pg_extension` = `{plpgsql}`. |
| `checks.sql › rls_disabled_all_tables` | No `public` relation of kind `r`/`p` has `relrowsecurity` or `relforcerowsecurity`. |
| `checks.sql › no_policies` | Kept: `pg_policies` is empty for `public`. |
| `checks.sql › owner_can_read_write*` (10 blocks), `ai_reserve_gate`, `ai_keys_constraints` | Same assertions as today, run as the owner with the role switches removed. |
| `checks.sql › ai_functions_locked` | `has_function_privilege(current_user, f, 'execute')` for both functions, plus the existing `prosecdef`/`search_path=""` assertion. |
| `checks-acl.sql › acl_runs_as_superuser_in_app_db` | `current_database() = current_setting('dbcheck.app')` and `current_user` is a superuser. |
| `checks-acl.sql › owned_by_app` | Every `pg_class`, `pg_proc` and `pg_type` row in `public` has owner `$APP`; so do `nspowner` of `public` and `datdba` of the current database. Guard: at least 18 `pg_class` rows were checked. |
| `checks-acl.sql › nobody_table_privileges` | For every `public` relation of kind r/p/v/m/f: no `has_table_privilege(nobody, oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')` and no `has_any_column_privilege(nobody, oid, 'SELECT,INSERT,UPDATE,REFERENCES')`. Guard: at least 18 relations. |
| `checks-acl.sql › nobody_sequence_privileges` | No `has_sequence_privilege(nobody, oid, 'USAGE,SELECT,UPDATE')` on any sequence in `public`. |
| `checks-acl.sql › nobody_function_privileges` | No `has_function_privilege(nobody, oid, 'EXECUTE')` on any function in `public`. Guard: at least 2. |
| `checks-acl.sql › nobody_schema_privileges` | `has_schema_privilege(nobody, 'public', 'USAGE,CREATE')` is false. |
| `checks-acl.sql › nobody_database_privileges` | `has_database_privilege(nobody, current_database(), 'CONNECT,TEMPORARY,CREATE')` is false. |
| `checks-acl.sql › nobody_denied_select_insert` | For each `public` table: `set local role <nobody>`, then expect_fail with 42501 on `select 1 from public.%I` and on `insert into public.%I default values`, then `reset role` (inside the same DO block, so a canary's single transaction is never left on the nobody role). Guard: the loop ran at least 18 times. |
| `checks-acl.sql › acl_owner_only_relations` | Kinds r/p/v/m/f/S: `aclexplode(coalesce(relacl, acldefault(case relkind when 'S' then 's' else 'r' end, relowner)))` has no row with `grantee <> relowner`. Guard: at least 18 rows. |
| `checks-acl.sql › acl_owner_only_columns` | `pg_attribute` of `public` relations with `attacl is not null`: `aclexplode(attacl)` has no row with `grantee <> relowner`. A NULL `attacl` means no column grant, so there is no default and no guard. The canary proves the check fires. |
| `checks-acl.sql › acl_owner_only_functions` | `aclexplode(coalesce(proacl, acldefault('f', proowner)))` has no row with `grantee <> proowner`. Guard: at least 2 rows. |
| `checks-acl.sql › acl_owner_only_types` | `aclexplode(coalesce(typacl, acldefault('T', typowner)))` in `public` has no row with `grantee <> typowner` other than `grantee = 0 and privilege_type = 'USAGE'` (D2). Guard: at least 1 row. |
| `checks-acl.sql › acl_owner_only_schema` | Schema `public`: `aclexplode(coalesce(nspacl, acldefault('n', nspowner)))` has no row with `grantee <> nspowner` (D1: PUBLIC is not allowed). Guard: at least 1. |
| `checks-acl.sql › acl_owner_only_database` | Current database: `aclexplode(coalesce(datacl, acldefault('d', datdba)))` has no row with `grantee <> datdba`. Guard: at least 1. |
| `checks-acl.sql › default_acl_empty` | `select count(*) from pg_default_acl` = 0. |
| `checks-acl.sql › no_extra_schemas` | No `pg_namespace` other than `public`, `information_schema` and `pg\_%`. |
| `db-check.sh` canaries (Approach step 6) | 13 injected violations, each caught by its named check and rolled back. |

## Approach
1. **Header and setup (`db-check.sh`).**
   - Header comment: purpose (STK-003, rewritten in STK-086 for the single-owner model).
   - Provenance block: `scripts/db-check/app-db.sql` is a byte-identical copy of `mmlabs-online/deployment` `postgres/sql/app-db.sql`, sha256 `<value>`, copied 2026-11-11, deployment commit `<git -C /home/user/deployment rev-parse HEAD>` if it is a git checkout. Re-check with `cmp`.
   - Add the "throwaway servers only" warning.
   - Keep `set -euo pipefail`, `PSQL_OPTS=(-X -q -v ON_ERROR_STOP=1)` and the `cleanup` trap. Never use `set -x`, `-e` or `-a`.
   - `APP="${DB_CHECK_APP:-stoktok}"`, validated against `^[a-z][a-z0-9_]*$` (exit 1 otherwise). `NOBODY=stoktok_nobody`. `CANARY_ROLE=dbcheck_canary`.
   - `PW="$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')"` (hex, so it needs no quoting).
2. **Connections.**
   - **Throwaway** (no `DB_CHECK_URL`):
     - `PG_BIN` is the env value, else the first of `/usr/lib/postgresql/17/bin` or `/usr/lib/postgresql/16/bin` that has `initdb`, else `pg_config --bindir` (same loop as `schema-diff.sh:23-34`).
     - initdb, start and the root/`runuser` handling stay as today; quote `-k '$TMP'` as `schema-diff.sh:45` does.
     - `su_psql` = `-h "$TMP" -U postgres -d postgres`, `su_app` = `-d "$APP"`, `owner_psql` = `PGPASSWORD="$PW" psql -h "$TMP" -U "$APP" -d "$APP"` (trust auth ignores the password).
   - **URL** mode:
     - Keep the host check (`localhost`/`127.0.0.1`).
     - Refuse `[?&](host|hostaddr|port)=` in the query string (D5).
     - Parse `PORT` (default 5432).
     - `su_psql` = `psql "$DB_CHECK_URL"`. `su_app` = the same URL with the path replaced by `/$APP`, via `sed -E "s#^([a-z]+://[^/?]*)(/[^?]*)?#\1/$APP#"`. `owner_psql` = `PGPASSWORD="$PW" psql "postgresql://$APP@$HOST:$PORT/$APP"`.
     - Before anything is created, as superuser: if `select count(*) from pg_database where datname not in ('postgres','template0','template1')` ≠ 0, or any of `$APP`/`$NOBODY`/`$CANARY_ROLE` exists in `pg_roles`, print a refusal naming the reason (never the URL) and exit 1. Only then set `CREATED=1`.
     - The cleanup trap, when `CREATED=1`: `drop database if exists "$APP" with (force)`, then `drop role if exists` for the canary, nobody and app roles. Ignore errors, but print a warning.
3. **Bootstrap.**
   - Major check: `v=$(su_psql -At -c 'show server_version_num')` and print `server: <version()>`. If `v/10000 ≠ 17`: when `${CI:-}` is non-empty, error and exit 1; otherwise print `WARNING: Postgres major <n>, expected 17 (production)` to stderr and continue.
   - `{ printf '\\set password %s\n' "$PW"; cat "$ROOT/scripts/db-check/app-db.sql"; } | su_psql -v app="$APP"`. psql reads stdin, so the password is only in the pipe.
   - `su_psql -c "create role $NOBODY nologin"`.
   - Print `owner role flags: …` from `pg_roles`.
   - Take `SNAP0` with a superuser query in the app DB: one line made of the role flag rows for `$APP` and `$NOBODY` (including `rolcanlogin`), `nspowner::regrole`/`nspacl` of `public`, and `datdba::regrole`/`datacl` of the database. It holds no secrets.
4. **`checks.sql` edits** (owner session; the file keeps its `begin … rollback` wrapper):
   - Delete every `set local role service_role;` and every `reset role;` line (at :245, 256, 267, 279, 291, 303, 320, 345, 360, 520, 565, 641 and 732, plus their resets).
   - Rename the `service_role_can_read_write*` comments and exception texts to `owner_can_read_write*`.
   - Replace :186-192 `rls_enabled_all_tables` with `rls_disabled_all_tables`. Keep `no_policies` (:194-199).
   - Delete :201-240 (`no_grants_anon_authenticated_public`, `anon_denied`, `rls_blocks_even_with_grant`); `checks-acl.sql` now covers them.
   - `ai_functions_locked` (:675-693): replace the anon/authenticated/service_role loop with "owner can execute"; keep :686-692.
   - Delete `ai_keys_privileges` (:709-723) entirely.
   - Add near the top, after the helpers: `runs_as_owner`, `owner_role_flags`, `owner_cannot_create_role` and `extensions_plpgsql_only`.
   - `tables_exist` is unchanged, because psql creates no `schema_migrations` table.
5. **`checks-acl.sql`** (new; superuser session in the app DB; no transaction control, so a canary can wrap it):
   - First line: `set dbcheck.app = :'app'; set dbcheck.nobody = :'nobody';` (psql interpolates these; DO bodies read them with `current_setting`).
   - Then the same `pg_temp.expect_fail` helper as `checks.sql:6-17`.
   - Then the checks in this order: `acl_runs_as_superuser_in_app_db`, `owned_by_app`, the six `nobody_*` checks, the six `acl_owner_only_*` checks, `default_acl_empty`, `no_extra_schemas`.
   - Each is one `do $$ -- <name>` block that raises `CHECK FAILED: <name> (<details>)`, in the house style.
   - The order matters for the canaries: a violation must reach its target check before an earlier check fires.
6. **Canaries** (after the first `checks-acl.sql` pass). Define `canary <name> <sql>`:
   - It runs `su_app --single-transaction -v app=… -v nobody=… -c "<sql>" -f checks-acl.sql`, capturing stdout and stderr.
   - If the run exits 0, it prints `canary <name> was not caught` and exits 1. The violation was committed, but the script fails anyway, and cleanup or the cluster teardown removes it.
   - If the output does not contain `CHECK FAILED: <name>`, it prints the output and "failed for another reason" and exits 1.
   - Otherwise it prints `canary <name>: caught`.

   `$APP` is interpolated by bash (it is validated). `C=dbcheck_canary`. The 13 canaries:

   | Expected check | Injected SQL |
   |---|---|
   | `nobody_table_privileges` | `grant select on public.watchlist to public` |
   | `nobody_function_privileges` | `grant execute on function public.ai_month_spend(timestamptz, timestamptz) to public` |
   | `nobody_schema_privileges` | `grant usage on schema public to public` |
   | `nobody_database_privileges` | `grant connect on database $APP to public` |
   | `acl_owner_only_relations` | `create role $C nologin; grant select on public.settings to $C` |
   | `acl_owner_only_columns` | `create role $C nologin; grant select (symbol) on public.watchlist to $C` |
   | `acl_owner_only_functions` | `create role $C nologin; grant execute on function public.ai_reserve(text, text, text, bigint, bigint, timestamptz, timestamptz) to $C` |
   | `acl_owner_only_types` | `create role $C nologin; create type public.dbcheck_t as enum ('a'); alter type public.dbcheck_t owner to $APP; grant usage on type public.dbcheck_t to $C` |
   | `acl_owner_only_schema` | `create role $C nologin; grant usage on schema public to $C` |
   | `acl_owner_only_database` | `create role $C nologin; grant connect on database $APP to $C` |
   | `default_acl_empty` | `create role $C nologin; alter default privileges for role $APP in schema public grant select on tables to $C` |
   | `no_extra_schemas` | `create schema dbcheck_extra authorization $APP` |
   | `owned_by_app` | `create role $C nologin; alter table public.watchlist owner to $C` |

   If any canary turns out to be redundant or impossible on PG16/17, the implementer may drop at most one and must record why in `impl-log.md`; at least 12 must remain, with every check family covered.
7. **Migrations and the main sequence.**
   - Validate `db/migrations`: every entry is `README.md` or matches `^[0-9]{14}_[a-z0-9_]+\.sql$`, with at least one migration.
   - Validate `db/rollback`: every entry matches `^[0-9]{14}_[a-z0-9_]+\.down\.sql$`.
   - Parity: compare the sorted `<version>_<name>` lists with `diff`, and exit 1 with the difference. Fail before any DB work.
   - `apply_owner` prints `==> apply <file> (as $APP)` and runs `owner_psql --single-transaction -f`.
   - Sequence:
     1. Bootstrap.
     2. Apply UP in order.
     3. `checks` (`owner_psql -f checks.sql`).
     4. `acl checks` (`su_app -f checks-acl.sql`).
     5. Canaries.
     6. Apply DOWN in reverse order.
     7. Leftover check: the `pg_class`/`pg_proc`/`pg_type` counts in `public` (superuser, app DB) must be `0|0|0`, else exit 1.
     8. `SNAP1` must equal `SNAP0`, else print both and exit 1.
     9. Re-apply UP, then run `checks (after re-apply)` and `acl checks (after re-apply)`.
     10. Print `db:check OK`.
8. **Move and repoint.** `git mv scripts/db-check/bootstrap-roles.sql supabase/legacy/bootstrap-roles.sql`, edit its line-13 comment, and repoint `schema-diff.sh:64`. Run `bash scripts/schema-diff.sh` to confirm `A' vs B: identical`.
9. **Docs:** `supabase/README.md` and `db/migrations/README.md` as in the Files table.
10. **Verify:**
    - Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db` (local PG16) and `pnpm db:check` (throwaway mode; PG16 → warning).
    - Run `CI=true pnpm db:check`: it must exit 1 on the major check.
    - Run URL mode on a scram-auth TCP throwaway cluster twice, plus the refusal cases (criterion 5).
    - Run `bash scripts/schema-diff.sh`.
    - Record the outputs in `impl-log.md`.

**Rules:**
- R3: no app URL or credential is read. The generated owner password lives only in a shell variable, a stdin pipe and a per-command `PGPASSWORD`. It is never printed, and nothing prints `DB_CHECK_URL`.
- R2, R5: no schema or config changes.
- R7: lint and guard-test work stays in STK-088.
- R8: the checks plus the canaries are the tests; all five checks must be green.
- R10: not affected.

## Specialist input used
`work/tickets/STK-083/consult-database-optimizer.md` (no new consult):
- **Adopted:**
  - §3: run the real vendored `app-db.sql` with `-v app`; `stoktok_nobody nologin` outside migrations; `checks.sql` as owner with the listed deletions and renames; `pg_extension = {plpgsql}`; `checks-acl.sql` as superuser; assertions (a)–(e).
  - §3: `aclexplode(coalesce(acl, acldefault(kind, owner)))` with the listed kinds.
  - §3: URL-mode `DB_CHECK_APP`, refuse on non-system databases, document the `postgres`/`template1` side effect.
  - §4: down files reversed; `pg_class`/`pg_proc`/`pg_type` zero; roles and `public` owner/ACL unchanged; one-to-one parity in db:check.
  - §7: `PG_BIN` default 17 and the major assertion (hard in CI, warning locally).
  - §8: stop globbing `supabase/`.
  - §2: keep `bootstrap-roles.sql` under `supabase/legacy/` for the one-off proof.
- **Adjusted:**
  - §3(f) (owner flags) is placed in `checks.sql`, as the ticket says, not in `checks-acl.sql`.
  - §3 `create database zz` / `create extension pgcrypto` expect_fails are replaced by the `owner_role_flags` and `extensions_plpgsql_only` assertions (the STK-083 corrections).
  - §3(b) "no grantee other than the owner" gets one carve-out, PUBLIC USAGE on types (D2), because the Postgres default cannot be revoked in the frozen baseline.
  - §3 "refuse, or use `stoktok_dbcheck`": we refuse, and also clean up our own objects (D4).
- **Not applicable:** §3 "add `schema_migrations` to `tables_exist`", because db:check applies via psql (STK-083 decision 2).
- **Moved to STK-088:** §8 legacy-reference guard test.

STK-083 `security-review.md`:
- Attempt 1 rec. 3 (run migrations as the non-superuser owner): adopted for db:check. `test:db` is STK-087's owner-role template.
- Attempt 1 rec. 2 (relacl, nspacl, extra schemas) and attempt 2 (attacl, `pg_default_acl`): adopted in `checks-acl.sql`.
- Attempt 2 lint items → STK-088.

STK-083 `review.md` attempt 2 follow-up "a stronger catalog gate … catch grants to any role": adopted as the `acl_owner_only_*` family. Schema `public` is strict (D1) instead of allowing PUBLIC USAGE.

## Assumptions
- **A1. Hotspots.**
  - STK-083 (`DONE`) edited `scripts/schema-diff.sh`, `supabase/README.md` and `db/migrations/README.md`. If its PR is not merged when this branch is cut, expect a rebase.
  - STK-087 (`BACKLOG`) does not touch db:check files.
  - STK-088 and STK-087 both touch `packages/db/src/migrations-lint.test.ts` (STK-087 may move `lintMigration` out of it); the orchestrator should serialise them.
  - No `src/App.tsx`-style hotspot.
- **A2.** In this session only PG16 binaries exist (`/usr/lib/postgresql/16/bin`). Every catalog function used (`acldefault`, `aclexplode`, `has_*_privilege`, `drop database … with (force)`) exists in PG13+, so local runs are valid with the warning. CI proves PG17.
- **A3.** GitHub Actions sets `CI=true`. The `postgres:17` service image's `pg_hba` uses scram for TCP, so the owner login with `PGPASSWORD` works there. When CI runs db:check, test:db has already dropped its databases (`global-setup.ts:57-66`), so the non-system-database refusal does not trip. STK-087's persistent `stoktok_test_owner` role is not one of the refused names.
- **A4.** `app-db.sql`'s `\connect :"app"` reuses the host, port, user and password of the superuser connection in both modes (unix socket, or the URI).
- **A5.** In URL mode, the `app-db.sql:29-30` revokes on `postgres` and `template1` persist (D4). This is acceptable for CI's throwaway container and documented for local use.
- **A6.** In throwaway mode the refusal and cleanup steps are skipped, because the cluster is fresh and is deleted on exit.
- **A7.** Follow-up, not in this diff: ADR 0011:56 and ADR 0009:29 still name `scripts/db-check/bootstrap-roles.sql`. These are historical records; update them at STK-084 if wanted.

## Blocking questions
None.

## Split proposal
**Why:** the full ticket comes to about 380 added and 160 deleted lines of bash and SQL, plus a mechanical 37-line vendored file:
- `db-check.sh`: about 170;
- `checks-acl.sql`: about 170;
- `checks.sql`: about +35/−130;
- canaries and docs: about 40.

The lint and guard work would add about 80 TypeScript lines on top. Both the db:check rewrite and the lint tokeniser drew several review rounds in STK-083, and keeping them together raises the risk of exhausting the 2-rework cap. The lint and guard work is independent: it runs in `pnpm test` only and touches no db:check file.

| Slice | ID | Title | Scope | Depends on |
|---|---|---|---|---|
| 1 (**this plan**) | STK-086 | db:check rewrite for the single-owner model | Everything in this plan. | STK-083 |
| 2 | **STK-088** (new) | Migration-lint tokeniser gaps and legacy-reference guard | See the scope list below this table. | STK-086 (the guard test needs db-check.sh to stop referencing `supabase/migrations`). Serialise with STK-087 (A1). |

STK-088 scope, in `packages/db/src/migrations-lint.test.ts` and a new `packages/db/src/legacy-reference-guard.test.ts`:
- **Lint** (from the STK-083 security review attempt 2 and review attempt 2):
  - A shared identifier-character lookbehind `(?<![A-Za-z0-9_$\u{80}-\u{10FFFF}])` (with the `u` flag) before both the dollar-tag and the E-string alternatives. This closes `$` inside identifiers, as in `x$a$`, and non-ASCII identifier prefixes.
  - A non-ASCII dollar-tag class, `[A-Za-z_\u{80}-\u{10FFFF}][A-Za-z0-9_\u{80}-\u{10FFFF}]*`.
  - A ban on block comments in migrations: any `/*` token or leftover `/*` is flagged as `block comment`. This also closes the nested-comment bypass.
  - An exported shared `BASELINE_DO_RE` const, used by both `baseline is plain create` and the fixture test.
  - Fixtures for each item:
    - `select 1 as x$a$; grant select on t to public; -- $a$`;
    - `select $é$ -- $é$; grant select on t to public;`;
    - `/* /* */ ' */ commit; -- '`;
    - `/* x */ select 1;` (flagged);
    - `select '/*';` (not flagged).
  - Add one line to `db/migrations/README.md`: "no block comments".
- **Legacy-reference guard:** walk the repo, skipping `node_modules`, `.git`, `.next`, `dist` and `coverage`. Fail if any file outside `supabase/`, `work/`, `docs/`, `.claude/` and `scripts/schema-diff.sh` contains `supabase/migrations` or `supabase/rollback`. The frozen `db/migrations/20261111000200_baseline.sql` (its provenance comment on line 1) is allowlisted by exact path. Reword `db/migrations/README.md:3` to "the old `supabase/` migration history". Add a fixture showing the matcher flags `ls supabase/migrations/*.sql`.

Areas: db, security.

STK-084 additionally depends on STK-088. The reviewer nits `reset session authorization` and `set_config(E'role'` remain optional follow-ups for STK-088's planner.
