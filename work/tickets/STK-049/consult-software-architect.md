# STK-049 consult: software-architect

## Findings
1. **The price adapters live inside the worker app.** `PriceSource`, `SourceError`, `http.ts` (getJson/postJson), `TcbsPriceSource`, `VciPriceSource`, `createPriceSource`, and the `PRICE_SOURCE_IDS` / `TCBS_CONFIG` / `VCI_CONFIG` constants are all under `/home/user/stoktok/apps/worker/src/sources/` and `/home/user/stoktok/apps/worker/src/config.ts`. The web app cannot import them cleanly: one app importing another is a smell, and Next would have to bundle worker code. The adapters already take `fetchImpl` as a parameter, so they are easy to move. They are daily-only (`fetchDaily`), and their User-Agent says "low-volume end-of-day sync". The VCI request body already takes a `symbols: [...]` array, but whether it accepts more than one symbol, and which intraday timeframe or price-board endpoint to use, is unverified (the ADRs say the sandbox cannot reach VN hosts).
2. **`http.ts` has worker-style retry settings.** The EOD config uses a 15 s timeout, 3 attempts and exponential backoff. On a web request path that could hold the server for about 45 s.
3. **`requireUser()` redirects or calls `forbidden()`** (`/home/user/stoktok/apps/web/server/auth/require-user.ts`). That is correct for pages and server actions. In a JSON route handler called with `fetch`, a redirect comes back as the login HTML with status 200 unless the handler uses `authenticate()` and returns 401 itself.
4. **Loaders read only `prices_daily`.**
   - `loadWatchlist` and `load-symbol` use `getRecentCloses(db, syms, 2)` → `buildPriceBoardRow`.
   - `loadDashboard` uses `getLatestCloses`.
   - `buildPriceBoardRow` (`/home/user/stoktok/packages/core/src/market/price-board.ts`) treats `bars[0]` as "last" and `bars[1]` as the reference, with the ex-date and gap rules. `priceStatus` and `expectedPriceDate` are date-based only, so there is no notion of a time-of-day or age-based stale state.
5. **Calendar helpers exist but sessions do not.** `isTradingDay`, `vnMinutesOf` (minute precision) and holidays (`entry.settings.holidays`) are in core. There is no session-hours config yet.
6. **One web container, no in-process scheduler** (ADR 0003, `/home/user/stoktok/docs/adr/0003-deploy-and-scheduling.md`). Note: ADR 0003 says the host is now an OrbStack Mac, while CLAUDE.md still says WSL2. This is unrelated to this ticket, but someone should fix the doc drift.
7. **`prices_intraday` does not exist yet** (no migration). The roadmap item (`/home/user/stoktok/docs/ticket-roadmap.md:131`) still describes worker polling. That is the same conflict as spec §4.1/§4.3.
8. **Existing guard tests can be reused.** `/home/user/stoktok/apps/web/test/no-hardcoded-rules.test.ts` and `no-calc-in-ui.test.ts`, plus `/home/user/stoktok/packages/db/src/r3-guard.test.ts`, are patterns to extend.

## Recommendations

**A. How the 30 s refresh works: server action, then `router.refresh()`.** (AC1, AC4, R3, R6)
- **Recommended:** a server action `refreshIntradayAction()` with no client-supplied symbols.
  - It calls `requireUser()` first, then `refreshIntraday(deps)`, which fetches only what is due and stores it.
  - It returns `{ status: 'ok' | 'throttled' | 'closed' | 'failed', nextInMs, sessionOpen }`.
  - The client then calls `router.refresh()`, so the server-rendered pages re-run their loaders and the existing price board renders the merged prices. No price math moves to the client (R1).
  - Next 16 may let the action call `refresh()` from `next/cache` itself, which saves a round trip. Verify that against the installed version.
  - Why: built-in Origin/CSRF check, `requireUser()` redirect semantics work, no new public surface, and no client-side duplicate of the price board.
- **Alternative: GET route handler returning JSON** (proxy-gated, plus `authenticate()` → 401). Cost: the client would have to render prices from JSON, so the board becomes a client component or is duplicated. It also needs its own auth response shape. Choose it only if server actions are rejected.
- **Rejected: `router.refresh()` alone, with the loader fetching from the source during render.** It is a side effect in GET rendering, ties page latency to the source, and can fire on prefetch. Page render must stay read-only. The client calls the action once on mount instead.
- **Caveat:** Next runs server actions from one client one at a time. A slow refresh would delay a watchlist add or delete, which is another reason for a tight time budget (see D).

**B. Client trigger: a `<IntradayRefresher intervalMs={...} />` client component.** (AC4, R3, R5)
- **Scheduling:**
  - Use a chained `setTimeout`, not `setInterval`, so the next tick is scheduled only after the previous action finishes and calls never overlap.
  - Pause when `document.visibilityState === 'hidden'`. On `visibilitychange` back to visible, refresh at once if the last refresh is older than the interval. Optionally skip while `navigator.onLine === false`.
  - Stop the timer while the server says the session is closed, and wake again at `nextInMs`. This avoids weekend polling.
- **Button:** "Làm mới" calls the same function immediately and resets the timer. It is disabled while pending (`useTransition`). It shows the server's `failed` status as the stale or delayed notice.
- **Config, not literals (R5):** the interval comes from server config passed as a prop. The browser only ever calls the server action; it never calls the source or the DB.
- **Placement:** mount it on the dashboard, watchlist and symbol pages, or once in `(app)/layout.tsx` with a per-page opt-in.
- **Guard test:** extend the R3 guard so files with `'use client'` cannot import `@stoktok/db` or the new sources package.

**C. Share the adapter through a new package, `packages/sources` (`@stoktok/sources`).** (AC1, R5, R7)
- **Recommended: move the code without changing behaviour.** Move `price-source.ts`, `http.ts`, `tcbs.ts`, `vci.ts`, `select-price-source.ts` and the source config constants, with their tests unchanged. The worker imports from the package; the EOD job logic stays as it is (AC5). Do the move in a separate commit so the reviewer can check it is behaviour-neutral.
- Add a new interface: `LatestPriceSource.fetchLatest(symbols[]) → { quotes: {symbol, ts, price, volume}[], rejected }`. Batch the request if the source allows, so one call covers all due symbols. Add a VCI and/or TCBS implementation, an intraday-specific User-Agent, and a config such as `INTRADAY_CONFIG` (`source`, `timeoutMs`, `maxAttempts: 1`, `throttleMs`, `staleAfterMs`).
- Price normalization stays in core: add `normalizeIntradayQuote` (integer VND, unit and sanity guard, ideally checked against the reference ± the price limit). Core stays pure, with no I/O.
- **Alternative:** move only `http.ts` and `SourceError`, and put the new intraday adapter in the package. That is a smaller diff, but the EOD adapters stay split across two places. Either way, do **not** put I/O in `packages/core` or `packages/db`.
- In web, import the package only from `apps/web/server/intraday/*`, which carries the `server-only` marker.

**D. Where the logic lives.** (R1, R5, AC2, AC3, AC6)
- **`packages/core/src/market/intraday.ts`, pure functions:**
  - `parseIntradaySessions(rule_configs)` with defaults: morning and afternoon windows, the ATO/ATC edges, and a **post-close grace** so the ATC price is captured. Without the grace, the price shown from 14:45 until the 18:30 EOD job may be a pre-ATC tick.
  - `isIntradayWindow(now, holidays, sessions)`: weekends, holidays, before open, lunch break and after close all return false.
  - `symbolsDue(lastAttemptAt: Record<symbol, iso|null>, now, throttleMs)`.
  - `intradayStatus(tick, now, sessionOpen, staleAfterMs)` → `live | stale | closed`.
  - `mergeLatestBars(dailyBars, intradayTick, today, holidays)` (see F).
- **`apps/web/server/intraday/refresh.ts`:** `refreshIntraday({ db, source, now, config, log })`, with the same injected-dependencies style as the worker jobs. It derives the symbols on the server: held (from the ledger via core) plus the watchlist.
- **Time budget:** one attempt, a timeout of about 5 s, a total budget below the interval, and limited concurrency.

**E. Concurrency and the throttle with one container and many tabs.** (AC2)
- Use two layers:
  1. **In-process single-flight:** a module-level `Map<key, Promise>` so concurrent calls in the same Node process share one source call.
  2. **A DB-backed window:** skip a symbol if its last attempt is newer than `now - throttleMs`.
- **Throttle on attempt time, not success time.** Otherwise a failing source gets hit on every tab's tick. Keep `lastAttemptAt` in memory; on restart, fall back to the latest `fetched_at` per symbol.
- **Accept the remaining race:** two processes could each make one extra call. This cannot happen with one container; document it.
- **Optional strict version:** a DB claim, either an atomic conditional update on an `intraday_fetch_state(symbol, claimed_until)` row or an RPC. Worth it only if the worker ever polls too.
- **Circuit breaker, in memory:** after K consecutive failures, or on any 429, pause calls for M minutes. On 403, stop for the day, with no bypass (in line with ADR 0004).

**F. Which price is "latest" when intraday meets EOD.** (AC4, AC5, R1, R4)
- **Never write intraday data into `prices_daily`.** Signals, adjusted-history cut-offs, backfill and gap detection depend on it.
- **Core merge rule:** if the latest intraday tick's VN date is today, today is a trading day, and `prices_daily` has no row for today, put a synthetic `StoredClose { tradeDate: today, close: tick.price, volume, source, fetchedAt }` in front of the daily bars. If today's daily row exists, after EOD, the daily row wins as the authoritative close. Ticks from earlier days are ignored.
- **Why this works:** `buildPriceBoardRow` then works unchanged for the reference, change, ceiling/floor, ex-date and gap rules. The dashboard feeds the merged quote into `buildPortfolio`.
- **Row fields:** add `kind: 'intraday' | 'eod'` and an `intradayStatus` field so the UI shows "cập nhật lúc HH:mm:ss" or the stale notice without computing anything.
- **Watch the date-based status:** check that `priceStatus` / `expectedPriceDate` do not flag a today-intraday row wrongly, and that the stale state uses `intradayStatus` (based on age) during the session.
- **Tick fields:** keep `ts` (the source's trade time) separate from `fetched_at` (our time).

**G. Storage.** (AC1; details for the database-optimizer)
- Upsert on `(symbol, ts)`, **updating `fetched_at`** on conflict, so a source that returns the same last trade still advances the throttle and freshness.
- Add an index on `(symbol, ts desc)`. For latest-per-symbol, use one query per symbol, as the existing pattern does, or a `DISTINCT ON` view.
- RLS on; revoke `anon` and `authenticated`; grant `service_role` only.
- A retention job is a follow-up.

**H. Auth.** (R6)
- The server action calls `requireUser()` on its first line, and a test asserts that ordering, as the existing handler tests do.
- No new route means no change to `PUBLIC_PATHS`. If a route handler is chosen anyway, it stays behind the proxy and must return 401 or 403 JSON via `authenticate()`, not redirect.
- Do not take symbols from the client. If the symbol page sends one, validate it with core symbol validation and allow only held or watched symbols (see the open questions).

**I. Failure behaviour.**
- The action never throws for source errors; it returns `failed`. Pages keep showing the last stored price, and when its age passes `staleAfterMs` it shows as stale.
- A server-action error such as "Failed to find Server Action" after a deploy is treated as failed. After a few in a row, the client suggests reloading.
- Log failures. Writing `data_gaps` for intraday belongs to the gap-detection ticket (roadmap #3); make it a follow-up.

**J. Tests.** (AC6, R8)
- **Core (table tests):**
  - Session window boundaries: open, lunch, close, grace, weekend, holiday, minute edges.
  - `symbolsDue`.
  - `mergeLatestBars`: intraday today with no daily, daily today wins, old tick ignored, ex-date and gap flags kept.
  - `intradayStatus`.
  - `normalizeIntradayQuote`: unit and outlier rejection.
- **Sources:** fixture tests for each adapter (shape errors, symbol mismatch, 403 mapping).
- **`refreshIntraday`:**
  - Closed → no source call.
  - Inside the window → no call, stored price returned.
  - Two concurrent calls → one source call.
  - Failure → no write and `failed`; 403 or 429 trips the breaker.
  - Rows carry `source` and `fetched_at`.
- **Action:** `requireUser()` runs before anything else.
- **Component (fake timers):** no overlapping calls, pauses when hidden, refreshes immediately when visible again and due, the button fires at once, and it stops while the session is closed.
- **Guards:** extend `no-calc-in-ui`, `no-hardcoded-rules` and the client-import guard to cover the new files.

**K. Record the decision.** Add ADR 0006, "Intraday prices fetched on demand by web". It records Ming's 2026-11-05 decision, the deviation from spec §4.1/§4.3 and the roadmap item, and the consequences below.

## Risks
- **Rate limits and terms of use:** polling VCI/TCBS public endpoints every 30 s is unverified (the sandbox cannot reach VN hosts). A 403 or block also degrades EOD if both use the same source. Mitigations: batch requests, the breaker, a distinct User-Agent, and possibly a different source for intraday than for EOD.
- **Sparse intraday history:** data is only collected while the app is open. Future short-term signals and intraday gap detection (spec v1.1) cannot rely on `prices_intraday` as a continuous series. "No intraday rows" must not count as a gap.
- **Price after close before EOD:** between the close and 18:30 the shown price is an intraday tick, not the official close. This needs the post-close grace and an "intraday" label.
- **Serialized server actions:** a slow refresh blocks other actions from the same tab. Keep the time budget tight.
- **Refresh vs. half-edited forms:** `router.refresh()` while a row form is half-edited. React keeps client state, but server-rendered forms may re-render. Consider pausing while a form inside the board has focus.
- **Table growth:** about 500 rows per symbol per trading day without retention.
- **Larger diff from the move:** the package move widens the diff (R7). Keep it mechanical, in its own commit, with the worker tests unchanged.

## Open questions (for Ming or the planner)
1. Should the symbol page refresh a symbol that is neither held nor watched? (The ticket says watchlist + held.)
2. Session hours and post-close grace: confirm the HOSE/HNX/UPCoM times, and whether one window serves all exchanges.
3. Should dashboard P&L / market value move with intraday prices, or only the boards? (Recommendation: yes, through the core merge.)
4. Intraday source: the same configured source as EOD, or a separate one, given the block risk? Is a batched endpoint acceptable?
5. Should intraday fetch failures write `data_gaps` now, or wait for the gap-detection ticket? (Recommendation: follow-up.)
6. Should the spec (§4.1/§4.3, the "watchlist only" scope) and the roadmap item be updated to match Ming's decision?
7. Is moving all the price adapters into `packages/sources` acceptable within this ticket, or should only the shared HTTP and error code move now?
