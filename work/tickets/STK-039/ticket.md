# STK-039: Replace the quarterly financials source

| Field | Value |
|---|---|
| State | DONE |
| Priority | P2 |
| Areas | data, finance |
| Attempts | 2 |
| Created | 2026-11-01 |
| PR | https://github.com/mmlabs-online/stoktok/pull/27 |

## Goal
Choose and implement a new `FinancialsSource` for quarterly EPS, BVPS, revenue, net income and sector, because the TCBS public API used by STK-014 is now blocked by a bot challenge.

## Spec reference
docs/spec-v1.md §2.2, §4.3 (`FinancialsSource`, primary + fallback), §9 Open question 4. CLAUDE.md R2, R4, R5. ADR 0002 (financials source), STK-014.

## Acceptance criteria
- [ ] The source is chosen after a documented comparison (data coverage for EPS/BVPS/revenue/net income/sector, units, EPS basis quarterly vs TTM, license/terms for personal automated use); the choice is recorded in an ADR.
- [ ] A new `FinancialsSource` implementation feeds the existing validation, gap recording (`data_gaps`) and sector rules from ADR 0002 unchanged; every row carries `source` and `fetched_at` (R4).
- [ ] The active financials source is selected by configuration (R5); any credentials are env-only, server-side (R3), names listed in `.env.example`.
- [ ] `pnpm worker:financials` and `--dry-run` work with the new source.
- [ ] Tests use recorded fixtures and the no-network guard only; `typecheck`, `lint`, `test` pass.

## Notes / answers from Ming
- Split from "Thay nguồn giá EOD và financials (SSI FastConnect)" (Ming, 2026-11-01). Source TBD: the planner consults `data-engineer` and `finance-investment-researcher` first. SSI FastConnect Data is believed to cover market data only (unverified), so it may not fit.
- If the chosen source needs registration or a key, that is a human step for Ming; the planner returns BLOCKED with the options.
- **Answers to the blocking questions (Ming, 2026-11-01: "tự chọn phương án tốt nhất", i.e. take the best option / the stated defaults):**
  1. EPS/BVPS: option (a), derive in `packages/core`. TTM EPS = sum of the last 4 consecutive quarters' parent net income (`isa22`) ÷ that period's share count. BVPS = (`bsa78` owner's equity − `bsa210` minority interests) ÷ shares. ADR 0002's no-derivation policy changes for EPS/BVPS only; recorded in ADR 0005.
  2. P/E basis stays `'unverified'` (P/E suppressed) until a live dry-run shows derived EPS within ±3% of VietCap's own figures on at least 3 symbols.
  3. Terms risk of `iq.vietcap.com.vn` (unofficial internal API, personal low volume, honest headers only) is accepted, as in ADR 0004.
  4. Existing TCBS financials rows are kept; nothing is deleted.
  5. Banks, brokers and insurers (non-`CT` `comTypeCode`) are rejected as `unsupported_company_type` and recorded as a gap; a follow-up ticket handles them.
  6. Sector label: `sectorVn` (Vietnamese ICB level 2).
  7. Source id: `vci-iq`.
- **Balance-sheet pre-step done (orchestrator, 2026-11-01):** `live-samples/HPG_financial-statement_section_BALANCE_SHEET.json` recorded (200 JSON, honest headers). `data.quarters` has 35 rows keyed by `yearReport`/`lengthReport`. `metrics` confirms `bsa78` = "Owner's Equity" (top level) and `bsa210` = "Minority interests" (parent BSA79, so inside `bsa78`). Amounts are full VND: HPG 2026 Q3 `bsa78` = 149,568,352,619,326, `bsa210` = 772,935,036,121, `bsa80` paid-in capital = 84,429,645,200,000 (≈ 8.44 bn shares at 10,000 par) → BVPS ≈ 17,620 VND.
