# STK-005: End-of-day price adapter and sync job

| Field | Value |
|---|---|
| State | IN_PROGRESS |
| Priority | P2 |
| Areas | data, db |
| Attempts | 0 |
| Created | 2026-10-22 |
| PR | — |

## Goal
The worker fetches daily OHLCV for watchlist symbols after market close from a swappable data source and stores it with `source` and `fetched_at`, recording any missing trading days as gaps.

## Spec reference
docs/spec-v1.md §2.2 Data constraints, §4.3 Data source adapters, §4.4 Job schedule (EOD OHLCV sync, gap detection), §5 `prices_daily`, `data_gaps`. CLAUDE.md R4. Depends on STK-003 (tables).

## Acceptance criteria
- [ ] A `PriceSource` interface (daily OHLCV for a symbol and date range) with one concrete implementation; adding a second source requires no change to callers.
- [ ] A worker job syncs daily prices for all watchlist symbols, upserting `prices_daily` idempotently (re-running the same day changes nothing) with `source` and `fetched_at` (R4).
- [ ] Prices are converted to integer VND at the adapter boundary (R2); invalid or missing fields are rejected, not stored.
- [ ] ~~Missing trading days written to `data_gaps`~~ — *moved to STK-031 (split 2026-10-24, same as the STK-009 split Ming approved).*
- [ ] Unit tests use recorded fixtures / mocked HTTP only — no live network in tests.
- [ ] The job can be run once manually via a documented `pnpm` script; scheduling (cron) wiring is minimal and documented.

## Notes / answers from Ming
- **Answer to §9 Q4 (Ming, 2026-10-24):** use the **TCBS public API** (the unofficial endpoint TCBS's own web uses, no registration) as the primary source. Ming accepts the risk that it is unlicensed for automated use and may change or block without notice. Keep request volume low (tens/day), use a descriptive User-Agent, no header spoofing. Keep the `PriceSource` interface so SSI FastConnect / VNDirect can be swapped in later. Record this in an ADR.
- **Symbol scope (Ming, 2026-10-24):** sync **watchlist ∪ currently held symbols**, not just the watchlist.
- The sandbox cannot reach Vietnamese hosts, so live fixtures can't be captured here: fixtures may be synthetic from the documented/recalled shape, clearly labelled "synthetic, verify against live", and units (VND vs thousand VND) must be guarded by tests and a plausibility check.
- **Open (spec §9 Q4):** which primary source to use after a license/terms check for personal use. Planner: propose the source with the license finding; if no source is clearly usable, return BLOCKED.
