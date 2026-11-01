# STK-038 consult: data-engineer

## Findings

Provenance tags: [V] = read on SSI's public docs today (guide.ssi.com.vn api-specs.md, connection-guide.md, sample-client-guide.md, service-registration.md). [R] = recalled, not verified. [N] = the docs do not state it.

### SSI FastConnect Data
- [V] Auth: POST `https://fc-data.ssi.com.vn/api/v2/Market/AccessToken`. JSON body has `consumerID` and `consumerSecret`, both required. The response has `message`, `status` and the token. The sample nests the token at `data.accessToken`.
- [N] Token expiry is not documented. [R] Tokens last hours (about 8 h?).
- [R] The token goes in the header `Authorization: Bearer <token>` on data calls. The docs I fetched don't show this. Verify on the first live run.
- [V] Daily OHLC: GET `https://fc-data.ssi.com.vn/api/v2/Market/DailyOhlc`. Parameters:
  - `symbol`: optional.
  - `fromDate` and `toDate`: required, format `dd/mm/yyyy`.
  - `pageIndex`: 1 to 10.
  - `pageSize`: one of 10, 20, 50, 100, 1000.
  - `ascending`: optional boolean.
- [V] Response `data` items have: Symbol, Market, TradingDate (`dd/mm/yyyy`), Time, Open, High, Low, Close, Volume, Value.
  - Volume is "total normal matched volume". That likely excludes put-through (negotiated) deals, so it may be lower than total traded volume.
  - [R] The response wrapper is probably `{message, status, totalRecord, data: [...]}`.
  - [R] Field-name casing: I would expect camelCase or PascalCase. Parse case-insensitively or verify from a fixture.
- [V] Paging is at most 10 pages × 1000 rows = 10,000 rows per query. That is far above the worker's 60-trading-day backfill chunk, so one page with `pageSize=100` or `1000` is enough per symbol.
- [N] The docs give no maximum date range, no price unit, no rate limits, no usage terms and no cost.
  - [R] SSI prices are in VND, not thousand VND. Open, High, Low and Close are probably raw VND, such as 25400 or 25400.0, but this is unconfirmed. [R] Values may be decimal numbers or strings.
  - [R] Rate limits exist, something like 1 request/s or a per-hour cap. This is unconfirmed.
- [V] Alternative endpoint `DailyStockPrice` (same host and path style) returns Ceilingprice, Floorprice, Refprice, Closeprice, `Closepriceadjusted` and Totalmatchvol. It also has an optional `market` filter. It is useful later for adjusted prices (STK-015) and for checking price limits, and it is not needed for this ticket. Unit is [N].
- [V] Registration:
  - Registration is currently done in person at an SSI office or through an account executive, or by postal form. Online registration is not available.
  - You need an SSI trading account. Ming trades on TCBS, so he may not have one.
  - Keys (ConsumerID, ConsumerSecret, PrivateKey) are created in iBoard "Dịch vụ API" and shown once.
  - A fixed IP can be registered there.
  - The page says "FastConnect API". It is not confirmed to be the same product as FC Data.
- [V] Streaming (`fc-datahub`) is a separate service and is not needed for EOD.

### Existing code (read)
- `PriceSource` takes `(symbol, fromDate, toDate, ctx)` with ISO `YYYY-MM-DD` dates and returns `{bars, rejected}`.
- `tcbs.ts` shows the pattern: parse the raw item, then `normalizeDailyBar(symbol, raw, UNIT, sanity, lastClose)`. The unit constant is the only unit decision, and the core guards reject wrong-unit bars.
- `http.ts` `getJson` is GET-only, sends only User-Agent and Accept, and has no way to add headers or send a POST body. SSI needs a Bearer header and a POST for the token.
- `config.ts` has `TCBS_CONFIG` hard-coded. ADR 0001 says new sources are "constructed in `cli.ts`". I did not read `cli.ts`.

## Recommendations

1. (AC1, AC4) Add `apps/worker/src/sources/ssi.ts` with `SsiPriceSource` (`name = 'ssi-fastconnect'`).
   - Add `SSI_PRICE_UNIT: PriceUnit = 'VND'`, labelled UNVERIFIED in the same style as TCBS.
   - `fetchDaily` converts ISO dates to `dd/mm/yyyy`, requests with `pageIndex=1`, `pageSize=1000` and `ascending=true`, and filters the returned `TradingDate` back into `[from, to]`.
   - It parses `TradingDate` strictly with a regex `^\d{2}/\d{2}/\d{4}$` and converts to ISO. An unparseable date goes to `rejected`, not stored.
   - It coerces numeric strings to numbers (core normalize should reject non-integers or NaN).
   - If the response reports more rows than were returned (`totalRecord` > page size), throw a non-retryable `SourceError` instead of silently truncating. This is cheap and avoids gaps (R4).
2. (AC3, R3) Token handling:
   - Fetch the token lazily on the first call and cache it in memory for the run.
   - On HTTP 401/403 from a data call, re-authenticate once and retry once. Do not chain this with the retry logic in `getJson`.
   - Never log the token, the body or the headers. `SourceError` messages must carry only the status.
   - Env var names (suggestion): `SSI_FC_CONSUMER_ID`, `SSI_FC_CONSUMER_SECRET`. Add them to `.env.example` with no values. Add `SSI_FC_PRIVATE_KEY` only if a later endpoint requires signing; none of the docs I read require it for the data calls.
   - Fail fast with a clear "missing env var NAME" message (names only) when SSI is selected and a variable is unset.
3. (Plumbing) Extend `getJson` with optional `headers` and `method`/`body`, or add a sibling `postJson`.
   - Keep the existing retry/backoff semantics and keep the default call byte-identical for TCBS.
   - Responses from the token endpoint must never be logged.
4. (AC2, R5) Add `EOD_SOURCE` (or `PRICE_SOURCE`) in env with values `ssi-fastconnect|tcbs-public`.
   - The default should be `ssi-fastconnect`, as the ticket says it becomes primary.
   - Add `SSI_CONFIG = { baseUrl, userAgent, pageSize }` to `config.ts`.
   - Build the source in `cli.ts` via a small factory.
   - Reject unknown values loudly.
   - Add no fallback chaining.
5. (AC4) Reuse `EOD_SYNC_CONFIG` delay, retry, circuit breaker and request cap unchanged. `backfillChunkTradingDays=60` is fine for SSI. Update the stale comment that says the cap is "TCBS ... unverified".
6. (AC5, AC6) Write ADR 0002 and mark ADR 0001 as superseded for the primary source.
   - Record the verified facts above, with sources and the date read, and the items still UNVERIFIED.
   - State the terms and rate limit finding as "not published in the public docs; confirm with SSI during registration".
   - Tests use a recorded fixture. Because I have no live response, the fixture will be synthetic, built from the documented field list. Label it as such, and replace it with a sanitized real response after Ming's first `--dry-run`.
   - Test cases:
     - date conversion in both directions
     - a thousand-VND-looking payload is rejected by the guards
     - truncation throws
     - a 401 triggers one re-auth
     - the token never appears in log output
     - missing env vars fail with a names-only message
7. Treat Volume as "normal matched" only. Note it in the ADR, because volume-based signals could see lower numbers than TCBS reported if put-through volume matters.

## Risks

- Registration blocker: it needs an SSI trading account and in-person or postal registration. This could take days or weeks, or may be impossible if Ming has no SSI account. The live path cannot be validated until then, and the adapter would ship tested only against synthetic fixtures.
- Unit and shape are unconfirmed, and the guards are the only defence. If SSI returns VND, the guards pass and everything is fine. The ADR must say that the first `--dry-run` is a go/no-go check.
- Unknown rate limits and an unknown personal-use clause. A fixed-IP registration option exists; if enforced, the home server's dynamic IP behind the Cloudflare Tunnel could be blocked. Check the egress IP.
- Cost is not stated. Daily OHLC may need a paid package or tier.
- Token expiry is unknown, so a long backfill could hit 401 mid-run. Recommendation 2 covers it.
- Secrets: the token and the consumer secret must not leak into `SourceError`, logs or fixtures. The existing code logs only `last.message`, which is fine as long as the SSI errors keep to the pattern `HTTP <status>`.
- Raw vs adjusted prices: OHLC is probably raw. Adjusted close exists only in `DailyStockPrice`. This matters when STK-015 needs an adjusted series.
- Doc/host drift: the docs show both `/v2.0/Market` and `/api/v2/Market` bases. I used the explicit paths from api-specs.

## Open questions (batch for Ming)

1. Does Ming have, or will he open, an SSI trading account? Without it, SSI is not reachable. Proposed default: build and merge the adapter with synthetic fixtures behind config, and keep `EOD_SOURCE` default `tcbs-public` until the first successful live `--dry-run`, then flip the default. This differs slightly from the ticket's "make it primary", so Ming needs to confirm.
2. Is there a cost for FC Data or for the DailyOhlc endpoint, and what are the rate limits and the personal automated-use terms? This needs a question to SSI at registration. Ming should record the answers (not the keys) in the ADR.
3. Is a fixed IP required? Check the egress IP of the home server.
4. Should the env var names be `SSI_FC_CONSUMER_ID` and `SSI_FC_CONSUMER_SECRET`? Proposed default: yes.
5. Alternative if SSI registration is slow: a VNDirect source is listed in ADR 0001. Is it worth a separate ticket as a stopgap? It has the same unofficial-endpoint risk as TCBS, so I would leave it out of this ticket (R7).

Files read: /home/spaceM/projects/stoktok/work/tickets/STK-038/ticket.md, apps/worker/src/sources/{price-source,tcbs,http}.ts, apps/worker/src/config.ts, docs/adr/0001-eod-price-source.md. I did not read `eod-sync.ts` or `cli.ts`, and I read no .env files.
