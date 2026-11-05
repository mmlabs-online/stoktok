STK-049 consult: data engineer (read-only; nothing was fetched live, the sandbox cannot reach VN hosts)

## Findings

1. **Existing adapters are EOD-only and per symbol.**
   - `VciPriceSource.fetchDaily` POSTs `https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart` with `{timeFrame:'ONE_DAY', symbols:[SYM], to, countBack}`.
   - The `symbols` field is already an array, but ADR 0004 says "no symbol batching (follow-up)".
   - `TcbsPriceSource` uses `apipubaws.tcbs.com.vn/stock-insight/v1/stock/bars-long-term`. ADR 0004 records that TCBS was behind a Cloudflare bot challenge (403/404) on 2026-11-01, so TCBS is a poor primary for a 30 s poll.
   - `PriceSource` only has `fetchDaily`. Nothing intraday exists yet.

2. **The adapters live in `apps/worker/src/sources`.**
   - Web imports `@stoktok/core` and `@stoktok/db` only. It does not and should not import from the worker app.
   - `http.ts` (`getJson`/`postJson`) is polite. It sends only User-Agent, Accept and Content-Type, retries 429/5xx with backoff, and the VCI adapter turns a 403 into a non-retryable error.
   - The shared bits are pure and have no Node-only deps: `SourceError`, `http.ts`, the config constants and the VCI parsing. They are therefore movable.

3. **Core already has the building blocks.**
   - `calendar.ts` has `isTradingDay(date, holidays)`, `vnDateOf` and `vnMinutesOf`, so the weekday/holiday check and the VN clock need no new code.
   - `settings.holidays` (`date[]`) is the stored holiday list.
   - `DEFAULT_PRICE_CUTOFF_MINUTES_VN = 18*60` is the existing pattern for session config constants.
   - `DEFAULT_PRICE_SANITY` (min, max, step, jump ratio) and `normalizeDailyBar` exist for validation. `DEFAULT_TICK_BANDS` exists for per-exchange tick steps.
   - There is no session-hours config yet.

4. **Schema.**
   - `prices_daily` (PK symbol, trade_date; source and fetched_at not null) and `data_gaps` (data_type, from_ts, to_ts, resolved_at) exist.
   - There is no `prices_intraday` table. The spec §5 columns are symbol, ts, price, volume, source, fetched_at.

5. **VCI endpoints for latest or intraday price.** These are unverified and from memory, so the implementer must live-check from the home server.
   - **Intraday chart (primary candidate).** The same `gap-chart` endpoint with `timeFrame: 'ONE_MINUTE'` and `symbols: [..]`, `countBack` about 2–5, returns the latest minute bar. It is columnar (`t/o/h/l/c/v`), so the existing parser pattern is reusable. The batch behaviour (multiple symbols returning multiple objects) is the same shape as `list[]`. The existing code reads only `list[0]` and verifies the symbol, so a batch parser must iterate `list` and match by `symbol`.
   - **Price board snapshot (best fit for a batch).** `POST https://trading.vietcap.com.vn/api/price/symbols/getList` with `{symbols:[...]}`, or the `price/v1/...` board endpoints. These return one object per symbol with match price, ref/ceil/floor and volume, so a single call serves the whole watchlist. Field names and units (VND vs thousand VND) are unverified.
   - **TCBS** has a "stock-insight/v1/intraday/{ticker}/his/paging" endpoint (per symbol). It is a poor fit because of the per-symbol calls and the bot challenge.
   - **Recommendation:** use VCI as the primary, with one batched call per refresh. Prefer the board snapshot if it is reachable. Otherwise use the ONE_MINUTE gap-chart with `symbols:[all]`. Do not chain fallbacks (ADR 0004 policy).

6. **Rate limits are unknown.**
   - ADR 0004 lists "rate limits" as UNVERIFIED and no ToS is published.
   - With one batched call per 30 s the load is 2 requests per minute, which is lighter than the EOD job's roughly 1 request per second.
   - Per-symbol calls (about 20 symbols) would be about 40 requests per minute and are not polite.

## Recommendations

**A. Where the adapter lives (AC1, R3)**
- Create a shared package, e.g. `packages/market-sources` or `packages/sources`, containing `http.ts`, `SourceError` and the VCI adapters (daily and the new intraday).
- Alternatively, minimal move: put only the new intraday adapter, `http.ts` and `SourceError` into the shared package, and re-export them from the worker so `apps/worker` imports stay unchanged.
- Do not duplicate `http.ts` in web. Do not make the web depend on `apps/worker`.
- Keep the worker `PriceSource.fetchDaily` as is (the AC says EOD jobs are unchanged). Add a separate interface, `IntradayPriceSource.fetchLatest(symbols[]): Promise<{quotes: IntradayQuote[], rejected: ...}>`, so the daily contract is not touched.
- Quote validation (unit, sanity, tick step, ref/ceil/floor window) belongs in core as `normalizeIntradayQuote`, reusing `DEFAULT_PRICE_SANITY` (R2, R5).
- Config (base URL, path, UA, timeouts, source id) goes in config, not literals. Use an honest UA such as `stoktok/0.1 (personal; 30 s intraday refresh while open)`, and the same no-browser-header policy as ADR 0004. On 403 or a challenge, fail without circumvention.
- Add an ADR 0006 for the intraday endpoint: unverified items, terms, and the 30 s decision.

**B. Throttle (AC2)**
- Use a DB-based `fetched_at` check as the source of truth. An in-process cache is only an optimization.
- Design:
  - On each request, the handler computes the symbol set (watchlist plus held).
  - It reads the latest `prices_intraday` row per symbol.
  - Symbols with `now - fetched_at >= throttleMs` (default 30 000 ms, configurable) are "due". If any are due, it makes one batched source call for the due symbols only.
  - It upserts the results and returns the stored prices.
- The DB check survives container restarts and works across multiple tabs, because all tabs share one DB state.
- A DB check alone is racy: two simultaneous requests, such as tab A and tab B, both see "due".
  - Add an in-process single-flight, a Map of the in-flight promise keyed by the symbol set, so concurrent requests in one Node process share one call.
  - The home server is a single container, so that is enough. Optionally record an attempt marker so failures are throttled too.
- Failure throttle (important):
  - If a fetch fails, nothing is written and the next poll retries immediately, so a source outage turns into a request every tab-poll.
  - Keep a process-level `lastAttemptAt` and `consecutiveFailures`, and back off (30 s, 60 s, 120 s, with a cap). This prevents hammering after a 403 or 429.
  - On a 403, stop for a longer cool-down.
- "Làm mới" must go through the same throttle, with a short minimum interval (e.g. 5–10 s configurable) so a button mash does not bypass it. Return a result of `throttled: true` plus the stored `fetched_at`.
- Throttle logic (`isDue`, backoff computation) is pure and goes in core (AC6). The handler injects clock, store and source.

**C. Session detection as configuration (AC3, R5)**
- Add to core a `TradingSessionConfig` default: ATO/continuous/ATC windows. HOSE: 09:00–11:30 and 13:00–14:45, with ATC about 14:30–14:45; HNX/UPCoM: 09:00–11:30 and 13:00–15:00. These are defaults from memory and must be marked UNVERIFIED, verify before go-live (consistent with the CLAUDE.md "verify before go-live" table).
- Add the pure `isInTradingSession(now: Date, holidays, sessions, graceMinutes)`, built on `isTradingDay`, `vnDateOf` and `vnMinutesOf`. Use one union window per day (e.g. 09:00–15:00 with the lunch break optionally excluded) so exchange-specific tables are not needed for polling.
- Include a small grace period after the close (e.g. 2–3 minutes) so the last ATC print is captured.
- Holidays come from `settings.holidays`, with the same source used by the worker, never hard-coded.
- Outside a session: no source call, and pages show the last stored price with its time. Make "outside session" a visible state ("Ngoài giờ giao dịch") rather than "stale".
- Edge cases: holiday seeded after the fact, half-day (Tết) closures, and emergency trading halts (these look like a stale price that does not change; the UI must not call it an error).
- Whether to make the session hours editable in Settings is a question for the planner. A config constant plus a `rule_configs` override is enough for v1.

**D. `prices_intraday` (AC1, R4, R2)**
- New migration, e.g. `supabase/migrations/2026110x_prices_intraday.sql`:
  - Columns: `symbol text` (the same regex check), `ts timestamptz not null`, `price integer not null check (price > 0)`, `volume bigint check (volume >= 0)`, `source text not null`, `fetched_at timestamptz not null`.
  - Primary key `(symbol, ts)`.
  - Add `ref_price`/`ceil_price`/`floor_price` and `change` only if needed for display. Anything derived stays in core (R1).
  - Index `(symbol, ts desc)` (the PK covers it if ts is declared desc).
  - RLS on, revoke from `anon` and `authenticated`, and grant to `service_role` only, matching the existing tables. Check for security parity with `prices_daily`'s grants.
- **Dedupe:** upsert `on conflict (symbol, ts) do update`.
  - The key question is `ts`. If the source gives the bar or match time, use it. If the source gives only a snapshot with no trade time, use the bar-minute (truncate `fetched_at` to the minute), otherwise every poll inserts a new row when the price has not changed.
  - A better alternative is a "latest row per symbol" table (PK symbol) plus a history. The spec §5 defines symbol and ts, so keep the history table and add the "latest" lookup via the `(symbol, ts desc)` index (`distinct on`).
- **Retention:**
  - Intraday rows are only useful for the day or a few days. 30 s polls give about 500 rows per symbol per day (about 4.5 h of session at 2/min = about 540), so 20 symbols is about 11 000 rows a day, which is trivial.
  - Keep N trading days (e.g. 5–30, configurable) and prune with a scheduled worker step. Do not prune in the web handler.
  - Alternatively, prune opportunistically: after the day's EOD sync, delete rows older than N days. The EOD jobs are unchanged, so add a tiny separate worker job or a Postgres `pg_cron` call, and flag it as a follow-up if it would change the EOD jobs.
- **Never mix intraday into `prices_daily`.** EOD stays the authority. The signals pipeline must keep reading `prices_daily` only (follow-up per the ticket note; `raw-price-guard` territory). Add a test or guard that signals never read intraday.
- Unit handling: store integer VND (R2). Validate with `normalizeIntradayQuote` and reject (do not store) anything failing the unit or sanity guards.

**E. Gap handling (R4)**
- R4: "Stale or gapped data never produces a signal; gaps are recorded."
- Since intraday does not feed signals (default out of scope), the minimum is:
  - Every row carries source and fetched_at.
  - A failed fetch is not silently ignored. The page shows "delayed" state computed from `now - fetched_at > staleAfterMs`.
  - Do not record a `data_gaps` row for every missed 30 s poll. That would flood the table, because the tab being closed is a normal state.
- Recommended: no `data_gaps` entries for intraday at all in v1. Document that a gap is "no row in the session window" and that `prices_daily` gaps stay authoritative. If Ming wants an intraday gap record, use one `data_gaps` row per symbol per failure episode (data_type `prices_intraday`), not per poll, and resolve it on the next successful fetch. This is a decision for the planner.
- The rejected quote (sanity failure) must not be stored, and the response should mark it so the UI shows "không có giá mới" rather than a wrong price.
- Distinguish three states in a core pure function `intradayPriceState`: `live` (fresh, in session), `delayed` (in session, fetch failing or older than the stale threshold), `closed` (outside session; show the last price and its time).

**F. Web integration and security (R3, R6, R1)**
- Use a route handler (`GET /api/prices/refresh`) or a server action. Both must call `requireUser()` first (R6). The public list in `proxy.ts` must not be extended.
- The handler never accepts a symbol list from the client (otherwise Ming's session could be used as an open proxy, and input validation is needed). It derives the set from the DB (watchlist plus held), or at most validates against it.
- The handler returns the stored prices only, never raw source responses, and no service key or source URL in the payload (R3).
- Client component: a `setInterval` of 30 s, paused when `document.visibilityState !== 'visible'`, with an immediate refresh on becoming visible. It cleans up on unmount and avoids overlapping requests (skip if one is in flight). Prefer `router.refresh()` after the server fetch, or SWR-style fetching. Format only (R1).
- The "Làm mới" button disables itself while pending. The interval comes from a server-provided config value (not a literal).
- Time display "cập nhật lúc HH:mm:ss" uses the existing `vn` formatters in `packages/core/src/format.ts`, and the dashboard P&L must be computed in core from the intraday price (R1). Check how the dashboard currently picks the "latest price" and add a core `latestPrice(daily, intraday, now)` that chooses the newer one. Do not do it in components.
- `test/no-calc-in-ui.test.ts` and `no-hardcoded-rules.test.ts` exist, so the new component must pass them.

**G. Tests (AC6)**
- Core (Vitest): `isInTradingSession` (weekday, weekend, holiday, edges 08:59/09:00/11:30/13:00/14:45/grace, VN time zone against UTC instants); `isDue`/throttle and backoff; `intradayPriceState`; `normalizeIntradayQuote` (wrong unit, zero price, outside ceil/floor, tick step); `latestPrice` choice.
- Source adapter: fixture-based parse tests (columnar and board shapes), symbol mismatch, empty response, 403 non-retryable, malformed shape. Add a clearly marked opt-in live test that is skipped by default (the existing `*.crosscheck.test.ts` is the pattern).
- Handler: injected clock, store and source fakes.
  - Out of session: zero source calls.
  - In session, fresh rows: zero calls.
  - Two concurrent requests: one call (single-flight).
  - Mixed due and not due symbols: the batch contains only due symbols.
  - Source failure: the stored price is returned with the delayed state, with backoff.
  - A second tab: no extra call.
  - Container restart (fresh in-memory state, DB row fresh): no call.
  - Dedupe: the same `(symbol, ts)` twice gives one row.
  - No unauthenticated call (`requireUser` rejects).
- Refresh component (jsdom): 30 s timer with fake timers, pause when hidden, resume when visible, button immediate call, no overlap, unmount cleanup.
- Migration: a RLS and grant check following however the existing migrations are tested.

## Risks
- **Endpoint unverified.** The intraday endpoint, its response shape, units and rate limits are unverified, and there are no published terms. This follows the ADR 0004 risk posture (personal low-volume), but needs a go/no-go dry run from the home server like ADR 0004's checklist (no 403, VNM price is tens of thousands of VND, unit correct). Mitigation: batched calls and the failure backoff.
- **Bot challenge on a long-lived poll.** If the server's IP gets challenged (403), every tab then retries. The cool-down in the throttle design covers this. Surface the failure in the UI.
- **Intraday price vs adjusted history.** The VCI daily endpoint returns adjusted history, while intraday quotes are raw. Do not stitch them in charts. Show intraday only as the current price and keep the chart on `prices_daily`.
- **Spec conflict.** Spec §4.3 puts intraday polling in the worker, and "watchlist only". Ming chose the web-server, watchlist plus held. This is already flagged in the ticket, and the spec should be updated (or at least noted) so a reviewer doesn't flag the divergence.
- **Next.js server process semantics.** A module-level Map in a route handler is per process. It is fine for the single Docker container, but dev hot reload or a future multi-instance deploy loses single-flight. The DB `fetched_at` check still bounds the damage to roughly one extra call, which is acceptable.
- **Poll with no user.** The 30 s poll is only active while a visible tab exists. The authenticated session cookie must stay valid, and an expired session turns into a redirect or 401 loop in the interval. The client should stop polling on 401.
- **Prune not done** means unbounded growth, though at about 11 000 rows a day for 20 symbols this is small.
- **Stale last-price confusion.** After the close, the last intraday price (about 14:45) is shown instead of the EOD close until the EOD job lands at 18:30. They should usually match. If the close differs (e.g. due to the ATC print), core `latestPrice` should prefer the daily row for that date once it exists.

## Open questions
1. Does Ming want the intraday price to replace the displayed "current price" in P&L and holdings value, or only be shown next to the EOD price? That changes the scope of the core `latestPrice` logic.
2. Is a `data_gaps` record for failed intraday fetches wanted at all (suggestion: no for v1, show the delayed state instead)?
3. Session hours: are exchange-specific windows needed, or is one union window (09:00–15:00 plus grace) enough? Should it be editable in Settings, or a core config default?
4. Retention: how many trading days of intraday rows to keep, and who prunes (a worker job or a SQL job)?
5. Which VCI endpoint is acceptable to Ming: the price-board snapshot or the ONE_MINUTE gap-chart? A live check from the home server is needed before choosing.
6. Refresh button minimum interval: a hard 30 s throttle (button may do nothing) or a shorter manual floor (e.g. 5–10 s)? The AC says "refreshes immediately", so a shorter floor is the reasonable reading.
7. Should the shared source package move now (cleaner, but touches the worker imports) or should intraday be a small new package with only the new adapter (R7: minimal diff)? I recommend the latter plus re-exports.

Files consulted: /home/user/stoktok/work/tickets/STK-049/ticket.md, /home/user/stoktok/apps/worker/src/sources/{vci,tcbs,price-source,http,select-price-source}.ts, /home/user/stoktok/apps/worker/src/config.ts, /home/user/stoktok/apps/worker/src/jobs/eod-sync.ts, /home/user/stoktok/packages/core/src/calendar.ts, /home/user/stoktok/packages/core/src/market/{config,price-gaps}.ts, /home/user/stoktok/docs/adr/0004-vci-eod-price-source.md, /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql, /home/user/stoktok/apps/web/server/db.ts.
