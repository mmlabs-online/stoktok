# Deploy runbook (STK-018)

Compose snippet: `deploy/compose.stoktok.yml`. Decisions: `docs/adr/0003-deploy-and-scheduling.md`.

## Placeholders and go-live gates

| Placeholder | Value | Status |
|---|---|---|
| `APP_HOSTNAME` | `stoktok.mmlabs.online` | pending spec section 9 Q7 |
| `STOKTOK_TUNNEL_NETWORK` | `mmlabs` | confirm from the deploy repo |
| Log dir (`STOKTOK_LOG_DIR`) | `$HOME/stoktok-logs` | default |

- **G1 (before the ingress route or DNS record exists):** a Cloudflare Access application on the hostname with a policy allowing only Ming's email, **or** STK-004 DONE with R6 restored. Ming decides; Access is recommended. Auth is off in the app today.
- **G2:** the hostname is confirmed.

## Prerequisites
- Images exist for the SHA: `docker manifest inspect mingming21400/stoktok-web:<sha>` (needs `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` set in GitHub so CI pushes).
- WSL has `systemd=true` in `/etc/wsl.conf`, cron is enabled, Docker starts on boot.
- Host timezone is `Asia/Ho_Chi_Minh` (`date`).

## Files to copy into the deploy repo
`deploy/compose.stoktok.yml`, `deploy/run-job.sh`, `deploy/crontab.example` (as the crontab), and the rule from `deploy/cloudflared-ingress.example.yml` (only after G1).

## Env list
Names only. Values live in the deploy repo's env handling, never in this repo (R3). Reserved variables are not passed to containers until a ticket reads them. Deploy-only variables: `STOKTOK_TAG` (image tag, a commit SHA) and `STOKTOK_TUNNEL_NETWORK`.

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

## First deploy / go-live
1. Copy the files above into the deploy repo; set env there.
2. `STOKTOK_TAG=<sha> docker compose -f compose.stoktok.yml up -d stoktok-web` (still private, no host ports).
3. Verify from the host: `docker compose -f compose.stoktok.yml exec stoktok-web node -e "fetch('http://localhost:3000/').then(r=>console.log(r.status))"`.
4. Gate G1, then G2.
5. Add the ingress rule and run `cloudflared tunnel route dns <tunnel> <APP_HOSTNAME>`.
6. In the browser: check Access prompts for login, then submit one form (server actions check Origin/Host).
7. Install the crontab (`crontab -e`, from `deploy/crontab.example`).

## Deploy
```
# apply migrations first if the release has any
export STOKTOK_TAG=<sha>
docker compose -f compose.stoktok.yml pull
docker compose -f compose.stoktok.yml up -d stoktok-web
```
The worker picks up the tag on its next run.

## Roll back
Set `STOKTOK_TAG` to the previous SHA (`docker image ls mingming21400/stoktok-web` or the git log), then run the same `pull` and `up -d`. **Rollback does not undo migrations** (they are forward-only); roll back across a migration only when the old code works with the new schema.

## Logs
```
docker logs -f --tail 200 stoktok-web
tail -f ~/stoktok-logs/eod-prices.log      # also financials.log, signals.log
```
`run --rm` discards the container's logs, which is why `run-job.sh` appends to host files. Rotation, in `/etc/logrotate.d/stoktok`:
```
/home/<user>/stoktok-logs/*.log { weekly rotate 8 compress missingok notifempty copytruncate }
```

## Restart safety check
Spec section 7: the worker tolerates restarts. Automated coverage (`pnpm test`): `eod-sync.test.ts` (re-run gives the same rows except `fetched_at`, no new gaps), `financials-sync.test.ts` (same), `medium-signals.test.ts` (two runs identical except `computed_at`).

Manual check on the server:
1. Run each job twice (`run-job.sh <job>`); row counts of `prices_daily`, `financials`, `signals`, `data_gaps` must not change on the second run.
2. Start `eod-prices`, `docker kill` the container mid-run, rerun, and confirm the counts match a clean run.
3. Resume is window-based: EOD recomputes the last 20 trading days, financials the last 12 quarters, with idempotent upserts. Outages longer than that need the STK-032 backfill.
4. Overlap: `run-job.sh` takes one shared `flock` (waits up to 30 min), so jobs never run concurrently; a timeout exits 1.

## Exit codes
- 0: ok. Nothing to do.
- 1: fatal error or lock timeout. Read `~/stoktok-logs/<job>.log`; the next scheduled run retries.
- 2: usage error (bad job name or flag). Fix the crontab line.
