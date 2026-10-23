# STK-009: Portfolio dashboard and other assets

| Field | Value |
|---|---|
| State | PLANNING |
| Priority | P1 |
| Areas | ui, finance |
| Attempts | 0 |
| Created | 2026-10-22 |
| PR | — |

## Goal
The dashboard shows holdings and P&L derived from the ledger with the latest daily prices, holding weights with a concentration warning, and total net worth including cash and other assets that Ming can manage.

## Spec reference
docs/spec-v1.md §3 F2 Portfolio & assets, §5 `assets`. CLAUDE.md R1, R2, R4, R5.

## Acceptance criteria
- [ ] Holdings table from core: quantity, sellable quantity, average cost, last close, market value, unrealized P&L (VND and %), weight; realized P&L total.
- [ ] Market value, weights and net worth are computed in `packages/core` from ledger + latest `prices_daily` + assets (R1), with unit tests.
- [ ] Holdings whose weight exceeds the configured concentration threshold (R5) show a warning.
- [ ] Cash and other assets: list, add, edit, delete via server actions behind auth (R6); net worth = holdings market value + cash + other assets.
- [ ] Each price shows its date; stale or missing prices are flagged with DataFreshnessBadge and never silently treated as current (R4).
- [ ] Empty state when there are no transactions.

## Notes / answers from Ming
- Depends on: STK-006 (data layer), STK-007 (app shell), STK-005 (daily prices).
- Input needed: none.
