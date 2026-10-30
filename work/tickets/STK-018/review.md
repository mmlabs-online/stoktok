## Attempt 1 — 2026-10-30
Verdict: REWORK

### Checks (run by reviewer)
- typecheck: pass (exit 0)
- lint: pass (exit 0)
- test: pass. core 365, db 105 (+1 todo), worker 74, web 176. Matches impl-log.
- check:deploy-env: `OK: deploy env lists consistent`. Negative checks run on a scratch copy all fail with exit 1 as intended: extra `FOO=` in .env.example, undeclared `${BAR}` in compose, literal `SUPABASE_SERVICE_ROLE_KEY: abc123`, `LLM_API_KEY: "sk-abc"`, and `NEXT_PUBLIC_X`.
- `bash -n` passes on both scripts. `docker compose config` (with dummy vars) exits 0. `--profile jobs config --services` lists stoktok-web and stoktok-worker. `grep ports:` finds nothing.
- run-job.sh smoke test with a fake `docker` (exit 3) on PATH: start/end lines and output go to the host log, the wrapper exits 3, and calling it with no args exits 2.

### Acceptance criteria
- [x] AC1 Compose web + worker, same network as cloudflared, restart policies. Evidence: deploy/compose.stoktok.yml:7-43. Web uses `unless-stopped` and `expose` only. Worker uses `restart: "no"` and `profiles: [jobs]`. The network is external `${STOKTOK_TUNNEL_NETWORK:-mmlabs}`. The tag is a single `STOKTOK_TAG` with `:?`.
- [x] AC2 Tunnel route documented. Evidence: deploy/cloudflared-ingress.example.yml:5-10; docs/deploy.md:13 (G1) and :43-49 (G1 comes before the route). The placeholder hostname appears only in the ingress example and docs/deploy.md:9.
- [x] AC3 Env list names-only, matching .env.example, secrets in the deploy repo. Evidence: docs/deploy.md:27-38, the check script and its negative checks above, and the CI step at .github/workflows/ci.yml:47.
- [x] AC4 Restart safety. Evidence: the tests pass: eod-sync.test.ts:122 and :218, financials-sync.test.ts:105, medium-signals.test.ts:103. The documented check is at docs/deploy.md:72-78. The flock guard is at deploy/run-job.sh:21-25. Caveat: Issue 1 affects whether cron runs succeed at all.
- [ ] AC5 Runbook: deploy, roll back to a previous tag, logs. FAILED, see Issue 1. As documented, the rollback does not reliably roll back the worker.

### Issues
#### Issue 1 — 🔴 blocker — runbook correctness (deploy/rollback tag does not reach cron-run worker; cron env undefined)
- **Where**: docs/deploy.md:51-60 (Deploy, with `export STOKTOK_TAG=<sha>` and "The worker picks up the tag on its next run"), docs/deploy.md:62-63 (Roll back), deploy/crontab.example:4-5.
- **Expected**: The web container and the cron-run worker get `STOKTOK_TAG`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from one persistent source. Deploy and rollback change the tag in that one place, so the next worker run uses the same tag as web. Secrets never go into the crontab.
- **Actual**: Deploy tells the operator to `export STOKTOK_TAG` in an interactive shell. Cron never sees that shell's environment. Depending on what is set elsewhere, the worker then either keeps running the old tag (after a rollback it stays on the new code, possibly against a schema it doesn't match) or fails every run on `${STOKTOK_TAG:?}`. The claim "The worker picks up the tag on its next run" is false under these instructions. crontab.example also suggests setting STOKTOK_TAG "in the crontab", and says nothing about how `${SUPABASE_URL:?}` and `${SUPABASE_SERVICE_ROLE_KEY:?}` reach cron. With only these instructions, every cron job fails at compose interpolation.
- **Fix instruction** (docs/comments only, no new files):
  1. In docs/deploy.md, add a short note before "First deploy" saying that all compose variables (`STOKTOK_TAG`, `STOKTOK_TUNNEL_NETWORK`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) live in one env file next to `compose.stoktok.yml` in the deploy checkout (`.env`, which Compose v2 loads from the project directory, i.e. the compose file's directory). Say that this applies to both `up -d` and `run-job.sh`, or to whatever single mechanism the deploy repo uses.
  2. In "First deploy" step 2, "Deploy" and "Roll back", replace `export STOKTOK_TAG=<sha>` / `STOKTOK_TAG=<sha> docker compose …` with "edit `STOKTOK_TAG=<sha>` in that env file", then `pull` and `up -d stoktok-web`. Keep the sentence that the worker uses the new tag on its next run; it is true once the tag comes from the env file.
  3. In deploy/crontab.example:4-5, replace the comment. The new comment says that compose variables, including secrets, come from the env file beside the compose file and are never put in the crontab.

### Rules R1–R10
No violations found. R3: the compose file passes only SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, by reference, to server-side containers. It has no `NEXT_PUBLIC_`, and the drift check enforces both. R5/R7: no app code changed, and every changed file is in the plan's list (the work/ files are workflow bookkeeping). R6 is suspended, so no auth was expected. Exposure is gated by G1 and by publishing no host ports.

### Nits (do not block)
- docs/deploy.md:69: the logrotate snippet puts everything on one line inside braces. logrotate expects one directive per line, so check it or write it as a multi-line block.
- docs/deploy.md:53-58: `docker compose pull` without `--profile jobs` does not pull the worker image. `run` pulls it on demand at the first cron run. Consider `--profile jobs pull` so a missing worker tag shows up at deploy time.
- deploy/run-job.sh:16: `$JOB` is used unvalidated in the log file name. It is harmless with crontab input; restricting it to `[a-z-]+` would be tidier.

### Follow-ups (out of scope)
- Already listed by the implementer: a partial unique index on `data_gaps`, a web health route, checking `Cf-Access-Jwt-Assertion`, an in-process scheduler.
- Go-live gates G1 (Access vs STK-004) and G2 (subdomain) are open for Ming.
