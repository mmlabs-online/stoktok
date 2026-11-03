Verdict: PASS
## Attempt 1 — 2026-11-03

### Checks (run by reviewer)
- typecheck: green (web, worker, packages Done, no errors)
- lint: green (eslint web, worker; packages Done)
- test: green. core 494/494, db 117 passed + 1 todo, worker 174/174, web 214/214. Matches impl-log (web 214).
- check:deploy-env: `OK: deploy env lists consistent`
- check:service-key: `OK: no service key material in client bundle`

### Acceptance criteria
- [x] AC1: no `gh-runner` user or path; paths under `/Users/mingming`; one literal per tool. Evidence: `grep -rn gh-runner deploy/deployment-repo docs/deploy.md docs/adr/0003-deploy-and-scheduling.md` returns nothing. `grep -rnoE '/Users/[A-Za-z0-9._-]+'` over the same paths finds only `/Users/mingming`. The checker enforces that they agree (see AC4).
- [x] AC2: env file written by the workflow, owner check uses the runner user. Evidence: `deploy-stoktok.yml:35` `ENV_FILE: /Users/mingming/.config/stoktok/stoktok.env`. `umask 077`, chmod 700/600 unchanged. Owner checks at :130 and :171 compare against `$(id -un)`. New `$HOME/` prefix guard at :104 prints no secret. Both compose `env_file` lines (compose.yml:25, :49) equal ENV_FILE; mutating one makes the checker FAIL.
- [x] AC3: LaunchAgent runs as mingming and reads the published dir; runbook has no `sudo -u`. Evidence: plist has no `UserName` key. Its ProgramArguments is `/Users/mingming/stoktok/current/run-schedule.sh` (= SCHED_DIR + `/run-schedule.sh`), and HOME/PATH/log paths are under `/Users/mingming`. `grep -n 'sudo -u' docs/deploy.md` returns nothing. docs/deploy.md:42 has bootout of the old daemon plus `launchctl bootstrap gui/$(id -u)`.
- [x] AC4: checker still passes, guards path agreement, and fails if `gh-runner` comes back. Evidence: positive run OK. The reviewer re-ran mutations in a scratch copy, and each produced the expected FAIL:
  - `gh-runner` in docs/deploy.md
  - `/Users/other` in the plist (single-user guard and scheduler-dir guard both fire)
  - runner-check user changed
  - SCHED_DIR changed
  - one compose env_file changed
  - `UserName` added to the plist
- [x] AC5: checks are green, and the deployment drafts match deployment `main` (36ed900) on every line except the intended changes. Evidence: `diff` of each draft against /home/user/deployment. `runner-check.yml` differs from main only in the user and the dead `runner-setup.md` references. The orchestrator opens the deployment PR after PASS, using the PR body from impl-log.

### Issues
None.

### Rules R1–R10
No violations found.
- R3 still holds: the key is in a mode-600 file in a 700 dir outside the checkout, and it is never printed.
- R6 is suspended, so it was not checked.
- R7: every changed file is in the plan. The other files in the diff are workflow files: backlog, ticket, plan, consult, impl-log.
- R8: no core change; checks are green.

### Nits (do not block)
- `scripts/check-deploy-env.sh` STK-044 block: with `set -euo pipefail`, if no `/Users/<name>` remains anywhere, the `users=$(grep ...)` line exits 1. The script then stops without the "expected exactly one" FAIL message. It still fails, just with no message.
- `scripts/check-deploy-env.sh:3`: the long header comment line reads awkwardly.

### Follow-ups (out of scope)
- High: restrict `macbook-runner` to the `main` deploy workflows (runner group / workflow restriction), because the runner now runs under Ming's personal account. This is already in the impl-log and the PR body.
- After the merge, Ming checks that auto-login works and OrbStack starts at login (D1), adds the Time Machine exclusion (D4), and removes any old LaunchDaemon.
