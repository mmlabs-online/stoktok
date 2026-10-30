# STK-034: Price and volume chart on the symbol screen

| Field | Value |
|---|---|
| State | DONE |
| Priority | P2 |
| Areas | ui, finance |
| Attempts | 1 |
| Created | 2026-10-26 |
| PR | https://github.com/mmlabs-online/stoktok/pull/22 |

## Goal
`/symbols/[symbol]` shows a close-price line and volume bars with range tabs; missing days are shown as gaps, never interpolated. Split out of STK-016 (slice 2), 2026-10-26.

## Spec reference
docs/spec-v1.md §2.2 gaps, §3 F2. CLAUDE.md R1, R4. STK-016 plan.md "Split proposal" (slice 2), consult-data-visualization-engineer.md, consult-finance-investment-researcher.md.

## Acceptance criteria
- [ ] Price + volume chart with range tabs (`?range=`, server-rendered links); missing days from `data_gaps` are shown as gaps, never interpolated (R4).
- [ ] Own SVG, no new dependency; series/geometry in `packages/core` (one point per trading day, holidays/weekends off-axis) with unit tests; components only map outputs (R1).
- [ ] New db read `listCloseHistory` (date range, close + volume + source + fetched_at) with tests.
- [ ] Accessible: figure summary label and a table fallback; recorded gaps distinguished from unrecorded missing days.

## Notes / answers from Ming
- Depends on: STK-016 (symbol screen). Useful history needs STK-032 (backfill).
