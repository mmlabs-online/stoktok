# STK-043 consult: software-architect

I only read files and ran nothing. I did not open any `.env` file.

## Findings

**F1. The drafts match the deployment repo exactly.** `deploy-stoktok.yml`, `apps/stoktok/compose.yml`, `run-job.sh`, `run-schedule.sh` and the launchd plist in `/home/user/stoktok/deploy/deployment-repo/` are identical to `/home/user/deployment/` main. The STK-037 setup PR is merged as drafted. `deploy/deployment-repo/README.md` is draft-only and has no copy in the deployment repo. CODEOWNERS already has `/apps/stoktok/` and `/.github/`, both `@didi-code0980`, but its header still says DRAFT.

**F2. Nothing in the deployment repo uses `environment:` or `secrets.` yet.** stoktok would be the first. The two workflows that hold a host env file (`recordin`, `stoktok`) both expect a hand-made file.

**F3. The current workflow checks the env file before it could ever write it.** The check is in the `release` step (`deploy-stoktok.yml:76-81`: `-r` plus `grep -q` on key names). It has to be replaced by a check that runs after the new write step.

**F4. The writer must not live under `apps/stoktok/`.** The rollback runs `git restore --source="$BEFORE" -- apps/stoktok` (line 127). A writer script there would be swapped for the old version, or deleted on the first release after this change. Write the file inline in the workflow, or in `.github/`, which a restore does not touch.

**F5. Rollback already has the file, because of step order.** The rollback runs only if `deploy` failed. `deploy` runs only if the new `secrets` step succeeded. So a correct file from this same run is always there before a rollback redeploy. Re-checking it at the start of `rollback` is cheap and enough to meet AC2. No second write is needed.

**F6. A valid but wrong key passes `/healthz`.** The health check never touches the DB. A rotation with a bad key will show green, and a rollback would reuse that same bad key anyway.

**F7. The `if: github.ref == 'refs/heads/main'` guard alone is not a security control.** A manual run uses the workflow file from the chosen branch, and anyone can delete the `if:` there. What GitHub enforces on its side is the environment's "deployment branches: main only" rule, which holds back the secrets. Separately, any job on `macbook-runner` runs as `gh-runner` and can `cat` the env file on disk. That includes a workflow added on any branch with `on: push`. This was already true with the hand-made file, so this ticket does not make it worse.
- `DEPLOY_REPO_TOKEN` has only Contents and Pull requests permissions, with no Workflows permission. It cannot add workflow files, so it cannot use this route. The route is open only to a human with write access.

**F8. Workers between deploys.** `docker compose run` reads `env_file` each time a container starts.
- With an atomic rename, a job sees either the whole old file or the whole new one, never half of each.
- A job already running keeps the old values. If the old key has been revoked, that one run fails and the next scheduled run retries.
- The deploy does not take the jobs lock, and it doesn't need to.

**F9. Recreating web on rotation.** Compose turns `env_file` contents into the service config, so changed values should change its hash and `up -d` should recreate web. I'm fairly but not fully sure of this, and Ming should check it once. A deterministic option is below (Rec 5).

## Recommendations

1. **Environment setup (AC1, AC5, R3).** Create an environment `stoktok` in `mmlabs-online/deployment`:
   - deployment branches: selected, `main` only;
   - secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, with no repo-level secrets of the same names (environment secrets would quietly override them);
   - no required reviewers, because the PR merge is already the gate.

   Add `environment: stoktok` to the `deploy` job. The runbook order must be: create the environment, branch rule and secrets **before** merging the PR. Otherwise GitHub creates the environment on the fly with no branch rule and no secrets. The fail-safe would catch the missing secrets, but the branch rule would still be missing.

2. **Main-only guard (AC4, STK-037 🟡4).** Add `if: github.ref == 'refs/heads/main'` on the `deploy` job. Keep the environment branch rule as the control GitHub actually enforces. Fix the header comment so it no longer claims "redeploys what main pins" unconditionally.

3. **New `secrets` step after `release`, `if: skip != 'true'` (AC2, AC3).**
   - Put the secrets in step-level `env:` only. Never at job level, and never `${{ secrets.* }}` inside `run:`, because that writes the value into the runner's temp script file.
   - Use only bash builtins (`printf`, `[[ =~ ]]`), so no value shows up in a process's arguments.
   - No heredoc: bash 3.2 writes heredocs to `$TMPDIR`.
   - Keep `config --quiet`. No `set -x`, no `docker inspect`, no `compose config` without `--quiet`.

   Sketch:
   ```bash
   umask 077
   missing=""
   [ -n "$SUPABASE_URL" ] || missing="$missing SUPABASE_URL"
   [ -n "$SUPABASE_SERVICE_ROLE_KEY" ] || missing="$missing SUPABASE_SERVICE_ROLE_KEY"
   if [ -n "$missing" ]; then echo "::error::Missing secret(s) in environment stoktok:$missing. Nothing was started; $ENV_FILE was not changed."; exit 1; fi
   [[ "$SUPABASE_URL" =~ ^https://[A-Za-z0-9.-]+$ ]] || { echo "::error::SUPABASE_URL is not https://<host>. Nothing was started."; exit 1; }
   [[ "$SUPABASE_SERVICE_ROLE_KEY" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "::error::SUPABASE_SERVICE_ROLE_KEY has unexpected characters. Nothing was started."; exit 1; }
   dir="$(dirname "$ENV_FILE")"; mkdir -p "$dir"; chmod 700 "$dir"
   tmp="$(mktemp "$dir/.stoktok.env.XXXXXX")"; trap 'rm -f "$tmp"' EXIT
   printf 'SUPABASE_URL=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' "$SUPABASE_URL" "$SUPABASE_SERVICE_ROLE_KEY" > "$tmp"
   chmod 600 "$tmp"
   if cmp -s "$tmp" "$ENV_FILE"; then changed=false; else changed=true; fi
   mv -f "$tmp" "$ENV_FILE"; trap - EXIT
   [ "$(stat -f '%Su %Lp' "$ENV_FILE")" = "$(id -un) 600" ] || { echo "::error::$ENV_FILE is not owned by $(id -un) with mode 600."; exit 1; }
   echo "changed=$changed" >> "$GITHUB_OUTPUT"
   ```
   - The charset check stops a newline or `$` in a value from adding extra lines or triggering Compose interpolation in `env_file`.
   - The temp file sits in the same directory, so `mv` is an atomic rename.
   - If the step fails, the old file stays in place, and the running web container and launchd jobs carry on untouched.
   - Keep the path `/Users/gh-runner/.config/stoktok/stoktok.env`. That way compose needs no change, and the file stays outside `_work`, `$RUNNER_TEMP` and `SCHED_DIR`. Do not keep `stoktok.env.old` copies.
   - Error messages give secret names only.

4. **Fail-safe and notify (AC3).** A failed `secrets` step leaves `deploy` as `skipped`, so `rollback` does not run and nothing is started. That is correct. Add a `notify` case that says "secrets missing or invalid" instead of the generic `did-not-complete`. At the start of `rollback`, re-check the file (exists, `gh-runner`, mode 600) before `git restore` (F5).

5. **Recreate web when the secrets change.** Optional but deterministic: pass `changed` into `deploy` and, when it is `true`, use `up -d --wait --force-recreate stoktok-web`. Otherwise rely on Compose's hash (F9), and verify it once in the runbook by checking that the container's start time changed. Do not read its env.

6. **Rotation runbook in `docs/deploy.md` (AC5).**
   1. Create the new key in Supabase.
   2. Update the GitHub environment secret.
   3. Run `deploy-stoktok` with `workflow_dispatch` from `main`.
   4. Check that web was recreated.
   5. Run `sudo -u gh-runner -H /Users/gh-runner/stoktok/current/run-job.sh eod-prices --dry-run`. This is the real check of the key (F6).
   6. Only then revoke the old key. For the key pasted into chat on 2026-11-01, revoking it is mandatory, not just replacing it.

   If the key is the legacy JWT `service_role` key, rotating it means rotating the JWT secret. That kills the old key at once and also invalidates the anon key and sessions. Supabase's new `sb_secret_…` keys allow create-then-revoke with no downtime. This is from memory, so Ming should check it in the dashboard. The charset regex accepts both formats.

   Other runbook changes:
   - **D4 and one-time setup step 2:** the workflow now creates the file. Delete the manual step, and also fix its glued-on "3." (security review, item B). Keep D4 as a description, not a manual step.
   - **Preconditions:** deployment `main` is protected: PR required, code-owner review, `pr-scope` required, no admin bypass. The STK-037 side effect follows from this: the rollback's `git push origin HEAD:main` will end in `restore-unpushed` unless `github-actions` is allowed to bypass.
   - Update `deploy/deployment-repo/README.md:23` ("Secrets stay in …") to say the workflow writes them.

7. **`check-deploy-env` (AC5, AC6).** Add these checks to `scripts/check-deploy-env.sh`, against the draft workflow:
   - it contains `environment: stoktok` and `if: github.ref == 'refs/heads/main'`;
   - `secrets.` appears only in `env:` lines, never inside `run:`;
   - no `set -x`;
   - every `config` call has `--quiet`;
   - `ENV_FILE:` in the workflow equals both `env_file:` paths in compose;
   - no writer script under `apps/stoktok/`.

## Risks

- **Environments may not be available (blocking for AC1 as written).** On a private repo, environments, environment secrets and branch rules need GitHub Pro, Team or Enterprise. If `mmlabs-online` is a Free org with a private deployment repo, the only fallback is repo-level secrets plus the `if:` guard. That is weaker: any workflow on any branch can read repo secrets.
- **Anyone who can run a job on the runner can read the file (F7).** Any human with write access to the deployment repo can do it by pushing a branch with a new workflow on `macbook-runner`. The runner also serves other apps' deploy workflows as the same user, and Docker access on the runner is effectively root. Mode 600 protects against other OS users only. The real fix is a runner group limited to the deploy workflows on `main`, which may need a higher plan. Today the org has a single user, so the risk is low.
- A wrong but well-formed key deploys green (F6). Only the dry-run job catches it.
- A job running during a rotation fails once if the old key was revoked early. The runbook order (revoke last) avoids this.
- Time Machine, if it is on, backs up `/Users/gh-runner/.config` with the key in it.
- Shared `web` network exposure while R6 is suspended: unchanged.

## Open questions for Ming

1. Which GitHub plan is `mmlabs-online` on, and is `deployment` private? This decides whether environments are available (Risk 1).
2. Is the Supabase key a legacy JWT `service_role` key or a new `sb_secret_` key? This changes the rotation steps.
3. Should the `stoktok` environment have required reviewers, i.e. a manual approval on every deploy? My recommendation is no.
4. Is `main` in the deployment repo actually protected with no admin bypass? Do we allow the `github-actions` bypass so a rollback can still push its revert?
5. Is `macbook-runner` in a runner group limited to this repo, or to specific workflows?

Files: `/home/user/stoktok/work/tickets/STK-043/ticket.md`, `/home/user/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml`, `/home/user/deployment/.github/workflows/deploy-stoktok.yml`, `/home/user/stoktok/deploy/deployment-repo/apps/stoktok/compose.yml`, `/home/user/stoktok/deploy/deployment-repo/README.md`, `/home/user/stoktok/docs/deploy.md`, `/home/user/stoktok/scripts/check-deploy-env.sh`, `/home/user/stoktok/work/tickets/STK-037/security-review.md`, `/home/user/deployment/.github/CODEOWNERS`.
