# STK-096: Cutover runbook in docs/deploy.md (STK-091 split A2b)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | db, data, security |
| Attempts | 0 |
| Created | 2026-11-17 |
| PR | — |

## Goal
Split from STK-091 (see work/tickets/STK-091/plan.md split proposal). Write the full cutover runbook in `docs/deploy.md`, using `scripts/db-migrate-from-supabase.sh` from STK-091: dry run on `stoktok_scratch` (schema check mandatory, D4), freeze web and scheduler on a weekend or outside the 18:30/21:00 Mon–Fri job slots, move, release, verification and smoke list, AI ledger checks and new provider keys (revoke the old ones), rollback per stage, day +14 contract (STK-095).

## Spec reference
CLAUDE.md Stack, R3; ADR 0010; consults in work/tickets/STK-084/ (data-engineer runbook/freeze/smoke/AI-ledger, database-optimizer §1–§11, software-architect R2/R3/R7/R8); STK-084 ticket notes (14-day rollback window with manual re-entry, prefer fix-forward; Supabase tables kept as read-only archive). Depends on: STK-091.

## Acceptance criteria
- [ ] The runbook covers every stage above with commands that match the STK-091 script's real flags and messages.
- [ ] Nothing in it applies a migration to or writes into the Supabase project; no secret in the doc.
- [ ] Checks green (typecheck, lint, test, test:db, db:check, check:deploy-env, test:move).

## Notes / answers from Ming
- 2026-11-17 (orchestrator): created from the STK-091 planner's split proposal.
