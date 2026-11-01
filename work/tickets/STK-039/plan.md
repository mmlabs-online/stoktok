Status: BLOCKED

# Plan — STK-039: Replace the quarterly financials source

> Blocked on Q1–Q3 below, which only Ming can answer. VietCap IQ has no quarterly EPS or BVPS field, so any working plan has to either derive them, which changes ADR 0002's "no value is derived from another" policy, or drop them. Everything else in this plan uses the proposed defaults. If Ming accepts the defaults, the orchestrator can flip this to `READY` without re-planning. If Ming picks another option in Q1, the plan has to be redone.

## Spec summary
- spec §4.3: "One interface per data type (`PriceSource`, `FinancialsSource`, `NewsSource`); each implementation is swappable." / "Primary + fallback source per data type where possible." / "Every record stores `source` and `fetched_at`."
- spec §3 F4 (medium term): "P/E and P/B vs sector, earnings growth trend … | Daily OHLCV, quarterly financials".
- spec §5 table: "`financials` | symbol, period, eps, bvps, revenue, net_income, source".
- spec §9 Open question 4: "Primary and fallback data sources after license/terms check."
- ADR 0002 Policies: "all four values must be valid or the whole period is rejected and recorded as a gap. No value is derived from another (no `postTaxProfit` fallback) and nothing is filled with zero." / "Swapping the source: Implement `FinancialsSource` …, declare its units in one constant, and construct it in `apps/worker/src/cli.ts`. `runFinancialsSync` does not change."
- CLAUDE.md R2 (integer VND, rounding defined once in core), R4 (`source` + `fetched_at`; gaps recorded), R5 (source choice and units are configuration), R3 (credentials server-only; none are needed here), R1 (calculations in `packages/core`).

## Evidence (from live-probe.md + live-samples/, which override the consults)
- Host `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company`. Returned 200 with only the honest UA + `Accept`. No cookie, handshake, Origin or Referer.
- `statistics-financial`: rows are `ratioType: 'RATIO_TTM'` and include year rows (`quarter: 5`, 8 in the HPG sample). **No `earningPerShare`/`bookValuePerShare`.** `year` is a string and `yearReport` a number. `ticker` is null.
  - `numberOfSharesMktCap` **is per period**: HPG goes 2,123,907,166 (2018) → 8,442,964,520 (recent). The probe note says it is "the same on every recent row", which is true but only because HPG has issued no shares recently.
- `financial-statement?section=INCOME_STATEMENT`: `data.quarters` / `data.years`. Period = `yearReport` + `lengthReport` (5 = year). Amounts are full VND floats (e.g. `5.5836458379759E13`). `isa3` is net sales, `isa22` is parent net income, and `isa23` is EPS, which is 0 in Q1/Q3, so it is unusable. Rows have `ticker`.
- `metrics` BALANCE_SHEET: `bsa78` is Owner's Equity (total, level 1) and `bsa210` is Minority interests (inside equity). **The BALANCE_SHEET section response itself was not probed.**
- `details?ticker=`: `sectorVn` 'Tài nguyên Cơ bản', `sector` 'Basic Resources', `icbCodeLv2` '1700', `comTypeCode` 'CT', `isBank`.
- Bank, broker and insurer layouts (`isb*`/`isi*` …) were not probed. The HPG metrics list only one `bsb*` field and no bank income codes.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Source chosen after a documented comparison (coverage of EPS/BVPS/revenue/net income/sector, units, EPS basis, license/terms); choice recorded in an ADR | `docs/adr/0005-vci-iq-financials-source.md` exists with a comparison table (VietCap IQ, TCBS (blocked 403), SSI FastConnect (dropped by Ming), KBS, VNDirect finfo, CafeF) and columns for those 5 items. It records the probe facts above, Ming's answers to Q1–Q3 with the date, the derivation formulas, the unit table and the dry-run checklist. ADR 0002 gets a "Superseded in part by ADR 0005" line |
| 2 | New `FinancialsSource` feeds the existing validation, `data_gaps` recording and sector rules unchanged; every row carries `source` and `fetched_at` | `git diff main -- apps/worker/src/jobs/financials-sync.ts packages/core/src/market/financials.ts` is empty. `vci-iq-financials.test.ts` › "passes derived raw values through normalizeQuarterlyFinancials" and › "source name is vci-iq". `financials-sync.test.ts` is unchanged and still green |
| 3 | Active source selected by configuration (R5); any credentials env-only, server-side, names in `.env.example` | `FINANCIALS_SYNC_CONFIG.financialsSource` defaults to `'vci-iq'`, and `--source <vci-iq\|tcbs-public>` is accepted for `financials` (`cli.test.ts`). `select-financials-source.test.ts` returns the right class per id. No credentials are needed: the ADR says so, and `.env.example` is unchanged (reviewer confirms there are no new env reads) |
| 4 | `pnpm worker:financials` and `--dry-run` work with the new source | `cli.test.ts` › "financials job constructs the configured source". Live: Ming or the orchestrator runs `pnpm worker:financials --dry-run` on the home server using the ADR 0005 checklist. The result goes in the impl-log/Handoff. It is not a merge gate for the code review, same as STK-038 |
| 5 | Tests use recorded fixtures and the no-network guard only; `typecheck`, `lint`, `test` pass | Fixtures under `apps/worker/test/fixtures/vci-iq/` are trimmed copies of the recorded live samples (README states the source and date). Tests inject `fetchImpl`, and `test/no-network.ts` stays in setup. `pnpm typecheck && pnpm lint && pnpm test` pass |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `docs/adr/0005-vci-iq-financials-source.md` | create | AC1: comparison, choice, terms risk acceptance, derivation policy, units, dry-run checklist |
| `docs/adr/0002-financials-source.md` | modify: one status line "Superseded in part by ADR 0005 (source; derivation policy for EPS/BVPS)" | AC1. ADR 0002's no-derivation policy changes only for EPS/BVPS (Q1) |
| `packages/core/src/market/financials-derive.ts` | create: `deriveVciIqQuarter(...)`, which computes TTM EPS and BVPS from statement amounts + share count, integer VND via `roundDiv` | R1/R2: the calculation lives in core |
| `packages/core/src/market/financials-derive.test.ts` | create | R8: unit tests for the derivation |
| `packages/core/src/index.ts` | modify: export the new function and types | the worker imports from `@stoktok/core` |
| `apps/worker/src/sources/vci-iq-financials.ts` | create: `VciIqFinancialsSource implements FinancialsSource`, `VCI_IQ_FINANCIALS_UNITS`, `VCI_IQ_FINANCIALS_SOURCE_NAME = 'vci-iq'`, `VCI_IQ_FINANCIALS_EPS_BASIS`, field-code constants block | AC2 |
| `apps/worker/src/sources/vci-iq-financials.test.ts` | create | AC2/AC5 |
| `apps/worker/src/sources/select-financials-source.ts` | create: `createFinancialsSource(id, deps)`, mirroring `select-price-source.ts` | AC3 (R5) |
| `apps/worker/src/sources/select-financials-source.test.ts` | create | AC3 |
| `apps/worker/src/config.ts` | modify: `FINANCIALS_SOURCE_IDS`, `isFinancialsSourceId`, `FINANCIALS_SYNC_CONFIG.financialsSource: 'vci-iq'`, `VCI_IQ_CONFIG { baseUrl, userAgent }` | AC3 (R5) |
| `apps/worker/src/config.test.ts` | modify: assert the default id and that the honest UA has no browser tokens | AC3 / header rule |
| `apps/worker/src/cli.ts` | modify: build the source via `createFinancialsSource`; allow `--source` for `financials` with financials ids; add `[VCI_IQ_FINANCIALS_SOURCE_NAME]: VCI_IQ_FINANCIALS_EPS_BASIS` to `epsBasisBySource` (keep the `tcbs-public` entry) | AC3/AC4 |
| `apps/worker/src/cli.test.ts` | modify: parseArgs cases for `financials --source vci-iq`, rejection of `--source vci-public` for financials, and of a financials id for eod-prices | AC3/AC4 |
| `apps/worker/test/fixtures/vci-iq/*.json` + `README.md` | create: trimmed recorded HPG statistics, income statement, balance sheet and details. Derived variants: dup period, ticker mismatch, wrong unit, missing shares, non-CT company type, empty, too many periods | AC5 |
| `work/tickets/STK-039/live-samples/HPG_financial-statement_section_BALANCE_SHEET.json` | create (orchestrator, before IMPLEMENT; see Approach step 0) | AC5: the BS fixture must be recorded, not invented |

Not touched: `apps/worker/src/jobs/financials-sync.ts`, `packages/core/src/market/financials.ts`, `packages/core/src/signals/**`, `supabase/**` (no migration), `.env.example`, `tcbs-financials.ts` (kept selectable).

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `financials-derive.test.ts` › "TTM EPS = sum of 4 consecutive quarters' parent NI ÷ period shares, rounded half away from zero" | core formula, R2 rounding |
| › "negative TTM NI gives negative EPS; rounding is symmetric" | sign handling |
| › "missing one of the 4 quarters → eps missing (no fill, no partial sum)" | ADR 0002 no-fill |
| › "share issue inside the window: all 4 quarters ÷ the current period's shares (retroactive)" | stock dividend / bonus edge case |
| › "BVPS = (bsa78 − bsa210) ÷ period shares" | parent equity |
| › "missing / zero / non-integer / negative shares → reason `missing_shares` / `invalid_shares`" | guard |
| › "missing equity or minority value → bvps missing (not treated as 0)" | no-fill policy |
| › "amounts beyond safe integer → invalid" | R2 overflow |
| `vci-iq-financials.test.ts` › "recorded HPG fixtures → 12+ normalized quarters with integer VND, source vci-iq" | happy path |
| › "skips year rows (quarter/lengthReport 5) silently, not as invalid_period" | period mapping |
| › "duplicate period in any endpoint → dropped + duplicate_period" | reuse of the TCBS rule |
| › "row ticker mismatch (when ticker present) → ticker_mismatch" | statements carry ticker; stats ticker is null and is not checked |
| › "wrong-unit fixture (amounts ÷1e9) → rejected by core unit guards" | unit guard |
| › "comTypeCode ≠ CT → every period rejected `unsupported_company_type`" | Q-bank default |
| › "404 → no data (symbolsWithoutData); empty list → no periods" | ADR 0002 no-data |
| › "403 → non-retryable SourceError 'blocked by source (HTTP 403); no bypass, see ADR 0005'" | header rule |
| › "too many periods → SourceError" | `maxPeriodsPerResponse` |
| › "sends only User-Agent and Accept; no Origin/Referer/Cookie" (inspect the `fetchImpl` call) | hard header rule |
| › "fetchSector returns normalized `sectorVn`; null when missing" | sector rule unchanged |
| › "requests are sequential with requestDelayMs between them" | low volume |
| `select-financials-source.test.ts` › "vci-iq → VciIqFinancialsSource; tcbs-public → TcbsFinancialsSource; unknown → throws" | R5 |
| `cli.test.ts` › the parseArgs cases listed above | AC3/AC4 |

## Approach
0. **Pre-step (orchestrator, before IMPLEMENT, same honest headers):** fetch `HPG/financial-statement?section=BALANCE_SHEET` and save it in `live-samples/`. Confirm that `bsa78` and `bsa210` are present and in full VND. If the shape differs from the INCOME_STATEMENT shape, or `bsa210` is absent for HPG, return to PLAN.
1. **ADR 0005.** Comparison table. Choice: VietCap IQ REST, id `vci-iq`, a separate id from `vci-public` because it is a different host with a different verification status. Terms posture is the same as ADR 0004 (unofficial, unlicensed, low volume), with Ming's acceptance (Q3). Record the honest-header rule ("on 403/challenge: fail, no bypass"). Record the derivation policy from Q1 and the units table: totals `VND`, per-share computed in VND. Add the dry-run checklist from consult-finance R-c, adapted:
   - the derived TTM EPS × shares ≈ vendor `marketCap / pe` within ±3%;
   - BVPS × shares ≈ parent equity;
   - net income = parent line;
   - ≥ 12 quarters;
   - sector labels compared with the stored ones;
   - 1 non-CT symbol shows `unsupported_company_type`.
2. **Core (R1/R2).** Add `financials-derive.ts`. Inputs are per-period integer-VND amounts, already converted by `toVndAmount(…, 'VND')`. Output is `RawQuarterlyFinancials`-compatible numbers or a reason.
   - `epsTtm(P) = roundDiv(Σ isa22[P−3..P], shares[P])`, which needs all 4 consecutive quarters.
   - `bvps(P) = roundDiv(bsa78[P] − bsa210[P], shares[P])`.
   - BigInt math through the existing `money.ts roundDiv`, half away from zero (negative numerators handled as in money.ts).
   - No fallback to `isa20`, no zero-fill, no vendor `pe`/`pb`.
3. **Worker source.** `VciIqFinancialsSource.fetchQuarterly(sym)` makes 4 sequential GETs with `requestDelayMs` between them: statistics-financial (shares per period), INCOME_STATEMENT, BALANCE_SHEET, and `details` (for `comTypeCode`, which is cached for `fetchSector` within the instance).
   - Unwrap `body.data`; for the statements, `data.quarters`.
   - Skip year rows. Apply the dup-period, ticker-mismatch and max-periods rules exactly as in `tcbs-financials.ts`, with 404 meaning no data. Map 403 to the non-retryable "no bypass" error, as in `vci.ts`.
   - Field codes live in one constant (`isa3`, `isa22`, `bsa78`, `bsa210`, `numberOfSharesMktCap`), so a rename makes periods `rejected`, never bad data.
   - For each period: derive (step 2), then call `normalizeQuarterlyFinancials(sym, {year, quarter, eps, bvps, revenue: isa3, netIncome: isa22}, VCI_IQ_FINANCIALS_UNITS, sanity)` unchanged.
   - If `comTypeCode !== 'CT'`, reject all periods with `unsupported_company_type`, so gaps are recorded by the existing job.
   - Headers: `getJson` with `userAgent: VCI_IQ_CONFIG.userAgent` only. Verify that `http.ts` adds only `Accept`, and do not change `http.ts`.
4. **Config/selection (R5).** Add the config ids, the default `vci-iq`, `createFinancialsSource`, the CLI `--source` for financials, and `epsBasisBySource` gets `vci-iq` with `VCI_IQ_FINANCIALS_EPS_BASIS` (Q2 default `'unverified'`).
5. **Fixtures/tests.** Trim the recorded samples to around 16 quarters for HPG and build the variants by editing copies. The README states which file is recorded and which is derived from a recording.
6. **Checks.** Run `pnpm typecheck && pnpm lint && pnpm test`. The live dry-run is a Handoff item for Ming/the orchestrator.

Rules:
- R1/R2: the derivation and rounding are in core.
- R3: no credentials.
- R4: `source = 'vci-iq'`, and `fetched_at` comes from the unchanged job.
- R5: source id, units, field codes, base URL and UA are constants in config/source.
- R7: no change to signals, sync or migrations.
- R8: core tests are listed above.
- R10: read-only public data.
- Risk tier: the derivation is a money calculation in `packages/core`, so the PR is likely **High**. Ming reviews it.

## Specialist input used
- data-engineer:
  - Adopted: VietCap IQ as primary, `metrics` as the code dictionary, skip `quarter ≥ 5`, reuse the TCBS dup/ticker/max/404 rules, 403 → non-retryable, one field-code constant, honest UA only, `FINANCIALS_SOURCE` config with `tcbs-public` still selectable, fallback source → follow-up.
  - Rejected/overridden by the live probe: "statistics-financial provides EPS and BVPS" (no such fields); `isa20` as net income (use `isa22`, parent); "synthetic fixtures" (we have recorded ones); handshake worries (none needed).
- finance-investment-researcher:
  - Adopted: parent net income; BVPS = parent equity excluding minority ÷ shares; separate id `vci-iq`; `epsBasisBySource` entry kept `'unverified'` until the dry-run; do not sum 4 per-quarter EPS figures (so derive TTM from summed NI ÷ one share count instead); sector from `sectorVn` (ICB level 2); follow-ups R-d.
  - Rejected/deferred: "take EPS/BVPS from the source's ratio fields" (they do not exist); the revenue mapping per `comTypeCode` for NH/CK/BH (codes unprobed, deferred via `unsupported_company_type`, Q5); configurable ICB level (one level is available as a label; follow-up if needed).

## Assumptions
- `numberOfSharesMktCap` on a `statistics-financial` row is the share count for that period, as the HPG history suggests. Whether it excludes treasury shares is unverified; the dry-run's `BVPS × shares ≈ parent equity` check covers it.
- Rows are matched by `(yearReport, quarter)` for statistics and `(yearReport, lengthReport)` for statements, and the string `year` field is ignored.
- A null `bsa210` is "missing", not 0. If the BS pre-step shows null as normal for firms with no minority interest, the plan returns to PLAN (no silent zero-fill).
- No ICB-code storage. Logging `icbCodeLv2` in the run summary is a follow-up, because it would change the sync job.
- Existing stored TCBS rows (if any) stay. Overlapping periods are overwritten by the existing overwrite policy and show up in `restated`. Nothing is deleted.
- The fallback source (spec §4.3 "where possible") is out of scope → follow-up ticket.
- Follow-ups (R7, not in the diff): an EPS lower-bound sanity check; a `financials_source_mixed` check for P/B and growth; peers restricted to the same `sector_source`; a bank/broker/insurer layout mapping; a KBS/VNDirect fallback.

## Blocking questions
One batch for Ming. Each has options and a proposed default.

1. **Deriving EPS/BVPS (changes ADR 0002 policy; irreversible in meaning, High tier).** VietCap gives no quarterly EPS/BVPS. `isa23` EPS is semi-annual only.
   - (a) **Default:** derive in `packages/core`, per quarter P: **EPS = TTM parent NI (`isa22`, sum of quarters P−3..P) ÷ shares at P**, and **BVPS = (equity `bsa78` − minority `bsa210`) at P ÷ shares at P**. Shares = `numberOfSharesMktCap` of row P. The exception applies only to EPS/BVPS and only from the same source and period; nothing is zero-filled.
   - (b) Derive quarterly EPS = quarter NI ÷ shares (basis `quarterly`). Summing 4 of these is distorted after share issues, so it is not recommended.
   - (c) Back out vendor TTM values (EPS = marketCap ÷ pe ÷ shares, BVPS = marketCap ÷ pb ÷ shares). These are vendor-computed with an unknown price date, so they are not traceable.
   - (d) No derivation: probe KBS/VNDirect for published EPS/BVPS first. This stays BLOCKED until the orchestrator does that probe.
   - (e) Store revenue/NI only. This needs a core policy change and a nullable-column migration, and P/E and P/B never work.
   - Why it matters: it determines the core code, the ADR and whether P/E and P/B can ever work.
2. **EPS basis declaration (reversible).** With (a), `vci-iq` declares `'ttm'`. Should P/E switch on right away, or stay `'unverified'` until the dry-run shows derived EPS × shares ≈ vendor `marketCap / pe` within ±3% on ≥ 3 symbols?
   - **Default: `'unverified'` now**, flipped by a one-line `/solo` after the dry-run.
3. **Terms risk acceptance for `iq.vietcap.com.vn`.** It is an unofficial internal API of the VietCap IQ product, unlicensed for automated use and higher-profile than the chart endpoint.
   - Options: accept with the ADR 0004 posture (about 4 requests per symbol per day, 1 s delay, honest UA, stop on 403), or reject.
   - **Default: accept**, recorded in ADR 0005 with today's date.
4. **Existing TCBS financials rows (irreversible if deleted).** Do live `tcbs-public` rows exist in the DB? Options: keep them (overwrite policy, `restated` serves as a diff), or delete them once `vci-iq` covers 12 quarters.
   - **Default: keep, delete nothing.**
5. **Banks, brokers and insurers in v1 (reversible).** Their income/balance codes are unprobed.
   - **Default:** periods for `comTypeCode ≠ CT` are rejected as `unsupported_company_type` and recorded as gaps (no signal). A follow-up ticket probes VCB/SSI/BVH and maps revenue (bank TOI, broker operating revenue, insurer net premium).
   - Alternative: hold this ticket until those are probed.
6. **Sector label (reversible).** **Default: `sectorVn` (ICB level 2, Vietnamese, e.g. "Tài nguyên Cơ bản").** Alternative: English `sector`.
   - The first live run replaces TCBS labels for every symbol that succeeds. Symbols that fail keep their old label, so the peer groups may split until the next run.
7. **Source id (reversible).** **Default: `vci-iq`** (separate from the price source's `vci-public`).

## Split proposal
None. The scope is roughly: core derivation (~80 lines + ~150 test lines), source (~220 lines + ~250 test lines), selection/config/CLI (~60 lines), ADR and fixtures. That is over 400 lines including tests and fixtures, but it is a single feature with no clean seam. The fallback source and the bank/broker/insurer mapping are already deferred to follow-ups.
