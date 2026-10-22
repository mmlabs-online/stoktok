# STK-012: Statement CSV import and reconciliation

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | data, finance, ui |
| Attempts | 0 |
| Created | 2026-10-22 |

## Goal
Ming can import a TCInvest statement CSV, preview which rows are new, duplicate or invalid, import the new ones as transactions, and see per-symbol quantity differences between the app and the statement.

## Spec reference
docs/spec-v1.md §3 F1 (CSV import, reconciliation view), §1.4 success criteria, §9 Q2. CLAUDE.md R1, R2, R6.

## Acceptance criteria
- [ ] A parser (core or server module, no UI logic) turns a TCInvest statement CSV into transactions with integer VND (R2); unknown columns or bad rows become row-level errors, not crashes.
- [ ] Preview on `/import` marks each row `new` / `duplicate` / `error`, with a documented duplicate rule.
- [ ] Confirming imports only `new` rows as transactions with `source = import` and a shared `import_batch_id`, via a server action behind auth (R6); re-importing the same file adds nothing.
- [ ] Reconciliation view lists per symbol: app quantity vs statement quantity and the difference, highlighting mismatches; comparison logic lives in core (R1).
- [ ] Unit tests use a masked fixture based on the real statement.

## Notes / answers from Ming
- Depends on: STK-006 (data layer), STK-008 (ledger screen).
- **Input needed (⛔ blocking):** a real TCInvest statement export with the account number masked (spec §9 Q2). Planner: return BLOCKED without it.
