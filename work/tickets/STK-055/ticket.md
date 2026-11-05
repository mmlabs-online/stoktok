# STK-055: Vietlott tickets screen: manual entry, history and in-app wins

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P3 |
| Areas | ui, finance |
| Attempts | 0 |
| Created | 2026-11-05 |
| PR | — |

## Goal
A "Vietlott" screen where Ming quickly adds a ticket by hand (MoMo purchases), sees ticket history per game, totals, and an in-app notice for new wins.

## Spec reference
docs/spec-v1.md §3 F8 Vietlott tracker; §10 v1.3. CLAUDE.md R1, R2, R5. Depends on STK-052, STK-053.

## Acceptance criteria
- [ ] Manual entry form: game, draw (defaults to the next draw), numbers or system size, channel; validation errors come from core rules (R1).
- [ ] History lists tickets per game (Mega / Power tabs) with status and prize; totals show spent, won (net of tax) and net result from core.
- [ ] A new win shows an in-app notice (badge in the app shell and a highlighted row) until Ming opens it; no push notifications.
- [ ] UI labels are Vietnamese; amounts formatted from integer VND.
- [ ] `typecheck`, `lint`, `test` green.

## Notes / answers from Ming
- 2026-11-05: Ming — after v1 (phase v1.3); Mega 6/45 and Power 6/55 only; wins shown in-app only; suggestions avoid jackpot sharing, never claim prediction.
