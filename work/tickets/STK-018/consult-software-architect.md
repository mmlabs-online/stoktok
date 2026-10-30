# STK-018: software-architect consult

## Blocking inputs: what actually blocks
| Input | Blocks planning? | What it does block | Default the planner can use |
|---|---|---|---|
| App subdomain (spec §9 Q7) | **No** | Only the live tunnel route and the Access policy | `stoktok.mmlabs.online` (the app name is already "stoktok"). Put it in **one** place, e.g. an `APP_HOSTNAME` placeholder in the runbook and in the cloudflared ingress snippet, so swapping it is a one-line change. |
| STK-004 auth vs Cloudflare Access | **No** for planning and for every AC | **Go-live**: the step that turns on the public route | All ACs are artifacts and docs. None of them needs the hostname to be public. R6 says not to add auth code. Cloudflare Access is dashboard config, not repo code. The plan should make "Access policy active, or STK-004 DONE" a **hard pre-step in the runbook, before the tunnel route is added**. Recommended default: Cloudflare Access, allowing Ming's email only. It needs no code, can be undone, and works while R6 is suspended. Ming still has to confirm it. |

The ticket shows ⛔ on the subdomain. I recommend the planner does **not** return `BLOCKED`. Plan with the placeholder, and list both items as go-live gates in the runbook and in the PR.

## Findings
1. **No scheduler exists, and the worker is one-shot.** `apps/worker/Dockerfile` has `ENTRYPOINT ["node","dist/cli.js"]` and exits 2 without a job argument. `/home/user/stoktok/README.md:36` says "Do not give it `restart: always`. Scheduling is decided in STK-018." The schedules are documented only, as crontab lines in `/home/user/stoktok/apps/worker/README.md` (EOD 18:30 and 21:00, financials 18:45, signals 18:55 and 21:15, weekdays, VN time). This **conflicts with AC1's "restart policies"** for the worker. A worker with `restart: always` or `unless-stopped` would crash-loop on exit 2.
2. **The runtime env is smaller than `.env.example`.** The only vars read today are `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (`packages/db/src/client.ts`, through `apps/web/server/db.ts` and `apps/worker/src/cli.ts`). `.env.example` also lists `AUTHEN_SUPABASE_URL`, `AUTHEN_JWT_SECRET`, `ALLOWLIST_USER_IDS`, `SUPABASE_ANON_KEY`, `LLM_PROVIDER` and `LLM_API_KEY`, all marked provisional or unused. Core date logic uses an explicit `Asia/Ho_Chi_Minh` zone (`packages/core/src/calendar.ts`), so container `TZ` does not affect correctness. Only the **host scheduler's** TZ matters.
3. **Idempotency is already in place. The resume is window-based, not checkpoint-based.** EOD re-fetches the last 20 trading days and upserts. Financials re-checks 12 quarters and upserts. Signals are keyed `unique (symbol, rule_id, horizon, signal_date)` and derived from the data date. So "resume from last successful run" means "the next run recomputes the window". An outage longer than about 20 trading days is not recovered; that needs backfill (STK-032).
4. **Known race: `data_gaps` has no unique index.** It has only `data_gaps_symbol_from_idx`. Two overlapping runs, such as cron plus a manual run, can insert the same gap twice. Flagged in the STK-005, STK-014 and STK-031 consults; still open.
5. **Image tags:** `mingming21400/stoktok-{web,worker}` get `:<full sha>` and `:latest`. A push only happens once the Docker Hub secrets are set. Otherwise CI warns and skips the push.
6. **Migrations are not part of the deploy.** Nothing applies `supabase/migrations` at deploy time, and DB changes are forward-only.
7. The web image is standalone Next.js on `0.0.0.0:3000`. It has no health route, and `/` reads the DB.

## Recommendations
- **AC1, worker scheduling.** Pick one option and record it as an ADR, `docs/adr/0003-deploy-and-scheduling.md`:
  - **A (recommended): host cron on the WSL server.** Each entry runs `docker compose run --rm stoktok-worker <job>`. The worker service gets `restart: "no"` and `profiles: [jobs]`, so `compose up -d` never starts it. Web gets `restart: unless-stopped`. This adds no new code or image and follows the documented crontab lines. Cost: cron must be running in WSL (`systemd=true` in `wsl.conf`), and the crontab lives outside the deploy repo unless the repo installs it.
  - **B: a scheduler sidecar.** Ofelia needs the Docker socket mounted, which means root-equivalent access to the host. A supercronic layer would change the STK-017 image (R7). Not recommended.
  - **C: an in-process scheduler in the worker** (long-running, then `restart: unless-stopped`). This is new code and a dependency, and it is outside this ticket's scope (R7). Make it a follow-up only if A proves unreliable.
  - Satisfy AC1 by stating "restart policy: web `unless-stopped`; worker `no` (one-shot by design, see ADR)".
- **AC1, network.** Join an external network that cloudflared is on (placeholder name until the deploy repo confirms it). **Do not publish host ports** (`expose: 3000` only), so the origin is reachable only through the tunnel. That matters while there is no auth. Use prefixed service and container names (`stoktok-web`, `stoktok-worker`) so DNS names on the shared network do not collide with other mmlabs apps. Worker egress is enough. Putting it on the cloudflared network meets the AC and spec §4.1, but it does not need ingress.
- **AC1 and rollback, tags.** Use one variable, e.g. `STOKTOK_TAG=<sha>`, for **both** images so web and worker always run the same commit. Never deploy `:latest` in the deploy repo.
- **AC2, tunnel route.** Document the ingress entry `hostname: ${APP_HOSTNAME} → http://stoktok-web:3000` and the DNS CNAME. Make "Access application + policy exists for the hostname" step 1, before the route is added. Optionally document checking the `Cf-Access-Jwt-Assertion` header later; it is not needed for v1 because no ports are published.
- **AC3, env list.** List vars per service. Required now for web and worker: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Reserved and not read yet: the AUTHEN, ALLOWLIST, ANON and LLM vars. Recommend **not** putting unused secrets into the deploy env yet (least privilege, R3). Optional: `TZ=Asia/Ho_Chi_Minh` for log readability, marked as not functional. Add a check, script or test, that the list in the doc matches the key names in `.env.example`, so they cannot drift.
- **AC4, restart safety.** A documented check is enough; the logic already has tests. Steps: (1) run each job twice and confirm the row counts are unchanged; (2) kill an EOD run mid-way (`docker kill`), rerun, and confirm completeness; (3) state the 20-trading-day recovery limit. Guard against overlap with `flock -n /tmp/stoktok-<job>.lock` in every cron line, which avoids the `data_gaps` race without a migration. The partial unique index stays a follow-up (R7).
- **AC5, runbook** (`docs/deploy.md`):
  - Deploy: confirm the images exist for the SHA, apply migrations first if the release includes any, set `STOKTOK_TAG`, then `pull` and `up -d stoktok-web`.
  - Rollback: set the previous SHA. **Warn that a rollback does not undo migrations.** Only roll back across a migration if the old code is compatible with the new schema.
  - Logs: `docker logs stoktok-web`. **`run --rm` throws away the worker container's logs**, so cron lines must append stdout and stderr with a timestamp to a host log file, e.g. `>> ~/stoktok-logs/<job>.log 2>&1`. Document rotation, and set `json-file` `max-size`/`max-file` on web.
  - Exit codes 0/1/2 mean ok, partial, and usage.

## Risks
- **Public exposure without auth.** The whole portfolio, and unauthenticated server actions (settings, watchlist, ledger writes), become reachable on the internet if the route goes live before Access or STK-004. The mitigation is the ordering of the runbook steps above. The reviewer should check that order.
- **WSL2 availability.** The Docker daemon or cron may not start after a Windows reboot. If the PC sleeps, scheduled runs are missed. EOD recovers within the window, but intraday will not (not in scope yet). Gaps are recorded.
- **Docker Hub secrets may still be unset**, so there would be no images to pull. This is a prerequisite.
- **Migration and image drift** between deploys, because migrations are manual and forward-only.
- **Next.js server actions behind the tunnel.** The Origin/Host check should pass because cloudflared keeps the Host header. Verify one form submission after go-live; there is no config change unless it fails.
- **Deploy repo conventions are unknown** (file layout, network name, how the env is injected, what the self-hosted runner job does). The artifacts may need adapting when they are copied over.

## Open questions (for Ming; none blocks planning)
1. Subdomain: is `stoktok.mmlabs.online` OK? (Go-live gate.)
2. Cloudflare Access on the subdomain, or finish STK-004 before go-live? Recommended: Access now. (Go-live gate.)
3. Scheduling: is host cron in WSL acceptable (option A)? Is systemd and cron enabled in that WSL distro?
4. Deploy repo: the cloudflared network name, the compose file layout and the env/secret mechanism, and whether the self-hosted runner job runs `pull` + `up` per app.
5. Are `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` set yet?
6. Preferred host path for worker logs.

Relevant files: `/home/user/stoktok/work/tickets/STK-018/ticket.md`, `/home/user/stoktok/apps/worker/Dockerfile`, `/home/user/stoktok/apps/web/Dockerfile`, `/home/user/stoktok/apps/worker/README.md`, `/home/user/stoktok/README.md`, `/home/user/stoktok/.env.example`, `/home/user/stoktok/.github/workflows/ci.yml`, `/home/user/stoktok/packages/db/src/client.ts`, `/home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql`, `/home/user/stoktok/docs/spec-v1.md` (§4.1, §7, §9 Q7).
