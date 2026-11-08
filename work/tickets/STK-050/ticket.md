# STK-050: Intraday prices, slice 2 — throttled refresh on the web server and merged prices

| Field | Value |
|---|---|
| State | BLOCKED |
| Priority | P1 |
| Areas | data, architecture, finance |
| Attempts | 0 |
| Created | 2026-11-05 |
| PR | — |

## Goal
A server action fetches intraday prices for watchlist + held symbols through the STK-049 adapter, at most once per symbol per ~30 s, and the dashboard, watchlist and symbol loaders show the latest intraday price merged with EOD data (EOD wins once today's daily row exists).

## Spec reference
docs/spec-v1.md §8 v1.1 "Intraday polling"; §2 trading sessions; §5 `prices_intraday`; §1.3 no guaranteed real-time. CLAUDE.md R1, R3, R4, R5, R6. Depends on STK-049. Spec conflict (§4.1/§4.4 worker polling, "watchlist only") recorded in ADR 0006.

## Acceptance criteria
- [ ] A server action (calls `requireUser()` first, R6) refreshes intraday prices; symbols come from the server (watchlist + held), never from the client; the browser never calls the source or the DB (R3).
- [ ] Throttle and backoff rules are pure functions in `packages/core` (configurable interval, R5): at most one source call per symbol per ~30 s however many tabs or button presses; source failures are throttled too (breaker on 403/429).
- [ ] Outside trading sessions (STK-049 session rule) no source call is made; pages show the last stored price.
- [ ] A core merge rule picks the displayed price: today's intraday quote when there is no daily row for today, otherwise the daily row; intraday data is never written to `prices_daily`. Dashboard P&L/market value, watchlist and symbol page use it (R1).
- [ ] Unit tests for the throttle, merge and handler (closed → no call, concurrent calls → one source call, failure → stored price kept); `typecheck`, `lint`, `test` green.

## Notes / answers from Ming
- 2026-11-05: split from STK-049. **Blocked until Ming runs `work/tickets/STK-049/record-vci-intraday-samples.sh` from the home server during a session and the ADR 0006 go/no-go checklist passes.**
- Security (STK-049): add apps/web/server/sources.ts with 'server-only' and pin web importers of @stoktok/sources in r3-guard.test.ts before web imports it.
- 2026-11-05: Ming merged STK-049 (PR #37) and will do the live-sample recording and the prices_intraday migration later — tracked in work/ming-todo.md.
- From STK-051 plan (2026-11-05): implement the body of `refreshPricesAction` in `apps/web/app/(app)/prices/actions.ts` using the core `RefreshPricesResult` contract (STK-051 ships a stored-only interim body); also update the watchlist subtitle and add the "(tạm tính)" note on the dashboard.
- From STK-051 security review (finding 3): enforce the throttle on the server before any source fetch; the client throttle and `nextInMs` are only hints.
