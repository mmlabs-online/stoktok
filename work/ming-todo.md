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
- [ ] The site shows the same data; `~/srv/apps/stoktok/run-job.sh eod-prices --dry-run` exits 0.

**Decisions**
- [ ] STK-094 (cutover) waits for STK-090 (owner-role test:db) per ADR 0010 — run STK-090 first, or waive it.
- [ ] Open a Next.js patch-upgrade ticket? `next build` intermittently aborts with a security advisory (makes `pnpm build` / `check:service-key` flaky).

**Cutover (STK-096 runbook, then STK-094)**
- [ ] Dry run of `scripts/db-migrate-from-supabase.sh --dry-run` against live Supabase into `stoktok_scratch`: OrbStack reaches the Supabase session pooler; schema check result; bind-mount permissions; run it under macOS `/bin/bash` 3.2 and inside `tmux`.
- [ ] Check the `--worker-image` leg with the real release image.
- [ ] Cutover day: follow the STK-096 runbook (freeze web and the job scheduler, move, release, verify).
- [ ] Enter NEW Anthropic/Google keys on Settings, then revoke the old ones at the providers; confirm `ai_keyring_invalid` never appears in the logs.
- [ ] After a successful cutover: rotate the Supabase database password.

**Day +14 (STK-095)**
- [ ] Delete the `stoktok_ai_key_%` rows from Supabase Vault; remove the `SUPABASE_*` data secrets (Auth keys stay); delete `~/srv/backups/stoktok-cutover/`. Keep the Supabase `public` tables as a read-only archive.

## Other open items
- [x] Apply migration `20261105000100_data_gaps_resolved_reason.sql` (STK-046). — applied (Ming, 2026-11-08)
- [x] Then run `run-job.sh resolve-holiday-gaps --dry-run`, review, run for real (STK-046). — done (Ming, 2026-11-08)
- [x] Apply migration `20261106000100_lottery.sql` (STK-053). — applied (Ming, 2026-11-08)
- [ ] ~2026-11-17: check whether HOSE/HNX announce a closure on 2026-11-24 (provisional in the holiday seed).
- [ ] Verify the seeded 2025–2027 holidays and the intraday session hours against hsx.vn / hnx.vn before go-live.
- [x] ~~Rotate the Supabase key pasted in chat on 2026-11-01~~ — dropped (Ming, 2026-11-08: risk accepted, key not rotated).
- [ ] Edit `docs/spec-v1.md` §4, §4.4, §9 Q1 (intraday is fetched by web while open, watchlist + held).
- [x] CLAUDE.md "Runtime" says WSL2; the server is an OrbStack Mac (ADR 0003). — fixed in STK-084 (PR #70)
