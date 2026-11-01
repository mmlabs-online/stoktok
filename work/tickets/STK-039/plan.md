Status: READY

# Plan — STK-039: Replace the quarterly financials source

> Re-planned 2026-11-01 after Ming answered the blocking questions ("tự chọn phương án tốt nhất", meaning all stated defaults are accepted; see ticket.md "Answers to the blocking questions"). The balance-sheet pre-step is done. Nothing blocks.

## Spec summary
- spec §4.3: "One interface per data type (`PriceSource`, `FinancialsSource`, `NewsSource`); each implementation is swappable." / "Primary + fallback source per data type where possible." / "Every record stores `source` and `fetched_at`."
- spec §3 F4 (medium term): "P/E and P/B vs sector, earnings growth trend … | Daily OHLCV, quarterly financials".
- spec §5 table: "`financials` | symbol, period, eps, bvps, revenue, net_income, source".
- spec §9 Open question 4: "Primary and fallback data sources after license/terms check."
- ADR 0002 Policies: "all four values must be valid or the whole period is rejected and recorded as a gap. No value is derived from another (no `postTaxProfit` fallback) and nothing is filled with zero." / "Swapping the source: Implement `FinancialsSource` …, declare its units in one constant, and construct it in `apps/worker/src/cli.ts`. `runFinancialsSync` does not change."
- CLAUDE.md R2 (integer VND, rounding defined once in core), R4 (`source` + `fetched_at`; gaps recorded), R5 (source choice and units are configuration), R3 (credentials server-only; none are needed here), R1 (calculations in `packages/core`).

## Decisions (Ming, 2026-11-01; recorded in ticket.md)
1. EPS/BVPS are derived in `packages/core` (option a):
   - TTM EPS = sum of the last 4 consecutive quarters' parent net income (`isa22`) ÷ that period's share count.
   - BVPS = (`bsa78` owner's equity − `bsa210` minority interests) ÷ shares.
   - ADR 0002's no-derivation policy changes for EPS/BVPS only, and ADR 0005 records this.
2. The `vci-iq` EPS basis stays `'unverified'`, so P/E stays suppressed. It changes only after a live dry-run shows derived EPS within ±3% of VietCap's own figures on at least 3 symbols.
3. The terms risk of `iq.vietcap.com.vn` is accepted with the ADR 0004 posture: unofficial internal API, personal low volume, honest headers only.
4. Existing TCBS financials rows are kept. Nothing is deleted.
5. Banks, brokers and insurers (`comTypeCode ≠ 'CT'`) are rejected as `unsupported_company_type` and recorded as gaps. A follow-up ticket handles them.
6. Sector label: `sectorVn` (Vietnamese ICB level 2).
7. Source id: `vci-iq`.

## Evidence (from live-probe.md + live-samples/, which override the consults)
- Host `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company`. Requests returned 200 with only the honest UA + `Accept`. No cookie, handshake, Origin or Referer was needed.
- `statistics-financial`:
  - Rows are `ratioType: 'RATIO_TTM'` and include year rows (`quarter: 5`, 8 in the HPG sample).
  - **No `earningPerShare`/`bookValuePerShare`.**
  - `year` is a string, `yearReport` is a number, and `ticker` is null.
  - `numberOfSharesMktCap` **is per period**: HPG goes from 2,123,907,166 (2018) to 8,442,964,520 (recent).
- `financial-statement?section=INCOME_STATEMENT`:
  - Shape is `data.quarters` / `data.years`. Period = `yearReport` + `lengthReport` (5 = year).
  - Amounts are full VND floats (e.g. `5.5836458379759E13`).
  - `isa3` is net sales and `isa22` is parent net income. `isa23` is EPS but is 0 in Q1/Q3, so it is unusable.
  - Rows have `ticker`.
- `financial-statement?section=BALANCE_SHEET` (**recorded, pre-step done**, `live-samples/HPG_financial-statement_section_BALANCE_SHEET.json`):
  - The shape is the same as INCOME_STATEMENT: `data.years` (8 rows, `lengthReport: 5`, 2018–2025) and `data.quarters` (35 rows, `lengthReport` 1–4, 2018 Q1 – 2026 Q3).
  - Rows are keyed by `yearReport` (number) + `lengthReport`, and carry `organCode: 'HPG'` and `ticker: 'HPG'`.
  - `bsa78` and `bsa210` are present and non-null on every HPG row. Values are full-VND floats in exponent notation with integral values, e.g. 2026 Q3 `bsa78` = 1.49568352619326E14 and `bsa210` = 7.72935036121E11.
  - `bsa80` (paid-in capital) is 84,429,645,200,000, which is about 8.44 bn shares at 10,000 par and matches `numberOfSharesMktCap`. That gives BVPS ≈ (149,568,352,619,326 − 772,935,036,121) ÷ 8,442,964,520 ≈ 17,623 VND.
- `metrics` BALANCE_SHEET: `bsa78` is Owner's Equity (total, level 1), and `bsa210` is Minority interests (parent BSA79, so it sits inside `bsa78`).
- `details?ticker=`: `sectorVn` 'Tài nguyên Cơ bản', `sector` 'Basic Resources', `icbCodeLv2` '1700', `comTypeCode` 'CT', `isBank`.
- Bank, broker and insurer layouts (`isb*`/`isi*` …) were not probed. They are out of scope per decision 5.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Source chosen after a documented comparison (coverage of EPS/BVPS/revenue/net income/sector, units, EPS basis, license/terms); choice recorded in an ADR | `docs/adr/0005-vci-iq-financials-source.md` exists with a comparison table (VietCap IQ, TCBS (blocked 403), SSI FastConnect (dropped by Ming), KBS, VNDirect finfo, CafeF) and columns for those 5 items. It records the probe facts above, decisions 1–7 with the date 2026-11-01, the derivation formulas, the unit table and the dry-run checklist. ADR 0002 gets a "Superseded in part by ADR 0005" line |
| 2 | New `FinancialsSource` feeds the existing validation, `data_gaps` recording and sector rules unchanged; every row carries `source` and `fetched_at` | `git diff main -- apps/worker/src/jobs/financials-sync.ts packages/core/src/market/financials.ts` is empty. `vci-iq-financials.test.ts` › "passes derived raw values through normalizeQuarterlyFinancials" and › "source name is vci-iq". `financials-sync.test.ts` is unchanged and still green |
| 3 | Active source selected by configuration (R5); any credentials env-only, server-side, names in `.env.example` | `FINANCIALS_SYNC_CONFIG.financialsSource` defaults to `'vci-iq'`, and `--source <vci-iq\|tcbs-public>` is accepted for `financials` (`cli.test.ts`). `select-financials-source.test.ts` returns the right class per id. No credentials are needed: the ADR says so, `.env.example` is unchanged, and the reviewer confirms there are no new env reads |
| 4 | `pnpm worker:financials` and `--dry-run` work with the new source | `cli.test.ts` › "financials job constructs the configured source". Live: Ming or the orchestrator runs `pnpm worker:financials --dry-run` on the home server using the ADR 0005 checklist, and the result goes in the impl-log/Handoff. As in STK-038, this is not a merge gate for the code review |
| 5 | Tests use recorded fixtures and the no-network guard only; `typecheck`, `lint`, `test` pass | Fixtures under `apps/worker/test/fixtures/vci-iq/` are trimmed copies of the recorded live samples, and the README states the source and date. Tests inject `fetchImpl`, and `test/no-network.ts` stays in setup. `pnpm typecheck && pnpm lint && pnpm test` pass |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `docs/adr/0005-vci-iq-financials-source.md` | create | AC1: comparison, choice, terms risk acceptance, derivation policy, units, dry-run checklist |
| `docs/adr/0002-financials-source.md` | modify: add one status line, "Superseded in part by ADR 0005 (source; derivation policy for EPS/BVPS)" | AC1. ADR 0002's no-derivation policy changes only for EPS/BVPS (decision 1) |
| `packages/core/src/market/financials-derive.ts` | create: `deriveVciIqQuarter(...)`, which computes TTM EPS and BVPS from statement amounts + share count as integer VND via `roundDiv` | R1/R2: the calculation lives in core |
| `packages/core/src/market/financials-derive.test.ts` | create | R8: unit tests for the derivation |
| `packages/core/src/index.ts` | modify: export the new function and types | the worker imports from `@stoktok/core` |
| `apps/worker/src/sources/vci-iq-financials.ts` | create: `VciIqFinancialsSource implements FinancialsSource`, `VCI_IQ_FINANCIALS_UNITS`, `VCI_IQ_FINANCIALS_SOURCE_NAME = 'vci-iq'`, `VCI_IQ_FINANCIALS_EPS_BASIS = 'unverified'`, field-code constants block | AC2 |
| `apps/worker/src/sources/vci-iq-financials.test.ts` | create | AC2/AC5 |
| `apps/worker/src/sources/select-financials-source.ts` | create: `createFinancialsSource(id, deps)`, mirroring `select-price-source.ts` | AC3 (R5) |
| `apps/worker/src/sources/select-financials-source.test.ts` | create | AC3 |
| `apps/worker/src/config.ts` | modify: add `FINANCIALS_SOURCE_IDS`, `isFinancialsSourceId`, `FINANCIALS_SYNC_CONFIG.financialsSource: 'vci-iq'` and `VCI_IQ_CONFIG { baseUrl, userAgent }` | AC3 (R5) |
| `apps/worker/src/config.test.ts` | modify: assert the default id, and assert that the honest UA has no browser tokens | AC3 / header rule |
| `apps/worker/src/cli.ts` | modify: build the source via `createFinancialsSource`; allow `--source` for `financials` with financials ids; add `[VCI_IQ_FINANCIALS_SOURCE_NAME]: VCI_IQ_FINANCIALS_EPS_BASIS` to `epsBasisBySource` (keep the `tcbs-public` entry) | AC3/AC4 |
| `apps/worker/src/cli.test.ts` | modify: add parseArgs cases for `financials --source vci-iq`, for rejecting `--source vci-public` on financials, and for rejecting a financials id on eod-prices | AC3/AC4 |
| `apps/worker/test/fixtures/vci-iq/*.json` + `README.md` | create: trimmed recorded HPG statistics, income statement, balance sheet and details. Derived variants: dup period, ticker mismatch, wrong unit, missing shares, missing `bsa210`, non-CT company type, empty, too many periods | AC5 |

Not touched: `apps/worker/src/jobs/financials-sync.ts`, `packages/core/src/market/financials.ts`, `packages/core/src/signals/**`, `supabase/**` (no migration), `.env.example`, `tcbs-financials.ts` (kept selectable), `apps/worker/src/sources/http.ts`. The recorded `work/tickets/STK-039/live-samples/*` files are inputs and are read-only.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `financials-derive.test.ts` › "TTM EPS = sum of 4 consecutive quarters' parent NI ÷ period shares, rounded half away from zero" | core formula, R2 rounding |
| › "negative TTM NI gives negative EPS; rounding is symmetric" | sign handling |
| › "missing one of the 4 quarters → eps missing (no fill, no partial sum)" | ADR 0002 no-fill |
| › "non-consecutive quarters across a year boundary (e.g. Q4 missing) → eps missing" | window integrity |
| › "share issue inside the window: all 4 quarters ÷ the current period's shares (retroactive)" | stock dividend / bonus edge case |
| › "BVPS = (bsa78 − bsa210) ÷ period shares" (HPG 2026 Q3 values → ≈ 17,623) | parent equity |
| › "missing / zero / non-integer / negative shares → reason `missing_shares` / `invalid_shares`" | guard |
| › "missing equity or minority value → bvps missing (not treated as 0)" | no-fill policy |
| › "amounts beyond safe integer → invalid" | R2 overflow |
| `vci-iq-financials.test.ts` › "recorded HPG fixtures → 12+ normalized quarters with integer VND, source vci-iq" | happy path |
| › "passes derived raw values through normalizeQuarterlyFinancials" | AC2 |
| › "source name is vci-iq" | AC2 / R4 |
| › "skips year rows (quarter/lengthReport 5, and `data.years`) silently, not as invalid_period" | period mapping |
| › "duplicate period in any endpoint → dropped + duplicate_period" | reuse of the TCBS rule |
| › "row ticker mismatch (statements, when ticker present) → ticker_mismatch" | statements carry ticker; stats ticker is null and is not checked |
| › "wrong-unit fixture (amounts ÷1e9) → rejected by core unit guards" | unit guard |
| › "period missing in the balance sheet → that period rejected, others kept" | per-period join |
| › "comTypeCode ≠ CT → every period rejected `unsupported_company_type`" | decision 5 |
| › "404 → no data (symbolsWithoutData); empty list → no periods" | ADR 0002 no-data |
| › "403 → non-retryable SourceError 'blocked by source (HTTP 403); no bypass, see ADR 0005'" | header rule |
| › "too many periods → SourceError" | `maxPeriodsPerResponse` |
| › "sends only User-Agent and Accept; no Origin/Referer/Cookie" (inspect the `fetchImpl` call) | hard header rule |
| › "fetchSector returns normalized `sectorVn`; null when missing" | decision 6, sector rule unchanged |
| › "requests are sequential with requestDelayMs between them" | low volume |
| `select-financials-source.test.ts` › "vci-iq → VciIqFinancialsSource; tcbs-public → TcbsFinancialsSource; unknown → throws" | R5 |
| `cli.test.ts` › the parseArgs cases listed above + "financials job constructs the configured source" | AC3/AC4 |

## Approach
0. **Pre-step: DONE** (orchestrator, 2026-11-01). The BALANCE_SHEET response was recorded with honest headers. Its shape matches INCOME_STATEMENT (`data.quarters`/`data.years`, `yearReport` + `lengthReport`, `ticker` present). `bsa78`/`bsa210` are present, non-null and in full VND. No return to PLAN was needed.
1. **ADR 0005.**
   - Comparison table. Choice: VietCap IQ REST with id `vci-iq` (decision 7). This is a separate id from `vci-public` because it is a different host with a different verification status.
   - Terms posture is the same as ADR 0004 (unofficial, unlicensed, low volume), with Ming's acceptance dated 2026-11-01 (decision 3).
   - Honest-header rule: "on 403/challenge: fail, no bypass".
   - Derivation policy (decision 1) and the units table: totals in `VND`, per-share values computed in VND.
   - EPS basis `'unverified'` until the dry-run (decision 2), then a one-line `/solo` flip to `'ttm'`.
   - Existing TCBS rows are kept (decision 4).
   - Dry-run checklist, adapted from consult-finance R-c:
     - on ≥ 3 symbols, derived TTM EPS is within ±3% of VietCap's own figure (`marketCap / pe ÷ shares`); passing this is the gate for decision 2;
     - BVPS × shares ≈ parent equity;
     - net income = parent line;
     - ≥ 12 quarters;
     - sector labels compared with the stored ones;
     - 1 non-CT symbol shows `unsupported_company_type`.
2. **Core (R1/R2).** Add `financials-derive.ts`. Inputs are per-period integer-VND amounts, already converted by `toVndAmount(…, 'VND')`. The output is `RawQuarterlyFinancials`-compatible numbers or a reason.
   - `epsTtm(P) = roundDiv(Σ isa22[P−3..P], shares[P])`, which needs all 4 consecutive quarters.
   - `bvps(P) = roundDiv(bsa78[P] − bsa210[P], shares[P])`.
   - Use BigInt math through the existing `money.ts roundDiv`, half away from zero (negative numerators handled as in money.ts).
   - No fallback to `isa20`, no zero-fill, and no vendor `pe`/`pb`.
3. **Worker source.** `VciIqFinancialsSource.fetchQuarterly(sym)` makes 4 sequential GETs with `requestDelayMs` between them:
   - statistics-financial, for shares per period;
   - INCOME_STATEMENT;
   - BALANCE_SHEET;
   - `details`, for `comTypeCode`, which is cached within the instance for `fetchSector`.

   Then:
   - Unwrap `body.data`; for the statements, use `data.quarters` only (ignore `data.years`).
   - Skip year rows. Apply the dup-period, ticker-mismatch and max-periods rules exactly as in `tcbs-financials.ts`, with 404 meaning no data. Map 403 to the non-retryable "no bypass" error, as in `vci.ts`.
   - Keep the field codes in one constant (`isa3`, `isa22`, `bsa78`, `bsa210`, `numberOfSharesMktCap`), so a renamed code makes periods `rejected` and never produces bad data.
   - Join the endpoints by period. For each period: derive (step 2), then call `normalizeQuarterlyFinancials(sym, {year, quarter, eps, bvps, revenue: isa3, netIncome: isa22}, VCI_IQ_FINANCIALS_UNITS, sanity)` unchanged.
   - If `comTypeCode !== 'CT'`, reject every period with `unsupported_company_type`, so the existing job records the gaps.
   - `fetchSector` returns `sectorVn` (decision 6).
   - Headers: call `getJson` with `userAgent: VCI_IQ_CONFIG.userAgent` only. Verify that `http.ts` adds only `Accept`, and do not change `http.ts`.
4. **Config/selection (R5).** Add the config ids, the default `vci-iq`, `createFinancialsSource` and the CLI `--source` for financials. `epsBasisBySource` gets `vci-iq` → `VCI_IQ_FINANCIALS_EPS_BASIS` (`'unverified'`, decision 2).
5. **Fixtures/tests.** Trim the recorded samples (statistics, income statement, balance sheet, details) to about 16 HPG quarters, and build the variants by editing copies. The README says which files are recorded and which are derived from a recording.
6. **Checks.** Run `pnpm typecheck && pnpm lint && pnpm test`. The live dry-run is a Handoff item for Ming/the orchestrator.

Rules:
- R1/R2: the derivation and rounding are in core.
- R3: no credentials.
- R4: `source = 'vci-iq'`, and `fetched_at` comes from the unchanged job.
- R5: the source id, units, field codes, base URL and UA are constants in config/source.
- R7: no change to signals, sync or migrations.
- R8: the core tests are listed above.
- R10: read-only public data.
- Risk tier: the derivation is a money calculation in `packages/core`, so the PR is likely **High** and Ming reviews it.

## Specialist input used
- data-engineer:
  - Adopted: VietCap IQ as primary; `metrics` as the code dictionary; skip `quarter ≥ 5`; reuse the TCBS dup/ticker/max/404 rules; 403 → non-retryable; one field-code constant; honest UA only; `FINANCIALS_SOURCE` config with `tcbs-public` still selectable; fallback source → follow-up.
  - Rejected/overridden by the live probe:
    - "statistics-financial provides EPS and BVPS" (no such fields);
    - `isa20` as net income (use `isa22`, the parent line);
    - "synthetic fixtures" (we have recorded ones);
    - handshake worries (none needed).
- finance-investment-researcher:
  - Adopted:
    - parent net income;
    - BVPS = parent equity excluding minority ÷ shares;
    - separate id `vci-iq`;
    - `epsBasisBySource` entry kept `'unverified'` until the dry-run;
    - do not sum 4 per-quarter EPS figures; instead derive TTM EPS from summed NI ÷ one share count;
    - sector from `sectorVn` (ICB level 2);
    - follow-ups R-d.
  - Rejected/deferred:
    - "take EPS/BVPS from the source's ratio fields" (they do not exist);
    - the revenue mapping per `comTypeCode` for NH/CK/BH (codes unprobed; deferred via `unsupported_company_type`, decision 5);
    - configurable ICB level (one level is available as a label; follow-up if needed).

## Assumptions
- `numberOfSharesMktCap` on a `statistics-financial` row is the share count for that period, as the HPG history and the `bsa80`/10,000 cross-check suggest. Whether it excludes treasury shares is unverified; the dry-run's `BVPS × shares ≈ parent equity` check covers it.
- Rows are matched by `(yearReport, quarter)` for statistics and by `(yearReport, lengthReport)` for both statements. The string `year` field is ignored.
- A null or absent `bsa210` is treated as "missing" (the period is rejected), not as 0. HPG has it on every row. If the dry-run shows many CT firms with null minority interests, a follow-up decides whether null means 0. This plan does not zero-fill.
- Statement floats are integral in full VND. `toVndAmount(…, 'VND')` rejects non-integral values, so the core unit guards catch any non-integral value.
- No ICB-code storage. Logging `icbCodeLv2` in the run summary is a follow-up, because it would change the sync job.
- Overlapping periods from existing TCBS rows are overwritten by the existing overwrite policy and show up in `restated`. Nothing is deleted (decision 4).
- The fallback source (spec §4.3 "where possible") is out of scope → follow-up ticket.
- Follow-ups (R7, not in the diff):
  - an EPS lower-bound sanity check;
  - a `financials_source_mixed` check for P/B and growth;
  - peers restricted to the same `sector_source`;
  - a bank/broker/insurer layout mapping;
  - a KBS/VNDirect fallback;
  - the `'unverified'` → `'ttm'` flip after the dry-run.

## Blocking questions
None. Ming answered all seven on 2026-11-01 (see Decisions above and ticket.md).

## Split proposal
None. The rough scope is:
- core derivation: ~80 lines + ~150 test lines;
- source: ~220 lines + ~250 test lines;
- selection/config/CLI: ~60 lines;
- the ADR and fixtures.

That is over 400 lines including tests and fixtures, but it is a single feature with no clean seam. The fallback source and the bank/broker/insurer mapping are already deferred to follow-ups.
