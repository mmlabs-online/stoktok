# STK-078: Portfolio AI summary (STK-064 slice c)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | data, finance |
| Attempts | 0 |
| Created | 2026-11-10 |
| PR | — |

## Goal
Generate one daily portfolio summary from core-computed holdings figures and the stored per-symbol summaries for the session date, with citations to those inputs. Split from STK-064 (see work/tickets/STK-064/plan.md "Split proposal"; consults in work/tickets/STK-064/).

## Spec reference
docs/spec-v1.md §3 F5, §6.2, §7. CLAUDE.md R1, R4, R5, R9. Depends on STK-064 and STK-077.

## Acceptance criteria
- [ ] Inputs are core-computed holding figures (`hold:` ids) and stored symbol summaries (`sum:` ids); missing symbol summaries become `missing:` markers and the body notes incomplete coverage.
- [ ] Runs after the symbol summaries in the same job, only when at least one symbol summary exists for D; same budget/provider stop rules and validation as STK-077.
- [ ] Stored as the `scope='portfolio'` row for D (idempotent).
- [ ] `typecheck`, `lint`, `test` green with a fake provider.

## Notes / answers from Ming
- 2026-11-10 (orchestrator): split from STK-064 per its plan.md; defaults for Ming are listed there under Assumptions.
