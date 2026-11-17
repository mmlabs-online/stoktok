# STK-095: Contract after the 14-day rollback window (STK-084 slice E)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | security |
| Attempts | 0 |
| Created | 2026-11-17 |
| PR | — |

## Goal
Split from STK-084 (see work/tickets/STK-084/plan.md "Split proposal" and its consults). Scope: drop `SUPABASE_*` DB values from the env file and workflow, delete the secrets, delete the `stoktok_ai_key_%` Vault rows; keep the Supabase `public` tables as a read-only archive (Ming, 2026-11-17).

## Spec reference
CLAUDE.md Stack, R3, R5; ADR 0010; work/tickets/STK-084/ticket.md (shared-Postgres standard, Ming's notes). Depends on: STK-094 plus 14 days.

## Acceptance criteria
- [ ] The scope above is done as described in STK-084's plan and consults.
- [ ] Nothing applies a migration to the Supabase project; no secret is committed.
- [ ] Repo checks green (stoktok: typecheck, lint, test, test:db, db:check; deployment: its CI).

## Notes / answers from Ming
- 2026-11-17 (orchestrator): created from the STK-084 planner's split proposal.
