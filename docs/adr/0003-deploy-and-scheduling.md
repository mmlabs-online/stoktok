# ADR 0003: Deployment and job scheduling

Status: accepted (STK-018), amended (STK-037, STK-044)

## Context
Spec section 7: Docker Compose, shared deploy repo, Cloudflare Tunnel. The worker image (STK-017) is one-shot: one container run per job, no scheduler inside. STK-037 (Ming, 2026-10-30): the home server is the Mac running `macbook-runner`; `mmlabs-server` (WSL) is retired.

## Decision
- Release by tag through the deployment repo: `release.yml` pushes `vX.Y.Z` images and opens a PR that writes `apps/stoktok/release.env`; merging runs `deploy-stoktok` on the self-hosted `macbook-runner`. Only digest-pinned version tags are deployed. CI keeps pushing `:<sha>` and `:latest` on main, but those are never deployed.
- Engine: OrbStack on an Intel Mac (amd64 native), time zone UTC+7.
- `stoktok-web` joins the external network `web` and is published only through a Cloudflare dashboard hostname that sits behind a Cloudflare Access application created first (gate G1 in `docs/deploy.md`), because R6 is suspended. No host ports. `stoktok-worker` stays on the project default network.
- Jobs are scheduled by a launchd LaunchAgent of the runner user (`mingming`), not cron: it catches up after sleep, needs no Full Disk Access, and macOS has no `flock`. `run-schedule.sh` picks the chain by local hour and `run-job.sh` runs one job under a `mkdir` lock. `stoktok-worker` has `restart: "no"` and `profiles: [jobs]`, so `up -d` never starts it.
- Secrets sit in a host `env_file` outside the runner checkout (`/Users/mingming/.config/stoktok/stoktok.env`), as in the recordin precedent.
- The scheduler reads a published copy (`/Users/mingming/stoktok/current`), not the runner's `_work` checkout.
- Health is `/healthz`, which does not touch the database.

## Superseded
- WSL host cron with `systemd=true`, `flock`, and `deploy/run-job.sh`.
- `STOKTOK_TAG` (commit SHA) and a `.env` next to the compose file.
- `deploy/cloudflared-ingress.example.yml`: the tunnel is remotely managed.

## Rejected
- Ofelia: needs the Docker socket (root-equivalent).
- supercronic in the image: changes the STK-017 image.
- In-process scheduler: new code, out of scope.
- Publishing `127.0.0.1:<port>`: departs from the deployment repo convention.
- In-app login: R6 is suspended, so Cloudflare Access is the gate.

## Consequences
Jobs are idempotent and window-based, so a missed or killed run is recovered by the next one (up to the window; longer outages need the STK-032 backfill).

## Amendment (STK-044, 2026-11-03)
The first deploy failed at the `secrets` step: the drafts assumed a dedicated runner user, but the runner `macbook-runner` runs as `mingming` (`/Users/mingming/actions-runner`), and Ming chose to keep it there (2026-11-03). All paths now sit under `/Users/mingming`, and the owner checks compare against `$(id -un)`.
The scheduler is a LaunchAgent, not a LaunchDaemon: the runner service and OrbStack are per-user and only exist in the logged-in session, so a daemon could fire where docker is unreachable. Consequence: no deploys or scheduled jobs while `mingming` is not logged in. The env file now lives in a personal home directory (Time Machine exclusion, see D4).
