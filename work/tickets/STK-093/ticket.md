# STK-093: Deployment repo: expand step for stoktok (STK-084 slice C)

| Field | Value |
|---|---|
| State | REVIEW |
| Priority | P1 |
| Areas | db, security, architecture |
| Attempts | 1 |
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
- 2026-11-17 (orchestrator, from STK-084 security review attempt 2 🟡5 and review nits; Ming chose to carry them here): in `scripts/check-deploy-env.sh` pin that the `$pw =~ $re_pw` guard is followed by `exit 1` within a few lines and comes before the `STOKTOK_DATABASE_URL=` line (reuse the master-key awk pattern); use `IFS= read -r pw`; optional: test that a failed `/readyz` result expires after 3 s, `performance.now()` for the memo clock, a short per-query timeout on the ping; a comment that the config guard assumes the `compose` array convention. Also verify the pg-backup paths against the live deployment repo (STK-084 review follow-up).
- 2026-11-17 (orchestrator, from STK-092 security review): STK-093 builds `STOKTOK_DATABASE_URL` from `postgres/secrets/apps/stoktok.password` — give it the same audit (env file mode, no echo of the URL, no `set -x`). If Ming reports the empty `stoktok` dump is ≤ 1 KiB (rclone-sync freshness floor), decide a follow-up here or in STK-094.
- 2026-11-17 (orchestrator): STK-092 merged (deployment#88, stoktok#72); its `deploy-postgres` run was still queued on the self-hosted runner when this ticket started — the `stoktok` role/DB exist on the server only once that run is green (Ming checks). Consult skipped: STK-084's consults (software-architect F1–F7, data-engineer, database-optimizer) were written for this slice. Deployment work goes on a new branch `stoktok/expand-shared-postgres` from origin/main; PR into `mmlabs-online/deployment` (Ming allowed, 2026-11-17).
- 2026-11-18 (Ming, after attempt 1 PASS): fix security 🟡1 (pin umask 077 < mktemp "$dir/… < trap < printf < chmod 600 "$tmp" < mv -f "$tmp" "$ENV_FILE" < stat owner+mode check), 🟡3 (deny bare `set`, `declare -p`, `typeset -p`, `export -p`, `printenv`, `cat` of the env file / `$tmp` / `secrets/`, `docker inspect` without `-f`), 🟡4 (pin `on:` to exactly `push` on main with the apps/stoktok paths + `workflow_dispatch`; reject `pull_request`, `pull_request_target`, `workflow_run`, `schedule`), 🟡5 docs only (after rotating `stoktok.password`, once deploy-postgres is green, run deploy-stoktok via workflow_dispatch on main — Ming chose docs, not `paths:`), 🟡6 (docs: exact `docker inspect -f` network command). Workflow files unchanged unless a pin reveals a real defect. 🟡2 (deployment-side guards) and 🟡7 (stale temp file cleanup) become a follow-up ticket.
