Status: READY

# Plan — STK-038: SSI FastConnect Data adapter for end-of-day prices

## Spec summary
- docs/spec-v1.md §2.2: "No official authenticated data feed. Public sources … are **unofficial and can change or break without notice**. Check each source's license and terms for personal use." / "Every price carries a `fetched_at` timestamp and a source." / "Gaps must be detected, not silently interpolated."
- docs/spec-v1.md §4.3: "One interface per data type (`PriceSource`, `FinancialsSource`, `NewsSource`); each implementation is swappable." / "Primary + fallback source per data type where possible." / "Every record stores `source` and `fetched_at`."
- docs/spec-v1.md §9 Risks: "Unofficial data source breaks or changes | No prices/signals | Adapter layer, fallback source, freshness badges, signal suppression". Open question 4: "Primary and fallback data sources after license/terms check."
- CLAUDE.md R2 (integer VND, rounding in core), R3 (service-side secrets only), R4 (`source` + `fetched_at` on every market-data record), R5 (market/source settings are configuration), R7 (stay in plan), R8 (green checks, tests).
- ADR 0001 §"Swapping the source": "Implement `PriceSource` … declare its unit in one constant, and construct it in `cli.ts`. `runEodSync` does not change."
- Ticket goal: "Add an SSI FastConnect Data implementation of `PriceSource` and make it the primary end-of-day price source."

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | New `PriceSource` for SSI returns daily OHLCV through the existing normalization and plausibility guards; every stored row carries `source` (`ssi-fastconnect`) and `fetched_at` (R4). | `ssi.test.ts › maps synthetic ohlc-ok.json to integer VND bars` (all bars go through core `normalizeDailyBar`; grep shows no unit/plausibility logic in `ssi.ts` beyond string→number and date reformat); `ssi.test.ts › name is ssi-fastconnect`; `ssi.test.ts › runEodSync with SsiPriceSource writes source=ssi-fastconnect and the run fetched_at on every row`. |
| 2 | Active source selected by configuration, not hard-coded (R5); TCBS stays available; no fallback chaining beyond §4.3. | `select-price-source.test.ts › config default is ssi-fastconnect`, `› tcbs-public builds TcbsPriceSource without SSI env`, `› unknown id throws`; `cli.test.ts › --source tcbs-public / ssi-fastconnect accepted`, `› --source unknown / missing value / on financials -> usage`. Reviewer greps `cli.ts`: no `new TcbsPriceSource` / `new SsiPriceSource` (factory only), no try-other-source loop. |
| 3 | SSI credentials read from env by name only, server/worker-side only (R3); names in `.env.example` with no values; no credential in code, tests, logs or fixtures. | `.env.example` diff adds `SSI_FC_DATA_CONSUMER_ID=` and `SSI_FC_DATA_CONSUMER_SECRET=` (empty). `select-price-source.test.ts › missing SSI env fails before any fetch with names only`. `ssi.test.ts › sentinel credentials and token never appear in logs, errors, summary or rejections`. Grep: `process.env` read only in `cli.ts`; no `NEXT_PUBLIC_SSI`; nothing under `apps/web` imports SSI code. Fixtures contain only the literal placeholder token `SYNTHETIC-TOKEN`. |
| 4 | `pnpm worker:eod`, `--dry-run`, `--backfill` work unchanged with the new source (same idempotency, delays, retries, circuit breaker, request cap). | `eod-sync.ts` and `price-source.ts` unchanged in the diff (git diff). `ssi.test.ts › runEodSync with SsiPriceSource: re-run is idempotent and requestsMade = symbols × chunks`; `› token failure is memoized: 1 token request, breaker trips after maxConsecutiveFailures`; `config.test.ts › SSI pageSize covers lookback and backfill chunk`. Existing `eod-sync.test.ts` and `cli.test.ts` still pass unchanged. |
| 5 | Price unit and date encoding of the SSI response documented in a new/updated ADR; wrong units rejected by the existing guards, not stored. | `docs/adr/0004-ssi-fastconnect-eod-source.md` exists with sections Unit, Date encoding, Terms/rate limits, UNVERIFIED list; ADR 0001 carries an amendment line. `ssi.test.ts › ohlc-thousand-vnd.json -> every bar rejected by core guards, none returned`. |
| 6 | Tests use recorded fixtures and the no-network guard only; `typecheck`, `lint`, `test` pass. | `pnpm typecheck && pnpm lint && pnpm test` green. Fixtures live in `apps/worker/test/fixtures/ssi/` with a README labelled SYNTHETIC (no live response is available yet — see Assumptions A6). `ssi.test.ts › global fetch is blocked in tests`. All SSI tests inject `fetchImpl`. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `apps/worker/src/sources/ssi.ts` (new) | `SSI_PRICE_SOURCE_NAME = 'ssi-fastconnect'`, `SSI_PRICE_UNIT: PriceUnit = 'VND'` (UNVERIFIED comment), `SsiPriceSource implements PriceSource` | AC1, AC5 |
| `apps/worker/src/sources/ssi-auth.ts` (new) | `SsiTokenProvider`: POST token exchange, in-memory promise memo (incl. rejection), `invalidate()`, credentials in `#private` fields | AC3; reusable seam for STK-039 without adding financials code |
| `apps/worker/src/sources/select-price-source.ts` (new) | `PRICE_SOURCE_IDS`, `type PriceSourceId`, `isPriceSourceId`, `createPriceSource(id, { env, fetchImpl, http })` — reads SSI env names only when `id === 'ssi-fastconnect'`, throws names-only error when unset/empty | AC2, AC3 |
| `apps/worker/src/sources/http.ts` | Internal `requestJson` shared by `getJson` (unchanged behaviour/headers for TCBS) and new `postJson`; optional `headers` and `redirect` options added only when provided | SSI needs POST body + `Authorization` header; TCBS path must stay byte-identical (AC4) |
| `apps/worker/src/config.ts` | Add `EOD_SYNC_CONFIG.priceSource: 'ssi-fastconnect' as PriceSourceId`; add `SSI_CONFIG = { baseUrl: 'https://fc-data.ssi.com.vn', userAgent, pageSize: 100 }`; update the `backfillChunkTradingDays` comment (no longer TCBS-only) | AC2 (R5), AC4 |
| `apps/worker/src/cli.ts` | `parseArgs` accepts `--source <id>` for `eod-prices` only; `main` builds the EOD source via `createPriceSource(args.source ?? EOD_SYNC_CONFIG.priceSource, { env: process.env, … })`; update `USAGE` | AC2, AC3 |
| `apps/worker/src/sources/ssi.test.ts` (new) | Adapter, token and end-to-end `runEodSync` tests (list below) | AC1, AC3–AC6 |
| `apps/worker/src/sources/ssi-auth.test.ts` (new) | Token provider tests | AC3 |
| `apps/worker/src/sources/select-price-source.test.ts` (new) | Factory/selection tests | AC2, AC3 |
| `apps/worker/src/config.test.ts` (new) | Page-size invariant test | AC4 |
| `apps/worker/src/sources/http.test.ts` | Add `postJson` and extra-header/redirect tests; existing tests untouched | Plumbing change needs tests (R8) |
| `apps/worker/src/cli.test.ts` | Add `--source` cases; existing cases untouched | AC2 |
| `apps/worker/test/fixtures/ssi/README.md` (new) | SYNTHETIC label, assumed shape, how to record a sanitized real capture | AC6 |
| `apps/worker/test/fixtures/ssi/token-ok.json`, `ohlc-ok.json`, `ohlc-thousand-vnd.json`, `ohlc-malformed.json`, `ohlc-empty.json`, `ohlc-truncated.json`, `ohlc-other-symbol.json`, `ohlc-error-status.json` (new) | Synthetic fixtures from the documented field list | AC1, AC5, AC6 |
| `docs/adr/0004-ssi-fastconnect-eod-source.md` (new) | Decision, endpoints, auth flow, unit, date encoding, volume semantics, request accounting, terms/rate-limit findings, UNVERIFIED list, first-dry-run go/no-go checklist | AC5, ticket note on terms |
| `docs/adr/0001-eod-price-source.md` | One amendment line under Status: primary source superseded by ADR 0004 (Ming, 2026-11-01); TCBS kept as selectable alternative | AC5 |
| `.env.example` | Add worker-only block with `SSI_FC_DATA_CONSUMER_ID=` and `SSI_FC_DATA_CONSUMER_SECRET=` (no values, "server-only (R3), worker only" comment) | AC3 |
| `apps/worker/README.md` | EOD section: SSI is the default source, env names, `--source`, first live run = `--dry-run` go/no-go | AC3, AC4 documentation |

Not touched (deliberately): `apps/worker/src/jobs/eod-sync.ts`, `apps/worker/src/sources/price-source.ts`, `apps/worker/src/sources/tcbs.ts`, `packages/core/**`, `supabase/**`, `deploy/**`, the workspace `secrets.refs.yaml`. See follow-ups in Assumptions.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `ssi.test.ts › name is ssi-fastconnect` | AC1, R4 |
| `ssi.test.ts › builds DailyOhlc URL: symbol, fromDate/toDate as dd/mm/yyyy, pageIndex=1, pageSize from SSI_CONFIG, ascending=true` | AC1 date encoding |
| `ssi.test.ts › sends Authorization: Bearer <token> and redirect: error on the data call` | AC3 |
| `ssi.test.ts › maps synthetic ohlc-ok.json (PascalCase keys, numeric strings, dd/mm/yyyy) to integer VND bars with ISO dates` | AC1 |
| `ssi.test.ts › ohlc-thousand-vnd.json -> every bar rejected by core guards, none returned` | AC5 |
| `ssi.test.ts › ohlc-malformed.json -> good bar kept; empty-string price, non-numeric string, bad date (31/02/2026, 2026-10-21), non-object item rejected with core reasons` | AC1 (strict parsing: `""` must NOT become 0) |
| `ssi.test.ts › ohlc-empty.json -> zero bars, no error` | AC1 |
| `ssi.test.ts › bars outside the requested range are dropped` | AC1 |
| `ssi.test.ts › ohlc-truncated.json (totalRecord > rows returned) -> non-retryable SourceError 'response truncated', no second page requested` | AC4 (1 request per chunk), R4 (no silent gaps) |
| `ssi.test.ts › ohlc-other-symbol.json -> item whose Symbol differs from the requested one is rejected (symbol_mismatch), not stored` | AC1 data integrity |
| `ssi.test.ts › envelope without data array / error status -> non-retryable SourceError with a fixed message (no response text echoed)` | AC1, AC3 |
| `ssi.test.ts › data 401 -> one token refresh and one retry; second 401 -> non-retryable SourceError` | AC3/AC4 |
| `ssi.test.ts › one token request across N fetchDaily calls` | AC4 request accounting |
| `ssi.test.ts › runEodSync with SsiPriceSource writes source=ssi-fastconnect and the run fetched_at on every row` | AC1, R4 |
| `ssi.test.ts › runEodSync with SsiPriceSource: re-run is idempotent and requestsMade = symbols × chunks (daily and --backfill)` | AC4 |
| `ssi.test.ts › token failure is memoized: 1 token request, breaker trips after maxConsecutiveFailures` | AC4 |
| `ssi.test.ts › sentinel credentials and token never appear in logs, errors, summary JSON or rejectedBySymbol (sentinel only in the token POST body)` | AC3 |
| `ssi.test.ts › global fetch is blocked in tests` | AC6 |
| `ssi-auth.test.ts › POSTs JSON {consumerID, consumerSecret} to /api/v2/Market/AccessToken; reads data.accessToken` | AC3 |
| `ssi-auth.test.ts › concurrent/sequential get() share one request; invalidate() forces a new one` | AC3 |
| `ssi-auth.test.ts › 401/403 or missing token in body -> non-retryable SourceError 'token exchange failed: HTTP <n>' / 'token response shape'; rejection memoized` | AC3 |
| `ssi-auth.test.ts › JSON.stringify(provider) and String(provider) contain no credential` | AC3 |
| `select-price-source.test.ts › config default is ssi-fastconnect` | AC2 |
| `select-price-source.test.ts › tcbs-public builds TcbsPriceSource without SSI env` | AC2 |
| `select-price-source.test.ts › ssi-fastconnect with both vars builds SsiPriceSource (no fetch at construction)` | AC2 |
| `select-price-source.test.ts › missing SSI env fails before any fetch with names only (unset and empty string)` | AC3 |
| `select-price-source.test.ts › unknown id throws` | AC2 |
| `config.test.ts › SSI pageSize covers lookback and backfill chunk` (`SSI_CONFIG.pageSize >= max(lookbackTradingDays, backfillChunkTradingDays)` and is one of 10/20/50/100/1000) | AC4 |
| `http.test.ts › postJson sends method POST, JSON body, Content-Type, extra headers; retries 5xx; 401 not retried` | plumbing |
| `http.test.ts › getJson with extra headers and redirect merges them; without them headers stay exactly User-Agent + Accept` | AC4 (TCBS unchanged) |
| `cli.test.ts › --source tcbs-public / ssi-fastconnect accepted (with --dry-run/--backfill in any order)` | AC2 |
| `cli.test.ts › --source unknown / missing value / repeated / on financials or signals -> usage` | AC2 |

No `packages/core` change: the adapter only reshapes (string→number, `dd/mm/yyyy`→ISO); unit conversion and plausibility stay in core `normalizeDailyBar` (R1/R2), which already has tests.

## Approach
1. **http.ts.** Extract an internal `requestJson(fetchImpl, url, init, o)` holding today's retry loop verbatim. `getJson(fetchImpl, url, o)` calls it with `{ headers: { 'User-Agent', Accept } }` plus `o.headers` / `o.redirect` only when set (so the existing header-equality test still passes). Add `postJson(fetchImpl, url, body, o)`: `method: 'POST'`, `Content-Type: application/json`, `JSON.stringify(body)`. Logging contract unchanged: only `HTTP <status>` / `network error: <name>`; never URL, headers or body.
2. **config.ts.** Add `SSI_CONFIG` and `EOD_SYNC_CONFIG.priceSource`. Keep `backfillChunkTradingDays: 60` shared (one symbol × ≤60 trading days ≤ 100 rows = one page); fix its comment. Type `priceSource` via `PriceSourceId` from `select-price-source.ts` — or, to avoid an import cycle (config ← sources ← config), define `PRICE_SOURCE_IDS` in `config.ts` and import it in the factory.
3. **ssi-auth.ts.** `new SsiTokenProvider({ consumerId, consumerSecret, fetchImpl, http, baseUrl?, userAgent? })`; credentials in `#consumerId`/`#consumerSecret`, token promise in `#token`. `get()` lazily calls `postJson(.../api/v2/Market/AccessToken, { consumerID, consumerSecret })` with `redirect: 'error'`, extracts `data.accessToken` (case-insensitive key lookup), memoizes the promise **including rejection**. Errors are fixed strings: `token exchange failed: HTTP <n>` or `token response shape`. `invalidate()` clears the memo. No disk cache, no expiry handling (rely on 401 refresh; a run lasts minutes).
4. **ssi.ts.** `SsiPriceSource({ tokens, fetchImpl, http, baseUrl?, userAgent?, pageSize?, sanity? })`. `url(symbol, from, to)` → `${baseUrl}/api/v2/Market/DailyOhlc?symbol=…&fromDate=dd/mm/yyyy&toDate=…&pageIndex=1&pageSize=…&ascending=true`. `fetchDaily`: get token → `getJson` with `Authorization: Bearer <token>`, `redirect: 'error'`; on `SourceError` status 401 → `tokens.invalidate()`, get a new token, retry once; second 401 → `SourceError('HTTP 401 after token refresh', false, 401)`. Envelope: case-insensitive lookup of `data` (must be an array, else non-retryable `unexpected response shape`), `status` (if present and not 200/'200'/'Success' → non-retryable `SourceError('ssi status <n>', false)` — numeric/known value only, never the `message` text), `totalRecord` (if a number > `data.length` → non-retryable `response truncated`). Per item: lower-case key map; `Symbol` present and ≠ requested (case-insensitive) → reject `symbol_mismatch`; `TradingDate` via strict `^(\d{2})\/(\d{2})\/(\d{4})$` → `YYYY-MM-DD` (else pass the raw value so core returns `invalid_trade_date`); range filter only on converted dates (as TCBS does); numbers: `typeof number` passes through, strings matching `^\d+(\.\d+)?$` → `Number(s)`, anything else passes raw so core rejects. Then `normalizeDailyBar(symbol, raw, SSI_PRICE_UNIT, sanity, ctx.lastClose)`. No unit math in the adapter (R1/R2).
5. **select-price-source.ts.** `createPriceSource(id, { env, fetchImpl, http })`: `tcbs-public` → `new TcbsPriceSource({ fetchImpl, http })` exactly as cli.ts does today; `ssi-fastconnect` → collect unset/empty names among `SSI_FC_DATA_CONSUMER_ID`, `SSI_FC_DATA_CONSUMER_SECRET`, throw `Error('missing env: <names>')` if any, else build provider + source. Unknown → throw. One source per run; no fallback loop (spec §4.3 "where possible" is satisfied by having two selectable sources).
6. **cli.ts.** `parseArgs`: `--source <id>` only for `eod-prices`, value must satisfy `isPriceSourceId`, not repeatable; add `source` to the result only when given (existing `toEqual` tests unchanged). `main` eod branch: `createPriceSource(args.source ?? EOD_SYNC_CONFIG.priceSource, { env: process.env, fetchImpl: fetch, http })`. Build the source **before** `createServiceClient` is used for the job so missing SSI env fails before any network or DB work; the existing top-level catch prints only `e.message` (names only) and exits 1.
7. **Fixtures + README.** SYNTHETIC, PascalCase keys from the documented list (Symbol, Market, TradingDate, Time, Open, High, Low, Close, Volume, Value), string numbers, envelope `{ message, status, totalRecord, data }`. Token fixture uses `SYNTHETIC-TOKEN`.
8. **Docs.** ADR 0004 (below) + ADR 0001 amendment + `.env.example` + worker README.
9. Run `pnpm typecheck && pnpm lint && pnpm test`.

ADR 0004 must record: decision (Ming 2026-11-01, TCBS blocked by Cloudflare challenge); endpoints and auth flow; unit = VND assumed (`SSI_PRICE_UNIT`), thousand-VND payloads rejected by core guards; `TradingDate` = `dd/mm/yyyy` VN calendar date; Volume = "total normal matched volume" (excludes put-through, may be lower than TCBS); raw vs adjusted = assumed raw (`DailyStockPrice` has `Closepriceadjusted` — relevant to STK-015); paging 10×1000 max, we use one page and fail on truncation; request accounting (+1 token request per run, +1 per refresh, not counted by `maxBackfillRequests`); token in memory only; source selection (`EOD_SYNC_CONFIG.priceSource` + `--source`); terms, cost and rate limits "not published in the public docs read on 2026-11-01 (guide.ssi.com.vn api-specs / connection-guide / service-registration); confirm with SSI at registration"; registration needs an SSI account, in person or by post, optional fixed-IP; the TCBS→SSI seam (first SSI bars checked against TCBS `lastClose`; compare overlapping dates on the first dry-run); UNVERIFIED list (Bearer header format, token lifetime, envelope casing, number-vs-string fields, unit, max date range, `status` values) and a first-`--dry-run` go/no-go checklist.

Rules: R1/R2 (no conversion outside core), R3 (env read only in worker `cli.ts`, credentials never logged, private fields, POST body not query string, `redirect: 'error'` on authenticated calls), R4 (source name on every row via unchanged `runEodSync`; truncation is an error, not a silent gap), R5 (source choice and SSI tuning in `config.ts`), R6 suspended (no auth code), R7 (no changes to eod-sync, core, deploy), R8 (tests listed), R10 (market data only; no brokerage login or orders — FC **Data**, not FC Trading).

## Specialist input used
- **Adopted (both):** `ssi.ts` adapter with unit constant; lazy in-memory token with one refresh on 401; fixed, status-only error messages; extend `http.ts` minimally keeping TCBS identical; single page + throw on truncation; no fallback chaining; synthetic labelled fixtures; sentinel test.
- **Adopted (architect):** source choice as a config constant + `--source` CLI flag (Option A) rather than env var — it is not secret, it is testable, and it stays out of the secrets env file. Separate `ssi-auth.ts` with memoized promise including rejection. `#private` credential fields. `redirect: 'error'` on SSI calls only. ADR numbered **0004** (0002 and 0003 already exist; the data-engineer's "ADR 0002" is rejected). Env names `SSI_FC_DATA_CONSUMER_ID` / `SSI_FC_DATA_CONSUMER_SECRET` — chosen over `SSI_FC_CONSUMER_*` because SSI also has FastConnect *Trading* with its own keys; the `DATA` infix prevents mixing them up. Do not add SSI names to `deploy-stoktok.yml` key check (default: no; avoids blocking web deploys).
- **Adopted (data-engineer):** strict `dd/mm/yyyy` parsing; case-insensitive keys; Volume semantics note; terms/rate-limit "not published" wording; first `--dry-run` as go/no-go.
- **Rejected (data-engineer):** default `tcbs-public` until the first live run — TCBS currently fails every request, so it buys nothing, and the ticket says SSI becomes primary. With SSI default and no credentials the job fails fast with the variable names, which is the clearer signal. Reversible (one constant or `--source tcbs-public`).
- **Rejected (architect):** per-source `backfillChunkTradingDays` override — no evidence SSI needs a different chunk; replaced by a config invariant test (`pageSize ≥ chunk`). Re-auth on 403 (data-engineer) — 403 more likely means not entitled / IP not registered, where a refresh does not help; only 401 refreshes (noted UNVERIFIED in ADR).
- **Deferred:** `SSI_FC_PRIVATE_KEY` (not needed for data calls per docs read), `DailyStockPrice`/adjusted prices (STK-015), VNDirect stopgap (separate ticket if Ming wants), hardening the global-fetch no-network guard (follow-up from STK-005/014).

## Assumptions
Reversible defaults; the orchestrator should publish 1–4 as `decision` issues per workspace rule §8 (24 h default applies):
1. **Source selection = `EOD_SYNC_CONFIG.priceSource` + `--source` flag**, default `ssi-fastconnect`. Changing the scheduled default needs a release (or `--source` in `run-schedule.sh`).
2. **Env names `SSI_FC_DATA_CONSUMER_ID`, `SSI_FC_DATA_CONSUMER_SECRET`.** Ming should store values under these names (Bitwarden `agent` collection, `apps/worker/.env.local`, and the host env file `/Users/gh-runner/.config/stoktok/stoktok.env`).
3. **Deploy workflow does not require the SSI names**; the worker fails fast at run time with the names.
4. **Token provider is its own module** (reusable by STK-039 if SSI covers financials); no financials code here.
5. SSI response facts (Bearer header, envelope `{message,status,totalRecord,data}`, `data.accessToken`, VND unit, string-or-number fields, raw prices) are UNVERIFIED and documented as such; core guards are the defence for unit errors.
6. AC6 says "recorded fixtures": no live response can be recorded until Ming registers, so fixtures are synthetic and labelled like the TCBS ones; replace with a sanitized capture after the first `--dry-run` (follow-up).
7. Until Ming completes registration (human step, ticket notes), scheduled `eod-prices` runs fail with `missing env: …` — prices are not being fetched today anyway (TCBS blocked).

Follow-ups (not in this diff, R7): add the two names to workspace `secrets.refs.yaml` (workspace repo, outside this project); add the names to the `compose.yml` comment listing host env-file keys; Ming adds values to the host env file; replace synthetic fixtures with a sanitized real capture; update ADR 0004 UNVERIFIED items after the first dry-run; harden the no-network guard.

Process note for the orchestrator: this ticket is P1 and touches secrets handling (High tier). Workspace rule §8 lists PLAN approval as a human gate for P1/High tickets, while the project CLAUDE.md says no gate between PLAN and IMPLEMENT. The orchestrator should resolve which applies; the PR is High-tier either way (Ming reviews).

## Blocking questions
None. (Registration and credentials are a human step for the live run only; they do not block implementation against synthetic fixtures.)

## Split proposal
None. Estimated ~300 lines of product code plus tests, fixtures and docs; one feature (one new `PriceSource` + selection).
