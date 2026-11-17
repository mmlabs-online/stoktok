# STK-091: Data-move script and cutover runbook (STK-084 slice A2)

| Field | Value |
|---|---|
| State | REWORK |
| Priority | P1 |
| Areas | db, data, security |
| Attempts | 2 |
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
- 2026-11-17 (Ming, after attempt 1 PASS): (1) fix before the PR: security F1 (correct plan/docs wording: the migrate container gets the URL in its env, visible to `docker inspect` for its lifetime, like the worker), F2 (`trap 'exit 129' HUP` + docs note on checking/removing a leftover `tmp.*/pgpass` after a killed run), F3 (target-side verify SQL in a read-only transaction; reject `|`/newline in source column lists), F5 (dump chmod 600; remove the dump in cleanup on a failed dry run without `--keep-dump`), F6 (refuse target host:port equal to source host:port), nits (LC_ALL=C / COLLATE "C" on both sides of the TOC sort; numeric check of `$mx` before setval; assert the 6 identity sequences; docs drift wording). F4 (pin client image by digest) and F7 (TLS verify-full with a root cert) go to STK-096. (2) Read-only SELECTs on Supabase inside read-only transactions are approved (plan S1). (3) Rotate the Supabase DB password after a successful cutover — a step in the STK-096 runbook.
- 2026-11-17 (orchestrator): attempt 2 review = REWORK (F3 bypass via a column name with `|` and a newline). Last allowed rework (attempt 3). The plan.md:136 wording ("passwords never in container env") is superseded by plan S2 and docs/deploy.md (Ming's F1 decision); plan.md is not edited after the fact.
