# STK-010: Settings screen

| Field | Value |
|---|---|
| State | PLANNING |
| Priority | P2 |
| Areas | ui |
| Attempts | 0 |
| Created | 2026-10-22 |
| PR | — |

## Goal
Ming can view and change the market-rule and portfolio settings on `/settings`; the values are stored in `settings` and used by `packages/core`.

## Spec reference
docs/spec-v1.md §2.1 market rules (configuration), §3 F2 concentration threshold, §5 `settings`. CLAUDE.md R5, R6.

## Acceptance criteria
- [ ] Form for: brokerage fee rate, sell tax rate, price limits per exchange (HOSE/HNX/UPCoM), settlement days, lot size, concentration threshold, cash dividend treatment.
- [ ] Saved via a server action behind auth (R6) into `settings`, in the units core uses (e.g. ppm); invalid values (negative, out of range) are rejected by core validation with Vietnamese error messages.
- [ ] Defaults shown match the CLAUDE.md market-rule table when no row exists.
- [ ] Core reads these values everywhere they apply; no hard-coded rule values remain in web or worker (R5), verified by a check or test.
- [ ] Signal rule parameters are not in this ticket (added by the signals ticket).

## Notes / answers from Ming
- Depends on: STK-006 (data layer), STK-007 (app shell).
- Input needed: none. Ming enters the actual TCBS fee rate (spec §9 Q3) through this screen.
