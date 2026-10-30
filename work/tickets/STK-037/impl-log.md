## Attempt 1 — 2026-10-30

### Files touched
| File | Required because |
|---|---|
| `.github/workflows/release.yml` | AC1: tag release, guards, build+push, digest verify, PR on deployment repo |
| `scripts/check-image.sh` | AC1/AC2: image checks shared by ci and release |
| `.github/workflows/ci.yml` | AC2: three inline check steps replaced by `check-image.sh`; build/tags/push unchanged |
| `apps/web/app/healthz/route.ts` | AC2: `/healthz`, no imports |
| `apps/web/test/healthz.test.ts` | AC2/R8: tests |
| `deploy/deployment-repo/README.md` | AC4: mapping and CODEOWNERS line |
| `deploy/deployment-repo/apps/stoktok/compose.yml` | AC3/AC4/R3: draft compose |
| `deploy/deployment-repo/apps/stoktok/run-job.sh` | AC3: single-job runner (bash 3.2, mkdir lock) |
| `deploy/deployment-repo/apps/stoktok/run-schedule.sh` | AC3: launchd entry, +0700 guard, chain by hour |
| `deploy/deployment-repo/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist` | AC3: LaunchDaemon, 10 intervals |
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | AC4: copy of deploy-recordin with planned deltas |
| `deploy/compose.stoktok.yml`, `deploy/run-job.sh`, `deploy/crontab.example`, `deploy/cloudflared-ingress.example.yml` | AC3/AC5: deleted per plan |
| `scripts/check-deploy-env.sh` | AC3/AC4/AC6: new compose path, DEPLOY_ONLY, new guards |
| `docs/deploy.md` | AC3/AC5: rewritten runbook, env-list block unchanged |
| `docs/adr/0003-deploy-and-scheduling.md` | AC3: amended |
| `apps/worker/README.md` | one line pointing at the moved run-job.sh |

### Tests added / changed
- `apps/web/test/healthz.test.ts`: returns 200 with status ok; echoes STOKTOK_VERSION (null when unset); sets cache-control no-store; answers with the Supabase env unset; route source imports nothing from db/supabase/server modules.
- Note: the test must not name the service-key variable (packages/db `r3-guard.test.ts` flags it), so the unset test stubs `SUPABASE_URL` only.

### Checks (actual output summary)
- typecheck: pass (all packages)
- lint: pass (no errors/warnings)
- test: pass (core 429, db 110 + 1 todo, worker 94, web 202)
- `pnpm check:service-key`: OK. `pnpm check:deploy-env`: OK (includes `bash -n` on scripts and release.yml/compose key agreement).
- plist validated with `xmllint --noout`. `release.yml`, `deploy-stoktok.yml`, `check-image.sh` not executed (need GitHub/Docker); the workflows run for real on tag push and in deployment-repo.
- `grep -riE 'wsl|systemd|crontab|flock'` over docs/deploy.md, ADR 0003, deploy/ hits only ADR context/superseded lines.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- The AC5/Goal wording in ticket.md still says "private" in the Notes; spec 4.1 and CLAUDE.md Runtime row still say WSL.
- Optional post-deploy worker dry-run in deploy-stoktok.
- Deployment repo commits the tunnel token and `apps/calechip/.env` (flagged earlier).
- `deploy-stoktok` notify says "deployed" even if the `publish` step fails (kept to match the template).
- Restoring R6 (STK-004) as defence in depth behind Access.

### Scope self-check
- Could the diff be smaller? No: the pieces are coupled; the deleted files are replaced by the drafts.
- Diff size: not committed (orchestrator commits).

## Attempt 2 (REWORK)

### Files touched
| File | Required because |
|---|---|
| `.github/workflows/release.yml` | Issue 1: removed `git fetch --no-tags origin main` (no credentials with persist-credentials false; `fetch-depth: 0` already provides `origin/main`) |
| `docs/deploy.md` | Issue 2: `sudo -u gh-runner -H` on docker/run-job/docker kill/logs commands, `sudo install -d -o gh-runner` for logs and config dirs, env file created with `-o gh-runner`. Security blocker: new step 9 hard gate (rotate tunnel token, move out of git into a host env file), Access JWT check ("Protect with Access") in the public hostname step; steps renumbered 9-13 |

### Tests added / changed
None (docs and workflow only).

### Checks
- typecheck: pass. lint: pass. test: pass (core 429, db 110 + 1 todo, worker 94, web 202).
- `pnpm check:service-key`: OK. `pnpm check:deploy-env`: OK.

### Out-of-plan files
None.

### Follow-ups
- Deployment-repo change itself (rotate tunnel token, move out of git) is outside this diff.

### Scope self-check
Only the listed review issues were fixed. Not committed (orchestrator commits).
