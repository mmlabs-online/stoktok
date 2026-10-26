# STK-016: Symbol detail screen

| Field | Value |
|---|---|
| State | PLANNING |
| Priority | P2 |
| Areas | ui, finance |
| Attempts | 0 |
| Created | 2026-10-22 |

## Goal
`/symbols/[symbol]` shows everything about one symbol: price with reference/ceiling/floor, a chart with gaps, Ming's position and lots, medium-term signals, and the symbol's transactions.

## Spec reference
docs/spec-v1.md §3 F2 (lots, T+2 status), §3 F4 (signals), §2.2 gaps. CLAUDE.md R1, R4, R6, price colors.

## Acceptance criteria
- [ ] Header: last price, change, reference/ceiling/floor with VN colors and freshness badge.
- [ ] Price + volume chart with range tabs; missing days from `data_gaps` are shown as gaps, never interpolated (R4).
- [ ] Position card (quantity, sellable quantity, average cost, unrealized P&L) and lots table with `pending`/`sellable` status and sellable date; all values from core (R1).
- [ ] Medium-term signals with their inputs; hidden with an explanation when data is stale.
- [ ] Transactions for this symbol, linking to the ledger screen.
- [ ] Unknown symbol → not-found page; data loaded server-side behind auth (R6).

## Notes / answers from Ming
- Depends on: STK-009 (dashboard), STK-015 (signals).
- Input needed: none.
