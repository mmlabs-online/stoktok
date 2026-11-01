Status: READY

# Plan — STK-038: VietCap (VCI) public endpoint as end-of-day price source

> Gate note for the orchestrator: the ticket is P1, and its notes say workspace CLAUDE.md §8 requires **Ming's PLAN approval before IMPLEMENT**. The plan is READY; whether IMPLEMENT waits for that approval is the orchestrator's call.

## Spec summary
- docs/spec-v1.md §2.2: "Public sources (e.g. the open-source `vnstock` library wrapping public endpoints) are **unofficial and can change or break without notice**. Check each source's license and terms for personal use." / "Every price carries a `fetched_at` timestamp and a source." / "Gaps must be detected, not silently interpolated."
- docs/spec-v1.md §4.3: "One interface per data type (`PriceSource`, …); each implementation is swappable." / "Primary + fallback source per data type where possible." / "Every record stores `source` and `fetched_at`."
- docs/spec-v1.md §9 Risks: "Unofficial data source breaks or changes | No prices/signals | Adapter layer, fallback source, freshness badges, signal suppression". Open question 4: "Primary and fallback data sources after license/terms check."
- CLAUDE.md R1/R2 (conversion and rounding only in core; integer VND), R4 (`source` + `fetched_at` on every record; gaps recorded), R5 (source settings are configuration), R7, R8, R10.
- ADR 0001 §"Swapping the source": "Implement `PriceSource` … declare its unit in one constant, and construct it in `cli.ts`. `runEodSync` does not change." ADR 0001 §Constraints: "Descriptive User-Agent …; no header spoofing."
- Ticket goal: "Add a VietCap (VCI) public-endpoint implementation of `PriceSource` and make it the primary end-of-day price source."
- Orchestrator hard rule (not an open question): the adapter sends **only** `User-Agent` (honest stoktok UA), `Accept`, `Content-Type`. No `Origin`, `Referer` or any browser-like header. If the endpoint rejects that, the job fails with a clear non-retryable error.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | New `PriceSource` for the VCI endpoint returns daily OHLCV through the existing normalization and plausibility guards; every stored row carries `source` (`vci-public`) and `fetched_at` (R4). | `vci.test.ts › name is vci-public`; `› maps synthetic chart-ok.json (columnar, string numbers, epoch t) to integer VND bars`; every bar passes through core `normalizeDailyBar` (grep: no unit math or plausibility check in `vci.ts`, only strict string→number and `t`→VN date); `eod-sync.test.ts › runEodSync with VciPriceSource writes source=vci-public and the run fetched_at on every row`. |
| 2 | The active source is chosen by configuration, not hard-coded (R5). TCBS stays available. No fallback chaining beyond §4.3. | `select-price-source.test.ts › config default is vci-public`, `› vci-public builds VciPriceSource`, `› tcbs-public builds TcbsPriceSource (name tcbs-public)`, `› unknown id throws`; `cli.test.ts › --source cases`. Grep `cli.ts`: no `new TcbsPriceSource` / `new VciPriceSource` in the EOD branch (factory only), and no try-the-other-source loop anywhere. |
| 3 | Polite, low-volume client: honest User-Agent, existing delays/retries/breaker; no bot-check circumvention. | `vci.test.ts › sends POST with exactly User-Agent, Accept, Content-Type headers (no Origin/Referer/Cookie/Sec-*)`, which asserts `toEqual` on the full header object; `http.test.ts › postJson headers are exactly User-Agent, Accept, Content-Type`; `vci.test.ts › HTTP 403 -> non-retryable SourceError 'blocked by source (HTTP 403)', one call, no retry`; `› 200 with HTML body -> non-retryable 'response is not valid JSON'`. Grep `vci.ts`/`http.ts`: no `Origin`, `Referer`, `Mozilla`, `Chrome`, `cookie`. `VCI_CONFIG.userAgent` starts with `stoktok/`. |
| 4 | `pnpm worker:eod`, `--dry-run`, `--backfill` work unchanged with the new source (idempotency, delays, retries, breaker, request cap). | `git diff` shows `jobs/eod-sync.ts` and `sources/price-source.ts` unchanged. `eod-sync.test.ts › runEodSync with VciPriceSource: re-run is idempotent; requestsMade = symbols × chunks (daily and backfill)`; `› VciPriceSource 403 on every symbol trips the breaker after maxConsecutiveFailures`. Existing `eod-sync.test.ts`, `cli.test.ts`, `http.test.ts`, `tcbs.test.ts` pass unchanged. `config.test.ts › VCI max request span covers lookback and backfill chunk`. |
| 5 | Unit, date encoding, raw vs adjusted and known terms are documented in a new ADR that amends ADR 0001; wrong units are rejected by the guards, not stored. | `docs/adr/0004-vci-eod-price-source.md` exists with sections Decision, Endpoint/request, Unit, Date encoding, Raw vs adjusted, Terms, Header policy, UNVERIFIED list, First dry-run checklist. ADR 0001 has an amendment line. `vci.test.ts › chart-thousand-vnd.json -> every bar rejected by core guards, none returned`. |
| 6 | Tests use fixtures and the no-network guard only; `typecheck`, `lint`, `test` pass. | `pnpm typecheck && pnpm lint && pnpm test` green. Fixtures in `apps/worker/test/fixtures/vci/` with a README labelled SYNTHETIC. All VCI tests inject `fetchImpl`. `vci.test.ts › global fetch is blocked in tests`. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `apps/worker/src/sources/vci.ts` (new) | `VCI_PRICE_SOURCE_NAME = 'vci-public'`, `VCI_PRICE_UNIT: PriceUnit = 'VND'` (UNVERIFIED comment), `VciPriceSource implements PriceSource` with `requestBody(symbol, from, to)` and `fetchDaily` | AC1, AC3, AC5 |
| `apps/worker/src/sources/http.ts` | Move today's retry loop into a private `requestJson`. `getJson` keeps its signature and behaviour. Add `postJson(fetchImpl, url, body, o)`. No general `headers` option | VCI is POST + JSON body; TCBS must stay identical (AC4); no way to add browser headers (AC3) |
| `apps/worker/src/sources/select-price-source.ts` (new) | `createPriceSource(id, { fetchImpl, http })` → `VciPriceSource` / `TcbsPriceSource`; throws on an unknown id | AC2 |
| `apps/worker/src/config.ts` | Add `PRICE_SOURCE_IDS = ['vci-public', 'tcbs-public'] as const`, `type PriceSourceId`, `isPriceSourceId`, `EOD_SYNC_CONFIG.priceSource: 'vci-public' as PriceSourceId`, `VCI_CONFIG = { baseUrl: 'https://trading.vietcap.com.vn/api', chartPath: '/chart/OHLCChart/gap-chart', userAgent, maxCalendarDaysPerRequest: 400 }`. Make the `backfillChunkTradingDays` comment source-neutral | AC2 (R5), AC4 |
| `apps/worker/src/cli.ts` | `parseArgs` accepts `--source <id>` (eod-prices only, not repeatable). The EOD branch builds its source through `createPriceSource(args.source ?? EOD_SYNC_CONFIG.priceSource, …)`. Update `USAGE` | AC2 |
| `apps/worker/src/sources/vci.test.ts` (new) | Adapter tests (list below) | AC1, AC3, AC5, AC6 |
| `apps/worker/src/sources/select-price-source.test.ts` (new) | Factory tests | AC2 |
| `apps/worker/src/config.test.ts` (new) | Span invariant test | AC4 |
| `apps/worker/src/sources/http.test.ts` | Add `postJson` cases; existing cases untouched | R8 |
| `apps/worker/src/cli.test.ts` | Add `--source` cases; existing cases untouched | AC2 |
| `apps/worker/src/jobs/eod-sync.test.ts` | Add a `describe('with VciPriceSource')` block that reuses the local `memoryStore` and drives a real `VciPriceSource` with a fixture-backed `fetchImpl`. Existing tests untouched | AC1, AC4 (end to end, without exporting test helpers) |
| `apps/worker/test/fixtures/vci/README.md` (new) | SYNTHETIC label, assumed request/response shape, a manual `curl` that uses only the allowed headers | AC6 |
| `apps/worker/test/fixtures/vci/chart-ok.json`, `chart-thousand-vnd.json`, `chart-malformed.json`, `chart-unequal-arrays.json`, `chart-empty.json`, `chart-other-symbol.json`, `chart-too-many-bars.json`, `chart-wrapped.json` (new) | Synthetic fixtures (contents below) | AC1, AC5, AC6 |
| `docs/adr/0004-vci-eod-price-source.md` (new) | ADR for the VCI source (contents in Approach step 7) | AC5 |
| `docs/adr/0001-eod-price-source.md` | One amendment line under Status: "Amended 2026-11-01 by ADR 0004: TCBS public endpoint is behind a Cloudflare bot challenge (403/404); primary EOD source is now `vci-public` (Ming). TCBS stays selectable via `--source tcbs-public`." | AC5 |
| `apps/worker/README.md` | EOD section: VCI is the default source, `--source <id>`, first live run is `--dry-run --source vci-public` with the ADR 0004 checklist, and a 403 means blocked (no bypass) | AC4 docs |

Not touched (on purpose): `jobs/eod-sync.ts`, `sources/price-source.ts`, `sources/tcbs.ts`, `sources/tcbs-financials.ts`, the financials and signals branches of `cli.ts`, `packages/core/**`, `supabase/**`, `.env.example`, deploy files. No credentials are involved.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `vci.test.ts › name is vci-public` | AC1, R4 |
| `vci.test.ts › requestBody: timeFrame ONE_DAY, symbols [SYM], to = start of the day after toDate in VN time (epoch s), countBack = inclusive calendar days of [from, to]` | AC1 request shape |
| `vci.test.ts › sends POST to baseUrl+chartPath with exactly User-Agent, Accept, Content-Type headers (no Origin/Referer/Cookie/Sec-*)` | AC3 (hard rule) |
| `vci.test.ts › maps synthetic chart-ok.json (columnar, string and number values, epoch t) to integer VND bars` | AC1 |
| `vci.test.ts › t at 17:00 UTC of the previous day and at 00:00 UTC both map to the same VN date` | AC1 date encoding |
| `vci.test.ts › chart-wrapped.json ({data:[…]}) and a bare array root parse the same` | AC1 shape tolerance |
| `vci.test.ts › chart-thousand-vnd.json -> every bar rejected by core guards, none returned` | AC5 |
| `vci.test.ts › chart-malformed.json -> good bar kept; "" price, "1e3" string, non-finite / non-integer t, null volume rejected with core reasons (empty string never becomes 0)` | AC1 strict parsing |
| `vci.test.ts › duplicate trade date in one response -> first kept, later rejected 'duplicate_trade_date'` | AC4 (upsert would fail on duplicate PK in one batch) |
| `vci.test.ts › chart-unequal-arrays.json / missing t,o,h,l,c,v arrays / non-object root -> non-retryable SourceError 'unexpected response shape'` | AC1 |
| `vci.test.ts › chart-empty.json ([] and [{t:[],…}]) -> zero bars, no error` | AC1 (gap logic records the gap) |
| `vci.test.ts › chart-other-symbol.json -> non-retryable SourceError 'symbol mismatch'; nothing returned` | AC1 data integrity |
| `vci.test.ts › chart-too-many-bars.json (bars > countBack) -> non-retryable SourceError 'unexpected response shape: more bars than requested'` | AC4 (one counted request per chunk), R4 |
| `vci.test.ts › bars outside [from, to] are dropped` | AC1 |
| `vci.test.ts › range longer than maxCalendarDaysPerRequest -> non-retryable SourceError before any fetch` | AC4 |
| `vci.test.ts › HTTP 403 -> non-retryable SourceError 'blocked by source (HTTP 403)', exactly one fetch call` | AC3 |
| `vci.test.ts › 200 with non-JSON (HTML challenge) body -> non-retryable 'response is not valid JSON'` | AC3 |
| `vci.test.ts › 503 then 200 -> retried by the shared client` | AC4 |
| `vci.test.ts › global fetch is blocked in tests` | AC6 |
| `http.test.ts › postJson sends method POST, JSON.stringify(body), headers exactly {User-Agent, Accept, Content-Type: application/json}` | AC3 |
| `http.test.ts › postJson retries 5xx with backoff; 403 is not retried; error message never contains the body` | AC4 |
| `select-price-source.test.ts › config default is vci-public` | AC2 |
| `select-price-source.test.ts › vci-public builds VciPriceSource (name vci-public), no fetch at construction` | AC2 |
| `select-price-source.test.ts › tcbs-public builds TcbsPriceSource (name tcbs-public)` | AC2 |
| `select-price-source.test.ts › unknown id throws` | AC2 |
| `config.test.ts › VCI max request span covers lookback and backfill chunk` (`VCI_CONFIG.maxCalendarDaysPerRequest` ≥ a calendar span bound for `max(lookbackTradingDays, backfillChunkTradingDays)`, e.g. `ceil(n × 7/5) + 30` holiday slack) | AC4 |
| `cli.test.ts › --source vci-public / tcbs-public accepted, alone and with --dry-run / --backfill in any order` | AC2 |
| `cli.test.ts › --source unknown / missing value / repeated / on financials or signals -> usage` | AC2 |
| `cli.test.ts › without --source the result has no source key` (existing `toEqual` tests stay unchanged) | AC2 |
| `eod-sync.test.ts › with VciPriceSource: writes source=vci-public and the run fetched_at on every row` | AC1, R4 |
| `eod-sync.test.ts › with VciPriceSource: re-run is idempotent; requestsMade = symbols × chunks (daily and backfill)` | AC4 |
| `eod-sync.test.ts › with VciPriceSource: 403 on every symbol -> failedSymbols, breaker stops after maxConsecutiveFailures, ok=false` | AC3, AC4 |

No `packages/core` change, because the adapter only reshapes data: columnar to rows, digit strings to numbers, and epoch seconds to a VN date through core `vnDateOf`. Unit conversion and plausibility checks stay in `normalizeDailyBar` (R1/R2), which already has tests. `countBack` and `to` are request plumbing, not financial logic.

## Approach
1. **http.ts.** Move the current loop unchanged into a private `requestJson(fetchImpl, url, init: { method: 'GET' | 'POST'; body?: string; contentType?: 'application/json' }, o)`. Headers are built inside it: `{ 'User-Agent': o.userAgent, Accept: 'application/json' }`, plus `Content-Type` only when `contentType` is set. A fresh `AbortSignal.timeout` is created per attempt. `getJson` calls it with `{ method: 'GET' }`; omit the `method` key from the fetch init for GET if that is needed to keep the existing header-equality test passing. `postJson(fetchImpl, url, body: unknown, o)` passes `JSON.stringify(body)`. There is **no** caller-supplied headers option. Logging stays as it is: `HTTP <status>` / `network error: <name>`, never the URL or body.
2. **config.ts.** Add `PRICE_SOURCE_IDS`, `PriceSourceId`, `isPriceSourceId` and `EOD_SYNC_CONFIG.priceSource = 'vci-public'`. These live in config.ts so there is no config ↔ sources import cycle. Add `VCI_CONFIG` with `userAgent: 'stoktok/0.1 (personal portfolio tracker; low-volume end-of-day sync)'` (same honest string as TCBS) and `maxCalendarDaysPerRequest: 400`. `backfillChunkTradingDays` stays at 60 and is shared (60 trading days ≈ 90 calendar days, well inside 400); its comment now reads "source range caps are unverified, ADR 0001/0004".
3. **vci.ts.** `VciPriceSource({ fetchImpl, http, baseUrl?, userAgent?, sanity?, maxCalendarDaysPerRequest? })`.
   - `requestBody(symbol, from, to)` = `{ timeFrame: 'ONE_DAY', symbols: [symbol], to: vnStartSeconds(dayAfter(to)), countBack: calendarDaysInclusive(from, to) }`. The calendar-day count is always ≥ the number of trading days, and over-fetching is harmless because of the range filter. If `countBack > maxCalendarDaysPerRequest`, throw a non-retryable `SourceError('requested range too long')` before any fetch.
   - `fetchDaily`: call `postJson(baseUrl + chartPath, body, { ...http, userAgent })`. Catch a `SourceError` with `status === 403` and rethrow it as `new SourceError('blocked by source (HTTP 403); no bypass, see ADR 0004', false, 403)`. Every other error passes through unchanged (404 is already non-retryable, 429/5xx are retried by the shared client, and an HTML body becomes the existing "not valid JSON" error).
   - Root: either an array, or an object whose `data` is an array. Anything else → non-retryable `SourceError('unexpected response shape')`. An empty array → `{ bars: [], rejected: [] }`. Otherwise use element 0. It must be an object; if it has a string `symbol` that differs from the requested one (case-insensitive), throw non-retryable `SourceError('symbol mismatch')`.
   - Columns: `t,o,h,l,c,v` must all be arrays of equal length; otherwise non-retryable `unexpected response shape`. If the length is greater than `countBack`, throw non-retryable `'unexpected response shape: more bars than requested'`.
   - Per index: a value is `num(x)` = `x` if it is a number; `Number(x)` if it is a string matching `/^\d+(\.\d+)?$/`; otherwise `x` unchanged, so core rejects it. `t` must be a safe integer after `num` (≥ 0); then `tradeDate = vnDateOf(new Date(t * 1000))`; otherwise `tradeDate` stays undefined and core returns `invalid_trade_date`. Drop the bar if its date falls outside [from, to]. If the date was already seen in this response, reject it with `duplicate_trade_date`. Then call `normalizeDailyBar(symbol, { open, high, low, close, volume, tradeDate }, VCI_PRICE_UNIT, sanity ?? DEFAULT_PRICE_SANITY, ctx.lastClose)`, in the same shape as `tcbs.ts`.
4. **select-price-source.ts.** `createPriceSource(id: PriceSourceId, deps: { fetchImpl: typeof fetch; http: Omit<GetJsonOptions, 'userAgent'> })`, using a `switch` with an exhaustive default that throws. It runs one source per run with no fallback; §4.3 "where possible" is met by having two selectable sources.
5. **cli.ts.** In `parseArgs`, `--source <id>` is valid only for `eod-prices`. The next arg must exist and pass `isPriceSourceId`, and the flag may appear once; on any violation return USAGE (exit 2 happens before any DB or network call). Add `source` to the result only when given. In `main`'s EOD branch, call `createPriceSource(args.source ?? EOD_SYNC_CONFIG.priceSource, { fetchImpl: fetch, http })`. Update `USAGE` to mention `[--source <vci-public|tcbs-public>] (eod-prices only)`. `ParsedArgs` gains `source?: PriceSourceId`.
6. **Fixtures + README.** These are SYNTHETIC. They use the columnar shape `[{ symbol, t:[…], o:[…], h:[…], l:[…], c:[…], v:[…] }]`, mixing string and number values, with VND prices on the 10/50/100 step (e.g. 61500). `t` covers both 17:00Z of the previous day and 00:00Z. The thousand-VND fixture has `c: [61.5, …]` or `[62, …]`. The README curl sends only `-A 'stoktok/0.1 (manual check)' -H 'Accept: application/json' -H 'Content-Type: application/json'`.
7. **ADR 0004** must record:
   - Context: on 2026-11-01 TCBS was blocked by a Cloudflare challenge; SSI was dropped (Ming); this is the decision.
   - Endpoint and method: `POST https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart`. Body fields: no `from`; `to` plus `countBack`. Our choices: `to` = start of the next VN day, `countBack` = calendar days, then filter client-side.
   - Response shape: columnar.
   - Unit: VND, constant `VCI_PRICE_UNIT`. The source is vnstock dividing stock prices by 1000; wrong units are rejected by the core guards.
   - Date encoding: `t` is epoch seconds and maps to the VN date.
   - Raw vs adjusted: assumed raw. vnstock sends no adjust flag. Must be checked against stored TCBS closes or VietCap's web chart around a recent dividend date before trusting history.
   - Volume: shares.
   - Terms: unofficial and undocumented, no published terms found, no SLA, personal low-volume use. Risk accepted by Ming on 2026-11-01. Not live-checked from the sandbox.
   - Header policy, a hard rule: only User-Agent/Accept/Content-Type; vnstock's Chrome UA, Origin and Referer are deliberately not copied. A 403 or challenge page fails the run, and there is no circumvention.
   - Request accounting: one POST per symbol per chunk; no symbol batching (follow-up).
   - Source selection: `EOD_SYNC_CONFIG.priceSource` plus `--source`.
   - UNVERIFIED list: shape, unit, `t` time of day, whether `to` is inclusive, max `countBack`/silent caps, rate limits, whether plain requests pass the bot check from the home server.
   - First dry-run go/no-go checklist: run `pnpm worker:eod --dry-run --source vci-public` on the home server. Check that it returns no 403, that VNM closes are tens of thousands, that `rejected` is 0, that overlapping dates match stored TCBS closes, and that a `--backfill --dry-run` returns full chunks.
8. **ADR 0001 amendment line, worker README.**
9. Run `pnpm typecheck && pnpm lint && pnpm test`.

Rules: R1/R2 (no conversion outside core). R3 (nothing new is client-side; worker only). R4 (the unchanged `runEodSync` stamps `source`/`fetched_at`; truncation, mismatch and shape errors throw rather than silently storing partial data, and the gap step records what's missing). R5 (source choice, URL, UA and span cap are in `config.ts`). R6 suspended (no auth code). R7 (eod-sync, core and TCBS are untouched). R8 (tests listed). R10 (market data only, public read endpoint, no brokerage login).

## Specialist input used
- **Adopted (both):** the endpoint, POST body (`timeFrame`, `symbols`, `to`, `countBack`) and columnar response, all from the data-engineer's vnstock read. `VCI_PRICE_UNIT = 'VND'` with core guards as the safety net. Strict equal-length column parsing. Strict digit-string parsing (architect regex). `t` → `vnDateOf`. A client-side range filter. One symbol per request (no batching; R7). Honest UA, no vnstock Chrome UA. Synthetic labelled fixtures. ADR plus a first-dry-run cross-check for raw vs adjusted.
- **Adopted (architect):** source selection by config constant plus a `--source` flag, eod-prices only, with the default flipped to `vci-public` in this PR. Reason: TCBS fails every request today, and the guards keep bad data out; this is reversible with one constant or `--source tcbs-public`. `requestJson` + `postJson` with **no** general headers option. An empty result → zero bars (the gap logic handles it), not an error. A symbol-mismatch check. ADR numbered 0004 (0001–0003 exist).
- **Adopted (data-engineer):** `to` one step past the end of `toDate` (start of the next VN day, matching vnstock's end+1 day). A dedupe by trade date, implemented as a rejection, because a duplicate PK in one upsert batch would fail. A span cap per request. A 403 or challenge page becomes a clear non-retryable error.
- **Resolved disagreements (reversible defaults):**
  - `countBack`: the data-engineer proposed weekdays + margin; the architect proposed calendar days. **Calendar days inclusive.** It is simpler and needs no margin constant. The over-fetch is at most ~40% and is filtered out.
  - Truncation guard: the data-engineer proposed "exactly countBack bars and oldest > from"; the architect proposed "more than countBack". With calendar-day `countBack`, a full trading series can never reach `countBack` bars, so **"more bars than countBack" → error** covers misuse. A silent server cap below `countBack` cannot be told apart from a new listing; it goes on the UNVERIFIED list and the dry-run backfill check.
  - Per-source backfill chunk override (architect rec 4) is **rejected**. VCI uses the same value (60) and a config invariant test covers the span. YAGNI.
  - Origin/Referer (data-engineer Q2, architect Q3) is **closed by the orchestrator hard rule**: never send them; a 403 → `blocked by source (HTTP 403)` non-retryable. The breaker stops the run after `maxConsecutiveFailures` symbols, which is existing behaviour (AC4).
- **Deferred to follow-ups:** symbol batching; replacing synthetic fixtures with a sanitized real capture after the first dry-run; updating the ADR 0004 UNVERIFIED items after that run; hardening the no-network guard; deciding whether to `--backfill` rewrite TCBS-era rows if VCI turns out adjusted (Ming).
- The `*-ssi-superseded.md` consults and plan were used only for structure (factory and test layout). Nothing SSI-specific is planned.

## Assumptions
1. The VCI request/response facts come from vnstock's source as summarized by WebFetch and are **UNVERIFIED** against live data. The sandbox cannot reach VN hosts. If they are wrong, the run fails or the bars are rejected; nothing bad is stored.
2. Prices are raw (as traded). This is the default until the first-dry-run cross-check. If they turn out adjusted, a new ticket is needed (STK-015 territory).
3. Whether plain requests (no Origin/Referer) pass from Ming's home server is unknown. If they don't, scheduled `eod-prices` runs fail loudly and record gaps, which is the same outcome as today with TCBS. Ming then picks another source; that does not block this plan.
4. Changing the scheduled default needs a release, or `--source` added in the schedule script (not changed here).
5. AC6 says "fixtures"; they are synthetic and labelled like the TCBS ones, because no live capture is possible from the sandbox.
6. Estimated size is ~220 lines of product code plus tests, fixtures and docs. That fits one cycle.

## Blocking questions
None.

## Split proposal
None.
