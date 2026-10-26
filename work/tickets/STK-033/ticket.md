# STK-033: Signal-rules section on the Settings screen

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | ui, finance |
| Attempts | 0 |
| Created | 2026-10-26 |
| PR | — |

## Goal
Ming can view and edit the medium-term signal rule parameters (`settings.rule_configs.signals.medium`) in a "Quy tắc tín hiệu (trung hạn)" card on `/settings`. Split out of STK-015 (slice B), 2026-10-26.

## Spec reference
docs/spec-v1.md §3 F4, §5 `settings`. CLAUDE.md R1, R5. STK-015 plan.md "Split proposal" (slice B); STK-010 settings patterns.

## Acceptance criteria
- [ ] A settings card shows every medium signal parameter with its default when unset; Vietnamese labels and units.
- [ ] Core validation for the new fields reuses the bounds defined in STK-015; invalid values get Vietnamese errors and nothing is written.
- [ ] Saving merges `rule_configs.signals` without touching `rule_configs.market` (and vice versa), in one save with the existing settings form.
- [ ] The STK-015 job reads the saved values (wiring test).
- [ ] Unit and handler tests; no auth (R6 suspended).

## Notes / answers from Ming
- Depends on: STK-015 (rules, parameter parser, defaults), STK-010 (settings screen).
