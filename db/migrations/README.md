# db/migrations

Plain-Postgres migrations for stoktok (ADR 0010). `20261111000200_baseline.sql` is the squash of the old `supabase/` migration history.

- Applied by the worker `migrate` command (STK-089) through the runner `packages/db/src/pg/migrate.ts` (`public.schema_migrations`, sha256 checksums with CRLF normalised, advisory lock, one transaction per file), and by `pnpm test:db`, which builds its template with the same runner. `pnpm db:check` applies them via psql.
- Name: `YYYYMMDDHHMMSS_snake_case.sql`. Forward-only: never edit an applied file, add a new one.
- One transaction per file. No `begin`/`commit`, `concurrently`, `create extension`, `grant`, `create role`/`alter role`, RLS, `security definer` or Vault. `packages/db/src/migrations-lint.test.ts` enforces this.
- No block comments (`/* */`); use `--`. The lint rejects any `/*`.
- Every new function needs `revoke execute on function ... from public`.
- Expand, then contract, so the previous image keeps working during a deploy.
- Every file has a matching `db/rollback/<version>_<name>.down.sql`. It is test-only: never shipped, never run in production. Recovery is the pre-migration dump.
- `supabase/` is a frozen reference and is not applied by any runner.

## Checking (`pnpm db:check`)
- Starts a throwaway Postgres (unix socket; `PG_BIN` defaults to 17, then 16) or uses `DB_CHECK_URL` (localhost only). The server major must be 17: a mismatch fails when `CI` is set and warns otherwise.
- Bootstraps role and database with the vendored `scripts/db-check/app-db.sql` (the deployment repo's file, byte-identical), then applies the migrations as the non-superuser owner, one transaction per file, and runs `scripts/db-check/checks.sql` as the owner.
- `scripts/db-check/checks-acl.sql` runs as superuser: owner-only ACLs everywhere, nothing for `stoktok_nobody`, no default ACLs. db:check injects 13 violations to prove each check fires.
- Then applies the rollbacks in reverse (they must match the migrations one-to-one), expects `public` empty and roles/ACLs unchanged, re-applies and re-checks.
- `DB_CHECK_URL` mode: use a **throwaway server only**. It refuses if any database besides `postgres`/`template0`/`template1` or the role `DB_CHECK_APP` (default `stoktok`), `stoktok_nobody` or `dbcheck_canary` exists, and drops what it created on exit. `app-db.sql` also revokes CONNECT/TEMPORARY from PUBLIC on `postgres` and `template1`; that is not undone.
