# STK-053: Vietlott schema and server data layer

| Field | Value |
|---|---|
| State | PLANNING |
| Priority | P3 |
| Areas | db, security |
| Attempts | 0 |
| Created | 2026-11-05 |
| PR | — |

## Goal
Add Supabase tables for Vietlott draws and tickets with RLS, and server-only data functions to create, list and update tickets.

## Spec reference
docs/spec-v1.md §3 F8 Vietlott tracker; §10 v1.3. CLAUDE.md R1, R2, R5, R3, R4, R6.

## Acceptance criteria
- [ ] Migration adds `lottery_draws` (game, draw number, draw date, numbers, bonus, jackpot amounts, `source`, `fetched_at`) and `lottery_tickets` (game, draw number, numbers, system size, cost, channel `sms`/`momo`/`manual`, purchased_at, status, prize tier, prize amounts, raw input text).
- [ ] RLS is on for both tables, matching existing tables; the browser never reads them directly (R3).
- [ ] Unique keys: one draw row per (game, draw number); duplicate SMS imports are detected (same raw text or same game + draw + numbers + purchased_at).
- [ ] Server data functions call `requireUser()` (R6) and are covered by tests in the same style as existing data-layer tests.
- [ ] `typecheck`, `lint`, `test` green.

## Notes / answers from Ming
- 2026-11-05: Ming — after v1 (phase v1.3); Mega 6/45 and Power 6/55 only; wins shown in-app only; suggestions avoid jackpot sharing, never claim prediction.
