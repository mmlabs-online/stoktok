# STK-086 review

## Attempt 1 — 2026-11-11
Verdict: REWORK

Reviewed commit 4c2a96d. HEAD is now 7dbc634, which adds only `security-review.md`. Local server: PostgreSQL 16.15 only (no PG17, no Docker).

### Checks (run by reviewer)
- typecheck: pass (`pnpm typecheck`, exit 0).
- lint: pass (`pnpm lint`, exit 0).
- test: pass. core 834, sources 35 (1 file skipped), ai 184, db 115, worker 299 (1 file skipped), web 352. Matches impl-log.
- format: the repo has no `format`/`format:check` script, so there is nothing to run.
- test:db: ran on a throwaway PG16 TCP cluster with scram (`initdb --auth-local=trust --auth-host=scram-sha-256`, 127.0.0.1:55433). Result: `Test Files 23 passed (23)`, `Tests 127 passed (127)`. Afterwards only `postgres`/`template0`/`template1` and role `postgres` remained, so CI's following db:check will not hit the non-system-database refusal.
- `pnpm db:check` (throwaway mode): exit 0. Output: `WARNING: Postgres major 16, expected 17`, `owner role flags: f|f|f|f|f`, `apply 20261111000200_baseline.sql (as stoktok)`, 13 × `canary <name>: caught`, `after rollback: 0|0|0`, `snapshot unchanged`, `checks (after re-apply)`, `acl checks (after re-apply)`, `db:check OK`.
- `CI=true pnpm db:check`: exit 1 with `db:check: Postgres major 16, expected 17 (production)`.
- URL mode on the scram TCP cluster:
  - run 1 `db:check OK`, exit 0;
  - run 2 `db:check OK`, exit 0;
  - afterwards only the system databases and role `postgres` remained. `datacl` of `postgres` and `template1` lost PUBLIC, the documented D4 side effect.
  - `CI=true` in URL mode: exit 1 (major).
- URL-mode refusals, all exit 1 with nothing created:
  - an extra database;
  - role `stoktok`;
  - role `stoktok_nobody`;
  - `?host=other`;
  - `?sslmode=disable&port=1`;
  - `DB_CHECK_APP=Bad-Name`;
  - host `example.com`.

  The pre-existing role was not dropped by the trap (correct, because `CREATED=0`).
- `bash scripts/schema-diff.sh`: exit 0. Output: `owner role flags: f|f|f|f|f`, `after rollback …: 0|0|0`, `A' vs B: identical`.
- `cmp scripts/db-check/app-db.sql /home/user/deployment/postgres/sql/app-db.sql`: exit 0. sha256 `cc8fe942…c321` equals the header (`db-check.sh:9`). Deployment HEAD `9bfc613…` equals the header commit (`:10`).
- Negative proofs, each on a scratch copy of `scripts/` and `db/` (all deleted afterwards):
  - N1: baseline + `alter table public.watchlist enable row level security;` → `CHECK FAILED: rls_disabled_all_tables (1 with RLS)`, exit 3.
  - N2: canary `no_extra_schemas` relabelled `default_acl_empty` → `CHECK FAILED: no_extra_schemas …`, `canary default_acl_empty failed for another reason`, exit 1.
  - N3: `drop table public.watchlist` removed from the down file → `after rollback: 2|0|2`, `rollback left objects`, exit 1.
  - N4: baseline + `select pg_catalog.pg_read_file('postgresql.conf');` → `permission denied for function pg_read_file` (the owner, not a superuser, applies the file), exit 3.
  - N5: stray `db/rollback/20990101000000_x.down.sql` → parity diff `> 20990101000000_x`, `not one-to-one`, exit 1 before any DB work.
  - N6: canary SQL replaced by `select 1` → `canary no_extra_schemas was not caught`, exit 1.

### Acceptance criteria
- [x] 1 Vendored `app-db.sql` byte-identical, provenance in the header. Evidence: `cmp` exit 0; sha256 and commit match `db-check.sh:8-11`.
- [x] 2 Password only via stdin `\set` and per-command `PGPASSWORD`. Evidence: `db-check.sh:35,66,90,150`; no `-v password`, `set -x`, `-e` or `-a`. The scram owner login works in URL mode.
- [x] 3 Migrations run as the owner with `--single-transaction`; names validated; one-to-one parity. Evidence: `apply … (as stoktok)`, flags `f|f|f|f|f`, `checks.sql › runs_as_owner`, N4, N5.
- [x] 4 `PG_BIN` default 17 → 16 → `pg_config`; major rule. Evidence: `db-check.sh:68-79,96-104`; local WARNING + OK; `CI=true` exit 1 in both modes.
- [ ] 5 URL-mode safety: FAILED, see Issue 1. The ticket requires a refusal "when … the role/db already exists"; a system-database name passes. Cases (a)–(f) of the plan pass.
- [x] 6 `checks.sql` owner rewrite. Evidence: the plan's grep finds nothing; four new checks at `checks.sql:30-56`; `rls_disabled_all_tables` and N1; `ai_functions_locked` has the owner half; `ai_keys_privileges` is removed.
- [x] 7 `checks-acl.sql` assertions. Evidence: read `checks-acl.sql`; every `aclexplode` uses `coalesce(…, acldefault(…))` except `attacl` (`:121`, correct); guards at `:21,43,61,101,111,133,144,155,166`.
- [x] 8 Canaries: 13 run, each caught by its own named check, none committed. Evidence: the db:check output plus N2 and N6.
- [x] 9 Rollback phase. Evidence: `after rollback: 0|0|0`, `snapshot unchanged`, re-apply and re-check; N3.
- [x] 10 Vault stub out of db:check. Evidence: `test ! -e scripts/db-check/bootstrap-roles.sql`; `grep -rniE "vault|supabase/" scripts/db-check.sh scripts/db-check/` is empty; schema-diff is identical.
- [x] 11 Docs. Evidence: `grep "Postgres 16\|scripts/db-check/bootstrap" supabase/README.md` is empty; `db/migrations/README.md:12-18` has the Checking section.
- [x] 12 No release and nothing under `apps/`, `packages/`, `.github/` or `package.json`. Evidence: `git diff --name-only 8340406 4c2a96d`.
- [x] 13 All five checks green locally, and schema-diff passes. CI on PG17 is pending (see below).

### Issues
#### Issue 1 — 🔴 blocker — URL mode corrupts a system database when `DB_CHECK_APP` names one
- **Where**: `scripts/db-check.sh:31` (name check) and `:139-145` (refusal).
- **Expected**: the ticket Goal says "refuse when any non-system database exists or the role/db already exists". `DB_CHECK_APP=template1` (or `postgres` / `template0`) must be refused before anything is created.
- **Actual**: reproduced on a throwaway scram cluster. `DB_CHECK_URL=… DB_CHECK_APP=template1 bash scripts/db-check.sh` exits 0 with `db:check OK`, then prints `WARNING could not drop database template1` and `WARNING could not drop role template1`. Afterwards:
  - `template1` is owned by a new login role `template1`;
  - `template1` holds 61 `pg_class` rows of the stoktok schema in `public`, so every later `createdb` on that cluster inherits them.

  The database refusal excludes exactly the system names, and the role refusal only checks `pg_roles`. `DB_CHECK_APP=postgres` is likewise accepted on a cluster whose superuser is not named `postgres`.
- **Fix instruction**:
  - At `:31`, after the regex check, reject `postgres`, `template0`, `template1` and any name starting with `pg_` (exit 1, fixed message).
  - At `:140`, also count `pg_database` rows where `datname = '$APP'`, and include that count in the refusal.
  - Re-run the refusal set plus `DB_CHECK_APP=template1` and `DB_CHECK_APP=postgres`: both must exit 1 with nothing changed. Record this in impl-log.

#### Issue 2 — 🟡 should-fix — the refusal message can print the full `DB_CHECK_URL`, password included
- **Where**: `scripts/db-check.sh:52-55`.
- **Expected**: plan Rules R3: "nothing prints `DB_CHECK_URL`".
- **Actual**: when the sed does not match, it returns its whole input. Reproduced: `DB_CHECK_URL=POSTGRESQL://postgres:<pw>@127.0.0.1:55433/postgres` prints `db:check refuses non-local DB_CHECK_URL host 'POSTGRESQL://postgres:<pw>@…'`. A keyword/value conninfo string does the same.
- **Fix instruction**: use `sed -nE 's#…#\2#p'` so a non-match yields an empty host, which is refused. Change the message to a fixed text without `$host` (e.g. `db:check refuses DB_CHECK_URL: host must be localhost or 127.0.0.1`).

#### Issue 3 — 🟡 should-fix — the D5 localhost guard is bypassable
- **Where**: `scripts/db-check.sh:52-62`, and the PG env for both modes.
- **Expected**: plan D5: refuse anything that lets libpq connect somewhere other than the parsed local host/port, as `checkAdminUrl` does. `checkAdminUrl` decodes query keys via `URL.searchParams`.
- **Actual**: three ways through.
  - **Percent-encoded keys.** libpq decodes them; verified with `psql "postgresql://…@127.0.0.1:1/postgres?%70ort=55433"`, which connected to port 55433. Through db-check.sh, the superuser bootstrap ran against the overridden target, and only the owner step failed. The same works with `?%68ost=<remote>`.
  - **Multi-host authority.** `localhost:5432,remote:5432` parses as host `localhost`.
  - **`PGHOSTADDR` / `PGSERVICE` in the environment.** These are not cleared.
- **Fix instruction**:
  - Require the whole authority to match `^([^@/]*@)?(localhost|127\.0\.0\.1)(:[0-9]+)?$`.
  - Refuse a query string containing `%` or a `host`, `hostaddr`, `port` or `service` key.
  - `unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGDATABASE PGUSER PGOPTIONS` near the top of the script, before either mode.
  - Add these cases to the impl-log refusal list.

### CI on postgres:17: assessment
Likely to pass once Issue 1 is fixed (the fix does not touch the CI path). Reasoning:
- With `CI=true` the major check expects 17, which `postgres:17` provides.
- The image's `pg_hba` uses scram for TCP. The owner login with `PGPASSWORD` over TCP+scram is proven here on 16, and the auth path is the same on 17.
- `test:db` leaves no non-system database or refused role (verified), so the refusal will not trip.
- The runner's `psql` (16 on ubuntu-24.04) is already used by the current CI db:check against 17. It runs non-interactive (`-X -q`, `-c`/`-f`), and `\connect :"app"` reuses the URI params, which was verified in URL mode here with the same client major.
- `acldefault`, `aclexplode`, `has_*_privilege`, `drop database … with (force)`, `set local role` in DO, and the default `public` schema ACL model (pg_database_owner, PG15+) are unchanged in 17.

Version-specific notes:
- PG17 adds the table privilege `MAINTAIN`. `nobody_table_privileges` (`checks-acl.sql:39`) does not list it, and adding it would break PG16 local runs. A `GRANT MAINTAIN` to PUBLIC or to any role is still caught by `acl_owner_only_relations` (owner-only `aclexplode`), so there is no gap.
- In PG17 the owner's `acldefault('r')` gains `m`. That entry is the owner's, so the owner-only rule is unaffected.
- Only the CI run itself proves 17. Every proof above ran on 16.15.

### Rules R1–R10
- R3: Issue 2 (plan-level "nothing prints `DB_CHECK_URL`"). App DB credentials are not touched. The generated owner password stays out of argv (`db-check.sh:66,90,150`).
- R7: within the plan. The extra `supabase/README.md` sentence and the reworded `ai_key_functions_gone` message are inside planned files and justified in impl-log. The `work/` changes are orchestrator files.
- R8: the canaries and negative proofs give the new SQL checks real coverage.
- No other violations found.

### Nits (do not block)
- `checks-acl.sql:84,92` hard-codes `stoktok_nobody` instead of `current_setting('dbcheck.nobody')`.
- `db-check.sh:97`: an unreachable server ends in a bash arithmetic error, not a clear message (noted in impl-log).
- `nobody_sequence_privileges` (`checks-acl.sql:47-54`) has no row-count guard. The baseline has identity sequences, so `n >= 1` would make it non-vacuous.
- `nobody_denied_select_insert` mostly re-proves `nobody_schema_privileges`, because nobody lacks USAGE on `public`.

### Follow-ups (out of scope)
- Role-membership check (`pg_auth_members` empty for `$APP`/`$NOBODY`, including `pg_read_server_files` etc.) and memberships in the snapshot (security review rec. 4).
- Optionally restore PUBLIC CONNECT/TEMPORARY on `postgres`/`template1` in the URL-mode cleanup when it was the default before (rec. 5).
- Keep the superuser password out of psql argv in URL mode (`PGPASSWORD` instead of a URL with a password) (rec. 6).
- Check whether the deployment repo's `add-app-db.sh` / `10-app-dbs.sh` reject system names (same class as Issue 1).
- ADR 0011:56 and ADR 0009:29 still name `scripts/db-check/bootstrap-roles.sql` (plan A7).
- Large-object ACLs (`pg_largeobject_metadata.lomacl`) are not covered by `checks-acl.sql`.
