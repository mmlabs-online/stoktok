Status: READY

# Plan — STK-014: Quarterly financials adapter

## Spec summary
- §3 F4, medium-term row: "P/E and P/B vs sector, earnings growth trend, … | Daily OHLCV, quarterly financials". Also: "Signals are suppressed if the underlying data is stale or has gaps."
- §4.3: "One interface per data type (`PriceSource`, `FinancialsSource`, `NewsSource`); each implementation is swappable." "Every record stores `source` and `fetched_at`."
- §4.4: "Financials sync | Daily check, quarterly updates".
- §5: "`financials` | symbol, period, eps, bvps, revenue, net_income, source" and "`data_gaps` | symbol, from_ts, to_ts, detected_at".
- §7: "`worker` must tolerate restarts: jobs are idempotent".
- §9 Q4 (source licence): answered by Ming on 2026-10-25 in the ticket Notes. The answer is the TCBS public API (unofficial, no registration), with the risk accepted, the same posture as STK-005. Requirements: an honest User-Agent, low request volume, a swappable `FinancialsSource`, and an ADR. Fixtures are synthetic and labelled, and units are guarded. **The "⛔ blocking" input line in the ticket is resolved by that answer, so this plan is not BLOCKED.**
- CLAUDE.md R2 (integer VND, rounding defined once in core), R4 (`source`/`fetched_at`; gaps are recorded and never filled), R5 (tuning is config), R7, R8. R6 is suspended, and this is a CLI job, so no auth code is added.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | `FinancialsSource` interface with one implementation returning per-quarter EPS, BVPS, revenue and net income; adding a source needs no caller changes. | `apps/worker/src/sources/financials-source.ts` declares the interface. `TcbsFinancialsSource implements FinancialsSource`. `runFinancialsSync` depends only on the interface type: grep shows no `tcbs` import in `jobs/financials-sync.ts`. `cli.ts` is the only place that constructs the TCBS class. Tests: `tcbs-financials.test.ts` (all cases) and `financials-sync.test.ts › works with any FinancialsSource (fake source)`. |
| 2 | Migration adds `financials` (symbol, period, eps, bvps, revenue, net_income, source, fetched_at) and a symbol→sector mapping; RLS on, no anon/authenticated policies; money in integer VND. | `pnpm db:check` is green. That covers the new `tables_exist` list, the `financials_columns` asserts (all four values `bigint not null`), the `symbols_columns` sector asserts, `no_numeric_or_float_columns`, `rls_enabled_all_tables`, `no_policies`, the anon/authenticated denied loops, the new `rejects_bad_rows` cases, `service_role_can_read_write_financials`, and rollback then re-apply. |
| 3 | Daily-check job upserts idempotently with `source` and `fetched_at`; missing periods are recorded, not filled. | `financials-sync.test.ts` cases: `re-run produces the same rows except fetched_at`, `every row carries source and fetched_at`, `interior missing period recorded once across two runs`, `rejected period recorded as gap, no row written`, `gap resolved when the period arrives`, `no gap before the symbol's first known period`, `not-yet-due quarter is not a gap`. `upsertFinancials` test: `onConflict 'symbol,period'`. No code path writes a `financials` row unless all four values are valid (the columns are NOT NULL, and the core normaliser rejects partial periods). |
| 4 | Unit tests use recorded fixtures only, no live network. | All adapter tests pass a fake `fetchImpl` that serves files from `apps/worker/test/fixtures/tcbs-financials/`. The existing `test/no-network.ts` setup stays in `vitest.config.ts`. A test asserts that global `fetch` throws. The fixture README labels every file **SYNTHETIC** (the sandbox cannot reach VN hosts; Ming's note). |
| 5 | Job runnable once via a documented `pnpm` script. | Root `package.json` has `"worker:financials": "pnpm --filter @stoktok/worker run job financials"`. `cli.test.ts` checks that `parseArgs(['financials'])` and `parseArgs(['financials','--dry-run'])` are accepted, and that unknown jobs and flags give the usage message. `apps/worker/README.md` has a "Financials sync" section with the commands, the exit codes and a schedule line. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `supabase/migrations/20261026000100_financials.sql` | create | AC2. Creates the `financials` table and adds the sector columns to `symbols`. RLS and grants are set in this file. |
| `supabase/rollback/20261026000100_financials.down.sql` | create | db:check applies the rollbacks and expects 0 tables. Drops `financials`, then the sector constraint and columns on `symbols`. |
| `scripts/db-check/checks.sql` | modify | AC2 verification: adds the table, column, bad-row and service-role checks listed below. |
| `packages/core/src/market/financials.ts` | create | R1/R2: unit conversion, plausibility guards, period parsing and sector-label normalisation, defined once in core. |
| `packages/core/src/market/quarters.ts` | create | Period math (`YYYYQn`), quarter bounds as timestamps, the latest expected period, and gap planning. Domain logic belongs in core (planner rule 6, R8). |
| `packages/core/src/market/config.ts` | modify | Adds `FinancialsSanity` and `DEFAULT_FINANCIALS_SANITY` (R5), next to `DEFAULT_PRICE_SANITY`. |
| `packages/core/src/index.ts` | modify | Exports the new functions and types. |
| `packages/core/src/market/financials.test.ts` | create | R8. |
| `packages/core/src/market/quarters.test.ts` | create | R8. |
| `packages/db/src/rows.ts` | modify | Adds `FinancialInsert`, `FinancialRow`, `DataGapInsert` and `OpenGapRow`. |
| `packages/db/src/mappers.ts` | modify | Adds `financialFromRow` and `openGapFromRow` (`toSafeInt`, period check, R4 source/fetched_at required). |
| `packages/db/src/repos/financials.ts` | create | Adds `listFinancials` and `upsertFinancials`. |
| `packages/db/src/repos/data-gaps.ts` | create | A minimal gap repo: `listOpenGaps`, `insertGaps`, `resolveGaps`. STK-031 will reuse and extend it. |
| `packages/db/src/repos/symbols.ts` | modify | Adds `setSymbolSector`, which writes only the sector columns. `setSymbolExchange` is unchanged. |
| `packages/db/src/index.ts` | modify | Exports the new repo functions and row types. |
| `packages/db/test/fake-client.ts` | modify | Adds `'is'` to `METHODS`, needed for `.is('resolved_at', null)`. One word. |
| `packages/db/src/repos/financials.test.ts` | create | Fake-client tests. |
| `packages/db/src/repos/data-gaps.test.ts` | create | Fake-client tests. |
| `packages/db/src/repos/symbols.test.ts` | modify | Adds tests that `setSymbolSector` does not send `exchange`, and that the exchange payload has no sector keys. |
| `apps/worker/src/sources/financials-source.ts` | create | AC1: the interface and result types. |
| `apps/worker/src/sources/tcbs-financials.ts` | create | AC1: the TCBS implementation (unit constants, two quarterly endpoints merged by period, plus the overview for sector). |
| `apps/worker/src/sources/tcbs-financials.test.ts` | create | AC1/AC4. |
| `apps/worker/src/jobs/financials-sync.ts` | create | AC3: orchestration only. |
| `apps/worker/src/jobs/financials-sync.test.ts` | create | AC3. |
| `apps/worker/src/config.ts` | modify | Adds `FINANCIALS_SYNC_CONFIG` (R5) and `TCBS_CONFIG.financialsUserAgent`, an honest UA string for this job. |
| `apps/worker/src/store.ts` | modify | Adds `createDbFinancialsStore` (wiring only). |
| `apps/worker/src/store.test.ts` | modify | Covers the new store's wiring, mirroring the existing EOD store test. |
| `apps/worker/src/cli.ts` | modify | AC5: adds `financials` to the `parseArgs` allowlist, the usage string and the dispatch. |
| `apps/worker/src/cli.test.ts` | modify | AC5. |
| `apps/worker/test/fixtures/tcbs-financials/README.md` + `*.json` | create | AC4: synthetic, labelled fixtures (list in Approach step 6). |
| `package.json` (root) | modify | AC5: the `worker:financials` script. |
| `apps/worker/README.md` | modify | AC5: documentation and first-run checklist. |
| `docs/adr/0002-financials-source.md` | create | Ming's instruction: record the source decision, the risk, the UNVERIFIED items, the units and the policies. |

The implementer must not touch other files. In particular, `http.ts`, `no-network.ts`, `eod-sync.ts` and `price-source.ts` stay unchanged. `SourceError` is imported from `price-source.ts` as it is.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `core/market/financials.test.ts › toVndAmount VND: integer passes, decimal rounds half away from zero (2.5→3, -2.5→-3)` | R2, one rounding rule |
| `› toVndAmount BILLION_VND: 1234.567 → 1_234_567_000_000; 0.0000000004 → 0; non-safe result → null` | unit conversion |
| `› rejects NaN, Infinity, string, null, undefined, boolean` | boundary typing |
| `› normalize: valid period returns integers + period '2026Q3'` | happy path |
| `› negative eps, negative net_income, negative bvps (abs ≥ min) accepted` | sign rules |
| `› missing_eps / missing_bvps / missing_revenue / missing_net_income each reject the whole period and carry the period` | partial-quarter policy |
| `› invalid_period for quarter 0, 5, 2.5, '3', year 1989 / 2101` | period validation |
| `› negative_revenue; revenue below min non-zero → revenue_out_of_band; revenue 0 accepted` | revenue guards |
| `› wrong unit per-share: bvps 25.3 (thousand VND) → bvps_out_of_band` | R2 unit guard |
| `› wrong unit totals: raw-VND revenue declared BILLION_VND → revenue_out_of_band or invalid_revenue` | R2 unit guard |
| `› eps beyond maxAbsEpsVnd → eps_out_of_band; net_income beyond maxAbsTotalVnd → net_income_out_of_band` | bands |
| `› normalizeSectorLabel trims, collapses whitespace, '' / whitespace / non-string → null, >100 chars → null` | sector normalisation |
| `core/market/quarters.test.ts › periodOf / parsePeriod round-trip; addQuarters across year boundary (2026Q1 −1 = 2025Q4)` | period math |
| `› quarterBounds('2026Q1') = 2025-12-31T17:00:00.000Z .. 2026-03-31T16:59:59.000Z; Q4 ends 12-31 VN` | gap timestamps (VN time → UTC) |
| `› latestExpectedPeriod: 2026-05-14 with lag 45 → 2026Q1; 2026-05-15 with lag 45 → 2026Q1; 2026-05-14 with lag 46 → 2025Q4 (boundary)` | publish lag |
| `› planFinancialGaps: interior hole reported; nothing before firstKnown; nothing after windowEnd; present stored period not a gap; no known period → []` | gap planning |
| `› planFinancialGaps: existing open gap not re-planned; open gap whose period is present → resolve list (compared by instant, not string)` | app-side dedupe/resolve |
| `db/repos/financials.test.ts › upsert dedupes (later wins), chunks (5 rows, size 2 → 3 calls), onConflict 'symbol,period', no select, empty → no call, returns count, 23514 → DataError VALIDATION` | repo |
| `› listFinancials: in('symbol'), gte('period', from), maps bigint strings to safe ints; empty symbols → no call` | repo |
| `db/repos/data-gaps.test.ts › listOpenGaps filters data_type, in symbols, is resolved_at null; insertGaps sends rows (no select), empty → no call; resolveGaps updates resolved_at in ids, empty → no call` | repo |
| `db/repos/symbols.test.ts › setSymbolSector payload keys are exactly symbol, sector, sector_source, sector_fetched_at, updated_at (no exchange); setSymbolExchange payload has no sector keys` | the two writers cannot wipe each other |
| `worker/sources/tcbs-financials.test.ts › URLs: financialratio and incomestatement with yearly=0 and isAll=true; overview path; honest financials UA sent` | AC1, guards against a switch to annual data |
| `› ratio-ok + income-ok merge by period, sorted ascending, units converted to integer VND` | AC1, R2 |
| `› malformed rows: null eps, quarter 5, string value, duplicate period, other ticker → rejected with reasons, valid periods kept, stored symbol = requested` | untrusted input |
| `› wrong-unit fixtures → every period rejected, none returned` | R2 |
| `› period only in one endpoint → rejected missing_* (not filled)` | partial-quarter policy |
| `› empty arrays and HTTP 404 → { periods: [], rejected: [] } (no throw)` | ETF/no-data symbols |
| `› response longer than maxPeriodsPerResponse → SourceError non-retryable` | size cap |
| `› non-array body → SourceError; 5xx retried via getJson` | errors |
| `› fetchSector: overview-ok → normalised label; overview-no-industry → null` | sector |
| `› global fetch throws (no-network guard active)` | AC4 |
| `worker/jobs/financials-sync.test.ts › every row carries source = source.name and fetched_at = now ISO` | R4 |
| `› re-run produces the same rows except fetched_at` | idempotency |
| `› only periods ≥ windowStart are upserted` | lookback |
| `› interior missing period recorded once across two runs (fake store keeps open gaps)` | AC3, dedupe |
| `› rejected period recorded as gap, no row written; previously stored period that is now rejected → no gap, stored row untouched` | not filled |
| `› gap resolved when the period arrives` | resolve |
| `› no gap before the symbol's first known period; not-yet-due quarter not a gap` | false-gap guards |
| `› symbol with no data (ETF) → symbolsWithoutData, no gaps, ok stays true` | ETF policy |
| `› restated values logged and listed in summary.restated; row overwritten` | overwrite policy |
| `› failed symbol: no gap planning for it, others continue; circuit breaker skips after maxConsecutiveFailures` | robustness |
| `› sector: written via setSymbolSector with source + fetched_at; null label → not written, listed in sectorMissing; sector fetch error → sectorFailedSymbols, ok false, financial rows kept` | sector |
| `› dry-run: no upsert, no gap insert/resolve, no sector write; summary still lists missingPeriods` | --dry-run |
| `› symbol union watchlist ∪ held, normalised, sorted; ledger error → ledgerError, ok false, watchlist still synced` | scope |
| `› works with any FinancialsSource (fake source)` | AC1 swappability |
| `worker/cli.test.ts › accepts financials and financials --dry-run; rejects unknown job/flag` | AC5 |
| `worker/store.test.ts › financials store wires to @stoktok/db functions` | wiring |

## Approach
Implement in two commits (see the split point). Run `pnpm typecheck && pnpm lint && pnpm test && pnpm db:check` after each.

**Commit A (slice 1): schema, core, adapter, upsert, sector, CLI, ADR**

1. **Migration** `20261026000100_financials.sql`:
   ```sql
   create table public.financials (
     symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
     period text not null check (period ~ '^[0-9]{4}Q[1-4]$'),
     eps bigint not null,
     bvps bigint not null,
     revenue bigint not null check (revenue >= 0),
     net_income bigint not null,
     source text not null,
     fetched_at timestamptz not null,
     primary key (symbol, period)
   );
   ```
   - Column comments:
     - `eps`: "VND per share as published by the source; basis (quarterly vs TTM, basic vs diluted) UNVERIFIED, see docs/adr/0002".
     - `revenue` and `net_income`: "VND (integer, R2), converted from source units in core".
     - `period`: "source fiscal-quarter label, treated as calendar quarter".
   - `alter table public.symbols` adds `sector text`, `sector_source text` and `sector_fetched_at timestamptz`, with two constraints:
     - `symbols_sector_format`: `check (sector is null or (length(sector) between 1 and 100 and sector = btrim(sector)))`
     - `symbols_sector_provenance`: `check ((sector is null) = (sector_source is null) and (sector is null) = (sector_fetched_at is null))` (R4)
   - In the same file: enable RLS on `financials`, `revoke all … from anon, authenticated`, and `grant select, insert, update, delete … to service_role`. Same pattern as `symbols`. No policies.
   - Rollback file: `drop table if exists public.financials;`, then `alter table public.symbols drop constraint if exists …, drop column if exists sector, sector_source, sector_fetched_at;`.
   - All four value columns are `bigint`. That is the same precedent as `corporate_actions.amount_per_share`, EPS has no hard cap, and it keeps `no_numeric_or_float_columns` green.

2. **checks.sql**:
   - `tables_exist` array becomes `assets, corporate_actions, data_gaps, financials, prices_daily, settings, symbols, transactions, watchlist`.
   - New `financials_columns` block: `symbol` and `period` are text NOT NULL; `eps`, `bvps`, `revenue` and `net_income` are bigint NOT NULL.
   - Add the `financials` `source` and `fetched_at` asserts to `source_fetched_at_not_null`.
   - `symbols_columns`: `sector` and `sector_source` are text, nullable; `sector_fetched_at` is timestamptz, nullable.
   - `rejects_bad_rows`, using a `fi` insert prefix:
     - These must fail with 23514: period `2026Q5`, `2026-Q1`, `26Q1`; lowercase symbol; negative revenue; a symbols row with `sector ''`, with `sector ' x'`, with a sector but no `sector_source`/`sector_fetched_at`, and with `sector_source` but no sector.
     - These must fail with 23502: a NULL eps and a NULL source.
     - Duplicate `(symbol, period)` must fail with 23505.
     - Positive cases that must be accepted: negative eps, bvps and net_income, and revenue 0.
   - New `service_role_can_read_write_financials` block: insert, select, delete as `service_role`.

3. **Core** (R1, R2, R5):
   - `market/config.ts`: `FinancialsSanity` / `DEFAULT_FINANCIALS_SANITY`:
     ```
     { maxAbsEpsVnd: 1_000_000, minAbsBvpsVnd: 100, maxAbsBvpsVnd: 10_000_000,
       minNonZeroRevenueVnd: 1_000_000, maxAbsTotalVnd: 1_000_000_000_000_000 }
     ```
     The comments explain which unit error each bound catches:
     - `minAbsBvpsVnd` catches per-share values sent in thousand VND. EPS and BVPS come from the same endpoint, so one guard covers the period.
     - `maxAbsTotalVnd` and the safe-integer check catch raw VND or millions read as billions.
     - `minNonZeroRevenueVnd` catches billions read as VND.
   - `market/financials.ts`:
     - `type FinancialUnit = 'VND' | 'BILLION_VND'`.
     - `toVndAmount(value: unknown, unit): number | null`. The value must be a finite number. It is multiplied by `1e9` for billions, then rounded half away from zero (the same direction as `money.ts roundDiv`; documented as the single rule). The result must pass `Number.isSafeInteger`, otherwise the function returns null.
     - `RawQuarterlyFinancials { year, quarter, eps, bvps, revenue, netIncome }` (all `unknown`).
     - `QuarterlyFinancials { symbol, period, eps, bvps, revenue, netIncome }` (integers).
     - `normalizeQuarterlyFinancials(symbol, raw, units: { perShare: FinancialUnit; totals: FinancialUnit }, sanity)` returns `{ ok: true; value } | { ok: false; reason; period? }` and never throws. It carries the period whenever year and quarter parse, so the job can treat that quarter as known and record the gap.
     - `normalizeSectorLabel(value: unknown): string | null` trims, collapses internal whitespace, and returns null when the result is empty or longer than 100 characters.
   - `market/quarters.ts`:
     - `periodOf(year, quarter)` validates integers, year 1990–2100 and quarter 1–4, and returns `'YYYYQn'` or null.
     - `parsePeriod`, `addQuarters(period, n)`, `comparePeriods`.
     - `quarterBounds(period) → { fromTs, toTs }`, as ISO UTC strings for the first day 00:00:00 and the last day 23:59:59 in Asia/Ho_Chi_Minh (+07:00, fixed offset).
     - `latestExpectedPeriod(todayVn: 'YYYY-MM-DD', publishLagDays)` returns the newest quarter whose last day plus `publishLagDays` is on or before `todayVn`.
     - `planFinancialGaps({ windowStart, windowEnd, knownPeriods, presentPeriods, openGaps: {id, fromTs, toTs}[] }) → { toRecord: string[]; toResolve: id[] }`:
       - The expected range is `[max(windowStart, min(knownPeriods)), windowEnd]`. If `knownPeriods` is empty, nothing is expected.
       - Missing = expected minus present, excluding any period whose bounds match an open gap. Bounds are compared with `Date.parse` (by instant).
       - To resolve = open gaps whose bounds match a present period.
   - Export everything from `index.ts`.

4. **db repos**:
   - `upsertFinancials(db, rows, { chunkSize })` copies `upsertPricesDaily`: key `symbol|period`, `onConflict: 'symbol,period'`, sequential chunks, no `.select()`. The doc comment states that every column, including `fetched_at`, is overwritten (the restatement policy).
   - `listFinancials(db, symbols, fromPeriod)` is one query: `.select(cols).in('symbol', …).gte('period', fromPeriod)`. Rows are mapped with `financialFromRow`, where `toSafeInt` handles the Int8 values, the period regex is checked, and source/fetched_at are required.
   - `setSymbolSector(db, symbol, { sector, source, fetchedAt })` upserts `{ symbol, sector, sector_source, sector_fetched_at, updated_at }` with `onConflict: 'symbol'`. It never sends `exchange`. A new row gets `exchange` NULL, which means "unknown".

5. **Worker source**:
   - `financials-source.ts`:
     ```ts
     interface FinancialsSource {
       readonly name: string;
       fetchQuarterly(symbol): Promise<{ periods: QuarterlyFinancials[]; rejected: { period?: string; reason: string }[] }>;
       fetchSector(symbol): Promise<string | null>;
     }
     ```
   - `tcbs-financials.ts`, `TcbsFinancialsSource` with `name = 'tcbs-public'`:
     - The options mirror `TcbsOptions` (an injected `fetchImpl`, `http`, an optional `baseUrl`/`userAgent`, `sanity`, and `maxPeriodsPerResponse`).
     - Unit constant `TCBS_FINANCIALS_UNITS = { perShare: 'VND', totals: 'BILLION_VND' }`, with a doc comment marking it UNVERIFIED and pointing to ADR 0002.
     - `fetchQuarterly`: two requests through `getJson`, separated by `sleep(requestDelayMs)`, taken from the injected http options:
       - `GET {base}/tcanalysis/v1/finance/{symbol}/financialratio?yearly=0&isAll=true` for `earningPerShare` and `bookValuePerShare`.
       - `GET {base}/tcanalysis/v1/finance/{symbol}/incomestatement?yearly=0&isAll=true` for `revenue` and `shareHolderIncome`. Net income attributable to parent is consistent with EPS. There is no fallback to `postTaxProfit`, because no value is derived from another.
     - Parsing rules:
       - Build `symbol` with `encodeURIComponent` after `normalizeSymbol`. The body must be an array; an empty array or null means no data.
       - A 404 `SourceError` is treated as no data, so ETFs and fund certificates do not fail.
       - A body longer than `maxPeriodsPerResponse` throws a non-retryable `SourceError`.
       - Rows whose `ticker` is present and not equal to `symbol` are rejected with `ticker_mismatch` and no period.
       - A period that appears twice in one endpoint is rejected with `duplicate_period`.
       - Rows are merged by period across the two endpoints. A period present in only one endpoint goes to core, where the missing fields become `missing_*`.
       - The result is sorted ascending by period. The stored symbol is always the requested one.
     - `fetchSector`: `GET {base}/tcanalysis/v1/ticker/{symbol}/overview`, field `industry` (the Vietnamese label, which suits the Vietnamese UI), passed through `normalizeSectorLabel`. A 404 returns null.
   - `config.ts`:
     - `TCBS_CONFIG.financialsUserAgent = 'stoktok/0.1 (personal portfolio tracker; low-volume daily financials check)'`.
     - `FINANCIALS_SYNC_CONFIG = { lookbackQuarters: 12, publishLagDays: 45, requestDelayMs: 1000, timeoutMs: 15_000, maxAttempts: 3, backoffBaseMs: 1000, maxConsecutiveFailures: 5, upsertChunkSize: 500, maxPeriodsPerResponse: 200 }`, with a comment on each knob (R5).

6. **Fixtures** in `apps/worker/test/fixtures/tcbs-financials/`, using made-up tickers (`TSTA`, `TSTB`) and obviously fake round figures:
   - `ratio-ok.json` and `income-ok.json`: 6 quarters, unsorted, decimal billions, one negative-income quarter.
   - `ratio-malformed.json` and `income-malformed.json`: a null eps, quarter 5, a string number, a duplicate period, another ticker.
   - `ratio-wrong-unit.json`: per-share values in thousand VND.
   - `income-wrong-unit.json`: totals in raw VND.
   - `empty.json` (`[]`), `overview-ok.json` and `overview-no-industry.json`.
   - `README.md` opens with **SYNTHETIC — hand-written from a recalled shape, not recorded**. It gives the assumed shapes, the curl commands with UA `stoktok/0.1 (manual check)`, and the file list.

7. **Job** `runFinancialsSync(deps)`. `deps` holds `store`, `source`, `now`, `config`, `sleep`, `log` and `dryRun`, the same shape as `runEodSync`.
   - **Scope:**
     - `todayVn = vnDateOf(now)`, `windowEnd = latestExpectedPeriod(todayVn, config.publishLagDays)`, `windowStart = addQuarters(windowEnd, -(lookbackQuarters-1))`.
     - Symbols are watchlist ∪ held, normalised and sorted. The roughly 10 lines from `eod-sync.ts` are duplicated, not extracted (R7); a shared helper is a follow-up. A ledger error is handled as in EOD.
   - **Reads:** `store.listFinancials(symbols, windowStart)` and `store.listOpenGaps(symbols)`.
   - **Per symbol,** sequentially, with `sleep(requestDelayMs)` between symbols and the circuit breaker on `maxConsecutiveFailures`:
     - Call `fetchQuarterly`.
     - Keep the valid periods that are `>= windowStart`. Newer-than-expected periods are kept too, because they are real data.
     - Compare each kept period with the stored row. Any field that differs is logged as `restated SYM 2026Q2: eps,revenue` and added to `summary.restated`.
     - Build the rows with `source: source.name, fetched_at: now.toISOString()`.
     - Then call `fetchSector` in its own try block. A non-null label is written through `store.setSymbolSector` (skipped on dry-run). A null label goes to `sectorMissing` and is not written, so a known sector is never wiped. An error goes to `sectorFailedSymbols`; it sets ok to false but keeps the rows and does not count toward the circuit breaker.
   - **Write:** `upsertFinancials(rows)` (skipped on dry-run). Upsert first, then gaps (commit B), so a crash between the two leaves no gap without its upsert.
   - **Summary:**
     ```
     { ok, dryRun, source, fetchedAt, windowStart, windowEnd, symbols, periodsFetched, rowsUpserted,
       rejected, rejectedBySymbol, restated, missingPeriods, gapsRecorded, gapsResolved, sectorsUpdated,
       sectorMissing, sectorFailedSymbols, failedSymbols, skippedSymbols, symbolsWithoutData, ledgerError? }
     ```
     `ok` is false on any failed or skipped symbol, rejected period, sector fetch error or ledger error. It stays true for `symbolsWithoutData` and `sectorMissing`. Rejections fail `ok` (exit 1) because they are how a unit drift becomes visible, consistent with EOD.

8. **Store and CLI:**
   - `createDbFinancialsStore(db, { upsertChunkSize })` wires the reads and writes to `@stoktok/db`.
   - `parseArgs` returns `job: 'eod-prices' | 'financials'`, with usage `cli.ts <eod-prices|financials> [--dry-run]`. `main` dispatches by job. Only `cli.ts` constructs `TcbsFinancialsSource`, with `userAgent: TCBS_CONFIG.financialsUserAgent`.
   - Root script `worker:financials`. The README section covers the commands, the env, the first-run `--dry-run` checklist (EPS in the thousands, BVPS above 100 VND, revenue in billions of VND, EPS basis), the exit codes, and the schedule (`TZ=Asia/Ho_Chi_Minh`, `45 18 * * 1-5 … pnpm worker:financials`, after EOD).

9. **ADR 0002** (same format as 0001), with these sections:
   - Context.
   - Decision: TCBS public, `tcbs-public`. **Risk accepted by Ming, 2026-10-25.** No terms page was read on 2026-10-26 because the sandbox cannot reach VN hosts.
   - Constraints: about 3 requests per symbol per day, sequential with a 1 s delay, an honest UA.
   - The unit table, and the rounding rule (half away from zero to integer VND; billions × 1e9 may differ from the published figure by a few VND because of float precision, accepted).
   - Partial-quarter, overwrite, ETF and sector policies (see Assumptions).
   - **UNVERIFIED list:**
     - the paths and params;
     - the field names;
     - the units;
     - **the EPS basis: quarterly vs TTM** (recalled values look TTM-like), basic vs diluted, consolidated vs parent;
     - `shareHolderIncome` vs `postTaxProfit`;
     - the response order and shape (a top-level array);
     - bank and securities-firm revenue fields;
     - the language of the `industry` label;
     - what TCBS returns for ETFs (404 vs `[]`);
     - throttling.
   - A note that **STK-015 must read the recorded EPS basis and must not assume one**.
   - The thin-peer caveat for "P/E vs sector" with a small watchlist.
   - How to swap the source.

**Commit B (slice 2): missing-period recording (AC3 second half)**

10. **`data-gaps.ts` repo** (minimal):
    - `listOpenGaps(db, dataType, symbols)`: `.select('id,symbol,from_ts,to_ts').eq('data_type', …).in('symbol', …).is('resolved_at', null)`.
    - `insertGaps(db, rows)`: rows carry `symbol, data_type, from_ts, to_ts, source, fetched_at`; `detected_at` defaults.
    - `resolveGaps(db, ids, resolvedAt)`: `.update({ resolved_at }).in('id', ids)`.
    - Gaps are never deleted.
    - Add `'is'` to the fake client.

11. **Job gap step,** per symbol that did not fail and was not skipped:
    - `knownPeriods` = stored periods ∪ valid fetched periods ∪ rejected rows that carry a period.
    - `presentPeriods` = stored ∪ valid fetched within the window.
    - Call `planFinancialGaps` with that symbol's open gaps.
    - Insert `toRecord` as `data_type 'financials'` with `quarterBounds`, `source.name` and `fetchedAt`, and resolve `toResolve` with `resolved_at = fetchedAt`. Both are skipped on dry-run, but `missingPeriods` is still reported.
    - No row is ever written to `financials` for a missing period (not filled; R4).

Rules: R1 (all conversion, guards and gap math in core; the worker orchestrates), R2 (integer VND end to end, guarded at the source boundary in core), R3 (the source gets no db or env; the key never appears in logs or the summary, same wiring as EOD), R4 (source/fetched_at on financials, gaps and sector), R5 (sanity, lookback, lag, delays and caps in config), R7 (the file list above; follow-ups below), R8 (core and repo tests listed), R10 (read-only public data).

## Specialist input used
- **data-engineer:**
  - Adopted:
    - the interface shape with sector on the same interface as `fetchSector`;
    - the `tcbs-public` name and reuse of `getJson`/`SourceError`;
    - unit constants in the adapter, with conversion and guards in core;
    - the `YYYYQn` period built from numeric fields, with quarters outside 1–4 rejected;
    - sorting, ticker-mismatch dropping, the length cap and `yearly=0` URL test;
    - `shareHolderIncome` as net income;
    - sector columns on `symbols` with provenance and a separate writer;
    - `data_gaps` with `data_type 'financials'` and VN quarter bounds;
    - gaps bounded by the first known period and the publish lag;
    - resolve on arrival;
    - no gaps for no-data symbols;
    - the summary and dry-run semantics and the CLI allowlist;
    - duplicating the symbol union instead of refactoring;
    - synthetic labelled fixtures;
    - the ADR UNVERIFIED list.
  - Rejected or adjusted:
    - **partial unique index (a)**: rejected. STK-031's notes say "No migration planned; a partial unique index … are follow-ups", and the caller asked for app-side dedupe, so this plan uses (b).
    - **`redirect: 'error'` and no-network hardening**: moved to follow-ups. Not required by any AC, and they change shared EOD behaviour (R7).
    - **`period_end` column, `created_at`/`updated_at`**: not added. Not in the AC; `prices_daily` precedent.
    - **sector refresh interval**: not added. The sector is fetched every run (one extra request), which avoids a read path; the interval is a follow-up.
    - **duplicate period, "last wins"**: changed to rejecting `duplicate_period`. An ambiguous period becomes a recorded gap rather than an arbitrary pick.
    - **EPS × shares cross-check**: not added (needs outstanding shares; log-only value; follow-up).
- **database-optimizer:**
  - Adopted:
    - one migration with the table and the `symbols` ALTER, RLS and grants inline;
    - the PK index only;
    - sector provenance option (b) with an all-or-nothing check;
    - the db-check additions and bad-row cases;
    - the repo shapes and fake-client test list;
    - app-side dedupe with resolve and no new index;
    - a `supabase/rollback/` file (the convention exists; their open question 2 is answered).
  - Rejected:
    - **nullable value columns and the at-least-one-metric check**: rejected in favour of NOT NULL plus rejecting the whole period as a gap. Reasons:
      - (1) "row exists ⇒ all four inputs valid" is an invariant that F4 signals can rely on, and db:check enforces it;
      - (2) it removes their own "refetch nulls out a stored value" risk;
      - (3) AC3 says missing data is "recorded, not filled", and a missing metric in a quarter is recorded the same way, as a gap;
      - (4) F4 suppresses signals on gaps anyway, so a partial row would never be used.
      - The cost is that a quarter with only revenue missing (a bank layout risk) is not stored. The ADR flags this, and it is a follow-up if the first live run shows it.
    - **`eps`/`bvps` as `integer`**: rejected in favour of `bigint` (no cap, precedent of `amount_per_share`).
    - **allowing negative revenue**: rejected; this plan uses `revenue >= 0`. Revenue is never negative in a VN income statement, and a negative value signals a mapping error.

## Assumptions
- **A1. Source answered.** Ming's 2026-10-25 note resolves §9 Q4 for financials, so the ticket's "⛔ blocking" line is satisfied and this plan is READY.
- **A2. Endpoints, fields and units are UNVERIFIED** (from memory; the sandbox cannot reach VN hosts). The plan assumes the paths in step 5, top-level JSON arrays, `year`/`quarter` numeric fields, per-share values in VND and totals in billions of VND. The guards reject all data rather than store it if this is wrong. Ming's first `--dry-run` confirms or refutes it, as for STK-005.
- **A3. EPS basis is UNVERIFIED** (quarterly vs TTM). It is stored exactly as the source gives it and recorded as UNVERIFIED in the ADR and the column comment. STK-015 depends on that record.
- **A4. Partial quarter:** if any of the four values is missing or invalid, the period is rejected and recorded as a gap. Nothing is stored on its own or filled with zero (justified under Specialist input).
- **A5. Overwrite policy:** a re-sync overwrites the stored values. Restatements are logged and listed in `summary.restated`. No history table; the F4 `inputs_snapshot` preserves what each signal used. `fetched_at` is always refreshed and acts as the "last verified" marker. Idempotent means the same rows apart from `fetched_at`.
- **A6. Lookback and lag** come from config: 12 quarters and a 45-day lag. The lag matches the VN quarterly-report deadline of 30/45 days and is used for every quarter, including Q4 (the quarterly Q4 report has the same deadline; the audited annual report is not used).
- **A7. Symbols without financials** (ETFs, fund certificates, new listings with nothing published), meaning an empty or 404 response with nothing stored: reported in `symbolsWithoutData`, no gap rows, `ok` unaffected.
- **A8. Sector label** is TCBS `industry` as published (Vietnamese text, at most 100 characters). There is no custom taxonomy and no CHECK enumeration.
- **A9. Calendar quarters:** `period` is TCBS's quarter label, treated as calendar-aligned. Gap bounds use the fixed +07:00 offset (Vietnam has no DST).
- **A10. Concurrency:** single worker and no overlapping runs, so app-side read-then-insert dedupe is acceptable (same posture as STK-005/STK-031).
- **A11. STK-031 coordination:** STK-014 creates `packages/db/src/repos/data-gaps.ts` with only `listOpenGaps`/`insertGaps`/`resolveGaps`. STK-031 should reuse and extend it with `data_type 'prices_daily'`. The orchestrator should note this on STK-031; this planner may not edit that ticket.

## Blocking questions
None.

## Split proposal
**Size:** about 650 product lines plus about 600 test lines, above the ~400-line guide. **Split point:** commit A (steps 1–9) / commit B (steps 10–11).
- **Slice 1 (commit A):** AC1, AC2, AC4, AC5 and the idempotent-upsert half of AC3. It can be reviewed on its own.
- **Slice 2 (commit B):** the "missing periods are recorded, not filled" half of AC3. It adds about 120 product lines: the gap repo, `planFinancialGaps` wiring and the job gap step. The core `planFinancialGaps` and `quarterBounds` functions are written and tested in commit A, as pure functions.

This plan covers **both slices in one ticket**, because AC3 cannot pass without slice 2 and the caller asked for minimal gap writes here. If the orchestrator or reviewer prefers to cut, slice 2 becomes a new ticket (for example STK-014b) that inherits steps 10–11 and the AC3 gap tests unchanged, and STK-014 closes with AC3 marked partial. Ming decides.

**Follow-ups (out of scope, R7):**
- `redirect: 'error'` in `http.ts` and no-network guard hardening (non-writable stub, `node:http`/`https` blocking): STK-005 security review items, best done as one `/solo`.
- A partial unique index on open `data_gaps` plus a single-run lock (shared with STK-031).
- A sector refresh interval, so the overview is not fetched daily.
- A shared watchlist ∪ held helper for the EOD and financials jobs.
- An EPS × outstanding-shares cross-check (log-only).
- `financials` history or `revised_at` if restatement auditing is needed.
- A bank and securities-firm revenue mapping if the first live run rejects those quarters.
- Replacing the synthetic fixtures with recorded captures.
- A `getFinancials` read API and staleness and open-gap checks in the STK-015 consumer.
- A fallback `FinancialsSource`.
