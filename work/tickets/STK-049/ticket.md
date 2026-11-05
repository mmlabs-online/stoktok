# STK-049: Intraday prices while the app is open (30 s refresh + "Làm mới")

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | data, architecture, db, ui |
| Attempts | 0 |
| Created | 2026-11-05 |
| PR | — |

## Goal
While Ming has the app open during a trading session, prices for his watchlist and held symbols refresh every 30 seconds, and a "Làm mới" button refreshes them at once. The existing scheduled EOD jobs stay as they are for when the app is closed.

## Spec reference
docs/spec-v1.md §8 v1.1 "Intraday polling"; §2 trading sessions ("Intraday polling only during sessions"), §2 "Intraday data may be delayed. Every price carries a `fetched_at` timestamp and a source"; §5 `prices_intraday` (symbol, ts, price, volume, source, fetched_at); §1.3 non-goal "No guaranteed real-time data". CLAUDE.md R3, R4, R5.

**Spec conflict (flag for Ming):** §4.3 schedules "Intraday price poll (watchlist only) — every few minutes during trading sessions" in the **worker**. Ming chose (2026-11-05) **on-demand fetching by the web server** while the app is open, every 30 s, plus a manual refresh, with the existing scheduled jobs kept for when the app is closed. Spec scope also says "watchlist only"; this ticket uses watchlist + held symbols per Ming.

## Acceptance criteria
- [ ] The latest-price fetch runs on the **web server** only (R3: no browser call to the price source or the DB); it fetches the configured price source (R5) for watchlist + held symbols and stores each price in `prices_intraday` with `source` and `fetched_at` (R4), via a new migration with RLS on and grants to `service_role` only.
- [ ] A server-side throttle makes at most one source call per symbol per ~30 s (configurable), however many tabs or button presses there are; a call inside the window returns the stored price.
- [ ] Outside trading sessions (weekends, seeded/stored holidays, outside session hours — all configuration) no source call is made; pages show the last stored price.
- [ ] Pages that show prices (dashboard, watchlist, symbol page) refresh automatically every 30 s while open and visible, and have a "Làm mới" button that refreshes immediately; each price shows its time ("cập nhật lúc HH:mm:ss") and a stale/delayed state when the fetch fails.
- [ ] The scheduled EOD jobs (18:30 / 21:00) are unchanged; no price or P&L calculation moves into UI components (R1).
- [ ] Unit tests for the session/throttle rules (in `packages/core` where they are logic), the fetch-and-store handler, and the refresh component; `typecheck`, `lint`, `test` green.

## Notes / answers from Ming
- 2026-11-05: "giữ các cronjob cũ khi user k mở app, còn user mở app thì reload sau mỗi 30s, và thêm 1 nút cho user refresh ngay".
- Open for the planner: whether intraday prices feed short-term signals now (spec v1.1 also lists short-term signals) — default: out of scope, follow-up; source rate limits / ToS for 30 s polling of VCI/TCBS public endpoints.
