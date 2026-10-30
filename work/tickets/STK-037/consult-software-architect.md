## STK-037 — Software Architect consult

### Findings
1. **Deploy repo conventions** (calechip, recordin):
   - The app's `apps/<app>/compose.yml` sets a top-level `name:` and gets the image only from `${X_IMAGE:?}` in `release.env`. The deploy workflow validates that value with a regex (`repo:vX.Y.Z@sha256:<64hex>`).
   - The compose file has no ports and joins the external network `name: web`.
   - Deploy runs `config --quiet` → `pull` → `up -d --wait --wait-timeout 120`. If that fails, it does `git restore` from `BEFORE`, redeploys the old version, pushes a revert and comments on the release PR.
   - `pr-scope.yml` only lets `release/<app>-v*` PRs touch `apps/<app>/`.
   - There is no migrate step. Every migration must also work with the previous image.
2. **Secrets precedent already exists.** Calechip has none, but recordin does. It uses `env_file: /srv/recordin/recordin.env`, kept outside the checkout because "the runner's checkout deletes untracked files". If the file is missing, `config` fails and nothing starts. stoktok should copy this, with one change: on macOS `/` is read-only, so `/srv` cannot be used. Use something like `/Users/gh-runner/.config/stoktok/stoktok.env`, mode 600, owned by gh-runner. Compose reads `env_file` on the client side, so Docker Desktop file sharing doesn't matter.
3. **Runner label.** calechip and recordin use `runs-on: self-hosted`. `runner-check.yml` uses `[self-hosted, macbook-runner]`. The AC asks for macbook-runner, so `deploy-stoktok.yml` should use the explicit label pair.
4. **The healthcheck in the calechip/recordin style would fail for stoktok.**
   - Both web and worker images are `node:22-bookworm-slim`, which has no `wget` or `curl`. Use `["CMD","node","-e","fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]`.
   - Also set `HOSTNAME: 0.0.0.0` in compose `environment`, as recordin does. The Dockerfile `ENV` should already handle it, but it costs nothing.
5. **Compose profiles affect pull.** `docker compose pull` and `config` skip services behind an inactive profile. With the worker under `profiles: [jobs]`, the calechip-style `pull` would never fetch the new worker image, so the first scheduled job would pull at run time or fail. Deploy needs `--profile jobs pull`, then `up -d --wait` **without** the profile.
6. **The current stoktok drafts no longer match.**
   - `compose.stoktok.yml` uses `STOKTOK_TAG` (a SHA), `${SUPABASE_*:?}` interpolation, network `mmlabs`, and `container_name`.
   - `run-job.sh` uses `flock`, which macOS doesn't ship, and `date -Is`, which is GNU-only or unreliable on BSD date.
   - The crontab, ADR 0003 and `docs/deploy.md` all assume WSL, systemd and cron.
   - `cloudflared-ingress.example.yml` doesn't apply, because the tunnel is remotely managed.
   - `scripts/check-deploy-env.sh` has `DEPLOY_ONLY="STOKTOK_TAG STOKTOK_TUNNEL_NETWORK"` hard-coded and checks only `deploy/compose.stoktok.yml`.
7. **CI pushes on main.** `ci.yml` pushes `stoktok-{web,worker}:<sha>` and `:latest` to the same Docker Hub repos that the release will use.
8. **Image architecture.** Images are built on `ubuntu-latest`, so they are amd64 only. If the MacBook is Apple Silicon they run under emulation. That's fine for web; it's slower for the worker.

### Recommendations
- **Two images in one `release.env`** (AC1). One job with two `docker/build-push-action` steps (`id: web`, `id: worker`), not a matrix, because matrix job outputs can't carry two digests cleanly. Write:
  ```
  # Written by the stoktok release workflow for $TAG (commit $SHA). Do not edit by hand.
  STOKTOK_WEB_IMAGE=mingming21400/stoktok-web:$TAG@$WEB_DIGEST
  STOKTOK_WORKER_IMAGE=mingming21400/stoktok-worker:$TAG@$WORKER_DIGEST
  STOKTOK_VERSION=$TAG
  ```
  - Keep `APP=stoktok` so the branch is `release/stoktok-vX.Y.Z` and pr-scope matches.
  - Before pushing, run the existing secret-in-image check and the web/worker smoke tests on the release images. Either build with `load: true`, test, then push, or reuse a reusable workflow.
  - Add a cheap guard: the tag's commit must be an ancestor of `origin/main`.
  - Tag pattern: copy the template's glob `v[0-9]+.[0-9]+.[0-9]+*`.
- **`deploy-stoktok.yml`** (AC4): copy `deploy-recordin.yml`, including `workflow_dispatch`, then change:
  - `runs-on: [self-hosted, macbook-runner]`.
  - Validate both image lines with their own regex, and check both carry the same `vX.Y.Z`.
  - `previous` = both lines from `BEFORE`.
  - Check the env file exists (`test -r`) and has the key names (`grep -q '^SUPABASE_URL='`, `grep -q '^SUPABASE_SERVICE_ROLE_KEY='`), never printing values.
  - `--profile jobs pull` (Finding 5).
  - After a healthy `up`, copy `compose.yml` and `release.env` into a stable directory such as `~gh-runner/stoktok/current/` so the scheduler never reads `_work/`, which other workflows' checkouts change. The rollback path also copies, so the worker follows the rolled-back version.
- **`apps/stoktok/compose.yml`** (AC3/AC4):
  - `name: stoktok`.
  - `stoktok-web`: `${STOKTOK_WEB_IMAGE:?…}`, `env_file: <host path>`, `HOSTNAME`/`TZ`/`STOKTOK_VERSION` in `environment`, the node-fetch healthcheck, keep log rotation.
  - `stoktok-worker`: `${STOKTOK_WORKER_IMAGE:?}`, the same `env_file`, `restart: "no"`, `profiles: [jobs]`.
  - Drop `container_name`; logs via `docker compose -p stoktok logs`.
  - Put the worker on the project's default network, not `web`. It only needs internet egress, and keeping it off `web` reduces lateral reach.
- **Single source for drafts.** Keep the deployment-repo drafts verbatim in stoktok, e.g. `deploy/deployment-repo/apps/stoktok/{compose.yml,run-job.sh,launchd/*.plist}` and `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml`, as calechip does under `docs/ops/deployment-repo/`. Either delete `deploy/compose.stoktok.yml` or make it that file. Update `check-deploy-env.sh` to scan the new path, set `DEPLOY_ONLY` to `STOKTOK_WEB_IMAGE STOKTOK_WORKER_IMAGE STOKTOK_VERSION`, and fail if `SUPABASE_*` appears as `${…}` interpolation (it must come only via `env_file`). That last check is a cheap R3 guard. Also add `/apps/stoktok/` to CODEOWNERS in the setup PR.
- **Worker scheduling on the Mac** (AC3): use **launchd, not cron**.
  - Option A, launchd (recommended): a `StartCalendarInterval` job runs a missed slot once when the Mac wakes. Cron skips it, and cron on macOS also needs Full Disk Access. Install it as a LaunchDaemon with `UserName gh-runner` so it runs without a login session and can read the 600 env file and reach Docker.
  - Option B, cron: simpler, but has the silent-miss problem.
  - With launchd, replace the five cron lines with **two chained entries**: 18:30 runs `eod-prices; financials; signals`, and 21:00 runs `eod-prices; signals`. Inside a chain the jobs run in order, so you don't need `flock`. Use `;` so one failure doesn't block the rest. If you keep a lock, use `mkdir`-based locking or `/usr/bin/shlock`.
  - The plist must set `PATH` to include the Docker CLI (`/usr/local/bin` and/or `/opt/homebrew/bin`).
  - `run-job.sh` should call `docker compose -p stoktok -f ~/stoktok/current/compose.yml --env-file ~/stoktok/current/release.env --profile jobs run --rm stoktok-worker "$@"` and use a portable `date -u +%FT%TZ`.
  - launchd uses the Mac's local time zone. Require Asia/Ho_Chi_Minh or convert the times, and document it.
- **`/healthz`** (AC2): `apps/web/app/healthz/route.ts` with `export const dynamic = 'force-dynamic'`. It returns 200 with `ok` plus `STOKTOK_VERSION` and must import nothing from the DB/Supabase modules, so a bad secret can't trigger a restart-loop rollback. Test the handler directly with Vitest. Point CI's web smoke test at `/healthz` too.
- **Keeping v0.1.0 private** (AC5): two options.
  - Option A, join `web` with no hostname in the dashboard (matches the AC and convention). The app is reachable only from containers on `web`. The risk is that someone adds a hostname in the dashboard before Access exists.
  - Option B, don't join `web`; publish `127.0.0.1:<port>:3000` for local use. Cloudflared physically can't reach it, so a wrong hostname gives a 502, not portfolio data. This departs from AC3's "external network `web`".
  - I recommend A as the AC says, with runbook gate G1 rewritten for the dashboard flow: create the Access application *before* adding the public hostname. Ming should confirm, because with A there is no way for him to *use* v0.1.0 (see Open questions).
- **CI push-on-main.** Stop pushing from `ci.yml`. Keep build, smoke and secret checks on PRs and main, and make `release.yml` the only publisher. The `:latest` and SHA tags in the same repos contradict "never :latest" and let an untested-by-release image be mistaken for a release. Alternative: keep pushing SHA tags but to `stoktok-*-ci` repos. That costs more and gains nothing here.
- **Runbook / ADR 0003.**
  - Supersede the WSL/cron sections: macbook-runner, launchd, secrets file location and permissions, required repo secrets (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `DEPLOY_REPO_TOKEN` — a fine-grained PAT on deployment only, with Contents and PRs read/write).
  - Release steps: apply migrations by hand first → `git tag v0.1.0 && git push --tags` → merge the release PR → check the PR comment.
  - Rollback: revert the release PR's commit on deployment main, which re-triggers the deploy. It does not undo migrations.
  - Mac power: disable sleep with `pmset`, or both deploys and jobs stall.

### Risks
- A MacBook that sleeps or closes its lid stalls both deploys and jobs. launchd softens this for jobs; deploys only queue.
- Because the healthcheck never touches the DB, a wrong `SUPABASE_*` value deploys "healthy". Only the key-name check catches a missing value. Accept this, or add a post-deploy one-shot worker dry-run that doesn't fail the deploy.
- No migration step: a schema change merged before its migration is applied breaks the app, and a rollback does not undo migrations.
- If this is an Apple Silicon Mac, amd64-only images run under emulation. A multi-arch build (`platforms: linux/amd64,linux/arm64`) slows the release and is incompatible with `load: true` smoke tests unless handled separately.
- With Option A, other apps' containers on `web` can reach stoktok-web, which has no auth (R6 suspended).
- `proxy/compose.yml` commits the tunnel token. It's already flagged; with that token anyone can run the tunnel, which matters once a stoktok hostname exists.

### Open questions (for Ming)
1. How does Ming use v0.1.0 while it's private? With no hostname and no port it's reachable only from inside Docker. Options: a localhost port on the Mac, Tailscale, or accept "deployed but unused" until Access is set up. The answer decides Option A vs B.
2. Docker engine on the Mac (Docker Desktop, Colima or OrbStack), and does it start without a GUI login for gh-runner? This affects running the launchd jobs as a LaunchDaemon.
3. Mac CPU architecture (arm64?) and time zone (Asia/Ho_Chi_Minh?).
4. Where should the secrets file live (proposed `/Users/gh-runner/.config/stoktok/stoktok.env`, 600), and who creates it?
5. Is dropping the image push from CI acceptable?

Files: `/home/user/stoktok/deploy/compose.stoktok.yml`, `/home/user/stoktok/deploy/run-job.sh`, `/home/user/stoktok/deploy/crontab.example`, `/home/user/stoktok/scripts/check-deploy-env.sh`, `/home/user/stoktok/.github/workflows/ci.yml`, `/home/user/stoktok/docs/deploy.md`, `/home/user/stoktok/docs/adr/0003-deploy-and-scheduling.md`, `/home/user/stoktok/apps/web/Dockerfile`; reference: `/home/user/deployment/docs/app-release.yml`, `/home/user/deployment/.github/workflows/deploy-recordin.yml` (best template — has workflow_dispatch), `/home/user/deployment/apps/recordin/compose.yml` (env_file secrets precedent), `/home/user/deployment/.github/workflows/runner-check.yml` (runner label).
