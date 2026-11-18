# Ming's to-do (things only Ming can do)

Open items that agents cannot do from the sandbox. Tick and date them when done; agents read this before `/run`.

## Intraday prices (STK-049 → STK-050/051)
- [ ] **Record live VCI intraday samples** (gates STK-050). During a trading session, from the repo on the home server:
  ```bash
  bash work/tickets/STK-049/record-vci-intraday-samples.sh
  ```
  Then commit `work/tickets/STK-049/live-samples/` and check the ADR 0006 go/no-go list (batching works, VND unit, fresh timestamps, volume semantics, no 403/429). If the script fails or hits a 403, send the output to the agent.
- [x] **Apply migration `supabase/migrations/20261105000200_prices_intraday.sql`** in the Supabase SQL editor before deploying any image that writes `prices_intraday` (STK-050 onward). — applied (verified 2026-11-08)

## Login (STK-004, STK-048) — before the next release
- [ ] In the stoktok Supabase dashboard → Authentication: turn off public sign-ups, anonymous sign-ins and all other providers; keep "Confirm email"; minimum password 12+; Site URL / Redirect URLs = `https://stoktok.mmlabs.online`; create Ming's user (auto-confirm) and check that Authentication → Users lists only Ming. This is the only access control now (STK-060, no allowlist). See `docs/deploy.md` → "Restore auth".
- [ ] Deployment repo, environment `stoktok`: add `STOKTOK_AUTHEN_SUPABASE_URL`, `STOKTOK_AUTHEN_SUPABASE_ANON_KEY`; merge the new `deploy-stoktok.yml` and run it once by hand; then cut the release.
- [ ] STK-060 order, if an auth image (STK-004+) is already released: (a) merge STK-060 and release the new image while the deployment repo still has the old workflow; (b) then merge the deployment-repo PR with the new `deploy-stoktok.yml`; (c) only then delete `STOKTOK_ALLOWLIST_USER_IDS` from the `stoktok` environment. Do not roll back to a pre-STK-060 auth image after (b). If no auth image is released yet, skip the allowlist secret entirely. See `docs/deploy.md` → "Remove the allowlist (STK-060)".

## Move to the shared Postgres (STK-084 → STK-095)
Order matters; never print the env file or a password (`docker inspect` only with `-f`).

**Now — runner**
- [ ] The self-hosted runner `macbook-runner` (deployment repo) is not picking up jobs. Bring it back online (GitHub → mmlabs-online/deployment → Settings → Actions → Runners). Queued since then: `deploy-postgres` #9 (deployment#88, STK-092) and `deploy-stoktok` #10 (deployment#90, STK-093). They start by themselves once it is online.

**After `deploy-postgres` #9 is green (STK-092)**
- [ ] First backup: `docker compose -p postgres -f ~/srv/postgres/compose.yml exec pg-backup /backup.sh`
- [ ] Restore test: `bash ~/srv/ops/backup/restore-test.sh stoktok` exits 0.
- [ ] Report the size of `~/srv/backups/postgres/daily/stoktok-*.dump` to the agent. If ≤ 1 KiB, the 03:30 offsite sync fails for every database until data arrives → the agent opens a P1 follow-up.

**After `deploy-stoktok` #10 is green (STK-093, expand)**
- [ ] The run's PR comment says `deployed … v0.2.1 … healthy`.
- [ ] `ls -l ~/.config/stoktok/stoktok.env` shows `-rw-------`; `cut -d= -f1 ~/.config/stoktok/stoktok.env` lists 8 names.
- [ ] `docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' $(docker compose -p stoktok ps -q stoktok-web)` shows `db web`.
- [ ] The site shows the same data; `/Users/mingming/stoktok/current/run-job.sh eod-prices --dry-run` exits 0.

**Decisions**
- [ ] STK-094 (cutover) waits for STK-090 (owner-role test:db) per ADR 0010 — run STK-090 first, or waive it.
- [ ] Open a Next.js patch-upgrade ticket? `next build` intermittently aborts with a security advisory (makes `pnpm build` / `check:service-key` flaky).

- [ ] **Approve the cutover release**: the orchestrator cuts `release/v0.3.0` from the STK-094 merge commit and adds the compose commit to deployment PR `release/stoktok-v0.3.0`. Do not merge that PR before stage 4. Close any stale `release/stoktok-v0.2.2` PR unmerged.

**Cutover (`docs/deploy.md` "Cutover runbook (STK-096)"; stage names as in the runbook)**
- [ ] **0. Preconditions**: runner online and the two deploys above green; STK-090 merged or waived; STK-094 release PR open and not merged and changing exactly `release.env` + `compose.yml` (`pr-scope` green); worker image from its `release.env` pulled; tag checkout; `PG_CLIENT_IMAGE` pinned by digest; Supabase pooler details in the password manager; optional root cert (`MOVE_SRC_SSLROOTCERT`); `~/srv/backups/stoktok-cutover` mode 700 and `tmutil isexcluded` says excluded; work inside `tmux`.
- [ ] **1. Dry run**: `--dry-run --target stoktok_scratch --worker-image <release worker image>` against live Supabase under macOS `/bin/bash` 3.2: OrbStack reaches the session pooler, schema check result, bind-mount permissions, the `--worker-image` leg; drop `stoktok_scratch`; no dump or `pgpass` left.
- [ ] **2. Freeze**: weekend or outside the 18:30/21:00 Mon-Fri slots; totals noted; scheduler booted out; no job running; `stoktok-web` stopped; no reboot or deployment merge until stage 4 is done.
- [ ] **3. Move**: `--target stoktok --worker-image ... --schema-check`; `move OK`; numbers and dump path noted; `ai_usage` baseline noted.
- [ ] **4. Release**: merge the STK-094 release PR; `migrate` prints `up to date`, web healthy on `/readyz`, scheduler reinstalled; pre-migration dump copied into `~/srv/backups/stoktok-cutover/`.
- [ ] **5. Verify and smoke**: `/healthz` version, `/readyz` (Access redirect from outside), login, totals, write and delete, job dry run then real runs twice with unchanged counts, logs clean, scheduler loaded, next-day pg-backup.
- [ ] **6. AI keys**: enter NEW Anthropic/Google keys on Settings, one AI action raises the `ai_usage` id, replace old env-secret keys, revoke the old ones at the providers; `ai_keyring_invalid` never appears in the logs (cutover day and next day).
- [ ] **7. After the cutover**: rotate the Supabase database password (after a successful cutover, and after any outcome if stage 0.8 fell back to `require`); no leftover `pgpass` dir; clear shell history if the password was exported.

**Day +14 (runbook stage 9, STK-095)**
- [ ] Contract PR merged first; delete `STOKTOK_SUPABASE_URL` and `STOKTOK_SUPABASE_SERVICE_ROLE_KEY` from the environment (Authen keys stay); delete the `stoktok_ai_key_%` rows from Supabase Vault; keep the Supabase `public` tables as a read-only archive; delete `~/srv/backups/stoktok-cutover/`. After that a rollback to v0.2.1 is impossible.

## Other open items
- [x] Apply migration `20261105000100_data_gaps_resolved_reason.sql` (STK-046). — applied (Ming, 2026-11-08)
- [x] Then run `run-job.sh resolve-holiday-gaps --dry-run`, review, run for real (STK-046). — done (Ming, 2026-11-08)
- [x] Apply migration `20261106000100_lottery.sql` (STK-053). — applied (Ming, 2026-11-08)
- [ ] ~2026-11-17: check whether HOSE/HNX announce a closure on 2026-11-24 (provisional in the holiday seed).
- [ ] Verify the seeded 2025–2027 holidays and the intraday session hours against hsx.vn / hnx.vn before go-live.
- [x] ~~Rotate the Supabase key pasted in chat on 2026-11-01~~ — dropped (Ming, 2026-11-08: risk accepted, key not rotated).
- [ ] Edit `docs/spec-v1.md` §4, §4.4, §9 Q1 (intraday is fetched by web while open, watchlist + held).
- [x] CLAUDE.md "Runtime" says WSL2; the server is an OrbStack Mac (ADR 0003). — fixed in STK-084 (PR #70)
