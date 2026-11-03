## STK-045 consult: software-architect

Files I read: `work/tickets/STK-045/ticket.md`, `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml`, `deploy/deployment-repo/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist`, `run-schedule.sh`, `runner-check.yml`, `docs/deploy.md` and the parts of `scripts/check-deploy-env.sh` that cover the plist and paths. I did not open any `.env` file. I could not run anything on a Mac, so the macOS behaviour below comes from what I know, not from a test.

### Findings
1. **The plist is never published.** `publish` and the rollback republish copy only `compose.yml`, `release.env`, `run-job.sh` and `run-schedule.sh`. AC2 says "from the published plist", so `launchd/online.mmlabs.stoktok.jobs.plist` has to be copied into `$SCHED_DIR` in both places. Then install from the stable directory, not from `_work`.
2. **The log directory has to exist before launchd uses it.** The plist sets `StandardOutPath` and `StandardErrorPath` to `/Users/mingming/stoktok/logs/launchd.log`. launchd does not create that directory. `run-schedule.sh` creates it, but only after launchd has already opened the paths. Today this is one-time step 2 in the runbook (`install -d -m 755 ~/stoktok/logs`). The workflow has to do it now.
3. **`launchctl bootstrap gui/$(id -u)` should work.** The runner is a LaunchAgent inside mingming's GUI session, so its child processes are in the Aqua session and the `gui/<uid>` domain exists. No sudo is needed for your own gui domain. A cheap check before running: `launchctl managername` prints `Aqua`. If it prints `Background` or `System`, the runner is not where we think it is.
   Known failure modes:
   - Bootstrapping a label that is already loaded: `Bootstrap failed: 5: Input/output error`, or `37: Operation already in progress` on newer macOS. You cannot bootstrap over a loaded job; you must `bootout` first.
   - `bootout` can return before the service has gone. An immediate `bootstrap` then hits 5 or 37. Poll `launchctl print gui/$uid/$LABEL` until it fails (about 10 s at most), then bootstrap, with one retry.
   - A label that was once `launchctl disable`d fails with 5 or "Service is disabled". `launchctl print-disabled gui/$uid` shows this, and `launchctl enable gui/$uid/$LABEL` fixes it without root.
   - launchd rejects a plist that is group- or world-writable or owned by someone else (error 5, or "bad ownership/permissions"). Install it as mingming with mode 644.
   - An invalid plist: run `plutil -lint` on it before touching launchd.
   - `bootout` sends SIGTERM to a job that is running. If a deploy lands during the 18:30 or 21:00 slot, it kills `run-schedule.sh` mid-job. The jobs are restart-safe and `run-job.sh` clears a stale lock. A container started by `docker compose run --rm` may keep running after its client dies.
4. **`tmutil addexclusion` without `-p` should need neither root nor Full Disk Access on a path you own.** It sets a "sticky" exclusion that is stored on the item itself as the `com.apple.metadata:com_apple_backup_excludeItem` extended attribute, so it moves with the folder. `-p` (a fixed-path exclusion) writes the system Time Machine preferences and needs root, so do not use it. `tmutil isexcluded <path>` prints `[Excluded]` or `[Included]` followed by the path, and its exit code does not tell you which, so parse the output. Some `tmutil` subcommands do need Full Disk Access (`listbackups`, `destinationinfo`), so avoid them. If `tmutil` errors, a fallback with the same effect is `xattr -w com.apple.metadata:com_apple_backup_excludeItem com.apple.backupd <dir>`, then check again with `isexcluded`.
5. **These checks can be read-only and sudo-free.**
   - Old daemon: `/Library/LaunchDaemons` is world-readable, so `test -e /Library/LaunchDaemons/online.mmlabs.stoktok.jobs.plist` works. `launchctl print system/online.mmlabs.stoktok.jobs` usually works without root (it fails with 113 if not loaded). Treat a failure as "not loaded or not visible" and rely on the file check.
   - OrbStack: `test -S ~/.orbstack/run/docker.sock`, `docker context show`, `docker info --format '{{.OperatingSystem}}'` (prints `OrbStack`), and `orb status` if `orb` is on PATH. Never `orb start`.
6. **What rollback means for the agent.** A rollback run never reaches the agent step for the failed version, because publish is skipped when deploy fails. The installed plist is therefore still the one from the last good run. Release PRs change only `release.env` (pr-scope), so the plist changes only in setup PRs. A restored plist will almost always equal the installed one.
7. **The run's outcome message has no slot for an agent failure.** `notify` maps `success:` to "deployed" with no room for "the agent step failed". A red run would then post a green message.

### Recommendations
- **R-a (AC1, AC4): add a new `envdir` step before `secrets`, with no secrets in its `env`.** Leave the `secrets` step byte-identical, keeping its own `mkdir`/`chmod 700` as defence. `envdir` does the following:
  - Asserts `$HOME` is `/Users/mingming`, like the existing `ENV_FILE` guard.
  - Runs `install -d -m 700 "$(dirname "$ENV_FILE")"`.
  - Runs `tmutil addexclusion` on that directory, then `tmutil isexcluded`, then the `xattr` fallback, then `isexcluded` again.
  - If the folder is still not excluded, writes a `::warning::` and a line in the step summary, and sets an output `tm=not-excluded`.
  - Gate `secrets` on `steps.envdir.outcome == 'success'`. Only a directory failure should fail `envdir`, not a failure to exclude (see Open questions).
- **R-b (AC2): add an `agent` step.** Condition: `always() && (steps.publish.outcome == 'success' || steps.rollback.outputs.result == 'restored' || steps.rollback.outputs.result == 'restore-unpushed')`. This reinstalls on rollback, which should be a no-op (Finding 6), and keeps the restored directory and the agent consistent. Logic:
  ```
  src=$SCHED_DIR/online.mmlabs.stoktok.jobs.plist; dst=$HOME/Library/LaunchAgents/online.mmlabs.stoktok.jobs.plist; tgt=gui/$(id -u)/online.mmlabs.stoktok.jobs
  plutil -lint "$src"; install -d -m 755 "$HOME/stoktok/logs" "$HOME/Library/LaunchAgents"
  loaded=no; launchctl print "$tgt" >/dev/null 2>&1 && loaded=yes
  path_ok = (launchctl print "$tgt" | grep -q "path = $dst")
  if cmp -s "$src" "$dst" && loaded=yes && path_ok: echo "unchanged"; exit 0
  install -m 644 "$src" "$dst.tmp" && mv -f "$dst.tmp" "$dst"
  launchctl enable "$tgt" (only if listed as disabled)
  [ loaded=yes ] && launchctl bootout "$tgt"; poll until print fails (≤10 s)
  launchctl bootstrap gui/$(id -u) "$dst" || (sleep 2; retry once)
  launchctl print "$tgt" >/dev/null || ::error
  ```
  - "Changed" means: the file differs, OR the job is not loaded, OR it is loaded from a different path. The last case catches a copy loaded by hand from somewhere else.
  - There is no `RunAtLoad`, so a reload does not fire a job.
  - Optional: if `launchctl print` shows `state = running`, either defer the reload with a warning or accept the SIGTERM (Finding 3). My lean is to accept it, because the jobs are idempotent, and to log it.
- **R-c (AC1/AC2): keep the publish and rollback file lists identical.** One env var such as `PUBLISH_FILES` stops them drifting.
- **R-d (AC3): add a `preflight` step right after checkout.** It always exits 0 and writes OrbStack/docker reachability, `managername`, the old-daemon file and its loaded state to the step summary. If the old daemon exists, emit `::warning::` pointing at the runbook section rather than an inline `sudo …` string (see R-e). Both the daemon and the agent firing means double runs; the lock serialises them, but Ming must remove the daemon at the Mac.
- **R-e (AC5): `check-deploy-env.sh` guards.**
  - Grep the workflow for `\bsudo\b` and fail on any hit. That is only workable if warning messages never contain a literal `sudo`, so point to `docs/deploy.md` instead.
  - Check that the plist filename, its `<key>Label</key>` and the workflow's label or path variable agree.
  - Check that publish and rollback both copy the plist.
  - Check that no step with `secrets.*` in its env calls `tmutil` or `launchctl`.
- **R-f (AC2/AC4): extend `notify`.** Pass `steps.agent.outcome` and `steps.envdir.outputs.tm`. Add messages such as "deployed, scheduler NOT installed: see run" and append "env dir not excluded from Time Machine".
- **R-g (AC5): `docs/deploy.md`.**
  - Move steps 2 and 3 and the D4 exclusion into "done by the workflow".
  - Still needs Ming at the Mac: auto-login, OrbStack start-at-login, time zone, sleep (D1/D2), removing the old LaunchDaemon (sudo), FileVault and backup encryption, and newsyslog (step 4, `/etc`).

### Risks
- If the runner is ever reinstalled outside the Aqua session, `bootstrap gui/…` fails with error 125 ("Domain does not support specified action") or 5. The `managername` preflight shows this clearly. None of this can be tested here; the first real run is the test, and Ming cannot reach the Mac to fix it.
- A broken plist fails only the agent step, while the deploy stays healthy. That is acceptable only if R-f makes it visible.
- bootout during a running slot kills a job mid-run (Finding 3).
- The Time Machine exclusion is an extended attribute. If a later run recreates the directory, the exclusion is lost, so re-checking it on every run (R-a) is the mitigation. The exclusion does not cover backups taken before it was set.
- The old LaunchDaemon cannot be removed without root, so double scheduling can persist until Ming is at the Mac.

### Open questions (for Ming or the planner)
1. If the Time Machine exclusion fails, should the deploy fail or only warn? The ticket says "reported clearly". I recommend warn: the file already exists, and blocking a deploy does not remove it.
2. On a plist change during a running job, accept the kill or defer the reload to the next run?
3. Should an agent-step failure make the run red? I recommend yes, without triggering rollback; the rollback condition is already deploy-only.
