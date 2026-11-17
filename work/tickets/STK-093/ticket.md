# STK-093: Deployment repo: expand step for stoktok (STK-084 slice C)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | db, security, architecture |
| Attempts | 0 |
| Created | 2026-11-17 |
| PR | — |

## Goal
Split from STK-084 (see work/tickets/STK-084/plan.md "Split proposal" and its consults). Scope: deployment repo PR: copy the reviewed `deploy/deployment-repo/` drafts from STK-084 verbatim (networks, env file with STOKTOK_DATABASE_URL + master key while keeping SUPABASE_*, mode 0600). The PR body must say it also ships the STK-072 AI-key env lines that never reached the live workflow (both optional).

## Spec reference
CLAUDE.md Stack, R3, R5; ADR 0010; work/tickets/STK-084/ticket.md (shared-Postgres standard, Ming's notes). Depends on: STK-084 and STK-092 merged.

## Acceptance criteria
- [ ] The scope above is done as described in STK-084's plan and consults.
- [ ] Nothing applies a migration to the Supabase project; no secret is committed.
- [ ] Repo checks green (stoktok: typecheck, lint, test, test:db, db:check; deployment: its CI).

## Notes / answers from Ming
- 2026-11-17 (orchestrator): created from the STK-084 planner's split proposal.
