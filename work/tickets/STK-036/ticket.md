# STK-036: Raw-price guards for MA signal rules

| Field | Value |
|---|---|
| State | IN_PROGRESS |
| Priority | P2 |
| Areas | finance, data |
| Attempts | 1 |
| Created | 2026-10-30 |
| PR | — |

## Goal
Moving-average signal rules (STK-015) must not produce `ok` signals from raw prices distorted by a corporate action or an out-of-limit price jump inside the MA window. A pure `packages/core` guard flags these windows so the MA rules suppress with a reason.

## Spec reference
docs/spec-v1.md §3 F4 Signals, §2.1 (daily price limits, corporate actions), §5 `corporate_actions`. CLAUDE.md R1, R4, R5, R8. ADR 0001 (raw prices assumed). STK-015 plan Assumption A6.

## Acceptance criteria
- [ ] A pure function in `packages/core` takes a daily close series, the symbol's exchange, the market config price limits and the symbol's `corporate_actions`, and returns `corporate_action_in_window` when a stock dividend or rights issue falls inside the MA window, and `price_jump_beyond_limit` when a day-over-day close move exceeds the exchange's daily limit.
- [ ] Price limits come from market configuration, not literals (R5). When the exchange is null, the widest configured limit is used and the result is flagged.
- [ ] The STK-015 MA rules call the guard and store a suppressed row with the guard's reason instead of an `ok` row. The new reason codes are added to the signal reason list with a defined sort order.
- [ ] Unit tests: corporate action inside the window, a jump of the limit plus one tick, a null exchange, and a legitimate limit-hit day (exactly at the limit) that does not trigger.
- [ ] `typecheck`, `lint` and `test` pass.

## Notes / answers from Ming
- **Must be merged before STK-032 (backfill) is merged or run.** Ming's decision 2026-10-30 (STK-032 plan Q1, option a).
- Source: STK-015 plan A6 follow-up; `work/tickets/STK-032/consult-data-engineer.md` Recommendation 1.
- Open for the planner: §5 lists `record_date` on `corporate_actions`, not an ex-date. Which date defines "inside the window" is for the finance consult / planner to settle.
