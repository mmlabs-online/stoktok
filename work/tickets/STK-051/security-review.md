# STK-051 security review, attempt 1

## Security review: STK-051 attempt 1

**Verdict: no blocking security findings.** R3 and R6 hold, the action leaks no data and there is no XSS path. I found three low items. Two of them are about polling behaviour after a failure. My tools here were read-only, so I could not run the tests or diff the commit; everything below comes from reading the files.

### Findings

1. **[LOW] A failed refresh retries every 30 s with no backoff and never stops. Auth failures are treated as ordinary failures.** `apps/web/lib/refresh-scheduler.ts:61-64`
   - **What happens:** in the `catch` branch the scheduler calls `plan({ sessionOpen, nextInMs: 0 })`. While the session is open, that sets a new timer at `intervalMs`. Nothing counts consecutive failures.
   - **The `forbidden()` case:** `requireUser()` in `apps/web/server/auth/require-user.ts:35` makes the action reject. The client shows "Không làm mới được" and calls the action again every 30 s for as long as the tab is visible, running `getClaims` each time.
   - **The `redirect()` case:** a redirect from `requireUser()` makes the client navigate, which unmounts the bar and calls `dispose`. That path is fine.
   - **The expired-session case (medium confidence, check by hand):** when the proxy (`apps/web/proxy.ts:18,29`) answers a server-action POST with a 307 to `/login`, Next may reject the action promise rather than navigate. If so, the user sees a "failed" state that retries forever instead of being sent to login.
   - **Impact:** small today, because there is one user and the interim action is cheap. It matters more once STK-050 adds source calls.
   - **Fix:** cap consecutive failures, e.g. back off 30→60→120 s, then stop after 3 until "Làm mới" is pressed. Add a fake-timer test for repeated rejection.

2. **[LOW] If the scheduler is recreated while a call is in flight, `busy` can stay true and two calls can overlap.** `apps/web/components/price-refresh-bar.tsx:71-90` together with `refresh-scheduler.ts:57,67`
   - **When it happens:** the effect depends on `view.nextInMs`. Outside the session that value changes on every server render, so any unrelated re-render rebuilds the scheduler.
   - **Stuck button:** if the rebuild happens mid-call, the old scheduler is disposed, `if (!disposed) deps.onBusy(false)` is skipped, and `busy` is never cleared. "Làm mới" then stays disabled (`onClick` is `undefined`).
   - **Overlap:** the new scheduler starts with `inFlight=false`, so a button press can overlap the old call. At most two calls can run at once.
   - **Impact:** a narrow race and not an amplification risk, but it breaks the "never overlaps" guarantee across rebuilds.
   - **Fix (either):** in `dispose`, call `onBusy(false)` when `inFlight` is true. Or keep the scheduler alive across view changes and only re-`plan` from new props.

3. **[LOW / note for STK-050] The client throttle is not a security control.** `apps/web/app/(app)/prices/actions.ts:12-16`
   - Any allowlisted session can call the server action directly in a loop. After each call finishes, the button can be pressed again straight away.
   - That is fine for the interim body: it does no source call and no write.
   - When STK-050 replaces the body, the per-user/global throttle must be enforced on the server before any source fetch. The result's `nextInMs` is only a hint.

### Checks that passed
- **R6:** `await requireUser()` is the first statement in `actions.ts:13`, before `getDb()`.
  - `apps/web/test/refresh-action.test.ts:27-32` checks that order.
  - `apps/web/test/entrypoints.test.ts:25-38` picks the file up automatically, because it starts with `'use server'` and has one exported async function.
- **Client input:** the action takes no parameters and reads nothing from the request. Any extra arguments a client sends are ignored.
- **R3 / client imports:**
  - `price-refresh-bar.tsx` imports only *types* from `@stoktok/core`, plus `lucide-react`, `next/navigation`, `react` and `lib/refresh-scheduler`. The scheduler itself imports only types.
  - The browser gets no DB, sources or env access. The server action is passed as a prop from server pages.
  - `require-user.ts` is `server-only`.
- **Data in the action result:** only `{status, nextInMs, sessionOpen}` (`packages/core/src/market/refresh-view.ts:12-16`). No prices, user ID or settings.
- **XSS:** every label is a server-built string from `buildRefreshBarView` (formatted times, counts, fixed Vietnamese text), rendered as React text children. The diff adds no `dangerouslySetInnerHTML`; the only one in the app is the existing theme script in `apps/web/app/layout.tsx:12`, outside this ticket.
- **Polling limits:**
  - There is no overlap within one scheduler (`inFlight` guard at lines 78, 83 and 91, tested at `refresh-scheduler.test.ts:119`).
  - A tick while the tab is hidden only sets `due`; becoming visible again runs a single call.
  - Outside the session with `nextInMs=0`, no timer is set.
  - `dispose` clears the timer and the visibility listener, and ignores late results.
  - A `throttled` result's `nextInMs` stretches the wait.

### Recommendations
- **Finding 1:** handle failures with backoff plus a stop after N failures, and add a test. Ties to AC1 (only while the session is open) and the brief's "stops on auth failure".
- **Finding 2:** clear `busy` on dispose, or stop rebuilding the scheduler on every `nextInMs` change. Ties to AC1 (never overlaps) and AC2 (pending state).
- **Finding 3:** carry the server-side throttle requirement into STK-050's acceptance criteria (R7 follow-up).

### Open question
- When the proxy redirects an expired-session server-action POST, does Next 16 navigate to `/login` or reject the promise? Testing this once by hand settles the medium-confidence part of finding 1.

### Files
- /home/user/stoktok/apps/web/app/(app)/prices/actions.ts
- /home/user/stoktok/apps/web/components/price-refresh-bar.tsx
- /home/user/stoktok/apps/web/lib/refresh-scheduler.ts
- /home/user/stoktok/packages/core/src/market/refresh-view.ts
- /home/user/stoktok/apps/web/test/refresh-action.test.ts
- /home/user/stoktok/apps/web/test/entrypoints.test.ts
- /home/user/stoktok/apps/web/proxy.ts
- /home/user/stoktok/apps/web/server/auth/require-user.ts

---

# STK-051 security review, attempt 2

## Security re-review: STK-051 attempt 2

**Verdict: findings 1 and 2 are resolved. Calls cannot overlap, automatic polling stops after a bounded number of failures, and the attempt adds no new security finding.** I did this by reading the code only: I did not run the tests and did not diff the commit. I opened no `.env` files.

### Finding 1 (no backoff or stop on failure): RESOLVED
- `apps/web/lib/refresh-scheduler.ts:68-76`: each failure adds to `failures` and sets a retry timer at `intervalMs * 2^(failures-1)`, but only while the session is open and `failures < 3`. That means 30 s, then 60 s, then no timer. This is 3 calls in a row at most, not the 30/60/120 s plus stop that I suggested, and that is fine.
- `replan` (`:107-109`) does nothing once `failures > 0`. So a server re-render cannot restart polling while it is backing off or after it has stopped.
- The visibility path cannot get around this. Only `tick` sets `due`, a tick needs a timer that was allowed to be set, and `run` clears `due` (`:58`).
- After the stop, only "Làm mới" restarts polling. `refreshNow` resets `failures` to 0 (`:104`), so each press allows at most 3 more automatic calls. The user has to act each time.
- Tests: `refresh-scheduler.test.ts:187-211` covers backoff, stop, replan being ignored, and the button reset. `:213-222` covers a success resetting the count.
- The expired-session case (my attempt-1 open question about a 307 on the server-action POST) is now limited to 3 calls, not endless retries. It still shows "failed" rather than sending the user to `/login`. That is a UX question, not a security one.

### Finding 2 (busy stuck or two calls at once after a rebuild): RESOLVED
- `apps/web/components/price-refresh-bar.tsx:77-97` creates the scheduler once per mount (`[]` deps). Its initial values come from `useEffectEvent`. View changes only call `replan` (`:99-101`), so a rebuild while a call is in flight no longer happens.
- `refresh-scheduler.ts:77-80`: `onBusy(false)` is in `finally`, so it also runs on the early `return` after `dispose`. Test: `:224-231`.
- No overlap inside the one scheduler:
  - `tick` returns early if a call is running (`:90`).
  - The visibility callback checks `inFlight` (`:95`).
  - `refreshNow` checks it too (`:103`).
  - A `replan` during a call can set a timer, but that tick sees `inFlight` and does nothing. When the call ends, `run` clears or replaces the timer.
- React StrictMode (dev only) mounts the effect twice. The first scheduler is disposed before it can make any call, so there is still only one live scheduler.
- The bars on `page.tsx`, `watchlist/page.tsx` and `symbols/[symbol]/page.tsx` are on separate routes, so only one is mounted at a time.

### Polling limits
- **Session open, calls succeeding:** one call per `max(intervalMs, nextInMs)`. This continues while the session is open, as AC1 intends. Each call waits for the previous one to finish.
- **Session closed:** no timer when `nextInMs` is 0. Otherwise a single wake-up at `nextInMs`, and `replan` re-times it from fresh server data. This does not loop.
- **Failures:** at most 3 automatic calls in a row (above).
- **Tab hidden:** no calls. Becoming visible again runs one call.

### New observations (none blocking)
1. **[INFO, hardening] Polling has no lower limit if `intervalMs` is set to 0.** `refresh-scheduler.ts:51,75`
   - If `config.refreshIntervalMs` were ever set to 0 or a negative value, polling in an open session would become a tight loop.
   - The value is server config, not client input, and is 30_000 today. This cannot be exploited.
   - Optional fix: a floor in core config validation, or `Math.max(intervalMs, 1000)` here.
2. **[LOW, functional, not security] Polling may never resume on its own after a failure while the session is closed.** `refresh-scheduler.ts:74,108`
   - Example: the user presses "Làm mới" during lunch and the call fails.
   - `failures` becomes 1, no retry is set (the session is closed), and every later `replan` is ignored.
   - So the 13:00 wake-up never comes until the user presses again. Polling fails safe here, but this may break AC1's "polls while the session is open" for that mount.
   - Possible fix: let `replan` go through when the plan has no timer and the session is now open, or set the closed-session wake-up in the catch branch. This is for the reviewer and planner to decide.
3. **Attempt-1 finding 3 (server-side throttle) is still a follow-up for STK-050.** It is already recorded in `work/tickets/STK-050/ticket.md:30`.

### Unchanged checks
`requireUser()` still runs first in the action (R6). The client imports nothing that can reach the server (R3), the action takes no input, and there is no XSS path. This attempt does not touch any of that.
