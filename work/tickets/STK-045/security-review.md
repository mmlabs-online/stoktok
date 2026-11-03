# STK-045 security review, attempt 1

**Verdict: no 🔴 findings.** Secret handling has not regressed, nothing uses sudo, and nothing changes system settings. There are two 🟡 findings: the plist is now installed with no checks on what it contains, and a smaller one about what the guards cover. I only read files. I opened no `.env` file and ran no commands, so I did not run the checks myself.

## Findings

### What holds up
- 🟢 **Secrets are unchanged** (`/home/user/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml:153-194`):
  - The body of `secrets` matches STK-044. It still uses `umask 077`, the `$HOME` guard, the regex checks, `printf` into a `mktemp` file, `chmod 600`, `mv -f`, and the `%Su %Lp` = `<user> 600` check.
  - The only edit is the `if:` line (:155).
  - `GITHUB_OUTPUT` still gets only `ok` and `changed`.
- 🟢 **The new steps never see a secret:**
  - `preflight` (:56-77), `envdir` (:126-149) and `agent` (:266-309) have no `env:` block, and the workflow-level `env` (:36-42) holds no secrets.
  - What they print is limited to: the user name, the session name, docker context and OS, `orb status`, paths, and `plutil -lint` OK lines.
  - `launchctl print` output goes into `$info` and is never echoed (:282).
  - `notify` (:316-318) adds only outcomes and `tm`.
  - The checker's awk guard (`/home/user/stoktok/scripts/check-deploy-env.sh:198`) fails if a step that uses `secrets.` also calls tmutil, launchctl, plutil or xattr.
- 🟢 **No root and no system settings:**
  - There is no `sudo`. The only `system/` use is a read-only `launchctl print system/…` (:71).
  - `tmutil addexclusion` is used without `-p`, so it writes a per-item xattr and needs no root. The xattr fallback (:141) is also user-level.
  - Bootstrap, bootout and enable all target `gui/$(id -u)`.
  - The checker enforces this at `check-deploy-env.sh:157-164` and `:202-206`.
- 🟢 **envdir ordering and modes:**
  - `envdir` runs before `secrets`, and `secrets` is gated on it (:155).
  - `install -d -m 700`, then `chmod 700`, then an explicit owner and mode check (:132-137). This was STK-044 🟡3, now fixed in code: the folder is created and excluded before the key is written.
  - An exclusion failure is a warning plus `tm=not-excluded` (planner default D1). That is acceptable; Ming confirms it.
- 🟢 **Agent install, file mode and owner:**
  - The plist is installed as mode 644, owned by the runner user, through a temp file and `mv` (:288-289). The directory is 755 (:279). launchd accepts this: the file is not group- or world-writable.
  - It is installed from the published copy, `$SCHED_DIR/$AGENT_LABEL.plist` (:270), not from `_work`.
  - The Aqua check (:274-278), `plutil -lint` (:280) and the final `launchctl print` (:305) are present.
  - The "unchanged" path writes nothing and calls no launchctl command that changes state.
- 🟢 **Log dir:** `install -d -m 755 ~/stoktok/logs` (:279) is user-owned and matches the plist's `StandardOutPath` (plist :74-75). Optionally use 700, because job logs end up world-readable on the Mac. The Mac has a single user, so the risk is low.
- 🟢 **Rollback interaction is sound:**
  - `publish` and `rollback` copy the same `$PUBLISH_FILES` list (:215, :247; checker :183-187).
  - After a restore, `agent` reinstalls the plist from `$BEFORE`, which is a version that was already deployed (:268).
  - A release that fails its health check never has its plist published, because `publish` is skipped.
  - An `agent` failure does not trigger a rollback (default D3).
  - The plist already exists on deployment `main` (`/home/user/deployment/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist`), so `cp` in a rollback will not fail because the file is missing.

### 🟡 1. Whatever plist a merged PR contains is now installed automatically and runs as Ming (`deploy-stoktok.yml:280-304`, `pr-scope.yml:26-36`)
- **Your question: can a release PR now inject an arbitrary LaunchAgent?** Yes, once it is merged. Before STK-045, a plist change in a PR did nothing until Ming installed it by hand. Now the next healthy deploy installs and bootstraps it as `mingming`.
- **This does not cross a new trust boundary.** Merged `apps/stoktok/**` content could already run code as Ming:
  - `run-schedule.sh` and `run-job.sh` are published and run by launchd as Ming.
  - `compose.yml` is run by `docker compose` on the Mac and can bind-mount `$HOME`.
  - Also, `pr-scope` only checks `release/*` branches. In practice the gate is merging to `main` plus code-owner review, not the branch name.
  - That is why this is 🟡 and not 🔴.
- **What a plist adds over a script:**
  - `RunAtLoad`/`KeepAlive` give an always-on process that survives reboots.
  - `ProgramArguments` can point anywhere, for example `bash -c …`.
  - `WatchPaths` can trigger it on file changes.
  - A different `<key>Label</key>` gets bootstrapped under that label. The check at :305 then fails, so the run goes red, but the stray job is already loaded. The next good deploy's `bootout "$tgt"` (:298) never removes it, so it keeps running until Ming logs out or the Mac reboots.
- **The workflow never checks the plist's content**, only its syntax (`plutil -lint`). The checker's label check (`check-deploy-env.sh:165-171`) runs only on the drafts in the stoktok repo, never on a PR in the deployment repo.
- **Fix (cheap, in the `agent` step, before the install):**
  - `[ "$(plutil -extract Label raw "$src")" = "$AGENT_LABEL" ]`.
  - `ProgramArguments` must be exactly `/bin/bash` and `$SCHED_DIR/run-schedule.sh`. Use `plutil -extract ProgramArguments.0 raw` and `.1`, and require that `.2` does not exist.
  - Reject the keys `RunAtLoad`, `KeepAlive`, `WatchPaths`, `QueueDirectories`, `Sockets`, `UserName`, `StartInterval` and `MachServices` (`plutil -extract <key> raw` must fail).
  - If any check fails, print `::error::` and install nothing.
- This narrows the plist to "when the existing script runs". It leaves the script itself as the remaining risk, which is the same as before.
- **Follow-up (outside this ticket, R7):** in `pr-scope`, limit `release/stoktok-*` branches to `apps/stoktok/release.env`. That is the only file `release.yml` changes (`/home/user/stoktok/.github/workflows/release.yml:4,143`).
- Relates to AC2 and to the PR note on "no new trust boundary". Reword that note to: "a merged plist is now installed and runs as Ming without anyone at the Mac".

### 🟡 2. The guards have gaps (`check-deploy-env.sh:161`, `:202-206`)
- The system-setting deny-list misses several commands:
  - `launchctl config`, `launchctl setenv`, `launchctl load -w`;
  - `tmutil disable`, `tmutil enable`, `tmutil delete`;
  - `csrutil`, `spctl`, `dscl`, `security` (Keychain), `chown`, and `chmod u+s`.
- Nothing requires the security checks in the `agent` step (the `plutil -lint` line, the Aqua check, and the 🟡1 checks once added). A later edit could delete them and every guard would still pass.
- **Fix:**
  - Extend the regex.
  - Add `grep -qF` checks for `plutil -lint "$src"`, for `managername`, and for the new Label/ProgramArguments assertions.
- Relates to AC5.

### Smaller 🟢 notes
- `:292`: `launchctl enable` overrides a manual `launchctl disable`. With Ming away from the Mac, the only way to stop the scheduler is now a PR that removes the plist. Note this in `docs/deploy.md` as the kill switch.
- `:288-289`: if `mv` fails, `$dst.tmp` stays in `~/Library/LaunchAgents`. Its content and label are the same as the real plist, so the worst case is a duplicate-label log line at login. Optionally add `trap 'rm -f "$dst.tmp"' EXIT`.
- `:130`: still open from STK-044. If `HOME` is empty, the guard passes for any path. With no root, `install -d /.config/…` just fails, so the effect is harmless.
- The exclusion does not remove the key from backups or snapshots made before it was in place. Today this only matters if an earlier run wrote the file. The rotation that is still pending covers it.
- Still open from earlier reviews: `actions/checkout@v7` is pinned to a tag, not a commit SHA.

## Recommendations
1. Add the plist content checks to `agent` (🟡1, AC2), and add the `pr-scope` restriction to release.env to the follow-ups.
2. Extend the deny-list and make the checker require the security lines (🟡2, AC5).
3. Reword the PR body's trust-boundary note and document the kill switch (AC5).

## Risks
- Until 🟡1 is fixed, whoever can get a change to `apps/stoktok/**` merged can install a LaunchAgent that runs as Ming and survives reboots. That includes the code owner `@didi-code0980` and anyone with push access if branch protection is weak.
- None of this has run on macOS: the `tmutil` behaviour under TCC, the `launchctl print` format and BSD `install -d` modes are untested. The first real run is the test.

## Open questions
- Is `@didi-code0980` Ming? Does branch protection on deployment `main` require code-owner review?
- Should release PRs for stoktok be limited to `release.env` only (shared `pr-scope`, operator's call)?

Files reviewed:
- /home/user/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml
- /home/user/stoktok/deploy/deployment-repo/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist
- /home/user/stoktok/deploy/deployment-repo/apps/stoktok/run-schedule.sh
- /home/user/stoktok/scripts/check-deploy-env.sh
- /home/user/stoktok/docs/deploy.md (grep)
- /home/user/stoktok/.github/workflows/release.yml (grep)
- /home/user/deployment/.github/workflows/pr-scope.yml
- /home/user/deployment/.github/CODEOWNERS
