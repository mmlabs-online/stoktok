# ADR 0004: VietCap (VCI) public endpoint as end-of-day price source

Status: accepted (Ming, 2026-11-01). Amends ADR 0001.

## Context
On 2026-11-01 the TCBS public endpoint was behind a Cloudflare bot challenge (403/404). SSI was dropped (Ming). The `PriceSource` interface (spec §4.3) keeps the source swappable.

## Decision
Primary source: the VietCap public chart endpoint, source id `vci-public` (`VciPriceSource`). It is the default in `EOD_SYNC_CONFIG.priceSource`; `--source <id>` overrides it per run. TCBS stays selectable (`tcbs-public`). One source runs per job; there is no fallback chaining.

## Endpoint / request
`POST https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart`, JSON body `{ timeFrame: 'ONE_DAY', symbols: [SYMBOL], to, countBack }`. There is no `from`. `to` = start of the day after `toDate` in VN time (epoch seconds); `countBack` = inclusive calendar days of [from, to]; bars outside [from, to] are filtered client-side. The response is columnar: `[{ symbol, t[], o[], h[], l[], c[], v[] }]` (or `{ data: [...] }`), values as numbers or digit strings. Unequal arrays, a symbol mismatch or more bars than `countBack` fail the request (non-retryable); an empty response yields zero bars (the gap logic records the gap).

## Unit
VND, declared once as `VCI_PRICE_UNIT`. vnstock divides stock prices by 1000 after reading this endpoint, so the raw unit is believed to be VND. Wrong units are rejected by core `normalizeDailyBar`, not stored.

## Date encoding
`t` is epoch seconds, mapped to a VN trade date with core `vnDateOf`. Both 17:00 UTC of the previous day and 00:00 UTC map to the same VN date. Duplicate dates in one response: the first is kept, later ones rejected (`duplicate_trade_date`).

## Raw vs adjusted
Assumed raw (vnstock sends no adjust flag). Must be checked against stored TCBS closes, or VietCap's web chart, around a recent dividend date before trusting history.

Volume is in shares.

## Terms
Unofficial and undocumented; no published terms found; no SLA. Personal, low-volume use. Risk accepted by Ming on 2026-11-01. Not live-checked from the sandbox.

## Header policy
Hard rule: only `User-Agent` (honest `stoktok/...`), `Accept` and `Content-Type` are sent. vnstock's Chrome User-Agent, `Origin` and `Referer` are deliberately not copied. A 403 or a challenge page fails the run with a clear non-retryable error; there is no circumvention.

## Request accounting
One POST per symbol per chunk; no symbol batching (follow-up). Existing delay, retry, breaker and request cap apply unchanged.

## UNVERIFIED
Response shape, unit, time of day of `t`, whether `to` is inclusive, the maximum `countBack` and silent caps, rate limits, and whether plain requests pass the bot check from the home server.

## First dry-run checklist (go/no-go)
Run `pnpm worker:eod --dry-run --source vci-public` on the home server and check:
1. No 403.
2. VNM closes are tens of thousands of VND.
3. `rejected` is 0.
4. Overlapping dates match stored TCBS closes (raw vs adjusted).
5. `pnpm worker:eod --backfill --dry-run --source vci-public` returns full chunks.
