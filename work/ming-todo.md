# Ming's to-do (things only Ming can do)

Open items that agents cannot do from the sandbox. Tick and date them when done; agents read this before `/run`.

## Intraday prices (STK-049 → STK-050/051)
- [ ] **Record live VCI intraday samples** (gates STK-050). During a trading session, from the repo on the home server:
  ```bash
  bash work/tickets/STK-049/record-vci-intraday-samples.sh
  ```
  Then commit `work/tickets/STK-049/live-samples/` and check the ADR 0006 go/no-go list (batching works, VND unit, fresh timestamps, volume semantics, no 403/429). If the script fails or hits a 403, send the output to the agent.
- [ ] **Apply migration `supabase/migrations/20261105000200_prices_intraday.sql`** in the Supabase SQL editor before deploying any image that writes `prices_intraday` (STK-050 onward).

## Login (STK-004, STK-048) — before the next release
- [ ] In the stoktok Supabase dashboard → Authentication: turn off public sign-ups, anonymous sign-ins and all other providers; keep "Confirm email"; minimum password 12+; Site URL / Redirect URLs = `https://stoktok.mmlabs.online`; create Ming's user (auto-confirm) and copy its UUID. See `docs/deploy.md` → "Restore auth".
- [ ] Deployment repo, environment `stoktok`: add `STOKTOK_AUTHEN_SUPABASE_URL`, `STOKTOK_AUTHEN_SUPABASE_ANON_KEY`, `STOKTOK_ALLOWLIST_USER_IDS`; merge the new `deploy-stoktok.yml` and run it once by hand; then cut the release.

## Other open items
- [ ] Apply migration `20261105000100_data_gaps_resolved_reason.sql` (STK-046) before deploying that image, then run `run-job.sh resolve-holiday-gaps --dry-run`, review, run for real.
- [ ] ~2026-11-17: check whether HOSE/HNX announce a closure on 2026-11-24 (provisional in the holiday seed).
- [ ] Verify the seeded 2025–2027 holidays and the intraday session hours against hsx.vn / hnx.vn before go-live.
- [ ] Rotate the Supabase key pasted in chat on 2026-11-01 (follow `docs/deploy.md` key-rotation runbook; if it is the legacy JWT secret, also update `STOKTOK_AUTHEN_SUPABASE_ANON_KEY`).
- [ ] Edit `docs/spec-v1.md` §1.2, §4, §4.1, §4.2, §4.4, §9 Q1 (auth is stoktok's own Supabase Auth; intraday is fetched by web while open, watchlist + held).
- [ ] CLAUDE.md "Runtime" says WSL2; the server is an OrbStack Mac (ADR 0003).
