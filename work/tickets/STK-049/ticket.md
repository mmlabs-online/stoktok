# STK-049: Intraday prices, slice 1 — source adapter, storage and session rule

| Field | Value |
|---|---|
| State | REVIEW |
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
Slice 1 of 3 (Ming chose the split on 2026-11-05; slices 2 and 3 are STK-050 and STK-051). The original criteria are kept below for reference.
- [ ] `prices_intraday` exists through a new migration (symbol, ts, price, volume, source, fetched_at; integer price, bigint volume, R2; `source`/`fetched_at` not null, R4; RLS on, grants to `service_role` only), with rollback and `scripts/db-check/checks.sql` additions.
- [ ] A server-only intraday price adapter for the configured source (R5) fetches a list of symbols in one batched call; no `'use client'` file can import it (R3 guard); endpoint, User-Agent and tuning values come from config.
- [ ] A db repo stores each quote with `source` and `fetched_at` (upsert on symbol+ts) and reads the latest quote per symbol; quotes failing unit/sanity rules are rejected in core.
- [ ] The trading-session rule (weekends, holidays, session hours as configuration) is a pure function in `packages/core` with table tests.
- [ ] The scheduled EOD jobs are unchanged.
- [ ] A live-check script for Ming (honest headers, stops on 403) and an opt-in samples test exist; ADR 0006 records the decision and the go/no-go checklist. `typecheck`, `lint`, `test` green.

### Original criteria (whole feature, across STK-049/050/051)
- The latest-price fetch runs on the web server only (R3); it fetches the configured price source (R5) for watchlist + held symbols and stores each price in `prices_intraday` with `source` and `fetched_at` (R4), via a new migration with RLS on and grants to `service_role` only.
- A server-side throttle makes at most one source call per symbol per ~30 s (configurable), however many tabs or button presses there are; a call inside the window returns the stored price.
- Outside trading sessions no source call is made; pages show the last stored price.
- Pages that show prices refresh every 30 s while open and visible, and have a "Làm mới" button; each price shows its time and a stale/delayed state when the fetch fails.
- The scheduled EOD jobs are unchanged; no price or P&L calculation moves into UI components (R1).
- Unit tests for the session/throttle rules, the fetch-and-store handler, and the refresh component.

## Notes / answers from Ming
- 2026-11-05: "giữ các cronjob cũ khi user k mở app, còn user mở app thì reload sau mỗi 30s, và thêm 1 nút cho user refresh ngay".
- Open for the planner: whether intraday prices feed short-term signals now (spec v1.1 also lists short-term signals) — default: out of scope, follow-up; source rate limits / ToS for 30 s polling of VCI/TCBS public endpoints.
- 2026-11-05: Ming approved splitting into 3 slices: STK-049 (adapter, storage, session rule, live check), STK-050 (throttle, refresh server action, merged prices in loaders incl. dashboard P&L; blocked until the live check passes), STK-051 (refresh bar UI, 30 s auto refresh, "Làm mới").
