Status: READY

# Plan — STK-051: Intraday prices, slice 3: refresh bar, 30 s auto refresh and "Làm mới"

> **Runs before STK-050 (Ming's choice, 2026-11-05).** This plan ships on its own. The UI talks to a small **refresh contract** (`RefreshPricesResult`, defined in core). Until STK-050 lands, the only implementation is `refreshPricesAction` in `apps/web/app/(app)/prices/actions.ts`. It calls `requireUser()`, reads the holidays, and returns the session state. It makes **no source call and no DB write**. The client then calls `router.refresh()`, which re-renders the stored data. STK-050 later replaces the **body** of that one action with the throttled fetch-and-store, keeping the same signature. No UI file changes then.

## Spec summary
- docs/spec-v1.md §2: "Intraday data may be delayed. Every price carries a `fetched_at` timestamp and a source."
- §10 roadmap: "| **v1.1** | Intraday polling, short-term signals, gap detection |"
- docs/figma-make-prompts.md Prompt 5 (watchlist): "4. Top-right: last refresh time and a note "Giá có thể trễ vài phút"."
- Ticket goal (Ming, 2026-11-05): "user mở app thì reload sau mỗi 30s, và thêm 1 nút cho user refresh ngay".
- ADR 0006: the session rule is configuration in core (`DEFAULT_INTRADAY_CONFIG`: 09:00–11:30, 13:00–15:00 VN, 3 min grace, `refreshIntervalMs` 30 000, `staleAfterMs` 90 000; weekends and `settings.holidays` are closed).
- CLAUDE.md R1 (no calculation in UI), R3, R5 (market rules are config), R6 (every server action verifies the user), R8.

**In scope without STK-050:**
- The refresh contract and the client scheduler: 30 s, visible only, session only, no overlap, wake at the next session open.
- The "Làm mới" button.
- The page bar on the dashboard, watchlist and symbol page, showing "Cập nhật lúc HH:mm:ss" from the **existing stored `fetched_at`** (oldest across the visible rows).
- These states, all from the STK-049 session rule: live / delayed / outside session / non-trading day / no data, plus failed (client overlay when the action fails).
- Accessibility work and the tests.

**Out of scope (STK-050):**
- Any source call, the throttle and backoff logic, intraday-merged prices.
- The "(tạm tính)" note on the dashboard.
- Rewording the watchlist subtitle "Giá đóng cửa phiên gần nhất, …". It stays true until intraday prices are shown.

During a session before STK-050, the bar will honestly show "Giá đang trễ · cập nhật lúc 15:30:12 04/11/2026", because only EOD data exists.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | A client refresh component calls the refresh server action every 30 s (interval from config, R5), only while the page is visible and the session is open. It never overlaps calls, then re-renders server data (`router.refresh()`). No price, tone or staleness calculation runs in the browser (R1). *The STK-050 action itself is deferred: the interim action has the same contract.* | `apps/web/lib/refresh-scheduler.test.ts`: tests "polls every intervalMs", "no timer when closed and nextInMs is 0", "tick while hidden makes no call; visible runs once, then resumes", "never overlaps", "afterResult (router.refresh) only after a resolved action", "stops when a result says sessionOpen false". `RefreshBarView.intervalMs` comes from `DEFAULT_INTRADAY_CONFIG.refreshIntervalMs` (core test "intervalMs from config"). `grep -n "30_000\|30000" apps/web/components apps/web/lib apps/web/app` finds nothing. `test/no-calc-in-ui.test.ts` passes. `apps/web/test/refresh-action.test.ts` shows the action calls `requireUser()` first and imports no source. |
| 2 | "Làm mới" triggers an immediate refresh through the same action (and, after STK-050, the same throttle), with a fixed-size pending state. | Scheduler tests: "refreshNow calls at once and restarts the interval", "refreshNow while in flight makes no second call". `components/price-refresh-bar.test.tsx` › "busy keeps label and icon box, adds aria-busy and motion-safe spin". |
| 3 | Dashboard, watchlist and symbol pages show "Cập nhật lúc HH:mm:ss" (VN time), with distinct Vietnamese states for delayed, failed, outside session and non-trading day, each as icon + text. The last stored price is kept when a fetch fails. | `packages/core/src/market/refresh-view.test.ts`: the label table, one test per state. `format.test.ts` › `formatTime`. Bar component test: each state renders its exact text, and delayed/failed/closed/non_trading_day render an `svg` icon. Loader tests assert that `refreshBar` is present. A code read shows the three pages render `<PriceRefreshBar>`. Failure keeps prices: the scheduler test "reject → afterResult not called" (no re-render, rows untouched), and the failed overlay only swaps the bar text. |
| 4 | Accessibility: one polite status region that announces state changes only; 44 px touch target; reduced motion respected. | Bar component test: exactly one `role="status"` with `aria-live="polite"`. Its text is the state `announcement` (no time, so it changes only when the state changes), and the time label sits outside it. The button has `min-h-11 min-w-11`. The spinner uses `motion-safe:animate-spin` and never a bare `animate-spin`. |
| 5 | Component tests with fake timers (interval, pause when hidden, resume, no overlap, button) and state-label tests; `typecheck`, `lint`, `test` green. | The fake-timer tests are in `lib/refresh-scheduler.test.ts`; the component is a thin binding over that scheduler (see Approach). Label tests are in core and the bar test. Run `pnpm typecheck && pnpm lint && pnpm test` at the repo root. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/market/refresh-view.ts` | **Create.** Types `RefreshPricesStatus`, `RefreshPricesResult`, `RefreshSessionState`, `RefreshBarState`, `RefreshBarView`. Functions `intradaySessionState`, `msUntilNextSessionOpen`, `storedOnlyRefreshResult` and `buildRefreshBarView` (see Approach §1). | R1/R5: session, staleness and label decisions live in core. This is also the contract STK-050 implements. |
| `packages/core/src/market/refresh-view.test.ts` | **Create.** | R8. |
| `packages/core/src/format.ts` | Add `formatTime(iso)`, giving "HH:mm:ss" in `VN_TIME_ZONE` (new `Intl.DateTimeFormat` with `second: '2-digit'`, `hourCycle: 'h23'`). | AC3 needs VN-time seconds and one shared formatter (no browser locale). |
| `packages/core/src/format.test.ts` | Add `formatTime` cases. | R8. |
| `packages/core/src/index.ts` | Export the new functions, types and `formatTime`. | Public surface. |
| `apps/web/lib/refresh-scheduler.ts` | **Create.** A DOM-free scheduler with injected deps (see Approach §2). | Makes fake-timer testing possible in the node env without jsdom. |
| `apps/web/lib/refresh-scheduler.test.ts` | **Create.** Fake-timer tests. | AC1, AC2, AC5. |
| `apps/web/components/price-refresh-bar.tsx` | **Create.** `'use client'`. `PriceRefreshBar({ view, action })` is the hook binding. `RefreshBarContent({ view, failed, busy, onRefresh })` is pure markup. | AC1–AC4. |
| `apps/web/components/price-refresh-bar.test.tsx` | **Create.** Static-markup tests of `RefreshBarContent`, plus a smoke render of `PriceRefreshBar` with `next/navigation` mocked. | AC3, AC4, AC5. |
| `apps/web/app/(app)/prices/actions.ts` | **Create.** `'use server'`; `refreshPricesAction(): Promise<RefreshPricesResult>` (see Approach §3). This folder has no `page.tsx`, so it is not a route. | R6. One action shared by the three pages; STK-050 replaces its body. |
| `apps/web/test/refresh-action.test.ts` | **Create.** Mocks `server/auth/require-user`, `server/db` and `server/clock`. Asserts call order and the result, and that the file has no `@stoktok/sources`/`server/sources` import. | R6; "no source call" before STK-050. |
| `apps/web/server/dashboard/load-dashboard.ts` | Add `refreshBar: RefreshBarView` to the `ok` result, built from `portfolio.rows.map(r => r.fetchedAt)`. | Server-computed view (R1). |
| `apps/web/server/dashboard/load-dashboard.test.ts` | Assert `refreshBar` for the existing fixture. | R8. |
| `apps/web/server/watchlist/load-watchlist.ts` | Add `refreshBar` to `WatchlistView`, built from the holdings rows (when the ledger is ok) and the watching rows. | Same. |
| `apps/web/server/watchlist/load-watchlist.test.ts` | Assert `refreshBar`. | R8. |
| `apps/web/server/symbols/load-symbol.ts` | Add `refreshBar` to `SymbolView`, built from `[header.fetchedAt]`. | Same. |
| `apps/web/server/symbols/load-symbol.test.ts` | Assert `refreshBar`. | R8. |
| `apps/web/components/symbol/symbol-header.tsx` | Add an optional `refresh?: ReactNode` slot, placed at the right of the title row. "Phiên dd/mm/yyyy" moves into the left group beside the `h1`. | Placement per the consult §2, while the header stays a server component and the existing tests stay unchanged. |
| `apps/web/app/(app)/page.tsx` | Header row `flex flex-wrap items-start justify-between gap-2` with the `h1` and `<PriceRefreshBar>`, only when `portfolio.rows.length > 0`. | AC3 placement. |
| `apps/web/app/(app)/watchlist/page.tsx` | Put the bar at the top right of the header block. Render it only when holdings rows + watching rows > 0. The subtitle is unchanged. | AC3 placement, Prompt 5. |
| `apps/web/app/(app)/symbols/[symbol]/page.tsx` | Pass `refresh={<PriceRefreshBar view={view.refreshBar} action={refreshPricesAction} />}` to `SymbolHeader`. | AC3 placement. |

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `core/market/refresh-view.test.ts` › `intradaySessionState`: Fri 2026-10-23 10:00 VN → open; 12:00 → closed; 08:00 → closed; 15:02 → open (grace); 15:03 → closed; Sat 2026-10-24 → non_trading_day; a weekday listed in holidays → non_trading_day | session rule reuse |
| › `msUntilNextSessionOpen`: 08:59:30 → 30 000; 08:00:00 → 3 600 000; 12:00:00 → 3 600 000; 10:00 (open) → 0; 15:10 → 0; Saturday → 0; holiday → 0 | wake-up at session open |
| › `storedOnlyRefreshResult`: open → `{status:'ok', nextInMs:0, sessionOpen:true}`; 12:00 → `{status:'closed', nextInMs:3_600_000, sessionOpen:false}`; Sunday → `{status:'closed', nextInMs:0, sessionOpen:false}` | interim contract |
| › `buildRefreshBarView`, live: one row, fetched 10 s ago in session → state `live`, label "Cập nhật lúc 10:15:42" | AC3 |
| › delayed: age `staleAfterMs + 1` → `delayed`, "Giá đang trễ · cập nhật lúc …"; age exactly `staleAfterMs` → `live` | threshold boundary |
| › the oldest row wins: rows at 10 s and 5 min old → delayed, and the label shows the older time | consult §2 (do not hide staleness) |
| › missing rows: `[iso, null, null]` → `missingText` "2 mã chưa có giá"; all null or `[]` in session → `no_data` "Chưa có giá" | no-data path |
| › closed: "Ngoài phiên giao dịch · cập nhật lúc HH:mm:ss"; closed with no data → "Ngoài phiên giao dịch · chưa có giá" | AC3 |
| › non_trading_day with `fetchedAt` from a previous VN day → "Hôm nay không giao dịch · cập nhật lúc 15:30:12 23/10/2026" (date suffix only when not today) | AC3, date suffix |
| › a future `fetchedAt` (clock skew) → `live` | edge |
| › `failedLabel` "Không làm mới được · giá cũ lúc {t}", and "Không làm mới được" with no data | AC3 failed |
| › announcements are distinct for all six states (including failed) and contain no digits | AC4: announce state changes only |
| › `note` "Giá có thể trễ vài phút" only when the session is open; `intervalMs === DEFAULT_INTRADAY_CONFIG.refreshIntervalMs`; `sessionOpen` and `nextInMs` equal `storedOnlyRefreshResult` | R5, Prompt 5 |
| `core/format.test.ts` › `formatTime`: "2026-11-05T03:15:42Z" → "10:15:42"; "2026-11-04T17:00:05Z" → "00:00:05"; invalid input throws `RangeError` | VN time, h23 |
| `web/lib/refresh-scheduler.test.ts` › polls every intervalMs (1 call at 30 s, 2 at 60 s, each started after the previous resolved) | AC1 |
| › no timer when `sessionOpen:false, nextInMs:0` (0 calls after 10 min) | AC1 closed |
| › closed with `nextInMs` > 0 → one call at `nextInMs`; if that result is open, polling continues at the interval | session open wake-up |
| › a tick while hidden makes no call; turning visible runs once at once, then resumes the interval; a visibility change with no due tick makes no call | AC1 visibility |
| › never overlaps: an action pending for 90 s gives 1 call; `refreshNow()` during flight gives no second call | AC1, AC2 |
| › `refreshNow()` calls at once and the next tick comes `intervalMs` after it resolves (not earlier) | AC2 |
| › a result with `nextInMs` > `intervalMs` delays the next call to `nextInMs` (throttled) | STK-050 contract |
| › a result with `sessionOpen:false` stops polling (or switches to the wake-up when `nextInMs` > 0) | AC1 |
| › a rejected action → `onResult('failed')`, `afterResult` not called, polling continues; the next ok result emits `ok` | failed keeps the stored price |
| › `onBusy(true)` before the call and `onBusy(false)` after resolve and after reject | pending state |
| › `dispose()` clears the timer and unsubscribes visibility; a late result after dispose emits nothing | cleanup |
| `web/components/price-refresh-bar.test.tsx` › one label per state (live/delayed/closed/non_trading_day/no_data) with exact text; delayed/closed/non_trading_day render an `svg` | AC3 icon + text |
| › `failed` shows `failedLabel` with the warn style and an icon, and the live region shows `failedAnnouncement` | AC3 failed |
| › exactly one `role="status"` with `aria-live="polite"`; its content equals the `announcement`, and the time label is outside it | AC4 |
| › the button: text "Làm mới", `min-h-11 min-w-11`, `type="button"` | AC4 44 px |
| › busy: `aria-busy="true"`, `aria-disabled="true"`, the same text, the icon has `motion-safe:animate-spin`, and there is no bare `animate-spin` | AC2, AC4 |
| › the note renders when `view.note` is set | Prompt 5 |
| › `PriceRefreshBar` smoke: renders the server-state label (`next/navigation` mocked) | binding compiles and renders |
| `web/test/refresh-action.test.ts` › calls `requireUser()` before `getEntrySettings`; returns `storedOnlyRefreshResult(now, holidays)`; the action source has no `@stoktok/sources` or `server/sources` import | R6, no source call |
| load-dashboard / load-watchlist / load-symbol tests › fixture `now` 2026-10-23T13:00Z (20:00 VN, a Friday) → `refreshBar.state === 'closed'`, `sessionOpen === false`, `nextInMs === 0`, `intervalMs === 30_000` | loader wiring |

## Approach
1. **Core (`market/refresh-view.ts`, R1/R5)**:
   - Contract:
     ```ts
     export type RefreshPricesStatus = 'ok' | 'throttled' | 'closed' | 'failed';
     export interface RefreshPricesResult { status: RefreshPricesStatus; nextInMs: number; sessionOpen: boolean }
     ```
     Meaning of `nextInMs`:
     - When `sessionOpen` is true: the minimum wait before the next call. The client waits `max(intervalMs, nextInMs)`.
     - When `sessionOpen` is false: ms until the next session window opens today, or 0, meaning "do not call again".
   - `intradaySessionState(now, holidays, config = DEFAULT_INTRADAY_CONFIG)` returns:
     - `'non_trading_day'` if `!isTradingDay(vnDateOf(now), holidays)`;
     - otherwise `'open'` if `isInIntradayWindow(...)`;
     - otherwise `'closed'`.
   - `msUntilNextSessionOpen(now, holidays, config)` returns 0 if the day is not a trading day or the session is open. Otherwise it finds the first window with `fromMinutesVn > vnMinutesOf(now)` and returns `(from − m) × 60 000 − (now.getTime() mod 60 000)`. The VN offset is whole hours, so this is exact. If no window remains, it returns 0.
   - `storedOnlyRefreshResult(now, holidays, config)` returns `{ status: open ? 'ok' : 'closed', nextInMs: open ? 0 : msUntilNextSessionOpen(...), sessionOpen: open }`.
   - `buildRefreshBarView({ now, holidays, fetchedAts: readonly (string | null)[], config? })` returns `RefreshBarView`:
     ```ts
     { state, sessionOpen, nextInMs, intervalMs, label, announcement, failedLabel, failedAnnouncement, missingText, note }
     ```
     - `oldest` is the minimum non-null `fetchedAt` by `Date.parse`.
     - `t` is `formatTime(oldest)`, plus `' ' + formatDate(vnDateOf(oldest))` when that VN date is not today.
   - Label table (exact strings):

     | state | label | announcement |
     |---|---|---|
     | live (open, age ≤ `staleAfterMs`) | `Cập nhật lúc {t}` | `Giá đang được cập nhật` |
     | delayed (open, age > `staleAfterMs`) | `Giá đang trễ · cập nhật lúc {t}` | `Giá đang trễ` |
     | no_data (open, no `fetchedAt`) | `Chưa có giá` | `Chưa có giá` |
     | closed | `Ngoài phiên giao dịch · cập nhật lúc {t}` / `… · chưa có giá` | `Ngoài phiên giao dịch` |
     | non_trading_day | `Hôm nay không giao dịch · cập nhật lúc {t}` / `… · chưa có giá` | `Hôm nay không giao dịch` |
     | (failed overlay) | `failedLabel`: `Không làm mới được · giá cũ lúc {t}` / `Không làm mới được` | `failedAnnouncement`: `Không làm mới được giá` |

   - `missingText` is `"{n} mã chưa có giá"` when there is at least one null and at least one non-null value; otherwise null.
   - `note` is `'Giá có thể trễ vài phút'` when the session is open; otherwise null.
   - Add `formatTime` to `format.ts`.
2. **Scheduler (`apps/web/lib/refresh-scheduler.ts`)**: no DOM and no React. It has no clock reads: it uses only `setTimeout`/`clearTimeout`.
   - Signature:
     ```ts
     createRefreshScheduler({ intervalMs, initial: { sessionOpen, nextInMs }, action, afterResult, onResult, onBusy, isVisible, subscribeVisibility, timers? })
     ```
     It returns `{ refreshNow(): Promise<void>; dispose(): void }`, and the constructor schedules from `initial`. Nothing in it calls a callback synchronously during construction, which keeps it safe for the React lint rules.
   - Scheduling: `plan(r)` uses one `setTimeout` chain:
     - open → wait `Math.max(intervalMs, r.nextInMs)`;
     - closed with `nextInMs > 0` → one wake-up at `nextInMs`;
     - otherwise → no timer.
   - Tick:
     - If hidden, set `due = true` and stop.
     - If a call is in flight, return (the chain reschedules after it finishes).
     - Otherwise run.
   - Run:
     1. `onBusy(true)`, then `await action()`.
     2. On resolve: `afterResult(r)`, `onResult(r.status)`, then `plan(r)`.
     3. On reject: `onResult('failed')`, then `plan({ sessionOpen: last.sessionOpen, nextInMs: 0 })`.
     4. In `finally`: `onBusy(false)`.
     5. Everything is ignored after `dispose`.
   - Visibility → visible with `due` set: clear `due` and run now.
   - `refreshNow()`: if in flight, return; otherwise clear the timer and run.
   - The chain schedules only after completion, so there is never more than one call in flight.
3. **Interim action (`app/(app)/prices/actions.ts`)**:
   ```ts
   'use server';
   export async function refreshPricesAction(): Promise<RefreshPricesResult> {
     await requireUser();
     const { settings } = await getEntrySettings(getDb());
     return storedOnlyRefreshResult(nowInstant(), settings.holidays);
   }
   ```
   - It has no `revalidatePath`, because the pages are `force-dynamic` and the client calls `router.refresh()`.
   - `test/entrypoints.test.ts` already enforces `requireUser()` before `getDb(` (R6).
   - A comment states that STK-050 replaces the body with the throttled fetch and keeps the signature.
4. **Client component (`components/price-refresh-bar.tsx`, `'use client'`)**:
   - `PriceRefreshBar({ view, action })` holds this state: `failed` (bool, from `onResult`: true on `'failed'`, false otherwise), `busy` (from `onBusy`), and `useTransition` for `router.refresh()`.
   - `afterResult = () => startTransition(() => router.refresh())`.
   - It creates the scheduler in `useEffect` with deps `[view.intervalMs, view.sessionOpen, view.nextInMs]`:
     - `isVisible = () => document.visibilityState === 'visible'`;
     - `subscribeVisibility` adds and removes a `visibilitychange` listener.
     - It keeps the instance in a ref and disposes it on cleanup.
     - `action` and `router` are reached through `useEffectEvent`, so a new server action reference after `router.refresh()` does not restart the timer. If `useEffectEvent` is not available in the installed React or lint setup, use a ref that is updated in an effect, and record that in impl-log.
   - The button handler calls `schedulerRef.current?.refreshNow()`.
   - It renders `RefreshBarContent({ view, failed, busy: busy || isPending, onRefresh })`.
   - `RefreshBarContent` is pure markup:
     - A wrapper with `aria-busy={busy}`.
     - The visible label (`failed ? view.failedLabel : view.label`), using an icon lookup on `failed ? 'failed' : view.state`:
       - delayed and failed: `AlertTriangle` + `text-warn font-semibold`;
       - closed: `Clock` + `text-fg-muted`;
       - non_trading_day: `CalendarX` (or the closest existing lucide name) + `text-fg-muted`;
       - live and no_data: no icon, muted.
     - `missingText` and `note` as small muted lines.
     - One `<p role="status" aria-live="polite" aria-atomic="true" className="sr-only">` holding `failed ? view.failedAnnouncement : view.announcement`. That text has no time in it, so it changes (and is announced) only when the state changes.
     - The button: `type="button"`, `aria-disabled={busy}`, click ignored while busy (this keeps focus; no `disabled`), `aria-busy={busy}`. Classes `inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border px-3`. A `RefreshCw` icon `size-4 shrink-0` gets `motion-safe:animate-spin` while busy. The text is always "Làm mới", so the size is fixed.
   - No arithmetic, no `Date`, no `Math.`, so `no-calc-in-ui` stays green (R1). No `@stoktok/db` import (R3 guard).
5. **Loaders**: each loader calls `buildRefreshBarView({ now, holidays: entry.settings.holidays, fetchedAts })` with the server `now` already passed in.
   - Dashboard: open holdings rows.
   - Watchlist: holdings (if the ledger is ok) + watching.
   - Symbol: the header row.
   - Config is the core default (`DEFAULT_INTRADAY_CONFIG`, R5).
6. **Pages and header**: place the bar as described in the Files table. Pass `refreshPricesAction` as the `action` prop from the server page. Do not change the price rows, the `Status` stack or the dashboard cells: no layout jumps, and `router.refresh()` keeps scroll and focus.
7. Run `pnpm typecheck && pnpm lint && pnpm test`.

Rules: R1 (all decisions in core; the UI does lookups only), R3 (the client imports core and lib only), R5 (interval, stale threshold and sessions from `DEFAULT_INTRADAY_CONFIG`, holidays from settings), R6 (the action calls `requireUser()` first, enforced by the entrypoints test), R7 (no source/throttle work), R8.

## Specialist input used
`consult-data-visualization-engineer.md`:
- **Adopted:**
  - §1: one shared client island with `router.refresh()` in `startTransition`, a `setTimeout` chain, pause when hidden with a refresh on return, no overlap, no polling when not open.
  - §2: page-level bar placement on the three pages; omitted on an empty dashboard; Prompt 5 note on the watchlist (shown in-session on all bars); the oldest `fetched_at`, plus "N mã chưa có giá".
  - §3: the state set and icon + text; distinct wording from "Dữ liệu cũ"; server-rendered strings; absolute time, no ticking clock.
  - §5: fixed-size button with the spinner inside; no skeleton; focus kept (`aria-disabled` rather than `disabled`).
  - §6: one polite region, state changes only.
  - §8: the component gets only server values; interval as a prop from config.
- **Adopted with change:**
  - §1 client backoff (30/60/120 s). It is replaced by the server-driven `nextInMs` in the contract, so STK-050 owns backoff in core (its AC2) and the client has no backoff logic.
  - §3 "fetch failed" state. It is a client overlay set only by an action result or rejection, with its label precomputed by core.
- **Rejected or deferred:**
  - §1/§3 offline ("Mất kết nối"): a rejected action already shows "Không làm mới được"; follow-up.
  - §2 per-row time-only "HH:mm:ss": not in the ACs, and it risks row-height changes; follow-up.
  - §4 intraday markers "Tạm thời"/"Đóng cửa", and §4 "(tạm tính)" on the dashboard: these need intraday prices (STK-050).
  - §5 change highlight: none in v1, per the consult's own advice.
  - §5 button cool-down with the remaining time: the server throttle comes in STK-050, and "throttled" is treated as success.
  - Manual-press announcement "Đã cập nhật lúc …": the AC says "state changes only", and `aria-busy` gives the feedback.
- **Open questions:**
  - Q1 fetch vs quote time: the bar uses our `fetched_at` ("cập nhật lúc"). The source quote time arrives with STK-050.
  - Q2 stale threshold: `staleAfterMs` from config, computed in core.
  - Q3 tạm tính: STK-050.
  - Q4 highlight: none.
  - Q5 button outside the session: it stays enabled and re-renders the stored data.
  - Q6 signals: untouched; a failed refresh never hides signals.

## Assumptions
- STK-050 will replace only the body of `refreshPricesAction` (same file, same `RefreshPricesResult`). It will compute `nextInMs` and `sessionOpen` in core, and it will change the watchlist subtitle and add "(tạm tính)" itself. The orchestrator should add a note to the STK-050 ticket.
- "Delayed" before STK-050 means in session with the stored `fetched_at` older than `staleAfterMs` (90 s). Before intraday prices exist, it is always this state during a session. That is accurate, not a bug.
- The lunch break counts as "Ngoài phiên giao dịch", and the client wakes at 13:00 through `nextInMs`. A page opened before 09:00 wakes at 09:00.
- The `fetched_at` shown is our fetch time (`cập nhật lúc`), not the source's quote time.
- No jsdom: the fake-timer behaviour is tested on the DOM-free scheduler, and the component is a thin binding checked by static markup and a code read. This follows the STK-047 precedent, so no new dev dependency is needed.
- lucide icon names (`Clock`, `CalendarX`, `RefreshCw`) are checked against the installed `lucide-react`; the implementer picks the nearest existing name if one is missing.

## Blocking questions
None.

## Split proposal
None. Estimate: about 330 non-test lines (core ~110, scheduler ~90, component ~90, action ~15, loaders/pages/header ~40).

Follow-ups (not in this diff):
- (a) Per-row "Cập nhật HH:mm:ss" (time only for today) in the watchlist `Status`.
- (b) An offline state ("Mất kết nối") through `navigator.onLine`.
- (c) Interactive DOM tests (jsdom/testing-library) if more client islands appear.
- (d) A cool-down on "Làm mới" that shows the remaining throttle time (after STK-050).
