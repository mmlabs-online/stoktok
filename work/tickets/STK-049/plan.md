Status: READY

# Plan — STK-049: Intraday prices while the app is open (30 s refresh + "Làm mới")

> **This plan covers slice 1 of 3 only** (see `## Split proposal`): the intraday **source adapter, storage and session rule**, plus the go/no-go live check Ming runs from the home server. Slice 1 adds no UI, and nothing calls the price source at runtime. Slices 2 and 3 become new tickets, which the orchestrator creates when this one is DONE.
>
> **Planner defaults for Ming to confirm in the PR.** The consults disagreed on several points. The defaults chosen are listed under `## Specialist input used` → "Disagreements resolved". None of them blocks slice 1.

## Spec summary
- docs/spec-v1.md §10 Roadmap: "| **v1.1** | Intraday polling, short-term signals, gap detection |"
- §2.1: "| Trading sessions | Morning + afternoon continuous, ATO/ATC auctions | Intraday polling only during sessions |"
- §2.2: "Intraday data may be delayed. Every price carries a `fetched_at` timestamp and a source."
- §5: "| `prices_intraday` | symbol, ts, price, volume, source, fetched_at |"
- §1.3 non-goal: "No guaranteed real-time data" (as quoted in the ticket).
- §4.3: "One interface per data type (`PriceSource`, …); each implementation is swappable." "Every record stores `source` and `fetched_at`."
- CLAUDE.md: R2 (integer VND), R3 (service role server-only; browser never talks to the DB), R4 (`source` + `fetched_at` on every market-data record), R5 (market rules are configuration), R8.
- Ticket decision (Ming, 2026-11-05): "giữ các cronjob cũ khi user k mở app, còn user mở app thì reload sau mỗi 30s, và thêm 1 nút cho user refresh ngay". The fetching is done on demand by the **web server**, for watchlist + held symbols.

**Spec conflicts.** These are recorded in ADR 0006 and listed as follow-ups. The spec is not edited in this ticket.
- §4.4 "Intraday price poll (watchlist only) | Every few minutes during trading sessions" and §4.1 (the `worker` service does "price polling") versus Ming's decision: web server, on demand, every 30 s, watchlist + held.
- §7 "gaps are recorded in `data_gaps`" versus the planner default: no `data_gaps` rows for intraday in v1 (see the defaults).

## Acceptance criteria → verification
Ticket ACs are split across the three slices. Only the slice 1 rows are verified in this ticket; the other rows are carried forward to the slice tickets.

| # | Criterion (ticket AC → slice 1 part) | How the reviewer verifies it |
|---|---|---|
| 1a | AC1 — `prices_intraday` exists through a new migration with columns symbol, ts, price, volume, source, fetched_at. RLS is on, and grants go to `service_role` only. `source` and `fetched_at` are not null (R4). Prices are integer and volume is bigint (R2). | Read `supabase/migrations/20261105000200_prices_intraday.sql` and the rollback. `pnpm db:check` passes with the new assertions in `scripts/db-check/checks.sql` (tables_exist, column types, source/fetched_at not null, service_role read/write/upsert, bad-row rejects, anon/authenticated denial). If no local Postgres is available, the reviewer records that and reviews the SQL by reading. |
| 1b | AC1 — the configured price source (R5) is fetched for a list of symbols by a server-only adapter that no browser code can import (R3). | `packages/sources/src/vci-intraday.test.ts` (fixture-based) passes. `packages/db/src/r3-guard.test.ts` › "no file containing 'use client' imports @stoktok/db, server/db or @stoktok/sources" passes. Every endpoint, path, User-Agent and tuning value comes from `VCI_INTRADAY_CONFIG` (no literals in the adapter body). |
| 1c | AC1 — each fetched price is stored with `source` and `fetched_at`, as integer VND. | `packages/db/src/repos/prices-intraday.test.ts` › upsert sends `source` + `fetched_at` with `onConflict: 'symbol,ts'`. `packages/core/src/market/intraday.test.ts` › quote reduction rejects non-integer, off-step and out-of-band prices. |
| 3a | AC3 — "outside trading sessions (weekends, holidays, outside session hours — all configuration)" is a pure core rule. | `packages/core/src/market/intraday.test.ts` › `isInIntradayWindow` table test (weekend, holiday, 08:59/09:00/11:29/11:30/12:59/13:00/14:59/15:00/15:02/15:03, UTC-instant input). Holidays are a parameter, and the windows are a `DEFAULT_INTRADAY_CONFIG` value. |
| 5 | AC5 — the scheduled EOD jobs are unchanged. | `git diff` shows no change to `apps/worker/src/jobs/**`, `vci.ts`, `tcbs.ts` or `select-price-source.ts`. The only worker source edits are the `http.ts` and `price-source.ts` re-export shims. All existing worker tests pass unmodified, apart from the `http.test.ts` move. |
| 6a | AC6 — unit tests for the session rule in core; `typecheck`, `lint` and `test` are green. | `pnpm typecheck && pnpm lint && pnpm test` passes at the repo root. |
| G | Go/no-go live check (not a ticket AC; it gates slice 2). | `work/tickets/STK-049/record-vci-intraday-samples.sh` exists and uses honest headers only. `packages/sources/src/vci-intraday.samples.test.ts` is skipped when `work/tickets/STK-049/live-samples/` has no gap-chart files and runs when they exist. ADR 0006 contains the checklist. |
| — | Carried forward. AC2 (throttle), AC1 web-server wiring, AC3 "no source call / last stored price shown", AC4 (refresh UI) and the rest of AC6. | Slices 2 and 3. Not verified here. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/sources/package.json` | Create `@stoktok/sources`. Mirror `packages/db/package.json`: exports `./src/index.ts`, deps `@stoktok/core`, devDeps `@types/node` and `vitest`, scripts typecheck/lint/test. | Gives web (slice 2) and worker a shared place for I/O adapters. Web must not import `apps/worker`. |
| `packages/sources/tsconfig.json`, `packages/sources/vitest.config.ts` | Create; copy from `packages/db`. | Package build and test setup. |
| `packages/sources/src/index.ts` | Create; export `getJson`, `postJson`, `GetJsonOptions`, `SourceError`, `VciIntradaySource`, `IntradaySource`, `IntradayFetchResult` and `VCI_INTRADAY_CONFIG`. | Public surface of the package. |
| `packages/sources/src/http.ts` | **Move** `apps/worker/src/sources/http.ts` here unchanged (only the `SourceError` import path changes). | Shared polite HTTP client. It must not be duplicated (data-engineer A). |
| `packages/sources/src/source-error.ts` | **Move** the `SourceError` class out of `apps/worker/src/sources/price-source.ts`, unchanged. | Shared error type. Keeping the same class keeps `instanceof` working in the worker. |
| `packages/sources/src/http.test.ts` | **Move** `apps/worker/src/sources/http.test.ts`; only the import paths change. | The tests follow the code. |
| `packages/sources/src/config.ts` | Create `VCI_INTRADAY_CONFIG`: `sourceName: 'vci-public'`, `baseUrl`, `chartPath: '/chart/OHLCChart/gap-chart'`, `timeFrame: 'ONE_MINUTE'`, `countBack: 360`, `maxSymbolsPerRequest: 50`, `timeoutMs: 5000`, `maxAttempts: 1`, `backoffBaseMs: 0`, and the honest `userAgent` `'stoktok/0.1 (personal portfolio tracker; intraday refresh while app open, max one batched request per 30 s)'`. Every value is commented UNVERIFIED where it applies. | R5. The web request path needs a tight time budget (architect finding 2). |
| `packages/sources/src/vci-intraday.ts` | Create `IntradaySource` and `VciIntradaySource.fetchLatest(symbols, ctx)` (see Approach §3). | AC1: the source adapter for the latest price. |
| `packages/sources/src/__fixtures__/vci-intraday.synthetic.json` | Create a **synthetic** columnar response for 3 symbols in the ADR 0004 shape. It includes yesterday's and today's minute bars, digit-string values and one symbol with zero bars. | The implementer builds against the fixture because the sandbox cannot reach VN hosts. |
| `packages/sources/src/vci-intraday.test.ts` | Create the fixture tests (see Tests). | AC1, R8. |
| `packages/sources/src/vci-intraday.samples.test.ts` | Create an opt-in test over the recorded samples, skipped when there are none (see Approach §6). | Makes the go/no-go mechanical once Ming records samples. |
| `apps/worker/src/sources/http.ts` | Replace the body with `export { getJson, postJson } from '@stoktok/sources'; export type { GetJsonOptions } from '@stoktok/sources';`. | Worker imports stay unchanged (AC5, R7: minimal move). |
| `apps/worker/src/sources/price-source.ts` | Delete the class body and add `export { SourceError } from '@stoktok/sources';`. The interfaces stay. | Same as above. |
| `apps/worker/package.json` | Add the dependency `"@stoktok/sources": "workspace:*"`. | The worker uses the moved code. |
| `apps/worker/tsup.config.ts` | Add `'@stoktok/sources'` to `noExternal`. | The worker bundle has to inline the workspace package, the same way it inlines core and db. |
| `apps/worker/Dockerfile`, `apps/web/Dockerfile` | Add `COPY packages/sources/package.json packages/sources/`. | `pnpm install --frozen-lockfile` needs every workspace manifest. |
| `pnpm-lock.yaml` | Regenerate with `pnpm install`. | New workspace importer. |
| `packages/core/src/market/intraday.ts` | Create `DEFAULT_INTRADAY_CONFIG`, `validateIntradayConfig`, `isInIntradayWindow`, `IntradayQuote`, `RawMinuteBar` and `intradayQuoteFromMinuteBars` (see Approach §2). | AC3 (session rule as configuration) and R2 (unit/sanity guard in core). |
| `packages/core/src/market/intraday.test.ts` | Create (see Tests). | AC6, R8. |
| `packages/core/src/index.ts` | Export the new symbols. | Package surface. |
| `supabase/migrations/20261105000200_prices_intraday.sql` | Create the table, comments, RLS, revoke and grants (see Approach §4). | AC1. |
| `supabase/rollback/20261105000200_prices_intraday.down.sql` | `drop table if exists public.prices_intraday;` | Repo rollback convention. |
| `scripts/db-check/checks.sql` | Add `prices_intraday` to `tables_exist`, the column-type asserts, `source_fetched_at_not_null`, `service_role_can_read_write_prices_intraday` and the `rejects_bad_rows` cases (DB consult §6, without `intraday_fetch_state`). | Otherwise `tables_exist` fails, and the new constraints need checks. |
| `packages/db/src/rows.ts` | Add `PriceIntradayRow` (selected columns; `volume: Int8`) and `PriceIntradayInsert`. | Typed repository. |
| `packages/db/src/mappers.ts` | Add `intradayQuoteFromRow`, following the existing `storedCloseFromRow` style. | Row → core type. |
| `packages/db/src/repos/prices-intraday.ts` | Create `upsertPricesIntraday(db, rows, {chunkSize})` and `getLatestIntraday(db, symbols)` (see Approach §5). | Storage for slice 2. |
| `packages/db/src/repos/prices-intraday.test.ts` | Create; uses `packages/db/test/fake-client`. | R8. |
| `packages/db/src/index.ts` | Export the new repo functions and types. | Package surface. |
| `packages/db/src/r3-guard.test.ts` | Extend the `'use client'` import guard regex to `/@stoktok\/db\|server\/db\|@stoktok\/sources/`. | R3: the source adapter must never reach a client bundle (architect B). |
| `docs/adr/0006-intraday-prices-on-demand.md` | Create (see Approach §7). | Records Ming's decision, the spec deviation, the unverified endpoint and the go/no-go checklist (architect K, data-engineer A). |
| `work/tickets/STK-049/record-vci-intraday-samples.sh` | Create Ming's live-check script (see Approach §6). | The go/no-go has to be run from the home server. |

Not touched: `apps/web/**` (slices 2 and 3), `apps/worker/src/jobs/**`, `apps/worker/src/sources/{vci,tcbs,select-price-source,*financials*}.ts`, `apps/worker/src/config.ts`, `docs/spec-v1.md`, `CLAUDE.md`.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `packages/core/src/market/intraday.test.ts` › isInIntradayWindow: weekday edges | 08:59 false, 09:00 true, 11:29 true, 11:30 false, 12:59 false, 13:00 true, 14:59 true, 15:00 true and 15:02 true (grace), 15:03 false. Inputs are UTC instants (e.g. `2026-11-05T02:00:00Z` = 09:00 VN). |
| … › isInIntradayWindow: weekend and holiday | Saturday and Sunday at 10:00 are false. A date in `holidays` at 10:00 is false. The day after the holiday is true. |
| … › isInIntradayWindow: custom config | A one-window config with grace 0 is respected, which proves the rule reads configuration and not literals (R5). |
| … › validateIntradayConfig | RangeError for an empty window list, from ≥ to, overlapping or unsorted windows, minutes outside 0..1440, negative grace, and non-positive `throttleMs`/`refreshIntervalMs`/`staleAfterMs`. `DEFAULT_INTRADAY_CONFIG` passes. |
| … › intradayQuoteFromMinuteBars: picks newest of today | Bars from yesterday and today are mixed and unordered. The result has `ts` = the max `t` of today (ISO), price = that bar's `c`, and volume = the sum of today's `v` only. `source` and `fetchedAt` are passed through. |
| … › intradayQuoteFromMinuteBars: rejects | `no_bars_today` (only yesterday's bars, or empty), `invalid_ts`, `invalid_price` (non-integer under the `VND` unit, NaN, missing), `price_out_of_band`, `price_off_step`, `close_jump` (against `lastClose`, using `maxCloseJumpRatio`), `invalid_volume` (negative, non-integer, or a sum that is not a safe integer). It never throws. |
| … › intradayQuoteFromMinuteBars: THOUSAND_VND unit | `61.5` with `THOUSAND_VND` becomes `61500` (reuses `toVnd`). |
| `packages/sources/src/vci-intraday.test.ts` › batches symbols in one POST | One `fetchImpl` call for 3 symbols. The body is `{timeFrame:'ONE_MINUTE', symbols:[…], to, countBack}` from config. Only User-Agent, Accept and Content-Type headers are sent. |
| … › chunks above maxSymbolsPerRequest | With `maxSymbolsPerRequest: 2` and 3 symbols, there are 2 sequential calls. |
| … › parses the synthetic fixture | Two quotes come back with integer VND prices, `source = 'vci-public'` and `fetchedAt = ctx.now`. The symbol with zero bars is in `rejected` with `no_bars_today`. |
| … › requested symbol absent from response | That symbol is `rejected: no_data` and the others still parse. |
| … › symbol not requested / duplicate symbol | An unrequested symbol throws `SourceError('symbol mismatch', false)`. A duplicate symbol item is rejected as `duplicate_symbol`. |
| … › shape errors | A non-array root, unequal column lengths, or missing `t`/`c`/`v` arrays throw a non-retryable `SourceError('unexpected response shape')`. An empty list gives every symbol `no_data`. |
| … › 403 is non-retryable, no bypass | A 403 becomes `SourceError` with status 403, `retryable: false`, a message citing ADR 0006, and exactly one fetch call (maxAttempts 1). |
| … › 429 / 5xx with maxAttempts 1 | One call; a retryable `SourceError` is thrown, so the slice 2 breaker can see the status. |
| … › lastCloses passed to core | A jump beyond the ratio is rejected as `close_jump`. |
| `packages/sources/src/vci-intraday.samples.test.ts` › recorded gap-chart samples parse | `describe.skipIf(no files)`. For each `gapchart-*.json`: every symbol in the request sidecar parses, and VNM is between 10 000 and 999 999 VND. `ts` is on the recording date (VN). The last bar is no older than 15 minutes before the recording time in the README. Volume is ≥ 0. |
| `packages/sources/src/http.test.ts` (moved) | Unchanged behaviour of `getJson` and `postJson`. |
| `packages/db/src/repos/prices-intraday.test.ts` › upsert | `onConflict: 'symbol,ts'`, a later duplicate in the input wins, chunked, no `.select()`. Rows carry `source` and `fetched_at`. An empty input makes no call. |
| … › getLatestIntraday | One query per symbol: `eq('symbol')`, `order('ts', desc)`, `limit(1)`, `maybeSingle`. A not-found symbol is omitted. Bigint volume as a string maps to a number. An empty input makes no call. |
| `packages/db/src/r3-guard.test.ts` › (extended) | A `'use client'` file importing `@stoktok/sources` would fail the guard. |
| `scripts/db-check/checks.sql` › new blocks | Run via `pnpm db:check` (see AC 1a). |

## Approach
1. **Package move (one separate commit, behaviour-neutral).** Create `packages/sources`. `git mv` `http.ts` and `http.test.ts`, extract `SourceError` into it, and leave re-export shims in the worker. Update the worker package.json, tsup, both Dockerfiles and the lockfile. Run the worker tests: they must pass unchanged. Commit as `STK-049: move http client and SourceError to @stoktok/sources`. This lets the reviewer check the move apart from the new code (architect C).

2. **Core `market/intraday.ts`** (pure; R1, R2, R5).
   - `interface SessionWindow { fromMinutesVn: number; toMinutesVn: number }`. A window is half-open, `[from, to)`.
   - `DEFAULT_INTRADAY_CONFIG = { sessions: [{ fromMinutesVn: 540, toMinutesVn: 690 }, { fromMinutesVn: 780, toMinutesVn: 900 }], postCloseGraceMinutes: 3, throttleMs: 30_000, refreshIntervalMs: 30_000, staleAfterMs: 90_000 }`. Write the minute values as `9 * 60` and so on for readability. The doc comment reads: one union window for HOSE/HNX/UPCoM (09:00–11:30, 13:00–15:00, covering HOSE ATC 14:30–14:45 and the HNX/UPCoM close at 15:00) plus a grace period to catch the last ATC print. **UNVERIFIED, verify before go-live**, the same stance as the CLAUDE.md market-rules table.
   - `throttleMs`, `refreshIntervalMs` and `staleAfterMs` are defined now so that slices 2 and 3 share one config object. They have no consumer in slice 1, and the validation tests cover them.
   - `isInIntradayWindow(now, holidays, config)`: `isTradingDay(vnDateOf(now), holidays)` and `vnMinutesOf(now)` must fall in some window. The last window's `to` is extended by `postCloseGraceMinutes`. It calls `validateIntradayConfig`, which throws RangeError on bad config.
   - `IntradayQuote { symbol; ts: string /* ISO, source bar time */; price: number; volume: number; source: string; fetchedAt: string }`. `ts` is the **source's** minute-bar time and `fetchedAt` is our clock (architect F, data-viz risk "fetch vs quote time").
   - `RawMinuteBar { t: unknown; c: unknown; v: unknown }`.
   - `intradayQuoteFromMinuteBars(symbol, bars, { today, unit, sanity, lastClose?, source, fetchedAt })` returns `{ ok: true, quote } | { ok: false, reason }`.
     - It keeps the bars whose `t` (epoch seconds, a safe integer ≥ 0) has `vnDateOf` equal to `today`.
     - The newest of those bars gives `ts` and `price` (`toVnd(c, unit)`, the same band, step and jump guards as `normalizeDailyBar`, with the same reason names).
     - `volume` is the sum of today's `v`, which is the **session-cumulative** volume, so a later "KL" display matches the board semantics.
     - It never throws on data.
   - **`ts` is therefore minute-granular.** Re-polling within a minute upserts the same `(symbol, ts)` row, which updates price, volume and `fetched_at`. That bounds growth to about 270 rows per symbol per day and resolves the DB consult's dedupe concern without using `now()` as `ts`.

3. **Adapter `VciIntradaySource`** (`packages/sources/src/vci-intraday.ts`).
   - `name = VCI_INTRADAY_CONFIG.sourceName`.
   - Constructor options: `{ fetchImpl, http: Omit<GetJsonOptions,'userAgent'>, baseUrl?, userAgent?, sanity?, maxSymbolsPerRequest? }`. The pattern is copied from `VciOptions`; `vci.ts` itself is not imported or edited.
   - `fetchLatest(symbols, { now, lastCloses? })` returns `Promise<IntradayFetchResult>`, where `IntradayFetchResult = { quotes: IntradayQuote[]; rejected: { symbol: string; reason: string }[] }`.
   - It upper-cases and dedupes `symbols` and chunks them by `maxSymbolsPerRequest`, sending one POST per chunk in sequence.
   - Body: `{ timeFrame, symbols: chunk, to: <epoch seconds of now> + 60, countBack }`. The `to` semantics are unverified; `+60` makes the current minute bar included.
   - A 403 is mapped to non-retryable `SourceError(..., 403)` with "no bypass, see ADR 0006", copying the `vci.ts` pattern.
   - Response handling:
     - The root is an array or `{ data: [] }`, otherwise a shape error.
     - Each item must be an object with a string `symbol` that was requested (otherwise "symbol mismatch") and equal-length `t`, `c` and `v` arrays.
     - Digit strings are converted with a local `num()` helper (the same rule as `vci.ts`).
     - Each item becomes `intradayQuoteFromMinuteBars` with `today = vnDateOf(now)`, `unit 'VND'` (declared once as `VCI_INTRADAY_PRICE_UNIT`), `fetchedAt = now.toISOString()` and `lastCloses[symbol]`.
     - Requested symbols that are missing from the response become `no_data`.
   - It reads only `t`, `c` and `v`; `o`, `h` and `l` are ignored, because intraday stores a last price only (spec §5).

4. **Migration `20261105000200_prices_intraday.sql`** (DB consult §1 and §5, adopted).
   ```sql
   create table public.prices_intraday (
     symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
     ts timestamptz not null,
     price integer not null check (price > 0),
     volume bigint not null check (volume >= 0),
     source text not null check (source <> ''),
     fetched_at timestamptz not null,
     primary key (symbol, ts)
   );
   comment on column public.prices_intraday.ts is 'source minute-bar time (not fetch time)';
   comment on column public.prices_intraday.volume is 'session-cumulative volume: sum of the source''s minute volumes for that VN day';
   alter table public.prices_intraday enable row level security;
   revoke all on public.prices_intraday from public, anon, authenticated;
   grant select, insert, update, delete on public.prices_intraday to service_role;
   ```
   - There are no policies and no sequence.
   - The PK `(symbol, ts)` serves "latest per symbol" as a backward index scan.
   - There is no `fetched_at` index and no `ts` index. The `ts` index belongs to the prune follow-up.
   - Copy the header comment style of `20261026000200_signals.sql`, including the note that the grants loop of `20261023000200` does not cover later tables.

5. **Repository `prices-intraday.ts`**, copying `prices-daily.ts`.
   - `upsertPricesIntraday` dedupes by `symbol|ts` (later wins) and runs `upsert(chunk, { onConflict: 'symbol,ts' })`. It is last-write-wins, with no stale-write guard. The DB consult says that is acceptable at this scale and avoids an RPC.
   - `getLatestIntraday(db, symbols)` returns `Record<symbol, IntradayQuote>`, one query per symbol, the same pattern as `getLatestCloses`.

6. **Go/no-go live check (Ming, home server, during a trading session).**
   - **The script.** `work/tickets/STK-049/record-vci-intraday-samples.sh`:
     - Modelled on `work/tickets/STK-042/record-vci-samples.sh`. Run it from the repo root. It sends only the honest UA, `Accept` and `Content-Type`, and stops on 403 with no bypass.
     - It POSTs the gap-chart `ONE_MINUTE` body for `["VNM","FPT","HPG"]` with `to=$(( $(date +%s) + 60 ))` and `countBack=360`, and saves `live-samples/gapchart-1.json`.
     - It sleeps 30 s and saves `gapchart-2.json`.
     - It writes `live-samples/request.json`, which holds the symbols, and `README.md`, which holds the UTC recording time and host.
     - Info only: one POST to `/price/symbols/getList` with `{"symbols":[...]}` saved as `board-1.json`. Its result does not change the adapter in this slice.
   - **Checklist** (copied into ADR 0006):
     1. HTTP 200 on every call; no 403 or challenge page.
     2. One request returns three list items whose `symbol`s match. This proves batching. If it fails, the result is **NO-GO for the batched design**, and slice 2 must be re-planned, because per-symbol polling would be about 40 requests a minute.
     3. VNM `c` is tens of thousands, so the unit is VND.
     4. The last `t` is within a few minutes of the recording time, and today's bars are present.
     5. The sum of today's `v` for VNM roughly matches the session volume in the TCBS app (Ming checks by eye), which confirms the volume semantics.
     6. The second call 30 s later does not return 429.
     7. `pnpm --filter @stoktok/sources test` runs `vci-intraday.samples.test.ts` (no longer skipped) and it passes.
   - **Blocking status.** The check **does not block slice 1**, because nothing calls the source at runtime. It **gates slice 2**: the slice 2 ticket must be planned as `BLOCKED` until the recorded samples are committed and checklist items 1–3 and 7 pass. If the samples disagree with the synthetic fixture (field names, units, `t` encoding), the fix belongs to slice 2: update the parser and replace the synthetic fixture with the recorded one.

7. **ADR 0006 "Intraday prices fetched on demand by the web server".** Status: proposed (Ming confirms in the PR). It records:
   - Ming's 2026-11-05 decision and the deviation from spec §4.1, §4.4 and §7.
   - The endpoint and body.
   - The unit and `ts` and volume semantics.
   - The UNVERIFIED list: shape, unit, `to` semantics, `countBack` meaning for minute bars, batching, rate limits and terms.
   - The header policy, which is the same as ADR 0004.
   - The checklist above.
   - Slice 2 defaults: throttle on attempt time, a breaker, no `data_gaps`, intraday never written to `prices_daily`, and signals never read intraday.

8. **Rules.**
   - R1: no UI in this slice.
   - R2: integer VND via `toVnd`; integer/bigint columns, checked by db-check `no_numeric_or_float_columns`.
   - R3: the adapter is in a server-only package and the guard test is extended. Web does not import it yet.
   - R4: `source` and `fetched_at` are not null.
   - R5: sessions, grace, throttle, endpoint, UA and timeouts are all config.
   - R7: the EOD adapters are not moved.
   - R8: the tests above.
   - R10: no login and no orders. The endpoint is public market data.

## Specialist input used
**Adopted**
- data-engineer A and architect C (alternative): a new shared package with only `http.ts`, `SourceError` and the new intraday adapter, plus worker re-exports; `fetchDaily` is untouched.
- data-engineer A: a separate `IntradaySource.fetchLatest(symbols[])` interface, an honest UA, config instead of literals, and failure on 403 without circumvention.
- data-engineer 5 and 6: VCI as primary, one batched call, no fallback chaining. The `ONE_MINUTE` gap-chart is the implemented endpoint because its host and shape are known from ADR 0004. The board snapshot is only recorded, for information.
- data-engineer C and architect D: a pure session rule built on `isTradingDay`, `vnDateOf` and `vnMinutesOf`; one union window; post-close grace; UNVERIFIED defaults.
- data-engineer D, DB consult 1, 2, 5 and 7: the table shape, PK, last-write-wins upsert, RLS and grants, and rollback. `ts` is the source time, never `now()`.
- DB consult 6: the checks.sql additions, without `intraday_fetch_state`.
- architect B: the R3 guard extended to the new package.
- architect K: ADR 0006.
- architect F and DB "Mixing intraday and EOD semantics": intraday is never written to `prices_daily`. This is recorded in ADR 0006 and applied in slice 2.

**Disagreements resolved (planner defaults, Ming confirms in the PR)**
1. **Throttle: DB claim table + RPC (DB consult 3) vs in-process single-flight + attempt-time (architect E, data-engineer B).** Default: **in-process**.
   - The mechanism is a module-level single-flight `Map`, an in-memory `lastAttemptAt` per symbol (with a fallback to the DB latest `fetched_at` after a restart), and an in-memory breaker (backoff after failures, a long cool-down on 403 or 429).
   - Reason: one web container (ADR 0003). The claim RPC adds a function, grants and checks for no v1 gain.
   - Upgrade path, written into ADR 0006: add the claim table + RPC if the web app ever runs two instances or the worker also polls.
   - **Consequence for slice 1:** the migration has no `intraday_fetch_state`.
2. **Adapter location: move all adapters vs only the new adapter + http/SourceError.** Default: **only the new adapter + `http.ts` + `SourceError`**, with worker shims. Moving the EOD and financials adapters is a follow-up. Reason: R7 and AC5 ("EOD jobs unchanged").
3. **Server action + `router.refresh()` vs route handler.** Default: **server action** `refreshPricesAction()`, which calls `requireUser()` first, takes no client-supplied symbols, and is followed by `router.refresh()`.
   - Reasons: the built-in Origin check; `requireUser()` redirect semantics work; the board stays server-rendered (R1); `PUBLIC_PATHS` does not change (architect A, data-viz 1).
   - The route handler is rejected. This is slice 2 and 3 work.
4. **Dashboard P&L uses the merged intraday price.** Default: **yes**, through a core `mergeIntradayIntoBars`.
   - If the latest intraday quote's VN date is today, today is a trading day, and `prices_daily` has no row for today, a synthetic today bar goes first. A daily row for today always wins. Older ticks are ignored.
   - `buildPriceBoardRow` and `buildPortfolio` are unchanged. The UI carries one page-level "(tạm tính)" note (architect F, data-viz 4). Slice 2.
5. **Session hours config.** Default: **a core constant `DEFAULT_INTRADAY_CONFIG`**, with one union window (09:00–11:30, 13:00–15:00) for all exchanges plus 3 minutes of grace, UNVERIFIED. It is not editable in Settings and has no `rule_configs` override in v1; that is a follow-up if Ming wants it. Holidays come from `settings.holidays`.
6. **Retention/prune.** Default: a **follow-up**, a worker daily job deleting rows older than 30 trading days (configurable) and adding a `(ts)` index. The table is unbounded until then; at about 270 rows per symbol per day it stays small.
7. **No `data_gaps` for intraday in v1** (DB consult 8, data-engineer E, architect I). A failed poll is a transient "delayed" state shown from `fetched_at` age and the action's `failed` status. `prices_daily` gaps stay authoritative. A future intraday gap record would use `data_type 'prices_intraday'` and never reuse `'prices_daily'`. Follow-up together with the gap-detection roadmap item.
8. **Manual-refresh floor.** Default: **no separate shorter floor**. "Làm mới" goes through the same ~30 s per-symbol throttle, because AC2 says "at most one source call per symbol per ~30 s … however many tabs or button presses there are".
   - Inside the window the button returns at once with the stored price and its time. The UI shows "Vừa cập nhật lúc HH:mm:ss" instead of failing silently.
   - The 5–10 s floor proposed by data-engineer B is rejected because it contradicts AC2. Ming can lower `throttleMs` in config if he wants.

**Rejected or deferred**
- `normalizeIntradayQuote` checking the price against the ref ± limit (architect C): deferred. It needs the exchange and the ref per symbol, which the adapter does not have. The band, step and jump guards cover unit errors. It can be revisited in slice 2.
- The `data_gaps` episode-per-failure design (data-engineer E alternative): not in v1 (see default 7).
- The guard test "signals never read `prices_intraday`" (data-engineer D): deferred to the short-term-signals ticket. No code reads the table yet.
- data-viz recommendations: all deferred to slice 3, unchanged. That covers the shared `PriceRefreshBar` island, placement, the state table, no live region per row, fixed-width button, no change highlight in v1, absolute `HH:mm:ss` via a core formatter, and distinct text from "Dữ liệu cũ".

## Assumptions
- The VCI `gap-chart` endpoint accepts `timeFrame: 'ONE_MINUTE'`, returns the ADR 0004 columnar shape, honours a multi-symbol `symbols` array, and uses VND with `t` in epoch seconds. All of this is **unverified** and is tested only against the synthetic fixture until Ming records samples (Approach §6).
- `countBack` for minute bars counts bars. 360 covers a full session (about 270 bars) even if it counts minutes. Unverified.
- The intraday `source` value is `'vci-public'`, the same provider id as EOD. Rows are told apart by the table, not by the id.
- Minute-bar `v` is per-minute volume, so the session total is their sum (checklist item 5 confirms).
- `pnpm db:check` runs where the reviewer has local Postgres. If not, the SQL review is by reading, as in earlier DB tickets.
- 2026-11-05 is a weekday, so Ming can run the script during a session on the PR's day or the next trading day.

## Blocking questions
None. Every open consult question has a planner default above for Ming to confirm in the PR. The live endpoint check gates **slice 2**, not this slice.

## Split proposal
The full ticket is estimated at roughly 1 000+ non-test lines across five layers, which is well above the ~400-line guide. Proposed slices:

| Slice | Ticket | Scope | Est. non-test lines |
|---|---|---|---|
| **1 (this plan)** | STK-049 | `@stoktok/sources` package (move http/SourceError + `VciIntradaySource` against a fixture); core session rule + quote reduction + `DEFAULT_INTRADAY_CONFIG`; `prices_intraday` migration, rollback and db-check; db repo; R3 guard; ADR 0006; go/no-go script and samples test. | ~400 |
| 2 | new (e.g. "STK-049b: server-side intraday refresh") — **plan BLOCKED until the go/no-go samples pass** | Core: `symbolsDue` (attempt-time), breaker/backoff transitions, `intradayStatus` (`live`/`delayed`/`closed`), `mergeIntradayIntoBars`. `apps/web/server/intraday/refresh.ts` (`server-only`; derives watchlist + held symbols on the server; single-flight; 5 s budget; out-of-session → zero calls). `refreshPricesAction` (`requireUser()` first). Loaders (watchlist, symbol, dashboard) use merged prices. Web dependency + `transpilePackages`. Covers ticket AC1 (web wiring), AC2, AC3 (rest), AC5 (R1 part) and AC6 (throttle + handler tests). | ~350 |
| 3 | new (e.g. "STK-049c: refresh bar UI") | `PriceRefreshBar` client component: chained `setTimeout` from server `refreshIntervalMs`, pause when hidden, no overlap, stop when closed, stop on auth failure. "Làm mới" button; core `formatTime` (`HH:mm:ss`, VN zone); state labels from data-viz §3; placement on the dashboard, watchlist (replacing the "cập nhật sau mỗi lần đồng bộ cuối ngày" subtitle) and symbol header; a11y; fake-timer component tests. Covers ticket AC4 and AC6 (component). | ~250 |

**Follow-ups (not in any slice):**
- (a) Update spec §4.1, §4.4 and §7 and the roadmap item (`docs/ticket-roadmap.md:131`) to match Ming's decision ("web on demand, watchlist + held").
- (b) **Doc drift:** CLAUDE.md says the runtime is "Ming's WSL2 home server", while ADR 0003 says it is now an OrbStack Mac. Ming should decide which is correct; agents must not edit CLAUDE.md without him.
- (c) A prune job for `prices_intraday`, plus a `(ts)` index.
- (d) Short-term signals on intraday data, with a guard that the signals pipeline does not read intraday until then.
- (e) Recording intraday gaps in `data_gaps` (`data_type 'prices_intraday'`).
- (f) Move the EOD and financials adapters into `@stoktok/sources`.
- (g) A claim table + RPC throttle if a second instance or worker polling appears.
- (h) Session hours editable in Settings or through `rule_configs`.
- (i) Rate limits and terms for 30 s polling, to be confirmed with the source if possible.
