# STK-044 security review, attempt 1

**Verdict: no 🔴 findings, and the secret handling has not regressed since STK-043.** There are three 🟡 findings, all about the runbook or the checks, not the workflow code. I only read files; nothing was changed. I did not open any `.env` file. I ran no commands, so none of the checks were run by me.

## Findings

### What holds up
- 🟢 **Secret path is the same as STK-043** (`deploy/deployment-repo/.github/workflows/deploy-stoktok.yml`):
  - Secrets still enter only through the step `env:` block (:100-101).
  - Values are still written by `printf` to a temp file and renamed into place (:120-129): `umask 077`, dir `chmod 700`, `mktemp` in the same dir, file `chmod 600`, then `mv -f`.
  - The URL and key regex checks are unchanged (:112, :116), and `GITHUB_OUTPUT` still gets only `ok` and `changed`.
  - The only edits are the two `env:` literals (:35-36) and the new guard (:104).
- 🟢 **The new `$HOME` guard (:104) is sound.**
  - `"$HOME/"*` is quoted, so `$HOME` is matched as a literal prefix, not a pattern. It runs after `umask 077` and before anything touches the disk.
  - On failure it prints only the path, `$HOME` and `id -un`, never a secret, and stops the step. That gives a clear error instead of the old `mkdir: Permission denied`.
- 🟢 **Owner and mode checks are still correct.**
  - Both checks still compare `stat -f '%Su %Lp'` with `"$(id -un) 600"` (:130, :171), so no user name is hard-coded.
  - If `~/.config/stoktok` is owned by someone else, `chmod 700` (:122) fails and `-e` stops the step.
- 🟢 **The LaunchAgent plist has no privilege problems** (`deploy/deployment-repo/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist`).
  - There is no `UserName` key; it runs in `gui/<uid>` as `mingming`, with no root and no sudo at run time.
  - `ProgramArguments` (:14) equals `SCHED_DIR` + `/run-schedule.sh`. `HOME`, `PATH` (:18-19) and the logs (:74-75) are all under `/Users/mingming`.
  - The plist holds no secrets.
  - In `docs/deploy.md:42`, sudo is used only to remove the old LaunchDaemon. The install itself is `launchctl bootstrap gui/$(id -u)` without sudo, which is correct.
- 🟢 **`runner-check.yml` changes are minimal.** The draft differs from `/home/user/deployment/.github/workflows/runner-check.yml` only in the expected user (:25-26), the root-check message (:22) and the comments. It is still `workflow_dispatch` only with `permissions: {}`, and the root check is kept. It fails for every app today, so the change does not hurt the others.
- 🟢 **The checker additions work** (`scripts/check-deploy-env.sh:109-154`): no `gh-runner`, exactly one `/Users/<name>`, the same scheduler dir and log dir everywhere, no `UserName` in the plist, and `plutil` only when it is present. The impl-log records that negative mutations (a)–(f) each failed as expected.

### 🟡 1. The runbook does not describe the bigger blast radius, and D5 is now wrong (`docs/deploy.md:21-22`, ADR `docs/adr/0003-deploy-and-scheduling.md:34`)
- The consult (`work/tickets/STK-044/consult-software-architect.md:63`) describes the risk well, but only one point reached the runbook: Time Machine (D4, :21).
- **D5 (:22)** still says branch protection "is what stands between a push and the key". STK-043 🟡1 asked for this to be reworded, and it is now more wrong.
- Any job that reaches `macbook-runner` runs as Ming's personal account. A job can be started by anyone who can push a branch or open a same-repo PR in `mmlabs-online/deployment`, or who can run `runner-check` from a modified branch. That job can read:
  - the stoktok key;
  - Ming's SSH keys, `gh`/git credentials, browser profile and the unlocked login Keychain session;
  - the other apps' env files and the runner's own credentials (`~/actions-runner/.credentials*`).
- It can also make itself permanent: by writing to `~/Library/LaunchAgents`, by editing `~/stoktok/current/run-schedule.sh` (which launchd runs as Ming), or by changing the runner binaries.
- Outside CI, anything Ming runs himself can read the file too: IDE plugins, and `npm`/`pnpm` postinstall scripts from his own dev work on this Mac.
- The PR checklist line "Accept personal account holding the env file" (impl-log :59) understates this. What Ming is accepting is running deployment-repo code as himself.
- **Fix:**
  - Reword D5: "Write access to `mmlabs-online/deployment` = running code as `mingming` on the Mac (stoktok key, SSH keys, Keychain session, other apps' secrets). Keep collaborators to Ming and the operator."
  - Add a short "Blast radius" bullet under D4 that lists the points above.
  - Reword the PR checklist line to match.
  - Tie the follow-up "restrict `macbook-runner` to main deploy workflows" to this text. Ming should decide explicitly whether it blocks go-live, which is consult Q4.
  - This relates to AC3 (runbook) and to the open CODEOWNERS question from STK-043 (`@didi-code0980`).

### 🟡 2. Auto-login (D1) quietly costs FileVault (`docs/deploy.md:18`)
- D1 requires `mingming` to log in automatically after a reboot. macOS turns auto-login off while FileVault is on.
- Following D1 therefore means disabling full-disk encryption on the machine that holds the service-role key, Ming's SSH keys and the Keychain. It also leaves an unlocked session for anyone with physical access.
- Neither the runbook nor the ADR says this.
- **Fix:** state the trade-off in D1. The preferred option is to keep FileVault on, use `sudo fdesetup authrestart` for planned reboots, and accept a manual login after an unplanned one (jobs and deploys wait until then). Ming chooses.
- This relates to AC3 and to the Time Machine encryption point in D4: encrypting the backup achieves little if the main disk is not encrypted.

### 🟡 3. The Time Machine step is ordered and scoped too narrowly (`docs/deploy.md:21`, `:40`)
- `tmutil addexclusion ~/.config/stoktok` sits in the Preconditions, but that directory is only created by the first `deploy-stoktok` run in One-time setup step 1 (:40). On a clean Mac the command fails, or gets skipped.
- If a backup runs between step 1 and the exclusion, the key is already in a snapshot.
- **Fix:**
  - Create the folder first, then exclude it, before merging the setup PR: `install -d -m 700 ~/.config/stoktok && tmutil addexclusion ~/.config/stoktok`.
  - Add `tmutil isexcluded ~/.config/stoktok` as the check.
  - Mention other backup or sync tools Ming may run (Backblaze, Dropbox, and so on).

### Smaller 🟢 notes
- `deploy-stoktok.yml:104`: if `HOME` is empty, `"$HOME/"*` becomes `/*` and the guard passes for any absolute path. Optionally add `[ -n "$HOME" ] && [ "$HOME" != "/" ]`.
- AC2 says the env file is "outside the checkout". The runner now lives at `~/actions-runner`, under the same `$HOME`, so the `$HOME` guard no longer implies that. Today's `.config/stoktok` path is fine. Optionally also check `[[ "$ENV_FILE" != "$RUNNER_WORKSPACE"* ]]`, or reject `actions-runner` in the checker.
- The checker does not require the `$HOME` guard or the two `$(id -un) 600` checks to exist, so a later edit could remove them without a failure. Cheap fix: two `grep -qF` checks.
- `check-deploy-env.sh:120` looks for `/Users/<name>` in the drafts and the runbook but not in the ADR. The `gh-runner` grep does cover the ADR.
- The STK-043 🟡2 gaps (`toJSON(secrets)`, `secrets['X']`, `bash -x`) are still open at `check-deploy-env.sh:81-92`. They are not a regression and not in this ticket's scope; keep them as a follow-up.
- `run-job.sh:15`: the lock lives in world-writable `/tmp`, so another local user could pre-create it and block the jobs. This was already the case before, and the Mac has a single user, so the risk is negligible.
- `actions/checkout@v7` is still pinned to a tag, not a commit SHA (STK-037 🟡5). That matters more now that jobs run as Ming.

## Recommendations
1. Reword D5 and add the blast-radius bullet, and reword the PR checklist line (🟡1, AC3).
2. Add the FileVault versus auto-login trade-off to D1 (🟡2, AC3).
3. Reorder the Time Machine exclusion to before step 1 and add the check (🟡3, AC3).
4. Optional hardening: the empty-`HOME` check, the runner-workspace exclusion, and checker greps for the guards (AC2, AC4).

## Risks
- Until the runner-group or workflow restriction exists, the boundary around the key and Ming's account is write access to the deployment repo, not protection on `main`.
- The key pasted into chat on 2026-11-01 stays live until rotation step 6 is done.

## Open questions
- Is FileVault on today? If it is, D1 as written cannot be met without turning it off.
- Should the runner restriction become a go-live blocker now that jobs run as Ming's account (consult Q4)?
- Who has write or admin access to `mmlabs-online/deployment` (CODEOWNERS lists `@didi-code0980`)?

Files reviewed:
- /home/user/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml
- /home/user/stoktok/deploy/deployment-repo/.github/workflows/runner-check.yml
- /home/user/stoktok/deploy/deployment-repo/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist
- /home/user/stoktok/deploy/deployment-repo/apps/stoktok/run-job.sh
- /home/user/stoktok/deploy/deployment-repo/apps/stoktok/run-schedule.sh
- /home/user/stoktok/scripts/check-deploy-env.sh
- /home/user/stoktok/docs/deploy.md
- /home/user/stoktok/docs/adr/0003-deploy-and-scheduling.md
- /home/user/deployment/.github/workflows/runner-check.yml (reference)
