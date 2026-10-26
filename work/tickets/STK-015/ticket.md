# STK-015: Medium-term signal rules and job

| Field | Value |
|---|---|
| State | IN_PROGRESS |
| Priority | P2 |
| Areas | finance, db |
| Attempts | 0 |
| Created | 2026-10-22 |
| PR | — |

## Goal
Deterministic medium-term signal rules in `packages/core` run after the EOD sync and store auditable signals, suppressed whenever the input data is stale or has gaps.

## Spec reference
docs/spec-v1.md §3 F4 Signals (medium term), §4.4 Signal computation after EOD, §5 `signals`, §6.1 Separation of concerns. CLAUDE.md R1, R4, R5, R8.

## Acceptance criteria
- [ ] Rules in `packages/core`: P/E and P/B vs sector, earnings growth trend, price vs 50/200-day MA; each a pure function with unit tests including edge cases (missing quarters, negative EPS).
- [ ] Rule parameters are configurable in `settings` (R5). *(Narrowed 2026-10-26: the Settings screen section moved to STK-033.)*
- [ ] No signal is produced when price or financials data is stale or has gaps; the suppression reason is recorded (R4).
- [ ] Migration adds `signals` (symbol, rule_id, horizon, value, inputs_snapshot, data_fresh, created_at); RLS on, server-only access.
- [ ] Worker job runs after the EOD sync, idempotent per symbol and day, and stores the inputs snapshot for audit.
- [ ] "Plan completion vs annual target" is out of scope unless the data source provides it (listed as a follow-up).

## Notes / answers from Ming
- **Price history (Ming, 2026-10-26):** the ~1-year price backfill is a separate ticket (STK-032). Build the MA rules now; they suppress with `insufficient_history` until 200 closes exist.
- **Sector peers (Ming, 2026-10-26):** minimum **5** peers in the same sector for P/E and P/B vs sector; fewer → suppress with `peers_insufficient` (configurable, R5).
- Depends on: STK-005 (daily prices), STK-014 (financials). The settings section builds on STK-010.
- Input needed: none.
