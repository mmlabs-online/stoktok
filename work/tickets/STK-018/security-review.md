# Security review: STK-018

## Attempt 1 (read-only)

**Verdict:** I found no 🔴 blockers. There are two 🟡 items worth fixing in this ticket and four 🟢 notes. On the focus areas:
- **R3 holds.** The compose file has no literal secrets and no `NEXT_PUBLIC_`, the service-role key is only passed in as an env variable, and CI checks that the images carry no secret-like env names and no `.env*` files.
- **The go-live gate is documented correctly.** G1 (Cloudflare Access or STK-004) must be met before the ingress rule or the DNS record exists, and no host ports are published.

### Findings

1. 🟡 **The web app can be reached without Access by anything else on the shared Docker network.** `deploy/compose.stoktok.yml:23-24, 36-37, 43`
   - `stoktok-web` joins the shared `mmlabs` network, the same one cloudflared uses.
   - Cloudflare Access only protects traffic that comes in through the hostname. Any other mmlabs container on that network can call `http://stoktok-web:3000` directly, with no Access check and no app auth (R6 is suspended). That includes server actions that use the service-role key.
   - So one compromised or buggy sibling app can read and write Ming's portfolio.
   - The worker also joins `tunnel` (line 36-37) but needs no inbound access at all. It only needs to reach Supabase and TCBS.
   - **Fix:**
     - Remove `networks: [tunnel]` from `stoktok-worker`. It then uses the default compose network, which still has internet egress.
     - Either give cloudflared a dedicated `stoktok` network for `stoktok-web`, or record this as an accepted risk in ADR 0003 and the G1 note.
     - Long term: when R6 is restored, the app should verify `Cf-Access-Jwt-Assertion` or the Authen JWT itself, so it does not rely on network placement. That is risk text only for now; per the R6 suspension, no auth code goes in this ticket.
   - Ties to: AC1, R6 note, R3.

2. 🟡 **`run-job.sh` uses a predictable lock path in `/tmp`, and the job name goes into a file path without a check.** `deploy/run-job.sh:12, 15-16, 21`
   - `exec 9>"$LOCK"` opens `/tmp/stoktok-jobs.lock` for writing as the cron user. Any other local user can plant a symlink there first, and the cron user then truncates the file it points to (CWE-377/59).
   - `LOG="$LOG_DIR/$JOB.log"` puts the raw first argument into a path, so `../something` makes the script write outside the log dir (CWE-22).
   - Only the crontab author controls the arguments, and WSL is single-user, so the real exposure is low. Both are still cheap to fix.
   - The script also takes the lock and creates `<badname>.log` before the container rejects an unknown job name.
   - **Fix:**
     - Default the lock to a user-owned path, e.g. `${XDG_RUNTIME_DIR:-$HOME}/.stoktok-jobs.lock`, or `$LOG_DIR/.lock`.
     - Validate the job name before taking the lock: `case "$JOB" in eod-prices|financials|signals) ;; *) echo usage >&2; exit 2;; esac`. This also matches the exit-code 2 behaviour documented in `docs/deploy.md:83`.
   - No command injection: `"$@"` and every variable are quoted, and no `eval` is used.

3. 🟢 **The runbook doesn't say how `SUPABASE_*` reach cron runs.** `deploy/crontab.example:4-5`, `docs/deploy.md:41`
   - Compose only resolves `${SUPABASE_URL:?}` and the key from the shell env or from a `.env` file next to the compose file.
   - If they are missing, compose fails and the job doesn't run (fail-closed), so this is a functional gap, not a leak.
   - The risk is that Ming pastes the service-role key into the crontab, where `crontab -l` shows it in plain text.
   - **Fix:** in `docs/deploy.md`, say that secrets go in the deploy repo's env file (`chmod 600`, git-ignored or encrypted there) and never in crontab lines. Only `STOKTOK_TAG` may sit in the crontab.

4. 🟢 **The literal-secret guard in `scripts/check-deploy-env.sh:29` only catches the `KEY: value` mapping form.**
   - It misses the list form (`- FOO_KEY=literal`), `env_file:` entries, and secret names without KEY/SECRET/TOKEN in them, such as `PASSWORD`.
   - This is defence in depth only; today's compose file is clean.
   - **Fix (optional):** also match `^\s*-\s*[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)[A-Z_]*=` and fail on `env_file:` that points inside the repo.

5. 🟢 **CI.** `.github/workflows/ci.yml:47`
   - The only security-relevant change is the new `pnpm check:deploy-env` step, which is good.
   - Permissions stay `contents: read`. Secrets are only used on push to `main`, so fork PRs get none.
   - From before this ticket: actions are pinned to version tags rather than commit SHAs, and `:latest` is still pushed. The compose file correctly refuses `:latest`.
   - Doc drift: `README.md:19` lists the CI checks but leaves out `check:deploy-env`.

6. 🟢 **Go-live check wording.** `docs/deploy.md:46`
   - "Check Access prompts for login" should spell out how to test it.
   - **Fix:** say to test from a private window or with `curl -sI https://<host>/` and expect a 302 to `*.cloudflareaccess.com`.
   - Also confirm there is no Bypass policy or path exclusion on the Access app, and test a deep path such as `/holdings`, not just `/`.

### Recommendations by criterion
- **AC1 (compose / network):** finding 1. Take the worker off the shared network; isolate or document the web container.
- **AC2 (tunnel route) and the R6 gate:** the G1 ordering is correct. Add the explicit test from finding 6.
- **AC3 (env list / R3):** passes. The env table, `.env.example` and compose are kept in sync by the script. Add the cron-secrets guidance from finding 3.
- **AC4 (restart safety):** a single `flock` plus idempotent windowed jobs is sound. Apply the lock-path and name-validation fix from finding 2.

### Risks
- Until G1 is met, the app's only protection is that it isn't routed. Any wildcard ingress or catch-all in the shared tunnel that sends traffic to the `mmlabs` network would expose it.
- No app-level check that requests came through Access while R6 is suspended. Access is the only barrier.

### Open questions (for Ming / the deploy repo)
1. Does the shared cloudflared config have a wildcard (`*.mmlabs.online`) or a reverse-proxy catch-all that could reach `stoktok-web` without the stoktok-specific rule?
2. Is the tunnel locally managed (YAML ingress) or remotely managed (dashboard Public Hostnames)? If it is remote, `deploy/cloudflared-ingress.example.yml` is ignored, and G1 must be enforced in the dashboard instead.
3. Which other apps share the `mmlabs` network, and is a dedicated stoktok network acceptable?

### Files reviewed
- /home/user/stoktok/deploy/compose.stoktok.yml
- /home/user/stoktok/deploy/cloudflared-ingress.example.yml
- /home/user/stoktok/deploy/run-job.sh
- /home/user/stoktok/deploy/crontab.example
- /home/user/stoktok/docs/deploy.md
- /home/user/stoktok/docs/adr/0003-deploy-and-scheduling.md
- /home/user/stoktok/scripts/check-deploy-env.sh
- /home/user/stoktok/package.json
- /home/user/stoktok/.github/workflows/ci.yml
- /home/user/stoktok/README.md
- /home/user/stoktok/apps/worker/README.md
- /home/user/stoktok/.env.example

This is a static review only. I ran nothing and modified nothing.
