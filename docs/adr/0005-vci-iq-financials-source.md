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
6. Banks, brokers and insurers (`comTypeCode` other than `CT`) are rejected as `unsupported_company_type` and recorded as gaps. A follow-up ticket maps their layouts.
7. Sector label: `sectorVn` (Vietnamese ICB level 2).

## Endpoints (recorded 2026-11-01, symbol HPG, HTTP 200)
Base `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company`. Requests carried only the honest `User-Agent` and `Accept`; no cookie, handshake, Origin or Referer was needed. No credentials, so `.env.example` is unchanged.
- `GET {base}/{SYMBOL}/statistics-financial`: `data[]` rows with `yearReport` (number), `quarter` (1-4, 5 = year), `numberOfSharesMktCap` (share count per period). `year` is a string and `ticker` is null; both are ignored. No EPS or BVPS fields.
- `GET {base}/{SYMBOL}/financial-statement?section=INCOME_STATEMENT` and `...BALANCE_SHEET`: `data.quarters[]` (used) and `data.years[]` (ignored); period = `yearReport` + `lengthReport` (1-4; 5 = year). Rows carry `ticker`.
- `GET {base}/details?ticker={SYMBOL}`: `comTypeCode`, `sectorVn`.
- Field codes (from `/financial-statement/metrics`), in one constant `VCI_IQ_FIELDS`: `isa3` net sales, `isa22` net profit attributable to the parent, `bsa78` owner's equity (total, including minority interests), `bsa210` minority interests. `isa23` (EPS) is 0 in Q1 and Q3 and is not used.

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

## Header policy
Hard rule: only `User-Agent` (honest `stoktok/...`) and `Accept`. A 403 or challenge page fails the run with a non-retryable error; there is no circumvention.

## Request accounting
Four sequential GETs per symbol (statistics, income statement, balance sheet, details; the last is skipped when no periods exist and cached for the sector lookup), 1 s between requests. Existing retry, circuit-breaker and delay config apply.

## UNVERIFIED
- Whether `numberOfSharesMktCap` excludes treasury shares (covered by the BVPS check below).
- Throttling and stability of an unofficial API.
- Bank, broker and insurer layouts (not probed).

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
EPS lower-bound sanity check; a `financials_source_mixed` check for P/B and growth; peers restricted to the same `sector_source`; bank/broker/insurer mapping; KBS/VNDirect fallback; the `'unverified'` to `'ttm'` flip after the dry-run.
