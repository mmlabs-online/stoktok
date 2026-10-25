# STK-031: Daily price gap detection

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | data, db |
| Attempts | 0 |
| Created | 2026-10-24 |
| PR | — |

## Goal
After the EOD price sync, missing trading days per symbol are recorded in `data_gaps` and resolved when the data later arrives, so stale or gapped data is visible and never feeds a signal (R4). Split out of STK-005 (slice 2), 2026-10-24.

## Spec reference
docs/spec-v1.md §2.2 Data constraints, §4.4 Job schedule (gap detection), §5 `data_gaps`. CLAUDE.md R4, R5. STK-005 plan.md "Split proposal"; consult notes in work/tickets/STK-005/.

## Acceptance criteria
- [ ] Missing trading days for a symbol are written to `data_gaps` (data_type `prices_daily`); weekends and configured holidays (`settings.holidays`) are not gaps.
- [ ] Re-running the job does not duplicate open gaps (app-side dedupe; timestamptz keys compared by instant, not string).
- [ ] Gaps are marked `resolved_at` when the missing data is later stored; gaps are never deleted.
- [ ] The expected range never starts before a symbol's first stored/known date or the configured lookback, so new listings and newly watched symbols don't produce false gaps.
- [ ] Core trading-day range helpers and gap planning have unit tests; repos have fake-client tests; no live network in tests.

## Notes / answers from Ming
- Depends on: STK-005 (EOD sync job).
- No migration planned; a partial unique index on open gaps and a single-run lock are follow-ups.
