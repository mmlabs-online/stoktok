## Attempt 1 — 2026-10-30

### Files touched
| File | Required because |
|---|---|
| deploy/compose.stoktok.yml | AC1: web + worker compose snippet |
| deploy/cloudflared-ingress.example.yml | AC2: ingress rule with placeholder hostname |
| deploy/run-job.sh | AC4/5: cron wrapper with shared flock and host logs |
| deploy/crontab.example | AC4: schedule from worker README |
| docs/deploy.md | AC2-5: runbook, env table, gates, restart safety check |
| docs/adr/0003-deploy-and-scheduling.md | scheduling and exposure decision |
| scripts/check-deploy-env.sh | AC3: env drift check |
| package.json | AC3: `check:deploy-env` script |
| .github/workflows/ci.yml | AC3: run the check in CI |
| README.md | line 36 pointer to docs/deploy.md |
| apps/worker/README.md | line 30 pointer to run-job.sh |

### Tests added / changed
- scripts/check-deploy-env.sh (via `pnpm check:deploy-env`); negative check (extra `FOO=` in .env.example) fails as expected. No new unit tests; existing worker idempotency tests unchanged.

### Checks (actual output summary)
- typecheck: pass
- lint: pass
- test: pass (core 365, db 105, worker 74, web 176)
- check:deploy-env: OK; `bash -n` OK on both scripts; `docker compose config` exit 0, no `ports:` in compose file

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Partial unique index on `data_gaps`; web health route; check `Cf-Access-Jwt-Assertion`; in-process scheduler.
- Go-live gates G1 (Access vs STK-004) and G2 (subdomain) are open for Ming.

### Scope self-check
- Could the diff be smaller? no
- Diff size: about +330 / -2 lines
