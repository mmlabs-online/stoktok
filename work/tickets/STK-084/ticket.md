# STK-084: Move data from Supabase to self-hosted Postgres, cutover, backups and docs (STK-080 slice e)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | db, data, architecture, security |
| Attempts | 0 |
| Created | 2026-11-11 |
| PR | — |

## Goal
Split from STK-080 (see work/tickets/STK-080/plan.md "Split proposal"; consults in work/tickets/STK-080/). Scope:

`scripts/db-migrate-from-supabase.sh`: refuses a non-empty target unless forced; schema from the baseline; `pg_dump --data-only --schema=public --no-owner --no-privileges --exclude-table=public.ai_keys -Fc` over the Supabase direct or session-pooler port 5432 (no `--inserts`); `pg_restore --single-transaction`; `setval` for the 6 identity sequences; per-table count plus ordered md5 verification. Runbook: dry run on a scratch DB, then stop worker → dump → restore → verify → switch `STOKTOK_DATABASE_URL` → start, with Supabase tables kept untouched for a rollback window. Backup note: nightly `pg_dump -Fc` via LaunchAgent, retention, monthly restore test, master key stored apart from dumps. Remove Supabase DB secrets from the deploy tooling and `.env.example` (AUTHEN_* stay). CLAUDE.md Stack (DB row, OrbStack on Intel Mac instead of WSL2), Conventions (secrets); spec §7 diagram, secrets line and risks row (Free pausing accepted, no keep-alive)

## Spec reference
STK-080 ticket ACs: AC6, AC7 (docs). CLAUDE.md Stack, R2, R3, R5, R6, R8; ADR 0010 (from STK-080). Depends on STK-083.

## Acceptance criteria
- [ ] Every item in the scope above is done, meeting the STK-080 ticket ACs listed (AC6, AC7 (docs)) for this slice.
- [ ] Production keeps working after this slice is deployed on its own (strangler path in STK-080 plan.md).
- [ ] `typecheck`, `lint`, `test`, `test:db` and `db:check` green; changed `packages/db` logic has tests.

## Notes / answers from Ming
- 2026-11-11 (orchestrator): split from STK-080 per its plan.md; Ming's decisions are in work/tickets/STK-080/ticket.md (Postgres container on a shared Docker network, squashed baseline, pg + Kysely, accept Supabase Free pausing).
- Ming's manual step: Run the cutover runbook and set up the backup LaunchAgent. Open: backup target and retention (proposed 14 daily + 8 weekly, copied off-host), and how long to keep the Supabase tables after cutover (proposed 14 days).
