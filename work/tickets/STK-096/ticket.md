# STK-096: Cutover runbook in docs/deploy.md (STK-091 split A2b)

| Field | Value |
|---|---|
| State | REVIEW |
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
- 2026-11-17 (Ming, via STK-091): include in the runbook/scope: rotate the Supabase DB password after a successful cutover; pin `PG_CLIENT_IMAGE` by digest (STK-091 security F4); optional TLS `verify-full` with a mounted Supabase root cert (F7). Also from STK-091 review: Ming verifies the dry run against live Supabase (pooler reachability from OrbStack, schema-check result, bind-mount permissions), the `--worker-image` leg with a real release image, and one run under macOS `/bin/bash` 3.2.
- 2026-11-17 (orchestrator, from STK-091 review attempt 3 and security review attempt 3; no rework left on STK-091): make `t_column_pipe_newline` a real regression test (rename to `"a|b<LF>c|d"`, which the attempt-2 code let through; add a case with an extra source table `zzz`; make it self-contained instead of depending on `t_column_pipe`); reword docs/deploy.md:118 so "read-only transaction" clearly refers to the verify step; runbook: run the script inside `tmux`/`screen`; keep `~/srv/backups/stoktok-cutover` out of any offsite/Time Machine sync.
- 2026-11-18 (orchestrator): consult skipped — the runbook content comes from STK-084's consults (data-engineer runbook/freeze/smoke/AI-ledger, database-optimizer §1–§11, software-architect R2/R3/R7/R8), written for this. STK-091, STK-092 and STK-093 are merged (deployment#88, #90); their deploy runs were queued on the offline self-hosted runner — the runbook states them as preconditions. Ming's manual checklist is in work/ming-todo.md "Move to the shared Postgres"; the runbook must match it.
