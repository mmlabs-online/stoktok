Status: READY

# Plan — STK-042: Financials for banks, securities firms and insurers (VietCap IQ)

> **Re-planned 2026-11-04 after samples.** The earlier BLOCKED status was due to Q1/Q2. Both are now answered (ticket Notes): samples for VCB, TCB (`NH`), VND (`CK`) and BMI (`BH`) were recorded by Ming at 2026-11-04T03:45Z (commit f17643d) and are in `work/tickets/STK-042/live-samples/`. BMI is the insurer sample only and is not added to the watchlist. The field codes, identity checks and cross-check results below come from those files. They are no longer left to the implementer. See **Changes after samples** at the end.

## Spec summary
- docs/spec-v1.md §2.2: "Public sources … are **unofficial and can change or break without notice**." "Gaps must be detected, not silently interpolated."
- §3 F4, medium term: "P/E and P/B vs sector, earnings growth trend … | Daily OHLCV, quarterly financials". Also: "Signals are suppressed if the underlying data is stale or has gaps."
- §4.3: "One interface per data type (`PriceSource`, `FinancialsSource`, `NewsSource`); each implementation is swappable." "Every record stores `source` and `fetched_at`."
- CLAUDE.md R1 (calculations in `packages/core`), R2 (integer VND), R4 (source/fetched_at; gaps recorded, no signal from gapped data), R5 (market rules and config are not hard-coded).
- ADR 0005 decision 6: "Banks, brokers and insurers (`comTypeCode` other than `CT`) are rejected as `unsupported_company_type` … A follow-up ticket maps their layouts." That follow-up is this ticket. Also decision 3: the EPS basis stays `'unverified'` until a separate gate passes. **STK-042 does not flip it** (consult-data rec 8).

## Field mapping (from the recorded samples — final)
All codes come from each symbol's `*_financial-statement_metrics.json`, matched by `titleVi`. Recorded 2026-11-04. The `CT` row is unchanged (STK-039).

| comTypeCode | Role | Code | `titleVi` | `titleEn` | Notes |
|---|---|---|---|---|---|
| NH (VCB, TCB) | revenue | `isb38` | Tổng thu nhập hoạt động | Total Operating Income | Finance F3 primary choice (TOI), so the fallback `isb25` is not needed. The dictionary nests it under `ISB36`, which is odd, but the title is unique. Non-zero in every quarter 2022Q1–2026Q3 for both banks. |
| NH | parent net income | `isa22` | Cổ đông của Công ty mẹ | Attributable to parent company | |
| NH | owners' equity (incl. minority) | `bsa78` | VỐN CHỦ SỞ HỮU | OWNER'S EQUITY | **The dictionary lists `bsa210` as a level-1 sibling, but the values show that `bsa78` includes minority interests.** VCB 2026Q3: `bsb118+bsb121+bsa84+bsa85+bsa90` = 253,668,704,000,000 = `bsa78 − bsa210`. TCB 2026Q3: 187,086,971,000,000 = `bsa78 − bsa210`. `bsa96 = bsa54 + bsa78` exactly. So BVPS = (bsa78 − bsa210)/shares is correct, with no double subtraction. |
| NH | minority interests | `bsa210` | Lợi ích của cổ đông thiểu số | Minority interest | Non-zero (VCB ~9e10, TCB ~1e13). Not `bsa95` ("(trước 2015)"). |
| CK (VND) | revenue | `isa1` | DOANH THU HOẠT ĐỘNG | OPERATING SALES | Finance F3 "gross total operating revenue", the level-1 total. `isa3` ("Doanh thu thuần về hoạt động kinh doanh") equals `isa1` in every sampled quarter (no deductions). `isa1` is chosen per the default. |
| CK | parent net income | `isa22` | Lợi nhuận sau thuế phân bổ cho chủ sở hữu | Attributable to parent company | Level 2 under `ISA20`. |
| CK | owners' equity | `bsa78` | Vốn chủ sở hữu | Owner's Equity | `bsa210` is a child of `BSA78` (included, same as CT). |
| CK | minority interests | `bsa210` | Lợi ích cổ đông không kiểm soát | Minority interests | The line exists in the dictionary. Its value is `0.0` in every VND quarter. Keep the **code** (not `null`): the line exists, so 0 is a real value (plan rule "never infer null from 0.0"). |
| BH (BMI) | revenue | `isi64` | Doanh thu thuần từ hoạt động kinh doanh bảo hiểm | Net sales from insurance business | Exactly the finance default. Non-zero in every quarter 2022Q1–2026Q3 (~1.1–1.6e12). Not `isi105` (net premium only) or `isi103` (gross premium). |
| BH | parent net income | `isa22` | Lợi nhuận sau thuế của chủ sở hữu, tập đoàn | Net profit attributable to shareholders of the group | |
| BH | owners' equity | `bsa78` | Vốn chủ sở hữu | Owners' equity | `bsa210` is a child of `BSA78`. |
| BH | minority interests | `bsa210` | Lợi ích cổ đông thiểu số | Minority Interests | Value `0.0` in every BMI quarter; same reasoning as CK (keep the code). |
| CT (HPG) | — | `isa3`, `isa22`, `bsa78`, `bsa210` | unchanged | unchanged | STK-039. |

Every type therefore has an explicit minority code. None needs `minorityInterests: null`. The `null` branch stays in the type and is tested (finance rec 1), but no shipped mapping uses it.

**Dictionary quirks to record in ADR 0005 (none affects the chosen codes):**
- In the CK dictionary, `isa21` has the wrong `titleEn` ("Business income tax - deferred"). Its `titleVi` is correct ("Lợi nhuận thuần phân bổ cho lợi ích của cổ đông không kiểm soát").
- The CK dictionary lists `isa16` twice (PBT and tax expense).
- Dictionary key order differs per symbol (`fullTitleEn` / `fullTitleVi`).

**Parent ≈ NPAT − minority identity (finance F4), verified on the samples.** The sign convention of `isa21` differs per type:
- **NH:** `isa21` is stored **negative**, so `isa22 = isa20 + isa21` exactly. This holds in all 16 quarters 2022Q4–2026Q3, and also 2022Q1–Q3, for VCB and TCB. Example: TCB 2026Q3 is 8,337,286e6 − 394,354e6 = 7,942,932e6. TCB's minority is material (~5% of NPAT in 2025–26), so this check really separates parent NI from total NI.
- **CT (HPG):** `isa21` is stored **positive**, so `isa22 = isa20 − isa21`.
- **CK (VND) and BH (BMI):** `isa21 = 0` and `isa22 = isa20` in every quarter checked (2022Q2/Q3–2026Q3). The identity holds trivially here and **cannot** tell parent NI from total NI. This is accepted: there is no minority, so the two are equal. It is recorded in the ADR.

The identity test therefore asserts the per-type form: NH `isa22 === isa20 + isa21`; CK/BH `isa21 === 0 && isa22 === isa20`. The comparison uses integer VND via `toVndAmount`. This sign rule lives **only in the test**. Production code never reads `isa20` or `isa21`.

**Non-zero check:** revenue, parent NI and equity are non-zero in every quarter of the 16-quarter window for all four symbols.
- VND 2022Q4 parent NI is **negative** (−38,359,787,572). It is non-zero, so it is valid, and it stays in the window.
- BMI 2025Q4 parent NI is small but non-zero (3,583,116,939).

**Sanity bounds:** all values are inside `DEFAULT_FINANCIALS_SANITY`, so the bounds need no change.
- Largest |revenue| is VCB `isb38` ≈ 2.6e13 and largest |NI| is ≈ 1.5e13, both below 1e15.
- BVPS ranges 14k–30k, inside 100–1e7. EPS ranges 1.3k–5k, below 1e6.
- VCB `bsa78` ≈ 2.5e14 is a safe integer.

## Cross-check results (AC3) — pre-computed by the planner from the samples
Method:
- Statement period P is paired with the `statistics-financial` row for P (`quarter` = P, not the latest row).
- Amounts first: TTM parent NI = Σ `isa22` over P..P−3, compared with `marketCap_P / pe_P`. Parent equity = (`bsa78` − `bsa210`)_P, compared with `marketCap_P / pb_P`.
- `pe` and `pb` have 10 decimals, so precision uses about 0% of the 3% budget.
- Shares are `numberOfSharesMktCap_P`. The per-share forms use the same denominator on both sides, so their Δ equals the amount Δ up to rounding.

| Symbol (type) | P | Shares stable P−3..P? | TTM parent NI (derived) | mc/pe | Δ | Parent equity (derived) | mc/pb | Δ | EPS / BVPS (derived, VND) | Expected |
|---|---|---|---|---|---|---|---|---|---|---|
| VCB (NH) | 2026Q3 | yes (8,355,675,094 since 2024Q4) | 41,661,194,000,000 | ≈ 41,661.19e9 | ≈ 0.00% | 253,668,704,000,000 | ≈ 253,668.7e9 | ≈ 0.00% | 4,986 / 30,359 | **PASS** |
| TCB (NH) | 2026Q2 | yes (7,086,240,414 for 2025Q2–2026Q2) | 27,116,046,000,000 | ≈ 27,136.07e9 | ≈ −0.07% | 179,162,267,000,000 | ≈ 179,162.3e9 | ≈ 0.00% | 3,827 / 25,283 | **PASS** |
| TCB (NH) | 2026Q3 (shares 7.09e9 → 10.63e9 this quarter, bonus issue) | **no** | 28,639,634,000,000 | ≈ 28,638.99e9 | ≈ +0.002% | 187,086,971,000,000 | ≈ 187,087.0e9 | ≈ 0.00% | 2,694 / 17,601 | PASS (amounts); informational row |
| VND (CK) | 2026Q3 | yes (1,522,299,908) | 2,099,341,876,358 | ≈ 2,099.34e9 | ≈ 0.00% | 21,761,582,798,518 | ≈ 21,761.6e9 | ≈ 0.00% | 1,379 / 14,295 | **PASS** |
| BMI (BH) | 2026Q3 | yes (150,547,626) | 260,493,093,057 | ≈ 260.493e9 | ≈ 0.00% | 3,076,644,073,949 | ≈ 3,076.64e9 | ≈ 0.00% | 1,730 / 20,436 | **PASS** |

**Conclusion:** every type passes, with a worst case of 0.07%. So `VCI_IQ_CONFIG.supportedCompanyTypes = ['CT', 'NH', 'CK', 'BH']`. No type is left out.

VietCap's own `pe`/`pb` equal `marketCap / Σ4 isa22` and `marketCap / (bsa78 − bsa210)` almost exactly. This independently confirms the parent-NI and parent-equity choice for all three layouts, including the bank `bsa78`-includes-minority finding.

The derived amounts above are exact sums of recorded values. The mc/pe and mc/pb figures and the EPS/BVPS values are the planner's hand arithmetic, accurate to about ±1 VND per share and ±0.01 pp. The implementer recomputes them from the trimmed fixtures (EPS/BVPS rounded half away from zero, as `roundDiv` does), writes the exact values in the test comments, and stops if any Δ exceeds 3%. A failing type is removed from `supportedCompanyTypes` and the failure is recorded (AC4); the tolerance is never tuned.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | The revenue line and parent net income line per company type are chosen from the recorded `metrics` dictionary and live samples (one bank, one broker, one insurer), and recorded per `comTypeCode` in one constant and in ADR 0005. | The raw samples exist in `work/tickets/STK-042/live-samples/`, with a README giving the recorded-at time and recorder. `VCI_IQ_FIELDS_BY_COMPANY_TYPE` in `vci-iq-financials.ts` holds exactly the codes in the **Field mapping** table above, and it is the only place they live: `grep -nE "'(isb38\|isi64\|isa1\|isa3\|isa22\|bsa78\|bsa210)'" apps/worker/src` matches only that constant. ADR 0005 has the per-type table (code, `titleVi`, `titleEn`, recorded date) matching the constant, and each `titleVi` appears in that symbol's `*_metrics.json`. These tests pass: `vci-iq-financials.test.ts › <type> mapping › mapped revenue, parent NI and equity are non-zero in every fixture quarter`, `› parent NI identity holds in every fixture quarter`, and `› NH: bsa78 − bsa210 equals the sum of equity components`. |
| 2 | EPS and BVPS for these types use the STK-039 derivation in `packages/core`, with unit tests for each type's field mapping. | The adapter still calls `deriveVciIqQuarter`, with no per-type formula. The new core tests in `financials-derive.test.ts` (bank scale, minority 0) and `financials.test.ts` (`zero_revenue`) pass. Adapter tests `› NH (VCB)\|NH (TCB)\|CK (VND)\|BH (BMI) mapping › derives EPS/BVPS/revenue/netIncome for 2026Q3` assert exact integers that match the cross-check table (VCB 4,986/30,359; TCB 2,694/17,601; VND 1,379/14,295; BMI 1,730/20,436, each confirmed from the fixture in the test comment). |
| 3 | A dry-run cross-check shows derived EPS and BVPS within ±3% of VietCap's own figures (market cap ÷ P/E, market cap ÷ P/B) on at least one symbol per type. | `vci-iq-financials.crosscheck.test.ts` runs offline on the recorded fixtures. For VCB 2026Q3, TCB 2026Q2, VND 2026Q3 and BMI 2026Q3 it checks: TTM parent NI within 3% of marketCap_P/pe_P, parent equity within 3% of marketCap_P/pb_P, and the per-share forms. ADR 0005 and `impl-log.md` carry the results table (symbol, P, derived, vendor, Δ%, `pe`/`pb` precision), matching the table above. |
| 4 | A type still not covered stays rejected as `unsupported_company_type`. | Tests `› rejects an unlisted comTypeCode ('XX') as unsupported_company_type for every emitted period`, `› rejects a mapped type that is not in supportedCompanyTypes` (options override `['CT']` with a VCB fixture), and `› missing details / missing comTypeCode stays unsupported_company_type`. |
| 5 | Tests use recorded fixtures and the no-network guard only; `typecheck`, `lint`, `test` pass. | `pnpm typecheck && pnpm lint && pnpm test` are green. The new fixtures are trimmed copies of the STK-042 recordings, and the fixtures README says so. Tests use the existing injected `fetchImpl` / no-network guard and make no real fetch. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `work/tickets/STK-042/live-samples/*` | **Read only.** Already recorded by Ming. Do not refetch and do not edit. | AC1, AC3 |
| `apps/worker/src/sources/vci-iq-financials.ts` | Replace `VCI_IQ_FIELDS` and `SUPPORTED_COMPANY_TYPE` with: `VCI_IQ_FIELDS_BY_COMPANY_TYPE` (keys `CT`, `NH`, `CK`, `BH`; per type `revenue`, `parentNetIncome`, `ownersEquity`, `minorityInterests: string \| null`; codes exactly as in the Field mapping table, each with a comment giving `titleVi` and "recorded 2026-11-04"); `VCI_IQ_COMMON_FIELDS` (`shares`, `companyType`, `sector`); and an exported `resolveVciIqFields(comTypeCode, supported)` that returns the field set or `null`. Use the resolved set in `fetchQuarterly`. Pass `rejectZeroRevenue: true` in sanity. Keep `VCI_IQ_FINANCIALS_EPS_BASIS = 'unverified'`. | AC1, AC2, AC4 |
| `apps/worker/src/config.ts` | Add `VCI_IQ_CONFIG.supportedCompanyTypes: readonly string[] = ['CT', 'NH', 'CK', 'BH']`, with a comment citing the STK-042 cross-check. Allow an override through `VciIqFinancialsOptions.supportedCompanyTypes?` (needed for the AC4 gating test). | AC4, R5 (finance rec 3) |
| `packages/core/src/market/config.ts` | Add an optional `FinancialsSanity.rejectZeroRevenue?: boolean` with a doc comment. `DEFAULT_FINANCIALS_SANITY` is unchanged, so TCBS behaviour stays the same. | Zero-revenue guard (finance rec 2), R5 |
| `packages/core/src/market/financials.ts` | `if (revenue === 0 && sanity.rejectZeroRevenue) return fail('zero_revenue')`, before the band checks. Add `zero_revenue` to the reason union. | R4: a "not applicable" column must never be stored as revenue 0 |
| `packages/core/src/market/financials.test.ts` | Tests for `zero_revenue`. | R8 |
| `packages/core/src/market/financials-derive.test.ts` | Bank-scale and minority-0 tests. | AC2, R8 |
| `apps/worker/src/sources/vci-iq-financials.test.ts` | Per-type mapping, identity, equity-component, missing-code, zero-revenue, unsupported-type and gating tests. Retarget the tests that used `details-bank.json`. | AC1, AC2, AC4 |
| `apps/worker/src/sources/vci-iq-financials.crosscheck.test.ts` | New. An offline ±3% cross-check on the recorded fixtures for VCB 2026Q3, TCB 2026Q2, VND 2026Q3 and BMI 2026Q3. The helper lives in the test file only. | AC3 |
| `apps/worker/test/fixtures/vci-iq/{vcb,tcb,vnd,bmi}-{statistics,income,balance,details}.json` | New (16 files). Trimmed copies of the STK-042 recordings, values unchanged. Keep quarter rows from **2022Q1** onward, so the full 16-quarter window 2022Q4–2026Q3 and its TTM look-back are present. Keep the response envelope, identifying fields (`ticker`, `yearReport`, `lengthReport`/`quarter`), the mapped fields, `isa20`/`isa21`, and for NH also `bsb118`, `bsb121`, `bsa84`, `bsa85`, `bsa90`. Stats rows keep `pe`, `pb`, `marketCap`, `numberOfSharesMktCap`. Details keep `ticker`, `comTypeCode`, `isBank`, `sectorVn`. | AC1, AC5 |
| `apps/worker/test/fixtures/vci-iq/details-bank.json` | Delete. Tests that need an unsupported type use an in-memory copy of a recorded `details` with `comTypeCode` changed. | AC5: recorded fixtures only (consult-data rec 1) |
| `apps/worker/test/fixtures/vci-iq/README.md` | List the new recorded files, with source symbol, recording date 2026-11-04, and trimming rule. Remove the hand-written entry. | AC5 |
| `docs/adr/0005-vci-iq-financials-source.md` | Add: the per-type field table; the bank `bsa78` finding; the `isa21` sign conventions; the dictionary quirks; `supportedCompanyTypes` gating; `zero_revenue`; the cross-check results table; the meaning of the 1% growth gate per type (finance rec 7); edits to the UNVERIFIED line and the Follow-ups. | AC1, AC3 |

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `financials.test.ts › rejectZeroRevenue: revenue 0 -> zero_revenue` | Zero-revenue guard |
| `financials.test.ts › rejectZeroRevenue unset: revenue 0 still accepted (TCBS unchanged)` | No regression |
| `financials-derive.test.ts › bank-scale amounts (VCB 2026Q3: equity 253,761,146,000,000, minority 92,442,000,000, four quarters summing 41,661,194,000,000, shares 8,355,675,094) derive EPS 4,986 / BVPS 30,359` (implementer confirms the exact integers) | AC2, R2 (BigInt path at bank scale) |
| `financials-derive.test.ts › minority 0 -> BVPS = equity / shares` | AC2 (CK/BH layouts; and a `null` mapping passes 0) |
| `vci-iq-financials.test.ts › NH (VCB) mapping › derives EPS/BVPS/revenue/netIncome for 2026Q3` (revenue 25,431,117,000,000; NI 9,033,302,000,000) | AC2 |
| `vci-iq-financials.test.ts › NH (TCB) mapping › derives … for 2026Q3` (revenue 16,587,715,000,000; NI 7,942,932,000,000; EPS 2,694; BVPS 17,601) | AC2 (material minority) |
| `vci-iq-financials.test.ts › CK (VND) mapping › derives … for 2026Q3` (revenue 1,714,820,453,789; NI 329,458,120,320; EPS 1,379; BVPS 14,295) | AC2 |
| `vci-iq-financials.test.ts › BH (BMI) mapping › derives … for 2026Q3` (revenue 1,563,314,122,394; NI 75,776,567,450; EPS 1,730; BVPS 20,436) | AC2 |
| `vci-iq-financials.test.ts › <type> mapping › mapped revenue, parent NI and equity are non-zero in every fixture quarter` | AC1 (guards against a "not applicable" 0.0 column, finance F2) |
| `vci-iq-financials.test.ts › <type> mapping › parent NI identity holds in every fixture quarter` (NH: `isa22 === isa20 + isa21`; CK/BH: `isa21 === 0 && isa22 === isa20`) | AC1 (parent, not total, NI; finance F4) |
| `vci-iq-financials.test.ts › NH mapping › bsa78 − bsa210 equals bsb118+bsb121+bsa84+bsa85+bsa90 in every fixture quarter` (VCB, TCB) | AC1 (bsa78 includes minority despite the flat dictionary; no double subtraction) |
| `vci-iq-financials.test.ts › <type> mapping › removing the mapped revenue / parent NI / equity / minority code rejects every affected period (no zero-fill)` | R4, consult-data rec 7 |
| `vci-iq-financials.test.ts › <type> mapping › mapped revenue 0 in one quarter -> that period zero_revenue` | Zero-revenue guard in the adapter |
| `vci-iq-financials.test.ts › minorityInterests null in mapping -> minority treated as 0; minority code present but value null -> missing_bvps` (synthetic mapping passed to `resolveVciIqFields`/adapter options; no shipped type uses `null`) | Explicit-declaration rule (finance rec 1) |
| `vci-iq-financials.test.ts › unlisted comTypeCode 'XX' -> every emitted period unsupported_company_type` | AC4 |
| `vci-iq-financials.test.ts › mapped type not in supportedCompanyTypes -> unsupported_company_type` | AC4, gating |
| `vci-iq-financials.test.ts › details 404 / comTypeCode missing -> unsupported_company_type` | AC4 (current behaviour kept) |
| `vci-iq-financials.test.ts › CT (HPG) results unchanged` (existing HPG tests stay green with no edits to their expectations) | No regression |
| `vci-iq-financials.crosscheck.test.ts › <SYM> period P › TTM parent NI within 3% of marketCap_P/pe_P; EPS within 3% of marketCap_P/pe_P/shares_P` (VCB 2026Q3, TCB 2026Q2, VND 2026Q3, BMI 2026Q3) | AC3 |
| `vci-iq-financials.crosscheck.test.ts › <SYM> period P › parent equity within 3% of marketCap_P/pb_P; BVPS within 3% of marketCap_P/pb_P/shares_P` | AC3 |
| `vci-iq-financials.crosscheck.test.ts › stats row is paired by period (P's row, not the latest)` | AC3 method (finance rec 4) |

## Approach
1. **Do not fetch.** The samples are the source of truth. The sandbox proxy returns 403, and no bypass is allowed.
2. **Mapping.** Copy the Field mapping table into `VCI_IQ_FIELDS_BY_COMPANY_TYPE`. Before writing code, re-check each `titleVi` against the symbol's `*_metrics.json` (`grep '"field":"<code>"'`). If any title differs from the table, stop and record it in the impl-log.
3. **Adapter (`vci-iq-financials.ts`):**
   - Keep the request order (stats → income → balance → details). Mapping is only needed at derive time, after details is loaded (minimal change; consult-data rec 3 marks the reorder optional).
   - Replace the `!== SUPPORTED_COMPANY_TYPE` check with `const f = resolveVciIqFields(details?.comTypeCode, this.o.supportedCompanyTypes ?? VCI_IQ_CONFIG.supportedCompanyTypes)`. If `null`, reject every emitted period as `unsupported_company_type` (same code path as today).
   - Build `netIncomeByPeriod` from `f.parentNetIncome`. Use `f.ownersEquity`, `f.minorityInterests === null ? 0 : amount(b, f.minorityInterests)`, and `revenue: i?.[f.revenue]`.
   - Sanity: `{ ...(this.o.sanity ?? DEFAULT_FINANCIALS_SANITY), rejectZeroRevenue: true }`. This applies to CT too; HPG revenue is never 0.
4. **Core:**
   - Add `rejectZeroRevenue` (optional, default off) and the `zero_revenue` reason.
   - `deriveVciIqQuarter` is unchanged.
   - Bounds are confirmed adequate from the samples (see Field mapping › Sanity bounds), so `DEFAULT_FINANCIALS_SANITY` does not change.
5. **Gating (R5):** `supportedCompanyTypes = ['CT','NH','CK','BH']`, because all three types passed AC3 on the samples.
   - If the implementer's exact recomputation shows any type outside ±3%, remove that type from the list, record why in the ADR and impl-log, and keep its fixture tests expecting `unsupported_company_type`. The planner's numbers make this unexpected.
   - `nonFailingRejectReasons` stays `['unsupported_company_type']`. Rejects for newly supported symbols now fail the run, which is intended (consult-data rec 7).
6. **Cross-check test:**
   - Integer VND via `toVndAmount`.
   - Vendor amount = `marketCap / pe` as a float in the test only. Compare `|derived/vendor − 1| ≤ 0.03`.
   - Pair by period, skip `pe ≤ 0`, and assert the share count is stable over P−3..P for the chosen P. This is why TCB uses 2026Q2: 2026Q3 contains the bonus issue. A 2026Q3 TCB amount check may be added as informational, but it is not needed.
   - The tolerance is not tuned.
7. **Fixtures:** trim the recordings as listed in Files (quarter rows 2022Q1+, values unchanged). Delete `details-bank.json` and update the README.
8. **ADR 0005:** add the per-type table, the bank `bsa78` finding, the `isa21` sign conventions, the dictionary quirks, gating, `zero_revenue`, the cross-check results, and the per-type meaning of the 1% growth gate. The gate's base is TOI for NH, gross operating revenue for CK, and net insurance revenue for BH. This is accepted because the gate only screens out near-zero bases (finance rec 7).
   - Update UNVERIFIED: layouts verified for VCB/TCB/VND/BMI on 2026-11-04. `NH` also covers consumer-finance and asset-manager companies, which are unverified (finance F5). The CK/BH identity is trivial because minority is 0.
   - Add the follow-ups below.
9. **Rules:**
   - R1/R2: no new math outside core, except test-only cross-check arithmetic. Integers go through `toVndAmount`/`roundDiv`.
   - R3: not touched.
   - R4: missing codes or values reject and record a gap with no zero-fill. Revenue 0 is now a reject.
   - R5: supported types and the zero-revenue flag are config.
   - R6: suspended; no auth added.
   - R7: the follow-ups below are not in the diff.
   - R8: core tests are listed.
   - R9: n/a.
   - R10: no brokerage login; public endpoints only.
10. **Follow-ups to list in the impl-log, not implemented (R7):**
    - Peer key `sectorVn` + `comTypeCode` (finance F5, rec 6).
    - ROE-adjusted bank P/B, or a "structural premium/discount" caveat (finance F6).
    - Tracked-universe size: only 4 banks and 3 brokers, so `peers_insufficient` for P/E and P/B (finance Q5).
    - The `financials_source_mixed` check.
    - A distinct `missing_company_type` reason (STK-039 review; consult-data Q5).
    - The EPS-basis flip to `'ttm'`, a separate ADR 0005 gate. The STK-042 cross-check is evidence for it, but it does not flip it.
    - Per-type `minBasePpmOfRevenue`, only if the gate is ever raised.
    - Verify the `NH` mapping on a consumer-finance or asset-manager symbol.

## Specialist input used
- **consult-data-engineer:**
  - Adopted:
    - Samples as a prerequisite, with no guessing of codes (now met).
    - The per-type constant keyed by `comTypeCode`; supported types = map keys plus gating.
    - The ADR table.
    - A missing or renamed code rejects all periods; a per-type removed-code test.
    - The run-health consequence.
    - The bank-scale guard check, now done against the samples.
    - The offline cross-check from recorded `statistics-financial`, with no tolerance tuning and no EPS-basis flip.
    - Recordings trimmed into fixtures; the hand-written `details-bank.json` replaced.
  - Rejected: reordering to fetch details first (rec 3). It is not needed for correctness, and the consult marks it optional.
  - Deferred: the `missing_company_type` reason → follow-up (R7).
- **consult-finance-investment-researcher:**
  - Adopted:
    - F3 revenue line per type. The NH primary (TOI, `isb38`) exists, so no fallback is needed.
    - F4 parent-NI identity check, now with per-type `isa21` sign conventions found in the samples.
    - Rec 1: explicit minority declaration. All types have a `bsa210` line, so there is no `null` in shipped mappings.
    - Rec 2: `zero_revenue`.
    - Rec 3: `supportedCompanyTypes` gating.
    - Rec 4: amount-first, P-paired cross-check, two banks, `pe` precision.
    - Rec 5: share-count timing (TCB 2026Q3 bonus issue → P = 2026Q2).
    - Rec 7: ADR text on the 1% gate.
  - Recorded as follow-ups: F5/F6 and rec 6.
  - F7 (VAS 30 basic EPS differs) is kept as the rule "compare against VietCap `pe`, never `isa23`".

## Assumptions
- A1. The offline cross-check on recorded `statistics-financial` and statements meets AC3's "dry-run cross-check" (Q5 default). A live `--dry-run` on Ming's machine after merge is optional confirmation.
- A2. Bank revenue = TOI (`isb38`); broker revenue = gross operating revenue (`isa1`, equal to `isa3` in the samples); insurer revenue = net revenue from insurance business (`isi64`). These are the Q3 finance defaults.
- A3. A type is enabled only after its cross-check passes (Q4 default). All three passed on the samples.
- A4. `rejectZeroRevenue` is on for all `vci-iq` types, including CT. HPG is unaffected.
- A5. `NH` symbols that are not banks get the bank mapping. If their layout differs, the non-zero, identity or band guards reject their periods rather than storing them wrong. Follow-up listed.
- A6. Peer insufficiency for banks and brokers is accepted for now (finance Q5 default).
- A7. For CK and BH, `bsa210 = 0` is treated as a real zero (the line exists in the dictionary), not as "not applicable". If a future broker or insurer reports minority, it is subtracted automatically.
- A8. The watched non-CT symbols (SHB, TPB, AGR, BSI) are covered by the type mapping without their own samples. Their periods are still guarded by the non-zero and band checks at run time. If one fails, the run shows its rejects (consult-data rec 7).

## Blocking questions
None.
- Q1 was answered as Option A (Ming recorded the samples, commit f17643d).
- Q2 was answered as (a): BMI is the insurer sample and is not on the watchlist.
- Q3–Q5 keep their defaults (A1–A3).

## Split proposal
None. The estimated diff is about 150 lines of source and about 300 lines of tests plus ADR text, plus trimmed JSON fixtures. It covers one feature (the non-CT mapping).

## Changes after samples
- **Status BLOCKED → READY.** The unblock condition is met (samples committed; Q1/Q2 answered in the ticket Notes).
- **Codes are now fixed in the plan** (Field mapping table) instead of being picked by the implementer from rules:
  - NH: `isb38` / `isa22` / `bsa78` / `bsa210`.
  - CK: `isa1` / `isa22` / `bsa78` / `bsa210`.
  - BH: `isi64` / `isa22` / `bsa78` / `bsa210`.
- **New finding, bank equity:** the NH dictionary shows `bsa210` as a sibling of `bsa78`, but the values prove `bsa78` includes minority. The formula (bsa78 − bsa210) is therefore correct. A component-sum test was added to lock this in, so the NH fixtures keep five extra equity fields.
- **New finding, `isa21` sign:** negative for NH, positive for CT, zero for CK/BH. The identity test is now per type (NH `isa22 = isa20 + isa21`) instead of a single "isa20 − isa21". The CK/BH identity is trivial (no minority), and this is recorded rather than treated as a failure.
- **No `minorityInterests: null` in shipped mappings.** Every layout has a minority line. The `null` branch is kept and tested with a synthetic mapping.
- **Cross-check pre-computed:** all four symbols pass, worst case TCB 2026Q2 at −0.07%. So `supportedCompanyTypes = ['CT','NH','CK','BH']` (previously "CT plus whichever pass"). TCB uses P = 2026Q2 because 2026Q3 contains a 1.5× share issue (7,086,240,414 → 10,629,360,621). Its 2026Q3 amounts also pass.
- **Expected per-symbol integers are added** to the tests (revenue, NI, EPS, BVPS for 2026Q3), so the reviewer can check them against the cross-check table.
- **Fixtures:**
  - Named per symbol (`vcb|tcb|vnd|bmi-*`) instead of `bank|broker|insurer-*`, because two banks are fixtured.
  - Trimmed from 2022Q1 (was "2023+") so the full 16-quarter window (2022Q4–2026Q3) and its TTM look-back are present.
- **Sanity bounds are confirmed adequate** from real values (previously "verify"). No change to `DEFAULT_FINANCIALS_SANITY`.
- **Option for tests:** `VciIqFinancialsOptions.supportedCompanyTypes?` override, needed to test AC4 gating now that the default includes every mapped type.
- **Dictionary quirks are recorded** for the ADR (CK `isa21` titleEn mislabel, duplicated CK `isa16`). They do not affect the chosen codes.
- **Removed:** the Q1 recording script and Option B text (resolved). The script remains in `work/tickets/STK-042/record-vci-samples.sh`.
