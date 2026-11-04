## Attempt 1 — 2026-11-04
Verdict: REWORK

Reviewed commit 028a134 (implementation). HEAD is now 4f4ea1a, which adds only security-review.md. `main...HEAD` also includes merged STK-018…046 history because local `main` is stale; scope was judged on 028a134~1..028a134.

### Checks (run by reviewer)
- typecheck: pass, all 4 workspaces (exit 0)
- lint: pass, all 4 workspaces, no warnings
- test: core 539/539 passed (43 files); db 121 passed + 1 todo (14 files); worker 236/236 passed (15 files); web 226/226 passed (26 files). These match impl-log.
- Manual dev-server check (add / remove / Hủy / save): **not run** by the implementer or by me, because the sandbox has no browser. I judged the Hủy reset by reading the code (see AC1).

### Acceptance criteria
- [x] AC1: the card lists effective holidays by year, shows provisional dates, and supports add/remove. Evidence: `holiday-calendar-card.test.tsx` (title/summary, year order with only 2026 `open`, chips, a single Xóa with `aria-label="Xóa ngày 20/10/2026"` and `type="button"`, lock text, no nested `<form`, date input without `name`, invalid value with Xóa) and `holiday-editor.test.ts › holidayCalendarView` (38 rows, 13 provisional, pending/removed, 2024 group, invalid). All pass. The editor and the form contain no `new Date`/`getDay`/`Date.UTC` (grep).
  - **Hủy, by code reading only:** `settings-form.tsx:246` is `type="reset"`. `onReset` (`:102`) bumps `resetKey`, and the card is keyed `${resetKey}:${values.holidays}` (`:157`). The remount re-runs `useState(() => splitHolidayList(initialHolidays))`, so unsaved adds and removes, the draft date and the add error are discarded. The native reset does not change a hidden input's value, and React re-renders it from the fresh state. The hook sits above `if (state.ok) return null` (`:87-88`). The logic looks correct, but no test or run has exercised it.
- [x] AC2: validation is in core with Vietnamese errors, and nothing is written on invalid input. Evidence: `holiday-editor.test.ts › parseHolidayList` (invalid/impossible/format, weekend, duplicate, year range 2020–2035, cap 101, seed strip, Vietnamese text containing `24/10/2026` and `Thứ Bảy`) and `checkNewHoliday`. Also `validate-settings.test.ts › holidays: weekend gives errors.holidays` and `handlers.test.ts › invalid holiday list … does not save` (`saveAppSettings` not called, message contains "Thứ Bảy").
- [ ] AC3: holidays are saved in the same save, and other settings are untouched. Mostly met: `handlers.test.ts › saves holidays in the same single save`, `mappers.test.ts › takes holidays from the input; keeps withholding, cost method…`, and the db `saveAppSettings` upsert payload `holidays: ['2026-10-20']`. The seed is stripped in core, the mapper and the handler. **But the plan's card-level evidence ("the hidden input holds user dates only") is inverted.** See Issue 1.
- [x] AC4: unit and handler tests exist, and there is no auth. All planned test files exist and pass. No new `requireUser` (the only match is the pre-existing comment at `handlers.ts:10`).

### Issues
#### Issue 1 — 🔴 blocker — test evidence contradicts the plan (AC3 "seed never written")
- **Where**: `apps/web/components/settings/holiday-calendar-card.test.tsx:41-45`; `apps/web/components/settings/holiday-calendar-card.tsx:39` and `:148`
- **Expected**: The plan (AC3 row and Tests table) says the hidden input `name="holidays"` "has value `2026-10-20` and never contains a seeded date".
- **Actual**: The test is named "hidden input holds user dates only", but it asserts `value="2026-11-24,2026-10-20"`, which includes the seeded date 2026-11-24. The card puts `splitHolidayList(initialHolidays)` into state without stripping the seed. The server still strips it, so there is no data impact, but the planned evidence is false and the test name is wrong. The security review flagged the same issue (🟡 1).
- **Fix instruction**: In `holiday-calendar-card.tsx:39`, initialise state with `useState(() => userHolidayDates(splitHolidayList(initialHolidays)))` and import `userHolidayDates` from `@stoktok/core`. In the test, keep `initialHolidays: '2026-11-24,2026-10-20'` and assert `/<input type="hidden" name="holidays" value="2026-10-20"/`. Also assert that the markup does not match `/name="holidays" value="[^"]*2026-11-24/`.

### Rules R1–R10
No violations found.
- R1: grouping, status, names, weekdays and validation are in core. The UI only formats (`formatDate`) and renders.
- R3: the client card imports only pure core functions and posts FormData to the existing server action.
- R5: holidays remain configuration, and the bounds are core constants.
- R6: suspended, and no auth was added.
- R7: every changed file is in the plan. The `todayVn()` deviation in `page.tsx` is justified in impl-log, because `no-calc-in-ui.test.ts` forbids `new Date(`.
- R8: green, and the new core code has tests.

### Nits (do not block)
- 💭 `packages/db/src/repos/settings.ts:131`: the doc comment still says the save keeps "withholding, holidays and other rule_configs keys". Holidays now come from the input. You may fix it if you log it under Out-of-plan files; otherwise leave it for a follow-up.
- 💭 `HOLIDAY_DATE_INVALID` echoes the raw item without truncation (security review 🟢 3). React escapes it, so this is cosmetic.
- 💭 impl-log says "directory is not a git repo", but it is one (`git diff` works). Diff size: 720 insertions over 23 files, including ticket docs.

### Follow-ups (out of scope)
- From the plan: seed exclusion list, `reopen-holiday-gaps [--dry-run]` job, names for user-added dates, jsdom/testing-library so the Hủy reset can be tested interactively.
- Optional raw-length cap and early exit in `parseHolidayList` (security review 🟢 3).
- PR note: a browser tab opened before this deploy posts without `holidays`, so saving from it stores `[]`.

## Attempt 2 — 2026-11-04
Verdict: PASS

Reviewed commit a3066f4 (HEAD~1..HEAD) against the attempt-1 findings. The full ticket diff (`git diff origin/main...HEAD`) is 21 code files plus ticket docs. Each one is in the plan's file list, except `packages/db/src/repos/settings.ts`, which is logged in impl-log as an out-of-plan, comment-only change.

### Checks (run by reviewer)
- typecheck: pass, all workspaces (exit 0)
- lint: pass, all workspaces (exit 0)
- test: core 539/539 (43 files); db 121 passed + 1 todo (14 files); worker 236/236 (15 files); web 226/226 (26 files). These match impl-log attempt 2.
- Manual dev-server check (add / remove / Hủy / save): still not run, because the sandbox has no browser. The Hủy reset was judged by reading the code in attempt 1 and is unchanged.

### Acceptance criteria
- [x] AC1: the card lists effective holidays by year, shows provisional dates, and supports add/remove. Evidence is unchanged from attempt 1 and still green: `holiday-calendar-card.test.tsx` and `holiday-editor.test.ts › holidayCalendarView`.
- [x] AC2: validation is in core, errors are in Vietnamese, and nothing is written on invalid input. Evidence is unchanged and green: `holiday-editor.test.ts`, `validate-settings.test.ts`, and `handlers.test.ts › invalid holiday list … does not save`.
- [x] AC3: holidays are written in the same save, other settings are untouched, and the seed is never written. Issue 1 is fixed. `holiday-calendar-card.tsx:39` now initialises state with `userHolidayDates(splitHolidayList(initialHolidays))`. The test `holiday-calendar-card.test.tsx:41-46` ("hidden input holds user dates only") asserts `value="2026-10-20"` and that the value does not contain `2026-11-24`. It passes. The handler, mapper and db upsert evidence is unchanged and green.
- [x] AC4: unit and handler tests exist, and there is no auth code. The only `requireUser` match is still the pre-existing comment.

### Issues
None.

### Rules R1–R10
No violations found. The fix calls a core function (`userHolidayDates`), so R1 holds, and no date math was added to the UI.

### Nits (do not block)
- 💭 The client state now dedupes. Take a failed save with a `HOLIDAY_DUPLICATE` error, for example from a hand-crafted post. The echoed error names a date that the card now shows once. The UI add path cannot create duplicates, so this is cosmetic.
- 💭 `HOLIDAY_DATE_INVALID` still echoes the raw item without truncation. This was carried over from attempt 1 and is cosmetic.

### Follow-ups (out of scope)
- These are unchanged from attempt 1: a seed exclusion list, a `reopen-holiday-gaps [--dry-run]` job, names for user-added dates, jsdom for an interactive Hủy test, and an optional raw-length cap in `parseHolidayList`.
- For the PR: Ming should do the manual browser check (add, remove, Hủy, save). Also note that a browser tab opened before the deploy saves `holidays: []`.
