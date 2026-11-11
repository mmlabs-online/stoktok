# STK-086 security review

## Security review: STK-086, attempt 1

**Verdict: no 🔴 findings, so REWORK isn't needed for security.** The owner model, the ACL family and the canaries do what the plan says. There are five 🟡 hardening items, and three of them are about `DB_CHECK_URL` mode. Line numbers below are from the working tree; I didn't run git, so I didn't check that it matches commit 4c2a96d. I couldn't execute anything (read-only, no shell), so every finding comes from reading the code, and the PG17 behaviour is unverified until CI runs.

### Findings

**Password handling**
- 🟢 `scripts/db-check.sh:35` builds `PW` from 24 bytes of `/dev/urandom` as hex, so it needs no quoting. `PW` is never exported.
- 🟢 `:150` feeds the password as `printf '\\set password …'` (a bash builtin) into the stdin pipe. There's no `-v password=`, no `-e`/`-a` and no `set -x`.
- 🟢 `PGPASSWORD="$PW"` is set only on the owner `psql` command (`:66`, `:90`), so it's visible in `/proc/<pid>/environ` to the same user or root only. The impl-log `ps` sampling backs this up.
- 🟢 Residual: if `ALTER ROLE` fails, the server's `log_min_error_statement` would log the statement, password included. The password is single-use and the role is dropped afterwards, so this is acceptable.
- 🟡 **`db-check.sh:52-55` can echo the whole `DB_CHECK_URL`, superuser password included.** When the sed doesn't match, it returns its input unchanged. Two inputs that don't match:
  - an uppercase scheme, e.g. `POSTGRESQL://…`;
  - a keyword/value conninfo, e.g. `host=localhost password=…`.

  In both cases `host` holds the full string, and the refusal message prints it to stderr. That breaks the plan's own R3 rule ("nothing prints `DB_CHECK_URL`"). **Fix:** use `sed -nE '…p'` so a non-match yields an empty host that is refused, and print a fixed message without `$host`.
- 🟡 **`:64-65`: in URL mode, the superuser password sits in psql's argv** (`psql "$DB_CHECK_URL"`), so `ps` shows it. CI uses the public `postgres` password, so only developers' local servers are affected. This was probably already true before STK-086, and the impl-log `ps` check only looked for the owner password. **Fix:** strip the password from the URL and pass it via `PGPASSWORD` for the superuser commands too, or document `~/.pgpass`.

**`DB_CHECK_URL` refusals and cleanup**
- 🟡 **`:31`: `DB_CHECK_APP` accepts the system names `postgres`, `template0` and `template1`, and `:140-141` doesn't catch them.**
  - The database refusal skips exactly those names, and the role refusal only fires if a role with that name exists.
  - `DB_CHECK_APP=template1` therefore passes. `app-db.sql` changes the owner of `template1`, the migrations go into it, and the cleanup's `drop database` fails because it is a template. Every later `createdb` on that cluster inherits the stoktok schema.
  - `DB_CHECK_APP=postgres` on a cluster whose superuser isn't named `postgres` (common with Homebrew or Postgres.app) changes the owner of the `postgres` database and fills it with the stoktok schema. The cleanup can't drop it, because it is the open database.
  - `template0` gets its owner and ACL changed before `\connect` fails.
  - **Fix:** reject `postgres`, `template0`, `template1` and `pg_*` in the name check at `:31`, and also refuse if `pg_database` already has a row named `$APP`.
- 🟡 **`:52-62`: the localhost check can be bypassed. This would be an accident, not an attack.** Severity is low because the developer sets this variable themselves. Four ways through:
  - **Multi-host URI:** `postgresql://u:p@localhost:5432,remote:5432/postgres`. The sed reads the host as `localhost`, but libpq falls back to `remote` if localhost doesn't answer.
  - **Percent-encoded keys:** libpq decodes URI query keys (worth confirming), so `?ho%73t=remote` gets past the `[?&](host|hostaddr|port)=` grep at `:57`.
  - **`PGHOSTADDR` in the environment:** it supplies `hostaddr`, which neither the URI nor `-h` sets. libpq then connects to that address, in URL mode and in throwaway mode (`:88-90`).
  - **`?service=`:** a service file can supply `hostaddr`.

  **Fix:**
  - require the whole authority to match `^([^@/]*@)?(localhost|127\.0\.0\.1)(:[0-9]+)?$`;
  - refuse any query string that contains `%`, `host`, `hostaddr`, `port` or `service`;
  - `unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGDATABASE PGUSER PGOPTIONS` near the top of the script.
- 🟢 `:139-147`: the refusals run after the major check and before anything is created, and `CREATED=1` is set only after they pass. The cleanup at `:37-43` drops the database `with (force)` before the roles, so roles from a committed canary still drop cleanly. Nothing is cleaned up when the script refused.
- 🟢 `?dbname=` in the URL would point `su_app` at the wrong database, but `acl_runs_as_superuser_in_app_db` (`checks-acl.sql:8-14`) aborts before any canary runs. That is the safe direction.
- 🟡 **The local-cluster side effect is documented but not undone.**
  - `app-db.sql:29-30` permanently revokes CONNECT/TEMPORARY from PUBLIC on `postgres` and `template1`. The header (`:17`) and `db/migrations/README.md:18` say so.
  - A developer's cluster that only has system databases can still have other login roles that depend on that CONNECT.
  - **Fix:** snapshot `datacl` for those two databases before bootstrap. If they were NULL, the cleanup re-runs `grant connect, temporary … to public`.
  - CI is safe: `ci.yml:46` runs `test:db` before `db:check`, in a throwaway container.

**ACL coverage (`checks-acl.sql`)**
- 🟢 `acldefault` is used for NULL ACLs everywhere it should be:
  - relations and sequences (`:109`, `S` maps to `s`), functions (`:131`), types (`:142`), schema (`:153`) and database (`:164`);
  - columns (`:121`) correctly don't fall back, because a NULL `attacl` means no column grant.
- 🟢 The owner-only rule is `grantee <> owner` everywhere. The single exception is PUBLIC USAGE on types (D2). Schema `public` and the database allow no PUBLIC entry at all, which matches production after `app-db.sql:25` and `:37`.
- 🟢 `pg_default_acl` must be empty across all roles (`:170-175`). The no-extra-schemas check (`:177-183`) escapes `pg\_%` correctly.
- 🟢 Ownership is checked for `pg_class`, `pg_proc`, `pg_type`, the schema and the database (`:16-33`). This also proves indirectly that the migrations were created by `$APP`.
- 🟢 `stoktok_nobody` is checked with `has_table_privilege`, `has_any_column_privilege`, and the sequence, function, schema and database privilege functions (`:35-77`). The `set local role` loop (`:79-102`) resets the role in every branch, and a subtransaction rollback undoes it anyway.
- 🟡 **Gaps:**
  - **`nobody_denied_select_insert` mostly duplicates `nobody_schema_privileges`.** `stoktok_nobody` has no USAGE on `public`, so every select and insert fails with 42501 at the schema level. That proves nothing per table, and there is no canary for it, nor for `acl_runs_as_superuser_in_app_db` or `nobody_sequence_privileges`.
  - **`nobody_sequence_privileges` (`:47-54`) has no row-count guard,** even though the baseline has sequences (identity columns). Add `n >= 1`.
  - **Role membership is never checked.** A `grant stoktok to x` would hand over full access, as would membership of `$APP` in `pg_read_server_files`, `pg_write_server_files`, `pg_execute_server_program` or `pg_read_all_data`. Add an empty-`pg_auth_members` check for `$APP` and `$NOBODY`, and include memberships in the snapshot.
  - **Large-object ACLs (`pg_largeobject_metadata.lomacl`) aren't covered.** The owner can create large objects and grant on them. Low priority.

**Canaries**
- 🟢 They aren't vacuous. Each of the 13 must fail with its own `CHECK FAILED: <name>`, and the check order (`:8-183`) lets each one reach its target. The impl-log shows a negative proof with a wrong name.
- 🟢 They are always rolled back. psql `--single-transaction` with `ON_ERROR_STOP` exits without COMMIT when a check fails (`db-check.sh:167`). An uncaught canary does commit, but the script then exits 1, and either the throwaway cluster is deleted or the URL-mode cleanup drops the database and roles. No canary touches `postgres` or `template1`.

**Migrations as owner, PG major, vendoring and the move**
- 🟢 The UP and DOWN migrations and `checks.sql` all run through `owner_psql` (`:130`, `:133`), and `checks.sql:30-56` asserts four things:
  - a non-superuser database owner (`runs_as_owner`);
  - all role flags false;
  - `create role` gives 42501;
  - the only extension is `plpgsql`.

  Name validation and one-to-one parity fail before any database work (`:106-126`).
- 🟢 The PG-major check (`:96-104`) runs before the refusals and the bootstrap: it fails when `CI` is set and warns otherwise. GitHub sets `CI=true`. Minor: an unreachable server ends in a bash arithmetic error instead of a clear message (already noted in impl-log).
- 🟢 `scripts/db-check/app-db.sql` matches `/home/user/deployment/postgres/sql/app-db.sql` line for line. Running `cmp` and `sha256sum` is still the reviewer's job.
- 🟢 The Vault stub now lives only in `supabase/legacy/bootstrap-roles.sql`, and its comment at `:13` says it is schema-diff only. `schema-diff.sh:64` points to it. db:check no longer references `supabase/` (F2 closed).
- 🟢 STK-083 carry-overs: rec. 3 (owner-run migrations) and the relacl, nspacl, attacl, `pg_default_acl` and extra-schema checks are done. The lint items stay with STK-088.

### Recommendations
1. Stop printing `$host` and make the host sed fail closed (`:52-55`). This is R3 and the plan's "nothing prints `DB_CHECK_URL`" rule.
2. Reject system database names and `pg_*` in `DB_CHECK_APP` (`:31`), and refuse if a database named `$APP` exists (acceptance criterion 5).
3. Harden URL mode:
   - match the whole authority;
   - refuse a query string with `%`, `host`, `hostaddr`, `port` or `service`;
   - unset the `PG*` connection environment variables.
4. Add a role-membership check and include memberships in the snapshot, plus a guard on `nobody_sequence_privileges`.
5. Optionally restore the PUBLIC CONNECT/TEMPORARY on `postgres` and `template1` in the URL-mode cleanup when it was the default before.
6. Optionally keep the superuser password out of argv (`PGPASSWORD`).

Items 1–3 are small edits to the shell script. They can go into this ticket if the reviewer asks for a rework for other reasons; otherwise they belong in follow-ups.

### Risks
- PG17 behaviour (`acldefault`, `aclexplode`, `has_*` and canary order) is proven only on PG16 locally. CI on `postgres:17` with `CI=true` is the first real proof.
- URL mode on a developer's long-lived cluster can still change it permanently (the two revokes, and the system-name case until item 2 is fixed).

### Open questions
- Do the deployment repo's `add-app-db.sh` and `10-app-dbs.sh` validate `app` against system names? If not, item 2 applies there too.

### Files reviewed
- /home/user/stoktok/scripts/db-check.sh
- /home/user/stoktok/scripts/db-check/app-db.sql
- /home/user/stoktok/scripts/db-check/checks.sql
- /home/user/stoktok/scripts/db-check/checks-acl.sql
- /home/user/stoktok/scripts/schema-diff.sh
- /home/user/stoktok/supabase/legacy/bootstrap-roles.sql
- /home/user/stoktok/db/migrations/README.md
- /home/user/stoktok/.github/workflows/ci.yml
- /home/user/deployment/postgres/sql/app-db.sql
- /home/user/stoktok/work/tickets/STK-086/{ticket,plan,impl-log}.md
- /home/user/stoktok/work/tickets/STK-083/security-review.md
