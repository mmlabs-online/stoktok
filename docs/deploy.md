# Deploy runbook (STK-018, STK-037)

Decisions: `docs/adr/0003-deploy-and-scheduling.md`. Drafts for the deployment repo: `deploy/deployment-repo/` (see its README). Only Ming merges.

## Flow
Every push to branch `release` (its commit must already be on main) runs `release.yml`: it takes the next version (last `vX.Y.Z` tag, patch +1; `v0.1.0` if none), creates and pushes that git tag, builds and pushes `stoktok-web` and `stoktok-worker`, then it opens PR `release/stoktok-vX.Y.Z` on `mmlabs-online/deployment` (only `apps/stoktok/release.env`, both images pinned by digest). Merging it runs `deploy-stoktok` on `macbook-runner`: pull, `up -d --wait` on `/healthz`, then publish compose, `release.env` and the job scripts to `/Users/gh-runner/stoktok/current`. A launchd job reads that directory and runs the worker jobs.

## Placeholders and gates
| Placeholder | Value | Status |
|---|---|---|
| `APP_HOSTNAME` | `stoktok.mmlabs.online` | confirmed by Ming (G2). Set only in the Cloudflare dashboard; no file in either repo holds it |
| Log dir (`STOKTOK_LOG_DIR`) | `/Users/gh-runner/stoktok/logs` | default |

- **G1:** the Cloudflare Access application exists and is verified **before** any public hostname for `stoktok-web:3000` is added. It is a step of the v0.1.0 cut below.
- No auth code is in the app (R6 suspended). Access is the only gate until STK-004.

## Preconditions on the Mac
- **D1:** the Docker engine is OrbStack and starts at boot for `gh-runner` without a GUI login. Check: reboot, do not log in, run the `runner-check` workflow and see it green. The launchd jobs run in the same context.
- **D2:** time zone is Asia/Ho_Chi_Minh (`sudo systemsetup -gettimezone`; `run-schedule.sh` refuses to run if `date +%z` is not `+0700`). Sleep is off (`sudo pmset -a sleep 0 disablesleep 1`, or lid open on power), otherwise deploys queue and jobs coalesce on wake.
- **D3:** the Mac is Intel, so the `linux/amd64` images run natively.
- **D4:** secrets file `/Users/gh-runner/.config/stoktok/stoktok.env`, mode 600, owner `gh-runner`, outside git and the runner checkout. It holds only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Repository secrets
In the stoktok repo (Settings, Secrets and variables, Actions):
- `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`: push to `mingming21400/stoktok-*`.
- `DEPLOY_REPO_TOKEN`: fine-grained PAT on `mmlabs-online/deployment` only. Contents read/write, Pull requests read/write.

## One-time setup
1. Ming merges the deployment-repo setup PR (drafts in `deploy/deployment-repo/`, plus the CODEOWNERS line). Its deploy run skips: there is no `release.env` yet.
2. Create the secrets file: `sudo install -d -o gh-runner -m 700 /Users/gh-runner/.config/stoktok`, then a mode 600 file owned by `gh-runner` (create it with `sudo install -o gh-runner -m 600`) with `SUPABASE_URL=` and `SUPABASE_SERVICE_ROLE_KEY=`.3. `sudo install -d -o gh-runner -m 755 /Users/gh-runner/stoktok/logs`.
4. Install the scheduler: `sudo cp apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist /Library/LaunchDaemons/`, `sudo chown root:wheel` and `sudo chmod 644` on it, then `sudo launchctl bootstrap system /Library/LaunchDaemons/online.mmlabs.stoktok.jobs.plist`. Verify with `sudo launchctl print system/online.mmlabs.stoktok.jobs`.
5. Optional log rotation: a line for `/Users/gh-runner/stoktok/logs/*.log` in `/etc/newsyslog.d/stoktok.conf`.

## Cut a release (first one is v0.1.0)
1. Apply pending migrations by hand. Every migration must work with the previous image.
2. Promote main: `git fetch origin && git push origin origin/main:refs/heads/release` (fast-forward `release` to main; never commit to `release` directly). The workflow picks the version and pushes the tag; do not tag by hand, except to bump minor/major (tag `vX.Y.0` on an already released commit, then the next push continues from it).
3. Watch the `release` run. It fails before any PR if the commit is not on main, the commit is already released, a secret is missing, or an image check fails. A failed run still consumes its version tag; the next push takes the next patch.
4. Review the release PR: only `apps/stoktok/release.env`, both digests.
5. Merge it.
6. Read the `deploy-stoktok` comment on the PR.
7. Verify (OrbStack runs per user, so run docker as `gh-runner`): `sudo -u gh-runner -H docker compose -p stoktok ps` shows web healthy, and `sudo -u gh-runner -H docker compose -p stoktok exec stoktok-web node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>r.text()).then(console.log)"` shows `v0.1.0`.
8. Run `sudo -u gh-runner -H /Users/gh-runner/stoktok/current/run-job.sh eod-prices --dry-run`. The health check does not test the DB secrets; this run does.
9. **HARD GATE: tunnel token.** `mmlabs-online/deployment/proxy/compose.yml` commits the cloudflared tunnel token in git. Before any public hostname is added, rotate the tunnel token in Cloudflare and move it out of git into a host env file (change made in the deployment repo, not this one). Do not continue until this is done and confirmed.
10. **Cloudflare Access application** (Zero Trust, Access, Applications, Self-hosted): application domain `<APP_HOSTNAME>`; one Allow policy with Include, Emails, Ming's email only; no bypass rules; note the session duration. Check in the dashboard that it is saved and the policy is attached.
11. **Then add the public hostname** (Networks, Tunnels, the mmlabs tunnel, Public hostname): `<APP_HOSTNAME>` to service `http://stoktok-web:3000`. Turn on the hostname's Access JWT check ("Protect with Access") and select the application from step 10.
    **Do not reorder steps 9, 10 and 11.** A hostname without Access exposes the portfolio, because the app has no auth.
12. Verify: in a private window `https://<APP_HOSTNAME>/` shows the Access login, not the app. After logging in with Ming's email the dashboard loads. Submit one form (server actions check Origin/Host); if it fails, record a follow-up. `curl -sI https://<APP_HOSTNAME>/healthz` without a session gets the Access redirect (302/403), not 200.
13. To take it offline again: delete the public hostname first, then the Access application if wanted. Never the reverse.

## Roll back
- Automatic: if the new web image is not healthy within 120 s, `deploy-stoktok` restores the previous `apps/stoktok/`, redeploys it, republishes the scheduler directory and pushes the revert to deployment `main`. The run stays red.
- Manual: revert the release PR's merge commit on deployment `main`. That re-triggers `deploy-stoktok`. `workflow_dispatch` redeploys what main pins.
- **Migrations are not undone.** Roll back across a migration only when the old code works with the new schema.

## Logs
```
sudo -u gh-runner -H docker compose -p stoktok logs -f stoktok-web
tail -f /Users/gh-runner/stoktok/logs/eod-prices.log     # also financials.log, signals.log, schedule.log, launchd.log
```
`run --rm` discards the container's logs, which is why `run-job.sh` appends to host files.

## Env list
Names only. Values live in the host env file, never in this repo (R3). Reserved variables are not passed to containers until a ticket reads them. Deploy-only variables: `STOKTOK_WEB_IMAGE`, `STOKTOK_WORKER_IMAGE` and `STOKTOK_VERSION`, written by `release.yml` into `release.env` (not secrets).

<!-- env-list:start -->
| Name | Service | Status | Secret |
|---|---|---|---|
| `SUPABASE_URL` | web, worker | required now | n |
| `SUPABASE_SERVICE_ROLE_KEY` | web, worker | required now | y |
| `SUPABASE_ANON_KEY` | none | reserved | y |
| `AUTHEN_SUPABASE_URL` | none | reserved | n |
| `AUTHEN_JWT_SECRET` | none | reserved | y |
| `ALLOWLIST_USER_IDS` | none | reserved | n |
| `LLM_PROVIDER` | none | reserved | n |
| `LLM_API_KEY` | none | reserved | y |
<!-- env-list:end -->

## Restart safety check
Spec section 7: the worker tolerates restarts. Automated coverage (`pnpm test`): `eod-sync.test.ts` (re-run gives the same rows except `fetched_at`, no new gaps), `financials-sync.test.ts` (same), `medium-signals.test.ts` (two runs identical except `computed_at`).

Manual check on the Mac:
1. Run each job twice (`sudo -u gh-runner -H /Users/gh-runner/stoktok/current/run-job.sh <job>`); row counts of `prices_daily`, `financials`, `signals`, `data_gaps` must not change on the second run.
2. Start `eod-prices`, `sudo -u gh-runner -H docker kill` the container mid-run, rerun, and confirm the counts match a clean run.
3. Resume is window-based: EOD recomputes the last 20 trading days, financials the last 12 quarters, with idempotent upserts. Outages longer than that need the STK-032 backfill.
4. Overlap: `run-job.sh` takes one shared `mkdir` lock (waits up to 30 min, clears a stale lock), so jobs never run concurrently; a timeout exits 1. launchd never runs one job twice at once, and slots missed during sleep coalesce into one run on wake.

## Exit codes
- 0: ok. Nothing to do.
- 1: fatal error, lock timeout or wrong time zone. Read `/Users/gh-runner/stoktok/logs/<job>.log`; the next scheduled run retries.
- 2: usage error (bad job name or flag). Fix the caller.
