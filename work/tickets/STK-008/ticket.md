# STK-008: Transactions ledger screen

| Field | Value |
|---|---|
| State | REVIEW |
| Priority | P1 |
| Areas | ui, finance |
| Attempts | 3 |
| Created | 2026-10-22 |
| PR | — |

## Goal
Ming can view, add, edit and delete transactions and add corporate actions on the `/transactions` screen, with validation coming from `packages/core`.

## Spec reference
docs/spec-v1.md §3 F1 Transaction ledger (manual entry), §2.1 market rules. CLAUDE.md R1, R2, R5, R6.

## Acceptance criteria
- [ ] Transaction list with filters (symbol, side, date range) and pagination, loaded server-side through the data layer.
- [ ] Add / edit / delete transaction (date, symbol, side, quantity, price, fee, tax) via server actions that call the auth helper (R6).
- [ ] Add corporate action (cash dividend, stock dividend, rights issue) via a server action.
- [ ] Validation in `packages/core`: price > 0; quantity a multiple of the configured lot size unless odd lot is chosen (R5); a sell cannot exceed the sellable quantity computed by core. Errors are shown in Vietnamese on the form.
- [ ] Money and prices are entered and stored as integer VND (R2); no calculation in components (R1).
- [ ] Unit tests for the new core validation; server action tests for reject-on-invalid and reject-without-auth.

## Notes / answers from Ming
- Depends on: STK-006 (data layer), STK-007 (app shell).
- Input needed: none.
