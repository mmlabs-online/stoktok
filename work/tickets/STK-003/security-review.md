# Security review: STK-003, attempt 1

**Verdict: no 🔴 blocking findings. R3 and AC5 hold.** Every table gets RLS. No policies are created. All anon/authenticated grants on tables and sequences are revoked, and service_role gets only S/I/U/D. No secrets were found. I did not run `pnpm db:check`; this is a read-only review of the code. Two 🟡 items should be fixed before PASS, or logged as follow-ups if the reviewer judges them out of plan.

## Findings

**🟡 1. The `DB_CHECK_URL` localhost guard can be bypassed** (`scripts/db-check.sh:20-24`, CWE-20)
- The sed only extracts the first authority host. libpq still honours query parameters and multi-host lists, so all of these pass as "localhost" but connect elsewhere:
  - `postgresql://localhost/postgres?host=db.<prod>.supabase.co`
  - `...?hostaddr=1.2.3.4`
  - `postgresql://localhost:1,db.prod:5432/postgres` (falls through to the second host)
  - `...?service=prod` (reads `pg_service.conf`)
- Impact: the script would run `bootstrap-roles.sql` against that DB. That script re-grants default privileges to anon/authenticated. It would then run the tables rollback, which is `drop table` on all 7 tables. That is data loss on the real DB.
- This is a guard against a foot-gun, not something an attacker can reach, so 🟡 rather than 🔴. The plan line 49 says "a check never runs drop/rollback against a remote DB", which this code does not deliver.
- Fix, two layers:
  - (a) Refuse a URL that contains `?` or `,`. Also unset `PGSERVICE`, `PGHOST` and `PGHOSTADDR` for the run.
  - (b) After connecting and before bootstrap, assert `select coalesce(host(inet_server_addr()),'local') in ('local','127.0.0.1','::1')`, and abort otherwise. Checking the live connection cannot be bypassed by URL syntax.

**🟡 2. The README does not say that `DB_CHECK_URL` mode is destructive** (`supabase/README.md:12`)
- Against a local Supabase, the script drops the 7 tables, so any local dev data in them is lost.
- It also runs `alter default privileges ... grant all ... to anon, authenticated` (`bootstrap-roles.sql:9-11`). If the run fails between bootstrap and migration 000200, the local stack's default ACL is left open.
- It needs an empty DB anyway: `supabase start` applies migrations, so `apply UP` would fail with "already exists".
- Fix: document "empty, disposable DB only; drops tables; rewrites default privileges". Optionally, refuse when `public` already contains tables before bootstrap.

**🟡 3. Functions: `EXECUTE` stays granted to `PUBLIC`** (`supabase/migrations/20261023000200_v1_rls_grants.sql:19`)
- Postgres grants `EXECUTE` on new functions to `PUBLIC` by default, and anon/authenticated inherit that. Revoking only from anon and authenticated does not remove it.
- No functions exist today. The first `security definer` RPC in a later ticket would be callable through PostgREST with the anon key, and that bypasses RLS.
- The check only covers table and sequence grants (`checks.sql:124-133`).
- Fix:
  - Add `alter default privileges in schema public revoke execute on functions from public;`.
  - Add a check that no `public` function grants EXECUTE to `PUBLIC`/anon/authenticated (`information_schema.routine_privileges`).
  - Add a check that `pg_default_acl` for the migration role gives nothing to anon/authenticated.
- Could be a follow-up under R7, but it is cheap and in scope for AC5 ("no anon/authenticated access").

**💭 4. Gap between the two migrations** (000100 → 000200)
- On hosted Supabase, `db push` runs each file in its own transaction. Between the two commits, the 7 tables exist with Supabase's default anon grants and RLS off. In that window, anyone holding the anon key could insert rows that stay after RLS is turned on.
- Likelihood is negligible: the window is milliseconds and the anon key is never shipped.
- Options: accept the risk and note it, or keep 000200 and also `enable row level security` in the same file as each `create table` from now on. The separate check still catches a table that forgets RLS.

**💭 5. The second check pass does not test the revoke again** (`db-check.sh:58-64`)
- The 000200 rollback is a no-op, so the default-privilege revokes persist after rollback. When 000100 is re-applied, the tables never receive anon grants, so the second run of `checks.sql` does not exercise the revoke.
- The first pass does test it, so this is fine as it stands. Re-running bootstrap before the re-apply would make both passes equivalent.

**💭 6. Script hygiene** (`db-check.sh`)
- Line 42: `-k $TMP` is placed unquoted inside the `-o` string, and pg_ctl runs that string through `/bin/sh`. A `TMPDIR` with spaces or metacharacters breaks it. Under root, that runs as postgres. Only the user can set `TMPDIR`, so no privilege boundary is crossed. Write `-k '$TMP'`.
- Line 17: the trap covers EXIT only. Adding `INT TERM` guarantees that a `trust`-auth server is never left running. Its socket sits in a 0700 mktemp dir, so exposure is small anyway.
- Line 25: `psql "$DB_CHECK_URL"` puts any password in the URL into the process list. Local only; you could suggest `PGPASSWORD`/`.pgpass`.
- The root path is otherwise sound: mktemp dir 0700, `chown postgres`, `runuser -u postgres --`, `listen_addresses=''`, unix socket only, `rm -rf "$TMP"` only when `TMP` is set, no TCP listener.

**💭 7. The anon key has no use in this design**
- R3 says the browser never talks to the DB, so the project's anon key is never needed.
- Recommend for the deploy/auth ticket: don't distribute `SUPABASE_ANON_KEY` to the web app (remove it from `.env.example` unless a consumer appears), and consider removing `public` from the PostgREST exposed schemas in the Supabase dashboard. That would be a third layer on top of the revokes and RLS.

## Verified OK
- **Migration 000200, lines 6-10:** RLS is enabled on exactly the 7 tables. `revoke all ... from anon, authenticated` runs on each. service_role gets least privilege (no TRUNCATE/REFERENCES/TRIGGER). No `create policy` anywhere.
- **Migration 000200, lines 14-15:** sequences are revoked from anon/authenticated and granted to service_role.
- **Not using `force row level security`:** correct. service_role has BYPASSRLS anyway, and the table owner needs access for migrations.
- **`checks.sql:109-174`:**
  - RLS is checked on all `public` tables, not a hardcoded list, so future tables are caught.
  - It asserts 0 policies and 0 table/sequence grants to anon/authenticated/PUBLIC.
  - Behavioural checks expect 42501 for select and insert as anon and authenticated.
  - The RLS-only layer is tested with a temporary grant inside a rolled-back sub-block.
  - service_role read/write works.
  - Everything is wrapped in `begin`…`rollback`.
- **Rollbacks:** the 000200 rollback is a deliberate no-op (`rollback/20261023000200_v1_rls_grants.down.sql:1-2`), so a rollback cannot reopen access. The tables rollback is a plain drop of the 7 tables. Because the default-ACL revokes persist, recreated tables get no anon grants even before RLS is re-enabled. I found no rollback that reopens access.
- **Bootstrap:** `bootstrap-roles.sql` is used only by the check script and never as a migration. It creates the roles idempotently.
- **Secrets:** none in the migrations, scripts, README, `package.json` or `packages/core/src/db/*`.
  - `.env.example` holds key names only.
  - The `postgres:postgres` example URL appears only in `plan.md`. It is the well-known local Supabase default, not a secret.
  - The mappers read no env and write no secrets into error messages.
- **`package.json:13`:** `db:check` is just `bash scripts/db-check.sh`, with no extra surface.

## Recommendations
1. Harden the `DB_CHECK_URL` guard (finding 1). Ties to AC6 and plan line 49.
2. Add the destructive-mode warning to the README (finding 2). Ties to AC6 "documented".
3. Revoke function EXECUTE from `PUBLIC` and add the routine/default-ACL checks (finding 3). Ties to AC5 and R3. Put it in the follow-ups if the reviewer rules it beyond the plan.
4. Follow-ups: one-file `create table` + `enable rls` convention (finding 4); drop the anon key and the exposed `public` schema (finding 7); add `db:check` and a secret scan to CI when the CI ticket lands.

## Risks
- If a later ticket adds a `security definer` function before finding 3 is fixed, it opens an anon-reachable bypass of RLS.
- Running `db:check` against a stack that is not disposable can drop real tables and re-grant default privileges (findings 1 and 2).

## Open questions
- Will the deploy flow apply migrations with `supabase db push` (one transaction per file) or as one combined transaction? This decides finding 4.
- Is the anon key needed by any consumer at all? If not, stop distributing it.
