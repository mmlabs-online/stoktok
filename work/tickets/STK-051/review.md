## Attempt 1 — 2026-11-05
Verdict: PASS

Scope: ships before STK-050 with the stored-only interim action, as the plan says. Reviewed `git diff origin/main...HEAD`; the implementation is commit fa242ec. The diff also holds the earlier work/ming-todo.md bookkeeping commit (823483b) and the orchestrator's notes in backlog.md, STK-050/ticket.md and STK-051/ticket.md. There is no browser here, so I judged the client binding by reading the code and running the scheduler's fake-timer tests.

### Checks (run by reviewer)
- typecheck: all workspaces Done, no errors (web route types generated)
- lint: all workspaces Done, no errors
- test: core 593/593 (45 files), sources 24 passed (1 file skipped), db 128 passed + 1 todo, worker 229/229, web 295/295 (38 files). Matches impl-log.

### Acceptance criteria
- [x] AC1, 30 s polling only while visible and in session, no overlap, then `router.refresh()`, no calculation in the browser.
  - Scheduler tests in apps/web/lib/refresh-scheduler.test.ts: "polls every intervalMs" (calls at 30 000 and 60 000), "sets no timer when closed and nextInMs is 0", "wakes once at nextInMs when closed, then polls if open", "a tick while hidden makes no call; visible runs once, then resumes", "a visibility change with no due tick makes no call", "never overlaps calls" (90 s pending gives 1 call, and refreshNow during the flight is ignored), "afterResult runs only after a resolved action", "a result with sessionOpen false stops polling, or wakes at nextInMs". All pass.
  - The interval comes from config: `intervalMs: config.refreshIntervalMs` (core refresh-view.ts:1271), and the core test "note, interval and session fields come from config". A grep for `30_000|30000` in web components/lib/app, excluding tests, finds nothing.
  - The binding is apps/web/components/price-refresh-bar.tsx:288-328. The effect builds the scheduler with `document.visibilityState` and a `visibilitychange` subscription, and disposes it on cleanup. `afterResult` runs `startTransition(() => router.refresh())`. `useEffectEvent` (React ^19.3.1) keeps a new action reference from restarting the timer.
  - Effect deps are `[intervalMs, sessionOpen, nextInMs]`. In session `nextInMs` stays 0, so a re-render does not restart polling. At the 13:00 wake-up or the session close, the new server view recreates the scheduler with the right plan.
  - The component has no Date, Math or arithmetic, and test/no-calc-in-ui passes.
  - The action (app/(app)/prices/actions.ts:52-56) calls `await requireUser()` first and imports no source. Covered by test/refresh-action.test.ts (both tests) and test/entrypoints.test.ts.
- [x] AC2, "Làm mới" uses the same action and path, with a fixed-size pending state.
  - Scheduler tests "refreshNow calls at once and restarts the interval" and "never overlaps calls" pass.
  - Bar test "busy keeps label and icon box, adds aria-busy and motion-safe spin" passes. The text "Làm mới" is constant, and the icon is `size-4 shrink-0` (price-refresh-bar.tsx:281).
- [x] AC3, "Cập nhật lúc HH:mm:ss" in VN time, distinct states with icon + text, and the stored price kept on failure.
  - core format.test.ts › formatTime covers VN time, h23 ("00:00:05") and RangeError.
  - refresh-view.test.ts has one test per state (live, delayed with the exact-threshold boundary, oldest wins, missing/no_data, closed, non_trading_day with a date suffix, future fetchedAt, failed labels).
  - Bar tests render each state's exact text. Delayed, closed, non_trading_day and failed add a state svg next to the button svg.
  - Loader tests "builds the refresh bar view" pass for dashboard, watchlist and symbol.
  - Placement:
    - Dashboard: app/(app)/page.tsx:39-42, shown only when rows > 0.
    - Watchlist: watchlist/page.tsx:32-42, shown only when rows > 0.
    - Symbol page: symbols/[symbol]/page.tsx:44-48, through the `refresh` slot in SymbolHeader.
  - On failure the stored price stays: "a rejected action reports failed, skips afterResult and keeps polling" passes, and the failed overlay only swaps the bar text.
- [x] AC4, one polite region that announces state changes only; 44 px target; reduced motion.
  - Bar test "has exactly one polite status region…" passes. The announcement strings have no digits (core test "announcements are distinct per state and carry no digits"), and the time label sits outside the region.
  - The button has `min-h-11 min-w-11` and `type="button"`.
  - The spinner uses `motion-safe:animate-spin`, and the bar test asserts there is no bare `animate-spin`.
- [x] AC5, fake-timer component tests, label tests, green checks. There are 13 fake-timer scheduler tests. The component is a thin binding with static-markup tests plus a smoke render (the plan's no-jsdom choice, following STK-047). Label tests are in core and in the bar test. Checks are green, as listed above.

### Issues
None blocking.

### Rules R1–R10
No violations found.
- R1: session, staleness, labels and nextInMs are all in core (packages/core/src/market/refresh-view.ts). The client only looks values up. The scheduler's `Math.max(intervalMs, nextInMs)` is timing, not financial math, and it is in lib, as the plan says.
- R3: the client imports only core, lib, lucide and next/navigation.
- R5: the interval, the stale threshold and the sessions come from `DEFAULT_INTRADAY_CONFIG`; holidays come from settings.
- R6: requireUser() runs first.
- R7: no source, throttle, subtitle or "(tạm tính)" work.
- R8: core tests were added.

Scope: every changed code file is in the plan's file list. The work/ files are orchestrator bookkeeping; the STK-050 note was requested by the plan's Assumptions.

### Nits (do not block)
- Busy can stick in one rare case. In refresh-scheduler.ts:663-664, if `dispose()` runs while a call is in flight, `onBusy(false)` is never sent. `dispose()` runs on unmount or when the effect deps change, for example when another server action re-renders the page during lunch, when `nextInMs` differs on every render. The bar then stays `aria-busy`/`aria-disabled` with the spinner until the next scheduler run, or until the next navigation when the result was closed/0.
  - Suggested fix: in `dispose()`, call `deps.onBusy(false)` when `inFlight`. Or call `setBusy(false)` in the effect cleanup.
- impl-log "Scope self-check" says "git not available here; no commit made". That is harmless, but the commit exists (fa242ec).

### Follow-ups (out of scope)
- The plan's (a) to (d): per-row time, the offline state, jsdom DOM tests, and the "Làm mới" cool-down after STK-050.
- STK-050: replace only the body of `refreshPricesAction` and keep `RefreshPricesResult`. This is already noted in STK-050/ticket.md.

## Attempt 2 — 2026-11-05
Verdict: REWORK

Scope: Ming's rework of security-review findings 1 and 2 (ticket note, 2026-11-05). Reviewed `git diff HEAD~1..HEAD` (4b95114). The impl-log heading says "Attempt 3"; this is attempt 2.

### Checks (run by reviewer)
- typecheck: all workspaces Done, no errors
- lint: all workspaces Done, no errors
- test: core 593/593, sources 24 (1 file skipped), db 128 + 1 todo, worker 229/229, web 299/299 (38 files). Matches impl-log.

### Acceptance criteria (rework scope)
- [ ] Finding 1: "failure backoff 30→60→120 s and stop after 3 consecutive failures until Làm mới". FAILED, see Issue 1. The stop after 3, the reset by "Làm mới" and the reset on success are done and tested (refresh-scheduler.test.ts "backs off 1x, 2x interval…", "a success resets the backoff").
- [x] Finding 2: clear busy and prevent overlap when the scheduler is recreated mid-call.
  - `onBusy(false)` now runs in `finally` even after dispose (refresh-scheduler.ts:77-80). Test: "dispose mid-call clears busy".
  - The scheduler is created once per mount (price-refresh-bar.tsx effect with `[]` deps). View changes call `replan()`, so no second scheduler can overlap an in-flight call. Test: "replan re-times the next call when healthy".
- [x] The original AC1–AC5 evidence from attempt 1 still holds. All the attempt-1 scheduler and bar tests pass.

### Issues
#### Issue 1 — 🔴 blocker — the backoff does not match Ming's numbers
- **Where**: apps/web/lib/refresh-scheduler.ts:73-75, and refresh-scheduler.test.ts "backs off 1x, 2x interval on repeated rejection then stops after 3"
- **Expected**: Ming's note says 30→60→120 s, then stop after 3 consecutive failures. The only reading that uses all three numbers and stops at 3 failures is:
  - normal poll gap 30 s;
  - after the 1st failure, wait 60 s;
  - after the 2nd failure, wait 120 s;
  - after the 3rd failure, stop until "Làm mới".
- **Actual**: the waits are `intervalMs * 2 ** (failures - 1)`, which gives 30 s, then 60 s, then stop. A 120 s wait never happens, so the first retry is not backed off at all.
- **Fix instruction**:
  1. Change the wait to `deps.intervalMs * 2 ** failures` (60 s, then 120 s) and keep `failures < MAX_FAILURES`. Update the comment on line 73.
  2. Rewrite the backoff test with these checks:
     - after the first rejection, no call at 60 000 − 1 ms and call 2 at 60 000 ms;
     - no call at 120 000 − 1 ms and call 3 at 120 000 ms;
     - then no calls for 20 intervals.
     Keep the replan-ignored and button-reset checks.
  3. Update the timings in "a success resets the backoff": fail → 60 s → ok → 30 s → fail → 60 s.
  4. Fix the impl-log wording.

#### Issue 2 — 🟡 should-fix — a failure while the session is closed now stops polling for the rest of the mount
- **Where**: refresh-scheduler.ts:74 (`if (sessionOpen && …)`) together with :108 (`replan` ignored when `failures > 0`)
- **Expected**: AC1 says polling runs while the session is open. A single failed call should never stop polling for good. Only 3 failures in a row may do that, and Ming's note asks for exactly that.
- **Actual**: two cases leave `failures = 1`, set no retry timer (because `sessionOpen` is false), and make every later `replan` a no-op:
  - the user presses "Làm mới" during lunch (or before 09:00) and the call fails;
  - the 13:00 or 09:00 wake-up call fails, because `sessionOpen` is still false from the closed plan.

  In both cases the page never polls again until the user presses "Làm mới". Before this attempt, a view change rebuilt the scheduler. `replan` now blocks that. The security re-review saw the same thing (observation 2).
- **Fix instruction**:
  1. In `plan()`, record `expectOpen = r.sessionOpen || r.nextInMs > 0`. This means the next tick is expected to be in session.
  2. Use `expectOpen` instead of `sessionOpen` in the catch-branch guard (line 74). A failed wake-up or a failed lunch press then backs off like a failure in session. The next ok/closed result re-plans correctly through `plan(r)`.
  3. Add a fake-timer test: initial `{sessionOpen:false, nextInMs:60_000}`, the wake-up call rejects, then one retry happens after the backoff wait.
  4. Leave `replan` as it is.

### Rules R1–R10
No violations found.
- R1/R5: the backoff is timing in lib, derived from the configured `intervalMs`. No money math.
- R3/R6: unchanged (the action still calls `requireUser()` first, and the client imports are unchanged).
- R7: the code changes are limited to the plan's files (scheduler, its test, the bar).

### Nits (do not block)
- impl-log: the heading "Attempt 3" should be "Attempt 2". "Not committed (as instructed)" is wrong, because commit 4b95114 exists.
- After 3 failures, the stopped state shows the same "Không làm mới được" label as a single failure. That is acceptable for now; see the follow-up.

### Follow-ups (out of scope)
- A distinct "stopped" label in core, e.g. "Đã dừng tự làm mới · bấm Làm mới" (from impl-log).
- Security re-review observation 1: a floor on `refreshIntervalMs` in config validation.
- Expired session (a 307 on the server-action POST) shows "failed" instead of redirecting to /login. A UX check for Ming.
- STK-050 server-side throttle (already noted in STK-050/ticket.md).

## Attempt 3 — 2026-11-05
Verdict: PASS

Scope: the rework of my attempt-2 issues 1 and 2. I reviewed `git diff HEAD~1..HEAD` (ce58008) for this attempt and re-checked the whole ticket with `git diff origin/main...HEAD`. This attempt changes only the code in apps/web/lib/refresh-scheduler.ts, its test, and the impl-log/backlog/ticket bookkeeping.

### Checks (run by reviewer)
- typecheck: all workspaces Done, no errors (web route types generated)
- lint: all workspaces Done, no errors
- test: core 593/593 (45 files), sources 24 (1 file skipped), db 128 + 1 todo, worker 229/229, web 300/300 (38 files). Matches impl-log (web 300).

### Acceptance criteria
- [x] Attempt-2 Issue 1 (backoff 30→60→120 s, then stop after 3): fixed.
  - refresh-scheduler.ts:76 waits `intervalMs * 2 ** failures` (60 s after the 1st failure, 120 s after the 2nd) and stops at `failures < MAX_FAILURES`. The comment at :74 is updated.
  - Test "backs off 2x, 4x interval on repeated rejection then stops after 3" checks: no call at 60 000 − 1, then call 2 at 60 000; no call at 120 000 − 1, then call 3 at 120 000; then no calls for the stop period. The replan-ignored and button-reset checks are kept (the next call after the reset comes at 60 s).
  - "a success resets the backoff" runs fail → 60 s → ok → 30 s → fail → 60 s, as I asked.
- [x] Attempt-2 Issue 2 (a failure while closed stops polling): fixed.
  - `expectOpen = r.sessionOpen || r.nextInMs > 0` is set in `plan()` (:50) and guards the retry (:75).
  - A failed lunch press (the closed plan has nextInMs > 0) and a failed 09:00/13:00 wake-up now back off and retry. The next resolved result re-plans through `plan(r)`.
  - New test "a failed wake-up call while closed still retries after the backoff" passes. It checks no call at 60 s + 60 000 − 1, then the retry at 60 000.
  - A failure after the session ends for the day (closed, nextInMs 0) correctly sets no retry. Before the failure there was no timer anyway.
- [x] Original AC1–AC5: the attempt-1 evidence still holds. All the scheduler, bar, core label, loader and action tests pass, and price-refresh-bar.tsx is unchanged since attempt 2.

### Issues
None.

### Rules R1–R10
No violations found.
- R1/R5: the backoff is client timing in lib, derived from the configured `intervalMs`. There is no money math.
- R3/R6: unchanged.
- R7: the code changes stay in the plan's scheduler files.
- R8: the tests cover the new branch.
- The security re-review for attempt 3 reports no blocking findings.

### Nits (do not block)
- The impl-log has two sections headed "Attempt 3". The earlier one is attempt 2. Both end with "not committed", but commits 4b95114 and ce58008 exist.
- The test name "backs off 2x, 4x interval" describes multiples of the interval. "60 s, 120 s" would match Ming's wording more closely.

### Follow-ups (out of scope)
- These carry over from attempt 2:
  - a distinct "stopped" label in core;
  - a floor on `refreshIntervalMs` in config validation;
  - an expired session (a 307 on the action POST) shows "failed" instead of going to /login, which Ming should check by hand;
  - the server-side throttle in STK-050.
