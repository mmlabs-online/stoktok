# STK-052: Vietlott core: game rules, ticket checking and net result

| Field | Value |
|---|---|
| State | REWORK |
| Priority | P3 |
| Areas | finance |
| Attempts | 1 |
| Created | 2026-11-05 |
| PR | — |

## Goal
Add a `lottery` module to `packages/core` that models Mega 6/45 and Power 6/55 as configuration and computes, for a ticket and a draw result, the prize tier, gross prize, prize tax and net result.

## Spec reference
docs/spec-v1.md §3 F8 Vietlott tracker; §10 v1.3. CLAUDE.md R1, R2, R5.

## Acceptance criteria
- [ ] Game rules (number range, pick count, bonus number for Power, prize table, ticket price, draw weekdays, tax threshold and rate) are config objects, not hard-coded logic (R5).
- [ ] A pure function checks a ticket against a draw result and returns the prize tier (Power: Jackpot 1, Jackpot 2 = 5 + bonus, 1st–3rd; Mega: Jackpot, 1st–3rd) or none.
- [ ] System ("bao") tickets are expanded to their combinations; cost and every winning combination are counted correctly.
- [ ] Prize tax is 10% of the part of the prizes on one ticket in one draw (summed) above a dated threshold: 10,000,000 VND for draws before 2026-07-01, 20,000,000 VND from 2026-07-01 (Law 109/2025/QH15); per-combination basis stays available in config; all amounts are integer VND (R2). Jackpot amount comes from the draw result, not config.
- [ ] A function totals spent, won (gross and net) and net result for a list of tickets, per game.
- [ ] Unit tests cover every tier for both games, bao 7 expansion, tax boundary (20,000,000 and 20,000,001 from 2026-07-01; 10,000,000 and 10,000,001 before), per-ticket tax aggregation on a bao ticket, invalid tickets rejected; `typecheck`, `lint`, `test` green.

## Notes / answers from Ming
- 2026-11-05: Ming — after v1 (phase v1.3); Mega 6/45 and Power 6/55 only; wins shown in-app only; suggestions avoid jackpot sharing, never claim prediction.
- Defaults to verify before use: ticket 10,000 VND; Mega 1st 10,000,000 / 2nd 300,000 / 3rd 30,000; Power 1st 40,000,000 / 2nd 500,000 / 3rd 50,000; Mega draws Wed/Fri/Sun, Power Tue/Thu/Sat.
- 2026-11-05 (plan Q1/Q2): Ming — tax threshold is a dated schedule (10M before 2026-07-01, 20M from 2026-07-01); default tax basis is **per ticket per draw** (prizes summed, taxed once). AC4/AC6 updated accordingly.
