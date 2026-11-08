Status: READY

# Plan — STK-061: Full financial statements and ratios for the AI layer (slice A: income statement + balance sheet lines)

> **Scope of this plan is slice A only** (see `## Split proposal`). Cash-flow lines are gated on a live probe that agents cannot run. Ratios depend on two decisions for Ming. Neither one blocks slice A. Slice A builds the schema, the probe tool and the income/balance pipeline that both later slices reuse.

## Spec summary
- §3 F4: "Medium term (1–6 months) | P/E and P/B vs sector, earnings growth trend, … | Daily OHLCV, quarterly financials". "Signals are suppressed if the underlying data is stale or has gaps."
- §2.2: "Public sources … are **unofficial and can change or break without notice**. Check each source's license and terms for personal use." "Gaps must be detected, not silently interpolated."
- §4.3: "One interface per data type (`PriceSource`, `FinancialsSource`, `NewsSource`); each implementation is swappable." "Every record stores `source` and `fetched_at`."
- §4.4: "Financials sync | Daily check, quarterly updates".
- §5: "`financials` | symbol, period, eps, bvps, revenue, net_income, source". "`data_gaps` | symbol, from_ts, to_ts, detected_at".
- §7: "`worker` must tolerate restarts: jobs are idempotent and resume from last successful run."
- §9 open question 4: "Primary and fallback data sources after license/terms check." ADR 0005 answers this for `vci-iq`.
- CLAUDE.md R2 ("Money and prices are integers in VND … Rounding rules are defined once in `packages/core`"), R4 ("Every market-data record carries `source` and `fetched_at`. Stale or gapped data never produces a signal; gaps are recorded."), R5 ("Market rules are configuration").
- Ticket note (Ming, 2026-11-08): "Read financial reports via structured API data first. PDF reading is a later ticket."

## Acceptance criteria → verification
Ticket ACs, scoped to slice A. Parts deferred to slices B/C are marked; the reviewer does not verify them in this slice.

| # | Criterion (slice A part) | How the reviewer verifies it |
|---|---|---|
| 1a | For each watchlist + held symbol, the worker stores **quarterly and annual** income-statement lines (revenue, gross profit, operating profit, profit before tax, net income attributable to the parent) and balance-sheet lines (total assets, total liabilities, equity, cash, short- and long-term borrowings). Each row has `source` and `fetched_at` (R4). | `financial-statements-sync.test.ts › writes quarter and year lines for watchlist + held symbols with source and fetched_at`; `vci-iq-statements.test.ts › HPG (CT) maps all 12 lines from the recorded fixture, quarters and years`; values asserted against the recorded fixture numbers. |
| 1b | *(Deferred to slice C)* Cash flow: operating cash flow, capex, free cash flow. | Not verified in slice A. Slice A must deliver `scripts/probe-vci-iq-cashflow.sh` (reviewer: `bash -n`, read-through against the rules in Approach step 7) and the `statement = 'cashflow'` value allowed in the schema. |
| 2 | *(Deferred to slice B)* Ratios. | Not verified in slice A. No ratio code and no `financial_ratios` table in this diff (R7). |
| 3 | Uses the existing VCI adapter pattern, with a recorded fixture and a terms check noted in the plan. No PDF parsing. | New `FinancialStatementsSource` interface next to `FinancialsSource` in `financials-source.ts`, implemented by `VciIqFinancialsSource`. Trimmed fixtures from the real recordings in `apps/worker/test/fixtures/vci-iq/statements/` with a README entry. Terms check: see Approach step 8 and ADR 0007. `grep -ri pdf apps/worker/src packages/core/src` finds nothing new. |
| 4 | Idempotent sync (upsert on symbol + period + statement line). A missing period or line is recorded as a gap, never written as 0 (R4). | `financial-lines.test.ts › upsert dedupes by symbol,period_kind,period,line and uses that onConflict`; `financial-statements-sync.test.ts › second run writes the same rows except fetched_at and records no new gaps`; `› a mapped line missing in a period writes no row for it and records a period gap`; `› a not-applicable line (null in the type map) writes no row and no gap`; `statement-lines.test.ts › zero on a zero-is-missing line is treated as missing`. |
| 5 | Migration has RLS on and service_role-only grants, matching existing tables, plus a rollback file. | Read the migration and rollback. `scripts/db-check.sh` passes with the updated `checks.sql` (table list, column shapes, service_role read/write, negative inserts). The existing `rls_enabled_all_tables` and `no_grants_anon_authenticated_public` checks cover the new table. |
| 6 | `typecheck`, `lint`, `test` green, with unit tests for the mappers. | `pnpm typecheck && pnpm lint && pnpm test`. Tests listed below exist and pass. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `supabase/migrations/20261108000100_financial_lines.sql` | Create `public.financial_lines` + RLS + grants (schema in Approach step 1) | AC1, AC4, AC5 |
| `supabase/rollback/20261108000100_financial_lines.down.sql` | `drop table if exists public.financial_lines;` only | AC5 |
| `scripts/db-check/checks.sql` | Add `financial_lines` to the `tables_exist` list (line 34); column-shape asserts; service_role read/write; negative inserts | AC5; the explicit table list would fail otherwise (consult-database-optimizer finding 4) |
| `packages/core/src/market/statement-lines.ts` | Line registry (line → statement, `nonNegative`, `zeroIsMissing`), `normalizeStatementLines()`, year helpers (`yearBounds`, `latestExpectedYear`, `planAnnualGaps`), gap type constants | R1/R2/R4/R5: conversion, guards and gap math in core |
| `packages/core/src/market/statement-lines.test.ts` | Unit tests | AC6, R8 |
| `packages/core/src/market/config.ts` | Add `DEFAULT_STATEMENT_LINES_SANITY` (reuses `maxAbsTotalVnd`) | R5 |
| `packages/core/src/index.ts` | Export the new symbols | Used by worker |
| `packages/db/src/rows.ts`, `packages/db/src/mappers.ts`, `packages/db/src/index.ts` | `FinancialLineRow/Insert`, `FinancialLineRecord`, mapper, exports | Typed repo |
| `packages/db/src/repos/financial-lines.ts` | `listFinancialLines(db, symbols, periodKind, fromPeriod)`, `upsertFinancialLines(db, rows, {chunkSize})` | AC4 |
| `packages/db/src/repos/financial-lines.test.ts` | Repo tests (fake client, as in `financials.test.ts`) | AC6 |
| `apps/worker/src/sources/financials-source.ts` | Add `FinancialStatementsSource` interface + `StatementsResult` types (Approach step 3) | AC3; keeps `FinancialsSource`/`fetchQuarterly` and TCBS untouched |
| `apps/worker/src/sources/vci-iq-financials.ts` | `VCI_IQ_STATEMENT_FIELDS_BY_COMPANY_TYPE`; `fetchStatements(symbol)`; a year-row parser; response cache shared with `fetchQuarterly` | AC1, AC3 |
| `apps/worker/src/sources/vci-iq-statements.test.ts` | Mapper/adapter tests on the new fixtures | AC3, AC6 |
| `apps/worker/test/fixtures/vci-iq/statements/{hpg,vcb,vnd,bmi}-{income,balance}.json` | Trimmed copies of the real recordings in `work/tickets/STK-039/live-samples/` (HPG) and `work/tickets/STK-042/live-samples/` (VCB, VND, BMI). Quarters + years from 2022 on; identifying fields + mapped codes + `isa20`/`isa21` only; values unchanged | AC3 recorded fixture |
| `apps/worker/test/fixtures/vci-iq/README.md` | Add an STK-061 section that says what was trimmed and where it came from | Provenance of fixtures |
| `apps/worker/src/jobs/financial-statements-sync.ts` | New job `runFinancialStatementsSync` | AC1, AC4 |
| `apps/worker/src/jobs/financial-statements-sync.test.ts` | Job tests with an in-memory store | AC4, AC6 |
| `apps/worker/src/config.ts` | `FINANCIAL_STATEMENTS_SYNC_CONFIG` (Approach step 5) | R5 |
| `apps/worker/src/config.test.ts` | Assert the new config defaults | Same pattern as existing config tests |
| `apps/worker/src/store.ts` | `createDbFinancialStatementsStore(db, opts)` | Wires repos to the job |
| `apps/worker/src/cli.ts`, `apps/worker/src/cli.test.ts` | New job name `financial-statements` (accepts `--dry-run` only; `--source`/`--backfill` → usage) | Runnable job |
| `apps/worker/package.json` (+ root `package.json` if `worker:financials` is defined there) | Add `worker:financial-statements` script mirroring `worker:financials` | Ming's dry-run command |
| `apps/worker/README.md` | Document the job, dry-run, and that it is **not scheduled yet** | Ops |
| `scripts/probe-vci-iq-cashflow.sh` | Live probe Ming runs (Approach step 7) | Unblocks slice C; the cash-flow fixture source |
| `docs/adr/0007-vci-iq-statement-lines.md` | Endpoint use, line codes per company type, units, "not applicable" vs gap, terms posture, open cash-flow probe | AC3 terms note; ADR 0005 is the pattern |

Not touched: `public.financials` and its migration/repo, `runFinancialsSync`, `TcbsFinancialsSource`, `medium-signals.ts`, `deploy/**` (scheduling is a follow-up, see Assumptions).

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `statement-lines.test.ts › registry: every line belongs to exactly one statement; names match ^[a-z][a-z0-9_]{1,63}$` | Registry integrity (DB regex parity) |
| `› normalizeStatementLines converts floats to integer VND half away from zero (positive and negative)` | R2 via `toVndAmount` |
| `› missing / null / non-number / non-finite value → line reported missing, no value` | R4 |
| `› zero on a zeroIsMissing line (revenue, total_assets, equity_total) → missing; zero on borrowings → stored 0` | R4 (no placeholder zeros) |
| `› negative value on a nonNegative line → rejected as out_of_band; negative profit kept` | Unit guards |
| `› abs value above maxAbsTotalVnd → rejected out_of_band` | Re-scaling guard |
| `› field map entry null → line not applicable: not in values, not in missing` | Not applicable is not a gap |
| `› unknown line in a field map → throws at definition check (assertFieldMap)` | Map integrity |
| `› yearBounds('2025') spans 2025-01-01T00:00+07:00 .. 2025-12-31T23:59:59+07:00` | Annual gap bounds |
| `› latestExpectedYear respects annualPublishLagDays (e.g. 2026-03-31 → 2024 with 120 days, 2026-05-01 → 2025)` | Annual publish lag |
| `› planAnnualGaps records missing years in window, resolves open gaps whose year is present, expects nothing for a symbol with no known year` | Annual gap planning |
| `vci-iq-statements.test.ts › HPG (CT) maps all 12 lines from the recorded fixture for a quarter and a year (exact values)` | AC1, AC3 |
| `› HPG fixture identity: total_assets = total_liabilities + equity_total (±1 VND) for every period` | Code correctness on real data |
| `› HPG fixture: gross_profit ≤ revenue; minority_interests ≤ equity_total` | Sanity on real data |
| `› VCB (NH), VND (CK), BMI (BH) map only their non-null lines; not-applicable lines absent and not in missing` | Company-type holes |
| `› a mapped code removed from one quarter → that line in missing for that period, other lines kept` | AC4 |
| `› year rows (lengthReport 5) become period_kind 'year' with period 'YYYY'; quarter rows unchanged` | Annual |
| `› duplicate period → dropped and rejected duplicate_period (quarter and year)` | Existing parse semantics |
| `› unsupported comTypeCode → all periods rejected unsupported_company_type` | Existing reject path |
| `› fetchStatements after fetchQuarterly on the same instance reuses income/balance/details responses (GET count)` | Request volume |
| `› 403 → SourceError 'no bypass'; 404 → empty result` | ADR 0005 posture |
| `› revenue and net_income_parent equal the values fetchQuarterly emits for the same HPG period` | Consistency with `financials` (consult-database-optimizer rec. 5) |
| `financial-statements-sync.test.ts › writes quarter and year lines for watchlist + held symbols with source and fetched_at` | AC1 |
| `› second run writes the same rows except fetched_at and records no new gaps` | AC4 idempotency |
| `› a mapped line missing in a period writes no row for it and records a period gap (data_type financial_lines)` | AC4 |
| `› a missing year records a gap with data_type financial_lines_annual and year bounds` | AC4 annual |
| `› a not-applicable line writes no row and no gap` | Not applicable is not a gap |
| `› a gap resolves when all mapped lines of the period are present (stored or fetched)` | Gap lifecycle |
| `› changed stored value is reported in restated as 'SYM 2026Q2: gross_profit'` | Restatement log |
| `› dry run writes nothing and still reports missing periods` | Existing convention |
| `› unsupported company type is reported, not failing; fetch error fails the run; circuit breaker after maxConsecutiveFailures` | Run health |
| `› upsert happens before gap insert` | Crash ordering |
| `› ledger error on listHeldSymbols is reported and fails the run` | Same as `runFinancialsSync` |
| `financial-lines.test.ts › list filters symbols in, period_kind eq, period gte; empty symbols → no query` | Repo |
| `› upsert dedupes by full key (last wins), chunks, onConflict 'symbol,period_kind,period,line', no select` | AC4 |
| `cli.test.ts › financial-statements and --dry-run accepted; --source and --backfill rejected` | CLI |
| `config.test.ts › FINANCIAL_STATEMENTS_SYNC_CONFIG defaults` | R5 |

## Approach
1. **Migration (High tier).** `public.financial_lines`:
   - `symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$')`
   - `period_kind text not null check (period_kind in ('quarter','year'))`
   - `period text not null`, plus the table check `(period_kind = 'quarter' and period ~ '^[0-9]{4}Q[1-4]$') or (period_kind = 'year' and period ~ '^[0-9]{4}$')`
   - `statement text not null check (statement in ('income','balance','cashflow'))`. `cashflow` is allowed now so slice C needs no migration.
   - `line text not null check (line ~ '^[a-z][a-z0-9_]{1,63}$')`
   - `value bigint not null`, with no sign check
   - `source text not null check (source <> '')`, `fetched_at timestamptz not null`
   - `primary key (symbol, period_kind, period, line)`. No FK and no secondary index.
   - Column comments: VND integer (R2); period is the source fiscal label treated as calendar; "a missing line is a missing row, never 0 (R4)"; `operating_profit` is the VAS "Lãi/(lỗ) từ hoạt động kinh doanh", **not EBIT**; `*_borrowings` are "Vay" lines only and may exclude bonds/leases.
   - RLS on, `revoke all … from anon, authenticated`, `grant select, insert, update, delete … to service_role`, in the same file. Add the comment that the `20261023000200` grants loop does not cover later tables.
2. **Core (R1, R2, R5).** `statement-lines.ts`:
   - `STATEMENT_LINES` registry. income: `revenue`, `gross_profit`, `operating_profit`, `profit_before_tax`, `net_income_parent`. balance: `total_assets`, `total_liabilities`, `equity_total`, `minority_interests`, `cash_and_equivalents`, `short_term_borrowings`, `long_term_borrowings`. Flags: `nonNegative` for assets, liabilities, cash, borrowings and minority; `zeroIsMissing` for revenue, total_assets and equity_total.
   - `normalizeStatementLines(row, fieldMap, unit, sanity)` → `{ values: {line, statement, value}[], missing: line[], rejected: {line, reason}[] }`. It is pure and never throws. Conversion goes only through `toVndAmount`.
   - `FINANCIAL_LINES_GAP_TYPE = 'financial_lines'` and `FINANCIAL_LINES_ANNUAL_GAP_TYPE = 'financial_lines_annual'`. These are separate from `'financials'`, so `medium-signals` and the web symbol page are unaffected.
   - `yearBounds`, `latestExpectedYear(todayVn, annualPublishLagDays)`, and `planAnnualGaps`, which mirrors `planFinancialGaps` for years. Quarters reuse `planFinancialGaps` and `quarterBounds` unchanged.
3. **Adapter.**
   - In `financials-source.ts`, add `FinancialStatementsSource { name; fetchStatements(symbol): Promise<StatementsResult> }`.
   - `StatementsResult = { companyType: string | null; expectedLines: string[]; periods: { periodKind: 'quarter' | 'year'; period: string; values: …; missing: string[] }[]; rejected: RejectedPeriod[] }`.
   - `VciIqFinancialsSource` implements it. TCBS does not, so no change there.
   - `VCI_IQ_STATEMENT_FIELDS_BY_COMPANY_TYPE: Record<'CT'|'NH'|'CK'|'BH', Record<Line, string | null>>`, where `null` means not applicable. The codes below were checked by the planner against the recorded `/metrics` dictionaries in `work/tickets/STK-039|042/live-samples/`:

     | Line | CT | NH | CK | BH |
     |---|---|---|---|---|
     | revenue | isa3 | isb38 | isa1 | isi64 |
     | gross_profit | **isa5** | null | null | null |
     | operating_profit | isa11 | null | null | null |
     | profit_before_tax | isa16 | isa16 | **null** (the VND dictionary lists `isa16` twice: PBT and tax expense; ambiguous) | isa16 |
     | net_income_parent | isa22 | isa22 | isa22 | isa22 |
     | total_assets | bsa53 | bsa53 | bsa53 | bsa53 |
     | total_liabilities | bsa54 | bsa54 | bsa54 | bsa54 |
     | equity_total | bsa78 | bsa78 | bsa78 | bsa78 |
     | minority_interests | bsa210 | bsa210 | bsa210 | bsa210 |
     | cash_and_equivalents | bsa2 | **null** (bsa2 = "Cash and precious metals" for banks) | bsa2 | bsa2 |
     | short_term_borrowings | **bsa56** | null | null | null |
     | long_term_borrowings | **bsa71** | null | null | null |

     Implementer: assert each non-null code is present with a numeric value in the trimmed fixture. If it is not, set it to `null`, record why in `impl-log.md` and ADR 0007, and do not guess another code.
   - `fetchStatements`: get the income and balance responses through a per-instance promise cache keyed by `(symbol, endpoint)`, in the same way as `loadDetails`. `fetchQuarterly` uses the same cache, so a shared instance makes no extra GETs. Keep the 1 s pause between real GETs, the 403 no-bypass rule and 404 = no data.
   - Parse quarters with the existing `parse()`. Add a sibling `parseYears()` for `data.years` (`lengthReport === 5` → period `String(yearReport)`), with the same duplicate, ticker and size rules.
   - Keep the latest `maxQuarters` quarters and the latest `maxYears` years. Resolve the company type through `details`, as `fetchQuarterly` does.
4. **Job.** `runFinancialStatementsSync(deps)` follows `runFinancialsSync` step by step:
   - Symbol set: watchlist + `listHeldSymbols`, normalized and sorted.
   - Windows: quarters `latestExpectedPeriod(publishLagDays)` back `lookbackQuarters`; years `latestExpectedYear(annualPublishLagDays)` back `lookbackYears`.
   - Read the stored lines per kind. Fetch per symbol, with a sleep between symbols and the consecutive-failure breaker.
   - Restated = per-line value change vs stored.
   - A period is **present** when every non-null mapped line for the symbol's type is stored or fetched-valid. A period is **known** when it was fetched, stored or rejected with a period. Plan gaps with `planFinancialGaps` (quarters) or `planAnnualGaps` (years).
   - Write the upsert first, then the gap insert, then the gap resolve. Do this only when not dry-run.
   - The summary mirrors `FinancialsSummary` fields where they apply, plus `linesUpserted`, `missingLines: Record<symbol, string[]>` ('2026Q2:gross_profit') and `missingYears`.
   - Rejects with reasons in `nonFailingRejectReasons` and out-of-window rejects do not fail the run.
5. **Config (R5).** `FINANCIAL_STATEMENTS_SYNC_CONFIG = { ...shared fields from FINANCIALS_SYNC_CONFIG (timeouts, attempts, backoff, requestDelayMs, maxConsecutiveFailures, publishLagDays, lookbackQuarters, nonFailingRejectReasons, upsertChunkSize, maxPeriodsPerResponse), maxQuarters: 16, lookbackYears: 5, maxYears: 6, annualPublishLagDays: 120 }`. The 120 days covers the 90-day audited annual report deadline plus slack.
6. **CLI / store.** The `financial-statements` job builds `VciIqFinancialsSource` directly with `VCI_IQ_CONFIG` and `createDbFinancialStatementsStore`, and prints the JSON summary. Exit code is 1 when not ok. **It is not added to `deploy/**/run-schedule.sh`** in this slice (Assumption 3).
7. **Probe script (gate for slice C).** `scripts/probe-vci-iq-cashflow.sh [OUT_DIR] [SYMBOL...]`:
   - Defaults: OUT_DIR `work/tickets/STK-061/live-samples`, symbols `HPG VCB VND BMI`.
   - POSIX bash 3.2 and `set -u`.
   - For each symbol: `curl -sS --compressed -A "<VCI_IQ_CONFIG.userAgent, same string>" -H 'Accept: application/json' -o OUT/<SYM>_financial-statement_section_CASH_FLOW.json -w '%{http_code}'` against `{base}/<SYM>/financial-statement?section=CASH_FLOW`.
   - `sleep 1` between calls. Append `<SYM> <status> <utc time>` to `OUT/probe.log`. On 403, stop immediately and do not retry. Other non-200 statuses are logged and the script moves on.
   - No cookies, Origin, Referer or browser UA. No secrets.
   - The script prints a reminder to commit the files and to answer the slice C questions.
   - Agents do not run it (Assumption 2). Ming runs it once from his machine, as with the STK-039/042 probes.
8. **Terms check (AC3).** No new host and no credentials. It is the same `iq.vietcap.com.vn` IQ API as ADR 0005, which records "unofficial internal API, no terms found, no SLA" and decision 4: "Terms risk accepted by Ming on 2026-11-01 … unofficial internal API, personal low volume, honest headers only."
   - Added volume: the new job makes 3 GETs per symbol (income, balance, details) when run on its own, or 0 extra when it shares an instance with `fetchQuarterly`. The probe makes 4 one-off GETs. Slice C will add 1 GET per symbol.
   - ADR 0007 records this. It does **not** claim a terms page was read.
9. **ADR 0007.** Record: line registry and per-type code table; units (full VND floats → integer VND); not-applicable vs gap; the VND `isa16` ambiguity; "operating profit ≠ EBIT"; borrowings exclude bonds/leases; consolidated-basis status (unverified unless the fixture shows it); annual rows taken from `years[]` as published and never summed from quarters; the open cash-flow questions for slice C.

Rules: R1 (all conversion, guards and gap math in core), R2 (`toVndAmount` only), R4 (source + fetched_at on every row; missing line = no row + gap), R5 (lags, windows, sanity, field maps in config/constants), R7 (no ratios, no cash flow, no scheduling in this diff), R8 (tests above), R3/R6 unaffected (worker only, service role server-side), R10 unaffected.

## Specialist input used
- **data-engineer**:
  - Adopted: use `vci-iq`, not TCBS; separate job (open question 7); reuse responses via a cache (rec. 3); per-type field map with `null` = not applicable (rec. 3); a separate gap `data_type` (rec. 5); upsert before gaps; restatement per line; probe first for cash flow (rec. 1); terms note and new ADR (rec. 7).
  - Rejected: these codes are wrong in the recorded dictionary: `isa4` is "Cost of sales" (gross profit is `isa5`), `bsa64` is "Other payables" (short-term borrowings is `bsa56`), and long-term borrowings is `bsa71`, not `bsa70`.
  - Rejected: adding a method to `FinancialsSource` itself. A sibling interface avoids changing TCBS.
- **database-optimizer**:
  - Adopted: long table, `financial_lines` naming, `period_kind` + tied period check, `statement` out of the PK, `line` regex with the registry in core, bigint without sign check, RLS/grants in file, rollback, `checks.sql` update, no FK/index, `net_income_parent` name, `'year'` gap type with a publish lag, repo filters `period_kind` first.
  - Deferred to slice B: `financial_ratios`.
  - Partly adopted: writing `financials` and `financial_lines` "in the same run". They are separate jobs, but they share the response cache when they share an instance, and a consistency test pins revenue/net income equality on the fixture.
- **finance-investment-researcher**:
  - Adopted: not applicable ≠ gap (rec. 4); operating profit ≠ EBIT documented; debt = borrowings, never total liabilities; annual rows stored as published, never summed (rec. 6); identity tests on fixtures (rec. 8, the balance-sheet part); YTD cash-flow risk drives the slice C gate (rec. 5).
  - Deferred to slice B: ratio definitions (rec. 3) and the unit question (rec. 1).
  - Deferred as follow-ups (R7): extra lines (interest expense `isa8`, HTM investments, associates, bank NII/provisions) (rec. 7) and the consolidated-basis check (rec. 9).

## Assumptions
1. **Ratio unit — default ppm, for Ming to confirm (applies to slice B, not this diff).** The ticket says "integer basis points". All existing core ratio code uses ppm (`growthThresholdPpm`, `minBasePpmOfRevenue`, `mulDiv(…, PPM)`). Default: store every ratio as value × 1,000,000 (`value_ppm`), with one scale constant in core, so 18% ROE = 180,000 and D/E 1.5 = 1,500,000. Reason: one unit across core avoids off-by-100 bugs between signals and stored ratios (R2, "rounding rules are defined once"). This changes AC2's wording, so the orchestrator should publish a `decision` issue (reversible, 24 h default) before slice B starts. If Ming picks bps, slice B uses `value_bp` / 10,000 and nothing in slice A changes.
2. **Live probe.** Agents do not make live calls from this environment. The cash-flow probe is a human step: Ming runs `scripts/probe-vci-iq-cashflow.sh` once and commits the output. Slice C is planned only after the samples exist. Slice A needs no new live data: the income/balance fixtures are trimmed from responses already recorded on 2026-11-01 (STK-039) and 2026-11-04 (STK-042).
3. **No scheduling in this slice.** The new job is runnable (`pnpm worker:financial-statements --dry-run`) but is not added to `deploy/deployment-repo/apps/stoktok/run-schedule.sh`. Reasons: that file is production deploy config, and the job must not run before the High-tier migration is applied. The follow-up is a `debt` issue: "schedule `financial-statements` after migration 20261108000100 is applied and a dry-run is clean."
4. **Human gate.** Workspace `CLAUDE.md` §8 lists "PLAN approval for … tickets touching High paths". The project `CLAUDE.md` says "No human gate between PLAN and IMPLEMENT (Ming's decision)". This plan includes a DB migration (High). The orchestrator applies whichever rule governs; the planner does not resolve it. Either way, the PR is High tier and Ming reviews it.
5. Lines that are not mapped for a company type (`null`) produce neither rows nor gaps. The AI layer (STK-064/066) must say "not available" for absent lines. A `debt` issue covers mapping more NH/CK/BH lines and the VND `isa16` ambiguity.
6. `revenue` for NH is `isb38` ("Tổng thu nhập hoạt động"), consistent with ADR 0005. ADR 0007 documents that it is not "revenue" in the corporate sense.
7. A source value of 0 is stored as 0 except on `zeroIsMissing` lines. VietCap uses placeholder zeros (e.g. `isa23` in Q1/Q3, STK-039 probe).
8. Restated values overwrite stored ones (ADR 0002 policy). There is no history table; the restatement goes into the summary log.
9. Size: roughly 650 lines of non-test code plus about 700 lines of tests and fixture JSON. This is over the ~400 guide, mostly because of tests. Splitting further would put the schema and the pipeline that fills it into separate High-tier PRs, which costs Ming more review time than it saves.

## Blocking questions
None for slice A.

Questions to publish as `decision` issues now, so they are answered before slices B and C (defaults stated; all reversible):
1. **Ratio unit.** ppm or bps? Default: **ppm** (Assumption 1).
2. **P/E and P/B.** AC2 says "stored". Options: (a) compute in core on read from stored TTM EPS / BVPS and the latest stored close, with P/E only after `VCI_IQ_FINANCIALS_EPS_BASIS` is `'ttm'`; (b) store vendor `pe`/`pb` from `statistics-financial` with `basis = 'source'`. Default: **(a)**. Both consults that addressed it prefer it, ADR 0005 already ignores vendor pe/pb, and stored price ratios go stale daily. This changes AC2's "stored" wording for these two ratios.
3. **D/E.** Default: (short-term + long-term borrowings) / total equity incl. minority, CT only. NH/CK/BH not applicable.
4. **ROE/ROA.** Default: TTM parent net income / two-point average (P and P−4) of parent equity (`bsa78 − bsa210`) / total assets. Null when either end is ≤ 0 or missing. Cross-check against vendor `roe` in tests only.
5. **Cash flow (after the probe).** If VietCap quarters are YTD-cumulative, default: de-cumulate in core (Qn − Qn−1 within the fiscal year, Q1 as is). A missing earlier quarter makes the later one a gap. FCF = CFO − |capex| (`cfa18`, `cfa19` per the recorded dictionary, values unverified).

## Split proposal
The full ticket covers three features with different readiness, so it is split:
- **Slice A (this plan):** `financial_lines` schema (cashflow statement value allowed), core line registry/guards/annual gaps, VCI income + balance lines (quarters and years, four company types), new `financial-statements` job + CLI, fixtures, ADR 0007, and the cash-flow probe script. Covers ticket AC1 (income + balance part), AC3, AC4, AC5, AC6.
- **Slice B (new ticket):** `financial_ratios` table migration (unit per decision 1, `basis` = `source` | `derived`); core ratio derivations with tests (gross/net margin, D/E, ROE, ROA, YoY revenue and net income reusing the `growth.ts` base rules; P/E and P/B per decision 2). Covers AC2. Depends on slice A data and decisions 1–4.
- **Slice C (new ticket):** cash-flow lines (`operating_cash_flow`, `capex`, derived `free_cash_flow`) in `fetchStatements` and the registry, with the de-cumulation rule per decision 5. Fixture from the probe output. Covers AC1 (cash-flow part). **Gated on Ming running `scripts/probe-vci-iq-cashflow.sh`** and committing the samples to `work/tickets/STK-061/live-samples/`.

The orchestrator should create the slice B and C tickets (or amend this ticket's ACs) so that STK-061 can reach DONE on slice A without the reviewer failing it for AC1b/AC2.
