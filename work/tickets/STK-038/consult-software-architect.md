## Software Architect consult: STK-038 (VietCap / VCI public PriceSource)

### Findings
1. **The seam hasn't changed since the SSI consult.** `runEodSync` depends only on `PriceSource` (`name`, `fetchDaily`). `cli.ts:89-93` is the one place that builds a source, and it hard-codes `new TcbsPriceSource`. `eod-sync.ts`, `price-source.ts` and core need no changes. TCBS's id `tcbs-public` is also the financials source key (`cli.ts:68`), so it must not be renamed.
2. **`http.ts` can't send a POST today.** `getJson` always sends GET with exactly `User-Agent` and `Accept`, and it has no `method`/`body`/`Content-Type`. VCI's chart endpoint is POST with a JSON body (from memory, UNVERIFIED: `POST https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart`, body `{timeFrame:'ONE_DAY', symbols:[…], to:<epoch s>, countBack:<n>}`). The retry/backoff/logging logic carries over to POST as is. Logging is safe: it logs only `HTTP <status>` or `network error: <name>`, never a URL or body. Retrying is fine because the call is a read-only query.
3. **The request shape doesn't match the interface.** `fetchDaily(symbol, from, to)` takes an inclusive date range. VCI (recalled) takes `to` plus `countBack` (a number of bars). The adapter has no holiday calendar, so it can't compute an exact trading-day count. TCBS already drops bars outside the requested range (`tcbs.ts:60`), and the same filter makes over-fetching harmless.
4. **The response shape is different (recalled, UNVERIFIED).** It returns an array of per-symbol objects holding parallel arrays `o,h,l,c,v,t`, where `t` is epoch seconds and may be a string. The price unit (VND vs thousand VND) and raw vs adjusted prices are unknown. Core `toVnd` and `normalizeDailyBar` accept only `typeof number`. A string, or a careless `Number('')` that gives 0, has to be handled in the adapter. A wrong unit is already rejected by the core guards (`price_off_step` / `price_out_of_band` / `close_jump`), which satisfies AC5.
5. **The endpoint accepts several symbols per request.** Batching would cut requests a lot, but it means changing `runEodSync`'s per-symbol loop, the request cap and the breaker semantics. That is out of scope (R7).
6. **Backfill chunk size is a TCBS assumption sitting in shared config.** `EOD_SYNC_CONFIG.backfillChunkTradingDays: 60` carries a "TCBS range cap is unverified" comment, and `runEodSync` reads it straight from `config`.
7. **Rows from the two sources can coexist without trouble**, same as in the SSI analysis. `prices_daily` has PK `(symbol, trade_date)` and `source` is a plain column. Nothing filters prices by source. VCI rows overwrite TCBS rows inside the lookback window, which is correct provenance. Open gaps recorded under `tcbs-public` get resolved by stored dates.
8. **No credentials are involved**, so all the SSI token, env, secrets-file and deploy-check parts drop out. No `.env`, `secrets.refs.yaml` or compose changes are needed.

### Recommendations
1. **Source selection (AC2, R5): config constant plus a CLI flag, same as Option A in the SSI consult.**
   - Add `EOD_SYNC_CONFIG.priceSource: 'vci-public'` and a `PriceSourceId = 'vci-public' | 'tcbs-public'` type.
   - Add `createPriceSource(id, deps)` in `cli.ts`, or in a tiny `sources/index.ts` if the planner wants it unit-tested apart from `main`.
   - Add an optional `--source <id>` to `parseArgs`, `eod-prices` only, rejecting duplicates. An unknown id returns usage and exits 2 before any DB or network call.
   - Update `USAGE`. `run-job.sh` already passes flags through.
   - No fallback chaining; one source per run.
2. **`http.ts`: a minimal, additive change.** Pull the loop out into a private `requestJson(fetchImpl, url, init: { method: 'GET' | 'POST'; body?: string }, o)`. Keep `getJson` as the same-signature wrapper and add `postJson(fetchImpl, url, body: unknown, o)`.
   - `postJson` does the `JSON.stringify` and adds `Content-Type: application/json`. Headers are otherwise unchanged: honest UA plus `Accept`.
   - Create a fresh `AbortSignal.timeout` per attempt, as today.
   - Existing `http.test.ts` cases must pass unchanged. Add 2–3 POST cases: method, body and content-type reach `fetchImpl`; a 5xx is retried; the body never appears in error messages.
   - Don't add a general `headers` option. YAGNI, and it would make it easy to add browser-impersonation headers later (AC3).
3. **Adapter `sources/vci.ts`, modelled on `tcbs.ts`.**
   - Constants: `VCI_PRICE_SOURCE_NAME = 'vci-public'`, `VCI_PRICE_UNIT` declared once (with the UNVERIFIED note), and `VCI_CONFIG { baseUrl, userAgent, maxBarsPerRequest }` in `config.ts`. The user agent can reuse the stoktok UA string.
   - `countBack`: a calendar-day upper bound, `daysBetween(from, to) + 1`, which is always ≥ the number of trading days. Pass `to` = end of `toDate` in VN time. Keep the in-range filter.
   - Shape handling only:
     - Check the per-symbol entry matches the requested symbol.
     - Check the arrays have equal lengths. Unequal lengths throw a non-retryable `SourceError('unexpected response shape')`.
     - Parse numeric strings strictly (`/^\d+(\.\d+)?$/` → number; anything else passes through raw so core rejects it).
     - Convert epoch `t` to a VN date with `vnDateOf`.
   - All unit conversion and plausibility checks stay in core (R1, R2).
   - An empty or missing symbol entry returns `{bars: [], rejected: []}`. `symbolsWithoutBars` and the gap logic already handle that.
4. **Chunk size per source (AC4).** Give the factory the job of returning the eod config override, e.g. `{ ...EOD_SYNC_CONFIG, backfillChunkTradingDays: VCI_CONFIG.maxTradingDaysPerRequest }`, or have it leave the TCBS value for TCBS. That keeps `runEodSync` and the cap untouched.
   - Default for VCI: 60, same as now, until the first live dry-run proves a larger cap. Then it's a one-line config change.
   - If a response holds more bars than `countBack`, throw a non-retryable `SourceError('response truncated')` rather than paging, so each chunk stays exactly one counted request.
5. **Tests (AC6).**
   - Synthetic fixtures in `test/fixtures/vci/` with a README "SYNTHETIC" label: ok (string numbers, epoch `t`), thousand-VND (rejected by the unit guard), malformed (unequal arrays), empty, wrong-symbol, out-of-range bars (dropped).
   - Inject `fetchImpl` and assert method `POST`, the body fields (`symbols`, `countBack` ≥ trading days, `to`) and the headers. The global-`fetch`-throws guard stays.
   - `parseArgs --source` cases (valid, unknown, duplicate, on a non-eod job).
   - A factory test checks that each id gives the right class and name.
   - One `runEodSync` test runs with the VCI source on the in-memory store and checks idempotent upserts.
6. **ADR 0004 (AC5)**, with an amendment note on 0001 (TCBS is behind a Cloudflare challenge as of 2026-11-01; Ming switched the source).
   - Record, each UNVERIFIED until the first `--dry-run`: endpoint and method, body fields, unit, raw vs adjusted, `t` encoding, max `countBack`/range, rate limit, terms (unofficial, personal low volume, risk accepted by Ming).
   - Also record the selection mechanism (config + `--source`) and the decision not to batch symbols.

### Risks
- **Mixed raw/adjusted series at the TCBS→VCI seam.** Big mismatches trip `close_jump`. Small ones, like a dividend adjustment, slip through and skew SMA/RSI. Mitigation: on the first live dry-run, compare overlapping dates against stored TCBS rows, then record the result in the ADR. If VCI turns out to be adjusted, a `--backfill` rewrite may be the cleaner fix (Ming decides).
- **VCI may require browser-like headers** (`Origin`, `Referer`) or sit behind the same kind of bot check. Adding those headers is edging into impersonation (AC3). If the endpoint refuses plain requests, stop and escalate rather than add headers.
- **No live verification is possible in the sandbox.** Every shape detail comes from memory, so the code is only proven against synthetic fixtures until Ming runs `pnpm worker:eod --dry-run --source vci-public`. Leaving the default `priceSource` at `vci-public` before that dry-run means the first scheduled run is the test. That's acceptable because the guards reject rather than store bad data, and TCBS is failing anyway.
- **Scope creep (R7).** Symbol batching, a general headers option, `redirect: 'error'` and hardening the no-network guard should all go on the follow-ups list.

### Open questions (each with a default)
1. **Selection mechanism:** config constant + `--source` flag, or an env var? *Default: config + flag.* It isn't secret, it can be tested, and changing it needs no host edit.
2. **Should the default flip to `vci-public` in this PR, or only after Ming's first live dry-run?** *Default: flip in this PR.* TCBS is broken now, and the guards keep bad data out.
3. **If VCI demands `Origin`/`Referer`, may the adapter send them?** *Default: no, escalate.* Treat it as a bot check under AC3.
4. **Should `--source` be allowed on `financials`?** *Default: no, eod-prices only* (financials is STK-039).

Files reviewed:
- /home/spaceM/projects/stoktok/work/tickets/STK-038/ticket.md
- /home/spaceM/projects/stoktok/work/tickets/STK-038/consult-software-architect-ssi-superseded.md
- /home/spaceM/projects/stoktok/apps/worker/src/sources/http.ts
- /home/spaceM/projects/stoktok/apps/worker/src/sources/tcbs.ts
- /home/spaceM/projects/stoktok/apps/worker/src/sources/price-source.ts
- /home/spaceM/projects/stoktok/apps/worker/src/cli.ts
- /home/spaceM/projects/stoktok/apps/worker/src/config.ts
- /home/spaceM/projects/stoktok/apps/worker/src/jobs/eod-sync.ts
- /home/spaceM/projects/stoktok/packages/core/src/market/daily-bar.ts
