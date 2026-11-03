Status: READY

# Plan — STK-045: Self-install the Mac-side setup from deploy-stoktok

## Spec summary
- `docs/spec-v1.md` §7: "Shared deploy repo: Compose definitions + env; deploy jobs on the self-hosted runner on the home server." / "Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo." / "`worker` must tolerate restarts: jobs are idempotent and resume from last successful run."
- CLAUDE.md R3 (service role key server-only) and R7 (stay in plan).
- Ticket goal: "`deploy-stoktok` performs the one-time, no-sudo Mac setup itself on every run (idempotently), so stoktok deploys and its worker schedule work without anyone logging in to the Mac."
- Ming's scope (ticket notes, 2026-11-03): "env dir + Time Machine exclusion, LaunchAgent install, read-only checks; no sudo, no system settings".

## Acceptance criteria → verification
Nothing here can run on macOS in the sandbox. The reviewer verifies by reading the workflow, by `pnpm check:deploy-env`, and by the guard tests below. The first real run on the Mac is the live test (see Assumptions).

| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | `~/.config/stoktok` exists with mode 700 and is excluded from Time Machine before the env file is written. The exclusion is checked with `tmutil isexcluded`, a failure is reported clearly, and nothing uses sudo. | Read `deploy-stoktok.yml`. A new `envdir` step comes before `secrets`, has no `env:` with `secrets.*`, and creates the directory, then checks owner and mode with `stat -f '%Su %Lp'` = `<user> 700`. It runs `tmutil addexclusion` (no `-p`), parses `tmutil isexcluded` for `[Excluded]`, falls back to `xattr`, and checks again. If the folder is still not excluded it writes `::warning::`, a step-summary line and output `tm=not-excluded`. `secrets` is gated on `steps.envdir.outcome == 'success'`. `check-deploy-env.sh` fails on any `sudo` in the workflow and on `envdir` coming after `secrets`. |
| 2 | After a successful publish, the plist is installed or updated in `~/Library/LaunchAgents` from the published copy. It is (re)loaded with `launchctl bootstrap gui/$(id -u)` only when new or changed, and checked with `launchctl print`. A re-run with no change does nothing. | Read the workflow. `publish` and `rollback` both copy the plist to `$SCHED_DIR` through one shared `PUBLISH_FILES` list. A new `agent` step comes after `rollback` and has the condition from Approach step 5. It installs from `$SCHED_DIR`, not `_work`. It checks the "unchanged" case (`cmp` equal AND loaded AND loaded from `$dst`) before any write and exits 0 printing `unchanged`. Otherwise it does `plutil -lint`, installs with mode 644, runs bootout and polls, then bootstrap with one retry, then `launchctl print`. The check script asserts both copy lists come from `PUBLISH_FILES` and that `PUBLISH_FILES` contains the plist. |
| 3 | Read-only report on whether OrbStack/docker is reachable and whether an old LaunchDaemon plist exists. No system settings or root changes. | A new `preflight` step after checkout always exits 0 (every probe ends in `|| true`) and writes to the step summary: `launchctl managername`, the OrbStack socket, `docker context show`, `docker info --format '{{.OperatingSystem}}'`, `test -e /Library/LaunchDaemons/online.mmlabs.stoktok.jobs.plist` and `launchctl print system/<label>`. It writes nothing to disk except the step summary. The check script fails on `sudo` and on the system-setting commands `fdesetup`, `pmset`, `systemsetup`, `sysadminctl`, `defaults write`, `osascript`, `orb start`, `tmutil addexclusion -p`. |
| 4 | Secret handling from STK-043/044 is unchanged. | `git diff` of the `secrets` step: the only change is the `if:` line (`&& steps.envdir.outcome == 'success'`). Its body stays byte-identical, including its own `mkdir`/`chmod 700`. The existing STK-043 guards in `check-deploy-env.sh` still pass. A new guard asserts that no step whose `env:` has `secrets.` calls `tmutil`, `launchctl`, `plutil` or `docker info`. |
| 5 | `docs/deploy.md` moves these steps to "done by the workflow" and lists what still needs Ming at the Mac. `check-deploy-env.sh` keeps passing and guards the new steps (no sudo, plist path agreement). | Read `docs/deploy.md`. A new "Done by the workflow" subsection covers the env dir with mode 700 and the TM exclusion (D4), the log dir and the LaunchAgent install (old steps 2 and 3). A "Still needs Ming at the Mac" list covers D1 auto-login and OrbStack start-at-login, D2 time zone and sleep, removing the old LaunchDaemon, FileVault and an encrypted backup destination, and optional newsyslog. `pnpm check:deploy-env` prints `OK`. The new guards are listed in "Tests to write". |
| 6 | The deployment-repo PR is updated, and `typecheck`, `lint`, `test` and the deploy checks pass. | `pnpm typecheck && pnpm lint && pnpm test && pnpm check:deploy-env` are green. The orchestrator pushes the changed drafts to PR #18 (branch `stoktok/runner-user`). The implementer only changes the drafts in this repo. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | Workflow `env`: add `AGENT_LABEL: online.mmlabs.stoktok.jobs` and `PUBLISH_FILES` (the 4 current files plus `launchd/online.mmlabs.stoktok.jobs.plist`). Add steps `preflight`, `envdir` and `agent`. Gate `secrets` on `envdir`. `publish` and `rollback` copy `$PUBLISH_FILES`. Extend `notify`. Update the header comment. | AC1, AC2, AC3, the notify part of AC4 |
| `deploy/deployment-repo/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist` | Comment only: "Installed by deploy-stoktok (agent step)". No key changes. | The old comment says it is installed by hand |
| `deploy/deployment-repo/README.md` | Plist row: "published to `$SCHED_DIR` and installed by deploy-stoktok" in place of "installed by hand". | Doc accuracy (AC5) |
| `scripts/check-deploy-env.sh` | New STK-045 guard block (see Tests). | AC5 |
| `docs/deploy.md` | Restructure "One-time setup" and D4 (see AC5). The old-daemon removal moves to the "needs Ming" list, and its `sudo` commands stay in the doc. | AC5 |
| `work/tickets/STK-045/impl-log.md` | Implementer log | Workflow |

No `packages/core`, app or migration changes.

## Tests to write
The repo has no workflow test harness. The guards live in `scripts/check-deploy-env.sh`, which runs as `pnpm check:deploy-env`. Each guard prints `FAIL: …` and sets `fail=1`.

| Test (file › name) | Covers |
|---|---|
| `check-deploy-env.sh › no sudo in workflow` (`grep -nwE 'sudo' "$WF"`) | AC1, AC3 |
| `› no system-setting commands in workflow` (the list in AC3, plus `addexclusion -p`) | AC3 |
| `› plist label agreement`: plist filename stem = `<key>Label</key>` value = workflow `AGENT_LABEL` = the label in the docs' old-daemon path | AC2, AC5 |
| `› PUBLISH_FILES contains launchd/<label>.plist` and every listed file exists under `deploy/deployment-repo/apps/stoktok/` | AC2 |
| `› publish and rollback copy the same list` (both `cp` lines reference `$PUBLISH_FILES` and no literal file list is left) | AC2 |
| `› step order`: `preflight` < `release` < `envdir` < `secrets` and `publish` < `rollback` < `agent` < `notify` (line numbers of `- name:`) | AC1, AC2 |
| `› secret steps do no Mac setup`: split the workflow by `- name:` with awk. Any block containing `secrets.` must not contain `tmutil`, `launchctl`, `plutil` or `xattr` | AC4 |
| `› agent uses gui domain only` (`launchctl bootstrap gui/` is present, `system/` appears only in `launchctl print system/` in preflight) | AC2, AC3 |
| Existing guards (heredoc `<<`, `set -x`, one `/Users/<name>`, sched/log dir agreement) stay and pass | AC4, AC5 |

The implementer should also show in impl-log that each new guard fails when its condition is broken. Use a temporary edit, then revert it; do not commit it.

## Approach
Final step order: `checkout → preflight → release → envdir → secrets → deploy → publish → rollback → agent → notify`.

1. **preflight** (right after checkout, no `if`, never fails). Use `set +e`, end every probe in `|| true`, and write only to `$GITHUB_STEP_SUMMARY`. Report:
   - `launchctl managername` (expected `Aqua`)
   - `~/.orbstack/run/docker.sock` present
   - `docker context show`
   - `docker info --format '{{.OperatingSystem}}'`
   - `orb status` only if `orb` is on PATH (never `orb start`)
   - the old LaunchDaemon file `/Library/LaunchDaemons/$AGENT_LABEL.plist` and `launchctl print system/$AGENT_LABEL` ("loaded" / "not loaded or not visible")

   If the daemon file exists, emit `::warning::Old LaunchDaemon … still installed; jobs may run twice. Ming must remove it at the Mac: see docs/deploy.md "Still needs Ming"`. The message must not contain the literal word "sudo".
2. **envdir** (`if: steps.release.outcome == 'success'`, no secrets in `env`).
   - Guard: `[[ "$ENV_FILE" == "$HOME/"* ]]`.
   - `dir=$(dirname "$ENV_FILE")`, then `install -d -m 700 "$dir"` and `chmod 700 "$dir"`. Check that `stat -f '%Su %Lp'` is `$(id -un) 700`, otherwise `::error::` and exit 1. This is the only failure of this step.
   - Time Machine: `tmutil addexclusion "$dir" || true`, then read `out=$(tmutil isexcluded "$dir" 2>&1 || true)` and match `[[ $out == *"[Excluded]"* ]]`. If not excluded, run `xattr -w com.apple.metadata:com_apple_backup_excludeItem com.apple.backupd "$dir" || true` and check again.
   - Still not excluded: `::warning::`, a step-summary line and `tm=not-excluded`. Otherwise `tm=excluded`. Exit 0 either way.
   - Never use `tmutil -p`, `listbackups` or `destinationinfo`.
3. **secrets**: only the `if:` changes, to `steps.release.outcome == 'success' && steps.envdir.outcome == 'success'`. The body stays byte-identical (R3, AC4). `deploy` and `publish` already skip on an earlier failure through the implicit `success()`.
4. **publish / rollback**: replace both literal `cp` lists with `for f in $PUBLISH_FILES; do cp "$APP_DIR/$f" "$SCHED_DIR.new/"; done`. This flattens, so the plist lands at `$SCHED_DIR/$AGENT_LABEL.plist`. Nothing else changes.
5. **agent**: `if: always() && (steps.publish.outcome == 'success' || steps.rollback.outputs.result == 'restored' || steps.rollback.outputs.result == 'restore-unpushed')`. Plain `run:`, with GitHub's default `bash -e -o pipefail`.
   - Paths: `src=$SCHED_DIR/$AGENT_LABEL.plist`, `dst=$HOME/Library/LaunchAgents/$AGENT_LABEL.plist`, `dom=gui/$(id -u)`, `tgt=$dom/$AGENT_LABEL`.
   - If `launchctl managername` is not `Aqua`: `::error::` naming the value, exit 1.
   - `install -d -m 755 "$HOME/stoktok/logs" "$HOME/Library/LaunchAgents"`. The log dir is needed because launchd opens `StandardOutPath` itself (consult Finding 2). Use `$HOME/stoktok/logs`, or derive it from the plist, so that the "exactly one /Users/<name>" guard still holds.
   - `plutil -lint "$src"`, fail on error.
   - State: `info=$(launchctl print "$tgt" 2>/dev/null) && loaded=yes || loaded=no`. Path check: `[[ $info == *"path = $dst"* ]]`. Capture output in variables; never pipe `launchctl print` into `grep -q`, because SIGPIPE under pipefail gives false negatives.
   - Unchanged (`cmp -s "$src" "$dst"`, loaded, path matches): print `scheduler unchanged`, set output `agent=unchanged`, exit 0. No write, no launchctl call.
   - Otherwise:
     - `install -m 644 "$src" "$dst.tmp" && mv -f "$dst.tmp" "$dst"`.
     - If `launchctl print-disabled "$dom"` lists the label as `true` or `disabled`, run `launchctl enable "$tgt"`.
     - If loaded and `$info` has `state = running`, emit `::warning::` that a running job is stopped (Default D2).
     - If loaded: `launchctl bootout "$tgt" || true`, then poll `launchctl print "$tgt"` until it fails, up to 10 s.
     - `launchctl bootstrap "$dom" "$dst" || { sleep 2; launchctl bootstrap "$dom" "$dst"; }`.
     - Final `launchctl print "$tgt" >/dev/null`, or `::error::` and exit 1.
     - Output `agent=installed`.
6. **notify**: add `ENVDIR: steps.envdir.outcome`, `TM: steps.envdir.outputs.tm`, `AGENT: steps.agent.outcome`.
   - `ENVDIR=failure` gets its own message: "env dir `~/.config/stoktok` could not be created as mode 700; nothing was started."
   - The case key stays `DEPLOY:RESULT`. After the main message, append " Scheduler NOT installed: see the run." when `AGENT=failure`, and " Env dir not excluded from Time Machine." when `TM=not-excluded`.
   - No secret values ever appear here.
7. **Docs**: update `docs/deploy.md`, the plist comment and the drafts README as listed in Files.
8. **Checks**: add the guards. Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm check:deploy-env`.

Rules: R3 (secrets stay confined to the unchanged `secrets` step, and a guard enforces it), R5 (no market rules touched), R7 (the file list above), R8 (checks green). R1, R2, R9 and R10 do not apply. R6 is suspended and not relevant.

**Planner defaults for the consult's open questions.** These are not blocking. List them in the PR body so Ming can confirm:
- **D1, Time Machine exclusion fails → warn, not fail.** The step stays green, with a `::warning::`, a step-summary line and a suffix on the PR comment. Failing would not remove the file and would block deploys that Ming cannot fix remotely.
- **D2, plist change while a job is running → accept the stop and warn.** The jobs are idempotent and restart-safe (spec §7), and `run-job.sh` clears a stale lock. Deferring the reload could leave the new schedule uninstalled until the next setup PR. In practice the plist changes only in setup PRs, so this is rare.
- **D3, agent-step failure → the run is red, and there is no rollback.** `agent` comes after `rollback`, and rollback triggers only on `steps.deploy.outcome == 'failure'`, so the healthy web deploy stays. The PR comment says "Scheduler NOT installed".

## Specialist input used
`consult-software-architect.md`:
- Adopted:
  - Finding 1 (publish the plist; install from `$SCHED_DIR`)
  - Finding 2 (create the log dir)
  - Finding 3 (Aqua check, bootout/poll/retry, the `enable` fix, mode 644, `plutil -lint`)
  - Finding 4 (`tmutil` without `-p`, parse the output, `xattr` fallback)
  - Finding 5 (read-only probes)
  - Findings 6–7, R-a to R-g
- Adapted:
  - R-a: the HOME guard reuses the existing `ENV_FILE == $HOME/*` pattern instead of a second literal `/Users/mingming`, to keep the one-user guard simple.
  - R-a: an explicit owner/mode check is added.
  - R-e: the "secret steps do no Mac setup" guard also covers `plutil` and `xattr`.
- Open questions 1–3 are resolved as defaults D1–D3 above.

## Assumptions
- **First setup merge.** With no `release.env` yet, `publish` is skipped, so the LaunchAgent is installed on the first release deploy, not by the setup merge. `envdir` and `preflight` still run. This matches AC2 ("after a successful publish"), and a scheduler without a published directory would have nothing to run. Say so in `docs/deploy.md`.
- macOS behaviour (launchctl error codes, `tmutil` without root or Full Disk Access, `print` output format) comes from the consult and is untested here. The first real run is the test. `preflight` and clear `::error::` messages are how Ming diagnoses a failure remotely.
- A `launchctl print system/…` that fails without root is reported as "not loaded or not visible". The file check is authoritative.
- Release PRs may change files under `apps/stoktok/`, including the plist, and `pr-scope` allows that. This is no new trust boundary: `run-job.sh` and compose were already executed from there, and code-owner review (D5) is the gate. Note it in the PR; no change.
- `docs/adr/0003-deploy-and-scheduling.md` needs no change: it does not describe manual install.

## Blocking questions
None.

## Split proposal
None. Expected diff is about 150–250 lines across the workflow, the check script and the docs.
