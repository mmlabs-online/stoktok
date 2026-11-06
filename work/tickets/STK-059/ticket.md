# STK-059: Vietlott opportunity cost vs VN-Index

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P3 |
| Areas | finance, ui |
| Attempts | 0 |
| Created | 2026-11-05 |
| PR | — |

## Goal
On the Vietlott history, show what the money spent on tickets would be worth today if it had gone into VN-Index on each purchase date.

## Spec reference
docs/spec-v1.md §3 F8 Vietlott tracker; §10 v1.3. CLAUDE.md R1, R2, R5. Depends on STK-055 and stored VN-Index daily prices.

## Acceptance criteria
- [ ] Core computes, per ticket, units of VN-Index bought at the purchase-date close and their current value; prize money is not reinvested.
- [ ] Purchase dates without a VN-Index close use the previous trading day; missing index data is shown as a gap, not estimated (R4).
- [ ] The history screen shows total spent, current value if invested, and the difference.
- [ ] Unit tests (holiday purchase date, missing data); `typecheck`, `lint`, `test` green.

## Notes / answers from Ming
- 2026-11-05: Ming — after v1 (phase v1.3); Mega 6/45 and Power 6/55 only; wins shown in-app only; suggestions avoid jackpot sharing, never claim prediction.
