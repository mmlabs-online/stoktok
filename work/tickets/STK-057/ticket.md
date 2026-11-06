# STK-057: Vietlott number suggestions that avoid popular combinations

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P3 |
| Areas | finance, ui |
| Attempts | 0 |
| Created | 2026-11-05 |
| PR | — |

## Goal
Generate random Mega/Power picks that avoid popular patterns, to lower the chance of sharing a jackpot, with optional numbers fixed by Ming.

## Spec reference
docs/spec-v1.md §3 F8 Vietlott tracker; §10 v1.3. CLAUDE.md R1, R2, R5. Depends on STK-052, STK-054.

## Acceptance criteria
- [ ] Core generator picks uniformly at random from combinations that pass configurable filters: not all numbers ≤ 31, no run of 4+ consecutive numbers, not an arithmetic sequence, not a previously drawn set (R1, R5).
- [ ] Ming can fix up to 5 numbers; the rest are generated under the same filters.
- [ ] The screen states plainly that suggestions do not increase the chance of winning; they only reduce the chance of sharing a jackpot.
- [ ] A suggestion can be saved as a planned ticket to enter after buying.
- [ ] Unit tests: filters reject known patterns, fixed numbers always included, output stays in range with no duplicates; `typecheck`, `lint`, `test` green.

## Notes / answers from Ming
- 2026-11-05: Ming — after v1 (phase v1.3); Mega 6/45 and Power 6/55 only; wins shown in-app only; suggestions avoid jackpot sharing, never claim prediction.
