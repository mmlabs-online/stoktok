# consult-data-engineer — STK-014

STK-014 consult (data-engineer, read-only). I changed no files.

CAVEAT: the sandbox cannot reach Vietnamese hosts, so every TCBS endpoint, field name and unit below is from memory and is UNVERIFIED. This matches the STK-005 posture.

## Findings

### Repo state (verified by reading)
- **Adapter pattern to mirror.**
  - `PriceSource` has `name` and one fetch method.
  - `TcbsPriceSource` takes an injected `fetchImpl`, builds the URL with `URLSearchParams`, and calls the shared `getJson`.
  - The unit sits in one constant (`TCBS_PRICE_UNIT`), and a core `normalizeDailyBar` rejects bad values instead of storing them.
  - `runEodSync` takes a store interface (the DB seam) and a source, and returns a summary.
  - `cli.ts` has a `parseArgs` allowlist (currently only `eod-prices`, plus `--dry-run`).
  - `config.ts` holds `TCBS_CONFIG` (baseUrl, userAgent) and `EOD_SYNC_CONFIG`.
- **User-Agent.** The current one says "end-of-day sync", so the financials job needs its own honest UA string or a generic one.
- **Gap handling does not exist yet.**
  - STK-005 did not build gap detection. Its impl-log says "AC4 (gap detection) is STK-031 and not built".
  - No `data_gaps` repo exists in `packages/db`.
  - The table has no unique key, only the index `(symbol, from_ts)`.
  - Its columns are symbol (nullable), `data_type`, `from_ts`, `to_ts`, `detected_at`, `source`, `fetched_at` and `resolved_at`.
  - So STK-014's "missing periods are recorded" needs a small gap writer that STK-014 owns, or a deliberate decision to wait for STK-031.
- **`symbols` table** (STK-011): `symbol` PK, `exchange` nullable and checked, `created_at`, `updated_at`. The repo is `getSymbolExchanges` / `setSymbolExchange`, an upsert on `symbol`. `setSymbolExchange` always writes `exchange`, so a naive sector upsert through it would wipe the exchange, and the reverse also holds.
- **Rollback files exist** under `supabase/rollback/`. The `symbols` migration puts its own RLS and grants in the same file, because the STK-003 grants loop covers a fixed table list.
- **db:check** has a hard-coded `tables_exist` list, which this ticket must extend. Other checks to extend:
  - `no_numeric_or_float_columns` forbids numeric/float, so EPS and BVPS must be integer types.
  - `rls_enabled_all_tables`, the anon/authenticated deny loops and `no_policies` iterate every table and cover the new ones automatically.
  - The `symbols_columns` check is the model for column assertions.
- **R2 and EPS.** Core only has price/bar normalisation (`toVnd` / `normalizeDailyBar`). Nothing covers financial values yet.
- **Security carry-over from the STK-005 review.** `getJson` still has no `redirect: 'error'` (I found no match under `apps/worker`). The `no-network.ts` guard only stubs `fetch`, and `vi.unstubAllGlobals()` can undo it. STK-014 reuses both, so these are inherited.

### TCBS financial endpoints (all UNVERIFIED, from memory)
Base host is the same as prices: `https://apipubaws.tcbs.com.vn`, under `/tcanalysis/v1/...`.
- **Ratios:** `GET /tcanalysis/v1/finance/{ticker}/financialratio?yearly=0&isAll=true`
  - `yearly=0` means quarterly, `yearly=1` annual.
  - Returns an array of objects with `ticker`, `quarter` (1-4), `year`, plus many ratios.
  - Recalled fields: `earningPerShare`, `bookValuePerShare`, `priceToEarning`, `priceToBook`, `roe`, `roa`, `revenue`, `postTaxProfit`, and so on.
  - The units of the recalled revenue and profit fields are not certain.
  - Ratio-style endpoints usually return newest first.
- **Income statement:** `GET /tcanalysis/v1/finance/{ticker}/incomestatement?yearly=0&isAll=true`
  - Fields recalled: `revenue`, `postTaxProfit` (and `shareHolderIncome`), with `quarter` and `year`.
  - Values in this family are, as I recall, in billions of VND, often as decimals such as 1234.567. UNVERIFIED.
  - Treat `postTaxProfit` vs `shareHolderIncome` (parent-company net income) as a decision. Net income attributable to parent is the one consistent with EPS.
- **Overview and sector:** `GET /tcanalysis/v1/ticker/{ticker}/overview`
  - Recalled fields: `exchange`, `industry`, `industryEn`, `industryID`, `industryIDv2`, `shortName`, `companyType`, `noShareholders`, `outstandingShare`, `stockRating` and others.
  - There are also `/tcanalysis/v1/company/{ticker}/overview` and `/tcanalysis/v1/ticker/{ticker}/ratio` variants.
- **Request count.** The ratio endpoint alone may carry EPS, BVPS, revenue and profit for all quarters, which would be one request per symbol. If the unit or fields are ambiguous, fall back to two requests (ratio and income statement). Add a third (overview) only for sector.
- **Where this could differ.** The path prefix, the `isAll` and `yearly` params, and the field names may all be wrong. The first `--dry-run` from Ming's machine must confirm them.

## Recommendations

### 1. Interface and adapter (AC1)
- File: `apps/worker/src/sources/financials-source.ts`.
- Shape:
  - `FinancialsSource { readonly name: string; fetchQuarterly(symbol: string): Promise<{ periods: QuarterlyFinancials[]; rejected: RejectedPeriod[] }> }`
  - `QuarterlyFinancials { symbol; period; eps: number; bvps: number; revenue: number; netIncome: number }`, all integer VND.
- Sector is a separate method, `fetchProfile(symbol): Promise<{ sector: string | null }>`, or a second tiny interface.
- Reason: the sector is stable and should not be re-fetched every day. Splitting also keeps a future source swap simple.
- Implementation: `TcbsFinancialsSource` with `name = 'tcbs-public'`. Reuse `getJson`, `SourceError` and `TCBS_CONFIG.baseUrl`.
- Put the quarterly request knobs in a new `FINANCIALS_SYNC_CONFIG` (R5), not in code.
- Keep the TCBS response shape and units entirely inside the adapter, and declare them in constants, e.g. `TCBS_FINANCIALS_UNITS = { revenue: 'BILLION_VND', netIncome: 'BILLION_VND', eps: 'VND', bvps: 'VND' }`.
- The `yearly` query value is `0`. Add a test that asserts the URL contains it, so a switch to annual data cannot go unnoticed.

### 2. Units and the boundary conversion (R2)
- Put the conversion and validation in `packages/core` (R1 and R2: rounding is defined once there). For example `packages/core/src/market/financials.ts` with:
  - `toVndFromBillions(value)`: use `Math.round(value * 1e9)`, then `Number.isSafeInteger`. 1e9 × a few hundred thousand billion is below 2^53 for any real company. Reject if not safe.
  - `normalizeQuarterlyFinancials(symbol, raw, units)`, which never throws and returns `{ ok: false, reason }` the way `normalizeDailyBar` does.
- Rounding detail: floats like 1234.567 * 1e9 are not exact, so a tolerance check like `toVnd`'s epsilon would wrongly reject. For billions, source values with at most 3 decimals map to whole millions. I recommend rounding to the nearest VND and adding a precision note in the ADR, rather than rejecting. If the source returns raw VND, `Number.isSafeInteger` applies as for prices.
- Per-field guards (the unit guard is the main risk, because a wrong unit corrupts every medium-term signal silently):
  - EPS: integer VND, sign allowed, plausible band (e.g. |EPS| <= 1,000,000; config-driven). A VN EPS is typically hundreds to tens of thousands of VND. An EPS of 2.5 is a sign of a thousand-VND or per-million unit.
  - BVPS: integer VND, plausible band, and positive in the common case. Negative book value is possible for distressed companies, so allow it but flag.
  - Revenue: >= 0, in a band (e.g. up to 1e15 VND).
  - Net income: signed, same band.
  - Cross-check, if both are present: `eps * outstandingShares ≈ netIncome` within a wide tolerance. If the overview supplies shares, this is the strongest unit check. Make it optional and log-only (do not reject), since many EPS values are trailing-twelve-months or use weighted shares.
- Missing or null fields: reject that period with a reason (e.g. `missing_eps`) rather than storing 0. Do not fill zeros, and do not derive a missing value from another one. A quarter missing any of the four values is recorded as rejected, and the three that did arrive are not stored on their own. Alternative: allow nullable columns. See open question 3.
- EPS and BVPS may be returned as decimals. TCBS may include fractional VND. Round to integer VND with one documented rule; fractional VND is not meaningful and R2 forbids floats.

### 3. Period representation and restatements
- **Format.** Store `period` as text `'2026Q3'`, with `check (period ~ '^[0-9]{4}Q[1-4]$')`.
  - Quarter and year come from separate numeric fields (`quarter`, `year`) in the response; build the string yourself and validate both are integers in range.
  - Do not store the source's own label.
  - Also consider adding `period_end date` as a derived column (calendar quarter end). It makes joins to price dates and "latest period at date X" trivial.
  - The caveat: Vietnamese issuers can have non-calendar fiscal years (rare), and TCBS "quarter 4" is usually the calendar Q4. Document that `period` is TCBS's fiscal-quarter label, treated as calendar-aligned for signals.
- **Possible 5th pseudo-quarter.** Some endpoints return `quarter: 0` for annual rows when `yearly=1` is used. With `yearly=0` I do not expect it, but reject any `quarter` not in 1..4 and count it in `rejected`.
- **Restatements.**
  - Upsert on `(symbol, period)` overwrites with the latest values, so restated figures replace old ones. That is simple and correct for "current truth".
  - But the signals table stores an inputs snapshot (spec F4), so history is already preserved there.
  - Do not add an append-only history table in this ticket (R7). Instead, make restatements visible: when an upsert would change an existing row's values, log the symbol, period and which fields differ.
  - For that, the job reads the stored rows for the symbol first, or the store exposes `listFinancials(symbols)`. This also supports the missing-periods check.
  - Open follow-up: a `financials_history` or `revised_at` column. The STK-005 security review flagged the same concern for prices (a poisoned response rewriting history).
- **Overwrite policy.** Proposal for this ticket: overwrite, with change logging. Ask Ming (open question 4).
- **Order.** Do not rely on response order. Sort by `(year, quarter)` in the adapter, dedupe duplicates for the same period (last one wins, counted in the summary), and drop any row the response returns for a different ticker.
- **Date window.** The response contains many years (`isAll=true`). Keep a configurable look-back (e.g. latest 12-20 quarters), enough for a 4-quarter earnings growth trend plus history. Cap the array length (the STK-005 review noted this gap).

### 4. Sector (decision)
- **Source.** TCBS overview `industry` or `industryEn` (UNVERIFIED). The strings may be Vietnamese ("Ngân hàng") or an ICB-style name.
- **Storage.** Add a nullable `sector text` column to `public.symbols` (with `sector_source text`, `sector_fetched_at timestamptz` if you want R4 on it). Do not create a separate mapping table.
  - The ticket AC says "a symbol→sector mapping". `symbols` is already per-symbol, shared by held and watched symbols, and RLS and grants are already set up, so a column is the smallest change.
  - It also keeps "P/E vs sector" a simple group-by on one table.
  - R4 says every market-data record carries `source` and `fetched_at`. A sector label from an external source is market data, so store `sector_source` and `sector_fetched_at` next to it.
- **Write safely.**
  - Use a dedicated `setSymbolSector(db, symbol, sector, meta)` that upserts only the sector columns and `updated_at`.
  - Never route it through `setSymbolExchange`, and make `setSymbolExchange` unaffected.
  - Supabase `upsert` with only the given columns on conflict updates just those columns, so the `exchange` column survives. Add a test that proves both directions.
  - A blank or null sector from the source must not wipe a known sector, so the caller decides, as in STK-011.
- **Normalisation.** Trim and collapse whitespace, and cap the length (e.g. <= 100) with a `check`. Store the source's label, not a custom taxonomy. Keep a single mapping function so a later switch to ICB codes is local.
- **Peers for "vs sector".** The sector is only useful if enough symbols share it. With a watchlist of a handful of symbols, per-sector medians over the watchlist are noisy. That is a finding for STK-015, not this ticket. Do record it in the ADR.
- **Refresh cadence.** Fetch the profile only when `sector` is null or `sector_fetched_at` is older than a config interval (e.g. 90 days). This saves requests and keeps the job quick.

### 5. `financials` DDL (AC2)
Proposal (new migration with a later timestamp than `20261025000100`, plus a matching rollback):

```sql
create table public.financials (
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
  period text not null check (period ~ '^[0-9]{4}Q[1-4]$'),
  eps bigint not null,
  bvps bigint not null,
  revenue bigint not null,
  net_income bigint not null,
  source text not null,
  fetched_at timestamptz not null,
  primary key (symbol, period)
);
alter table public.financials enable row level security;
revoke all on public.financials from anon, authenticated;
grant select, insert, update, delete on public.financials to service_role;
```

- **Column types.**
  - `revenue` and `net_income` are `bigint` (a large VN company's quarterly revenue is above 2^31 VND by many orders; net income is signed, so no `>= 0` check on it).
  - `eps` and `bvps` are `bigint` too. They fit in `integer` in practice, but `bigint` costs nothing and avoids a surprise.
  - Existing precedent: `corporate_actions.amount_per_share` is `bigint` for a per-share VND value, and `prices_daily` prices are `integer` because they have a hard 10,000,000 cap. EPS has no such cap.
  - Whichever you choose, the migration's check list and the db-check assertion must agree with it.
- **Checks.**
  - `revenue >= 0`. Do not add a sign check to `net_income`, `eps` or `bvps`.
  - Also consider mild sanity `check`s, such as `abs(eps) < 100000000`, but keep the real guard in core. A DB check that is too tight can make the whole upsert chunk fail on one odd row.
- **`period_end date`.** Optional (see section 3). Derive it in core and store it as `not null`.
- **Chunk failure behaviour.** A check violation in one row fails the whole chunk. Core validation must run first and make sure a row can never violate a DB check. That is why core should mirror each DB check.
- **No `created_at` or `updated_at`.** `prices_daily` has none. `fetched_at` is the freshness marker. Add them only if you want first-seen times (cheap; the restatement log may want it). Open question 5.
- **Index.** The PK `(symbol, period)` covers "all periods for a symbol" and "latest period for a symbol" (ordered descending by period text works because the format is zero-padded). No extra index.
- **Sector columns on `symbols`** go in the same migration:
  ```sql
  alter table public.symbols
    add column sector text check (sector is null or length(sector) between 1 and 100),
    add column sector_source text,
    add column sector_fetched_at timestamptz;
  ```
  Add `check ((sector is null) = (sector_source is null))`, or a similar all-or-nothing constraint, so a sector can never exist without provenance (R4).
- **RLS and grants.** Same as `symbols`: enable RLS, revoke from `anon` and `authenticated`, grant to `service_role`, no policies, in the same file. Do not edit the earlier grants migration.
- **Mind the earlier default privileges.** The STK-003 migration revokes default privileges, so a new table is not granted to anon/authenticated by default. Still, state the revoke explicitly, as `symbols` does.

### 6. db:check additions
In `scripts/db-check/checks.sql`:
- Add `financials` to the `tables_exist` array (the array is sorted alphabetically: `assets, corporate_actions, data_gaps, financials, prices_daily, settings, symbols, transactions, watchlist`).
- Column assertions:
  - `financials.eps`, `bvps`, `revenue`, `net_income` are `bigint` and `not null`.
  - `financials.period` is `text` and `not null`.
  - `financials.source` is `text` and `not null`, and `fetched_at` is `timestamp with time zone` and `not null`.
  - Add these to the `source_fetched_at_not_null` block.
  - `symbols.sector`, `sector_source` and `sector_fetched_at` exist and are nullable.
- `rejects_bad_rows`:
  - period `'2026Q5'`
  - period `'26Q1'`
  - lowercase symbol
  - negative revenue
  - duplicate `(symbol, period)` gives SQLSTATE 23505
  - a `sector` with no `sector_source`, if you add that check
  - an empty-string sector
  - (Add positive cases too: a negative EPS and a negative net income must be accepted.)
- `service_role_can_read_write_financials`: insert, select, delete as `service_role`.
- No change needed for RLS, grants or anon-denied loops; they iterate `pg_tables`. But confirm they pass for the new table, because the loop does `insert ... default values` as anon and expects SQLSTATE 42501.
- The existing `no_numeric_or_float_columns` check will fail if anyone picks `numeric` for EPS. Good: it enforces R2.

### 7. Missing periods are recorded, not filled (AC3)
- **Where.** Use `data_gaps` with `data_type = 'financials'`, `symbol` set, `source` = the source name, `fetched_at` = run time, `resolved_at` null. No new table. This matches the spec §5 (`data_gaps`) and the existing columns.
- **Mapping a quarter to the timestamp range.** `from_ts` is the start of the missing quarter and `to_ts` is its end, as Vietnam-time midnight converted to UTC. Define this once in core (e.g. `quarterRangeVn(period)`), with tests.
- **What counts as missing.**
  - An "interior hole": a period between the oldest and newest returned quarters that is absent from the response (e.g. 2025Q4 missing between 2025Q3 and 2026Q1).
  - A rejected period (invalid or missing values) is also recorded as a gap for that quarter, with the reason in logs. Otherwise a quarter with null EPS would vanish silently.
  - "Latest quarter not yet published" is NOT a gap on its own. Companies publish with a lag (VN rules: up to about 30-45 days after quarter end, 90 days for audited annual). Define the expected latest period from config (e.g. `publishLagDays`), so a newest quarter is only expected after quarter-end plus the lag.
  - A symbol with no data at all (new listing, fund certificate, ETF) records one gap covering the look-back window, or better, is reported as `symbolsWithoutData` and recorded as a single gap. Never create rows for a window before the symbol's first period.
- **Never fill.** Do not copy the previous quarter's values, interpolate, or write nulls into `financials`. The medium-term signal rule must treat an absent period as insufficient data (R4: gapped data never produces a signal).
- **Deduplication (important).**
  - `data_gaps` has no unique key, so a daily job would insert the same gap every day. Pick one:
    - (a) A partial unique index in this migration: `create unique index data_gaps_open_uniq on public.data_gaps (symbol, data_type, from_ts, to_ts) where resolved_at is null`, then upsert with `ignoreDuplicates`. The STK-005 consult and the STK-005 follow-ups list both proposed it.
    - (b) Application-side select-then-insert.
  - I recommend (a): it is race-free, which also protects against a manual run overlapping the scheduled one. `symbol` is nullable, so market-wide gaps (symbol NULL) never collide in a unique index (NULLs are distinct). That is fine here because financials gaps always have a symbol. If it must also cover NULL later, use `nulls not distinct` (Postgres 15+) or a coalesce expression index.
  - STK-031 (gap detection for prices) will touch the same table, so tell it about the index. Whoever lands first owns the migration, and the other adapts. Coordinate to avoid two migrations creating the same index.
- **Resolve step.** When a previously-missing period later arrives, set `resolved_at = now()` for the matching open gap. This is required for idempotency and for keeping the table meaningful. It needs the data_gaps repo to expose `resolve`.
- **Repo scope.** A minimal `packages/db/src/repos/data-gaps.ts` with `recordGap`, `listOpenGaps(type, symbols)` and `resolveGap`. If STK-031 is planned to own that repo, STK-014 should only add what it needs, and the planner should flag the overlap. Under R7, the planner must decide who builds it. I recommend STK-014 builds it (it is a hard AC), and STK-031 extends it.
- **Alternative if the planner wants no dependency on gap infrastructure:** put the missing-period list only in the job summary and logs. This fails AC3's "recorded" wording, so I do not recommend it.

### 8. Daily check cadence and idempotency (AC3)
- **Job.** `runFinancialsSync(deps)` in `apps/worker/src/jobs/financials-sync.ts`. It has the same shape as `runEodSync`: store interface, source, `now`, config, `sleep`, `log`, `dryRun`, and returns a summary (`ok`, `symbols`, `periodsFetched`, `rowsUpserted`, `rejected`, `gapsRecorded`, `gapsResolved`, `failedSymbols`, `skippedSymbols`, `sectorsUpdated`, `changedPeriods`).
- **Idempotency.**
  - Upsert on `(symbol, period)` with `onConflict: 'symbol,period'`. Chunked, with duplicates in the input collapsed (later wins), exactly like `upsertPricesDaily`.
  - Re-running yields the same rows apart from `fetched_at`. State that reading of "idempotent" in the plan, as the STK-005 consult did.
  - Optional refinement: skip writing a row whose values are identical to the stored row, so `fetched_at` stays as the last real change. But `fetched_at` is also the "last verified fresh" marker for R4, so I recommend always updating `fetched_at`. One decision to make in the plan.
- **Cadence.**
  - Quarterly data changes about four times a year, so a daily run mostly re-confirms.
  - Recommended: run once per day, but avoid hitting the source for every symbol every day.
  - A cheap rule: fetch a symbol only if its newest stored `fetched_at` is older than `refreshIntervalHours` (config, e.g. 24 h), or if an open gap exists, or if the expected latest period (by `publishLagDays`) is not yet stored.
  - On earnings seasons (the 30-45 days after each quarter-end) a daily fetch is useful. Outside them, a weekly refresh is enough, but a uniform daily run for a handful of symbols is only tens of requests. Simplicity wins: v1 can fetch all scoped symbols daily with a 1 s delay. Tens of requests per day, same load as EOD.
  - Hence: do the simple thing (daily, all symbols), keep the "skip if fresh" rule as a config knob only if the planner wants it.
- **Ordering.** Sort the symbols for deterministic runs.
- **Scheduling.** Same as EOD: a documented cron or compose one-shot, run after the EOD job, e.g. weekday evenings. No scheduler framework (R7). The PC being off is covered by the next daily run.
- **Locking.** The STK-005 follow-ups list "a single-run lock". The partial unique indexes make overlapping runs safe. No lock needed.
- **Exit code and CLI.** Add `financials` as a second job name in `parseArgs` and extend the usage string. Keep the allowlist strict, and keep `--dry-run` (fetch and validate, no writes, no gaps, no sector). Add the documented script, e.g. root `pnpm worker:financials` and `pnpm --filter @stoktok/worker run job financials`, mirroring `eod-prices`. Update `apps/worker/README.md`. The summary JSON goes to stdout and logs to stderr, as in `cli.ts`. Exit non-zero if any symbol failed, was skipped, or had rejected periods.
- **Circuit breaker.** Reuse `maxConsecutiveFailures` (5) via a financials config, not the EOD one.

### 9. Symbol scope
- Same as EOD: `watchlist ∪ held`, normalised through `normalizeSymbol`, deduped and sorted.
- The held-symbols read is `listHeldSymbols(asOf)`, which returns a `Result` (ledger errors are carried, not thrown). Handle `ledgerError` the same way as EOD (mark `ok: false`, continue with the watchlist).
- Extract the union logic into one shared helper rather than copy it. That is a small refactor of `eod-sync.ts`, which falls under R7. Prefer duplicating 10 lines and listing the shared helper in the follow-ups, unless the planner decides otherwise.
- Index symbols, ETFs and fund certificates (e.g. E1VFVN30) have no EPS. Expect empty or rejected responses and treat them as `symbolsWithoutData`, not failures. Do not fail the run (`ok`) because of a legitimately empty symbol. Open question 6 asks how to treat that in `ok`.
- Bank and securities companies have different statement layouts (revenue is "total operating income"). The TCBS ratio endpoint may return a different field set for them. Flag this in the ADR as a known risk for revenue, and make revenue-field rejection per symbol, not a crash.

### 10. Fixtures and no-network guard (AC4)
- **Fixtures.** `apps/worker/test/fixtures/tcbs-financials/`, with a README that is labelled **SYNTHETIC: hand-written from the recalled shape, not recorded**, as the prices README does, and the same curl commands for each endpoint with the honest `stoktok/0.1 (manual check)` UA.
- Files:
  - `ratio-ok.json`: several quarters, unsorted, with decimal billions.
  - `ratio-empty.json`.
  - `ratio-malformed.json`: a null EPS, `quarter: 5`, a string where a number is expected, a duplicate period, a wrong ticker row.
  - `ratio-gap.json`: a missing interior quarter.
  - `ratio-wrong-unit.json`: EPS like 2.5, or revenue 1e12 labelled as billions. The unit guard must reject all of it, and tests should prove it.
  - `overview-ok.json` and `overview-no-industry.json`.
- Mark every synthetic value as such, and do not use real company numbers that could be mistaken for recorded data. Use made-up symbols or clearly fake figures with a `_synthetic: true` comment in the README (JSON has no comments, so the README is the label).
- **Guard.** Reuse `test/no-network.ts` via the existing vitest setup, and do the hardening from the STK-005 security review while here, or at least not weaken it: make the stub non-writable, and also block `node:http`/`https` requests. Adapters take `fetchImpl`, and tests inject a fake one. Keep a test that asserts the guard throws (`tcbs.test.ts:61` is the model).
- **Tests to include.**
  - adapter: URL building, parsing and sorting, unit conversion, rejection reasons, wrong-unit rejection, retry and error classification via `getJson`, ticker mismatch, cap on array length.
  - core normaliser unit tests (R8): negative EPS and net income accepted, null/NaN/string rejected, rounding, safe-integer bound, quarter range mapping.
  - job (with a fake store and fake source): idempotent re-run, interior gap recorded once across two runs, gap resolved when the period arrives, one symbol failing does not stop the others, circuit breaker, dry-run writes nothing, restatement logged, empty symbol not a failure, symbol union.
  - db repos (with the existing `fake-client`): `upsertFinancials` chunking and dedupe, `setSymbolSector` leaves `exchange` untouched and vice versa, gap record/resolve. The fake client already supports upsert, so check it also supports `ignoreDuplicates` and `is(null)` filters for the gap queries before relying on it.

### 11. Security and R-rule notes
- **R3.** The source receives no `db` or env (the same wiring as `cli.ts`). The service key never appears in the summary or logs.
- **R4.** `source` and `fetched_at` on `financials`, on gaps, and on the sector columns.
- **R5.** Configurable: base URL, UA, look-back quarters, publish lag days, plausibility bands, request delay, timeout, retries, upsert chunk size, sector refresh interval.
- **R6** is suspended, and this is a CLI job with no endpoint, so there is nothing to add.
- **Redirects.** Add `redirect: 'error'` to `getJson` (the STK-005 review's open item) in this ticket if the planner accepts it as a shared-code fix; otherwise list it as a follow-up. It is one line and benefits both sources. I recommend including it.
- **Untrusted response.** Validate every field's type before use. Take only fields you expect. Set the stored symbol from the requested ticker, not from the response. Cap array length.
- **ADR.** Write `docs/adr/0002-financials-source.md` (same format as 0001) with: the TCBS decision and risk acceptance (Ming, 2026-10-25), the UNVERIFIED list below, the unit table, the restatement policy, the sector decision, and how to swap the source. No terms page was read. Say so, with the date.

### UNVERIFIED items to list in the ADR (check on first `--dry-run`)
1. Endpoint paths and params (`/tcanalysis/v1/finance/{ticker}/financialratio`, `incomestatement`, `ticker/{ticker}/overview`, `yearly=0`, `isAll=true`).
2. Field names for quarter, year, EPS, BVPS, revenue, net income.
3. Units of revenue and net income (billions VND? raw VND?) and whether EPS is VND per share.
4. Whether EPS is quarterly or trailing four quarters. This matters a lot: P/E from a quarterly EPS must be annualised, while TTM EPS must not be. Store whichever the source gives, and record which in the ADR and in a column comment. Do not let STK-015 guess. Also check whether it is consolidated or parent-only, and basic or diluted.
5. `postTaxProfit` vs net income attributable to parent.
6. Whether response order is newest first.
7. How banks and securities firms report revenue.
8. Overview `industry` string language and granularity.
9. Whether TCBS blocks or throttles after N requests.

## Risks
- **Wrong unit (billions vs VND, or TTM vs quarterly EPS).** This is the largest risk: it silently corrupts the P/E, P/B and growth signals. Mitigation: unit constants, plausibility bands, optional EPS × shares cross-check, a wrong-unit fixture, the first-run `--dry-run` review, and a recorded EPS basis in the ADR.
- **Synthetic fixtures** hide format drift. Label them honestly and replace with recorded captures when someone with network access can.
- **Duplicate gap rows** without the partial unique index (or equivalent dedupe).
- **False gaps** if `publishLagDays` is wrong or a symbol lists late. Bound the expected range by the symbol's first returned period.
- **Restated figures overwrite history silently** unless change logging is in. The signal inputs snapshot preserves what a past signal used.
- **Unofficial endpoint** may change or block with no notice. Ming accepted the risk; the adapter interface limits the blast radius.
- **Scope creep (R7).** A data_gaps repo, a sector column, a shared symbol-union helper and a `redirect` fix all touch other tickets' areas. The planner should list what belongs to STK-014 and what is a follow-up, and tell STK-031 what is being built.
- **Floating-point money.** JS floats multiplied by 1e9 can lose the last digit for large revenue values. `Math.round` plus a safe-integer check handles this; do not accept values above `Number.MAX_SAFE_INTEGER`, and do not compute any financial ratio in the worker (R1).
- **Ticket state.** `ticket.md` has "Input needed (blocking)" for the source. Ming has answered in the Notes (TCBS, 2026-10-25), so the planner should treat it as resolved, not return BLOCKED, and record the answer in the ADR.

## Open questions
1. **EPS basis.** Is TCBS EPS quarterly or trailing-twelve-month, and is it basic or diluted? Only a live capture answers this. Until then, the plan should have STK-015 depend on the ADR's recorded answer, and store the basis in a column comment.
2. **Sector storage.** OK to add `sector`, `sector_source` and `sector_fetched_at` to `symbols` (rather than a separate mapping table)? The ticket AC's wording is "a symbol→sector mapping" and a column on `symbols` satisfies it.
3. **Partial quarters.** If only some of the four values are present for a quarter, should the row be rejected and recorded as a gap (my recommendation), or stored with nullable columns? Nullable columns would contradict "no implicit nulls" for downstream signals.
4. **Overwrite policy.** Should a re-sync be allowed to overwrite stored values with different ones (restatements), with logging only? Or must a history be kept? The ticket and spec say nothing about history.
5. **Audit columns.** Should `financials` have `created_at` / `updated_at`? `prices_daily` has neither.
6. **`ok` and empty symbols.** Should a symbol with no financials (ETF, fund certificate) count against `ok` and the exit code? I recommend no, but it is a policy call.
7. **Who owns the `data_gaps` repo and partial unique index**, STK-014 or STK-031? I recommend STK-014 builds the minimum and tells STK-031.
8. **Look-back depth.** How many quarters does STK-015 need (4 for a growth trend; 8 for YoY and seasonality)? I recommend 12 as the default, in config.
9. **Publish lag.** Is `publishLagDays` = 45 acceptable as the default for "latest quarter expected", or should it differ for Q4/audited periods?
10. **Shared-code changes.** May STK-014 add `redirect: 'error'` to `getJson` and tighten the no-network guard (STK-005 security review items), or do they go to follow-ups?

## Files read (all under /home/user/stoktok)
- Ticket and docs: `work/tickets/STK-014/ticket.md`, `docs/spec-v1.md` (F4, §4.3, §4.4, §5, §9 Q4), `docs/ticket-roadmap.md`, `docs/adr/0001-eod-price-source.md`
- Worker: `apps/worker/src/cli.ts`, `config.ts`, `store.ts`, `sources/price-source.ts`, `sources/tcbs.ts`, `sources/http.ts`, `jobs/eod-sync.ts`, `test/no-network.ts`, `test/fixtures/tcbs/README.md`
- Core and db: `packages/core/src/market/daily-bar.ts`, `packages/db/src/repos/prices-daily.ts`, `packages/db/src/repos/symbols.ts`
- SQL: `supabase/migrations/20261023000100_v1_tables.sql`, `20261023000200_v1_rls_grants.sql`, `20261025000100_symbols.sql`, `supabase/rollback/20261025000100_symbols.down.sql`, `scripts/db-check/checks.sql`
- STK-005 notes: `work/tickets/STK-005/security-review.md`, `consult-data-engineer.md`, `impl-log.md` (grep)

I did not open `packages/db/test/fake-client.ts`. Verify it supports `ignoreDuplicates`, `is`/null filters and `in` before relying on it for the gap repo tests.
