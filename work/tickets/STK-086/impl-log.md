## Attempt 1 — 2026-11-11

### Files touched
| File | Required because |
|---|---|
| `scripts/db-check/app-db.sql` | Created with `cp` from `/home/user/deployment/postgres/sql/app-db.sql`; `cmp` exits 0, sha256 `cc8fe942...c321` (criterion 1). |
| `scripts/db-check.sh` | Rewritten (approach steps 1-7): owner-role migrations, URL-mode refusals and cleanup, PG-major rule, parity check, canaries, rollback phase, snapshot. |
| `scripts/db-check/checks.sql` | Runs as owner: role switches removed, `owner_can_*` rename, `rls_disabled_all_tables`, anon/RLS-grant blocks and `ai_keys_privileges` deleted, `ai_functions_locked` owner half, four new owner checks. Also reworded the `ai_key_functions_gone` message ("a Vault wrapper" -> "a key wrapper function") so the criterion 10 grep for "vault" finds nothing. |
| `scripts/db-check/checks-acl.sql` | Created: superuser ACL checks (approach step 5). |
| `supabase/legacy/bootstrap-roles.sql` | Moved from `scripts/db-check/`; only the Vault-stub comment changed. The repo is a git work tree, so `git mv` was used. |
| `scripts/schema-diff.sh` | Line 64 repointed to the new path. |
| `supabase/README.md` | Banner, "Checking the schema" pointer, Vault section path. Also changed the last Vault sentence ("exists for db:check, test:db...") that would otherwise be stale. |
| `db/migrations/README.md` | Dropped "(STK-086)", added the "Checking" section. |

### Tests added / changed
- `checks.sql` › `runs_as_owner`, `owner_role_flags`, `owner_cannot_create_role`, `extensions_plpgsql_only`, `rls_disabled_all_tables` (replaces `rls_enabled_all_tables`); `ai_functions_locked` now asserts the owner can execute. `no_policies` kept; anon/RLS/`ai_keys_privileges` blocks removed.
- `checks-acl.sql` › `acl_runs_as_superuser_in_app_db`, `owned_by_app`, `nobody_table/sequence/function/schema/database_privileges`, `nobody_denied_select_insert`, `acl_owner_only_{relations,columns,functions,types,schema,database}`, `default_acl_empty`, `no_extra_schemas`.
- `db-check.sh` canaries: all 13 kept, each prints `canary <name>: caught`.

### Checks (actual output summary)
Local server is PostgreSQL 16.15 only (no PG17, no Docker), so every run warns "expected 17".
- typecheck: pass (`pnpm typecheck`).
- lint: pass (`pnpm lint`).
- test: pass. core 834, sources 35 (1 file skipped), ai 184, db 115, worker 299 (1 file skipped), web 352.
- format: this repo has no `format` script (`pnpm format` fails "Command not found"), so nothing was run.
- test:db (throwaway PG16 on TCP 127.0.0.1, scram): `Test Files 23 passed (23), Tests 127 passed (127)`.
- `pnpm db:check`, throwaway mode (last run after the final edit): `owner role flags: f|f|f|f|f`, `apply 20261111000200_baseline.sql (as stoktok)`, 13 canaries caught, `after rollback: 0|0|0`, `snapshot unchanged`, `checks (after re-apply)`, `acl checks (after re-apply)`, `db:check OK`, exit 0.
- `CI=true bash scripts/db-check.sh`: `db:check: Postgres major 16, expected 17 (production)`, exit 1.
- `DB_CHECK_URL` mode on a scram TCP cluster (initdb `--auth-local=trust --auth-host=scram-sha-256`):
  - (a) first run `db:check OK`, exit 0 (proves the scram owner-password path);
  - (b) second run `db:check OK` (cleanup worked; afterwards only `postgres template0 template1` databases and role `postgres` remain);
  - (c) extra database: refused, exit 1; (d) role `stoktok` exists: refused, exit 1;
  - (e) `?host=other`: refused, exit 1; (f) `DB_CHECK_APP=Bad-Name`: refused, exit 1;
  - `CI=true` in URL mode: major error, exit 1; `DB_CHECK_APP=other_app`: OK.
  - argv sampled with `ps` during a run (80 samples): no psql command line contained "password" or the 48-hex password.
- `bash scripts/schema-diff.sh`: `owner role flags: f|f|f|f|f`, `after rollback ...: 0|0|0`, `A' vs B: identical`, exit 0.
- Greps: `grep -rniE "vault|supabase/" scripts/db-check.sh scripts/db-check/` empty (after the message rewording); `test ! -e scripts/db-check/bootstrap-roles.sql` true; `grep "Postgres 16\|scripts/db-check/bootstrap" supabase/README.md` empty; `grep -nE "set local role|reset role|service_role|anon|authenticated|ai_keys_privileges|rls_enabled" scripts/db-check/checks.sql` empty.

Negative proofs (scratch copies of scripts/ and db/, deleted):
- Baseline plus `select pg_catalog.pg_read_file('postgresql.conf');`: `ERROR: permission denied for function pg_read_file` while applying as the owner (42501), exit 3.
- Stray `db/rollback/20990101000000_x.down.sql`: parity diff printed, `not one-to-one`, exit 1 before any DB work.
- Baseline plus `alter table public.watchlist enable row level security;`: `CHECK FAILED: rls_disabled_all_tables (1 with RLS)`.
- Canary `no_extra_schemas` renamed to expect `default_acl_empty`: `CHECK FAILED: no_extra_schemas ...`, `canary default_acl_empty failed for another reason`, exit 1.
- Rollback with `drop table public.watchlist;` removed: `after rollback: 2|0|2`, `rollback left objects`, exit 1. (The plan's example line `drop table public.ai_summaries` fails earlier on a dependency error, so a leaf table was used.)
- Down file appended with `grant usage on schema public to public;`: `roles or ACLs changed across the rollback`, before/after snapshots printed, exit 1.

### Out-of-plan files
None. (The extra sentence in `supabase/README.md` and the reworded `ai_key_functions_gone` message are inside plan files.)

### Follow-ups (noticed, not done)
- `nobody_denied_select_insert` does not use `pg_temp.expect_fail`: `stoktok_nobody` has no TEMP right on the database, and access to the `pg_temp` schema requires it, so the loop uses inline `exception when insufficient_privilege`. `checks-acl.sql` therefore has no helper.
- The planner evaluated `has_sequence_privilege` before the `relkind` filter (error on toast tables); it is wrapped in a `case`. Worth knowing for future ACL checks.
- ADR 0011:56 and ADR 0009:29 still name `scripts/db-check/bootstrap-roles.sql` (plan A7).
- If the `server_version_num` query fails (for example an unreachable server), the script dies with a bash arithmetic error rather than a clear message; the exit is still non-zero.
- No `pnpm format` script exists, so the "format" step cannot run here.
- Not verifiable here: the CI run on `postgres:17` (no PG17 binaries). All catalog functions used exist in PG13+.

### Scope self-check
- Could the diff be smaller? No. The bulk is the required rewrite and the new ACL checks file.
- Diff size: tracked files +234 / -146 per `git diff --stat HEAD`, plus new files `app-db.sql` (37 lines, vendored), `checks-acl.sql` (183 lines) and this log. Nothing committed (per instruction).
