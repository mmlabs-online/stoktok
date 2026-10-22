# STK-002: Core ledger — transactions → lots → holdings with P&L

| Field | Value |
|---|---|
| State | REVIEW |
| Priority | P1 |
| Areas | finance, db |
| Attempts | 0 |
| Created | 2026-10-22 |

## Goal
Pure domain logic in `packages/core` that turns a list of transactions and corporate actions into lots, holdings and P&L — the foundation every screen depends on. No DB, no UI.

## Spec reference
docs/spec-v1.md §2.1 market rules, §3 F1 Transaction ledger, §3 F2 Portfolio & assets, §5 Data model (`transactions`, `corporate_actions`, `lots`).

## Acceptance criteria
- [ ] Given transactions (buy/sell with quantity, price, fee, tax) and settings (fee rate, sell tax, settlement days), core returns lots with `sellableFrom` and status `pending`/`sellable` as of a given date.
- [ ] Holdings per symbol: quantity, sellable quantity, average cost, realized P&L; unrealized P&L given a price map.
- [ ] Sells consume lots by a documented method (method stated in the plan; flag to Ming if unsure which matches TCBS).
- [ ] Cash dividend and stock dividend adjust holdings/cost basis as documented in the plan.
- [ ] A sell exceeding sellable quantity is rejected with a typed error.
- [ ] All money and prices are integer VND (R2); rounding rule defined once.
- [ ] Unit tests cover: single buy/sell, multiple lots with partial sell, T+2 pending lot, cash dividend, stock dividend, oversell error.

## Notes / answers from Ming
