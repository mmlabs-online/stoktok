# STK-054: Vietlott draw results adapter, backfill and ticket checking job

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P3 |
| Areas | data, db |
| Attempts | 0 |
| Created | 2026-11-05 |
| PR | — |

## Goal
A worker adapter fetches Mega 6/45 and Power 6/55 draw results, backfills history, stores them with source and fetched_at, and after each draw checks pending tickets with the STK-052 core.

## Spec reference
docs/spec-v1.md §3 F8 Vietlott tracker; §10 v1.3. CLAUDE.md R1, R2, R5, R4; §9 open question 8. Depends on STK-052, STK-053.

## Acceptance criteria
- [ ] The adapter fetches results from a source whose terms allow personal use (data-engineer confirms the source and records it in the ticket before implementation).
- [ ] Every stored draw carries `source` and `fetched_at`; a parse failure or missing draw is recorded as a gap, never guessed (R4).
- [ ] A backfill command loads all past draws for both games idempotently.
- [ ] A scheduled job runs after each draw day, stores the new draw and updates pending tickets for that draw to `won`/`lost` with prize tier and amounts.
- [ ] Unit tests on recorded sample responses (parse, gap, idempotent re-run, ticket status update); `typecheck`, `lint`, `test` green.

## Notes / answers from Ming
- 2026-11-05: Ming — after v1 (phase v1.3); Mega 6/45 and Power 6/55 only; wins shown in-app only; suggestions avoid jackpot sharing, never claim prediction.
