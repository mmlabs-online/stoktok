# ADR 0005: VietCap IQ as the quarterly financials source

Status: accepted (Ming, 2026-11-01). Supersedes ADR 0002 in part: the source, and the no-derivation policy for EPS and BVPS only.

## Context
On 2026-11-01 the TCBS public API used by ADR 0002 is behind a Cloudflare bot challenge (403). SSI FastConnect was dropped by Ming. The `FinancialsSource` interface (spec §4.3) keeps the source swappable. Spec §9 Q4 asks for a source after a terms check.

## Comparison
| Candidate | EPS / BVPS | Revenue / net income | Sector | Units | EPS basis | License / terms |
|---|---|---|---|---|---|---|
| **VietCap IQ** (`iq.vietcap.com.vn`) | not published per quarter (probed: no such fields) | yes: `isa3` net sales, `isa22` parent net income, quarterly | yes: `sectorVn`, `sector` (ICB level 2) | full VND, floats | none published; derived here | unofficial internal API, no terms found, no SLA |
| TCBS public | yes (recalled) | yes (recalled) | yes | billion VND (recalled) | unverified | blocked by bot challenge (HTTP 403), 2026-11-01 |
| SSI FastConnect | believed market data only (unverified) | unverified | unverified | unverified | unverified | needs registration and a key; dropped by Ming |
| KBS | not probed | not probed | not probed | not probed | not probed | unofficial; fallback candidate (follow-up) |
| VNDirect finfo | not probed | not probed | not probed | not probed | not probed | unofficial; fallback candidate (follow-up) |
| CafeF | not probed | not probed | not probed | not probed | not probed | HTML scraping; rejected |

## Decision (Ming, 2026-11-01)
1. Source id `vci-iq` (`VciIqFinancialsSource`), default in `FINANCIALS_SYNC_CONFIG.financialsSource`. `--source <vci-iq|tcbs-public>` overrides it per run. One source per job, no fallback chaining. It has its own id because it is a different host from `vci-public` with a different verification status.
2. EPS and BVPS are derived in `packages/core` (`deriveVciIqQuarter`), because the source does not publish them per quarter. ADR 0002's "no value is derived from another" changes for EPS and BVPS only; every other ADR 0002 policy (all four values valid or the period is rejected and recorded as a gap, no zero-fill, overwrite, no-data symbols, sector never wiped) is unchanged.
3. The `vci-iq` EPS basis stays `'unverified'` (P/E suppressed) until the live dry-run shows derived EPS within 3% of VietCap's own figures on at least 3 symbols; then a one-line change flips `VCI_IQ_FINANCIALS_EPS_BASIS` to `'ttm'`.
4. Terms risk accepted by Ming on 2026-11-01, same posture as ADR 0004: unofficial internal API, personal low volume, honest headers only.
5. Existing TCBS financials rows are kept; nothing is deleted. Overlapping periods are overwritten by the existing policy and appear in `restated`.
6. Banks, brokers and insurers (`comTypeCode` other than `CT`) were rejected as `unsupported_company_type` and recorded as gaps. STK-042 (2026-11-04) maps `NH`, `CK` and `BH` (see **Company types**); any other type is still rejected.
7. Sector label: `sectorVn` (Vietnamese ICB level 2).
8. Run health: the run fails only for in-window rejects whose reason is not in `FINANCIALS_SYNC_CONFIG.nonFailingRejectReasons` (default `['unsupported_company_type']`). Out-of-window rejects (before `windowStart`, or after `windowEnd` when the ratio endpoint lags the statements) are listed in `rejectedOutOfWindowBySymbol` and do not fail the run. Unsupported symbols are listed in `unsupportedSymbols`; their in-window quarters stay recorded as open gaps (R4), so no signal is produced from them.

## Endpoints (recorded 2026-11-01, symbol HPG, HTTP 200)
Base `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company`. Requests carried only the honest `User-Agent` and `Accept`; no cookie, handshake, Origin or Referer was needed. No credentials, so `.env.example` is unchanged.
- `GET {base}/{SYMBOL}/statistics-financial`: `data[]` rows with `yearReport` (number), `quarter` (1-4, 5 = year), `numberOfSharesMktCap` (share count per period). `year` is a string and `ticker` is null; both are ignored. No EPS or BVPS fields.
- `GET {base}/{SYMBOL}/financial-statement?section=INCOME_STATEMENT` and `...BALANCE_SHEET`: `data.quarters[]` (used) and `data.years[]` (ignored); period = `yearReport` + `lengthReport` (1-4; 5 = year). Rows carry `ticker`.
- `GET {base}/details?ticker={SYMBOL}`: `comTypeCode`, `sectorVn`.
- Field codes (from `/financial-statement/metrics`), per company type in one constant `VCI_IQ_FIELDS_BY_COMPANY_TYPE` (see **Company types**). For `CT`: `isa3` net sales, `isa22` net profit attributable to the parent, `bsa78` owner's equity (total, including minority interests), `bsa210` minority interests. `isa23` (EPS) is 0 in Q1 and Q3 and is not used.

## Company types (STK-042, recorded 2026-11-04)
Samples: VCB and TCB (`NH`), VND (`CK`), BMI (`BH`) in `work/tickets/STK-042/live-samples/`. Each `titleVi` below appears in that symbol's `*_metrics.json`. The constant is `VCI_IQ_FIELDS_BY_COMPANY_TYPE` in `vci-iq-financials.ts`; the enabled list is `VCI_IQ_CONFIG.supportedCompanyTypes` (R5).

| comTypeCode | Role | Code | `titleVi` | `titleEn` |
|---|---|---|---|---|
| CT | revenue / parent NI / equity / minority | `isa3` `isa22` `bsa78` `bsa210` | unchanged (STK-039) | |
| NH | revenue | `isb38` | Tổng thu nhập hoạt động | Total Operating Income |
| NH | parent net income | `isa22` | Cổ đông của Công ty mẹ | Attributable to parent company |
| NH | owners' equity (incl. minority) | `bsa78` | VỐN CHỦ SỞ HỮU | OWNER'S EQUITY |
| NH | minority interests | `bsa210` | Lợi ích của cổ đông thiểu số | Minority interest |
| CK | revenue | `isa1` | DOANH THU HOẠT ĐỘNG | OPERATING SALES |
| CK | parent net income | `isa22` | Lợi nhuận sau thuế phân bổ cho chủ sở hữu | Attributable to parent company |
| CK | owners' equity | `bsa78` | Vốn chủ sở hữu | Owner's Equity |
| CK | minority interests | `bsa210` | Lợi ích cổ đông không kiểm soát | Minority interests |
| BH | revenue | `isi64` | Doanh thu thuần từ hoạt động kinh doanh bảo hiểm | Net sales from insurance business |
| BH | parent net income | `isa22` | Lợi nhuận sau thuế của chủ sở hữu, tập đoàn | Net profit attributable to shareholders of the group |
| BH | owners' equity | `bsa78` | Vốn chủ sở hữu | Owners' equity |
| BH | minority interests | `bsa210` | Lợi ích cổ đông thiểu số | Minority Interests |

- **Bank equity.** The `NH` dictionary lists `bsa210` as a level-1 sibling of `bsa78`, but the values show `bsa78` includes minority interests: `bsb118+bsb121+bsa84+bsa85+bsa90 = bsa78 - bsa210` in every fixture quarter (VCB 2026Q3: 253,668,704,000,000). So BVPS = (`bsa78` - `bsa210`) / shares needs no extra adjustment. A test locks this in.
- **`isa21` sign.** `NH`: stored negative, `isa22 = isa20 + isa21`. `CT`: stored positive, `isa22 = isa20 - isa21`. `CK` and `BH`: `isa21 = 0` and `isa22 = isa20` in every quarter checked, so the identity is trivial there (no minority) and cannot tell parent NI from total NI. The sign rule lives only in tests; production never reads `isa20` or `isa21`.
- **Minority 0.** `CK` and `BH` report `bsa210 = 0.0`. The line exists in the dictionary, so 0 is a real value and the code is kept. The mapping type allows `minorityInterests: null` (treated as 0); no shipped type uses it. A null *value* for a mapped code is still `missing_bvps`.
- **Revenue.** `NH` uses Total Operating Income, `CK` gross operating revenue (equal to `isa3` in every sample), `BH` net insurance revenue. Revenue 0 is rejected as `zero_revenue` for every `vci-iq` type (`rejectZeroRevenue`), so a "not applicable" column is never stored as 0.
- **1% growth gate.** The base is TOI for `NH`, gross operating revenue for `CK` and net insurance revenue for `BH`. The gate only screens out near-zero bases, so the per-type base is accepted.
- **Dictionary quirks (none affects the chosen codes).** The `CK` dictionary gives `isa21` a wrong `titleEn` ("Business income tax - deferred"; its `titleVi` is correct) and lists `isa16` twice. Key order of `fullTitleEn` / `fullTitleVi` differs per symbol.
- **Sanity bounds.** Every sampled value fits `DEFAULT_FINANCIALS_SANITY` (largest |revenue| about 2.6e13, BVPS 14k-30k, EPS 1.3k-5k), so the bounds are unchanged.
- **Gating.** A type is used only if it has a mapping and is in `VCI_IQ_CONFIG.supportedCompanyTypes` (`CT`, `NH`, `CK`, `BH`); otherwise every emitted period is rejected as `unsupported_company_type`. `NH` also covers consumer-finance and asset-manager companies, which are unverified.

### Cross-check (AC3), offline on the recorded fixtures
Statement period P is paired with the `statistics-financial` row for P. Vendor amounts are `marketCap / pe` and `marketCap / pb`. `pe` and `pb` carry 10 decimals, so precision uses about 0% of the 3% budget. Tolerance 3%, not tuned. Test: `vci-iq-financials.crosscheck.test.ts`.

| Symbol (type) | P | TTM parent NI (derived) | marketCap / pe | Δ | Parent equity (derived) | marketCap / pb | Δ | EPS / BVPS (derived, VND) | Vendor EPS / BVPS |
|---|---|---|---|---|---|---|---|---|---|
| VCB (NH) | 2026Q3 | 41,661,194,000,000 | 41,661,193,969,891 | +0.000007% | 253,668,704,000,000 | 253,668,704,002,129 | -0.0000001% | 4,986 / 30,359 | 4,985.98 / 30,358.85 |
| TCB (NH) | 2026Q2 | 27,116,046,000,000 | 27,136,067,578,864 | -0.0738% | 179,162,267,000,000 | 179,162,266,999,889 | 0.0000% | 3,827 / 25,283 | 3,829.40 / 25,283.12 |
| VND (CK) | 2026Q3 | 2,099,341,876,358 | 2,099,341,876,362 | -0.00000002% | 21,761,582,798,518 | 21,761,582,798,393 | +0.0000001% | 1,379 / 14,295 | 1,379.06 / 14,295.20 |
| BMI (BH) | 2026Q3 | 260,493,093,057 | 260,493,093,056 | +0.00000002% | 3,076,644,073,949 | 3,076,644,074,131 | -0.0000006% | 1,730 / 20,436 | 1,730.30 / 20,436.35 |

All four pass; the worst case is TCB at -0.07%. TCB uses 2026Q2 because 2026Q3 contains a bonus issue (7,086,240,414 to 10,629,360,621 shares); the share count is asserted stable over P-3..P. TCB 2026Q3 amounts also agree (+0.002%; EPS 2,694 / BVPS 17,601 on the new share count). The EPS basis stays `'unverified'`: this is evidence for the flip, not the flip.

## Units and rounding (R2)
| Field | Source | Unit | Stored |
|---|---|---|---|
| Revenue | `isa3` | full VND | integer VND |
| Net income | `isa22` | full VND | integer VND |
| EPS | derived | VND per share | integer VND |
| BVPS | derived | VND per share | integer VND |
| Shares | `numberOfSharesMktCap` | shares | integer, must be a positive safe integer |

Conversion is `toVndAmount`; division rounds half away from zero (`roundDiv`). Declared once as `VCI_IQ_FINANCIALS_UNITS`; plausibility bounds in `DEFAULT_FINANCIALS_SANITY` reject a wrong-unit period instead of storing it.

## Derivation (packages/core, `deriveVciIqQuarter`)
- TTM EPS(P) = round( sum of `isa22` over P, P-1, P-2, P-3 / shares(P) ). All four consecutive quarters are required. All four use the current period's share count, so a share issue inside the window restates the window.
- BVPS(P) = round( (`bsa78`(P) - `bsa210`(P)) / shares(P) ).
- A missing or invalid share count rejects the period (`missing_shares` / `invalid_shares`). A missing quarter, equity or minority value leaves that value missing (`missing_eps` / `missing_bvps`), so the period is rejected. A null `bsa210` is "missing", not 0.
- Vendor `pe` / `pb` are not used.
- Emitted range: the source returns full history, so only the latest `vciIqMaxQuarters` (16 = lookback 12 + 4) quarters are derived and reported. Older quarters are dropped silently, so they never count as rejects (rejects among the extra 4 quarters before `windowStart` are reported as out-of-window); the full income history still feeds the TTM window of the oldest emitted quarter.

## Header policy
Hard rule: only `User-Agent` (honest `stoktok/...`) and `Accept`. A 403 or challenge page fails the run with a non-retryable error; there is no circumvention.

## Request accounting
Four sequential GETs per symbol (statistics, income statement, balance sheet, details; the last is skipped when no periods exist and cached for the sector lookup), 1 s between requests. Existing retry, circuit-breaker and delay config apply. Responses carry full history; only the latest `vciIqMaxQuarters` quarters are emitted.

## UNVERIFIED
- Whether `numberOfSharesMktCap` excludes treasury shares (covered by the BVPS check below).
- Throttling and stability of an unofficial API.
- Bank, broker and insurer layouts: verified on 2026-11-04 for VCB, TCB, VND and BMI only. `NH` also covers consumer-finance and asset-manager companies (unverified). The `CK`/`BH` parent-NI identity is trivial because minority is 0.

## First dry-run checklist (go/no-go)
Run `pnpm worker:financials --dry-run` on the home server and check:
1. No 403.
2. On at least 3 symbols, derived TTM EPS is within 3% of VietCap's own figure (`marketCap / pe / shares`). Passing this is the gate for flipping the EPS basis to `'ttm'`.
3. BVPS x shares is about the parent equity.
4. Net income equals the parent line.
5. At least 12 quarters per symbol.
6. Sector labels compared with the stored TCBS ones.
7. One non-`CT` symbol shows `unsupported_company_type`.

## Follow-ups
EPS lower-bound sanity check; a `financials_source_mixed` check for P/B and growth; peers restricted to the same `sector_source`; KBS/VNDirect fallback; the `'unverified'` to `'ttm'` flip after the dry-run.

STK-042 follow-ups: peer key `sectorVn` + `comTypeCode`; ROE-adjusted bank P/B or a "structural premium/discount" caveat; tracked-universe size (4 banks, 3 brokers: `peers_insufficient` for P/E and P/B); the `financials_source_mixed` check; a distinct `missing_company_type` reason; the `'ttm'` EPS-basis flip (separate gate); per-type `minBasePpmOfRevenue` if the gate is ever raised; verify `NH` on a consumer-finance or asset-manager symbol.
