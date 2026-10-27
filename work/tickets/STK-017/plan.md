Status: READY

# Plan — STK-017: Docker images and CI build

## Spec summary
- spec §7 Deployment: "App repo (private): CI and image build on GitHub-hosted runners, images pushed to the Docker Hub account used by other mmlabs apps." / "Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo." / "`worker` must tolerate restarts: jobs are idempotent and resume from last successful run."
- spec §4.1 Services: "`web` | Next.js UI and API routes …" and "`worker` | Scheduled jobs: …"
- CLAUDE.md Stack: "CI/CD | GitHub Actions (hosted runners) build images → Docker Hub; deploy via the shared mmlabs deploy repo". R3 (service role key server-only), R8 (no PASS without green typecheck/lint/test).

Out of scope: deploy/Compose (STK-018), scheduling worker jobs (see Assumptions A4), auth (R6 suspended).

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Dockerfiles for `apps/web` (Next.js standalone output) and `apps/worker`: multi-stage, pnpm-workspace aware, non-root user | Read `apps/web/Dockerfile` and `apps/worker/Dockerfile`: ≥2 `FROM … AS` stages; deps stage copies `pnpm-lock.yaml`, `pnpm-workspace.yaml` and every workspace `package.json` and runs `pnpm install --frozen-lockfile`; final stage has `USER node`. `next.config.ts` sets `output: 'standalone'`. Local evidence: `pnpm --filter @stoktok/web build` creates `apps/web/.next/standalone/apps/web/server.js`. |
| 2 | GitHub Actions on hosted runners runs `typecheck`, `lint`, `test` on PRs and on `main` | `.github/workflows/ci.yml` has `on: pull_request` and `push: branches: [main]`, `runs-on: ubuntu-latest`, and steps `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm check:service-key`, `pnpm db:check` (with a `postgres:16` service). The CI run on the PR for this ticket is green (`gh pr checks` / Actions page). |
| 3 | On `main`, images built and pushed to Docker Hub, tagged with commit SHA and `latest` | The `images` job has `needs: ci`. `push:` is true only when `github.event_name == 'push' && github.ref == 'refs/heads/main'`. Tags are `${DOCKERHUB_NAMESPACE}/stoktok-<app>:${{ github.sha }}` and `:latest`. Login and fail-fast steps run only on that same condition. On the PR run, the `images` job builds both images without pushing and is green. The real push can only be verified after Ming sets the variable and secrets and merges (see Needs Ming's decision). |
| 4 | No secrets in images, Dockerfiles or repo; Docker Hub creds from GitHub secrets; `.dockerignore` excludes `.env*` (R3) | `grep -nE 'ARG|ENV' apps/*/Dockerfile` shows only non-secret ENV (`NODE_ENV`, `PORT`, `HOSTNAME`, `NEXT_TELEMETRY_DISABLED`) and no `ARG` carrying a key. `.dockerignore` contains `.env*`, `**/.env*`, `!.env.example`. `.gitignore` contains `.env*` and `!.env.example`, and `git check-ignore apps/web/.env.production` prints the path. The workflow references creds only as `secrets.DOCKERHUB_USERNAME` / `secrets.DOCKERHUB_TOKEN`. The CI `images` job runs a "no secrets in image" step: `docker image inspect` Env has no `KEY|SECRET|TOKEN|PASSWORD` names, and `find / -name '.env*'` inside the image returns nothing. |
| 5 | Both images build and start locally with a documented command | README has a "Docker images" section with build and run commands for both images. Evidence is either (a) a local `docker build` + run log in impl-log, or (b) if no Docker daemon is available, the fallback evidence in Approach step 7, with the CI `images` job (build + smoke run) on the PR as the image-level proof. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `apps/web/next.config.ts` | Add `output: 'standalone'` and `outputFileTracingRoot` = repo root | AC1: standalone output; pnpm monorepo tracing (consult risk 1) |
| `apps/web/Dockerfile` | New multi-stage image (base → deps → build → runtime), non-root | AC1, AC4 |
| `apps/worker/Dockerfile` | New multi-stage image (base → deps → build → prod-deps → runtime), non-root, `ENTRYPOINT ["node","dist/cli.js"]` | AC1, AC4 |
| `.dockerignore` | New; excludes env files, node_modules, build output, VCS and agent/docs dirs | AC4 (R3), small context |
| `.gitignore` | Replace the `.env` / `.env.local` / `.env.*.local` lines with `.env*` + `!.env.example` | AC4, orchestrator guidance |
| `.github/workflows/ci.yml` | New: `ci` job (checks) + `images` job (matrix web/worker; build on PR, push on main) | AC2, AC3, AC4 |
| `README.md` | Add "CI and Docker images" section: required repo variable/secrets, image names/tags, local build/run commands, one-shot worker note | AC3 (names documented), AC5 |

No `packages/core` change → no new unit tests needed (R8 only requires the existing suite to stay green).

## Tests to write
| Test (file › name) | Covers |
|---|---|
| None (unit) | No domain logic changes |
| `.github/workflows/ci.yml` › job `images` › step "smoke: worker" (`docker run --rm <img>`, assert exit code 2 + usage on stderr) | AC5. The worker image starts, and `@supabase/supabase-js` and the workspace code resolve, because `cli.ts` statically imports `@stoktok/db`, so a missing module exits 1, not 2 |
| `.github/workflows/ci.yml` › job `images` › step "smoke: web" (run detached with dummy `SUPABASE_URL=http://127.0.0.1:9` and `SUPABASE_SERVICE_ROLE_KEY=dummy` passed via `-e`, poll `curl -s -o /dev/null -w '%{http_code}' localhost:3000/` until any HTTP code, max ~30s; fail if no response or the logs match `Cannot find module\|MODULE_NOT_FOUND`) | AC5. The web image starts and the standalone trace is complete |
| `.github/workflows/ci.yml` › job `images` › step "no secrets in image" | AC4 |

## Approach
1. **`.gitignore` / `.dockerignore`.** Widen `.gitignore` to `.env*` + `!.env.example`.
   - Create `.dockerignore` with: `**/node_modules`, `**/.next`, `**/dist`, `**/coverage`, `**/*.tsbuildinfo`, `**/*.log`, `.git`, `.github`, `.claude`, `work`, `docs`, `supabase`, `.env*`, `**/.env*`, `!.env.example`.
   - Do not exclude `scripts/` unless needed. It is small and harmless.
   - Excluding `.env*` also stops Next standalone from copying a local `.env*` into the image.
2. **`next.config.ts`.** Add `output: 'standalone'` and `outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url))`.
   - If Next's config loader rejects `import.meta.url`, use `path.resolve(process.cwd(), '../..')` (build always runs with cwd `apps/web`) and record why in impl-log.
   - If Next 16 warns about a `turbopack.root` mismatch, set `turbopack: { root: <same> }` too.
   - Run `pnpm --filter @stoktok/web build` with **no env** to confirm the build does not need DB env (consult finding), and confirm `.next/standalone/apps/web/server.js` exists.
   - There is no `apps/web/public/`, so the Dockerfile must not COPY it.
3. **Web Dockerfile** (`# syntax=docker/dockerfile:1`). Build context is the repo root.
   - `base`: `node:22-bookworm-slim` + `corepack enable`. pnpm comes from `packageManager`.
   - `deps`: `WORKDIR /repo`, copy `package.json pnpm-lock.yaml pnpm-workspace.yaml` and `apps/web/package.json apps/worker/package.json packages/core/package.json packages/db/package.json`, then `RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile`. Copy all workspace package.jsons so the frozen lockfile matches.
   - `build`: `COPY . .`, `ENV NEXT_TELEMETRY_DISABLED=1`, `pnpm --filter @stoktok/web build`.
   - `runtime`: fresh `node:22-bookworm-slim`, `WORKDIR /app`, `ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1`.
     - `COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./`
     - `COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static`
     - `USER node`, `EXPOSE 3000`, `CMD ["node","apps/web/server.js"]`.
   - No `ARG`/`ENV` for any secret (R3). All runtime env comes from `--env-file`/Compose.
4. **Worker Dockerfile.** Same `base`/`deps` pattern (copy it; don't share across files, keep each Dockerfile standalone).
   - `build`: `COPY . .`, `pnpm --filter @stoktok/worker build`, then `pnpm --filter @stoktok/worker deploy --prod --legacy /out`.
   - `runtime`: `WORKDIR /app`, `ENV NODE_ENV=production`.
     - `COPY --from=build --chown=node:node /out/node_modules ./node_modules`
     - `COPY --from=build --chown=node:node /repo/apps/worker/dist ./dist`
     - `COPY --from=build --chown=node:node /repo/apps/worker/package.json ./`. This is needed for `"type":"module"`, because tsup emits `.js` ESM.
     - `USER node`, `ENTRYPOINT ["node","dist/cli.js"]`, no `CMD`. No args → usage, exit 2.
   - Copy `dist` from the build tree, not from `/out`, because `pnpm deploy` may drop git-ignored `dist/`.
   - If `pnpm deploy` fails or the runtime throws `ERR_MODULE_NOT_FOUND`, use the consult's fallback: tsup `noExternal: [/.*/]`, runtime copies only `dist/` + `package.json`. That means editing `apps/worker/tsup.config.ts`, which is outside the file list; record why in impl-log. Then verify that `node dist/cli.js` still exits 2 and that `pnpm test` stays green.
5. **`.github/workflows/ci.yml`.**
   - Top level:
     - `on: pull_request` + `push: branches: [main]`
     - `permissions: contents: read`
     - `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`
     - one `env:` block: `DOCKERHUB_NAMESPACE: ${{ vars.DOCKERHUB_NAMESPACE }}`
   - Job `ci` (ubuntu-latest):
     - service `postgres:16` with `POSTGRES_PASSWORD: postgres` (throwaway, not a secret), a `pg_isready` health check and port `5432:5432`
     - `actions/checkout@v4`, `pnpm/action-setup@v4` (no version input; it reads `packageManager`), `actions/setup-node@v4` with `node-version-file: .node-version` and `cache: pnpm`
     - `pnpm install --frozen-lockfile`, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm check:service-key`, and `pnpm db:check` with `env: DB_CHECK_URL: postgresql://postgres:postgres@localhost:5432/postgres`
     - The runner has `psql`. If not, add `sudo apt-get install -y postgresql-client`.
   - Job `images`: `needs: ci`, matrix `app: [web, worker]`, ubuntu-latest. Set job env `PUSH: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}`. Steps:
     1. checkout.
     2. If `env.PUSH == 'true'`: fail-fast step that exits 1 with a clear message if `DOCKERHUB_NAMESPACE`, `secrets.DOCKERHUB_USERNAME` or `secrets.DOCKERHUB_TOKEN` is empty. Pass the secrets through step `env`, never echo them.
     3. Compute `IMAGE=${DOCKERHUB_NAMESPACE:-local}/stoktok-${{ matrix.app }}` into `$GITHUB_ENV`.
     4. `docker/setup-buildx-action@v3`.
     5. If PUSH: `docker/login-action@v3` with `username: ${{ secrets.DOCKERHUB_USERNAME }}` and `password: ${{ secrets.DOCKERHUB_TOKEN }}`.
     6. `docker/build-push-action@v6`:
        - `context: .`, `file: apps/${{ matrix.app }}/Dockerfile`, `load: true`, `push: false`
        - `tags: ${{ env.IMAGE }}:${{ github.sha }}` and `${{ env.IMAGE }}:latest`
        - `cache-from: type=gha,scope=${{ matrix.app }}`, `cache-to: type=gha,mode=max,scope=${{ matrix.app }}`
     7. "no secrets in image" step (see Tests).
     8. Smoke step for the matrix app (see Tests).
     9. If PUSH: `docker push "$IMAGE:${{ github.sha }}"` and `docker push "$IMAGE:latest"`.
   - This build → load → check → push order means a broken or secret-carrying image is never pushed. It also keeps one build path for PR and main.
6. **README.** Add a "CI and Docker images" section covering:
   - The required repo variable `DOCKERHUB_NAMESPACE` and secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (an access token, not the password). All three are defined in one place at the top of `ci.yml`, so they are easy to rename to the mmlabs pattern.
   - Image names and tags (full SHA + `latest`; roll back by SHA).
   - Local commands:
     ```
     docker build -f apps/web/Dockerfile -t stoktok-web .
     docker run --rm -p 3000:3000 --env-file apps/web/.env.local stoktok-web
     docker build -f apps/worker/Dockerfile -t stoktok-worker .
     docker run --rm stoktok-worker            # prints usage, exits 2
     docker run --rm --env-file apps/worker/.env.local stoktok-worker eod-prices --dry-run
     ```
   - The worker is one-shot (one container run per job). Do not give it `restart: always`. Scheduling is decided in STK-018.
   - Env is runtime-only and never baked into the image.
7. **Local verification (the implementer records all of it in impl-log):**
   - `pnpm typecheck && pnpm lint && pnpm test && pnpm check:service-key` all green. Run `pnpm db:check` too if Postgres binaries are available.
   - Try `dockerd` (e.g. `sudo dockerd >/tmp/dockerd.log 2>&1 &`). If it works: build both images, run both smoke checks from the Tests table, run `docker image inspect`, and log the output.
   - **If no daemon can run**, this evidence is acceptable instead:
     - (a) Web: `pnpm --filter @stoktok/web build` with no env. Copy `.next/static` into `.next/standalone/apps/web/.next/static`. Run `cd apps/web/.next/standalone && PORT=3999 HOSTNAME=127.0.0.1 SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_ROLE_KEY=dummy node apps/web/server.js`. `curl` it and get an HTTP status, with no `Cannot find module` in the log.
     - (b) Worker: `pnpm --filter @stoktok/worker build`, then `pnpm --filter @stoktok/worker deploy --prod --legacy <scratch>/out`. Copy `dist` and `package.json` next to `out/node_modules` in a scratch dir and run `node dist/cli.js`, expecting exit 2 + usage. This simulates the runtime stage without docker.
     - (c) Optionally run `actionlint` on `ci.yml` if it can be installed.
     - (d) The green `images` job on the ticket PR is the image-level proof. The reviewer must not PASS AC5 on Dockerfile reading alone. It needs (a)+(b), or a docker log, plus a green PR CI run or a recorded reason the PR run is unavailable (then AC5 is flagged for Ming).
8. **Rules:**
   - R3 is met by `.dockerignore`/`.gitignore`, the absence of secret ARG/ENV, the image secret-scan step, and `check:service-key` in CI.
   - R8 is met by CI running typecheck/lint/test on every PR and on main.
   - R7: no scheduler, no Compose, no deploy-repo change. R1/R2/R5/R9/R10 are not affected. R6 is suspended, so no auth.

## Specialist input used
consult-software-architect.md:
- Adopted:
  - Rec 1, the web Dockerfile stages and standalone + `outputFileTracingRoot`.
  - Rec 2, the worker built from compiled dist with `pnpm deploy --prod --legacy`. Refined: `dist` is copied from the build tree because deploy may drop the git-ignored dist. The `noExternal: [/.*/]` option is kept as a fallback only, because bundling CJS deps into ESM risks "dynamic require" failures.
  - Rec 3, the one-shot entrypoint with scheduling deferred.
  - Rec 4, the `.dockerignore` list, with `**/coverage` added and `.gitignore` widened.
  - Rec 5, CI checks including `check:service-key` and `db:check` against a `postgres:16` service.
  - Rec 6, the matrix image job with `needs: ci`, extended to PR builds without push per orchestrator guidance.
  - Rec 7, the variable/secret names in one place with fail-fast.
  - Rec 8, the local run docs.
  - Rec 9, extended with a `.env*` file scan inside the image.
- Adopted risk mitigations: smoke runs catch tracing and `pnpm deploy` failures; README notes SHA-based rollback and the "no restart: always" rule for the one-shot worker.
- Rejected: none.

## Assumptions
- A1: Docker Hub namespace and credentials use repo variable `vars.DOCKERHUB_NAMESPACE` and secrets `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`, declared once at the top of `ci.yml`. Pushes fail fast until they are set. (Orchestrator default; the ticket says "follow other mmlabs apps", which are not readable from this session.)
- A2: The images are named `<ns>/stoktok-web` and `<ns>/stoktok-worker`, tagged with the full `github.sha` and `latest`.
- A3: PRs build both images (with checks and smoke runs) but never push or log in. This also works for fork PRs without secrets.
- A4: The worker image is one-shot: `ENTRYPOINT node dist/cli.js`, with the job name as the argument. `src/index.ts` (the scaffold log line) is not the entrypoint. This is a gap against spec §4.1 "Scheduled jobs" and the §7 restart tolerance, so who triggers the jobs is a follow-up for STK-018 or a new ticket.
- A5: The target platform is linux/amd64 only (WSL2 PC). No multi-arch.
- A6: The base image is `node:22-bookworm-slim`, matching `.node-version`/`engines`. Its built-in `node` user (uid 1000) is the non-root user.

### Needs Ming's decision (non-blocking; safe defaults applied)
1. Confirm or rename `DOCKERHUB_NAMESPACE` / `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` to match other mmlabs apps, then set them in the repo settings. Until then the first `main` push fails at the fail-fast step, and AC3 cannot be observed end-to-end.
2. The image naming and tag format (A2). Alternatives are a single repo with `web-<sha>` tags, or short SHAs.
3. Who schedules worker jobs in production (host cron, a deploy-repo scheduler, or an in-process scheduler). This is deferred to STK-018.
4. The spec wording conflict: §4.1 describes the worker as a scheduler service, but the code is one-shot jobs. The spec may need updating once (3) is decided.

## Blocking questions
None

## Split proposal
None. The estimated diff is about 200–250 lines (two Dockerfiles ~40 each, a workflow ~110, README ~35, plus small config edits).

## Follow-ups (not in this diff)
- STK-018: worker scheduling and the Compose service definition. Use SHA tags for deploy and rollback, and avoid `restart: always` for one-shot jobs.
- Optional: pin GitHub Actions to commit SHAs and add Dependabot for actions and base images.
