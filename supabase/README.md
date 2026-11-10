# supabase

Database schema for stoktok (dedicated Supabase project, RLS on, server-only access via `service_role`).

## Layout
- `migrations/<timestamp>_<name>.sql` — forward migrations, applied in name order.
- `rollback/<timestamp>_<name>.down.sql` — matching rollbacks. The RLS/grants rollback is intentionally a no-op (reverting revokes would reopen access).

## Checking the schema
`pnpm db:check` starts a throwaway Postgres 16 (unix socket only, `PG_BIN` defaults to `/usr/lib/postgresql/16/bin`), applies the migrations, runs `scripts/db-check/checks.sql`, applies the rollbacks and expects 0 tables, re-applies and re-checks. It exits non-zero if no Postgres binaries are found.

Set `DB_CHECK_URL` (host must be `localhost` or `127.0.0.1`) to run against an existing Postgres, for example a CI service container or a local Supabase. It is not part of `pnpm test`.

Optional: `supabase db reset` with the Supabase CLI (needs Docker; there is no `config.toml` yet).

## Vault
`20261110000200_ai_keys.sql` requires the `supabase_vault` extension (it refuses to apply otherwise) and stores AI provider keys there. `pnpm db:check` runs on plain Postgres with a plaintext Vault stub from `scripts/db-check/bootstrap-roles.sql`, so real encryption and privileges are checked only by the manual smoke test in [ADR 0009](../docs/adr/0009-ai-provider-keys-in-vault.md). Rolling back that migration deletes the stored keys.

## No `lots` table
Spec §5 lists `lots`, but lots are derived in `packages/core` (`buildLedger`) from transactions and corporate actions, so they are not stored. A snapshot, if needed, would be a rebuildable cache in its own ticket.
