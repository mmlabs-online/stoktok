
## Attempt 1 — 2026-10-27

### Files touched
| File | Required because |
|---|---|
| `apps/web/next.config.ts` | AC1: `output: 'standalone'`, `outputFileTracingRoot` = repo root (via `import.meta.url`, worked) |
| `apps/web/Dockerfile` | AC1/AC4: multi-stage, non-root web image |
| `apps/worker/Dockerfile` | AC1/AC4: multi-stage, non-root one-shot worker image (`pnpm deploy --prod --legacy`; no tsup change needed) |
| `.dockerignore` | AC4 (R3) |
| `.gitignore` | AC4: `.env*` + `!.env.example` (`git check-ignore apps/web/.env.production` prints the path) |
| `.github/workflows/ci.yml` | AC2/AC3/AC4: ci job + images job (build, secret scan, smoke, push on main only) |
| `README.md` | AC3/AC5: "CI and Docker images" section |

### Tests added / changed
- No unit tests (no core change). CI smoke steps in `ci.yml`: "smoke: worker", "smoke: web", "No secrets in image".

### Checks (actual output summary)
- typecheck: green (web, worker, core, db)
- lint: green
- test: green (all packages Done)
- check:service-key: OK, no service key material in client bundle
- build: green; `apps/web/.next/standalone/apps/web/server.js` exists
- db:check: not run (needs a Postgres URL); runs in CI against postgres:16.
- actionlint: not run (not installed).

### Docker evidence (dockerd started locally, v29.9.1)
- Both images built. The sandbox proxy re-terminates TLS, so the plain Dockerfiles fail at corepack/pnpm download (SELF_SIGNED_CERT_IN_CHAIN). I built from scratchpad copies that only add the proxy CA, `NODE_EXTRA_CA_CERTS` and `HTTPS_PROXY` to the base stage, with `--network=host`. The committed Dockerfiles are unchanged by this, and hosted runners have no such issue.
- Image Env names: web `PATH NODE_VERSION YARN_VERSION NODE_ENV HOSTNAME PORT NEXT_TELEMETRY_DISABLED`; worker `PATH NODE_VERSION YARN_VERSION NODE_ENV`. None match KEY|SECRET|TOKEN|PASSWORD. `find / -name '.env*'` in both images returns nothing. Both images have `User: node`.
- Worker smoke: `docker run --rm stoktok-worker` printed `usage: cli.ts <eod-prices|financials|signals> [--dry-run]`, exit=2.
- Web smoke: container with dummy `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` answered HTTP 500 on `/` (expected: dummy DB unreachable). 0 `Cannot find module`/`MODULE_NOT_FOUND` in logs, so the standalone trace is complete.
- Not verifiable here: the GitHub Actions run, real Docker Hub push, and the `gha` cache.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Ming: set `DOCKERHUB_NAMESPACE`, `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` (first main push fails fast until then).
- STK-018: worker scheduling and Compose; avoid `restart: always`.

### Scope self-check
- Could the diff be smaller? No.
- Diff size: about +230 / -3 lines.

## Attempt 2 — 2026-10-28 (REWORK, review attempt 1)

### Files touched
| File | Required because |
|---|---|
| `.github/workflows/ci.yml` | Issue 1: scan runs `--user 0` and find ends with `; true`. Issue 2: "Docker Hub login" moved to directly before "Push images". Issue 3: `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` |

### Evidence (dockerd started locally; images from attempt 1 still present)
- Extracted the committed "No secrets in image" `run:` block verbatim and ran it with `bash -e` against the built images (`IMAGE=stoktok-web`, `IMAGE=stoktok-worker`): both exit 0, no output.
- Old command run as the image user (`USER node`): exit=1 (reproduces the review's finding, find fails on permission errors).
- Positive control: planted `/root/.env.x` in a throwaway container with the new command (`--user 0 ... ; true`): find printed `/root/.env.x`, so the scan would flag it.
- Not verifiable here: the GitHub Actions run itself.

### Checks
- typecheck: green. lint: green.
- test: green. core 347 passed, db 100 passed + 1 todo, worker 65 passed, web 176 passed.

### Out-of-plan files
None. Not committed (as instructed).

### Scope self-check
Only the three listed issues fixed. Diff: +8 / -8 lines.
