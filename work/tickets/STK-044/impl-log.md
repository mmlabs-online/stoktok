# Impl log — STK-044

## Attempt 1

### Files touched
| File | Change | Required because |
|---|---|---|
| deploy/deployment-repo/.github/workflows/deploy-stoktok.yml | `ENV_FILE`, `SCHED_DIR` to /Users/mingming; `$HOME` prefix guard after `umask 077` | AC1, AC2 |
| deploy/deployment-repo/apps/stoktok/compose.yml | comment + both `env_file` to /Users/mingming | AC1, AC2 |
| deploy/deployment-repo/apps/stoktok/run-job.sh | `DIR`, `LOG_DIR` defaults | AC1, AC3 |
| deploy/deployment-repo/apps/stoktok/run-schedule.sh | `LOG_DIR` default | AC1, AC3 |
| deploy/deployment-repo/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist | LaunchAgent: `UserName` removed, paths, comment | AC1, AC3 |
| deploy/deployment-repo/.github/workflows/runner-check.yml (new) | copy of deployment main; expects `mingming`; dead runner-setup.md refs removed | AC1, runbook D1 |
| deploy/deployment-repo/README.md | paths, runner-check row | AC1, AC5 |
| docs/deploy.md | paths, no sudo -u, D1/D4 rewrite, LaunchAgent install | AC1, AC3 |
| docs/adr/0003-deploy-and-scheduling.md | status, bullets, dated amendment | AC1 |
| scripts/check-deploy-env.sh | new guards (gh-runner, single user, SCHED_DIR, log dir, UserName, runner-check user, plutil) | AC4 |

### Tests added
No Vitest (no core change). Negative mutations, each in a scratch copy, all exit 1:
- (a) `gh-runner` appended to run-schedule.sh and to ADR 0003: `FAIL: gh-runner found in drafts, docs/deploy.md or ADR 0003`
- (b) compose.yml line 15 `/Users/mingming` to `/Users/other`: `FAIL: expected exactly one /Users/<name> in drafts and docs/deploy.md, found: mingming other`
- (c) workflow SCHED_DIR only: `FAIL: scheduler dir differs (...)`
- (d) run-job.sh LOG_DIR default only: `FAIL: log dir differs (...)`
- (e) one compose env_file only: `FAIL: ENV_FILE in workflow differs from env_file in compose`
- (f) runner-check.yml expected user only: `FAIL: runner-check.yml does not expect runner user mingming`

### Checks
- `pnpm typecheck`: web and worker Done, no errors
- `pnpm lint`: web and worker Done, no errors
- `pnpm test`: web 214 passed (214); worker/other packages Done
- `pnpm check:service-key`: OK: no service key material in client bundle
- `pnpm check:deploy-env`: OK: deploy env lists consistent

### Out-of-plan files
None.

### Follow-ups
- High: restrict `macbook-runner` to `main` deploy workflows (runner group / workflow restriction).
- The checker's runner-check guard greps for `!= "<user>"`, not a `$RUNNER_USER` literal.

### Scope self-check
Only plan-listed files changed. No commit made (orchestrator commits). /home/user/deployment not modified; no .env read.

### Deployment PR (for the orchestrator)
Title: `STK-044: run stoktok deploy and scheduler as the runner user mingming`

Body:
- deploy-stoktok failed at `secrets` with `mkdir: /Users/gh-runner: Permission denied` (run 41567381736); the runner is `/Users/mingming/actions-runner`.
- Env file and scheduler dir move to `/Users/mingming/...`; new guard fails early if ENV_FILE is not under `$HOME`; owner checks still use `$(id -un)`.
- Scheduler plist is now a LaunchAgent (no `UserName`), because the runner and OrbStack only exist in the login session.
- `runner-check.yml` now expects `mingming` (it failed for every app on this runner; change is the user and dead runner-setup.md refs only).
- Diff equals `deploy/deployment-repo/` file for file.

Checklist for Ming to confirm:
- [ ] `mingming` auto-logs in after reboot and OrbStack starts at login
- [ ] Remove any earlier LaunchDaemon, install the LaunchAgent (docs/deploy.md One-time setup)
- [ ] Time Machine excludes `~/.config/stoktok`, backup disk encrypted
- [ ] Accept personal account holding the env file; follow-up: restrict runner to main deploy workflows
- [ ] If runner-check.yml is rejected, drop that file and change D1's check to a green deploy-stoktok workflow_dispatch
