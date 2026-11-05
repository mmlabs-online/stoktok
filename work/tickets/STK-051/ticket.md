# STK-051: Intraday prices, slice 3 — refresh bar, 30 s auto refresh and "Làm mới"

| Field | Value |
|---|---|
| State | REVIEW |
| Priority | P1 |
| Areas | ui |
| Attempts | 1 |
| Created | 2026-11-05 |
| PR | — |

## Goal
While Ming has the dashboard, watchlist or symbol page open and visible during a session, prices refresh every 30 s through the STK-050 server action, and a "Làm mới" button refreshes at once; each page shows when prices were last updated and whether they are delayed.

## Spec reference
docs/spec-v1.md §8 v1.1; §2 "Intraday data may be delayed. Every price carries a `fetched_at` timestamp and a source"; docs/figma-make-prompts.md Prompt 5 (last refresh time, "Giá có thể trễ vài phút"). CLAUDE.md R1, R5. Depends on STK-050. Design notes: work/tickets/STK-049/consult-data-visualization-engineer.md.

## Acceptance criteria
- [ ] A client refresh component calls the STK-050 server action every 30 s (interval from config, R5) only while the page is visible and the session is open, never overlaps calls, then re-renders server data (`router.refresh()`); no price, tone or staleness calculation in the browser (R1).
- [ ] A "Làm mới" button triggers an immediate refresh through the same action and throttle, with a fixed-size pending state.
- [ ] Dashboard, watchlist and symbol pages show "Cập nhật lúc HH:mm:ss" (VN time) and distinct Vietnamese states for delayed/failed, outside session and non-trading day, using icon + text (not colour only); the last stored price is kept when a fetch fails.
- [ ] Accessibility: one polite status region announcing state changes only; 44 px touch target; reduced-motion respected.
- [ ] Component tests with fake timers (interval, pause when hidden, resume, no overlap, button) and state-label tests; `typecheck`, `lint`, `test` green.

## Notes / answers from Ming
- 2026-11-05: split from STK-049 ("user mở app thì reload sau mỗi 30s, và thêm 1 nút cho user refresh ngay").
- **Ming (2026-11-05):** fix security-review findings 1 and 2 before the PR (rework 1): failure backoff 30→60→120 s and stop after 3 consecutive failures until "Làm mới"; clear busy / prevent overlap when the scheduler is recreated mid-call.
