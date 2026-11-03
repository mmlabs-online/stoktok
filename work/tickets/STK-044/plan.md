Status: READY

# Plan — STK-044: Run deploy and worker jobs as the runner's real user (mingming)

## Spec summary
docs/spec-v1.md §7 Deployment:
> - Shared deploy repo: Compose definitions + env; deploy jobs on the self-hosted runner on the home server.
> - Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo.
> - `worker` must tolerate restarts: jobs are idempotent and resume from last successful run.

CLAUDE.md R3: "Service role key is server-only." R7: "Stay inside the ticket's plan."

Ticket facts (Ming, 2026-11-03): deploy run 41567381736 failed at `secrets` with `mkdir: /Users/gh-runner: Permission denied`; the runner is `/Users/mingming/actions-runner`; Ming keeps the runner under `mingming` and will not create a `gh-runner` user.

This is a path/user fix. No app code, no `packages/core` change, no change to the deploy flow, the secret handling or the job logic.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | No `gh-runner` user or `/Users/gh-runner` path in `deploy/deployment-repo/`, `docs/deploy.md` or ADR 0003. Env file, scheduler dir and logs are under `/Users/mingming/...`, with one source per path where the tools allow it | `grep -rn 'gh-runner' deploy/deployment-repo docs/deploy.md docs/adr/0003-deploy-and-scheduling.md` returns nothing. `grep -rnoE '/Users/[A-Za-z0-9._-]+' deploy/deployment-repo docs/deploy.md docs/adr/0003-deploy-and-scheduling.md` shows only `/Users/mingming`. Each tool has one literal per path (workflow `env:`, compose `env_file`, plist, script defaults), and the checker (AC4) enforces that they agree |
| 2 | `deploy-stoktok.yml` writes the env file (mode 600, owned by the runner user, outside the checkout). The owner check compares against the runner user, not a hard-coded name. Compose `env_file` matches the workflow path | Read the diff. `ENV_FILE: /Users/mingming/.config/stoktok/stoktok.env`. `umask 077`, `chmod 700` dir and `chmod 600` file are unchanged. Both owner checks still use `$(id -un)` (lines ~129 and ~170, unchanged). A new first guard in `secrets` fails with a clear `::error::` if `$ENV_FILE` is not under `$HOME/`. Both compose `env_file` lines equal `ENV_FILE`, which the existing checker guard confirms |
| 3 | The launchd job runs as `mingming` and reads the scheduler dir the workflow publishes. Runbook commands drop `sudo -u gh-runner` and use the runner user | The plist is a LaunchAgent: no `UserName` key; `ProgramArguments` is `/Users/mingming/stoktok/current/run-schedule.sh` (= `SCHED_DIR` + `/run-schedule.sh`); `HOME`/`PATH`/log paths are under `/Users/mingming`. `docs/deploy.md` One-time setup installs it to `~/Library/LaunchAgents/` with `launchctl bootstrap gui/$(id -u) ...`, without sudo. `grep -n 'sudo -u' docs/deploy.md` returns nothing |
| 4 | `scripts/check-deploy-env.sh` still passes, guards workflow/compose path agreement, and fails if `gh-runner` reappears in the drafts | `pnpm check:deploy-env` prints `OK`. Negative checks, each in a scratch copy (copy `scripts/`, `docs/`, `deploy/`, `.env.example` and `.github/workflows/release.yml` into a temp dir and run `bash <tmp>/scripts/check-deploy-env.sh` there; `ROOT` comes from the script's location). Each must exit 1 with the named FAIL: (a) put `gh-runner` in any draft, `docs/deploy.md` or ADR 0003; (b) change one `/Users/mingming` to `/Users/other` in one draft; (c) change `SCHED_DIR` only; (d) change the `run-job.sh` `LOG_DIR` default only; (e) change one compose `env_file` only (existing guard); (f) change the user that `runner-check.yml` expects only |
| 5 | The matching PR on `mmlabs-online/deployment` is opened. `typecheck`, `lint`, `test` and the deploy checks pass | The orchestrator opens it from the drafts. Its diff equals `deploy/deployment-repo/` file for file (including `runner-check.yml`). `pnpm typecheck && pnpm lint && pnpm test && pnpm check:deploy-env` are green, and stoktok CI is green |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | `ENV_FILE`, `SCHED_DIR` → `/Users/mingming/...`; add the `$HOME` prefix guard as the first lines of the `secrets` run block (after `umask 077`) | AC1, AC2 |
| `deploy/deployment-repo/apps/stoktok/compose.yml` | Header comment (line 15) and both `env_file` lines → `/Users/mingming/.config/stoktok/stoktok.env` | AC1, AC2 |
| `deploy/deployment-repo/apps/stoktok/run-job.sh` | `DIR` and `LOG_DIR` default literals → `/Users/mingming/stoktok/{current,logs}` | AC1, AC3 |
| `deploy/deployment-repo/apps/stoktok/run-schedule.sh` | `LOG_DIR` default literal → `/Users/mingming/stoktok/logs` | AC1, AC3 |
| `deploy/deployment-repo/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist` | Becomes a LaunchAgent: remove the `UserName` key; paths in the comment, `ProgramArguments`, `PATH`, `HOME` and the log paths → `/Users/mingming/...`; the comment says LaunchAgent and that install is in `docs/deploy.md` | AC1, AC3 |
| `deploy/deployment-repo/.github/workflows/runner-check.yml` (**new draft**) | Verbatim copy of deployment `main` `.github/workflows/runner-check.yml`, then: expect `mingming` instead of `gh-runner`, keep the root check, update the header comment, and remove both dead `runner-setup.md` references (point to "the deploy runbook of the app" or drop the pointer) | AC1 (runner identity) and D1 in the runbook depends on it. See R7 note in Approach |
| `deploy/deployment-repo/README.md` | Paths at lines 9 and 24 → `/Users/mingming/...`; add a table row for `.github/workflows/runner-check.yml` (shared by every app; the fix is the runner user only) | AC1, AC5 |
| `docs/deploy.md` | Flow (l.6), placeholder table (l.12), D1 rewrite, D4, One-time setup (steps 1–4, plus a step to remove an earlier LaunchDaemon if one was installed), rotation steps 4–5, release steps 7–8, Logs, Restart check, Exit codes: `/Users/mingming`, no `sudo -u ... -H`, LaunchAgent install | AC1, AC3 |
| `docs/adr/0003-deploy-and-scheduling.md` | Status line adds "amended (STK-044)". Decision bullets: LaunchAgent as runner user, paths under `/Users/mingming`. Add a dated `## Amendment (STK-044, 2026-11-03)` section with the reason. Don't write the literal old user name: say "a dedicated runner user" | AC1 |
| `scripts/check-deploy-env.sh` | Add the new guards (see Approach step 6) | AC4 |
| `work/tickets/STK-044/impl-log.md` | Implementer log | Workflow |

Nothing else. Historical ticket files (STK-037/038/043) keep their `gh-runner` mentions: they are records.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `scripts/check-deploy-env.sh` › positive run (`pnpm check:deploy-env`, also in CI `ci.yml:47`) | AC4: drafts agree |
| Manual negative mutations (a)–(f) from AC4, in a scratch copy; implementer records each command and its FAIL line in `impl-log.md` | AC4: each new guard fires |

No `packages/core` logic changes, so no new Vitest tests (R8: existing `pnpm test` must stay green).

## Approach
1. **Pick one user literal: `mingming`.** Use literals, not `$HOME`, in the workflow `env:`, compose `env_file`, the plist and the script defaults (consult rec. 1). Compose could interpolate `${HOME}`, but the checker would then reject it as an undeclared variable, and a wrong `HOME` would make compose read a different file without any error. Literals fail loudly in the checker. That is the "single source where the tools allow it": one literal per tool, and the checker proves they agree.
2. **Workflow.** Change the two `env:` values. In `secrets`, right after `umask 077`, add:
   `[[ "$ENV_FILE" == "$HOME/"* ]] || { echo "::error::ENV_FILE $ENV_FILE is not under the runner user's home $HOME ($(id -un)). Nothing was started; $ENV_FILE was not changed."; exit 1; }`
   It must not print secrets (it doesn't), and must not use a heredoc or `set -x` (the checker guards this). The owner checks already use `$(id -un)`: no change.
3. **Compose, run-job.sh, run-schedule.sh.** Literal swaps only. Keep the env-overridable `${STOKTOK_DIR:-...}` / `${STOKTOK_LOG_DIR:-...}` form.
4. **Plist → LaunchAgent** (consult rec. 2). The runner on macOS (`svc.sh`) is a LaunchAgent and OrbStack is a per-user app, so docker only exists in Ming's login session. A LaunchDaemon with `UserName mingming` could fire outside the session and fail to reach docker. Remove `UserName` (agents ignore it). Keep `StartCalendarInterval`, which still coalesces after sleep.
5. **Runbook (`docs/deploy.md`).**
   - D1: OrbStack is set to "start at login", and `mingming` is logged in (auto-login after reboot). The runner and the scheduler both run only in that session. Check: after a reboot and auto-login, run `runner-check` and see it green. Remove the "without a GUI login" claim.
   - D4: path `/Users/mingming/.config/stoktok/stoktok.env`, owner `mingming`. Add one line: `tmutil addexclusion ~/.config/stoktok`, and the Time Machine destination must be encrypted (consult risk; the key now sits in the personal home dir).
   - One-time setup:
     - step 1: the check is `ls -l ~/.config/stoktok/stoktok.env` → `-rw------- mingming`;
     - step 2: `install -d -m 755 ~/stoktok/logs`;
     - step 3: if an earlier LaunchDaemon was installed, `sudo launchctl bootout system/online.mmlabs.stoktok.jobs` and remove `/Library/LaunchDaemons/online.mmlabs.stoktok.jobs.plist`. Then `cp` to `~/Library/LaunchAgents/` and `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/online.mmlabs.stoktok.jobs.plist`, verified with `launchctl print gui/$(id -u)/online.mmlabs.stoktok.jobs`;
     - step 4: newsyslog line owner `mingming:staff`.
   - Every `sudo -u gh-runner -H <cmd>` becomes `<cmd>`, run as Ming.
6. **Checker additions** (`scripts/check-deploy-env.sh`, in the existing `fail=1` style):
   - `grep -rn 'gh-runner'` over `deploy/deployment-repo/`, `docs/deploy.md`, `docs/adr/0003-deploy-and-scheduling.md` → FAIL if any match.
   - Collect `/Users/<name>` names from `deploy/deployment-repo/` and `docs/deploy.md`. FAIL unless there is exactly one distinct name. Call it `$RUNNER_USER`.
   - `runner-check.yml` draft must compare against `"$RUNNER_USER"`, e.g. grep for `!= "$RUNNER_USER"`.
   - `SCHED_DIR` (workflow) == the `run-job.sh` `DIR` default == the plist `run-schedule.sh` argument minus `/run-schedule.sh`.
   - The `run-job.sh` `LOG_DIR` default == the `run-schedule.sh` `LOG_DIR` default == the plist `StandardOutPath` dir == the `StandardErrorPath` dir == the `docs/deploy.md` "Log dir" table value.
   - plist has no `UserName` key.
   - `plutil -lint` on the plist only when `command -v plutil` (CI is Linux).
   - Update the header comment to mention STK-044.
   Use only `sed`/`grep`, as the script does now, to keep it portable.
7. **ADR 0003 amendment.** Runner user is `mingming` (Ming, 2026-11-03). The scheduler is a LaunchAgent because the runner and OrbStack are per-session. Consequence: no deploys or jobs without a logged-in session.
8. **Deployment PR.** The orchestrator copies the drafts, including `runner-check.yml`, to `mmlabs-online/deployment`. The PR body lists the planner defaults below for Ming to confirm.

Rules: R3 is kept (the key stays in a host file at mode 600 in a 700 dir, outside the checkout, never printed). R5 doesn't apply (no market rules). R6 is suspended (no auth work). R7: see below. R8: checks green, no core change. R10 is untouched.

**R7 decision: `runner-check.yml` is in this PR (planner default).** The ticket goal is to make "every deploy path … use the runner's real user", and `docs/deploy.md` D1 tells Ming to run `runner-check` and see it green. That cannot pass while the check demands `gh-runner`. The check also fails today for every app on the same runner, so the change is neutral for the others. It is about 6 lines, and it is listed in this plan's file table, so it is inside the plan. The implementer must create the draft from deployment `main` verbatim before editing it, so the PR diff is only the user change and the dead-reference removal. If Ming rejects it in the PR, the orchestrator drops that file, and D1's check changes to "a `deploy-stoktok` `workflow_dispatch` run is green" as a fallback.

## Specialist input used
- consult-software-architect rec. 1 (literals, `$HOME` guard, keep `$(id -un)` checks): **adopted**.
- rec. 2 (LaunchAgent, drop `UserName`, `gui/$(id -u)` bootstrap, D1 login requirement): **adopted as planner default**, for Ming to confirm.
- rec. 3 (runbook without sudo, `mingming:staff` newsyslog): **adopted**.
- rec. 4 (dated ADR amendment): **adopted**, without the literal old name, so AC1's grep stays clean.
- rec. 5 (checker guards): **adopted**, plus the plist `UserName` and `runner-check` user guards.
- rec. 6 (`runner-check.yml`): **adopted in this PR** with a draft copy and dead `runner-setup.md` refs removed; the `RUNNER_USER` repo-variable variant is **rejected** because it is extra operator setup for no gain with one runner.
- Risk "Time Machine": **adopted** as one runbook line in D4.
- Risk "blast radius": **not in diff**. Follow-up (high): restrict `macbook-runner` to `main` deploy workflows (runner group / workflow restriction). Mention it in the PR body.
- Historical ticket files: **left as is** (consult agrees).

## Assumptions
- `mingming` has auto-login (or stays logged in), and OrbStack starts at login. The runner's LaunchAgent already depends on this. Ming confirms in the PR (consult Q2). Non-blocking: if not, the plist change is still correct; only D1's wording changes.
- The OrbStack CLI is at `/Users/mingming/.orbstack/bin` and the docker context works without `DOCKER_HOST` inside the session, as before.
- Ming accepts that his personal account holds the env file and runs CI jobs (his own choice, 2026-11-03). The runner-group restriction stays a follow-up, not a go-live blocker, unless Ming says otherwise in the PR (consult Q4).
- Time Machine exclusion is documented as required. Encryption of the backup disk is Ming's check (consult Q3).
- The stoktok drafts match deployment `main` on every changed line (consult confirmed), so the PR diff is just this change.

## Blocking questions
None.

## Split proposal
None. About 100–150 changed lines.
