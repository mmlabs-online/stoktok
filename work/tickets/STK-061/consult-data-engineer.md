STK-061 consult (data-engineer, read-only). Nothing was fetched live: I only read the repo and the recorded VCI IQ samples. Items marked UNVERIFIED need the live probe in Recommendation 1.

## Findings

**Source and endpoints**
- The current default source is `vci-iq` (ADR 0005, Ming, 2026-11-01). TCBS public has been blocked by a Cloudflare 403 since 2026-11-01, so it is not a viable base for STK-061. Keep `--source tcbs-public` only as a legacy option.
- The `/financial-statement?section=...` endpoint already serves INCOME_STATEMENT and BALANCE_SHEET, as `data.quarters[]` plus `data.years[]`. `vci-iq-financials.ts` ignores `years`.
- The recorded `/financial-statement/metrics` dictionary lists a `CASH_FLOW` section next to INCOME_STATEMENT, BALANCE_SHEET and NOTE. No sample or probe note shows an actual `section=CASH_FLOW` response. `section=CASH_FLOW` is UNVERIFIED. I assume it works by analogy, but that is not proof.
- In the dictionary of the STK-039 sample for HPG (type `CT`), income and balance codes are present:

| Line | Code | Verified |
|---|---|---|
| Gross profit | `isa4` | dictionary entry seen |
| Operating profit | `isa11` ("Lãi/(lỗ) từ hoạt động kinh doanh") | dictionary entry seen |
| Parent net income | `isa22` | already in use |
| Cash and cash equivalents | `bsa2` | dictionary entry seen; I read `bsa1` as the "cash and equivalents" parent group, so confirm which one the AC means |
| Total assets | `bsa53` | dictionary entry seen |
| Short-term borrowings | `bsa64` (parent `BSA55`) | dictionary entry seen |
| Long-term borrowings | `bsa70` (parent `BSA67`) | dictionary entry seen |
| Equity | `bsa78` | already in use |
| Minority interests | `bsa210` | already in use |

  - `bsa64`/`bsa70` are only the "Vay ngắn/dài hạn" lines. They may exclude finance leases or bonds, which can sit under separate codes.
  - Profit before tax, total liabilities and the cash-flow lines are UNVERIFIED as codes. The `cfa*` codes seen (`cfa9`, `cfa18`, `cfa33`, `cfa35`–`cfa38`) are only subtotals and cash-balance lines. Operating cash flow and capex ("Purchase of fixed assets") were not confirmed.
  - Total liabilities is a level-1 line next to `bsa53`. It is probably `bsa54`, but verify it; `total assets - equity` is a derivable fallback.
- Ratios come from `GET {base}/{SYMBOL}/statistics-financial`, `ratioType: 'RATIO_TTM'`. Its rows carry `pe`, `pb`, `roe`, `roa`, `grossMargin`, `afterTaxProfitMargin`, `debtToEquity`, `debtPerEquity`, `ebit`, `ebitda`, `roic`, `marketCap`, `numberOfSharesMktCap`, `ps` and others, plus bank-only fields (`npl`, `car`, `casaRatio`, `loansGrowth`, ...).
  - These ratios are TTM, as the `ratioType` says.
  - `ownersEquity` in that response is a ratio, not an amount (the STK-039 probe note says "e.g. 0.18").
  - Units of `roe`, `roa` and the margins are UNVERIFIED. They look like fractions (0.18 means 18%) but this is not confirmed.
  - There is no YoY growth field in this response.

**Units**
- Statement amounts are full VND floats, so `VCI_IQ_FINANCIALS_UNITS = { totals: 'VND' }`, converted by `toVndAmount` with half-away-from-zero rounding.
- Ratios must become integer basis points (AC2). That needs a new single conversion in `packages/core`, for example `toBasisPoints(fraction)`, where `bp = round(x * 10000)`. The same unit-guard approach should reject an out-of-band value instead of storing it.
- Cash flow may be YTD-cumulative. In Vietnamese reporting, cash flow is usually filed cumulatively (3m, 6m, 9m, 12m), and IQ's `quarters[]` may return either a discrete quarter or the cumulative figure. This is UNVERIFIED and is the biggest data-correctness risk in the ticket. The fix is a probe. Check whether Q2 operating cash flow is about equal to Q1 + Q2 discrete. If it is cumulative, derive discrete quarters in core (Q2 minus Q1, and so on) and require every earlier quarter of the year, otherwise record a gap.

**Existing extension points**
- `financials` is one row per `(symbol, period)` with four NOT NULL columns (`eps`, `bvps`, `revenue`, `net_income`). Quarterly only. `period` matches `^[0-9]{4}Q[1-4]$`, so annual rows cannot go in the same table or the same key.
- `FinancialsSource` has `fetchQuarterly` and `fetchSector`. `runFinancialsSync` treats a period as valid only if all four values are valid. It rejects the whole quarter otherwise.
- `parse()` skips year rows (`lengthReport === 5`) silently.
- The gap machinery already handles one `data_type` (`FINANCIALS_GAP_TYPE`) at quarter granularity.
- `restated` detection is hard-coded to `FIELDS = ['eps','bvps','revenue','netIncome']`.
- `deriveVciIqQuarter` already derives TTM EPS and BVPS in core. P/E needs `VCI_IQ_FINANCIALS_EPS_BASIS`, which is still `'unverified'` (P/E suppressed). The ADR 0005 cross-check shows a ±0.07% worst case on four symbols, so that flip is still waiting.
- The existing company-type split (`CT`, `NH`, `CK`, `BH`) matters. The ticket's lines (gross profit, capex, debt) mostly do not exist for banks, brokers and insurers.

## Recommendations

1. **Probe first (before writing the plan).** Run one throwaway live probe, as in STK-039/042, and store the responses under `work/tickets/STK-061/live-samples/`. Do this for HPG (`CT`) plus VCB (`NH`), and ideally VND (`CK`) and BMI (`BH`). The AC says "recorded fixture", so this is also the fixture capture. The probe should answer:
   - Does `section=CASH_FLOW` return `quarters[]`, and are its values discrete or cumulative?
   - What are the exact codes for profit before tax, total liabilities, operating cash flow and capex?
   - What is the `statistics-financial` scale of `roe`, `roa`, `grossMargin`, `afterTaxProfitMargin` and `debtToEquity`?
   - Does `years[]` carry usable annual values? Is a cash-flow annual figure equal to the sum of its quarters?
   - The honest-User-Agent-only policy and the no-bypass-on-403 rule from ADR 0005 stay unchanged.
2. **Schema: a new narrow table, not new nullable columns on `financials` (AC1, AC4, AC5).**
   - Recommended: `financial_statement_lines(symbol, period_type 'Q'|'Y', period, statement 'IS'|'BS'|'CF', line_code, value bigint, source, fetched_at)` with primary key `(symbol, period_type, period, line_code)`. This matches the "upsert on symbol + period + statement line" wording in AC4.
   - A wide table is simpler for the AI layer to read, but it would need either NOT NULL zeros (forbidden by R4) or many nullable columns, and the line set differs by company type.
   - Annual rows need their own `period` format (`^[0-9]{4}$`) or a `period_type` column. The existing quarterly regex cannot be reused. I would use a column check such as `period ~ '^[0-9]{4}(Q[1-4])?$'`, or two tables.
   - A missing line means no row, and a gap is recorded. Never write 0.
   - Do not touch the `financials` table or its NOT NULL columns. Add RLS on, `revoke all from anon, authenticated`, `grant ... to service_role`, in the same migration file, as 20261026000100 does. Include a rollback file. This is a DB migration, so it is a High-tier path. Flag for Ming review.
   - Ratios: a `financial_ratios(symbol, period, ratio_code, value_bp bigint, derivation 'source'|'derived', source, fetched_at)` table, or the same lines table with `statement 'RT'`. The `derivation` column delivers the "taken from the source with provenance, or derived" part of AC2.
3. **Adapter extension.**
   - Add a second method, for example `fetchStatements(symbol): Promise<StatementResult>`, to `FinancialsSource` rather than widening `QuarterlyFinancials`. That keeps `fetchQuarterly` and its all-four-or-reject contract untouched, so the EPS/BVPS cross-check and tests stay valid.
   - Extend the per-type field map with a second constant, for example `VCI_IQ_STATEMENT_FIELDS_BY_COMPANY_TYPE: Record<companyType, Record<LineCode, vendorField | null>>`. A `null` means "line not applicable for this type", which is recorded as not applicable and is not a gap. A code that the source simply lacks in a period is a gap.
   - Decide per line and per company type. For banks (`NH`), gross profit, capex and debt do not map in the same way. Brokers and insurers have similar holes.
   - To save requests, reuse the existing `income` and `balance` responses already fetched by `fetchQuarterly`, with an in-instance cache like `loadDetails`. Add only the one cash-flow call. Total is then 5 GETs per symbol with the 1 s spacing, about 5 s per symbol. If the watchlist plus holdings is under about 50 symbols, this is fine.
   - `TcbsFinancialsSource`: the new method can be left unimplemented, with a clear "statements unsupported" result.
   - Put all arithmetic in core (R1/R2): the VND conversion (`toVndAmount`), the basis-point conversion and the sanity bounds. Free cash flow = operating cash flow + capex, with the sign convention (capex is typically negative in cash-flow statements) fixed in core and covered by a test. Free cash flow is derived, and so are the margins, debt/equity, ROE/ROA and YoY.
4. **Ratios: derive in core when the inputs are stored, and take the source value otherwise.**
   - Derive from stored lines: gross margin, net margin, debt/equity, and YoY growth for revenue and net income.
   - ROE and ROA: derive from TTM parent NI divided by parent equity or total assets, or take the source's `roe`/`roa`. If taken from the source, store them with `derivation = 'source'`. Be explicit about averaging, because VCI's ROE may use average equity.
   - P/E: P/E needs an EPS basis. Do not store P/E until `VCI_IQ_FINANCIALS_EPS_BASIS` is flipped to `'ttm'`. The source `pe` is a TTM ratio and could be stored as source-provided with provenance, but that bypasses the open "basis" gate. Prefer: store source `pe`/`pb` with `derivation = 'source'` and label them, and let the planner decide. Do not invent a basis (ADR 0002 says STK-015 must read the recorded basis).
   - YoY needs period P and P-4 quarters. A missing P-4 means no row and a gap (R4). Do not emit 0.
5. **Idempotency and gap recording.**
   - The sync must be a single upsert batch keyed on the primary key above, written before gap inserts (same ordering as the current sync: "After the upsert, so a crash between the two leaves no gap without its rows").
   - The sync should add a `financial_statements` pass, or extend `financials-sync.ts` behind a flag. A separate job is cleaner and avoids growing `FinancialsSummary`.
   - For gaps, use a distinct `data_type` such as `'financial_statements'` (and `'financial_ratios'` if separate), so it does not collide with the existing `'financials'` gap type that `planFinancialGaps` resolves. Granularity is one gap per `(symbol, period)`, with a `line_code` in a note column if one exists. If `data_gaps` has no such column, record at period level and let the line detail live in the run summary.
   - Reuse `planFinancialGaps`, which is already pure and tested, rather than writing a new planner. Annual periods need a variant (a year is expected once its latest filing date has passed).
   - Restatement detection: `restated` lines should be reported by comparing stored against fetched values per line code.
   - Dry-run and `ok` semantics: follow the existing summary conventions. Out-of-window rejects must not fail the run.
6. **Fixtures and tests (AC3, AC6).**
   - Record fixtures from the probe in the repo (the STK-039/042 `live-samples` pattern, trimmed). Add mapper tests per company type, including a missing-line case, a null case, an unknown-code case (rejected, never wrong), and a cumulative-to-discrete cash-flow test.
   - Core tests: basis-point rounding (half away from zero, negative values), sign handling for capex, free cash flow, margins and YoY with a zero denominator (return missing/null, never infinity), and unit guards.
   - Fixture-based ratio tests in the style of `vci-iq-financials.crosscheck.test.ts`: derived gross margin and ROE against the source's own `grossMargin` and `roe` within a stated tolerance. This also checks the unit assumption.
   - Retention of `years[]`: annual statement lines are used from `years[]` only if the probe shows they are consistent with the quarter sums.
7. **Terms check (AC3).**
   - There is no new host, so there is no new terms exposure. The posture from ADR 0005 decision 4 (unofficial internal API, personal low volume, honest headers, Ming accepted 2026-11-01) covers it.
   - Because the extra call per symbol raises volume by one request, note this in the plan, and add a new ADR (0007, or an addendum to 0005) that records the new endpoint, the codes, the units and the cumulative/discrete finding. Do not say "terms checked" unless the plan includes reading the actual terms page. ADR 0005 says no terms were found.
   - Ming's note that PDF reading is a later ticket is consistent with this approach. Do not add any PDF parsing.

## Risks
- Cash flow is cumulative YTD and not discrete: wrong FCF and wrong ratios if not detected. High impact, and the AI layer would quote it.
- Code drift: IQ is an unofficial API with no SLA. A renamed code gives missing lines (gaps), which is safe. A silently re-scaled one is not, so keep sanity bounds per line.
- Company-type holes: banks, brokers and insurers have different line sets, so a flat "one list of lines" would produce false gaps. Model "not applicable" separately from "missing".
- Restatements overwrite history. The current approach logs them but keeps no history table. For financial-statement lines that is a weaker audit trail than for EPS. Consider whether the AI citations (R9) need an immutable record. Low urgency.
- Request volume rises (about 5 GETs per symbol vs 4) and the 4 s total delay grows with the watchlist. Check `FINANCIALS_SYNC_CONFIG` timeouts.
- Debt definition (`bsa64` + `bsa70`) can understate debt where bonds or finance leases sit elsewhere, so label it "borrowings" in the schema or comment. An AI summary that says "debt" would overstate precision.
- P/E: the EPS basis is still `'unverified'`. Storing P/E now would contradict ADR 0005 decision 3.
- The migration is High-tier (DB migration path), so it needs Ming's PR review and, per CLAUDE.md §8, the plan gate for tickets touching High paths.
- Annual periods raise the question of fiscal-year-end. The existing comment says the source fiscal-quarter label is treated as calendar quarter. Check that holds for any symbol with a non-December fiscal year.

## Open questions (for the planner / Ming; proposed defaults)
1. Is `section=CASH_FLOW` available and discrete or cumulative? Default: probe first (Recommendation 1). Do not plan the cash-flow mapper before this is answered.
2. New narrow lines table plus ratios table, or wide columns? Default: narrow lines table with a `derivation` column on ratios.
3. Store source `pe`/`pb`/`roe`/`roa` with `derivation = 'source'`, or only derive in core? Default: derive what is derivable from stored lines, take P/E and P/B from the source with provenance, and keep the EPS basis gate for any derived P/E.
4. Banks, brokers, insurers: in scope for all lines or only the lines that exist? Default: only mapped lines, "not applicable" is not a gap, documented per type, with `CT` first and the other types as a follow-up if the probe shows different codes.
5. Annual rows: take `years[]` from the source, or derive annual as the sum of four quarters? Default: take `years[]` after the probe confirms it matches the sum of quarters, and store as `period_type 'Y'`.
6. Scope of "watchlist and holdings": reuse the existing symbol set logic in `runFinancialsSync` (watchlist plus `listHeldSymbols`). Default: yes, same set.
7. Separate job or extend `financials-sync.ts`? Default: separate job (`financial-statements-sync`) sharing the store, gap and rate-limit helpers, so the existing job and its summary are not widened.
8. Does `data_gaps` have a place for a line code? Default: period-level gaps only.

Relevant files (all under D:\mmlabs\spaceM\projects\stoktok):
- supabase/migrations/20261026000100_financials.sql
- apps/worker/src/jobs/financials-sync.ts
- apps/worker/src/sources/financials-source.ts, vci-iq-financials.ts, select-financials-source.ts
- packages/core/src/market/financials.ts, financials-derive.ts
- docs/adr/0002-financials-source.md, 0005-vci-iq-financials-source.md
- work/tickets/STK-039/live-samples/ and work/tickets/STK-042/live-samples/ (metrics dictionaries, statistics-financial)
