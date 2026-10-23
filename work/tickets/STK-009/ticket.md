# STK-009: Portfolio dashboard and other assets

| Field | Value |
|---|---|
| State | REVIEW |
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
- [ ] Net worth = holdings market value + cash + other assets, reading existing `assets` rows. *(Narrowed by Ming 2026-10-23: assets list/add/edit/delete moved to STK-030.)*
- [ ] Each price shows its date; stale or missing prices are flagged with DataFreshnessBadge and never silently treated as current (R4).
- [ ] Empty state when there are no transactions.

## Notes / answers from Ming
- **Split (Ming, 2026-10-23):** this ticket is the dashboard (plan Slice 1). Assets CRUD is STK-030.
- Depends on: STK-006 (data layer), STK-007 (app shell), STK-005 (daily prices).
- Input needed: none.
