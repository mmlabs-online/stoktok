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
Finding (first live dry-run, 2026-11-01): VCI returns **adjusted** prices for every session before a symbol's latest corporate action and **raw** prices from that action on. TCB had fractional prices (e.g. open 22701.14) from 2026-10-05 to 2026-10-28 and whole numbers on 2026-10-29 and 2026-10-30; AGR showed the same pattern up to about 2026-10-08. The earlier assumption "raw (vnstock sends no adjust flag)" was wrong. Adjusted prices are never stored (R2, and they would not match the raw prices on the ledger).

Guard (`VciPriceSource`, rule in core `adjustedHistoryCutoff`):
- Within one response, if any bar has a non-integer open, high, low or close, every bar dated on or before the latest such bar is rejected with reason `adjusted_price_history`. This includes bars whose adjusted values happen to be whole numbers. All bars of the response count, also those outside [from, to]. A fractional bar without a valid date rejects the whole response (cut-off = `toDate`).
- Bars after the cut-off go through core `normalizeDailyBar` and its guards unchanged.
- Backfill: the job keeps the cut-off per symbol and passes it to the older chunks of the same run (`rejectOnOrBefore`). Older chunks are still fetched and then rejected (request counts unchanged). The cut-off is not persisted between runs.
- Rejected bars are never written; stored rows for those dates stay unchanged; nothing is filled in. Missing dates become gaps through the existing gap step.
- `ok`: `adjusted_price_history` rejections do not make the run fail (they are expected for about 20 trading days after any corporate action). They are still counted in `rejected` and listed in `rejectedBySymbol`, and a log line names the cut-off per symbol. Exception: if the newest window of a symbol has a cut-off and zero accepted bars, `ok` is false with an error log (the latest session itself is adjusted, or the feed is wrong).

Known limits:
- Integer-valued adjusted bars newer than the latest fractional bar cannot be detected.
- If VCI ever rounds adjusted prices to whole numbers, the guard is blind; checklist item 4 stays the real validation.
- A wrong-unit feed now reports `adjusted_price_history` instead of `invalid_*` when fractional, and still fails the run through the newest-window rule.
- In daily mode only the 20-day lookback is fetched, so older adjusted history is not seen once the fractional bars leave the window.

Volume is in shares.

## Terms
Unofficial and undocumented; no published terms found; no SLA. Personal, low-volume use. Risk accepted by Ming on 2026-11-01. Not live-checked from the sandbox.

## Header policy
Hard rule: only `User-Agent` (honest `stoktok/...`), `Accept` and `Content-Type` are sent. vnstock's Chrome User-Agent, `Origin` and `Referer` are deliberately not copied. A 403 or a challenge page fails the run with a clear non-retryable error; there is no circumvention.

## Request accounting
One POST per symbol per chunk; no symbol batching (follow-up). Existing delay, retry, breaker and request cap apply unchanged.

## UNVERIFIED
Response shape, unit, time of day of `t`, whether the whole-number bars after the cut-off are really raw (checklist item 4), whether `to` is inclusive, the maximum `countBack` and silent caps, rate limits, and whether plain requests pass the bot check from the home server.

## First dry-run checklist (go/no-go)
Run `pnpm worker:eod --dry-run --source vci-public` on the home server and check:
1. No 403.
2. VNM closes are tens of thousands of VND.
3. `rejected` contains only `adjusted_price_history` reasons, and `ok` is true.
4. Overlapping dates match stored TCBS closes (raw vs adjusted).
5. `pnpm worker:eod --backfill --dry-run --source vci-public` returns full chunks.
