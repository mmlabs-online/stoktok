Status: READY

# Plan — STK-018: Deployment to the WSL server

## Spec summary
- docs/spec-v1.md §4.1: "Services (Docker Compose on WSL, same network as cloudflared)". `web` = "Next.js UI and API routes; reads/writes app DB"; `worker` = "Scheduled jobs: price polling, EOD sync, financials, …, signal computation, …".
- §7 Deployment:
  - "Shared deploy repo: Compose definitions + env; deploy jobs on the self-hosted runner on the home server."
  - "Subdomain under mmlabs.online, exposed via the existing Cloudflare Tunnel."
  - "Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo."
  - "`worker` must tolerate restarts: jobs are idempotent and resume from last successful run."
- §9 Q7: "App name and subdomain." (open)
- CLAUDE.md Stack/Runtime: "Docker Compose on Ming's WSL2 home server behind Cloudflare Tunnel". R3: the service role key is server-only. R6 is suspended, with this note: "Exposing the app publicly (STK-018) without auth exposes Ming's portfolio data. Before go-live, either restore R6 (finish STK-004) or put the subdomain behind Cloudflare Access — Ming decides."
- README.md:36: "The worker is one-shot: one container run per job. Do not give it `restart: always`. Scheduling is decided in STK-018."

### Why this plan is READY even though two inputs are still open
The ticket marks the subdomain as "⛔ blocking". It also says Access-vs-STK-004 is Ming's call. I checked each acceptance criterion against both inputs:
- **Subdomain.** No AC needs the real hostname. AC2 asks for the tunnel route to be *documented*, not turned on. The artifacts use one placeholder, `stoktok.mmlabs.online` (the consult's default, matching the app name). It appears only in the ingress example and in the runbook's placeholder table, so changing it later is a one-line edit. The only step that needs the confirmed name is adding the live route and DNS record, which happens at go-live in the deploy repo and Cloudflare dashboard, outside this repo and outside this ticket's diff.
- **Access vs STK-004.** No AC needs this choice. R6 being suspended means no auth code is written either way. Cloudflare Access is dashboard config, not repo code. Both options lead to the same files in this plan. The choice only controls *when the public route may be turned on*. The runbook makes "Access policy active for the hostname, OR STK-004 DONE" a hard gate *before* the ingress route is added. Combined with no published host ports, the app cannot be reached publicly until Ming decides.
- So both items become **go-live gates**, not planning blockers. They go in the runbook (Gate G1/G2) and in the PR description as open questions for Ming. If I returned BLOCKED, the artifacts would not change. It would only delay them.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Compose service definitions for `web` and `worker`, ready to add to the shared deploy repo, on the same network as cloudflared, with restart policies. | Read `deploy/compose.stoktok.yml`: services `stoktok-web` and `stoktok-worker` use images `mingming21400/stoktok-{web,worker}:${STOKTOK_TAG:?…}` (one tag variable for both, never `:latest`). Both join the external network `${STOKTOK_TUNNEL_NETWORK:-…}` (`external: true`). Web has `restart: unless-stopped`, `expose: ["3000"]`, **no `ports:`**, and json-file `max-size`/`max-file`. Worker has `restart: "no"` and `profiles: [jobs]`, as one-shot by design per ADR 0003. If Docker is available: `STOKTOK_TAG=x SUPABASE_URL=x SUPABASE_SERVICE_ROLE_KEY=x docker compose -f deploy/compose.stoktok.yml config` exits 0, and `grep -n 'ports:' deploy/compose.stoktok.yml` finds nothing. `pnpm check:deploy-env` passes (this also covers the compose env names). |
| 2 | Cloudflare Tunnel route for the app subdomain under mmlabs.online documented. | `deploy/cloudflared-ingress.example.yml` has the ingress entry `hostname: stoktok.mmlabs.online` → `service: http://stoktok-web:3000`, marked PLACEHOLDER (§9 Q7). `docs/deploy.md` "Go-live" documents the DNS route and the ordering: **G1 (Access policy, or STK-004 DONE) comes before the route step**. `grep -rn 'stoktok.mmlabs.online' --exclude-dir=node_modules --exclude-dir=work .` shows only the ingress example and the docs placeholder table (plus the ADR mention, if any). |
| 3 | Complete env variable list (names only, no values) matching `.env.example`; secrets stay in the deploy repo (R3). | `pnpm check:deploy-env` exits 0. The script checks: (a) the names in the `docs/deploy.md` env table, between `<!-- env-list:start -->` and `<!-- env-list:end -->`, equal the key set of `.env.example`; (b) every `${VAR}` in the compose file is a `.env.example` key or a listed deploy-only var; (c) the compose file has no literal values for KEY/SECRET/TOKEN names and no `NEXT_PUBLIC_`. Negative check: temporarily add `FOO=` to `.env.example`, and the script fails. The table marks each var as required now (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) or reserved/not read yet. No values anywhere. CI runs the check. |
| 4 | Worker restarts are safe: jobs are idempotent and resume from the last successful run (verified by a test or a documented check). | Existing tests pass under `pnpm test`: `apps/worker/src/jobs/eod-sync.test.ts › re-run with same data: same rows except fetched_at, row count unchanged`, `… › re-run inserts no new gaps`, `apps/worker/src/jobs/financials-sync.test.ts › re-run produces the same rows except fetched_at`, `apps/worker/src/jobs/medium-signals.test.ts › two runs give identical rows (except computed_at); weekend re-run uses Friday signal_date`. In addition, `docs/deploy.md` "Restart safety check" documents three things: the run-twice and kill-mid-run checks, how the window-based resume works (20 trading days EOD, 12 quarters financials; longer outages need STK-032 backfill), and the overlap guard (`flock` in `deploy/run-job.sh`). `bash -n deploy/run-job.sh` exits 0. |
| 5 | Short runbook in `docs/`: deploy, roll back to a previous image tag, view logs. | `docs/deploy.md` has the sections "Deploy", "Roll back" (set `STOKTOK_TAG` to the previous SHA; warns that migrations are forward-only and not undone) and "Logs" (`docker logs stoktok-web`; worker logs in host files written by `run-job.sh`, plus a rotation snippet). The commands are concrete and copy-pasteable. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `deploy/compose.stoktok.yml` | create | AC1: the compose snippet for the deploy repo (web + worker, tunnel network, restart policies, no host ports, shared `STOKTOK_TAG`, env pass-through by name only). |
| `deploy/cloudflared-ingress.example.yml` | create | AC2: the ingress rule snippet with the placeholder hostname. |
| `deploy/run-job.sh` | create | AC4/AC5: the cron wrapper. It takes a lock, runs `docker compose … run --rm stoktok-worker <job> [flags]`, appends timestamped start/end/exit lines and output to a host log, and exits with the job's exit code. |
| `deploy/crontab.example` | create | AC4/AC1: the schedule from `apps/worker/README.md` (EOD 18:30 and 21:00, financials 18:45, signals 18:55 and 21:15, Mon–Fri, VN time), calling `run-job.sh`. |
| `docs/deploy.md` | create | AC2/AC3/AC4/AC5: the runbook covering placeholders and go-live gates, prerequisites, files to copy, env list (with markers), deploy, roll back, logs, restart safety check and exit codes. |
| `docs/adr/0003-deploy-and-scheduling.md` | create | Records the scheduling decision (host cron + one-shot worker), the alternatives rejected, and the no-published-ports exposure stance (consult recommendation). |
| `scripts/check-deploy-env.sh` | create | AC3: a mechanical check that stops the doc, compose and `.env.example` env lists from drifting apart. |
| `package.json` (root) | modify: add `"check:deploy-env": "bash scripts/check-deploy-env.sh"` | AC3: a standard entry point for the check. |
| `.github/workflows/ci.yml` | modify: add `- run: pnpm check:deploy-env` in the `ci` job after `check:service-key` | AC3: drift is caught on every PR. |
| `README.md` | modify line 36 only | Replace "Scheduling is decided in STK-018" with a pointer to `docs/deploy.md` / ADR 0003 so the doc is not stale. |
| `apps/worker/README.md` | modify line 30 only ("compose belongs to STK-017/018") | Point to `deploy/run-job.sh` / `docs/deploy.md` and the real service name `stoktok-worker`. |

No `packages/core` changes. No app code changes.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `scripts/check-deploy-env.sh` (run by `pnpm check:deploy-env`, in CI) | AC3: doc env table == `.env.example` keys; compose `${VAR}`s ⊆ `.env.example` ∪ {`STOKTOK_TAG`, `STOKTOK_TUNNEL_NETWORK`}; no literal secret values and no `NEXT_PUBLIC_` in the compose file. It prints the diff and exits 1 on any mismatch. |
| Existing worker tests (listed in AC4), no new ones | AC4: idempotent re-runs. No new domain logic, so R8 needs no new unit tests. |

## Approach
1. **ADR 0003** (short). Decision: option A from the consult. Host cron in the WSL distro (needs `systemd=true` in `/etc/wsl.conf` and the cron service enabled) calls `deploy/run-job.sh <job>`. The worker stays one-shot (`restart: "no"`, `profiles: [jobs]`, so `compose up -d` never starts it). Web uses `unless-stopped`. Rejected: Ofelia, because it needs the Docker socket (root-equivalent); supercronic, because it changes the STK-017 image (R7); an in-process scheduler, because it is new code and out of scope (R7). Exposure: no published host ports, so the origin can only be reached through cloudflared on the shared network. Public reachability is gated by G1.
2. **Compose snippet** `deploy/compose.stoktok.yml`:
   - The header comment says to copy this into the deploy repo, adapt the network name and env mechanism to its conventions, and never use `:latest`.
   - `stoktok-web`: image `mingming21400/stoktok-web:${STOKTOK_TAG:?set STOKTOK_TAG to a commit SHA}`, `container_name: stoktok-web`, `restart: unless-stopped`, `expose: ["3000"]`, `environment: SUPABASE_URL: ${SUPABASE_URL:?}`, `SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY:?}`, logging json-file `max-size: 10m`, `max-file: "3"`, network `tunnel`.
   - `stoktok-worker`: same tag variable and same two env vars, `restart: "no"`, `profiles: [jobs]`, network `tunnel` (egress only; no ingress is routed to it).
   - Optional non-secret `TZ: Asia/Ho_Chi_Minh` on both, commented as log readability only. Core uses an explicit zone (`packages/core/src/calendar.ts`).
   - `networks: tunnel: external: true, name: ${STOKTOK_TUNNEL_NETWORK:-mmlabs}`, with a comment that the placeholder must be confirmed from the deploy repo.
   - Reserved vars (AUTHEN_*, ALLOWLIST_USER_IDS, SUPABASE_ANON_KEY, LLM_*) are **not** passed. This is least privilege (R3); the runbook table says they are added when a ticket starts reading them.
3. **Ingress example**: a cloudflared `ingress:` fragment, `- hostname: stoktok.mmlabs.online` / `service: http://stoktok-web:3000`, followed by a comment that the catch-all `http_status:404` stays last. It carries a big comment: PLACEHOLDER (§9 Q7), and DO NOT ADD before gate G1.
4. **run-job.sh** (bash, `set -uo pipefail`):
   - Args: `<job> [flags…]`.
   - Env, with defaults: `STOKTOK_COMPOSE_FILE`, `STOKTOK_LOG_DIR` (default `$HOME/stoktok-logs`), `STOKTOK_LOCK` (default `/tmp/stoktok-jobs.lock`).
   - `mkdir -p` the log dir. Use **one shared lock** with `flock -w 1800`, so overlapping cron and manual runs are serialized instead of racing on `data_gaps` (consult finding 4). If the lock wait times out, log it and exit 1.
   - Log `date -Is` start, the job and the tag. Run `docker compose -f "$STOKTOK_COMPOSE_FILE" --profile jobs run --rm stoktok-worker "$@"`, with stdout and stderr appended to `$STOKTOK_LOG_DIR/<job>.log`. Then log end plus the exit code, and exit with that code.
   - Do not hard-code secrets. Compose reads them from the deploy repo's env.
5. **crontab.example**: a header noting that the host TZ must be `Asia/Ho_Chi_Minh` (check with `date`; Debian/Ubuntu cron ignores `CRON_TZ`), with UTC equivalents in comments (VN = UTC+7, no DST). Five lines matching the worker README times, each calling `/path/to/deploy/run-job.sh <job>`.
6. **check-deploy-env.sh**: modelled on `scripts/check-no-service-key-in-client.sh` (bash, `set -euo pipefail`, ROOT detection, prints OK/FAIL). Implements checks a–c from AC3 with grep/sed/sort/comm only, no new dependencies. Wire it into `package.json` and `ci.yml`.
7. **docs/deploy.md** (target ≤ ~200 lines), in this order:
   1. **Placeholders and go-live gates.** A table of `APP_HOSTNAME = stoktok.mmlabs.online` (pending §9 Q7), `STOKTOK_TUNNEL_NETWORK`, and the log dir. Gates **G1**: Cloudflare Access application plus a policy allowing only Ming's email on the hostname, *or* STK-004 DONE with R6 restored (Ming decides; recommended: Access). **G2**: the hostname is confirmed. G1 is required before the ingress route or DNS record is created.
   2. **Prerequisites.** Images for the SHA exist on Docker Hub (`docker manifest inspect mingming21400/stoktok-web:<sha>`); `DOCKERHUB_*` secrets are set; WSL systemd and cron are enabled; Docker starts on boot.
   3. **Files to copy** into the deploy repo.
   4. **Env list**, between the markers. Columns: name, service(s), required now / reserved, secret? (y/n). Names only.
   5. **First deploy / Go-live** (ordered): copy the files → set env in the deploy repo → `up -d stoktok-web` (still private) → verify from the host with `docker compose exec`, or with a curl from a container on the tunnel network → **G1** → **G2** → add the ingress plus `cloudflared tunnel route dns` → check Access in the browser and submit one form (server action Origin/Host check) → install the crontab.
   6. **Deploy** (routine): apply migrations first if the release has any → set `STOKTOK_TAG=<sha>` → `docker compose pull` → `up -d stoktok-web` (the worker picks up the tag on its next run).
   7. **Roll back**: set `STOKTOK_TAG` to the previous SHA (from `docker image ls` or the git log), then `pull` and `up -d`. **Warning: rollback does not undo migrations.** Only roll back across a migration when the old code is compatible with the new schema.
   8. **Logs**: `docker logs -f --tail 200 stoktok-web`; `tail -f ~/stoktok-logs/<job>.log`; a logrotate snippet; the reminder that `run --rm` discards the container's logs, which is why the wrapper exists.
   9. **Restart safety check** (AC4): (i) run each job twice and compare the row counts of `prices_daily`, `financials`, `signals` and `data_gaps`; (ii) start `eod-prices`, `docker kill` it mid-way, rerun, and confirm the counts match a clean run; (iii) the resume semantics and their limits; (iv) the overlap guard.
   10. **Exit codes** 0/1/2 and what to do with each.
8. Update the two README lines.
9. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm check:deploy-env`, plus `bash -n` on both scripts.

Rules:
- R1/R2/R4/R5/R9/R10: not affected, since there is no logic change.
- R3: names only, no values; reserved secrets not passed; no `NEXT_PUBLIC_`; enforced by the check.
- R6: no auth code (it is suspended). The exposure risk is handled by gate G1 and by not publishing ports.
- R7: changes stay inside the file list. The `data_gaps` unique index, a web health route, and the in-process scheduler are follow-ups.
- R8: existing tests plus the new check script.

## Specialist input used
`consult-software-architect.md`:
- Adopted: the subdomain and Access/STK-004 are go-live gates, not blockers; the placeholder default `stoktok.mmlabs.online`; option A (host cron, worker `restart: "no"` + `profiles: [jobs]`, web `unless-stopped`) recorded as ADR 0003; no published ports / `expose` only; prefixed service names; a single `STOKTOK_TAG` and never `:latest`; env split into required now and reserved, with reserved secrets not passed; a drift check against `.env.example`; a documented restart-safety check with the 20-trading-day limit; logs appended to host files; json-file rotation on web; the rollback warning about migrations; the server-action check after go-live.
- Adapted: a **single shared lock with a wait** (`flock -w`) instead of per-job `flock -n`. Per-job locks still let `eod-prices` and `financials` overlap and both write `data_gaps`. A shared lock serializes all stoktok jobs and keeps the schedule order.
- Adapted: the cron logic goes in a wrapper script (`deploy/run-job.sh`) instead of long inline crontab lines, which keeps timestamps and exit codes consistent.
- Deferred (follow-ups, R7): the partial unique index on `data_gaps`; a web health route; checking the `Cf-Access-Jwt-Assertion` header; an in-process scheduler.

## Assumptions
- The deploy repo is not in this workspace. The artifacts are "ready to add" snippets, and Ming or a later step copies and adapts them to the deploy repo's layout, network name and env mechanism.
- The cloudflared network name defaults to `mmlabs` behind `STOKTOK_TUNNEL_NETWORK`, pending confirmation from the deploy repo.
- The env is injected into compose by shell interpolation (`${VAR}`). If the deploy repo uses `env_file`, the snippet is adapted when it is copied; the names stay the same.
- "Resume from the last successful run" (§7) is met by window-based recompute plus idempotent upserts for outages under ~20 trading days. Longer outages are recovered by STK-032 backfill. This is documented and not changed.
- Host cron in WSL is acceptable to Ming (consult Q3). If not, only ADR 0003, the crontab and the wrapper change; the compose snippet does not.
- The worker host log dir defaults to `$HOME/stoktok-logs` (consult Q6) and can be changed through an env var.
- The Docker Hub push secrets may still be unset. That is a runbook prerequisite, not part of this diff.

## Blocking questions
None. These open questions are go-live gates, for the PR description and runbook. They do not block this plan:
1. G2: is `stoktok.mmlabs.online` the subdomain? (§9 Q7)
2. G1: Cloudflare Access (email allowlist) now, or finish STK-004 before go-live? Recommended: Access.
3. Is host cron in WSL OK, and are systemd and cron enabled there?
4. Deploy repo conventions: the cloudflared network name, the compose layout, the env/secret mechanism, and what the runner job runs.
5. Are `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` set?

## Split proposal
None. About 450 changed lines, most of them docs and config. This is a single deployment feature with no product code.
