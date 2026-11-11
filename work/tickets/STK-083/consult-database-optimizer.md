STK-083 database consult (read-only, nothing edited). Delta over `work/tickets/STK-080/consult-database-optimizer.md` (STK-080 consult), whose two-role model (`stoktok_owner`/`stoktok_app`), default privileges and `set local role stoktok_app` plan is superseded by the single-owner standard (ticket.md:17-25, ADR 0010 §7 at 0010:15). Still valid from STK-080: the `ai_reserve` advisory-lock notes (§3), the rollback leftover check for functions/sequences/types (§5), and the data-only restore notes for STK-084 (§7).

## Findings

### 1. Squash into one faithful baseline
Old chain: 15 up files under `supabase/migrations/`. Only 14 carry table, function or index DDL. `20261023000200_v1_rls_grants.sql` is pure RLS and grants, and `20261110000200_ai_keys.sql` is the Vault shape.

**Build the baseline by mechanical concatenation, then prove it with the diff. Do not hand-rewrite and do not start from a `pg_dump`.** Concatenation keeps constraint names, comments and index text verbatim, and reviewers can still read it.

- **Column order must survive.** Two old files add columns after creation: `20261105000100_data_gaps_resolved_reason.sql:2-5` (column plus two named constraints plus a column comment) and `20261026000100_financials.sql:26` (`alter table public.symbols add ...`).
  - Keep those `alter table ... add` statements as written. Do not inline them into the `create table`.
  - Inlining changes `attnum` order and auto-generated check-constraint names. That shows up in the schema diff, and it breaks positional `insert ... values (...)` such as `checks.sql:738` and any `COPY` without a column list.
- **Strip these:**
  - the whole of `20261023000200_v1_rls_grants.sql` (:1-19);
  - every `alter table ... enable row level security` (14 files, e.g. `financials.sql:22`, `lottery.sql:74,78`, `news.sql:30`);
  - every `revoke`, `grant` and `alter default privileges` (e.g. `ai_usage.sql:29-31,90-93`);
  - the Vault `ai_keys` file `20261110000200_ai_keys.sql` in full (3 DEFINER functions, `vault.*` calls);
  - from `20261111000100_ai_keys_app_encryption.sql`: the Vault guard (:12-18), the `drop function if exists` / `drop table if exists` lines (:20-23), and its RLS and grant lines (:37-39).
- **Keep:** the final `ai_keys` DDL (`20261111000100_ai_keys_app_encryption.sql:25-33`) and its table comment (:35).
  - The baseline must also keep `last4 ~ '^[\x21-\x7e]{4}$'`, the ciphertext length 20..256, iv = 12, auth_tag = 16 and `key_version >= 1` checks.
  - That covers STK-083 acceptance criterion 3 and the STK-082 F2 shape.
- **Functions:** use only the final `ai_reserve` body from `20261110000100_ai_reserve_harden.sql:4-49` (without its :50-51 grant) plus `ai_month_spend` from `20261109000100_ai_usage.sql:79`. Both are `security invoker` with `search_path=''`.
- **Create statements:** use plain `create table` / `create function`, never `if not exists` / `or replace`. A baseline pointed at a non-empty database must fail loudly. The runner's transaction rolls it back.
- **No extension is needed.** `gen_random_uuid()` is core since PG13. The extension grep over the migrations found nothing outside the Vault file.
- **File names.** Name it `db/migrations/20261111000200_baseline.sql`, which sorts after the last legacy version `20261111000100`. It must match the TuDo regex `^(\d{14})_([a-z0-9_]+)\.sql$` (`migrator.js:9`). Put the down file in `db/rollback/20261111000200_baseline.down.sql`. A `.down.sql` inside `db/migrations` would be rejected as a config error (`migrator.js:84`, because `name` cannot contain a dot).
- **One open decision: function EXECUTE for PUBLIC.** A function with no ACL defaults to PUBLIC EXECUTE.
  - Runtime impact is nil, because `app-db.sql:37` revokes PUBLIC's USAGE on schema `public` and the functions are invokers.
  - But the ticket demands `aclexplode` PUBLIC checks, and `has_function_privilege('stoktok_nobody', f, 'execute')` ignores schema USAGE and returns true.
  - **Recommendation:** keep `revoke execute on function ... from public` for the two functions in the baseline, as the old files did (`ai_usage.sql:90,92`). It is a revoke, not a grant, so it does not break "no grant / no create role". If that is unwanted, the function check has to be scoped to "no PUBLIC schema USAGE" instead.

### 2. Schema-diff proof
- **Use the same major on both sides.** Run PG17 with the same `pg_dump` binary for both dumps. `pg_dump` text differs across majors.
- **Dump command:** `pg_dump --schema-only --schema=public --no-owner --no-privileges --no-tablespaces`.
  - `--no-privileges` removes the GRANT, REVOKE and `ALTER DEFAULT PRIVILEGES` entries.
  - Newer minors emit random `\restrict` / `\unrestrict` lines. Strip them with `sed -E '/^\\(un)?restrict /d'` rather than `--restrict-key`, which older minors reject.
  - Also filter `ENABLE ROW LEVEL SECURITY` lines from side A.
- **Side A′: the full old chain.** Apply old chain A′ (all 15 files) to a scratch PG17 using the old `scripts/db-check/bootstrap-roles.sql` (roles plus the Vault stub, :1-53). Side B is the baseline applied as the owner role. **The normalised diff A′ vs B must be empty.** This is the faithfulness proof.
- **Side A: the schema live on Supabase.** Run a second diff against the chain through `20261110000300` only, which is what Supabase actually runs. ADR 0011 (0011:54) forbids applying the `20261111…` migration there. **The expected diff is exactly the ticket's intentional `ai_keys` difference:** `secret_id` shape against the ciphertext/iv/auth_tag/key_version/last4 shape, the three `ai_key_*` DEFINER functions, and the `ai_keys` comment. Nothing else is allowed. Record this in `work/tickets/STK-083/schema-diff.md` with the commands and the raw diff.
- **Optional, needs Ming's credentials:** a third `pg_dump` of the live Supabase project, compared with A, to show the repo chain equals production. It cannot be a required step, because the ticket says Ming has no manual step.
- **Keep the old bootstrap file.** The proof is a one-off, and it needs the Vault stub the ticket deletes from db:check. Move `bootstrap-roles.sql` to something like `supabase/legacy/` instead of deleting it. Do not wire it into any runner.

### 3. Single-owner role checks
**Bootstrap by running the real `app-db.sql`, not a re-implementation.**
- Vendor a byte-identical copy as `scripts/db-check/app-db.sql`, with a header giving the source commit.
- Run it as `psql -v app=stoktok -v password=... -f` against the superuser connection (`db-check.sh:43`). That reproduces `app-db.sql:13-15` (no SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS), the DB owner at :18-22, the PUBLIC revoke at :25, and the `public` schema owner plus revoke at :35-37.
- Then create `stoktok_nobody nologin`. Neither role goes in a migration.
- **Side effect to guard:** `app-db.sql:29-30` revokes CONNECT/TEMPORARY on `postgres` and `template1` from PUBLIC. That is harmless on the `initdb` throwaway. But `db-check.sh:19-25` also accepts any localhost `DB_CHECK_URL`, which could be a developer's real local cluster.
  - Parameterise the app name (`DB_CHECK_APP`, default `stoktok`).
  - Refuse, or use `stoktok_dbcheck`, when the target cluster already has non-system databases.
  - Document it.

**Split the checks.**
- `checks.sql` runs **as the owner login**. It needs no `set local role`, so delete the `set local role service_role` / `reset role` pairs at `checks.sql:245, 256, 267, 279, 291, 303, 320, 345, 360, 520, 565, 641, 732` and the matching `reset role` lines.
  - Rename the labels `service_role_can_read_write*` to `owner_can_read_write*`.
  - Add `expect_fail` checks on the owner login: `create role zz` and `create database zz` both give 42501, and `create extension pgcrypto` fails or is blocked.
  - Add a check that `pg_extension` is exactly `{plpgsql}`.
- A new `checks-acl.sql` runs **as superuser** connected to the app database, because a non-superuser cannot `set role stoktok_nobody`. It carries the nobody and `aclexplode` checks.

**Delete or replace in `checks.sql`:**
- `:186-199` (`rls_enabled_all_tables`, `no_policies`). Replace with assertions that RLS is off on every table (ADR 0010 §7) and that `pg_policies` is empty. An old `enable row level security` line pasted back in would then fail.
- `:201-240` (`no_grants_anon...`, `anon_denied`, `rls_blocks_even_with_grant`) all become `checks-acl.sql`.
- `:675-693` (`ai_functions_locked`): keep the `prosecdef` and `search_path=""` test at :686-692. Replace the role part.
- `:709-723` (`ai_keys_privileges`): remove it entirely, including the `relrowsecurity` assertion at :720-722.
- Keep `:725-768` (`ai_keys_constraints`) with the role switch removed.
- Keep `:770-782` (`ai_key_functions_gone`, empty DEFINER allowlist).
- Update the `tables_exist` list at :34 to add `schema_migrations`, if db:check applies through the runner.

**`aclexplode` gotcha.** `aclexplode(NULL)` returns zero rows, and a NULL ACL on a function, type or database means PUBLIC execute, usage or connect. A naive PUBLIC check therefore passes vacuously. Use `aclexplode(coalesce(acl, acldefault(kind, owner)))`:
- `'r'`/`'S'` for `relacl`, `'f'` for `proacl`, `'T'` for `typacl`;
- `'n'` for `nspacl` on `public` (must have no PUBLIC entry, `app-db.sql:37`);
- `'d'` for `datacl` on the current database (no PUBLIC entry, `app-db.sql:25`).

Assertions for `checks-acl.sql`:
- (a) Every relation, function and type in `public` is owned by the app role.
- (b) No ACL entry has a grantee other than the owner (grantee 0 = PUBLIC counts as a failure). This is the single-owner invariant.
- (c) `pg_default_acl` is empty.
- (d) `stoktok_nobody` has no select/insert/update/delete/truncate on any table, no usage/select/update on any sequence, and no execute on any function (via `has_*_privilege`), no USAGE or CREATE on `public`, and no CONNECT on the database.
- (e) `set local role stoktok_nobody` against every table gives 42501 for select and insert (keep the loop shape of `checks.sql:212-223`).
- (f) The owner's `pg_roles` flags (super, createrole, createdb, replication, bypassrls) are all false. This mirrors `app-db.sql:13`.

### 4. Rollback story under a forward-only migrator
- **Production never runs a down file.** The ticket's pre-migration dump (ticket.md:22) plus the "ahead" rule is the recovery path.
  - `planMigrations` (`migrator.js:43-71`) records the DB as ahead of the image, and `:149-152` logs a warning and applies nothing, so an older image keeps running on a newer schema.
  - The TuDo expand-then-contract rule (`db/migrations/README.md:9-10`) is what makes that safe. Copy it to `db/migrations/README.md`.
  - Fixes go forward as a new file. Never edit an applied file; its checksum is recorded (README:6, `migrator.js:58-60`).
- **Down files are test and dev artefacts**, under `db/rollback/<version>_<name>.down.sql`.
  - They are not read by the runner, are not checksummed, and are not copied into the worker image.
  - They exist so db:check can prove "applies, then drops cleanly, then re-applies".
  - They are not covered by the TuDo "no edits" rule. If an up file's objects change, the matching down must still pass db:check.
  - **db:check asserts one-to-one version parity** between the two directories.
- **Baseline down contents:** drop the functions `ai_reserve` and `ai_month_spend`, then tables in FK order (`ai_summaries` before `ai_usage`, `ai_summaries.usage_id` at `ai_summaries.sql:13`), then the rest. Do not use `drop owned by <role>`: the role owns `public` and the database, so that would also drop the schema.
- **Rollback phase** (replacing `db-check.sh:58-60`): apply the down files in reverse, then drop `schema_migrations` in the harness (the runner recreates it).
  - Assert zero rows in `pg_class`, `pg_proc` and `pg_type` for namespace `public`. `pg_tables` alone misses sequences, functions and types.
  - Assert the roles and the `public` ACL and owner are unchanged.

### 5. Migrate runner (stoktok port)
Deltas to the TuDo runner (`migrator.js`, `migrate.js`):
- **Location.** Code goes in `packages/db/src/pg/migrate.ts`, exported from `@stoktok/db/pg`. The `migrate` subcommand goes in `apps/worker/src/cli.ts`. The worker image's entrypoint is `node dist/cli.js` (`apps/worker/Dockerfile:30`).
- **R3.** The URL must not be read in `migrate.ts`, because R3 and the r3-guard allow `STOKTOK_DATABASE_URL` only in `pg/client.ts`.
  - Export a tiny accessor from `client.ts` (like `createPgDb({ [DATABASE_URL_ENV]: ... })`), or pass the URL into `runMigrations`.
  - Keep exit code 2 for an unset URL, and keep the fixed messages: nothing prints the URL (`migrate.js:28-31`, `migrator.js:118-122`).
- **Connection.** Use one dedicated `pg.Client` with `application_name: stoktok-migrate` (as `migrator.js:109-113`), not `createPgDb`.
  - The pool profiles set 15 s and 120 s statement timeouts, ADR 0010 §3 (0010:11), which is wrong for DDL.
  - A session advisory lock needs a direct session, not PgBouncer.
- **Lock key.** Pick a constant above 2^31, as TuDo does (`LOCK_KEY` at `migrator.js:8`). `ai_reserve` takes `hashtext('stoktok.ai_budget')` (an int4) in `harden.sql:27`, so a key outside int4 range cannot collide.
- **Transaction guard.** Rename the GUC `tudo.migrating` to `stoktok.migrating` (`migrator.js:166, 170-173`).
- **Image.** `apps/worker/Dockerfile:26-28` copies only `dist` and `node_modules`, so add `COPY --from=build /repo/db/migrations ./migrations`.
  - Pass the directory as an argument from `cli.ts`, defaulting to the image path, so tests can override it.
  - `.dockerignore:12` excludes `supabase` already; verify `db/` is not excluded.
- **Line endings.** Add `db/migrations/*.sql text eol=lf` to `.gitattributes`. The checksum normalises CRLF (`migrator.js:33`), but this avoids any doubt.
- **`schema_migrations`** lives in `public` (`migrator.js:139`).
  - It is outside the baseline and outside the schema diff.
  - Add it to the `tables_exist` list and exclude it in the test:db type guard (ADR 0010 §12).
- **Static lint.** Test every file in `db/migrations`, with `--` comments stripped, for: `begin`, `commit`, `rollback`, `grant`, `create role`, `alter role`, `create extension`, `enable row level security`, `vault`, `concurrently`. The runner's guard only catches transaction control at runtime (`migrator.js:168-173`).
- **Tests (R8).**
  - A unit test for `parseMigrationFilename`, `checksum` and `planMigrations` (no DB) in `pnpm test`.
  - Integration tests in `test:db`: idempotent re-run; checksum mismatch exits 1; a failing file rolls back and leaves no `schema_migrations` row; two concurrent runners serialise; the DB-ahead case applies nothing.
- **Drift.** `packages/db/src/pg/schema.ts` is hand-written (ADR 0010:27). Add a `test:db` test comparing its column names and nullability with `information_schema`, so a baseline change cannot silently diverge.

### 6. test:db template switch
Today the template is built as superuser from `bootstrap-roles.sql` plus `supabase/migrations` (`global-setup.ts:77-86`), and test clones connect as the admin superuser (`harness.ts:37-39`). Change both.
- **Role.** Create `stoktok_test_owner` (LOGIN, same NO* attributes as `app-db.sql:13`) idempotently. Guard the race between parallel runs: catch 42710, or take `pg_advisory_lock`. **Never drop it at teardown.** The teardown at `global-setup.ts:57-66` drops only databases; keep it that way.
- **Template.**
  - As admin: `create database tpl owner <role>`, connect to it, then `alter schema public owner to <role>; revoke all on schema public from public;` (the `app-db.sql:35-37` steps).
  - Run `runMigrations` as the owner against `db/migrations`. Close that connection before any clone.
- **Do not run the full `app-db.sql` there.** It revokes on `postgres` and `template1` (see §3), and `test:db` may target a developer's local cluster.
- **Clones:** `create database x template tpl owner <role>`, with the admin connection (superuser) still used for create and drop. `pgDb` then connects with the owner URL (change `withDb` in `harness.ts:12-16` to swap userinfo). Tests thus run without superuser, which today masks missing privileges.
- **Check.** Add an assertion that `schema_migrations` holds exactly the baseline row with the matching checksum.
- **Unverified.** I did not read the `packages/db/test-db/*.test.ts` files. `ai-keys.test.ts` matched my grep and may reference `supabase` or `set role`; the planner should check them.

### 7. CI to PG17
- Change `.github/workflows/ci.yml:25` (`image: postgres:16`) to `postgres:17`.
- Change the `db-check.sh:27` default `PG_BIN=/usr/lib/postgresql/16/bin` to 17, and fix the Postgres 16 mention in `supabase/README.md:10`.
- Assert the major version in db:check (print `server_version_num`). Hard-fail on a mismatch when `CI` is set; warn locally. Cloud and sandbox sessions may only have 16 binaries.
- The GitHub runner's `psql` 16 can run SQL against a 17 server. `pg_dump` 16 refuses to dump a 17 server, so the schema-diff step must run `pg_dump` from a 17 client (`docker exec` into the container, or `postgresql-client-17`). That is another reason it is a recorded one-off and not a CI step.
- The production image is `postgres:17` (`/home/user/deployment/postgres/compose.yml:28`), so the ticket's CI move matches.

### 8. `supabase/` read-only
- **Runners.**
  - Stop globbing `supabase/migrations` and `supabase/rollback` at `db-check.sh:49-50`.
  - Stop reading it at `global-setup.ts:81`.
  - The worker image copies only `db/migrations`.
- **README.** Replace `supabase/README.md` content with a frozen-reference banner. Update its Vault and PG16 notes (`README.md:10,16-17`).
- **Guard test.** Add one in the style of `r3-guard.test.ts` (which already scans the source tree), failing if anything outside `supabase/`, `work/` and `docs/` references `supabase/migrations`.
- **Docs.** `CLAUDE.md` still says "Migrations in `supabase/`" and "Supabase (dedicated project...)". Decide whether STK-083 or STK-084 updates it. At minimum add a pointer to `db/migrations`.

## Recommendations
1. Build the baseline by concatenation. Keep the two `alter table ... add` statements (`data_gaps_resolved_reason.sql:2-5`, `financials.sql:26`) intact so column order and constraint names match. Prove it with the A′-vs-B empty diff and the A-vs-B `ai_keys`-only diff (criteria: scope item "recorded diff", criterion 3).
2. Vendor `app-db.sql` into `scripts/db-check/` and drive db:check from it. Run the migrations as the owner login and `checks.sql` as the owner. Add `checks-acl.sql` for the superuser-side `stoktok_nobody` and `aclexplode(coalesce(acl, acldefault(...)))` checks. Include the database, schema, function and default-ACL cases, not only tables.
3. Rollback: down files live in `db/rollback/`, for test only, with a one-to-one parity check. Production recovery is the pre-migration dump plus the "ahead" rule plus expand/contract.
4. Runner: port `migrator.js` into `packages/db/src/pg/migrate.ts` with a worker `migrate` command. Use a dedicated `Client`, rename the lock key and GUC, keep exit codes 0/1/2, and take the URL through `client.ts` (R3). Add the image `COPY` for `db/migrations`, the static lint, and the unit and integration tests.
5. test:db: owner role plus template database built by the runner. Clone with `owner <role>` and connect as the owner. Do not run the full `app-db.sql` there.
6. CI to PG17, and a PG-major assertion in db:check.
7. Move the old `bootstrap-roles.sql` to `supabase/legacy/` for the one-off proof, and add the `supabase/` reference guard test.

## Risks
- **Vacuous PUBLIC checks.** `aclexplode` on a NULL ACL returns nothing. A check written without `acldefault` passes while PUBLIC still holds EXECUTE on the functions.
- **Wrong column order or names.** A hand-merged baseline changes `attnum` order, which breaks `COPY` without a column list in the STK-084 data move. The schema diff exists to catch it.
- **`app-db.sql` side effects** on `postgres` and `template1` if db:check or test:db is pointed at a developer's local cluster (§3, §6).
- **Same role for app and migrations** means the app can `DROP` and `TRUNCATE`. This is accepted by the ticket (D24 pattern), and the least-privilege runtime role is a follow-up.
- **The proof's side A is not Supabase itself** unless Ming supplies a live dump. It is the repo chain without the `20261111…` file.
- **A concurrent `create role`** in parallel `test:db` runs can fail with 42710 without the guard.
- **Image path:** if the `migrations` directory is not copied into the worker image, the `migrate` service sees "migrations directory not found" and exits 2.
- **PG17 `pg_dump` output** (the `\restrict` lines) breaks a naive diff.

## Open questions
1. Keep `revoke execute ... from public` on `ai_reserve` and `ai_month_spend` in the baseline, or scope the function check to schema USAGE only?
2. Does db:check apply migrations via the Node runner (needs `tsx` or a built worker) or via psql per file, with the runner covered only by test:db? I recommend the runner, but I did not verify what TS tooling `packages/db` already has.
3. Is a vendored `app-db.sql` copy acceptable, or should CI check out the deployment repo? It is private, so the latter needs a token.
4. Is the optional live-Supabase `pg_dump` comparison wanted at all, given Ming has no manual step?
5. Baseline version number: `20261111000200`, or the date of the merge?
6. Which ticket updates the `CLAUDE.md` DB row and Stack table: STK-083 or STK-084?
7. Are PG17 binaries available in the cloud sessions that run db:check?

Files referenced:
- /home/user/stoktok/work/tickets/STK-083/ticket.md
- /home/user/stoktok/docs/adr/0010-self-hosted-postgres-data-layer.md
- /home/user/stoktok/docs/adr/0011-ai-provider-keys-app-side-encryption.md
- /home/user/stoktok/scripts/db-check.sh
- /home/user/stoktok/scripts/db-check/bootstrap-roles.sql
- /home/user/stoktok/scripts/db-check/checks.sql
- /home/user/stoktok/packages/db/test-db/global-setup.ts
- /home/user/stoktok/packages/db/test-db/harness.ts
- /home/user/stoktok/supabase/migrations/20261111000100_ai_keys_app_encryption.sql
- /home/user/stoktok/supabase/migrations/20261110000100_ai_reserve_harden.sql
- /home/user/stoktok/supabase/migrations/20261105000100_data_gaps_resolved_reason.sql
- /home/user/stoktok/supabase/README.md
- /home/user/stoktok/apps/worker/Dockerfile
- /home/user/stoktok/.github/workflows/ci.yml
- /home/user/deployment/postgres/sql/app-db.sql
- /home/user/deployment/postgres/compose.yml
- /home/user/tudocuatui/server/migrator.js
- /home/user/tudocuatui/server/migrate.js
- /home/user/tudocuatui/db/migrations/README.md
