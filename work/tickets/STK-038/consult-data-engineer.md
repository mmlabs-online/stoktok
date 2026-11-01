## Findings

Tags: [V] = verified from vnstock source fetched today via WebFetch (paths under `vnstock/explorer/vci/` and `vnstock/core/utils/` on main). [R] = recalled or inferred. Note that WebFetch summarises the files with a small model, so quotes are not byte-exact. Sandbox reachability of the VN hosts was NOT tested.

**Endpoint**
- [V] Base URL is `https://trading.vietcap.com.vn/api/` (`_TRADING_URL`). The chart path is `chart/OHLCChart/gap-chart`.
- [V] Full URL is `https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart`. The method is **POST** with a JSON body.
- [V] The old `mt.vietcap.com.vn/api/` base is commented out in vnstock, so don't use it.

**Request body**
- [V] The body is `{"timeFrame": "ONE_DAY", "symbols": ["<SYM>"], "to": <epoch seconds int>, "countBack": <int>}`.
- [V] There is **no `from` field**. The range is set by `to` plus `countBack`, which is the number of bars going backward from `to`.
- [V] For a date-only end date, vnstock sets `to` to (end date + 1 day) as local naive time, then `int(timestamp())`.
- [V] When `countBack` isn't given, vnstock computes it as `len(pd.bdate_range(start, end)) + 1` for ONE_DAY. It defaults to 1000 for other intervals.
- [R] Max `countBack` is unknown. Nothing in the source caps it. Keep requests small, for example a few hundred bars.
- [V] vnstock sends no adjust flag. [R] Prices are probably the exchange's raw/as-traded values, but I can't confirm that from source. See open question 1.

**Response**
- [V] vnstock accepts either a list or a dict with a `data` key. It then reads the first element as the per-symbol object.
- [V] The first element is **columnar**: `{"t": [...], "o": [...], "h": [...], "l": [...], "c": [...], "v": [...]}`. vnstock detects this when `o` is a list and zips the arrays into records.
- [V] Other fields (such as the symbol) may exist on the object, and vnstock ignores them. [R] I believe `symbol` and `accumulatedVolume`-style fields are there.
- [V] An empty result makes vnstock raise a ValueError. The adapter should treat it as an empty or truncated result, not as success.

**Timestamps**
- [V] `t` is Unix **seconds**, as an int or a string cast to int. vnstock treats it as UTC and converts to Asia/Ho_Chi_Minh. For `1D` it takes `.date()`.
- [V] That means the trade date is the **VN-local date of `t`**. Use `vnDateOf(new Date(Number(t) * 1000))`. This is correct whether the bar is stamped at 00:00 VN or at 07:00 VN.
- [R] The exact time-of-day of the daily stamp isn't visible in source. Don't assume it. Parse `t` strictly and reject non-finite values.

**Price unit**
- [V] vnstock divides open, high, low and close by 1000, then rounds to 2 decimals, for stocks. It skips this for index and derivative.
- [V] So the **raw API values are VND**. For example, 25,400 on the wire becomes 25.40 in vnstock. This means `PriceUnit = 'VND'` is correct for the adapter, and core's unit guard stays as the safety net.
- [R] Volume is in shares, with no scaling in vnstock.

**Headers**
- [V] vnstock sends `Referer: https://trading.vietcap.com.vn/` and `Origin: https://trading.vietcap.com.vn/`, plus a Chrome/Windows User-Agent. Its UA is browser impersonation, so we must not copy it.
- [R] I believe `Content-Type: application/json` is needed for the POST. It's standard, and I couldn't see it in the fetched files.
- [R] Whether the endpoint rejects requests without Origin/Referer is unknown. Sending a truthful Referer/Origin pointing at VietCap's own site is a judgement call. It is not UA spoofing, but it does imitate a first-party web client. See open question 2.

**Bot protection and terms**
- [R, untested] I could not determine whether trading.vietcap.com.vn sits behind a bot challenge. WebFetch of the API isn't a meaningful test (it's a POST, and the sandbox may not reach VN hosts). The ADR already notes that the sandbox can't reach VN hosts.
- [R] The vnstock project is a community library. Its terms are for personal/educational use, with no SLA. VietCap has no published public-API terms that I could find. The endpoint is undocumented, so it can change without notice. I could not fetch a LICENSE (404 on the guessed URL).

## Existing code facts (apps/worker/src/sources)
- `PriceSource.fetchDaily(symbol, from, to, ctx)` takes an inclusive 'YYYY-MM-DD' range.
- `getJson` in `http.ts` is **GET-only**, sends only UA and Accept, and has no body or Content-Type. A POST variant is needed, either as an added `method` and `body` option or a sibling `postJson`.
- `getJson` retries 429 and 5xx, and a non-retryable 4xx throws. A Cloudflare challenge page would normally arrive as 403, or as 200 with HTML. The 200-with-HTML case becomes "response is not valid JSON", non-retryable, which is fine.
- `tcbs.ts` is a good template. The new source's `name` should be distinct, for example `vci-public`, since it is stored as `source` per R4.

## Recommendations
1. **Add `vci.ts`.** Reuse `normalizeDailyBar` with `'VND'`. Build the body as `{timeFrame:'ONE_DAY', symbols:[symbol], to: vnEndSeconds(toDate)+1, countBack}`. `to` is set one second after the end of `toDate`. [R] I'm not certain whether `to` is inclusive, so ask for a bit of slack and rely on the date filter.
2. **Compute `countBack` from the range.** Use the number of weekdays between from and to, plus a small margin (vnstock uses +1). Then **filter client-side** to [from, to] by VN date, as tcbs.ts does.
3. **Truncation guard (reused from the SSI consult).** If the response has exactly `countBack` bars and the oldest bar's date is still later than `fromDate`, the range was truncated. Raise a non-retryable SourceError, or record a gap, instead of silently accepting it (R4). Also cap the per-request range, for example 366 days, and chunk the backfill.
4. **Strict columnar parsing.** Require `data[0]` (or the array root) to have arrays `t`, `o`, `h`, `l`, `c`, `v` of **equal length**. Reject the whole response on a shape mismatch (non-retryable SourceError). Reject individual bars with a non-finite `t` or a missing field via `RejectedBar`. Dedupe by trade date, and reject duplicates with conflicting values.
5. **Honest identity.** Use the existing descriptive UA (for example `stoktok/<ver> (personal use)`). Do not copy vnstock's Chrome UA. Set `Content-Type: application/json`. Decide on Referer/Origin per open question 2, and don't add anything else.
6. **No bypass.** If a 403 or challenge HTML comes back, fail loudly with a clear error, for example "blocked by bot protection", with `retryable=false`. Don't retry harder, and don't add headers to get past it. The job should record a gap, and no signal should be produced from stale data (R4).
7. **Config (R5).** Put the base URL, UA, countBack margin and max range in `config.ts` alongside `TCBS_CONFIG`. Add a `VCI_CONFIG`, and make the source selectable in eod-sync, with the ADR amended to record the TCBS block and the VCI choice. Keep TCBS as a fallback only if it ever works again.
8. **Tests.** Cover: columnar parse, the VN date from `t` at boundary times (17:00 UTC prior day and 00:00 UTC), the VND unit, a mismatched-array-length rejection, the truncation guard, HTML or 403 handling, an empty result, and the POST body content. Use fixtures from a documented recalled shape, and mark them UNVERIFIED like tcbs.ts does.
9. **Cross-check.** Add a one-time manual check that compares the close of a few symbols against TCBS or VietCap's web chart. This settles raw vs adjusted, and adjusted prices would silently corrupt cost basis around corporate actions.

## Risks
- Raw vs adjusted is unconfirmed. Adjusted history would retroactively rewrite old closes after dividends or splits, which would conflict with how stored bars and cost basis are treated.
- The endpoint is undocumented, may carry the same Cloudflare protection, and may change shape without notice. No SLA.
- Possible rate limiting on repeated per-symbol POSTs. The `symbols` field is an array, so batching several symbols per call may be possible, but I haven't verified the response shape for multiple symbols. Start with one symbol per call and a polite delay.
- Possible terms-of-service issues with automated use of a first-party web API. This is a personal, low-volume use, but Ming should know.
- The timestamp encoding and the unit guard are inferred from vnstock, not tested against live data. Core's unit guard is the safety net, so a mistake there rejects bars instead of storing them.

## Open questions
1. Raw or adjusted? Proposed default: assume raw, and verify with the cross-check in recommendation 9 before go-live. The first live run should log a sample.
2. Is a truthful `Origin`/`Referer: https://trading.vietcap.com.vn/` acceptable? Proposed default: send it only if the endpoint rejects requests without it. It is not an identity spoof, because the UA stays honest, but Ming should decide.
3. Does the endpoint pass the bot check from Ming's home server (the production runtime)? This can only be confirmed by a live call from that host, which is a human step. Proposed default: ship the adapter, make the first run on the home server a smoke test, and keep failures as recorded gaps.
4. Should the adapter batch several symbols per request? Proposed default: no, one symbol per request for v1.

Files read: `/home/spaceM/projects/stoktok/apps/worker/src/sources/price-source.ts`, `/home/spaceM/projects/stoktok/apps/worker/src/sources/tcbs.ts`, `/home/spaceM/projects/stoktok/apps/worker/src/sources/http.ts`. I did not read `eod-sync.ts`, `config.ts` or the ADR, and I did not read any `.env*` file.
