## Software Architect consult: STK-038 (SSI FastConnect Data PriceSource)

### Findings
1. **The seam is clean.** `runEodSync` depends only on `PriceSource` (`name`, `fetchDaily`). `cli.ts` is the one place that builds sources (it hard-codes `new TcbsPriceSource`, lines 89-93) and the one place that reads `process.env` (through `createServiceClient`). ADR 0001 §"Swapping the source" already describes this route. `eod-sync.ts` and `price-source.ts` should not need changes.
2. **`http.ts` can't do what SSI needs.** `getJson` only sends GET with fixed `User-Agent`/`Accept` headers. SSI needs (a) a POST with a JSON body to exchange the consumer ID/secret for an access token, and (b) `Authorization: Bearer …` on data calls. Its logging is safe today: it logs only `HTTP <status>` or `network error: <name>`, never a URL, header or body.
3. **The request cap and breaker only see `fetchDaily` calls.** `requestsPlanned`/`requestsMade` and `maxConsecutiveFailures` live in `runEodSync`. A token call and any pagination inside the adapter are HTTP calls the cap can't see, so they would quietly weaken AC4 ("same request cap").
4. **Chunk size is a TCBS assumption sitting in shared config.** `EOD_SYNC_CONFIG.backfillChunkTradingDays: 60` says "TCBS range cap is unverified". SSI's DailyOhlc (from memory, unverified) is paged (`PageIndex`/`PageSize`) and may cap the date range, so the chunk size has to fit the source.
5. **Rows from the two sources will coexist without trouble.** `prices_daily` has PK `(symbol, trade_date)`, and `source` is a plain column. Older `tcbs-public` rows stay as they are. Inside the 20-day lookback, SSI rows overwrite TCBS rows for the same dates, and `source` changes with them, which is correct provenance. No code filters prices by `source`; the worker store has no source predicate. Gap resolution goes by stored dates, so open gaps recorded under `tcbs-public` get resolved by SSI data.
   - Note: `tcbs-public` is also the financials source id, keyed in `epsBasisBySource` (cli.ts:68). It must not be renamed.
6. **Core guards only accept numbers.** `normalizeDailyBar` and `toVnd` take `number` only. From memory, SSI returns price/volume fields as **strings** and `TradingDate` as `dd/mm/yyyy` (both UNVERIFIED). A careless `Number(x)` turns `""` into `0`, and `0` gets past `typeof === 'number'`.
7. **Deploy:** secrets come from the host env_file `/Users/gh-runner/.config/stoktok/stoktok.env`, loaded through compose `env_file`. Locally the worker loads `.env.local` with `--env-file-if-exists`. The image takes no secret build args (STK-017). `deploy-stoktok.yml:77-78` only checks for the two `SUPABASE_*` key names. `run-job.sh` passes `"$@"` through to the container.
8. **The no-network guard only stubs global `fetch`.** This was already flagged in the STK-005 and STK-014 security reviews. Adapters take an injected `fetchImpl`, and the SSI adapter must do the same for both the token call and the data calls.

### Recommendations
1. **Choosing the source (AC2, R5).** Two options:
   - **Option A (recommended): a code constant plus a CLI override.**
     - Add `EOD_SYNC_CONFIG.priceSource: 'ssi-fastconnect'` to `config.ts`.
     - Add a small registry/factory, `createPriceSource(id, deps)`, with the ids `'ssi-fastconnect' | 'tcbs-public'`.
     - Add an optional `--source <id>` flag to `parseArgs`. An unknown id exits 2 before any network call.
     - Why: the choice isn't secret, so it shouldn't sit in the secrets env file. It can be tested in `cli.test.ts`, and `run-job.sh` already passes flags through.
     - Cost: changing the scheduled default needs a release or a `run-schedule.sh` edit.
   - **Option B: an env var `STOKTOK_PRICE_SOURCE`, defaulting to the config constant.** It can be flipped on the host without a release, but it mixes config into the secrets file and adds another untested input.
   - Either way, add **no fallback chaining**. Only one source is active per run.
2. **Where the token lives.** Put it in a small `SsiTokenProvider` in `apps/worker/src/sources/ssi-auth.ts`, separate from `SsiPriceSource` so STK-039 can reuse it if SSI turns out to cover financials.
   - Keep it **in memory, per process only**. Never cache it on disk: the container runs once and exits, and a token on disk is a secret at rest.
   - Fetch it lazily on the first `fetchDaily` and memoize the **promise**. Memoize a rejection too, so bad credentials fail every following symbol with no further network calls, and the existing breaker trips after 5 attempts with just 1 token request.
   - On a 401 from a data call: `invalidate()`, get a new token once, retry once. Anything beyond that is a non-retryable `SourceError`.
   - Pick the expiry from the token response if SSI provides one. Otherwise rely on the single 401 refresh, since a run lasts minutes.
3. **HTTP changes (minimal, R7).** Give `getJson` an optional `headers` record and add a sibling `postJson` (or an options object with `method`/`body`). Keep the current logging contract.
   - No URL, header or body ever goes into a log line or a `SourceError.message`.
   - Never echo token-endpoint responses on failure. Report only the status or a fixed message such as `token exchange failed: HTTP 401` or `token response shape`.
   - Treat 401/403 from the token endpoint as non-retryable.
4. **Keeping requests counted (AC4).** Two parts:
   - **Pagination:** use `PageSize` ≥ the chunk size. If `totalRecord` > rows returned, throw a non-retryable `SourceError('response truncated')` rather than fetching more pages, so every chunk stays 1 request.
   - **Chunk size:** make `backfillChunkTradingDays` a property of the selected source (e.g. `SSI_CONFIG.maxTradingDaysPerRequest`, with a factory-provided override of the eod config). Don't keep TCBS's 60.
   - The token call adds 1 request per run (+1 per refresh). Document that in the ADR. The cap doesn't need to count it.
5. **Credentials (AC3, R3).**
   - **Env names:** `SSI_FC_DATA_CONSUMER_ID` and `SSI_FC_DATA_CONSUMER_SECRET`.
   - **Base URL** is not secret, so it goes in `SSI_CONFIG` in `config.ts`.
   - **Reading the env:** only `cli.ts` reads it, and only when SSI is the selected source. Missing credentials fail before any network call with a message that names the variable and nothing else. TCBS runs must not require them.
   - **Passing them in:** to the provider constructor, stored in `#private` fields so `JSON.stringify` or a log of the object can't expose them.
   - **Where the names get listed:**
     - `.env.example` (no values);
     - the worker README;
     - the workspace `secrets.refs.yaml` (names plus the `agent/…` Bitwarden item, which is a workspace commit outside this repo);
     - the compose.yml comment that lists the host env_file keys.
6. **Stable ids (AC1, R4).**
   - Add `export const SSI_PRICE_SOURCE_NAME = 'ssi-fastconnect'` and leave `tcbs-public` untouched.
   - Declare `SSI_PRICE_UNIT` once, as TCBS does.
   - The adapter does shape normalisation only:
     - strict string→number parsing (`/^\d+(\.\d+)?$/`, anything else becomes the raw value so core rejects it);
     - `dd/mm/yyyy` → `YYYY-MM-DD`.
   - All unit conversion and plausibility checks stay in core `normalizeDailyBar` (R1/R2). Keep the "drop bars outside the requested range" behaviour.
7. **Tests without network (AC6).**
   - A fake `fetchImpl` routes by URL/method between token and data calls and records calls.
   - Use SYNTHETIC fixtures in `test/fixtures/ssi/` with a README label, as TCBS does: token-ok, token-denied, ohlc-ok (string fields, `dd/mm/yyyy`), ohlc-thousand-vnd (rejected by the unit guard), ohlc-malformed, ohlc-empty, ohlc-truncated (`totalRecord` > page).
   - Cases:
     - **Token reuse:** 1 token call across N `fetchDaily` calls.
     - **Expiry:** a data 401 leads to 1 refresh and 1 retry, then stops.
     - **Failure memo:** a token failure makes 0 further calls.
     - **Missing env:** fails fast with no `fetch` call.
     - **Selection:** `parseArgs --source` and the factory pick the right class; an unknown id exits 2.
     - **Shared run:** `runEodSync` with the SSI source and an in-memory store gives the same summary and idempotent upserts.
     - **Sentinel test:** set the credentials to sentinel strings. Assert the sentinel appears only in the token-request body the fake fetch receives, and never in log lines, `SourceError` messages, the summary JSON or `rejectedBySymbol`.
   - Keep the assertion that global `fetch` throws.
8. **ADR (AC5).** Write ADR 0004 "SSI FastConnect Data as primary EOD source" and add an amendment note to 0001 (Ming changed the decision on 2026-11-01). Record, marking every item UNVERIFIED until the first `--dry-run`:
   - endpoints;
   - token lifetime;
   - unit;
   - raw vs adjusted prices;
   - `TradingDate` encoding;
   - page and range caps;
   - rate limit;
   - terms for personal automated use (ticket note).
   Also record the source-selection mechanism, and that the token stays in memory only.

### Risks
- **Adjusted vs raw prices at the seam.** If SSI's DailyOhlc is adjusted and TCBS was raw, the series mixes bases. The first SSI bar is checked against a TCBS `lastClose`, so `close_jump` will catch large mismatches. Small ones (e.g. a cash-dividend adjustment) slip through and skew SMA/RSI. Mitigation: on the first live dry-run, compare overlapping dates against the stored TCBS rows, and document the result in the ADR.
- **Leaking credentials through errors.** The likely paths are a thrown error that includes the request body, a fetch `cause`, or a URL with query credentials. The SSI token call must use a POST body, never a query string. Keep the sentinel test.
- **Deploy coupling.** Adding SSI keys to the `deploy-stoktok.yml` key check would block web deploys until Ming fills the host file. Leaving them out means a scheduled job fails at runtime, visible in the logs and digest, until he does.
- **Rate limits and terms are unknown.** The 1 s delay may be too fast or too slow. Registering may also bind Ming to terms for personal use only.
- **Scope creep (R7).** Hardening the no-network guard and adding `redirect: 'error'` are tempting while here. Keep them as follow-ups unless the plan names them, though `redirect: 'error'` on calls that carry a bearer token is defensible within this ticket's security area.
- **Blocked until Ming acts.** The live run needs his registration and credentials (a human step). The code can only be verified against synthetic fixtures until then.

### Open questions (each with a proposed default)
1. **Source selection mechanism:** config constant + `--source` CLI flag (A), or an env var (B)? *Default: A.* It isn't secret, it's testable, and it stays out of the secrets file.
2. **Should `deploy-stoktok.yml` require the SSI key names?** *Default: no, warn only.* Don't block web deploys on a worker credential; the worker fails fast with the variable name.
3. **When TCBS is selected, should the SSI env still be validated?** *Default: no.* Validate lazily, only for the selected source.
4. **Should the token provider live as a shared module now for STK-039?** *Default: yes, as its own file (`ssi-auth.ts`),* with no financials code added.
5. **May this ticket add `redirect: 'error'` to authenticated SSI requests only?** *Default: yes, for SSI calls only.* The TCBS path stays unchanged.

Files reviewed:
- /home/spaceM/projects/stoktok/apps/worker/src/cli.ts
- /home/spaceM/projects/stoktok/apps/worker/src/config.ts
- /home/spaceM/projects/stoktok/apps/worker/src/sources/{price-source,tcbs,http}.ts
- /home/spaceM/projects/stoktok/apps/worker/src/jobs/eod-sync.ts
- /home/spaceM/projects/stoktok/apps/worker/test/no-network.ts
- /home/spaceM/projects/stoktok/packages/core/src/market/daily-bar.ts
- /home/spaceM/projects/stoktok/supabase/migrations/20261023000100_v1_tables.sql
- /home/spaceM/projects/stoktok/docs/adr/0001-eod-price-source.md
- /home/spaceM/projects/stoktok/docs/adr/0003-deploy-and-scheduling.md
- /home/spaceM/projects/stoktok/deploy/deployment-repo/apps/stoktok/{compose.yml,run-job.sh}
- /home/spaceM/projects/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml
- /home/spaceM/projects/stoktok/.env.example
- /home/spaceM/secrets.refs.yaml (names only)
