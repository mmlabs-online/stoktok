Status: READY

# Plan — STK-005: End-of-day price adapter and sync job (slice 1 of 2: source, normalisation, upsert, job, CLI)

> **Scope note.** The full ticket is about 1,800 changed lines because the worker has no db dependency, no test runner and no env loading yet. This plan covers **slice 1** (AC1, AC2, AC3, AC5, AC6). **AC4 (gap detection → `data_gaps`) is slice 2.** See `## Split proposal`, which also gives a file and test outline for slice 2.

## Spec summary
- §2.2: "Public sources … are **unofficial and can change or break without notice**. Check each source's license and terms for personal use." / "Every price carries a `fetched_at` timestamp and a source." / "Gaps must be detected, not silently interpolated."
- §4.3: "One interface per data type (`PriceSource`, …); each implementation is swappable." / "Primary + fallback source per data type where possible." / "Every record stores `source` and `fetched_at`."
- §4.4: "EOD OHLCV sync | After market close"; "Gap detection | After each poll and at EOD" (slice 2).
- §5: "`prices_daily` | symbol, date, open, high, low, close, volume, foreign_net, source"; "`data_gaps` | symbol, from_ts, to_ts, detected_at" (slice 2).
- §7: "`worker` must tolerate restarts: jobs are idempotent and resume from last successful run."
- §9 Q4: "Primary and fallback data sources after license/terms check." **Answered by Ming (2026-10-24, ticket Notes):** the TCBS public API is the primary source. Ming accepts the risk. Keep volume low, use a descriptive User-Agent, no header spoofing, keep the `PriceSource` interface, and record the decision in an ADR. The fallback source comes later (SSI FastConnect / VNDirect).
- Ticket Notes: symbol scope is **watchlist ∪ currently held symbols**. Fixtures are synthetic and labelled "synthetic, verify against live". Units are guarded by tests and a plausibility check.
- CLAUDE.md R2 (integer VND, rounding defined in core), R3 (service key server-only), R4 (`source` + `fetched_at`), R5 (market rules are config), R7, R8.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | A `PriceSource` interface (daily OHLCV for a symbol and date range) with one concrete implementation; adding a second source requires no change to callers. | `apps/worker/src/sources/price-source.ts` defines the interface. `TcbsPriceSource implements PriceSource`. `runEodSync` takes `deps.source: PriceSource` and never imports `tcbs.ts`; only `cli.ts` constructs it (`grep -n "tcbs" apps/worker/src/jobs` returns nothing). Test `eod-sync.test.ts › works with any PriceSource (fake source, name stamped as source)`. |
| 2 | A worker job syncs daily prices for all watchlist symbols (**read as watchlist ∪ held**, per Ming), upserting `prices_daily` idempotently with `source` and `fetched_at` (R4). | `eod-sync.test.ts › syncs watchlist ∪ held symbols, deduped and sorted`; `› re-run with same source data leaves rows identical except fetched_at and row count unchanged`; `› every row carries source and the run's fetched_at`. `prices-daily.test.ts › upsertPricesDaily uses onConflict symbol,trade_date, dedupes keys, chunks at 500`. "Changes nothing" means no new rows and identical OHLCV/volume/source. `fetched_at` is refreshed to the latest fetch (see Assumptions A3). |
| 3 | Prices are converted to integer VND at the adapter boundary (R2); invalid or missing fields are rejected, not stored. | `daily-bar.test.ts` (core): thousand-VND → VND conversion, sub-VND precision rejected, missing/NaN/negative/non-number fields rejected, low>high and open/close outside [low,high] rejected, price outside plausibility band rejected, price not a multiple of the price step rejected, close vs last stored close beyond the jump ratio rejected. `tcbs.test.ts › maps synthetic fixture to integer VND bars`; `› malformed bars are returned as rejections, valid ones kept`. `eod-sync.test.ts › rejected bars are counted and never upserted`. |
| 4 | Missing trading days → `data_gaps`; weekends not gaps; configurable holidays. | **Slice 2 (not this plan).** Slice 1 only prepares for it: holidays are read from `settings.holidays` and drive the target date and fetch window. |
| 5 | Unit tests use recorded fixtures / mocked HTTP only — no live network. | Fixtures in `apps/worker/test/fixtures/tcbs/` with a README saying **"synthetic, not recorded; verify against live"** (the ticket allows this). The adapter takes an injected `fetchImpl`. `apps/worker/test/no-network.ts` (vitest `setupFiles`) replaces `globalThis.fetch` with a function that throws. Test `tcbs.test.ts › global fetch is blocked in tests`. `pnpm --filter @stoktok/worker test` passes offline. |
| 6 | The job can be run once manually via a documented `pnpm` script; cron wiring is minimal and documented. | `pnpm worker:eod` (root) → `pnpm --filter @stoktok/worker run job eod-prices`; `--dry-run` supported. `apps/worker/README.md` documents the command, env, first-run unit check with `--dry-run`, and crontab lines. `cli.test.ts › parses job name and --dry-run; unknown job exits 2`. |

Checks (R8): `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all green. `pnpm check:service-key` still passes.

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/calendar.ts` | Add `subtractTradingDays(date, n, holidays)`, the trading day n trading days before `date` (n = 0 returns `date`). | Fetch window start (lookback in trading days, R5). |
| `packages/core/src/calendar.test.ts` | Tests for `subtractTradingDays`. | R8 |
| `packages/core/src/market/config.ts` (new) | `DEFAULT_PRICE_SANITY = { minPriceVnd: 100, maxPriceVnd: 10_000_000, priceStepVnd: 10, maxCloseJumpRatio: 5 }`, with a doc comment on why each bound exists (unit guard). | R5: plausibility bounds are market config, defined once. |
| `packages/core/src/market/daily-bar.ts` (new) | Types `PriceUnit = 'VND' \| 'THOUSAND_VND'`, `RawDailyBar` (all fields `unknown`), `DailyBar` (`symbol, tradeDate, open, high, low, close, volume, foreignNet: number \| null`). `toVnd(value, unit)` and `normalizeDailyBar(symbol, raw, unit, sanity, lastClose?)` → `{ ok: true, bar } \| { ok: false, reason }`. | AC3 / R2: conversion and rounding defined once in core. The adapter calls it at its boundary. |
| `packages/core/src/market/daily-bar.test.ts` (new) | See Tests. | R8 / AC3 |
| `packages/core/src/index.ts` | Export `subtractTradingDays`, `DEFAULT_PRICE_SANITY`, `normalizeDailyBar`, `toVnd` and the types. | Public API used by the worker. |
| `packages/db/src/repos/prices-daily.ts` | Add `upsertPricesDaily(db, rows: DailyPriceInsert[], { chunkSize = 500 }): Promise<number>`. It dedupes by (symbol, trade_date) keeping the last, makes sequential chunked `upsert(…, { onConflict: 'symbol,trade_date' })` calls without `.select()`, checks `res.error` through `unwrap`'s error mapping, and returns the count sent. | AC2 |
| `packages/db/src/rows.ts` | Add `PriceDailyInsert` row type (`symbol, trade_date, open, high, low, close, volume, foreign_net, source, fetched_at`). | Typed upsert payload. |
| `packages/db/src/repos/prices-daily.test.ts` | Upsert tests (see Tests). | R8 |
| `packages/db/src/holdings.ts` (new) | `listHeldSymbols(db, asOf): Promise<Result<string[]>>`. Reads `listTransactions`, `listCorporateActions` and `getEntrySettings` (not `getSettings`, so an unset fee rate never throws, same as the dashboard), then calls core `buildLedger` and returns symbols with `quantity > 0`. | Ming's scope answer (held symbols). Reuses the ledger, no calculation outside core (R1). |
| `packages/db/src/holdings.test.ts` (new) | Tests (see Tests). | R8 |
| `packages/db/src/index.ts` | Export `upsertPricesDaily`, `listHeldSymbols`. | Worker imports via `@stoktok/db`. |
| `apps/worker/package.json` | Add deps `@stoktok/db: workspace:*` and `@supabase/supabase-js` (same range as packages/db, since the bundle keeps it external), devDep `vitest` (same range as packages/db). Scripts: `"test": "vitest run"`, `"job": "node --env-file-if-exists=.env.local --import tsx src/cli.ts"`, `"start:job": "node dist/cli.js"`. | Worker needs the db layer, a test runner and env loading (no dotenv; Node ≥22 flag). |
| `apps/worker/tsup.config.ts` | `entry: ['src/index.ts', 'src/cli.ts']`, `noExternal: ['@stoktok/core', '@stoktok/db']`. | `@stoktok/db` exports TS source, so it must be bundled. |
| `apps/worker/tsconfig.json` | `include` adds `test` and `vitest.config.ts`. | Typecheck the test setup. |
| `apps/worker/vitest.config.ts` (new) | `include: ['src/**/*.test.ts']`, `environment: 'node'`, `setupFiles: ['test/no-network.ts']`. | AC5 |
| `apps/worker/test/no-network.ts` (new) | `globalThis.fetch = () => { throw new Error('live network is forbidden in tests') }` (via `vi.stubGlobal`). | AC5 guard |
| `apps/worker/test/fixtures/tcbs/bars-ok.json`, `bars-empty.json`, `bars-malformed.json`, `README.md` (new) | Synthetic responses in the shape recalled for `bars-long-term` (`{ ticker, data: [{ open, high, low, close, volume, tradingDate }] }`). Prices in VND (e.g. VNM ~ 61,500). The README says: **"SYNTHETIC — hand-written from the recalled shape, not recorded. Verify against a live response (curl command given) before trusting; replace with a recorded capture when possible."** | AC5, honest labelling (ticket Notes) |
| `apps/worker/src/config.ts` (new) | `EOD_SYNC_CONFIG = { lookbackTradingDays: 20, requestDelayMs: 1000, timeoutMs: 15_000, maxAttempts: 3, backoffBaseMs: 1000, maxConsecutiveFailures: 5, upsertChunkSize: 500 }` and `TCBS_CONFIG = { baseUrl: 'https://apipubaws.tcbs.com.vn', userAgent: 'stoktok/0.1 (personal portfolio tracker; low-volume end-of-day sync)' }`. | R5: lookback, delays and retries are config, not literals in code. |
| `apps/worker/src/sources/price-source.ts` (new) | `interface PriceSource { readonly name: string; fetchDaily(symbol, fromDate, toDate, ctx: { lastClose?: number }): Promise<{ bars: DailyBar[]; rejected: { tradeDate?: string; reason: string }[] }> }` and `class SourceError extends Error { retryable; status? }`. | AC1 |
| `apps/worker/src/sources/http.ts` (new) | `getJson(fetchImpl, url, { timeoutMs, maxAttempts, backoffBaseMs, userAgent, sleep, log })`. Uses `AbortSignal.timeout`. Retries network errors, 429 and 5xx with exponential backoff and logs each retry. Other 4xx fail at once. Throws `SourceError`. Sends only `User-Agent` and `Accept: application/json`. | Low-volume polite client (Ming's constraint) |
| `apps/worker/src/sources/http.test.ts` (new) | Tests (see Tests). | R8 |
| `apps/worker/src/sources/tcbs.ts` (new) | `TcbsPriceSource` (`name = 'tcbs-public'`, `const TCBS_PRICE_UNIT: PriceUnit = 'VND'` marked UNVERIFIED with a pointer to the ADR). Builds `/stock-insight/v1/stock/bars-long-term?ticker=&type=stock&resolution=D&from=<unix s>&to=<unix s>`. Validates the envelope (`data` must be an array, otherwise `SourceError` non-retryable "unexpected shape"). Maps `tradingDate` with `vnDateOf(new Date(x))`, drops bars outside [from, to], and calls core `normalizeDailyBar` for each bar. | AC1, AC3 (conversion at the adapter boundary) |
| `apps/worker/src/sources/tcbs.test.ts` (new) | Tests (see Tests). | AC3, AC5 |
| `apps/worker/src/jobs/eod-sync.ts` (new) | `runEodSync(deps): Promise<EodSummary>`, where deps = `{ store: EodStore, source: PriceSource, now: Date, config, sleep, log, dryRun }`. Also `interface EodStore { getHolidays; listWatchlistSymbols; listHeldSymbols(asOf); getLatestCloses(symbols); upsertPricesDaily(rows) }`. | AC2 orchestration, tested without supabase |
| `apps/worker/src/jobs/eod-sync.test.ts` (new) | In-memory `EodStore` + fake `PriceSource` (see Tests). | AC1, AC2, AC3 |
| `apps/worker/src/store.ts` (new) | `createDbEodStore(db: Db): EodStore`. Pure wiring to `@stoktok/db` (`getEntrySettings().settings.holidays`, `listWatchlist`, `listHeldSymbols`, `getLatestCloses`, `upsertPricesDaily`). | Keeps the job independent of supabase (R3: worker is server-side) |
| `apps/worker/src/cli.ts` (new) | `parseArgs(argv)` → `{ job: 'eod-prices', dryRun }` or a usage error. `main()` builds `createServiceClient(process.env)`, `TcbsPriceSource({ fetchImpl: fetch, … })` and `new Date()`, runs the job, prints a one-line JSON summary, and sets the exit code (0 ok, 1 partial/failed run, 2 usage). | AC6 |
| `apps/worker/src/cli.test.ts` (new) | `parseArgs` tests. | AC6 |
| `package.json` (root) | Script `"worker:eod": "pnpm --filter @stoktok/worker run job eod-prices"`. | AC6 documented script |
| `apps/worker/README.md` (new) | How to run (`pnpm worker:eod`, `-- --dry-run`), env (`apps/worker/.env.local` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), **first live run: `--dry-run` and check that closes look like VND (e.g. VNM tens of thousands, not tens)**, crontab lines, TZ, holiday-list maintenance, what an exit code means. | AC6 |
| `docs/adr/0001-eod-price-source.md` (new) | ADR: context (§9 Q4), options table (from the data-engineer consult), decision (TCBS public, primary), **who accepted the risk: Ming, 2026-10-24**, terms-check evidence (could not reach VN hosts from the sandbox on 2026-10-24; no published terms found; vnstock licence verified), constraints (tens of requests per day, descriptive UA, no spoofing), UNVERIFIED items (units, raw vs adjusted, date encoding), and the swap path (SSI FastConnect / VNDirect via `PriceSource`). | Ming's instruction in the ticket Notes |

No migration. No change to `.env.example`: the keys the worker needs (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are already listed.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| calendar.test.ts › subtractTradingDays: n=0 returns date; Mon −1 → Fri; skips holidays; across a Tết block; rejects negative/non-integer n | Window start |
| daily-bar.test.ts › toVnd: VND integer kept; THOUSAND_VND 61.5 → 61500; 61.55 → 61550 (float-safe); 61.5555 rejected (sub-VND); non-finite/string/null rejected | AC3 / R2 |
| daily-bar.test.ts › normalizeDailyBar: valid bar → integer VND DailyBar, foreignNet null | AC3 |
| daily-bar.test.ts › rejects missing field, negative price, negative/non-integer volume, invalid tradeDate | AC3 |
| daily-bar.test.ts › rejects low > high, open outside [low,high], close outside [low,high] (mirrors DB CHECK) | AC3 |
| daily-bar.test.ts › unit guard: VND-unit close 61.5 rejected (not integer); close 61 rejected (< minPriceVnd); close 61,500,000 rejected (> maxPriceVnd); close 61,505 rejected (not multiple of priceStepVnd) | AC3 unit guard |
| daily-bar.test.ts › jump guard: lastClose 61,500 and close 61,500,000 or 62 rejected; close 30,750 (2:1 split) accepted; no lastClose → skipped | AC3 unit guard |
| prices-daily.test.ts › upsertPricesDaily sends onConflict 'symbol,trade_date' and rows with source and fetched_at | AC2 / R4 |
| prices-daily.test.ts › 1200 rows → 3 sequential upsert calls (500, 500, 200) | AC2 |
| prices-daily.test.ts › duplicate (symbol, trade_date) in input → last kept, one row sent | AC2 |
| prices-daily.test.ts › empty input → no call, returns 0 | AC2 |
| prices-daily.test.ts › error 23514 → DataError VALIDATION; other error → DB_ERROR; `data: null` with no error is success | AC2 |
| holdings.test.ts › returns symbols with quantity > 0 (sold-out symbol excluded) | Scope |
| holdings.test.ts › fee rate NULL does not throw (uses getEntrySettings) | Scope |
| holdings.test.ts › ledger error returned as `{ ok: false }` | Scope |
| http.test.ts › 200 → parsed JSON; sends User-Agent, no other spoofed headers | Ming's constraint |
| http.test.ts › 503 then 200 → retried once with backoff (injected sleep records 1000 ms) | Retries |
| http.test.ts › 429 ×3 → SourceError retryable after maxAttempts | Retries |
| http.test.ts › 404 → SourceError, no retry | Retries |
| http.test.ts › network error (fetchImpl throws) → retried | Retries |
| tcbs.test.ts › builds URL with ticker, resolution=D and from/to unix seconds for VN-midnight bounds | AC1 |
| tcbs.test.ts › maps synthetic bars-ok.json to integer VND bars with tradeDate 'YYYY-MM-DD' (both `…T00:00:00Z` and `…T17:00:00Z` (prev day) encodings map to the VN date) | AC3 |
| tcbs.test.ts › bars-malformed.json → bad bars in `rejected` with reasons, good bars kept | AC3 |
| tcbs.test.ts › bars-empty.json → zero bars, no error | AC1 |
| tcbs.test.ts › envelope without `data` array → non-retryable SourceError | AC3 |
| tcbs.test.ts › bars outside requested range dropped | AC1 |
| tcbs.test.ts › global fetch is blocked in tests (calling `fetch` throws) | AC5 |
| eod-sync.test.ts › target date equals core `expectedPriceDate(now, holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN)` (before and after the 18:00 cutoff; holiday from store respected) and fromDate = `subtractTradingDays(target, lookback − 1, holidays)` | Agreement with dashboard, R5 |
| eod-sync.test.ts › syncs watchlist ∪ held symbols, deduped, normalised and sorted; invalid symbol skipped with a warning | AC2 / scope |
| eod-sync.test.ts › every row carries source = source.name and the run's fetched_at (now.toISOString()) | AC2 / R4 |
| eod-sync.test.ts › re-run with same source data leaves rows identical except fetched_at and row count unchanged | AC2 idempotency |
| eod-sync.test.ts › works with any PriceSource (fake source with a different name) | AC1 |
| eod-sync.test.ts › rejected bars are counted in the summary and never upserted | AC3 |
| eod-sync.test.ts › lastClose from getLatestCloses passed to the source | AC3 jump guard |
| eod-sync.test.ts › source error for one symbol does not stop the others; summary.failedSymbols lists it; summary.ok false | Robustness |
| eod-sync.test.ts › stops after maxConsecutiveFailures (circuit breaker), remaining symbols reported as skipped | Robustness |
| eod-sync.test.ts › ledger error → continues with watchlist only, summary.ledgerError set, ok false | Scope |
| eod-sync.test.ts › dryRun → no upsert call, summary still counts bars | AC6 |
| eod-sync.test.ts › sleeps requestDelayMs between symbols (injected sleep) | Low volume |
| cli.test.ts › parseArgs: `eod-prices` → dryRun false; `eod-prices --dry-run` → true; unknown job / no job → usage error | AC6 |

## Approach
1. **Core (R1/R2/R5, R8).** Add `subtractTradingDays` to `calendar.ts`. Create `market/config.ts` and `market/daily-bar.ts`.
   - `toVnd(value, unit)`: requires `typeof value === 'number' && Number.isFinite(value)`. For `VND` it requires `Number.isSafeInteger`. For `THOUSAND_VND` it computes `n = value * 1000`, `r = Math.round(n)`, rejects if `Math.abs(n − r) > 1e-6` (sub-VND) or `r` is not a safe integer, and returns `r`.
   - `normalizeDailyBar`, in order: valid `tradeDate` (`isValidDate`); OHLC via `toVnd`; volume is a safe integer ≥ 0; `low ≤ high` and open/close in [low, high]; every price in [`minPriceVnd`, `maxPriceVnd`] and a multiple of `priceStepVnd`; if `lastClose` is given, `max(close/lastClose, lastClose/close) ≤ maxCloseJumpRatio`. It returns a reason code string on failure and never throws.
2. **db repos.**
   - `upsertPricesDaily`: dedupe via a `Map` keyed `symbol|trade_date`, chunk, `for … of` sequential awaits. On `res.error`, call `unwrap(res, ctx)` to throw the mapped DataError.
   - `listHeldSymbols`: same reads as `loadDashboard` (`getEntrySettings`), then `buildLedger(..., asOf)` and a filter on `quantity > 0`.
   - No change to `fake-client.ts` (it already has `upsert`).
3. **Worker scaffolding.** Add deps, scripts, the vitest config with the no-network setup, and the tsup entries. Env comes from `node --env-file-if-exists=.env.local` (Node ≥ 22, `engines` already says so). `createServiceClient(process.env)` is only called in `cli.ts` (R3; the worker is server-side and the key never reaches web bundles).
4. **Source layer.** Add `price-source.ts`, then `http.ts`, then `tcbs.ts`. The unit is declared in **one** constant, `TCBS_PRICE_UNIT`, and the adapter converts through core `normalizeDailyBar` (AC3 "at the adapter boundary"). Units, the date encoding and raw vs adjusted are marked UNVERIFIED in a doc comment and in the ADR. If the live data turns out to be thousand VND or adjusted, the dry-run check and the guards (step 1) reject the bars instead of storing wrong values.
5. **Job `runEodSync`.**
   - (a) `holidays = store.getHolidays()`, `target = expectedPriceDate(now, holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN)` (the **same constant and settings source as `loadDashboard`**, so "fresh" agrees) and `from = subtractTradingDays(target, lookbackTradingDays − 1, holidays)`.
   - (b) symbols = `normalizeSymbol` over watchlist ∪ held (`asOf = vnDateOf(now)`), deduped and sorted. A ledger error means watchlist only, and the run is flagged.
   - (c) `lastCloses = store.getLatestCloses(symbols)`.
   - (d) Per symbol, sequentially: `sleep(requestDelayMs)` between requests, then `source.fetchDaily(symbol, from, target, { lastClose })` inside try/catch. Count bars and rejections. Track consecutive failures and stop at `maxConsecutiveFailures`.
   - (e) Map bars to rows with `source = source.name` and `fetched_at = now.toISOString()` (one stamp per run, R4).
   - (f) Unless `dryRun`, make one `store.upsertPricesDaily(rows)` call.
   - (g) Return `EodSummary { ok, dryRun, source, fetchedAt, targetDate, fromDate, symbols, rowsUpserted, rejected, rejectedBySymbol, failedSymbols, skippedSymbols, symbolsWithoutBars, ledgerError? }`.
   - Logging goes through injected `log` and never prints env values.
6. **CLI + scripts + docs.** `cli.ts` prints `JSON.stringify(summary)` and sets the exit code from `summary.ok`. Add the root `worker:eod` script. In the README, cron is documented only (no scheduler code, R7). The lines are `TZ=Asia/Ho_Chi_Minh` with `30 18 * * 1-5 cd <repo> && pnpm worker:eod` and a catch-up run `0 21 * * 1-5`, plus the container form `docker compose run --rm worker node dist/cli.js eod-prices` (compose itself belongs to STK-017/018). The cron runs after the 18:00 cutoff so the target is today. A run on a non-trading day or before the cutoff just re-syncs up to the previous trading day, which is harmless.
7. **ADR** `docs/adr/0001-eod-price-source.md` as described in the file table.
8. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm check:service-key`.

Rules: R1 (all conversion, validation and date arithmetic in core; the job only orchestrates), R2 (`toVnd` is the only conversion; rows are integers), R3 (service key only in `cli.ts` via `createServiceClient(process.env)`), R4 (`source` + `fetched_at` on every row; stale-data and gap handling are slice 2 / later signal tickets), R5 (sanity bounds in core config, lookback/delays/retries in worker config, holidays from `settings.holidays`, cutoff from the core constant shared with the dashboard), R6 suspended (CLI only, no route), R7 (no migration, no scheduler, no fallback source, no gaps in this slice), R8 (tests listed above), R10 (read-only market data; no brokerage login, no orders).

## Specialist input used
- **data-engineer**
  - Adopted:
    - #4 `PriceSource` contract with `readonly name`; the job stamps a single `fetched_at`.
    - #5 unit constant per adapter, `Math.round` + safe-integer check, plausibility band and jump check. I set the jump ratio to 5× the last stored close instead of "3× the exchange limit" because `prices_daily` has no exchange column.
    - #6 store raw; the adapter states it (UNVERIFIED).
    - #7 union of watchlist and held (Ming confirmed).
    - #9 option (a) refresh `fetched_at`.
    - #11 config for lookback and delays; holidays from settings.
    - #12 injected `fetchImpl` plus a global-fetch guard, honestly labelled synthetic fixtures.
    - #13 CLI with `--dry-run` and a JSON summary; `--env-file` instead of dotenv.
    - #14 cron documented only, plus a catch-up run.
    - #15 sequential requests with a delay, timeout, retry on network/429/5xx, circuit breaker, descriptive UA.
    - #16 source id `tcbs-public`.
    - #17 ADR.
  - Changed:
    - #8: always fetch the whole lookback window (one request per symbol either way). This is simpler than "latest+1 with overlap", and it re-picks late corrections.
    - #11: the cutoff is not a new worker setting. It reuses core `DEFAULT_PRICE_CUTOFF_MINUTES_VN` (18:00) so it agrees with the dashboard. Cron is at 18:30, not 16:30.
    - #15: `Retry-After` handling is deferred (follow-up).
  - Rejected:
    - #1/#2 SSI as primary: Ming chose TCBS.
    - #13 migration for a unique gap index: slice 2, app-side.
- **database-optimizer**
  - Adopted:
    - #1 upsert `onConflict: 'symbol,trade_date'`, no `.select()`, `data: null` is success, refresh `fetched_at`, dedupe the batch to avoid 21000, validate before writing.
    - #2 chunks of 500, sequential.
    - #4 repo shape and fake-client tests for the upsert.
    - #5 `getLatestCloses` reused for the jump guard.
  - Deferred to slice 2: #3 per-day gap rows with epoch-ms key comparison, `listPriceDates`, `listOpenGaps`/`recordGaps`/`resolveGaps`, and adding `is`/`in` to the fake client.
  - Follow-up: the partial unique index and the single-run lock.

## Assumptions
- **A1. Scope.** "All watchlist symbols" in AC2 is read as watchlist ∪ held symbols (Ming, 2026-10-24).
- **A2. TCBS response shape, units and date encoding** are UNVERIFIED (the sandbox cannot reach VN hosts). The implementation follows the recalled shape: `{ ticker, data: [{ open, high, low, close, volume, tradingDate }] }`, prices in VND, raw. Guards reject rather than store if this is wrong. The README requires a `--dry-run` check before the first write.
- **A3. "Re-running the same day changes nothing"** means: no new rows, identical OHLCV/volume/source. `fetched_at` is refreshed to the latest fetch, as both consults recommend.
- **A4. Fetch window** is 20 trading days ending at the target date (config). A deeper historical backfill (e.g. for 200-day MAs in STK-015) is a follow-up (`--from` flag).
- **A5. `foreign_net`** is stored as `null` (not in the TCBS bars response as recalled).
- **A6. Holidays** come from `settings.holidays` (STK-019 will provide real data). An incomplete list only shifts the target and window dates; it cannot corrupt prices.
- **A7. The cutoff stays at 18:00** (`DEFAULT_PRICE_CUTOFF_MINUTES_VN`). STK-009 said to revisit it when STK-005 fixes the sync time. Cron at 18:30 is consistent with it, so no change.
- **A8. Concurrency.** A cron run overlapping a manual run is harmless for `prices_daily` (idempotent upsert). A single-run lock is a follow-up.

## Blocking questions
None. The source and the symbol scope are answered in the ticket Notes.

## Split proposal
The full ticket is about 1,800 changed lines (mostly tests and worker scaffolding), far over one cycle.

**Slice 1 (this plan), STK-005:** AC1, AC2, AC3, AC5, AC6. It covers the source interface, the TCBS adapter, unit normalisation in core, the upsert repo, held symbols, the job, the CLI, the docs and the ADR. Estimate: ~1,150 lines, of which ~55% are tests, fixtures and docs.

**Slice 2 (new ticket, e.g. "STK-005b: EOD gap detection into data_gaps"): AC4.** Outline so it can be planned quickly:
- core `calendar.ts`: `tradingDaysBetween(from, to, holidays)` and `vnDayBoundsUtc(date)` → `{ fromTs: 'YYYY-MM-DDT00:00:00+07:00', toTs: '…T23:59:59.999+07:00' }`.
- core `market/gaps.ts`: `planPriceGaps({ window, holidays, storedDates, openGaps })` → `{ toInsert: dates[], toResolveIds: [] }`. Window start = max(fetch window start, first stored date). A symbol with no stored data produces no gaps and is reported. Keys are compared by epoch ms. One row per missing trading day.
- db: `listPriceDates(db, symbol, from, to)` (fetchAll), new `repos/data-gaps.ts` with `listOpenGaps(db, dataType)`, `insertGaps(db, gaps)` (chunks of 200) and `resolveGaps(db, ids, resolvedAt)` (`in('id', …)`, `is('resolved_at', null)`), plus `is`/`in` in `fake-client.ts` `METHODS`.
- worker: a gap step in `runEodSync` after the upsert (skipped in dry-run); `data_type = 'prices_daily'`, `source = source.name`, `fetched_at = run time`; summary fields `gapsOpened`/`gapsResolved`.
- tests: weekend not a gap, holiday not a gap, a Friday–Tuesday run with Monday missing → one gap, a re-run inserts zero, a `+00:00` vs `+07:00` string still matches, arrival of data resolves the gap.
- No migration (app-side dedupe; partial unique index is a follow-up).

**Follow-ups (not in either slice, R7):** partial unique index on `data_gaps (symbol, data_type, from_ts) where resolved_at is null` + single-run lock; `Retry-After` support; env overrides for `EOD_SYNC_CONFIG`; historical backfill flag; fallback source (SSI FastConnect / VNDirect) once Ming registers; market-wide (`symbol = NULL`) gaps (STK-021); replacing synthetic fixtures with recorded captures; adjusted-series decision for signals (STK-015).
