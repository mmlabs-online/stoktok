## Findings

**Every place `gh-runner` / `/Users/gh-runner` is assumed** (the stoktok drafts match deployment `main` byte for byte on these lines):

- `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml:35-36`: `ENV_FILE`, `SCHED_DIR`. The owner checks at :129 and :170 already compare against `$(id -un)`, so they need no change.
- `deploy/deployment-repo/apps/stoktok/compose.yml:15` (comment), `:25` and `:49` (`env_file`).
- `deploy/deployment-repo/apps/stoktok/run-job.sh:13-14`: `DIR` and `LOG_DIR` defaults.
- `deploy/deployment-repo/apps/stoktok/run-schedule.sh:7`: `LOG_DIR` default.
- `deploy/deployment-repo/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist`:
  - `:6`: comment with the `DOCKER_HOST` socket path.
  - `:10`: `UserName gh-runner`.
  - `:14`: ProgramArguments script path.
  - `:18`: `PATH` (`.orbstack/bin`).
  - `:19`: `HOME`.
  - `:74-75`: log paths.
- `deploy/deployment-repo/README.md:9` and `:24`.
- `docs/deploy.md`:
  - `:6`, `:12`, `:18` (D1), `:21` (D4), `:40-43` (one-time setup, including the LaunchDaemon install at `:42`).
  - `:49-50`, `:60-61`, `:76-77`, `:101-102`, `:108`: the `sudo -u gh-runner -H` commands and log paths.
- `docs/adr/0003-deploy-and-scheduling.md:12-14`: "LaunchDaemon (user `gh-runner`)", the env path and the scheduler path.
- `scripts/check-deploy-env.sh`: no `gh-runner` today. Its only path guard is ENV_FILE (workflow) == `env_file` (compose) at `:97-102`. Nothing checks `SCHED_DIR`, the plist or the log dir.
- **Outside the ticket's file list:** `/home/user/deployment/.github/workflows/runner-check.yml:4,22,25-26` hard-fails unless `id -un` is `gh-runner`. It also points to a `runner-setup.md` that doesn't exist in the repo. `docs/deploy.md` D1 says to "run runner-check and see it green", which can no longer pass. This file is shared by the deployment repo and has no draft in `deploy/deployment-repo/`.
- Historical ticket files (STK-037, 038, 043) also mention `gh-runner`. Leave them as they are; they record what happened.

**Technical facts that change the brief slightly:**

- Compose *does* interpolate `${HOME}` in `env_file`. launchd plists cannot expand anything.
  - The catch with `${HOME}` in compose: `check-deploy-env.sh:24-29` would reject `HOME` as an undeclared variable, and the workflow/compose string comparison at `:97-102` would stop being meaningful. If `HOME` is ever wrong (for example `sudo` without `-H`), compose would read a different file without any error.
- The GitHub runner's `svc.sh` on macOS installs a **LaunchAgent** (`~/Library/LaunchAgents/actions.runner.*`), so the runner only runs while `mingming` has a GUI login session. OrbStack is a per-user app that starts at login. So docker is only available inside Ming's session anyway.

## Recommendations

1. **Paths: hard-code `/Users/mingming/...` literals.** (AC1, AC2, AC4)
   - Use literals in the workflow `env:`, compose `env_file` and the plist. One literal per tool, with the checker enforcing that they agree. This is the "single source where tools allow it".
   - Don't use `$HOME` in compose or the workflow. A literal makes a mismatch fail loudly in the checker; `$HOME` could fail silently at runtime.
   - In `run-job.sh` and `run-schedule.sh`, keep the env-overridable defaults as literals too, so the checker can compare them.
   - Add a cheap runtime guard at the top of the `secrets` step: `[[ "$ENV_FILE" == "$HOME/"* ]] || { echo "::error::ENV_FILE $ENV_FILE is not under the runner user's home $HOME ($(id -un)). Nothing was started."; exit 1; }`. This turns today's `mkdir: Permission denied` into a clear message if the runner user ever changes again.
   - Keep the `$(id -un)` owner checks as they are (AC2 already met).
2. **Scheduler: use a LaunchAgent, not a LaunchDaemon.** (AC3)
   - A LaunchDaemon with `UserName mingming` would run outside the GUI session, where the OrbStack socket and docker context may not exist. You would get the opposite of what you want: jobs that fire but can't reach docker.
   - A LaunchAgent runs in the same context as the runner and OrbStack, needs no `sudo`, and `StartCalendarInterval` still catches up after sleep.
   - Install it with `cp` into `~/Library/LaunchAgents/`, then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/online.mmlabs.stoktok.jobs.plist`, and verify with `launchctl print gui/$(id -u)/online.mmlabs.stoktok.jobs`.
   - Drop the `UserName` key: it is ignored for agents and misleading.
   - Keep `HOME` and `PATH` as literals: `/Users/mingming`, `/Users/mingming/.orbstack/bin:...`.
   - Trade-off: no jobs run without a login, but deploys don't either. Make D1 say auto-login (or a logged-in session) plus OrbStack "start at login" is required, and drop the "without a GUI login" claim.
   - `root:wheel` ownership was there to prevent privilege escalation. That no longer matters: the plist runs as the same user who can write it.
3. **Runbook** (AC3): drop every `sudo -u gh-runner -H` and run the commands as Ming directly.
   - `install -d -m 755 ~/stoktok/logs` without sudo.
   - `ls -l` check expects `-rw------- mingming`.
   - newsyslog lines must name the owner `mingming:staff`.
   - The `/tmp` lock owner mismatch from the STK-037 security review mostly goes away, because manual runs and launchd now run as the same user.
4. **ADR 0003:** add a dated amendment rather than a silent edit. Record: runner user is `mingming` (Ming, 2026-11-03), scheduler is a LaunchAgent, and why: runner and OrbStack are per-session.
5. **`check-deploy-env.sh`** (AC4). Add:
   - fail if `gh-runner` appears anywhere under `deploy/deployment-repo/`, in `docs/deploy.md` or in ADR 0003;
   - all `/Users/<name>/` occurrences in the drafts use one name;
   - workflow `SCHED_DIR` == the directory of the plist `run-schedule.sh` argument == the `run-job.sh` `DIR` default;
   - plist log path directory == the `run-job.sh`/`run-schedule.sh` `LOG_DIR` default == the `docs/deploy.md` table value;
   - `plutil -lint`, only if `plutil` exists (CI is Linux).
6. **`runner-check.yml`** (R7): not in the ticket's file list, but D1 depends on it. Either add a minimal fix to the deployment PR (expect `mingming`, or better: assert "not root" plus a repo variable `RUNNER_USER`) and record it in the plan, or make it an explicit follow-up and change D1 so it no longer relies on the check. The orchestrator or Ming decides. Also remove the dead `runner-setup.md` reference.

## Risks

- **Bigger blast radius (security):** the key file now sits in Ming's interactive account. Anything running as `mingming` can read it: browser extensions, IDE plugins, `npm install` postinstall scripts from Ming's own dev work, and every other app's deploy job on the same runner (calechip, recordin, site). The other apps' jobs already ran as the same user before, so that part isn't new. What's new is everything outside CI. And it cuts both ways: any workflow that reaches `macbook-runner` (anyone who can push a branch in `mmlabs-online/deployment`, per the STK-043 security review) now runs as Ming, with access to his SSH keys, browser profile and Keychain session, not just the stoktok key. Mitigations:
  - (follow-up, high) a runner group or workflow restriction so only `main` deploy workflows can use `macbook-runner`;
  - keep the env dir at 700 and the file at 600;
  - keep the rotation runbook current.
- **Time Machine:** `~/.config/stoktok` holds the live service-role key and will be backed up, possibly to an unencrypted disk. Add a runbook step: `tmutil addexclusion ~/.config/stoktok`. It needs no sudo for the user's own files, and the exclusion travels with the folder. Also check that the backup disk is encrypted. `~/.config` isn't under iCloud's Desktop/Documents sync, so no extra step there.
- **Login dependency:** a reboot without auto-login means no deploys and no jobs, and nothing alerts on it. This was true before for the runner itself; now it's also true for the scheduler. Document it under D1.
- If Ming later moves the runner to a dedicated user, the literals have to change again. The checker's single-user rule keeps that to a mechanical edit.

## Open questions

1. Should `runner-check.yml` be fixed in this deployment PR, or tracked as a follow-up? It is shared and outside STK-044's listed files, but D1 depends on it.
2. Is auto-login enabled for `mingming`, and is OrbStack set to start at login? The LaunchAgent choice and D1 both depend on it.
3. Is Time Machine on, and is its destination encrypted? This decides whether the exclusion step is required or just recommended.
4. Does Ming accept that his personal account now holds the service-role key and runs CI jobs, or should the runner-group restriction (currently a follow-up) become a go-live blocker?
