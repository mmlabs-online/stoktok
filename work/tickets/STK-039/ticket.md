# STK-039: Replace the quarterly financials source

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | data, finance |
| Attempts | 0 |
| Created | 2026-11-01 |
| PR | — |

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
