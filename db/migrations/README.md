# db/migrations

Plain-Postgres migrations for stoktok (ADR 0010). `20261111000200_baseline.sql` is the squash of the old `supabase/migrations` history.

- Applied by the worker `migrate` command (STK-087) and by `pnpm test:db`. `pnpm db:check` applies them via psql (STK-086).
- Name: `YYYYMMDDHHMMSS_snake_case.sql`. Forward-only: never edit an applied file, add a new one.
- One transaction per file. No `begin`/`commit`, `concurrently`, `create extension`, `grant`, `create role`/`alter role`, RLS, `security definer` or Vault. `packages/db/src/migrations-lint.test.ts` enforces this.
- Every new function needs `revoke execute on function ... from public`.
- Expand, then contract, so the previous image keeps working during a deploy.
- Every file has a matching `db/rollback/<version>_<name>.down.sql`. It is test-only: never shipped, never run in production. Recovery is the pre-migration dump.
- `supabase/` is a frozen reference and is not applied by any runner.
