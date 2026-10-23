# STK-030: Cash and other assets management

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | ui, finance |
| Attempts | 0 |
| Created | 2026-10-23 |
| PR | — |

## Goal
Ming can list, add, edit and delete cash and other assets (the `assets` table), so net worth on the dashboard reflects them. Split out of STK-009 (Ming, 2026-10-23).

## Spec reference
docs/spec-v1.md §3 F2 Portfolio & assets, §5 `assets`. CLAUDE.md R1, R2, R6 (suspended). STK-009 plan.md, "Slice 2".

## Acceptance criteria
- [ ] `/assets` lists cash and other assets (name, type, value in VND, as-of date); desktop table and phone cards, following the STK-008 list pattern.
- [ ] Add / edit / delete via full-page forms and server actions (`apps/web/server/assets/handlers.ts`), with a delete confirmation page; non-UUID ids give 404 / NOT_FOUND.
- [ ] Validation in `packages/core` (`validateAssetInput`): name required, type `cash`|`other`, value integer VND ≥ 0, valid as-of date; Vietnamese messages keyed by code (R1, R2).
- [ ] The dashboard links to `/assets`; net worth (STK-009) picks up changes.
- [ ] Unit tests for core validation and handler tests (invalid input → no write; unknown id → NOT_FOUND). Auth tests waived while R6 is suspended.

## Notes / answers from Ming
- Depends on: STK-009 (dashboard), STK-006 (assets repo).
- Asset semantics (from STK-009 plan): each row is one account's current balance; all rows are summed. No subtypes, no liabilities/margin yet.
