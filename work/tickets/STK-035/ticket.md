# STK-035: Medium-term signals on the symbol screen

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | ui, finance |
| Attempts | 0 |
| Created | 2026-10-26 |
| PR | — |

## Goal
`/symbols/[symbol]` lists the stored medium-term signals with their inputs, hidden with an explanation when data is stale. Split out of STK-016 (slice 3), 2026-10-26.

## Spec reference
docs/spec-v1.md §3 F4, §2.3 disclaimer. CLAUDE.md R4, R9, R10. STK-016 plan.md "Split proposal" (slice 3), consult files in STK-016.

## Acceptance criteria
- [ ] Medium-term signals with their inputs (each cited ref shows source and fetched_at); labels are directions only, never buy/sell.
- [ ] Hidden with an explanation and the last signal date when stale (signal_date before the expected price date, or an open gap overlaps its window) — visibility decided in `packages/core` with unit tests.
- [ ] Suppressed rows show Vietnamese reasons from an exhaustive reason-code label map.
- [ ] New db read `listLatestSignals` with tests; disclaimer notice shown.

## Notes / answers from Ming
- Depends on: STK-015 (signals), STK-016 (symbol screen).
