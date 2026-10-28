## Attempt 1 — 2026-10-28
Verdict: REWORK

R6 waived (suspended). No PR exists yet (the loop opens it on DONE), so no GitHub Actions run is available. The Docker daemon was not running during this review. I used the plan §7 fallback evidence (a)+(b) and re-ran it myself.

### Checks (run by reviewer)
- typecheck: green (core, db, worker, web)
- lint: green
- test: green. core 347 passed / 31 files; db 100 passed + 1 todo / 14 files; worker 65 passed / 8 files; web 176 passed / 20 files
- check:service-key: OK (0 hits in `.next/static`)
- web build with no Supabase env: green. `apps/web/.next/standalone/apps/web/server.js` exists, and there are no `.env*` files in standalone.
- Fallback (a) web standalone: `node apps/web/server.js` with dummy env on :3999 returned HTTP 500 (DB unreachable, expected). The log had 0 `Cannot find module`/`MODULE_NOT_FOUND`.
- Fallback (b) worker: `pnpm --filter @stoktok/worker deploy --prod --legacy` + `dist` + `package.json`, then `node dist/cli.js` printed usage and exited 2. node_modules = `@stoktok/{core,db}`, `@supabase`.
- db:check: not run locally (no Postgres). It is wired in CI.

### Acceptance criteria
- [x] Dockerfiles multi-stage, workspace-aware, non-root. Evidence: `apps/web/Dockerfile:3,6,16,21` (base/deps/build/runtime) and `:26 USER node`. `apps/worker/Dockerfile:3,6,16,21` and `:27 USER node`. The deps stage copies the lockfile, the workspace file and all 4 package.json files, then runs `--frozen-lockfile`. `next.config.ts` sets `output: 'standalone'` and `outputFileTracingRoot`.
- [ ] CI runs typecheck/lint/test on PRs and main. The wiring is correct (`ci.yml:3-6,41-48`), but the workflow as committed fails on every run at the `images` job. See Issue 1. A red workflow does not meet the goal "every push to main is checked and produces images".
- [ ] Images pushed on main with SHA + `latest`. The tags and the PUSH gate are correct (`ci.yml:58,86-88,123-127`), but the push step is unreachable because of Issue 1. Even after the fix, it can only be verified after Ming sets the variable/secrets and merges.
- [x] No secrets in images, Dockerfiles or repo. Evidence: no `ARG`; `ENV` holds only NODE_ENV/HOSTNAME/PORT/NEXT_TELEMETRY_DISABLED; `.dockerignore:13-15`; `.gitignore` `.env*` + `!.env.example` (only `.env.example` is tracked); creds come only from `secrets.*`. The in-image scan step is the part that is broken (Issue 1).
- [x] Both images build and start locally with a documented command. Evidence: README "CI and Docker images". Implementer's docker log in impl-log (the build needed proxy-CA scratch copies; committed files unchanged). Reviewer fallback (a)+(b) above. **Flag for Ming:** there is no CI image-level proof yet, because no PR run exists.

### Issues
#### Issue 1 — 🔴 blocker — CI correctness
- **Where**: `.github/workflows/ci.yml:97` (the "No secrets in image" step)
- **Expected**: The step passes on a clean image.
- **Actual**: `found=$(docker run --rm --entrypoint sh "$IMAGE:latest" -c "find / -xdev -name '.env*' ... 2>/dev/null")` runs as the image's `USER node`. In `node:22-bookworm-slim`, `/root` is `0700`, so `find` hits "Permission denied" and exits 1. `2>/dev/null` only hides the message, not the exit code.
  - GitHub's default `run` shell is `bash -e`. A variable assignment from a failing command substitution returns that status, so the step aborts silently, with no `::error::` line. This fails for both matrix legs, which means CI goes red and the push step never runs.
  - Reproduced here as a non-root user: `bash -e -c 'found=$(sh -c "find <0700 dir> -xdev -name \".env*\" 2>/dev/null"); echo reached'` exits 1 without printing `reached`.
  - The impl-log statement "`find / -name '.env*'` in both images returns nothing" was not obtained with the committed command.
- **Fix instruction**: Run the scan as root, so it actually sees every directory, and don't let find's exit code kill the step. Change line 97 to:
  `found=$(docker run --rm --user 0 --entrypoint sh "$IMAGE:latest" -c "find / -xdev -name '.env*' -not -path '/proc/*' 2>/dev/null; true")`
  - If Docker is available, verify the exact committed step locally (`bash -e` with `IMAGE=<built tag>`) and paste the output into impl-log. If not, at least run it against `node:22-bookworm-slim` with `docker run`, or explain in impl-log why that is impossible.

#### Issue 2 — 🟡 should-fix — credential exposure window (security-review finding 3)
- **Where**: `.github/workflows/ci.yml:74-79` ("Docker Hub login") versus `:123-127` ("Push images")
- **Expected**: The token is present on the runner only for the push.
- **Actual**: Login happens before the build, the secret scan and the smoke `docker run`s, none of which need auth.
- **Fix instruction**: Move the "Docker Hub login" step (unchanged, same `if: env.PUSH == 'true'`) so it sits directly before "Push images".

#### Issue 3 — 🟡 should-fix — main runs can be cancelled mid-push (AC3 reliability)
- **Where**: `.github/workflows/ci.yml:11-13`
- **Expected**: Every `main` commit gets its SHA image, and `latest` is not left half-updated.
- **Actual**: `cancel-in-progress: true` applies to `main` too. A quick second merge cancels the first run, possibly between the two `docker push` calls, so that commit's SHA tag may never be pushed.
- **Fix instruction**: Change to `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.

### Rules R1–R10
No violations found. R3 holds: no secret ARG/ENV, `.dockerignore` excludes env files, `check:service-key` runs in CI, and the build needs no env. R7: all changed files are in the plan. R6 is suspended and not flagged.

### Nits (do not block)
- The worker usage string says `cli.ts` when it runs from `dist/cli.js` (pre-existing, not in this diff).
- Optional: add `**/*.pem`, `**/*.key` and `**/.npmrc` to `.dockerignore` (security review).

### Follow-ups (out of scope)
- Move the Docker Hub secrets into a GitHub Environment limited to `main`, and do login/push in a separate job with `environment: dockerhub` (security-review finding 1; needs Ming's repo-settings access).
- Pin the third-party actions (`docker/*`, `pnpm/action-setup`) to commit SHAs and add Dependabot for actions and base images (security-review finding 2; plan follow-up).
- Ming: confirm whether the `stoktok-*` Docker Hub repos will be private, and whether the token can be scoped to them.
- STK-018: worker scheduling and Compose; do not use `restart: always`.

## Attempt 2 — 2026-10-28
Verdict: PASS

R6 waived (suspended). Still no PR or GitHub Actions run, because the loop only opens the PR on DONE. This time I started dockerd and ran the committed workflow steps myself against the local images. The Dockerfiles, app code and `.dockerignore` have not changed since attempt 1 (`git diff 92e0a25 HEAD -- apps .dockerignore` is empty), so the images built in attempt 1 are still valid.

### Checks (run by reviewer)
- typecheck: green
- lint: green
- test: green. core 347 passed / 31 files; db 100 passed + 1 todo / 14 files; worker 65 passed / 8 files; web 176 passed / 20 files
- check:service-key: OK (0 hits)
- `ci.yml` parses as YAML (python `yaml.safe_load`)
- Committed "No secrets in image" step (ci.yml:87-92), copied verbatim and run with `bash -e`: exit 0 for both `stoktok-web` and `stoktok-worker`. Positive control: with the same command, a planted `/root/.env.x` is found.
- Committed "smoke: worker" step (ci.yml:96-100) run verbatim: printed usage and exit 2 was asserted, so the step exits 0.
- Committed "smoke: web" step (ci.yml:104-116) run verbatim: it got an HTTP response, and the log shows only the expected DB-unreachable fetch error with no `Cannot find module`. Step exits 0.
- `id` in both images: `uid=1000(node)`.

### Acceptance criteria
- [x] Dockerfiles multi-stage, workspace-aware, non-root. Evidence: unchanged from attempt 1 (`apps/*/Dockerfile`, `USER node`); confirmed at runtime with `id`.
- [x] CI runs typecheck/lint/test on PRs and main. Evidence: `ci.yml:3-6,41-46`. The attempt-1 blocker is fixed (`ci.yml:91`, `--user 0 … ; true`) and the image job steps now exit 0 locally.
- [x] Images pushed on main with SHA + `latest`. Evidence: `ci.yml:58,80-82,117-127`. Login now sits directly before push (Issue 2 fixed). `cancel-in-progress` is limited to PRs (`ci.yml:13`, Issue 3 fixed). **Flag for Ming:** the real push can only be observed after `DOCKERHUB_NAMESPACE` / `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` are set and the PR is merged.
- [x] No secrets in images, Dockerfiles or repo. Evidence: unchanged from attempt 1, plus the scan step now works (run above).
- [x] Both images build and start locally with a documented command. Evidence: README section; docker run of both smoke steps above. **Flag for Ming:** there is no PR CI run yet, so the hosted-runner image build is unverified until the PR opens.

### Issues
None.

### Rules R1–R10
No violations found. R7: the attempt-2 diff touches only `ci.yml` (plus ticket bookkeeping), and covers exactly the three review issues.

### Nits (do not block)
- The worker usage string says `cli.ts` (pre-existing).
- Optional `.dockerignore` additions: `**/*.pem`, `**/*.key`, `**/.npmrc`.

### Follow-ups (out of scope)
- Move the Docker Hub secrets into a GitHub Environment limited to `main` (security-review finding 1).
- Pin third-party actions to commit SHAs and add Dependabot (security-review finding 2).
- STK-018: worker scheduling and Compose; do not use `restart: always` for the one-shot worker.
