# STK-013: Reconcile ledger defaults with a real TCBS statement

| Field | Value |
|---|---|
| State | BLOCKED |
| Priority | P2 |
| Areas | finance |
| Attempts | 0 |
| Created | 2026-10-22 |
| PR | — |

## Goal
Confirm with a real TCBS statement that the STK-002 ledger defaults match how TCBS calculates cost and P&L, and fix the defaults where they differ.

## Spec reference
docs/spec-v1.md §1.4 success criteria (P&L matches TCBS statement), §2.1 market rules, §9 Q2–Q3. CLAUDE.md R2, R5, R8.

## Acceptance criteria
- [ ] Each of the four STK-002 defaults is checked against real statement rows and the result recorded: weighted-average cost including buy fee; cash dividend treatment (`reduceCost` vs income); rounding mode; bonus shares sellable from listing date.
- [ ] Defaults in `settings`/core that differ from TCBS are changed; CLAUDE.md wording updated to match.
- [ ] Regression tests in `packages/core`, built from masked real rows, reproduce the statement's average cost and realized P&L to the VND.
- [ ] Any TCBS rule that core cannot model is listed as a follow-up, not patched ad hoc.

## Notes / answers from Ming
- **Blocked (2026-10-25):** needs the masked TCInvest statement (same as STK-012) and depends on STK-012. Skipped with STK-012 per Ming.
- Depends on: STK-012 (statement import).
- **Input needed (⛔ blocking):** the same masked sample statement as STK-012, plus the TCBS fee rate if tiered (spec §9 Q3).
