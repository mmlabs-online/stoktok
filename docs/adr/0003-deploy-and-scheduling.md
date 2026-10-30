# ADR 0003: Deployment and job scheduling

Status: accepted (STK-018)

## Context
Spec section 7: Docker Compose on the WSL home server, shared deploy repo, Cloudflare Tunnel. The worker image (STK-017) is one-shot: one container run per job, no scheduler inside.

## Decision
- Host cron in the WSL distro (needs `systemd=true` in `/etc/wsl.conf` and the cron service enabled) calls `deploy/run-job.sh <job>`, which runs `docker compose run --rm stoktok-worker <job>` under one shared `flock` and appends output to host log files.
- `stoktok-worker` has `restart: "no"` and `profiles: [jobs]`, so `compose up -d` never starts it. `stoktok-web` uses `unless-stopped`.
- No host ports are published. The web origin is reachable only through cloudflared on the shared network. Public reachability is gated by go-live gate G1 in `docs/deploy.md` (Cloudflare Access or STK-004), because R6 is suspended.

## Rejected
- Ofelia: needs the Docker socket (root-equivalent).
- supercronic in the image: changes the STK-017 image.
- In-process scheduler: new code, out of scope.

## Consequences
Jobs are idempotent and window-based, so a missed or killed run is recovered by the next one (up to the window; longer outages need the STK-032 backfill).
