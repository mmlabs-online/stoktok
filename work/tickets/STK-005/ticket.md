# STK-005: End-of-day price adapter and sync job

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | data, db |
| Attempts | 0 |
| Created | 2026-10-22 |

## Goal
The worker fetches daily OHLCV for watchlist symbols after market close from a swappable data source and stores it with `source` and `fetched_at`, recording any missing trading days as gaps.

## Spec reference
docs/spec-v1.md §2.2 Data constraints, §4.3 Data source adapters, §4.4 Job schedule (EOD OHLCV sync, gap detection), §5 `prices_daily`, `data_gaps`. CLAUDE.md R4. Depends on STK-003 (tables).

## Acceptance criteria
- [ ] A `PriceSource` interface (daily OHLCV for a symbol and date range) with one concrete implementation; adding a second source requires no change to callers.
- [ ] A worker job syncs daily prices for all watchlist symbols, upserting `prices_daily` idempotently (re-running the same day changes nothing) with `source` and `fetched_at` (R4).
- [ ] Prices are converted to integer VND at the adapter boundary (R2); invalid or missing fields are rejected, not stored.
- [ ] Missing trading days for a symbol are written to `data_gaps`; weekends are not gaps. Exchange holidays use a configurable list (holiday data source is a later ticket).
- [ ] Unit tests use recorded fixtures / mocked HTTP only — no live network in tests.
- [ ] The job can be run once manually via a documented `pnpm` script; scheduling (cron) wiring is minimal and documented.

## Notes / answers from Ming
- **Open (spec §9 Q4):** which primary source to use after a license/terms check for personal use. Planner: propose the source with the license finding; if no source is clearly usable, return BLOCKED.
