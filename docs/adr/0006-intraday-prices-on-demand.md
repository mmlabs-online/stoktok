# ADR 0006: Intraday prices fetched on demand by the web server

Status: proposed (Ming confirms in the STK-049 PR).

## Context
Ming, 2026-11-05: keep the scheduled jobs when nobody has the app open; while the app is open, reload every 30 s and add a button to refresh at once. Fetching is done on demand by the **web server**, for watchlist + held symbols.

This deviates from spec §4.1 (the `worker` does price polling), §4.4 ("every few minutes during trading sessions, watchlist only") and §7 (gaps recorded in `data_gaps`; see Slice 2 defaults). The spec is not edited here; see follow-up (a) in the STK-049 plan.

STK-049 is split in three slices. Slice 1 (this ADR's code) adds the adapter, the storage and the session rule. Nothing calls the source at runtime yet.

## Decision
- Package `@stoktok/sources` holds server-only I/O adapters (the polite HTTP client, `SourceError`, `VciIntradaySource`). A guard test keeps any `'use client'` file from importing it (R3).
- Intraday source id `vci-public`, interface `IntradaySource.fetchLatest(symbols[])`, one batched request per chunk of at most `maxSymbolsPerRequest` symbols.
- Table `prices_intraday (symbol, ts, price, volume, source, fetched_at)`, PK `(symbol, ts)`. `ts` is the source's minute-bar time, never our clock; re-polling within a minute updates the row (last write wins). `volume` is session-cumulative (sum of the day's minute volumes). Service role only, RLS on, no policies.
- Session rule is configuration in core (`DEFAULT_INTRADAY_CONFIG`): one union window 09:00-11:30 and 13:00-15:00 VN time for all exchanges, plus 3 minutes of grace; weekends and `settings.holidays` are closed. UNVERIFIED, verify before go-live.

## Endpoint / request
`POST https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart`, body `{ timeFrame: 'ONE_MINUTE', symbols: [...], to, countBack }` with `to` = now (epoch seconds) + 60 and `countBack` = 360. The response shape is the one in ADR 0004 (columnar `t`, `c`, `v`; only these are read). Unit VND (`VCI_INTRADAY_PRICE_UNIT`); wrong units are rejected by the core price guards.

## UNVERIFIED
Not live-checked (the sandbox cannot reach VN hosts). Built against a synthetic fixture. Unverified: response shape for `ONE_MINUTE`, unit, `t` encoding, `to` semantics, `countBack` meaning for minute bars, multi-symbol batching, rate limits and terms of use at 30 s polling.

## Header policy
Same as ADR 0004: only an honest User-Agent, `Accept` and `Content-Type`. On 403 the call fails (non-retryable); no bypass of any challenge.

## Go/no-go live check (gates slice 2, not slice 1)
Ming runs `work/tickets/STK-049/record-vci-intraday-samples.sh` from the repo root on the home server during a trading session, and commits `work/tickets/STK-049/live-samples/`. Checklist:
1. HTTP 200 on every call; no 403 or challenge page.
2. One request returns three list items whose `symbol`s match. This proves batching. If it fails, the result is **NO-GO for the batched design**: slice 2 must be re-planned, because per-symbol polling would be about 40 requests a minute.
3. VNM `c` is tens of thousands, so the unit is VND.
4. The last `t` is within a few minutes of the recording time, and today's bars are present.
5. The sum of today's `v` for VNM roughly matches the session volume in the TCBS app (checked by eye).
6. The second call 30 s later does not return 429.
7. `pnpm --filter @stoktok/sources test` runs `vci-intraday.samples.test.ts` (no longer skipped) and it passes.

Slice 2 stays `BLOCKED` until the samples are committed and items 1-3 and 7 pass. If the samples disagree with the synthetic fixture, the fix belongs to slice 2: update the parser and replace the fixture with the recorded one.

## Slice 2 defaults (planned, not built)
- Throttle in-process (module-level single-flight, per-symbol last attempt time with a DB `fetched_at` fallback after a restart, in-memory breaker with a long cool-down on 403/429). Upgrade path: a claim table + RPC if the web app ever runs two instances or the worker also polls.
- No `data_gaps` rows for intraday in v1; a failed poll is a transient "delayed" state. A future intraday gap would use `data_type 'prices_intraday'`, never `'prices_daily'`.
- Intraday is never written to `prices_daily`, and signals never read intraday.
