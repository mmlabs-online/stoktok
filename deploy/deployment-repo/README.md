# Drafts for mmlabs-online/deployment

These files mirror their target paths in the deployment repo. Copy them verbatim into a setup PR
on `mmlabs-online/deployment` (not a `release/*` branch, so `pr-scope` does not restrict it).

| Here | Goes to |
|---|---|
| `apps/stoktok/compose.yml` | `apps/stoktok/compose.yml` |
| `apps/stoktok/run-job.sh`, `run-schedule.sh` | `apps/stoktok/` (deploy-stoktok publishes them to `/Users/mingming/stoktok/current`) |
| `apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist` | `apps/stoktok/launchd/` (published to `$SCHED_DIR` and installed by deploy-stoktok) |
| `.github/workflows/deploy-stoktok.yml` | `.github/workflows/deploy-stoktok.yml` |
| `.github/workflows/runner-check.yml` | `.github/workflows/runner-check.yml` (shared by every app; STK-044 only changes the expected runner user to `mingming`) |

STK-084 (shared Postgres; B / STK-092 is merged, C is the STK-093 deployment PR): copy `apps/stoktok/compose.yml` and `.github/workflows/deploy-stoktok.yml`
only after `bash postgres/scripts/add-app-db.sh stoktok` has been merged (it creates
`postgres/secrets/apps/stoktok.password`, which deploy-stoktok reads), and set the `stoktok` environment
secret `STOKTOK_AI_KEYS_MASTER_KEY`. See `docs/deploy.md`, Shared Postgres.

The `/apps/stoktok/` line in the deployment repo's `.github/CODEOWNERS` already exists; nothing to add.

`apps/stoktok/release.env` is not drafted: the stoktok release workflow writes it. Until it exists,
deploy-stoktok skips, so merging the setup PR deploys nothing.

No hostname or ingress rule belongs in either repo: cloudflared is remotely managed (Cloudflare
dashboard). The secrets come from the `stoktok` environment of the deployment repo; deploy-stoktok
writes `/Users/mingming/.config/stoktok/stoktok.env` on the Mac from them (R3). Create the
environment and its secrets before merging the setup PR: see `docs/deploy.md`.
