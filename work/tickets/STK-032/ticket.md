# STK-032: Historical daily price backfill

| Field | Value |
|---|---|
| State | PLANNING |
| Priority | P2 |
| Areas | data |
| Attempts | 0 |
| Created | 2026-10-26 |
| PR | — |

## Goal
A one-off backfill fills `prices_daily` with about one year of history for watchlist ∪ held symbols, so the 50/200-day MA signals (STK-015) have enough data. Split out of STK-015 (Ming, 2026-10-26).

## Spec reference
docs/spec-v1.md §4.3, §4.4. CLAUDE.md R2, R4, R5. STK-005 ADR 0001 (TCBS public source), STK-015 consults.

## Acceptance criteria
- [ ] `pnpm worker:eod --backfill <tradingDays>` (default from config, e.g. 260) fetches and upserts history through the existing `PriceSource` and validation path; `--dry-run` works with it.
- [ ] Idempotent: re-running adds no rows; existing rows are overwritten only with the same validation rules as the daily sync.
- [ ] Gentle on the source: requests chunked by date range with the existing delays/retries/circuit breaker; the request count is bounded and logged.
- [ ] Tests use fixtures and the no-network guard only.

## Notes / answers from Ming
- From STK-015 planning: raw-price guards (stock-dividend or out-of-limit jumps inside the MA window) must land with or before this backfill, because the MA rules start producing real signals once history exists.
- Depends on: STK-005. Unblocks the MA rules in STK-015, which stay suppressed with `insufficient_history` until this runs.
