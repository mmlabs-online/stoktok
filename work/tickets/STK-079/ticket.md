# STK-079: AI summary cards on Tài sản and the symbol screen (STK-064 slice d)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | ui, security |
| Attempts | 0 |
| Created | 2026-11-10 |
| PR | — |

## Goal
Show the stored AI summaries on the Tài sản screen (portfolio) and the symbol screen with clickable, safe citations, staleness and empty states, and the disclaimer. Split from STK-064 (see work/tickets/STK-064/plan.md "Split proposal"; consults in work/tickets/STK-064/).

## Spec reference
docs/spec-v1.md §3 F5, §6.2, §7. CLAUDE.md R1, R4, R5, R9. Depends on STK-064 and STK-077.

## Acceptance criteria
- [ ] A summary card on Tài sản (after the portfolio summary) and on the symbol screen (after the chart); a slow or failing read never breaks the page.
- [ ] Sentences render as plain text (never HTML from the model); citations resolve server-side from stored IDs to in-app links or the stored `news.url` (https only, `rel=noopener noreferrer`); unresolvable IDs render as a non-link chip.
- [ ] Staleness (older than the latest expected session), no-summary, AI-off and budget states are computed in core/server (R1) and shown with text + icon; the "chỉ mang tính tham khảo" disclaimer is always shown.
- [ ] `typecheck`, `lint`, `test` green; tests cover escaping, link attributes, the URL allow-list and each state.

## Notes / answers from Ming
- 2026-11-10 (orchestrator): split from STK-064 per its plan.md; defaults for Ming are listed there under Assumptions.
