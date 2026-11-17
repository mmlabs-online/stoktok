# STK-092: Deployment repo: register stoktok on the shared Postgres (STK-084 slice B)

| Field | Value |
|---|---|
| State | DONE |
| Priority | P1 |
| Areas | db, security |
| Attempts | 0 |
| Created | 2026-11-17 |
| PR | — |

## Goal
Split from STK-084 (see work/tickets/STK-084/plan.md "Split proposal" and its consults). Scope: deployment repo PR: `bash postgres/scripts/add-app-db.sh stoktok` (role + DB + password file + config/databases entry); after Ming merges, run `/backup.sh` and `restore-test.sh stoktok` once. Orchestrator may open the PR (Ming, 2026-11-17).

## Spec reference
CLAUDE.md Stack, R3, R5; ADR 0010; work/tickets/STK-084/ticket.md (shared-Postgres standard, Ming's notes). Depends on: nothing.

## Acceptance criteria
- [ ] The scope above is done as described in STK-084's plan and consults.
- [ ] Nothing applies a migration to the Supabase project; no secret is committed.
- [ ] Repo checks green (stoktok: typecheck, lint, test, test:db, db:check; deployment: its CI).

## Notes / answers from Ming
- 2026-11-17 (orchestrator): created from the STK-084 planner's split proposal.
- 2026-11-17 (orchestrator): consult skipped — STK-084's consults already cover this step (database-optimizer backups §, software-architect B slice) and it follows the TuDoCuaTui precedent in the deployment repo (commit 282e955 / PR #38, branch `postgres/add-tudocuatui`). Work happens in `/home/user/deployment` on a new branch `postgres/add-stoktok`; the PR goes to `mmlabs-online/deployment` (Ming allowed, 2026-11-17).
