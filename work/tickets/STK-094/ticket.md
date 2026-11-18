# STK-094: Cutover to the shared Postgres (STK-084 slice D)

| Field | Value |
|---|---|
| State | REVIEW |
| Priority | P1 |
| Areas | db, data, security |
| Attempts | 1 |
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
- 2026-11-18 (orchestrator): all dependencies merged (STK-091 #71, STK-096 #74, STK-093 #73 + deployment#90, STK-090 #75; STK-092 deployment#88). The self-hosted runner is back: deploy-postgres #9 was in progress, deploy-stoktok #10 still queued, when this run started. Consult skipped — STK-084's consults and STK-096's runbook cover this slice. There are 333 commits in v0.2.1..main: the release review is part of this ticket. Cutting the release (pushing `release/vX.Y.Z`) and merging the release PR are outward actions: the orchestrator asks Ming before cutting, and Ming merges.
- 2026-11-18 (orchestrator): R-9 checked via GitHub: no PR (open or closed) exists for deployment branch release/stoktok-v0.2.2, so nothing to close. deploy-postgres #9 (STK-092) ran when the runner came back and FAILED after 10 min (logs not downloadable via API; Ming to check) — the `stoktok` role/DB may not exist yet; runbook stage 0 must see it green before the dry run.
- 2026-11-18 (Ming, after attempt 1 PASS): fix security 🟡1 (step C converts the deployment release PR to draft after the compose commit; Ming marks it ready at runbook stage 4.1; stage 0.3 and ming-todo check "PR is a draft"), 🟡3 (allow-list of keys on the `migrate` block in check-deploy-env.sh + `privileged: true` mutation; anchor the migrate image check — review nit 1), 🟡4 (S6 pins the repository `mingming21400/stoktok-worker:vX.Y.Z@sha256:…` like deploy-stoktok.yml:105; the script's `docker run … migrate` gets `--cap-drop ALL --security-opt no-new-privileges:true`; header comment on the source-local exemption), 🟡5 (assert the S6 message). Also drop the stale ming-todo item about closing a release/stoktok-v0.2.2 PR (none exists — review nit 4). 🟡2 and 🟡6 → STK-097.
- 2026-11-18 (orchestrator): plan.md step C is not edited after the fact; the draft-PR step for step C comes from docs/deploy.md "Cutover release (STK-094)" step 5 and Ming's 🟡1 decision above.
