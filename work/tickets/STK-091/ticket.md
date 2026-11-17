# STK-091: Data-move script and cutover runbook (STK-084 slice A2)

| Field | Value |
|---|---|
| State | REVIEW |
| Priority | P1 |
| Areas | db, data, security |
| Attempts | 0 |
| Created | 2026-11-17 |
| PR | — |

## Goal
Split from STK-084 (see work/tickets/STK-084/plan.md "Split proposal" and its consults). Scope: stoktok: `scripts/db-migrate-from-supabase.sh` and the cutover runbook in docs/deploy.md, per the consults in work/tickets/STK-084/ and plan.md decision D4 (schema-diff mandatory in the dry run, informational at the real cutover).

## Spec reference
CLAUDE.md Stack, R3, R5; ADR 0010; work/tickets/STK-084/ticket.md (shared-Postgres standard, Ming's notes). Depends on: STK-084.

## Acceptance criteria
- [ ] The scope above is done as described in STK-084's plan and consults.
- [ ] Nothing applies a migration to the Supabase project; no secret is committed.
- [ ] Repo checks green (stoktok: typecheck, lint, test, test:db, db:check; deployment: its CI).

## Notes / answers from Ming
- 2026-11-17 (orchestrator): created from the STK-084 planner's split proposal.
- 2026-11-17 (orchestrator): consult step reuses STK-084's consults (work/tickets/STK-084/consult-database-optimizer.md §1–§11, consult-data-engineer.md runbook/freeze/smoke/AI-ledger, consult-software-architect.md R2/R3/R7/R8), which were written for exactly this slice; plan decisions D4 (schema check mandatory in the dry run) and the A2 row of STK-084/plan.md apply. PR #70 (STK-084 A1) merged.
