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

## Other open items
- [ ] Apply migration `20261105000100_data_gaps_resolved_reason.sql` (STK-046) before deploying that image, then run `run-job.sh resolve-holiday-gaps --dry-run`, review, run for real. — still NOT applied (checked 2026-11-08)
- [ ] Apply migration `20261106000100_lottery.sql` (STK-053) before using the Vietlott features. — NOT applied (checked 2026-11-08)
- [ ] ~2026-11-17: check whether HOSE/HNX announce a closure on 2026-11-24 (provisional in the holiday seed).
- [ ] Verify the seeded 2025–2027 holidays and the intraday session hours against hsx.vn / hnx.vn before go-live.
- [ ] Rotate the Supabase key pasted in chat on 2026-11-01 (follow `docs/deploy.md` key-rotation runbook; if it is the legacy JWT secret, also update `STOKTOK_AUTHEN_SUPABASE_ANON_KEY`).
- [ ] Edit `docs/spec-v1.md` §4, §4.4, §9 Q1 (intraday is fetched by web while open, watchlist + held).
- [ ] CLAUDE.md "Runtime" says WSL2; the server is an OrbStack Mac (ADR 0003).
