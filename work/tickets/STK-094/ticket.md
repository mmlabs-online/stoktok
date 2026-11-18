# STK-094: Cutover to the shared Postgres (STK-084 slice D)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | db, data, security |
| Attempts | 0 |
| Created | 2026-11-17 |
| PR | — |

## Goal
Split from STK-084 (see work/tickets/STK-084/plan.md "Split proposal" and its consults). Scope: drafts updated to the cutover state; the release-PR commit adds the `migrate` service and switches the health check to `/readyz`; Ming runs the runbook; new AI provider keys entered on Settings, old ones revoked; confirm `ai_keyring_invalid` never appears in logs.

## Spec reference
CLAUDE.md Stack, R3, R5; ADR 0010; work/tickets/STK-084/ticket.md (shared-Postgres standard, Ming's notes). Depends on: STK-091, STK-096, STK-093, and STK-090 per ADR 0010 (unless Ming waives).

## Acceptance criteria
- [ ] The scope above is done as described in STK-084's plan and consults.
- [ ] Nothing applies a migration to the Supabase project; no secret is committed.
- [ ] Repo checks green (stoktok: typecheck, lint, test, test:db, db:check; deployment: its CI).

## Notes / answers from Ming
- 2026-11-17 (orchestrator): created from the STK-084 planner's split proposal.
- 2026-11-18 (orchestrator, from STK-096 security review S6): consider requiring `@sha256:` for `--worker-image` on non-local runs of `scripts/db-migrate-from-supabase.sh` (it receives the target DB password). Plus STK-096 review nits not fixed there (see work/tickets/STK-096/review.md Attempt 1).
- 2026-11-18 (orchestrator, from STK-096 review/security attempt 3; no rework left there): runbook wording in docs/deploy.md "Cutover runbook (STK-096)" — N3: rollback rows should re-freeze per stage 2.3–2.6 (include "no deployment-repo merge"); N4: in the `migrate` failed row, before starting web by hand after `did-not-complete`, check no stoktok container runs and `docker inspect -f '{{.Config.Image}}' stoktok-web` names v0.2.1; the "Scheduler NOT installed" notify suffix breaks the exact "must read" match (say so); work/ming-todo.md item 7 wording (rotation also after an aborted cutover if 0.8 fell back); make the fresh pg-backup dump mandatory in the 14-day row; stage 4.2 dump glob/timestamp check. Update the CLAUDE.md "Current state" line after the cutover.
