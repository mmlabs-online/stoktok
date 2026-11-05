# STK-056: Parse pasted Vietlott SMS confirmations into tickets

| Field | Value |
|---|---|
| State | BLOCKED |
| Priority | P3 |
| Areas | data, ui |
| Attempts | 0 |
| Created | 2026-11-05 |
| PR | — |

## Goal
Ming pastes one or more Vietlott SMS confirmation messages and stoktok parses them into tickets for review before saving.

## Spec reference
docs/spec-v1.md §3 F8 Vietlott tracker; §10 v1.3. CLAUDE.md R1, R2, R5; §9 open question 8. Depends on STK-053, STK-055.

## Acceptance criteria
- [ ] A pure parser turns a confirmation message into game, draw number, numbers (incl. bao), cost and purchase time, or a clear error.
- [ ] The paste screen shows parsed tickets for confirmation before saving; duplicates are flagged (STK-053 rule).
- [ ] The raw message is stored with the ticket.
- [ ] Unit tests use real sample messages (personal data removed); `typecheck`, `lint`, `test` green.

## Notes / answers from Ming
- 2026-11-05: Ming — after v1 (phase v1.3); Mega 6/45 and Power 6/55 only; wins shown in-app only; suggestions avoid jackpot sharing, never claim prediction.
- 2026-11-05: **Blocked until Ming provides real Vietlott SMS confirmation samples** (Mega, Power, and a bao ticket if possible), phone number removed.
