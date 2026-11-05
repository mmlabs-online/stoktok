STK-049 UI consult (data-visualization-engineer, read-only)

## Findings
- Three price surfaces share components. The watchlist (`apps/web/components/watchlist/price-board.tsx`) and the symbol header (`apps/web/components/symbol/symbol-header.tsx`) both use `Close`, `LimitValue`, `Status` and `PriceChange`. The dashboard (`apps/web/components/portfolio/holdings-table.tsx`) has its own `Price` and `Pnl`. All are server-rendered; the pages are `force-dynamic`.
- Each row already carries `fetchedAt`, `source`, `tradeDate`, `priceDateDiffers`, `status` (fresh/stale/missing), `tone`, `change`, `changePctPpm`, `ref`, `ceiling` and `floor`. These are computed in `packages/core` via `buildPriceBoardRow`, called from `load-watchlist.ts`. The UI only formats, so R1 holds today.
- `Status` prints "Cập nhật {formatDateTime(fetchedAt)} · source" on every row. That is date plus time, in small muted text, at the end of a right-aligned stack whose height varies (warnings, "giá dd/mm"). A refresh that changes this stack would resize rows.
- `DataFreshnessBadge` is static ("Dữ liệu cũ" with a warn icon, plus text, so it is not colour-only). It means EOD staleness (`expectedPriceDate`), not "intraday fetch failed". STK-049 needs a separate notion.
- `docs/figma-make-prompts.md` (Prompt 5, watchlist) already asks for "last refresh time" top-right and the note "Giá có thể trễ vài phút". That is the placement precedent, and it matches spec §1.3 (no guaranteed real-time data).
- `holdings-table.tsx` shows `marketPrice` with "giá dd/mm" and the badge. It has no change-vs-reference column. That is fine; do not add one (see below).
- `TONE_STYLES` already pairs each colour with a glyph, a tag and an sr-only label, so the colours are not carried by hue alone. A price update must keep this.

## Recommendations

### 1. One shared client island, not per-page logic (AC4)
- Create `components/price-refresh.tsx` ("use client"). Its props are `lastFetchedAt: string | null`, `intervalMs` and `sessionState` (all from the server), plus the button.
- It does three things: runs an interval, runs the button, and calls `router.refresh()` inside `startTransition`.
- A server action or route handler does the throttled fetch-and-store, which keeps R3 and R6 (`requireUser()` first). Then `router.refresh()` re-renders the server components with the new rows. This is the simplest option. It keeps all formatting and tone logic server-side and adds no client-side price state, so there is no calculation in the UI (R1).
- Avoid client-side JSON polling that rebuilds rows in the browser. That would duplicate `buildPriceBoardRow`.
- Pause the timer when `document.visibilityState !== 'visible'`.
  - On `visibilitychange` back to visible, refresh at once if the data is older than 30 s, then restart the interval.
  - Use a single interval (`setTimeout` chain) and never overlap requests: skip a tick while a refresh is `isPending`.
  - Back off after consecutive failures (30 s, then 60 s, then 120 s), and reset the backoff on success or when the user presses "Làm mới".
- Also pause when `navigator.onLine` is false, and show "Mất kết nối".
- Do not poll when `sessionState` is not `open`. The server already makes no source call then (AC3), so skip the timer entirely. The button stays enabled but labelled for the closed state (see section 3).

### 2. Placement
Use a single `<PriceRefreshBar>` (button and timestamp together) at the top right of the page header, in the same row as the `h1`. On mobile it wraps below the `h1`, full width, left-aligned.
- Dashboard (`app/(app)/page.tsx`): beside "Tổng quan". Dashboard prices feed P&L and totals, so one timestamp for the whole page is the right level. Omit it when there are no holdings (empty states).
- Watchlist: top right, per Prompt 5. Include the note "Giá có thể trễ vài phút" as the small muted second line of the bar, or as the button's `title`/`aria-describedby`.
- Symbol page: inside `SymbolHeader`, in the title row where "Phiên dd/mm/yyyy" sits (`justify-between`). Put the bar at the right and move the session date into the price row or keep it left.
- Keep the per-row "Cập nhật" on the watchlist, but change it to time only for today's data: "HH:mm:ss". Show the full date only when it is not today, which the server decides (see R1 below).
- The page-level bar shows the oldest `fetched_at` across visible rows, or "N mã chưa cập nhật" if some failed. Do not show the newest time while some rows are old, because that would hide staleness.

### 3. Labels and states (Vietnamese)
Define a small state set. Core or the loader computes it; the UI maps it to text.

| State | Text | Style |
|---|---|---|
| live (in session, fetched within about 2 intervals) | "Cập nhật lúc 10:15:42" | muted text; small dot optional |
| refreshing | button label unchanged, `aria-busy`, spinner inside the fixed-size button | no layout change |
| delayed (source delayed, or the last fetch is older than the threshold) | "Giá có thể trễ vài phút · cập nhật lúc 10:15:42" | warn colour plus icon |
| fetch failed | "Không làm mới được · giá cũ lúc 10:15:42" plus a retry via the button | warn colour plus AlertTriangle |
| outside session | "Ngoài phiên giao dịch · giá đóng cửa phiên dd/mm" | muted; no polling |
| holiday or weekend | "Hôm nay không giao dịch" | muted |
| offline | "Mất kết nối" | warn colour plus icon |
| no intraday yet | falls back to the EOD wording "giá dd/mm/yyyy" | muted |

- Always use icon, text and colour together, never colour alone (CVD). Reuse the `AlertTriangle` plus `text-warn` pattern.
- Never replace a price with "—" because a fetch failed. Keep the last stored price, mark it stale, and show its time (AC4).
- Reuse `DataFreshnessBadge` and extend it with a `reason` variant (or a sibling `IntradayStatus` component). Do not overload "Dữ liệu cũ", which currently means an EOD gap and may be tied to hiding signals. A failed 30 s poll must not trigger "Tín hiệu tạm ẩn" on its own. That belongs to the signals logic (R4) and should be explicit in the plan.
- Format the time as `HH:mm:ss` in Asia/Ho_Chi_Minh through the shared `@stoktok/core` formatter. The server should render the string, or the client should pass the same timezone. Using the browser locale risks a hydration mismatch and a wrong zone. Prefer a server-rendered string, and update it via `router.refresh()` so there is no ticking clock in the client.

### 4. Intraday versus EOD
- A row shows one price, with a small source tag only when it differs from the EOD close.
  - During a session: the intraday price, with change versus reference. The reference is the previous close, taken from the existing `ref`. `Close` and `PriceChange` stay as they are.
  - After the session or when closed: the EOD close. Add the label "Giá đóng cửa dd/mm" using the existing `priceDateDiffers` rule.
- Add a discreet marker next to the price, as text and not colour: "Tạm thời" or "Trong phiên" while intraday, replaced by "Đóng cửa" at EOD. The reader then knows whether today's number is final. A screen-reader label is needed too.
- The EOD job later overwrites or supersedes intraday for the same date. The plan must define the precedence (EOD wins once it exists) in core, not in a component.
- Change versus reference: keep `+/-` and `%` computed by core against `ref`, with the existing glyph, colour and tag (ceiling "Trần" purple, floor "Sàn" cyan, reference yellow). Make sure the intraday price goes through `buildPriceBoardRow` with the same `ref`, so tone and ceiling/floor flags stay consistent. Do not compute the tone in the refresh component.
- On the dashboard, keep "Giá", "Giá trị" and "Lãi/lỗ" as they are. Intraday moves only the numbers. Add no new columns, and add a "(tạm tính)" note in the page bar rather than per cell.
- Volume (KL) during a session is cumulative. Label it "KL" as today and keep it in the same cell.

### 5. No layout jumps or flashing
- Reserve fixed space. Numbers already use `.num`, so confirm it is `tabular-nums` and right-aligned. If not, add `font-variant-numeric: tabular-nums`. Set `min-width` on the price cells so "9,99" to "10,00" or 3 to 4 digits does not reflow.
- The `Status` stack is the main jump risk. Give the timestamp line a fixed line height and render the warning lines in a reserved block, or move the transient states (failed, delayed) to the page bar and keep the row stack stable. Prefer the page bar for transient states.
- `router.refresh()` keeps client state and scroll position, which is good. Do not unmount the table or show a skeleton on refresh. Keep the old content, with `aria-busy` on the region.
- No flash on change. If a change highlight is wanted, use a subtle background fade (about 600 ms, opacity only) only on the cell whose value changed, and drop it entirely under `prefers-reduced-motion: reduce`. A highlight needs a previous value; since row state must not be recomputed in the UI, I recommend skipping highlight in v1 (or having the server send a `changed` flag). Never change tone colour as a blink.
- The button has a fixed width, with the spinner inside (no text swap to a wider string). Use `useTransition` pending, and disable the button for a short while after a press. This matches the server throttle (about 30 s), so show "Vừa cập nhật" or a disabled state with the remaining time rather than letting repeated presses return silently stale data. Do not hide the button while pending.
- Do not reset focus. The button keeps focus after a refresh.

### 6. Accessibility
- Do not announce price changes. Updating every 30 s with `aria-live` on rows would flood screen readers.
- One polite status region only: `<p role="status" aria-live="polite" aria-atomic="true">` containing the timestamp line. Even that announces every 30 s. Better:
  - Announce only on state changes (failed, recovered, outside session) and on a manual "Làm mới" press ("Đã cập nhật lúc 10:15:42"). Keep the timestamp itself in a non-live element.
  - Use `assertive` for nothing. A failed fetch is not an emergency; it is polite.
- The button needs a text label ("Làm mới"), and an `aria-label` only when the text is hidden on mobile. Add `aria-busy` while pending. The spinner uses CSS animation, so disable or replace it with a static indicator under `prefers-reduced-motion`.
- The tone info stays in sr-only labels (already there).
- Touch target at least 44x44 px on mobile, focus ring visible, and contrast checked against `test/contrast.test.ts` for the warn and muted text in both themes.
- Do not auto-move focus or scroll on refresh.

### 7. Mobile
- The card layout (`md:hidden`) has no space for a per-card timestamp. Keep the per-card "Cập nhật HH:mm:ss" short, and place the page bar at the top as a sticky or at least visible row. A sticky bar is optional; at minimum make the button reachable without scrolling back up on a long watchlist. Consider a compact icon button plus a time label.
- Pull-to-refresh is not needed and can conflict with the browser. The button is enough.
- On a phone the tab will often be in the background, so the visibility pause matters for battery and for the source's rate limit.
- Check that a card's content height does not change on refresh (see section 5).

### 8. R1 and tests
- The component receives only server-computed values: the state enum, formatted strings or ISO instants, and the interval. It does not compare dates, decide market hours, work out staleness or choose tones. Even "is the data older than N s" should come from the loader (`stale: boolean`). Otherwise `no-calc-in-ui.test.ts` may complain, so check it.
- The session state and the interval come from core and config (R5), not hard-coded numbers like 30_000 in a component. Pass `intervalMs` as a prop.
- Component test: use fake timers; assert the call count after 30 s, that the timer pauses when hidden, resumes when visible, does not overlap when pending, and that the button calls refresh immediately. Test the state-to-text mapping and a failure that keeps the old price.

## Risks
- If tone or change is ever recomputed in the browser from raw prices, that breaks R1. Keep the server-render plus `router.refresh()` model.
- `router.refresh()` re-runs `loadDashboard` or `loadWatchlist` (ledger build, several queries) every 30 s per open tab. That is fine for a single user, but combined with the throttle it should read stored prices only. Make sure the page render itself does not call the source.
- Many open tabs each run their own timer. The server throttle bounds the source calls, but the page loads still repeat. Acceptable for v1.
- "Stale" now has two meanings (EOD expected-date gap, and a failed intraday poll). If both reuse "Dữ liệu cũ", Ming cannot tell them apart. Use distinct text.
- A source returning a delayed quote with an old timestamp could look fresh if only our `fetched_at` is shown. Show the source's trade time too if the adapter supplies it, otherwise "cập nhật lúc" means our fetch time and must say so ("Lấy lúc ...").
- Intraday prices can reach the ceiling or floor during a session; the tones need the same `ref` and limit rules (R5), or the ceiling and floor tags will be wrong.
- Accessibility regressions from a live region that announces every cycle.
- Relative time labels ("5 giây trước") tick and need a client clock, causing hydration and re-render churn. Use the absolute time.

## Open questions
1. Should the bar show our fetch time or the source's quote time when they differ? I recommend both, labelled.
2. Should the stale threshold be a multiple of the interval (for example 2 x 30 s = 60 s) and live in config (R5)? Who computes it: the loader, with core logic? I recommend core.
3. During a session on the dashboard, should the totals and P&L visibly flag "tạm tính" (provisional)? I recommend a single note in the bar, not per cell.
4. Do we want a change highlight on update, or none in v1? I recommend none.
5. Outside a session, should the button stay enabled? I recommend yes, but with an explanation ("Ngoài phiên, không có giá mới") instead of an error.
6. Do short-term signals read intraday prices? The ticket defaults to no. If that changes, a failed poll must not hide signals unless R4 stale rules say so.

Relevant files: /home/user/stoktok/work/tickets/STK-049/ticket.md, /home/user/stoktok/apps/web/components/watchlist/price-board.tsx, /home/user/stoktok/apps/web/components/symbol/symbol-header.tsx, /home/user/stoktok/apps/web/components/portfolio/holdings-table.tsx, /home/user/stoktok/apps/web/components/data-freshness-badge.tsx, /home/user/stoktok/apps/web/components/price-change.tsx, /home/user/stoktok/apps/web/server/watchlist/load-watchlist.ts, /home/user/stoktok/apps/web/app/(app)/page.tsx, /home/user/stoktok/docs/figma-make-prompts.md (Prompt 5).
