Status: READY

# Plan — STK-037: Release workflow and deployment-repo integration

## Spec summary
docs/spec-v1.md §7 Deployment:
> - App repo (private): CI and image build on GitHub-hosted runners, images pushed to the Docker Hub account used by other mmlabs apps.
> - Shared deploy repo: Compose definitions + env; deploy jobs on the self-hosted runner on the home server.
> - Subdomain under mmlabs.online, exposed via the existing Cloudflare Tunnel.
> - Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo.
> - `worker` must tolerate restarts: jobs are idempotent and resume from last successful run.

§4.1 Services: `web` (Next.js UI), `worker` (scheduled jobs). Heading says "Docker Compose on WSL, same network as cloudflared".

CLAUDE.md: R3 (service key server-only), R6 suspended (no auth code; nothing public before Access or STK-004), R7, R8. Ticket notes from Ming (2026-10-30): **v0.1.0**, runner **macbook-runner** (`mmlabs-server` retired), worker cron runs on the Mac, cloudflared is remotely managed (hostnames and Access are set in the Cloudflare dashboard).

Ming's answers to the consult (ticket, 2026-10-30):
> 1. Access to v0.1.0: **public behind Cloudflare Access** (Ming's email). No auth code in the app (R6 still suspended); Ming sets up the Access application before the hostname is added.
> 2. Docker engine on the Mac: **OrbStack**.
> 3. Mac CPU: **Intel** (amd64, no emulation). Time zone: **UTC+7** (Asia/Ho_Chi_Minh).
> 4. Secrets file: … outside git, mode 600, created by Ming (path per plan default).
> 5. CI image push: **keep it**.

**AC5 / Goal wording conflict (flag, not blocking):** the Goal and AC5 still say "private: no public hostname". Answer 1 is Ming's later and more specific decision. This plan reads AC5 as: v0.1.0 is reachable only by Ming, through a hostname that sits behind a Cloudflare Access application created **before** the hostname exists. AC5's core rule, "Cloudflare Access must exist before any hostname is added", still holds unchanged. The orchestrator should update the AC5 and Goal text to match answer 1.

**Spec conflict (flag only, do not edit):** §4.1 heading and the CLAUDE.md "Runtime" row still say WSL2. Ming's 2026-10-30 note (Mac runner) wins for this ticket. Updating the spec and CLAUDE.md is a follow-up for Ming (see Assumptions A9).

Deployment-repo conventions this plan follows (read from `/home/user/deployment`): `docs/app-release.yml` (release template), `.github/workflows/deploy-recordin.yml` (deploy template, has `workflow_dispatch`), `apps/recordin/compose.yml` (`env_file` outside the checkout for secrets), `apps/calechip/compose.yml` (`/healthz`), `.github/workflows/runner-check.yml` (`runs-on: [self-hosted, macbook-runner]`, user `gh-runner`), `.github/workflows/pr-scope.yml` (release branches may change only `apps/<app>/`), `.github/CODEOWNERS`.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | `.github/workflows/release.yml` runs on tags `vX.Y.Z`, builds and pushes `stoktok-web` and `stoktok-worker` tagged with the version, then opens a PR `release/stoktok-vX.Y.Z` on `mmlabs-online/deployment` that changes only `apps/stoktok/release.env`, with both images pinned by digest. | Read `release.yml`: trigger `tags: ['v[0-9]+.[0-9]+.[0-9]+*']`; strict tag regex and "commit is on `origin/main`" guards; two `docker/build-push-action` steps (`id: web`, `id: worker`) with `push: true`, tag `mingming21400/stoktok-<app>:${TAG}`; each image is pulled **by digest** and passed through `scripts/check-image.sh` before the PR step; the PR step writes exactly the `STOKTOK_WEB_IMAGE=…:$TAG@$WEB_DIGEST`, `STOKTOK_WORKER_IMAGE=…:$TAG@$WORKER_DIGEST` and `STOKTOK_VERSION=$TAG` lines, runs `git add apps/stoktok/release.env` (not `commit -am`, which skips a new file), uses branch `release/stoktok-$TAG`, and stages nothing else. `pnpm check:deploy-env` checks that the keys `release.yml` writes match the variables the draft compose reads. The workflow runs for real only when Ming pushes the tag. It is not run in this ticket. |
| 2 | The web app has a `/healthz` route that answers without touching the database, with a test. | `pnpm --filter @stoktok/web test` → `test/healthz.test.ts` passes: 200, JSON `status: "ok"`, version echoed, `cache-control: no-store`, works with `SUPABASE_*` unset, and the route source has no imports from `@stoktok/db`, `@supabase/*` or `lib/` server modules. The CI web smoke step (via `scripts/check-image.sh web`) requires `GET /healthz` = 200 from inside the container. |
| 3 | `deploy/compose.stoktok.yml`, `docs/deploy.md` and ADR 0003 match the deployment repo's real conventions: external network `web`, images from `release.env`, a web healthcheck, the self-hosted runner `macbook-runner` (not WSL), and worker jobs scheduled on that Mac. | The compose file now lives at `deploy/deployment-repo/apps/stoktok/compose.yml`, the single source. `deploy/compose.stoktok.yml` is deleted (AC wording: the file that "matches" is the draft; see Approach step 3). Check it has `name: stoktok`, `${STOKTOK_WEB_IMAGE:?…}` / `${STOKTOK_WORKER_IMAGE:?…}`, external network `name: web` for web only, a node-based `/healthz` healthcheck, no `ports:`, no `container_name`, and no `${SUPABASE_…}`. `pnpm check:deploy-env` enforces those properties. `docs/deploy.md` and ADR 0003 name `macbook-runner`, launchd on the Mac, and the secrets file path. `grep -rniE 'wsl\|systemd\|crontab\|flock' docs/deploy.md docs/adr/0003-deploy-and-scheduling.md deploy/` hits only the ADR's "Superseded/Rejected" lines. |
| 4 | Draft files for the deployment repo (`apps/stoktok/compose.yml`, `.github/workflows/deploy-stoktok.yml` modelled on `deploy-calechip.yml`) are prepared and opened as a separate PR on `mmlabs-online/deployment`. Supabase URL and service key stay out of git, on the runner host only (R3). | Drafts exist under `deploy/deployment-repo/` at their target relative paths, plus a `README.md` mapping. `deploy-stoktok.yml` diffed against `deploy-recordin.yml` (its calechip-derived twin) shows only the planned deltas (Approach step 4). `pnpm check:deploy-env` passes, which includes the "no `${SUPABASE_*}` interpolation, `env_file:` present" R3 guard. Opening the deployment PR is the **orchestrator's** step after DONE, from these drafts. The reviewer checks the drafts are complete and copyable verbatim. |
| 5 | The runbook covers cutting v0.1.0 (required repo secrets, tag push, merging the release PR, rollback). The release is private: no public hostname, and Cloudflare Access must exist before any hostname is added. *(Amended by Ming's answer 1: public hostname behind Access, Ming's email only.)* | `docs/deploy.md` has these sections:<br>• "Preconditions on the Mac"<br>• "Repository secrets" (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `DEPLOY_REPO_TOKEN` with scope)<br>• "One-time setup"<br>• "Cut v0.1.0": migrations → tag on main → release PR → merge → PR comment → health and dry-run checks → **Access application, then hostname** → Access login and one form submit verified<br>• "Roll back"<br><br>The ordering is explicit and numbered: the Access application step comes before the hostname step, plus a "do not reorder" warning. The hostname is set only in the Cloudflare dashboard: the drafts contain no hostname or ingress rule, and `deploy/cloudflared-ingress.example.yml` is deleted. No auth code is added to the app (R6 suspended): `git diff` touches nothing auth-related under `apps/web`. |
| 6 | `typecheck`, `lint`, `test` and the existing deploy checks pass. | `pnpm typecheck && pnpm lint && pnpm test && pnpm check:service-key && pnpm check:deploy-env` all exit 0. `bash -n` on every script under `deploy/` and `scripts/` passes (`check:deploy-env` does this). |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `.github/workflows/release.yml` | **Create.** Tag-triggered release: guards → build+push web and worker → pull by digest and check → PR on the deployment repo. | AC1 |
| `scripts/check-image.sh` | **Create.** `check-image.sh <web\|worker> <image-ref>`: no secret-like env names, no `.env*` files, worker usage smoke (exit 2 + stderr), web smoke (`/healthz` = 200 and `/` answers, via `docker exec … node -e fetch`, no host port), and no `MODULE_NOT_FOUND`. | AC1, AC2: CI and release run identical checks (no copy-paste drift) |
| `.github/workflows/ci.yml` | **Modify** (small). `images` job: replace the three inline check steps ("No secrets in image", "smoke: worker", "smoke: web") with `bash scripts/check-image.sh ${{ matrix.app }} "$IMAGE:latest"`. **Keep** the build, tags (`:<sha>`, `:latest`), the Docker Hub secrets check, login and push on `main` unchanged (Ming's answer 5, D5). | AC2 (smoke hits `/healthz`); one copy of the image checks shared with release.yml |
| `apps/web/app/healthz/route.ts` | **Create.** `GET` returns `{ status: 'ok', version }` with `no-store`; `dynamic = 'force-dynamic'`; no imports. | AC2 |
| `apps/web/test/healthz.test.ts` | **Create.** Unit tests for the route (see Tests). | AC2, R8 |
| `deploy/deployment-repo/README.md` | **Create.** What each draft is, where it goes in `mmlabs-online/deployment`, the CODEOWNERS line to add (`/apps/stoktok/  @didi-code0980`), and the note that the setup PR is not a release branch. | AC4 |
| `deploy/deployment-repo/apps/stoktok/compose.yml` | **Create.** Draft compose (replaces `deploy/compose.stoktok.yml`). | AC3, AC4, R3 |
| `deploy/deployment-repo/apps/stoktok/run-job.sh` | **Create** (moved and rewritten from `deploy/run-job.sh`). Single job, portable for macOS bash 3.2, `mkdir` lock, `date -u +%FT%TZ`. | AC3 (jobs on the Mac) |
| `deploy/deployment-repo/apps/stoktok/run-schedule.sh` | **Create.** Called by launchd. Checks the UTC offset is `+0700`, then chooses the chain by local hour: before 21:00 → `eod-prices; financials; signals`, otherwise → `eod-prices; signals`. | AC3 |
| `deploy/deployment-repo/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist` | **Create.** LaunchDaemon, `UserName gh-runner`, 10 `StartCalendarInterval` entries (Mon–Fri × 18:30, 21:00), `PATH` including `/usr/local/bin:/opt/homebrew/bin`, stdout/stderr to the logs directory. | AC3 |
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | **Create.** Copy of `deploy-recordin.yml` with the stoktok deltas. | AC4 |
| `deploy/compose.stoktok.yml` | **Delete.** Superseded by the draft. One source only. | AC3 |
| `deploy/run-job.sh` | **Delete.** Moved into the draft folder. | AC3 |
| `deploy/crontab.example` | **Delete.** Replaced by the launchd plist. | AC3 |
| `deploy/cloudflared-ingress.example.yml` | **Delete.** Does not apply: the tunnel is remotely managed. | AC3, AC5 |
| `scripts/check-deploy-env.sh` | **Modify.** New compose path. `DEPLOY_ONLY="STOKTOK_WEB_IMAGE STOKTOK_WORKER_IMAGE STOKTOK_VERSION"`. New guards (see Approach step 5). | AC3, AC4, AC6, R3 |
| `docs/deploy.md` | **Rewrite** as the Mac/release runbook. Keep the `env-list` markers and table rows unchanged. | AC3, AC5 |
| `docs/adr/0003-deploy-and-scheduling.md` | **Modify.** Amend for the release flow, macbook-runner, launchd, host env file, `web` without a hostname. Move WSL/cron to "Superseded". | AC3 |
| `apps/worker/README.md` | **Modify** line 30 only: point "Container form" at `run-job.sh` in the deploy draft and at `docs/deploy.md`. | Keeps a now-dangling reference correct after the delete (AC3) |

No `packages/core` change (no domain logic). `.env.example` is unchanged. `STOKTOK_VERSION` is deploy-only and not a secret.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `apps/web/test/healthz.test.ts › returns 200 with status ok` | AC2 |
| `… › echoes STOKTOK_VERSION, null when unset` | AC2 (version from release.env) |
| `… › sets cache-control no-store` | AC2 (health is never cached) |
| `… › answers with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY unset` | AC2 "without touching the database" (behavioural) |
| `… › route source imports nothing from db/supabase/server modules` | AC2 (static guard: read `app/healthz/route.ts`, assert no `import`/`require` of `@stoktok/db`, `@supabase/`, `server-only`, `../lib`, `@/lib`) |
| `scripts/check-deploy-env.sh` (run by `pnpm check:deploy-env`, CI) | AC3/AC4/R3 structural guards on the draft compose, release.yml ↔ compose key agreement, `bash -n` on scripts |
| `scripts/check-image.sh` (run in CI `images` job) | AC2 container-level `/healthz`; image secret checks (moved, not new) |

## Approach
1. **`/healthz` (AC2).** Create `apps/web/app/healthz/route.ts`:
   ```ts
   export const dynamic = 'force-dynamic';
   export function GET(): Response {
     return Response.json(
       { status: 'ok', version: process.env.STOKTOK_VERSION ?? null },
       { headers: { 'cache-control': 'no-store' } },
     );
   }
   ```
   No imports. Route handlers do not render `(app)/layout`, so no DB code runs. Tests import `../app/healthz/route` and call `GET()` directly.
2. **Image checks (AC1/AC2).** Move the "No secrets in image", "smoke: worker" and "smoke: web" logic from `ci.yml` into `scripts/check-image.sh <app> <ref>`, behaviour-preserving, with these changes:
   - The web smoke runs the container with dummy `SUPABASE_*` and **no** `-p`.
   - It loops up to 30 s on `docker exec <c> node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"`.
   - It then checks that `/` returns any HTTP status, greps the logs for `Cannot find module|MODULE_NOT_FOUND`, and always removes the container (trap).

   In `ci.yml`'s `images` job, only swap the three inline check steps for `bash scripts/check-image.sh ${{ matrix.app }} "$IMAGE:latest"`. Everything else stays as it is, including the CI push of `:<sha>` and `:latest` on `main`, the skip-push warning when secrets are missing, and the gha cache (D5, Ming's answer 5). CI keeps publishing its build tags, and `release.yml` **additionally** publishes the `vX.Y.Z` tags whose digests the deployment repo pins. Both go to the same Docker Hub repos. The deployment repo only ever deploys the digest-pinned version tag, never `:latest` or `:<sha>`.
3. **Single source for drafts (AC3/AC4).**
   - `deploy/deployment-repo/` mirrors the target repo's paths, and the orchestrator copies those files verbatim into the deployment-repo setup PR.
   - Delete the four old `deploy/*` files. AC3 names `deploy/compose.stoktok.yml`; the consult's option "delete it or make it that file" is resolved as *delete*, because two copies would drift. The ADR and runbook point to the draft path.

   **Draft `apps/stoktok/compose.yml`:**
   - Header comment in the recordin style (what release.env holds, the by-hand command, where secrets live and why).
   - `name: stoktok`.
   - `stoktok-web`:
     - `image: ${STOKTOK_WEB_IMAGE:?STOKTOK_WEB_IMAGE is unset - pass --env-file apps/stoktok/release.env}`
     - `restart: unless-stopped`
     - `env_file: /Users/gh-runner/.config/stoktok/stoktok.env`
     - `environment`: `STOKTOK_VERSION: ${STOKTOK_VERSION:-}`, `HOSTNAME: 0.0.0.0`, `TZ: Asia/Ho_Chi_Minh`
     - healthcheck `["CMD","node","-e","fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]` with interval 10s, timeout 5s, start_period 20s, retries 3
     - json-file log rotation (10m × 3)
     - `networks: [tunnel]`
   - `stoktok-worker`:
     - `image: ${STOKTOK_WORKER_IMAGE:?…}`
     - `restart: "no"`, `profiles: [jobs]`
     - the same `env_file`
     - `environment` `STOKTOK_VERSION`, `TZ`
     - no `networks` key (project default network, off `web`)
   - `networks.tunnel: { external: true, name: web }`.
   - No `ports`, no `container_name`, no `${SUPABASE_*}`.

   **`run-job.sh`** (bash 3.2 safe: no `mapfile`, associative arrays or `${x,,}`):
   - `usage: run-job.sh <job> [flags]`, exit 2 without arguments.
   - Variables: `DIR=${STOKTOK_DIR:-/Users/gh-runner/stoktok/current}`, `LOG_DIR=${STOKTOK_LOG_DIR:-/Users/gh-runner/stoktok/logs}`.
   - Lock: `mkdir` on `/tmp/stoktok-jobs.lock` (macOS clears `/tmp` at boot), with a `pid` file inside.
     - If the pid is gone, treat the lock as stale and remove it.
     - Wait up to 1800 s for the lock; on timeout log and exit 1.
     - A trap removes the lock on exit.
   - Run `docker compose -p stoktok -f "$DIR/compose.yml" --env-file "$DIR/release.env" --profile jobs run --rm stoktok-worker "$@" >>"$LOG_DIR/$JOB.log" 2>&1`.
   - Start and end lines use `date -u +%FT%TZ` and include `STOKTOK_VERSION`.

   **`run-schedule.sh`:**
   - If `date +%z` ≠ `+0700`, log `wrong time zone` and exit 1.
   - `H=$(date +%H)`. If `H < 21`: `run-job.sh eod-prices; run-job.sh financials; run-job.sh signals`. Otherwise: `run-job.sh eod-prices; run-job.sh signals`.
   - Use `;` so one failure doesn't stop the chain. Exit with the worst code.
   - One launchd job never runs twice at once, and missed slots during sleep coalesce into one run on wake. That replaces the five cron lines. The 18:45/18:55 offsets become sequential order.

   **Plist:**
   - Label `online.mmlabs.stoktok.jobs`, `UserName gh-runner`.
   - `ProgramArguments [/bin/bash, /Users/gh-runner/stoktok/current/run-schedule.sh]`.
   - `StartCalendarInterval`: an array of 10 dicts (`Weekday` 1–5 × `{Hour 18, Minute 30}` and `{Hour 21, Minute 0}`).
   - `EnvironmentVariables`: `PATH=/Users/gh-runner/.orbstack/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` (the Docker CLI comes from OrbStack; on Intel it is linked in `/usr/local/bin`), `HOME=/Users/gh-runner`.
   - `StandardOutPath`/`StandardErrorPath` → `/Users/gh-runner/stoktok/logs/launchd.log`.
   - A comment: the engine is OrbStack. If the runner service needs a `DOCKER_HOST` (for example `unix:///Users/gh-runner/.orbstack/run/docker.sock`) to reach it, set the same value here.
4. **Draft `deploy-stoktok.yml` (AC4).** Copy `deploy-recordin.yml` (same flow as calechip, plus `workflow_dispatch`). Deltas only:
   - `name`/`concurrency` `deploy-stoktok`; `paths: ['apps/stoktok/**']`.
   - `env`: `APP_DIR: apps/stoktok`, `PROJECT: stoktok`, `ENV_FILE: /Users/gh-runner/.config/stoktok/stoktok.env`, `SCHED_DIR: /Users/gh-runner/stoktok/current`.
   - `runs-on: [self-hosted, macbook-runner]`.
   - `release` step:
     - Keep the TODO-operator and "no release.env → skip" logic. The setup PR merge then deploys nothing.
     - Validate `STOKTOK_WEB_IMAGE` against `^mingming21400/stoktok-web:v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?@sha256:[0-9a-f]{64}$`, and the worker against the same pattern with `stoktok-worker`.
     - Require both images and `STOKTOK_VERSION` to carry the same version.
     - Read `previous` (the web line) from `BEFORE`.
     - Check `test -r "$ENV_FILE"`, `grep -q '^SUPABASE_URL='` and `grep -q '^SUPABASE_SERVICE_ROLE_KEY='`, never printing values. On failure: "Nothing was started".
   - `deploy` step: `config --quiet`, then `"${compose[@]}" --profile jobs pull`, then `up -d --wait --wait-timeout 120` (without the profile).
   - New `publish` step, only after a healthy deploy:
     - Copy `compose.yml`, `release.env`, `run-job.sh` and `run-schedule.sh` into `$SCHED_DIR.new`.
     - Then `rm -rf $SCHED_DIR.old; [ -d $SCHED_DIR ] && mv $SCHED_DIR $SCHED_DIR.old; mv $SCHED_DIR.new $SCHED_DIR`.
     - The scheduler therefore never reads `_work/`.
   - `rollback` step:
     - Same as recordin, with `--profile jobs pull`.
     - After a successful restore, run the same publish copy before the revert commit.
     - Commit message "Restore stoktok …".
   - `notify`: text says `deploy-stoktok`, and the `restore-failed` message says "stoktok needs a hand".
   - Keep `bash` 3.2-compatible constructs; recordin's `[[ =~ ]]` works there.
5. **`check-deploy-env.sh` (AC3/AC4/AC6/R3).**
   - Set `COMPOSE=deploy/deployment-repo/apps/stoktok/compose.yml` and the new `DEPLOY_ONLY`.
   - Keep the existing checks (env table ↔ `.env.example`, undeclared vars, literal secrets, `NEXT_PUBLIC_`).
   - Add FAIL checks when:
     - `${SUPABASE_` appears in the compose;
     - `env_file:` appears fewer than 2 times;
     - `name: web` or `external: true` is missing;
     - `ports:`, `container_name` or `:latest` appears;
     - a key that `release.yml` writes (`grep -oE 'STOKTOK_[A-Z_]+=' .github/workflows/release.yml`) is not in `DEPLOY_ONLY`, or a `DEPLOY_ONLY` key is not written by `release.yml`;
     - `bash -n` fails for `deploy/deployment-repo/apps/stoktok/*.sh` or `scripts/*.sh`.
   - Update the header comment.
6. **`release.yml` (AC1).** Based on `docs/app-release.yml`:
   - Trigger `tags: ['v[0-9]+.[0-9]+.[0-9]+*']`; `permissions: contents: read`; `concurrency: release-${{ github.ref }}`.
   - `env`: `APP: stoktok`, `NAMESPACE: mingming21400`. One job on `ubuntu-latest`, timeout 30.
   - Steps:
     1. `actions/checkout@v4` with `fetch-depth: 0`, `persist-credentials: false`.
     2. **Guards:**
        - `TAG=$GITHUB_REF_NAME` must match `^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`, the same rule as the deploy regex.
        - Then `git fetch origin main` and `git merge-base --is-ancestor "$GITHUB_SHA" origin/main`, else `::error::` "tag a commit on main".
        - Fail with a clear message if any of the three secrets is empty (pass them via `env`; never echo).
     3. `docker/setup-buildx-action@v3`, then `docker/login-action@v3`.
     4. `docker/build-push-action@v6` `id: web`: `file: apps/web/Dockerfile`, `push: true`, `platforms: linux/amd64`, `tags: $NAMESPACE/stoktok-web:$TAG`, gha cache scope `web`. Then the same for `id: worker`.
     5. **Verify the pushed digests:**
        - `docker pull $NAMESPACE/stoktok-web@${{ steps.web.outputs.digest }}`, then `bash scripts/check-image.sh web <that ref>`.
        - Same for the worker.
        - If this fails, no PR is opened. A pushed-but-unreleased tag is never pinned.
     6. **PR step**, from the template, with these fixes:
        - Write the header comment plus the 3 lines.
        - `git add "apps/$APP/release.env"` (the file is new on the first release).
        - Assert `git diff --cached --name-only` is exactly `apps/stoktok/release.env`.
        - Commit `stoktok $TAG`, push the branch `release/stoktok-$TAG`.
        - `gh pr create` with a body listing both pinned refs, the commit URL, and a reminder: "apply migrations before merging; merging runs deploy-stoktok on macbook-runner".
7. **Runbook `docs/deploy.md` (AC3/AC5).** Rewrite with these sections:
   - **Flow:** tag → release.yml → release PR → merge → deploy-stoktok on macbook-runner → publish to `~gh-runner/stoktok/current` → launchd jobs.
   - **Placeholders and gates:**
     - `APP_HOSTNAME`: default `stoktok.mmlabs.online`, confirmed by Ming (G2). It is set only in the dashboard; no file in either repo holds it.
     - G1, rewritten for the dashboard flow: the Cloudflare Access application exists and is verified **before** any public hostname for `stoktok-web:3000` is added. This is a step of the v0.1.0 cut, not deferred.
     - No auth code in the app (R6 suspended). Access is the only gate until STK-004.
   - **Preconditions on the Mac:** items D1–D4 below, each with a check command.
   - **Repository secrets** (stoktok repo): `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `DEPLOY_REPO_TOKEN` (fine-grained PAT on `mmlabs-online/deployment` only: Contents read/write, Pull requests read/write).
   - **One-time setup:**
     1. Ming merges the deployment-repo setup PR. Its deploy run skips because there is no release.env yet.
     2. Create the secrets file: `install -d -m 700 /Users/gh-runner/.config/stoktok`, then a 600 file owned by `gh-runner` with `SUPABASE_URL=` and `SUPABASE_SERVICE_ROLE_KEY=`.
     3. `install -d /Users/gh-runner/stoktok/logs`.
     4. Install the plist: `sudo cp …/launchd/online.mmlabs.stoktok.jobs.plist /Library/LaunchDaemons/`, `chown root:wheel`, `chmod 644`, `sudo launchctl bootstrap system /Library/LaunchDaemons/online.mmlabs.stoktok.jobs.plist`. Verify with `sudo launchctl print system/online.mmlabs.stoktok.jobs`.
     5. Optional newsyslog rotation: `/etc/newsyslog.d/stoktok.conf`.
   - **Cut v0.1.0:**
     1. Apply pending migrations by hand.
     2. `git switch main && git pull && git tag v0.1.0 && git push origin v0.1.0`.
     3. Watch the release run.
     4. Review the release PR (only `apps/stoktok/release.env`, both digests).
     5. Merge it.
     6. Read the deploy-stoktok PR comment.
     7. Verify: `docker compose -p stoktok ps` shows web healthy, and `docker compose -p stoktok exec stoktok-web node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>r.text()).then(console.log)"` shows `v0.1.0`.
     8. Run `/Users/gh-runner/stoktok/current/run-job.sh eod-prices --dry-run`. The health check does not test DB secrets; this run does.
     9. **Cloudflare Access application first** (Zero Trust → Access → Applications → Self-hosted):
        - application domain `<APP_HOSTNAME>`;
        - one Allow policy with Include → Emails → Ming's email only;
        - no bypass rules, and the session duration noted.

        Check in the dashboard that the application is saved and the policy is attached. **Do not do step 10 before this.**
     10. **Then add the public hostname**: Networks → Tunnels → the mmlabs tunnel → Public hostname → `<APP_HOSTNAME>` → service `http://stoktok-web:3000`.
     11. **Verify**:
         - in a private window, `https://<APP_HOSTNAME>/` shows the Access login, not the app;
         - after logging in with Ming's email, the dashboard loads;
         - one form submit works (server actions check Origin/Host). If it fails, record a follow-up; do not add code here;
         - `curl -sI https://<APP_HOSTNAME>/healthz` without a session gets the Access redirect (302/403), not 200.
     12. To take it offline again: delete the public hostname first, then the Access app if wanted. Never the reverse.
   - **Roll back:** automatic restore on a failed health check (explained). Manual: revert the release PR's merge commit on deployment `main`, which re-triggers deploy-stoktok and republishes the scheduler dir. If needed, use `workflow_dispatch`. **Migrations are not undone**: every migration must work with the previous image.
   - **Logs:** `docker compose -p stoktok logs -f stoktok-web`, plus the log files under `/Users/gh-runner/stoktok/logs/`.
   - **Restart safety check and exit codes:** keep, updated (lock = `mkdir` lock, not `flock`; the cron wording becomes launchd).
   - **Env list:** markers and rows unchanged. The deploy-only line becomes `STOKTOK_WEB_IMAGE`, `STOKTOK_WORKER_IMAGE`, `STOKTOK_VERSION` (written by release.yml into release.env). Secrets come only from the host env file (R3).
8. **ADR 0003.** Status: `accepted (STK-018), amended (STK-037)`. The decision becomes:
   - Release by tag through the deployment repo.
   - The self-hosted `macbook-runner`.
   - Web on external `web`, published only through a dashboard hostname that sits behind a Cloudflare Access application created first (G1). The worker is on the project default network.
   - CI keeps pushing `:<sha>`/`:latest` on main. The release pushes `vX.Y.Z`, and only digest-pinned version tags are deployed.
   - Engine: OrbStack on an Intel Mac (amd64 native), TZ UTC+7.
   - A launchd LaunchDaemon (not cron): sleep catch-up, no Full Disk Access, no `flock` on macOS.
   - Secrets in a host `env_file` outside the runner checkout, as in the recordin precedent.
   - The scheduler reads a published copy, not `_work/`.
   - Health = `/healthz`, no DB.

   Superseded: WSL + systemd cron, `STOKTOK_TAG` (SHA), `.env` next to compose, the ingress example. Rejected: publish `127.0.0.1:<port>` (departs from AC3 and the convention); in-app login (R6 suspended, so Access is the gate).
9. **Rules.**
   - R3: the service key appears only in the host env file. The check script forbids interpolation, the image checks forbid secret-like env names, and release.yml never echoes secrets.
   - R6 suspended: no auth code is added. The hostname is added only after the Access application exists (G1, runbook steps 9→10).
   - R7: anything else goes to follow-ups.
   - R8: run all checks.
   - The security auditor runs at REVIEW (`areas: security`, the diff touches workflows and secrets handling).

## Specialist input used
`consult-software-architect.md`:
- **Adopted:**
  - one job with two build steps;
  - `release.env` format with `STOKTOK_VERSION`;
  - `APP=stoktok`;
  - ancestor-of-main guard;
  - template tag glob;
  - deploy copied from recordin with the explicit runner label, two regexes, the same-version check, env-file key-name check and `--profile jobs pull`;
  - publish to a stable directory (rollback included);
  - `name: stoktok`, `env_file`, node fetch healthcheck, `HOSTNAME`, no `container_name`, worker off `web`;
  - drafts verbatim under `deploy/deployment-repo/`;
  - `check-deploy-env` updates and the `SUPABASE` interpolation guard;
  - the CODEOWNERS line;
  - launchd LaunchDaemon with `UserName gh-runner`, `PATH`, the two chains and portable `date`;
  - `/healthz` with `force-dynamic`, no DB imports, tested directly, CI smoke on it;
  - Option A (join `web`) with G1 rewritten for the dashboard. Per Ming, the hostname is added in this release, after Access;
  - runbook items: secrets, PAT scope, migrations first, rollback by revert, `pmset`.
- **Adapted:**
  - Smoke-test the image **after push, pulled by digest**, instead of `load: true` then push. This tests exactly the bytes that get pinned, with one build per image.
  - Keep a `mkdir` lock in `run-job.sh`, since manual runs can overlap scheduled ones.
  - Use **one** plist with 10 calendar entries plus `run-schedule.sh` rather than two plists, because two plists would both fire on wake after sleep and run concurrently.
  - Add a `+0700` guard in `run-schedule.sh` instead of relying only on documentation.
- **Not adopted:**
  - Making `deploy/compose.stoktok.yml` the draft. It is deleted instead, so there is one source.
  - A post-deploy worker dry-run inside the deploy workflow. It becomes a manual runbook step: a cheap follow-up, and it keeps the deploy's scope like the other apps.
  - Stop CI pushing: Ming said keep it (answer 5).
  - Multi-arch images: not needed, the Mac is Intel.

**Consult open questions: answered by Ming (ticket, 2026-10-30)**
| Q | Ming's answer | Plan |
|---|---|---|
| 1 How Ming uses v0.1.0 | Public behind Cloudflare Access (Ming's email). No auth code. | Join `web`. The runbook "Cut v0.1.0" steps 9–12: Access app → hostname → verify. No code or hostname in either repo. |
| 2 Docker engine | OrbStack | D1 reworded. The plist `PATH` includes `~/.orbstack/bin`, with the `DOCKER_HOST` note. |
| 3 CPU / TZ | Intel (amd64 native); UTC+7 | `platforms: linux/amd64` runs natively, with no emulation caveat. D2 TZ plus the `+0700` guard. |
| 4 Secrets file | Plan default path, 600, created by Ming | D4 unchanged. |
| 5 CI push | Keep | D5 reversed. ci.yml only swaps in `check-image.sh`. release.yml additionally pushes `vX.Y.Z`. |

## Assumptions
- **D1 (precondition):** the Docker engine is **OrbStack** (Ming). `macbook-runner` runs as `gh-runner`, home `/Users/gh-runner`, and reaches OrbStack's Docker without anyone logged in at the GUI. That means OrbStack must start at boot for the user the runner uses, and `docker context` must point at OrbStack.
  - Check: reboot, don't log in, run `runner-check` and see it green.
  - The LaunchDaemon runs in the same context, so a green check covers the jobs too.
  - If OrbStack only starts on a GUI login, both deploys and jobs stall. This is a runbook precondition for Ming to confirm, not a code change.
- **D2 (precondition, confirmed by Ming as UTC+7):** Mac time zone is Asia/Ho_Chi_Minh (`sudo systemsetup -gettimezone`). `run-schedule.sh` still guards on `+0700`. Sleep is disabled (`sudo pmset -a sleep 0 disablesleep 1`, or lid open and on power), otherwise deploys queue and jobs coalesce.
- **D3 (confirmed):** the Mac is Intel. Single-arch `linux/amd64` images run natively.
- **D4 (confirmed, default path):** `/Users/gh-runner/.config/stoktok/stoktok.env`, mode 600, owner `gh-runner`, created by Ming. It holds only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- **D5 (confirmed by Ming: keep CI push):** `ci.yml` keeps building and pushing `:<sha>` and `:latest` on `main`. `release.yml` additionally pushes `:vX.Y.Z` to the same repos and pins those digests in `release.env`. The deployment repo's regex accepts only `vX.Y.Z@sha256:…`, so CI tags can never be deployed by accident.
- A6: Docker Hub repos `mingming21400/stoktok-web` and `stoktok-worker` are created by the first push. Ming sets their visibility; the images contain no secrets (checked).
- A7: no migration step in deploy (deployment-repo convention). Migrations are applied by hand before merging a release PR, and must be backward-compatible with the previous image.
- A8: the CODEOWNERS handle is `@didi-code0980`, as for the other apps. The setup PR branch is not `release/*`, so `pr-scope` does not restrict it.
- A9: follow-ups for Ming, not in this diff:
  - spec §4.1 heading and the CLAUDE.md Runtime row still say WSL;
  - the Goal and AC5 text ("private: no public hostname") should be updated to match answer 1;
  - optional post-deploy worker dry-run in deploy-stoktok;
  - the already-flagged tunnel token and `apps/calechip/.env` committed in the deployment repo. This matters more now that a public stoktok hostname exists: anyone with the token can run the tunnel. Access still gates the hostname at Cloudflare's edge.
  - other containers on `web` can reach stoktok-web without Access, since Access applies only at the edge (accepted while R6 is suspended);
  - restoring R6 (STK-004) as defence in depth behind Access.
- A10: the ticket's "modelled on `deploy-calechip.yml`" is met by copying `deploy-recordin.yml`, whose header says "Same flow as deploy-calechip.yml". It adds `workflow_dispatch` and the `env_file` precedent stoktok needs.
- A11: the line-count guide is exceeded (~800 lines), but mostly by templated YAML, a moved script and a doc rewrite of one feature (deployment). The ACs are coupled (the release.env keys must match the compose and the deploy workflow), so the plan is not split.

## Blocking questions
None.

## Split proposal
None. See A11: one feature with coupled ACs, and the volume is mainly templated config and docs.

## Changes after Ming's answers
Ming answered the consult's open questions (ticket, 2026-10-30) after the first version of this plan.
1. **Public behind Access.**
   - The runbook's "Cut v0.1.0" now includes creating the Access application (Ming's email) first, then the dashboard hostname, then verifying that unauthenticated requests get Access, not the app. Teardown runs in reverse order.
   - Still no auth code, and no hostname in any file.
   - The AC5 and Goal wording ("no public hostname") is flagged for the orchestrator to update (Spec summary, A9).
2. **OrbStack.** D1 reworded: OrbStack must start at boot without a GUI login, checked with `runner-check`. The plist `PATH` adds `~/.orbstack/bin`.
3. **Intel, UTC+7.** The emulation caveat is dropped (D3); amd64 runs natively, and multi-arch is no longer a follow-up. D2 is confirmed, and the `+0700` guard stays.
4. **Secrets file.** The default path is confirmed (D4).
5. **CI push kept.**
   - D5 reversed: `ci.yml` keeps its build, secrets check, login and push of `:<sha>`/`:latest` on main. It only swaps its inline checks for `scripts/check-image.sh`.
   - `release.yml` additionally pushes the `vX.Y.Z` images whose digests go into `release.env`.

Status stays **READY**: nothing in the answers blocks an AC.
