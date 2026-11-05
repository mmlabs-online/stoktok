# STK-058: Vietlott statistics and historical strategy check

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P3 |
| Areas | finance, ui |
| Attempts | 0 |
| Created | 2026-11-05 |
| PR | — |

## Goal
Show number statistics per game and a historical check comparing "hot numbers", "overdue numbers" and "random" strategies, displayed as-is.

## Spec reference
docs/spec-v1.md §3 F8 Vietlott tracker; §10 v1.3. CLAUDE.md R1, R2, R5. Depends on STK-054.

## Acceptance criteria
- [ ] Core computes per number: frequency, draws since last seen; and the most common pairs, over a chosen window.
- [ ] Core runs the strategy check over stored history: each strategy buys one ticket per draw; results (matches per tier, spent, won) are compared with each other and with the theoretical expectation.
- [ ] The screen shows the stats and the check result without claiming predictive power.
- [ ] Unit tests on a small fixed draw history with known answers; `typecheck`, `lint`, `test` green.

## Notes / answers from Ming
- 2026-11-05: Ming — after v1 (phase v1.3); Mega 6/45 and Power 6/55 only; wins shown in-app only; suggestions avoid jackpot sharing, never claim prediction.
