# supabase

> **Frozen reference since STK-083.** The schema source is `db/migrations` (squashed baseline). Never edit these files. `test:db` no longer applies them; `db:check` no longer applies them (STK-086); `scripts/schema-diff.sh` uses them for the faithfulness proof.

Database schema for stoktok (dedicated Supabase project, RLS on, server-only access via `service_role`).

## Layout
- `migrations/<timestamp>_<name>.sql` — forward migrations, applied in name order.
- `rollback/<timestamp>_<name>.down.sql` — matching rollbacks. The RLS/grants rollback is intentionally a no-op (reverting revokes would reopen access).

## Checking the schema
`pnpm db:check` checks `db/migrations`, not this directory. See "Checking" in [`db/migrations/README.md`](../db/migrations/README.md).

## Vault
`20261110000200_ai_keys.sql` still requires the `supabase_vault` extension (or the plaintext stub from `supabase/legacy/bootstrap-roles.sql`, used only by `scripts/schema-diff.sh`). `20261111000100_ai_keys_app_encryption.sql` replaces it: AI keys are encrypted app-side and stored as ciphertext ([ADR 0011](../docs/adr/0011-ai-provider-keys-app-side-encryption.md), which supersedes ADR 0009). That migration is **never applied to the Supabase project** (the running release still calls the Vault wrappers it drops) and it refuses a database with a real Vault. It exists for the STK-083 baseline and `scripts/schema-diff.sh`. Rolling back drops `ai_keys` and does not restore the Vault shape.

## No `lots` table
Spec §5 lists `lots`, but lots are derived in `packages/core` (`buildLedger`) from transactions and corporate actions, so they are not stored. A snapshot, if needed, would be a rebuildable cache in its own ticket.
