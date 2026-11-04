# STK-047: Holiday calendar editor on the Settings screen

| Field | Value |
|---|---|
| State | DONE |
| Priority | P2 |
| Areas | ui |
| Attempts | 1 |
| Created | 2026-11-05 |
| PR | https://github.com/mmlabs-online/stoktok/pull/34 |

## Goal
Ming can see and edit the market holiday calendar on `/settings`, so new or changed exchange holidays can be added without a code change.

## Spec reference
docs/spec-v1.md §2.1, §5 `settings`. CLAUDE.md R1, R5. STK-010 (Settings screen), STK-046 (seeded calendar).

## Acceptance criteria
- [ ] A Settings card lists the effective holidays (seeded or stored) by year, shows which are provisional, and lets Ming add or remove dates.
- [ ] Validation lives in `packages/core`: ISO dates, weekdays only, no duplicates; invalid input gets Vietnamese errors and nothing is written.
- [ ] Saving writes `settings.holidays` in the same save as the existing settings form without touching other settings.
- [ ] Unit and handler tests; no auth (R6 suspended).

## Notes / answers from Ming
- 2026-11-05: split from STK-046 at Ming's choice; depends on STK-046.
