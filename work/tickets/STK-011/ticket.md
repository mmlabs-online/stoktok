# STK-011: Watchlist screen

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | ui, data |
| Attempts | 0 |
| Created | 2026-10-22 |

## Goal
The `/watchlist` screen shows a Holdings group (automatic from the portfolio) and a Watching group (manual) as a price board with Vietnamese price colors and data freshness.

## Spec reference
docs/spec-v1.md §3 F3 Watchlist, §2.1 price limits, §5 `watchlist`. CLAUDE.md R1, R4, R5, price colors.

## Acceptance criteria
- [ ] Holdings group is derived from current holdings (not stored); Watching group supports add/remove symbol via server actions behind auth (R6).
- [ ] Price board per symbol: last close, change and %, volume, and reference/ceiling/floor computed in core from configured exchange limits (R5).
- [ ] Colors: up green, down red, reference yellow, ceiling purple, floor cyan.
- [ ] Last update time and DataFreshnessBadge per symbol; stale or gapped symbols are visibly flagged (R4).
- [ ] Adding a symbol makes it part of the EOD price sync set.
- [ ] Unit tests for the core reference/ceiling/floor helper.

## Notes / answers from Ming
- Depends on: STK-005 (daily prices), STK-006 (data layer), STK-007 (app shell).
- Input needed: none.
