# STK-046: Seed the Vietnamese exchange holiday calendar and resolve false price gaps

| Field | Value |
|---|---|
| State | IN_PROGRESS |
| Priority | P1 |
| Areas | data, finance, db |
| Attempts | 0 |
| Created | 2026-11-05 |
| PR | — |

## Goal
Market non-trading days (Tết, Hùng Kings, 30/4–1/5, 2/9 and announced bridge days) are known to the app, so the EOD job, gap detection, signals, the chart and the STK-032 backfill stop treating them as missing trading days; false gaps already recorded on those dates are resolved.

## Spec reference
docs/spec-v1.md §2.1 (Vietnamese market rules), §2.2 (data gaps), §4.4 (job schedule on trading days), §5 `settings`. CLAUDE.md R4, R5. STK-031 (gap detection), STK-032 (backfill).

## Acceptance criteria
- [ ] HOSE/HNX/UPCoM non-trading weekdays for 2025, 2026 and 2027 are seeded as configuration (R5), each with a cited source (exchange or State Securities Commission announcement); a year whose official schedule is not yet published is marked provisional.
- [ ] When `settings.holidays` is empty or unset, the app uses the seeded calendar; dates Ming has stored are kept, not overwritten.
- [ ] Open price gaps whose missing days all fall on seeded holidays are resolved, not deleted, with a recorded reason; a gap that also covers a real trading day is left open (R4).
- [ ] Unit tests cover the calendar (ISO dates, weekdays only, no duplicates, sorted), the fallback rule, and the gap-resolution rule; `typecheck`, `lint`, `test` pass.

## Notes / answers from Ming
- 2026-11-05: Ming chose the holiday calendar as the next work, split into two tickets: this one (seed + gap cleanup) first, STK-047 (Settings editor) after.
- Today `settings.holidays` defaults to `[]` (`packages/core/src/ledger/settings.ts`).
