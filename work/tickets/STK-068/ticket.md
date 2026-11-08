# STK-068: Cash-flow statement lines and free cash flow

| Field | Value |
|---|---|
| State | BLOCKED |
| Priority | P2 |
| Areas | data, finance |
| Attempts | 0 |
| Created | 2026-11-08 |
| PR | — |

## Goal
Add operating cash flow and capex lines from the VCI IQ `CASH_FLOW` section, plus derived free cash flow, to the `financial_lines` table from STK-061. This is slice C of the original STK-061.

## Spec reference
docs/spec-v1.md §3 F4, §5. CLAUDE.md R1, R2, R4. Plan: work/tickets/STK-061/plan.md "Split proposal".

## Acceptance criteria
- [ ] `fetchStatements` maps operating cash flow and capex (source sign kept) per company type. A line that does not apply (for example bank capex) is not applicable, not a gap.
- [ ] Cash flow is stored as discrete quarters. If the source is year-to-date, core converts it (Qn − Qn−1 in the same fiscal year), and a missing earlier quarter makes the later one a gap (decision 5).
- [ ] Free cash flow = CFO − |capex| is derived in core and tested.
- [ ] The fixture comes from the probe samples, with a test that the four quarters sum to the annual row (or the difference is documented).
- [ ] `typecheck`, `lint` and `test` are green.

## Notes / answers from Ming
- **Blocked until Ming runs `scripts/probe-vci-iq-cashflow.sh` (added by STK-061) and commits `work/tickets/STK-061/live-samples/`.**
