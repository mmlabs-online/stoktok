# Security review: STK-037

## Attempt 1

**Verdict: no blocking defects in the diff.** Secrets are handled correctly, there is no script injection, `/healthz` is clean and R3 holds. Four 🟡 hardening items and one 🔴 go-live precondition, which comes from the deployment repo and not from this diff. I read files only; I ran nothing and read no `.env` file.

### Findings

**🔴 Go-live precondition: the tunnel token is committed, and stoktok is about to go public**
- `/home/user/deployment/proxy/compose.yml:11` has the cloudflared token in plain text in `command:`. This was already flagged and is out of scope under R7.
- It matters more now. Anyone with that token can run a connector for the mmlabs tunnel and receive part of the stoktok traffic after Access lets it through. That traffic carries Ming's Access JWT and cookie, which could then be replayed against the real hostname. The app has no auth (R6 suspended), so this leads to Ming's portfolio.
- Fix: rotate the tunnel token and move it to a host env file before runbook step 10 (`docs/deploy.md:45`). Add this as a gate in the runbook.

**🟡 1. The `release.yml` guard will break the release if the repo is private** (`.github/workflows/release.yml:36,48`)
- With `persist-credentials: false`, the extra `git fetch --no-tags origin main` runs without credentials. Spec §7 says the repo is private, so the fetch fails and every release stops at `guards`. It fails safe (no image pushed), but v0.1.0 cannot ship.
- `fetch-depth: 0` already fetches `origin/main`. Delete line 48 and keep the `merge-base --is-ancestor` check on line 49.

**🟡 2. The ancestor-of-main guard only checks the commit; it doesn't stop a tag on a branch with an edited `release.yml`** (`release.yml:13-15,38-56`)
- A tag push runs the `release.yml` from the tagged commit. A tag on a branch whose copy drops the guard still gets `DEPLOY_REPO_TOKEN` and the Docker Hub secrets.
- The risk is low because the repo is single-user, but `DEPLOY_REPO_TOKEN` can reach the self-hosted runner (see 3).
- Fix, in repo settings with no code change:
  - a tag ruleset on `v*` that only Ming can create, update or delete (this also stops a version tag being re-pointed);
  - move the three secrets into a `release` environment that only accepts `v*` tags.

**🟡 3. `DEPLOY_REPO_TOKEN` can reach the Mac runner unless `main` in the deployment repo is protected**
- `release.yml:8-9,104` and `docs/deploy.md:26` give the token Contents read/write on `mmlabs-online/deployment`.
- Without a protection rule on `main` that also binds admins, the token can push straight to `main`. That push can change any `apps/*/compose.yml`, for example to mount the Docker socket or the host filesystem, and the matching `deploy-*` workflow runs it on `macbook-runner`. From there the attacker can read `stoktok.env` and the service key.
- The `release.env` regex in `deploy-stoktok.yml:57-75` does not cover `compose.yml`.
- I found no evidence of a protection rule in the clone. `CODEOWNERS` only matters if "require code owner review" is on, and its header still says DRAFT.
- Fix: require a PR, code-owner review and `pr-scope` as a required check on `main`, with no bypass for the token's owner. Expected side effect: the rollback's `git push origin HEAD:main` (`deploy-stoktok.yml:145`) will end in `restore-unpushed` unless `github-actions` is allowed to bypass. That is acceptable, but the runbook should say so.

**🟡 4. Manual runs (`workflow_dispatch`) can deploy a branch other than `main` on the self-hosted runner** (`deploy-stoktok.yml:9,18`)
- The header says a manual run "redeploys what main pins", but the run uses whichever branch it is started from: its workflow file and its `apps/stoktok/`. That skips PR review.
- It needs Actions write, so the PAT alone can't do it. Any human with write access can.
- Fix: add `if: github.ref == 'refs/heads/main'` on the `deploy` job.

**🟡 5. Third-party actions in `release.yml` are pinned by tag, not by commit SHA** (`release.yml:33,58,60,67,79`)
- `docker/*@v3` and `@v6` run in the same job as `DEPLOY_REPO_TOKEN`. A compromised action can read secrets from runner memory, as in the tj-actions incident.
- Fix: pin them by SHA in `release.yml` at least.

**🟢 Checked and fine**
- **Triggers and permissions:**
  - `release.yml` has top-level `contents: read`, runs on `ubuntu-latest`, and only on tags.
  - `ci.yml` uses `pull_request` (not `pull_request_target`), so forks get no secrets. It pushes only on `main`.
  - `deploy-stoktok` runs on `push` to `main` plus `workflow_dispatch`, with no PR trigger, so PR code never reaches the Mac. `pr-scope` runs on GitHub's runners.
- **Script injection:** none found.
  - `github.ref_name` reaches `run:` only through `env:` (`release.yml:105`) and is checked against a strict regex first (line 45).
  - In `release.yml:73,85` it appears only in action inputs, not in a shell.
  - `ci.yml:76,90,100` interpolates only a static matrix value and `github.sha`.
  - `deploy-stoktok` passes `github.event.before` and step outputs through `env:`. Image values are regex-checked before they reach outputs, PR comments or `git commit`.
- **Secrets never printed:**
  - The guards only test that secrets are non-empty.
  - The deploy workflow checks the env file with `grep -q` on key names only (`deploy-stoktok.yml:77-78`).
  - `config --quiet` (line 99) matters: a plain `docker compose config` would print the `env_file` values. Keep `--quiet`.
  - The token in the clone URL (`release.yml:112`) is masked and the runner is temporary. Same as the template.
- **R3 (service key only on the runner host):**
  - The key reaches containers only through `env_file:` at `/Users/gh-runner/.config/stoktok/stoktok.env` (`compose.yml:25,49`); there is no `${SUPABASE_*}` interpolation.
  - `.dockerignore` excludes `.git`, `.env*`, `work` and `docs`, and the Dockerfile takes no secret build args.
  - `check-image.sh:13-19` fails on secret-like env names and on `.env*` files in the image.
  - The CI smoke test uses only dummy values (`check-image.sh:39`).
- **Rollback:**
  - It restores `apps/stoktok/` from `BEFORE` (an event value GitHub sets), redeploys it, republishes the scheduler directory and stays red.
  - Small gap: the restored `release.env` is not re-checked against the regex. It was checked when it first deployed, so this only matters if that older deploy failed validation.
  - If `publish` fails, nothing rolls back (already in the follow-ups).
- **`/healthz`** (`apps/web/app/healthz/route.ts`): no imports, no DB access, `no-store`. It returns only `status` and the version, which comes from the environment, not from the request. Runbook step 11 expects `/healthz` to sit behind Access (302/403), so there is no bypass.
- **Runbook order** (`docs/deploy.md:44-48`): the Access application (Ming's email only, no bypass rules) comes before the hostname, with an explicit "do not reorder", an unauthenticated check, and teardown in the reverse order. No hostname appears in either repo.
- **launchd** (plist): `UserName gh-runner` and the plist is owned by `root:wheel`, so no privilege escalation.

### Recommendations
1. Remove `release.yml:48` (finding 1). Needed for AC1.
2. Add `if: github.ref == 'refs/heads/main'` to the deploy job in `deploy-stoktok.yml` (finding 4). Supports AC4 and R3.
3. Runbook additions, all needed for AC5:
   - **Repository secrets:** the tag ruleset and `release` environment (finding 2), and protection on deployment `main` (finding 3).
   - **Before step 10:** rotate the tunnel token (🔴).
   - **Step 10:** turn on the tunnel hostname's Access JWT check ("Protect with Access" / `access.required`). Then cloudflared rejects requests without a valid Access token, so getting steps 9 and 10 in the wrong order fails safe.
4. Optional:
   - pin actions by SHA (finding 5);
   - check that the env file is mode 600 (`stat -f %Lp`) next to the `-r` check;
   - move the job lock from `/tmp` into `/Users/gh-runner/stoktok/`. In `run-job.sh:23-28`, if the lock belongs to another user (for example a manual run as Ming), `kill -0` fails, the `rm -rf` fails, and the `continue` loops with no sleep.

### Risks
- Any container on the shared `web` network can reach `stoktok-web:3000` without going through Access. That includes cloudflared (`:latest`), site, calechip, recordin and survey-ai. A compromise of any of them exposes the portfolio and the server actions that use the service key. Plan A9 accepted this while R6 is suspended; it remains the main residual risk.
- The Docker Hub token's scope is unknown. Use a Read/Write token, not one that can delete.

### Open questions for Ming
1. Is `mmlabs-online/deployment` public or private? This sets how bad the tunnel token leak is.
2. Is `main` there protected so admins can't bypass it, and is `pr-scope` a required check?
3. Who owns `DEPLOY_REPO_TOKEN`, and does that account have admin bypass?
4. Is `macbook-runner` in a runner group limited to the deployment repo?
