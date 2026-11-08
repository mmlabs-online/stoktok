# STK-067: Financial ratios derived in core (margins, D/E, ROE, ROA, YoY, P/E, P/B)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | finance, db |
| Attempts | 0 |
| Created | 2026-11-08 |
| PR | — |

## Goal
Compute key ratios from the statement lines stored by STK-061 so the AI layer can cite them. All arithmetic is in `packages/core`. This is slice B of the original STK-061.

## Spec reference
docs/spec-v1.md §3 F4, §5 `financials`. CLAUDE.md R1, R2, R4, R5. Plan: work/tickets/STK-061/plan.md "Split proposal".

## Acceptance criteria
- [ ] Ratios are derived in core and tested: gross margin, net margin, debt/equity, ROE, ROA, and YoY for revenue and parent net income. YoY reuses the `growth.ts` base rules, so a non-positive or tiny base gives a class and no percentage.
- [ ] Ratios use one integer unit defined once in core (decision 1, default ppm). A ratio that does not apply to a company type is `not_applicable`, not a gap. A ratio missing its input is a gap, never zero (R4).
- [ ] P/E and P/B follow decision 2 (default: computed in core on read from stored TTM EPS/BVPS and the latest close; P/E only once the EPS basis is `'ttm'`).
- [ ] If ratios are stored, a migration adds the table with RLS on, service_role only, a rollback file and db-check updates. Each row has `source` (`derived:<lines source>`) and `fetched_at`.
- [ ] Fixture cross-check: derived ROE and gross margin are within a stated tolerance of the vendor `statistics-financial` values for at least 3 symbols.
- [ ] `typecheck`, `lint` and `test` are green.

## Notes / answers from Ming
- Depends on STK-061 (statement lines).
- Decisions with defaults are open as `decision` issues in the workspace repo: ratio unit (ppm), P/E and P/B computed on read, D/E = borrowings ÷ total equity for CT only, ROE/ROA two-point average.
