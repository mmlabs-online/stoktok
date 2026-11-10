# Deploy runbook (STK-018, STK-037)

Decisions: `docs/adr/0003-deploy-and-scheduling.md`. Drafts for the deployment repo: `deploy/deployment-repo/` (see its README). Only Ming merges.

## Flow
A push to a branch `release/vX.Y.Z` (its commit must already be on main) runs `release.yml`: it releases exactly `vX.Y.Z` (new, higher than every existing tag), creates and pushes that git tag, builds and pushes `stoktok-web` and `stoktok-worker`, then it opens PR `release/stoktok-vX.Y.Z` on `mmlabs-online/deployment` (only `apps/stoktok/release.env`, both images pinned by digest). Merging it runs `deploy-stoktok` on `macbook-runner`: pull, `up -d --wait` on `/healthz`, then publish compose, `release.env` and the job scripts to `/Users/mingming/stoktok/current`. A launchd job reads that directory and runs the worker jobs.

## Placeholders and gates
| Placeholder | Value | Status |
|---|---|---|
| `APP_HOSTNAME` | `stoktok.mmlabs.online` | confirmed by Ming (G2). Set only in the Cloudflare dashboard; no file in either repo holds it |
| Log dir (`STOKTOK_LOG_DIR`) | `/Users/mingming/stoktok/logs` | default |

- **G1:** the Cloudflare Access application exists and is verified **before** any public hostname for `stoktok-web:3000` is added. It is a step of the v0.1.0 cut below.
- No auth code is in the app (R6 suspended). Access is the only gate until STK-004.

## Preconditions on the Mac
- **D1:** the runner, the Docker engine (OrbStack, set to start at login) and the scheduler all run as `mingming`, in that user's login session. `mingming` must be logged in (auto-login after a reboot). Check: reboot, let it auto-login, run the `runner-check` workflow and see it green. No deploys or jobs run without the session.
- **D2:** time zone is Asia/Ho_Chi_Minh (`sudo systemsetup -gettimezone`; `run-schedule.sh` refuses to run if `date +%z` is not `+0700`). Sleep is off (`sudo pmset -a sleep 0 disablesleep 1`, or lid open on power), otherwise deploys queue and jobs coalesce on wake.
- **D3:** the Mac is Intel, so the `linux/amd64` images run natively.
- **D4:** secrets file `/Users/mingming/.config/stoktok/stoktok.env`, mode 600, owner `mingming`, outside git and the runner checkout. It holds every key of the env list below (optional ones may be empty). It is written by `deploy-stoktok` on every run from the `stoktok` environment secrets. Do not edit it by hand: the next deploy overwrites it. It sits in a personal home directory: `deploy-stoktok` creates the directory with mode 700 and excludes it from Time Machine; keep the backup destination encrypted.
- **D5:** deployment `main` is protected: PR required, code-owner review, `pr-scope` required, no admin bypass. The `stoktok` secrets reach a job on the self-hosted runner, so this protection is what stands between a push and the key. Side effect: without a `github-actions` bypass, an automatic rollback ends in `restore-unpushed` (the server is restored, the run is red, and Ming reverts the release PR by hand).

## Repository secrets
In the stoktok repo (Settings, Secrets and variables, Actions):
- `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`: push to `mingming21400/stoktok-*`.
- `DEPLOY_REPO_TOKEN`: fine-grained PAT on `mmlabs-online/deployment` only. Contents read/write, Pull requests read/write.

## Deployment repo: environment `stoktok`
Create it **before** merging the setup PR. Otherwise GitHub creates the environment on the fly with no branch rule and no secrets.
1. `mmlabs-online/deployment`, Settings, Environments, New environment `stoktok`.
2. Deployment branches and tags: selected branches, `main` only. This is the control GitHub enforces; the `if: github.ref == 'refs/heads/main'` guard in the workflow is not one on its own, because a manual run uses the workflow file of the chosen branch.
3. Environment secrets, prefixed `STOKTOK_` because the deployment repo is shared by every mmlabs app: `STOKTOK_SUPABASE_URL` (`https://<ref>.supabase.co`, no trailing slash or path) and `STOKTOK_SUPABASE_SERVICE_ROLE_KEY` (the **new** key, not the one pasted into chat on 2026-11-01). The workflow writes them into the env file as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, the names the app reads.
   Auth (STK-004, STK-048) adds two more. Authen is Supabase Auth of the stoktok project itself: `STOKTOK_AUTHEN_SUPABASE_URL` = the stoktok project URL (same value as `STOKTOK_SUPABASE_URL`, `https://<ref>.supabase.co`, no path), `STOKTOK_AUTHEN_SUPABASE_ANON_KEY` = the stoktok project's anon or `sb_publishable_` key (never the service role key). They are written as `AUTHEN_SUPABASE_URL` and `AUTHEN_SUPABASE_ANON_KEY`.
   Two optional AI secrets (STK-072): `STOKTOK_ANTHROPIC_API_KEY` and `STOKTOK_GOOGLE_AI_API_KEY`, written as `ANTHROPIC_API_KEY` and `GOOGLE_AI_API_KEY`. Unset means that provider is off.
4. No repo-level secrets with the same names (environment secrets would quietly override them). No required reviewers: the PR merge is already the gate.
5. Fallback if the org plan has no environments on a private repo: store both as repo-level Actions secrets and remove the `environment: stoktok` line in the deployment PR before merging. The `main` guard, the fail-safe and D5 stay. Weakness: any workflow on any branch can read repo-level secrets. Record a follow-up to restore the line when the plan allows.

If a *required* secret is empty or malformed, `deploy-stoktok` stops at the `secrets` step, names the secret, starts nothing and leaves the old file in place.

## Setup
Create the `stoktok` environment and its secrets (section above), then Ming merges the deployment-repo setup PR (drafts in `deploy/deployment-repo/`, plus the CODEOWNERS line). Merging runs `deploy-stoktok` because `compose.yml` changed under `apps/stoktok/`. With no `release.env` it skips the deploy and the publish, but still runs `preflight` and `envdir`; the LaunchAgent is installed by the first release deploy (nothing is published before that, so a scheduler would have nothing to run).

### Done by the workflow (no root, every run, idempotent)
- **Env dir and Time Machine (D4):** `envdir` creates `~/.config/stoktok` with mode 700, checks owner and mode, runs `tmutil addexclusion` and verifies it with `tmutil isexcluded` (falling back to the `xattr` exclusion). It runs before the env file is written. If the exclusion cannot be verified, the run stays green with a warning and a suffix on the PR comment. Check: the run is green, and `ls -l ~/.config/stoktok/stoktok.env` shows `-rw------- mingming`.
- **Log dir and LaunchAgent (old steps 2 and 3):** after a successful publish, `agent` creates `~/stoktok/logs`, copies the published plist (`$SCHED_DIR/online.mmlabs.stoktok.jobs.plist`) to `~/Library/LaunchAgents`, and loads it with `launchctl bootstrap gui/$(id -u)` only when it is new or changed. It then verifies with `launchctl print`. A re-run with no change prints `scheduler unchanged`. A plist change while a job runs stops that job (jobs are idempotent). If `agent` fails the run is red and the PR comment says "Scheduler NOT installed"; the web deploy is not rolled back.
- **Read-only report:** `preflight` writes the login session, OrbStack socket, docker engine and any old LaunchDaemon to the run summary.

### Still needs Ming at the Mac
- D1: auto-login for `mingming` and OrbStack set to start at login.
- D2: time zone and sleep settings.
- Remove an old LaunchDaemon if `preflight` reports one: `sudo launchctl bootout system/online.mmlabs.stoktok.jobs` and `sudo rm /Library/LaunchDaemons/online.mmlabs.stoktok.jobs.plist`.
- FileVault, and an encrypted Time Machine backup destination.
- Optional log rotation: a line for `/Users/mingming/stoktok/logs/*.log` in `/etc/newsyslog.d/stoktok.conf` (owner `mingming:staff`).

## Restore auth (STK-004) - order
1. **Access control (required, STK-060).** The app has no allowlist: **any user in the stoktok project's Auth gets full access** (Ming accepted this, 2026-11-07). The only thing keeping it to one user is this checklist. Cloudflare Access stays in front. One-time, in the stoktok project's Supabase dashboard (Authentication), all items required:
   - Sign In / Providers: Email enabled; "Allow new users to sign up" **off**.
   - Anonymous sign-ins **off**.
   - Every other provider **off** (phone, all OAuth, SSO/SAML).
   - "Confirm email" **on**.
   - Minimum password length 12 or more; leaked-password protection **on** if the plan offers it.
   - Site URL and Redirect URLs: `https://<APP_HOSTNAME>` only.
   - Users, Add user, Create new user: Ming's email and a strong password, auto-confirm on.
   - Then check Authentication, Users: it must list **only** Ming. Re-check after any change to the Supabase project.
2. Ming sets `STOKTOK_AUTHEN_SUPABASE_URL` and `STOKTOK_AUTHEN_SUPABASE_ANON_KEY` in the deployment repo environment `stoktok` (values: see the environment section above).
3. Ming merges the deployment-repo PR that carries the updated `deploy-stoktok.yml`. A workflow-file change alone does not deploy (the paths filter is `apps/stoktok/**`), so run `workflow_dispatch` on `main` once to rewrite `stoktok.env`.
4. Only then cut the release that contains STK-004.

If step 3 runs before step 2, `deploy-stoktok` stops at `secrets`, names the missing secret and starts nothing. If a STK-004 image runs without the env, `/healthz` stays 200 and every page redirects to `/login`, where sign-in fails: Ming is locked out, nothing is exposed.

## Remove the allowlist (STK-060) - order
Only if an auth image (STK-004 to STK-059) has already been released. Do these in order:
1. Merge STK-060 and release the new image **while the deployment repo still runs the old workflow** (it still writes `ALLOWLIST_USER_IDS`; the new image ignores it).
2. Then merge the deployment-repo PR with the new `deploy-stoktok.yml`.
3. Only then delete `STOKTOK_ALLOWLIST_USER_IDS` from the `stoktok` environment.

Why: a pre-STK-060 auth image under the new workflow throws in `loadAuthConfig` on every request. `/healthz` stays 200, so the deploy looks healthy and does not roll back, but nobody can log in.

**Rollback warning:** after step 2, do not roll back to a pre-STK-060 image that has auth (STK-004 or later). If you must, re-add the secret and the old workflow first.

If no auth image has been released yet, skip the allowlist secret entirely and ship STK-060 together with the auth setup above.

## Enable AI keys (STK-072)
`deploy/deployment-repo/` is only a draft mirror; nothing here deploys by itself. Steps 1 and 2 can go in either order: an old workflow with a new image means the keys are absent, so AI is off; a new workflow with no secrets writes `K=`, so AI is off. Either way there is no lockout.
1. In `mmlabs-online/deployment`, Settings, Environments, `stoktok`: optionally add `STOKTOK_ANTHROPIC_API_KEY` and/or `STOKTOK_GOOGLE_AI_API_KEY`. Leaving one out disables that provider. Do not create repo-level secrets with the same names. Values must match `^[A-Za-z0-9._-]*$`: no spaces or newlines, and a whitespace-only value fails the run.
2. Open a deployment-repo PR from a non-`release/*` branch that copies the updated `.github/workflows/deploy-stoktok.yml` as-is, then merge it.
3. A workflow-only change does not trigger a deploy (the paths filter is `apps/stoktok/**`). Run `deploy-stoktok` via `workflow_dispatch` on `main` once. It rewrites `stoktok.env` (expect `changed=true` and a one-time force-recreate of web).
4. Check: `ls -l ~/.config/stoktok/stoktok.env` still shows `-rw------- mingming`. Do not print the file.
5. After any later key change or rotation, run `workflow_dispatch` on `main` again.

## Rotate the Supabase key
1. Create the new key in Supabase. For an `sb_secret_...` key, create it next to the old one. For the legacy JWT `service_role` key, rotating means rotating the JWT secret: the old key dies at once and the anon key and all sessions are invalidated too. That includes web's Authen anon key (`STOKTOK_AUTHEN_SUPABASE_ANON_KEY`) and Ming's login session, so web cannot sign anyone in until the anon key is replaced. Then do steps 2 and 3 right away. Verify which applies in the Supabase dashboard.
2. Update the `STOKTOK_SUPABASE_SERVICE_ROLE_KEY` secret of the `stoktok` environment. If the legacy JWT secret was rotated, also update `STOKTOK_AUTHEN_SUPABASE_ANON_KEY` with the new anon key.
3. Run `deploy-stoktok` with `workflow_dispatch` on `main`. It rewrites the env file and, because the content changed, recreates web.
4. Check that web was recreated: `docker compose -p stoktok ps` shows a new start time.
5. Run `/Users/mingming/stoktok/current/run-job.sh eod-prices --dry-run`. The health check does not test the DB key (a well-formed wrong key still passes `/healthz`); this run does.
6. Only then revoke the old key. The key pasted into chat on 2026-11-01 must be revoked, not only replaced.
7. If the legacy JWT secret was rotated, sign in again at `https://<APP_HOSTNAME>/login` and confirm the dashboard shows (the old session is dead).

## Cut a release (first one is v0.1.0)
1. Apply pending migrations by hand. Every migration must work with the previous image.
2. Release main as an exact version: `git fetch origin && git push origin origin/main:refs/heads/release/v0.2.0` (one branch per version, never commit to it directly). The branch name is the version: `release/vX.Y.Z` releases exactly `vX.Y.Z`. It must not exist yet and must be higher than every existing release tag. The workflow pushes the tag; do not tag by hand. Other branch names are rejected.
3. Watch the `release` run. It fails before any PR if the commit is not on main, the commit is already released, the version exists or is not higher than the latest, a secret is missing, or an image check fails. A failed run still consumes its version tag (if it got past the guards); release again with the next version branch.
4. Review the release PR: only `apps/stoktok/release.env`, both digests.
5. Merge it.
6. Read the `deploy-stoktok` comment on the PR.
7. Verify (OrbStack runs per user, so run docker as `mingming`): `docker compose -p stoktok ps` shows web healthy, and `docker compose -p stoktok exec stoktok-web node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>r.text()).then(console.log)"` shows `v0.1.0`.
8. Run `/Users/mingming/stoktok/current/run-job.sh eod-prices --dry-run`. The health check does not test the DB secrets; this run does.
9. **HARD GATE: tunnel token.** `mmlabs-online/deployment/proxy/compose.yml` commits the cloudflared tunnel token in git. Before any public hostname is added, rotate the tunnel token in Cloudflare and move it out of git into a host env file (change made in the deployment repo, not this one). Do not continue until this is done and confirmed.
10. **Cloudflare Access application** (Zero Trust, Access, Applications, Self-hosted): application domain `<APP_HOSTNAME>`; one Allow policy with Include, Emails, Ming's email only; no bypass rules; note the session duration. Check in the dashboard that it is saved and the policy is attached.
11. **Then add the public hostname** (Networks, Tunnels, the mmlabs tunnel, Public hostname): `<APP_HOSTNAME>` to service `http://stoktok-web:3000`. Turn on the hostname's Access JWT check ("Protect with Access") and select the application from step 10.
    **Do not reorder steps 9, 10 and 11.** Access is the outer layer; stoktok's `/login` is the inner one.
12. Verify: in a private window `https://<APP_HOSTNAME>/` shows the Access login, not the app. After logging in with Ming's email, stoktok's `/login` shows; signing in with Ming's stoktok account (Restore auth, step 1) shows the dashboard, and "Đăng xuất" returns to `/login`. Submit one form (server actions check Origin/Host); if it fails, record a follow-up. `curl -sI https://<APP_HOSTNAME>/healthz` without a session gets the Access redirect (302/403), not 200.
13. To take it offline again: delete the public hostname first, then the Access application if wanted. Never the reverse.

## Roll back
- Automatic: if the new web image is not healthy within 120 s, `deploy-stoktok` restores the previous `apps/stoktok/`, redeploys it, republishes the scheduler directory and pushes the revert to deployment `main`. The run stays red.
- Manual: revert the release PR's merge commit on deployment `main`. That re-triggers `deploy-stoktok`. `workflow_dispatch` from `main` only (other branches are skipped) redeploys what main pins and rewrites the env file.
- **Migrations are not undone.** Roll back across a migration only when the old code works with the new schema.

## Logs
```
docker compose -p stoktok logs -f stoktok-web
tail -f /Users/mingming/stoktok/logs/eod-prices.log     # also financials.log, signals.log, schedule.log, launchd.log
```
`run --rm` discards the container's logs, which is why `run-job.sh` appends to host files.

## Env list
Names only. Values live in the `stoktok` environment secrets of the deployment repo, and `deploy-stoktok` writes the host env file; they are never in this repo (R3). Reserved variables are not passed to containers until a ticket reads them. Optional variables are always written to the env file; an empty value means the feature is off. Deploy-only variables: `STOKTOK_WEB_IMAGE`, `STOKTOK_WORKER_IMAGE` and `STOKTOK_VERSION`, written by `release.yml` into `release.env` (not secrets).

<!-- env-list:start -->
| Name | Service | Status | Secret |
|---|---|---|---|
| `SUPABASE_URL` | web, worker | required now | n |
| `SUPABASE_SERVICE_ROLE_KEY` | web, worker | required now | y |
| `SUPABASE_ANON_KEY` | none | reserved | y |
| `AUTHEN_SUPABASE_URL` | web | required now | n |
| `AUTHEN_SUPABASE_ANON_KEY` | web | required now | y |
| `ANTHROPIC_API_KEY` | web, worker | optional | y |
| `GOOGLE_AI_API_KEY` | web, worker | optional | y |
<!-- env-list:end -->

## Restart safety check
Spec section 7: the worker tolerates restarts. Automated coverage (`pnpm test`): `eod-sync.test.ts` (re-run gives the same rows except `fetched_at`, no new gaps), `financials-sync.test.ts` (same), `medium-signals.test.ts` (two runs identical except `computed_at`).

Manual check on the Mac:
1. Run each job twice (`/Users/mingming/stoktok/current/run-job.sh <job>`); row counts of `prices_daily`, `financials`, `signals`, `data_gaps` must not change on the second run.
2. Start `eod-prices`, `docker kill` the container mid-run, rerun, and confirm the counts match a clean run.
3. Resume is window-based: EOD recomputes the last 20 trading days, financials the last 12 quarters, with idempotent upserts. Outages longer than that need the STK-032 backfill.
4. Overlap: `run-job.sh` takes one shared `mkdir` lock (waits up to 30 min, clears a stale lock), so jobs never run concurrently; a timeout exits 1. launchd never runs one job twice at once, and slots missed during sleep coalesce into one run on wake.

## Exit codes
- 0: ok. Nothing to do.
- 1: fatal error, lock timeout or wrong time zone. Read `/Users/mingming/stoktok/logs/<job>.log`; the next scheduled run retries.
- 2: usage error (bad job name or flag). Fix the caller.
