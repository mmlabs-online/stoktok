## Attempt 1 — 2026-11-04

### Files touched
| File | Required because |
|---|---|
| packages/core/src/market/holiday-editor.ts (new) | Validation, normalization, Vietnamese names/weekdays and the card view model in core (R1, AC1-2) |
| packages/core/src/market/holiday-editor.test.ts (new) | AC2, R8 |
| packages/core/src/calendar.ts, calendar.test.ts | `dayOfWeek` helper without ad-hoc Date parsing |
| packages/core/src/entry/messages-vi.ts | 6 HOLIDAY_* codes with Vietnamese text |
| packages/core/src/settings/validate-settings.ts (+ test) | `holidays` field in form raw/input; validation via `parseHolidayList`; form value shows user dates only |
| packages/core/src/db/mappers.ts (+ test) | `settingsInputToRow` writes input holidays, seed stripped |
| packages/core/src/index.ts | Exports for web |
| packages/db/src/repos/settings.test.ts | `holidays` in input fixture; upsert payload assertion |
| apps/web/server/settings/handlers.ts (+ test) | Read `holidays` from FormData; handler cases |
| apps/web/components/settings/holiday-calendar-card.tsx (+ test) (new) | The card (AC1) |
| apps/web/components/settings/settings-form.tsx (+ settings.test.tsx) | Render card, keyed reset on Hủy, new props |
| apps/web/app/(app)/settings/page.tsx | Pass `savedHolidays` and `currentYear` |
| apps/worker/src/jobs/medium-signals.test.ts | `holidays: ''` in raw form literal (typecheck only) |
| apps/worker/README.md | Add/removal docs and re-open SQL |

### Tests added / changed
- holiday-editor.test.ts: parseHolidayList (empty, sort, invalid, weekend, duplicate, year range, cap, seed strip), Vietnamese messages, checkNewHoliday/add/remove, userHolidayDates, holidayCalendarView (38 rows, 13 provisional, years, pending/removed, invalid), names and weekdays
- calendar.test.ts › dayOfWeek
- validate-settings.test.ts › holidays default/error/strip, settingsToFormValues holidays
- mappers.test.ts › holidays from input, seed strip, empty
- settings.test.ts (db) › upsert payload holidays equals input
- handlers.test.ts › single save with holidays, seed stripped, invalid not saved
- holiday-calendar-card.test.tsx › title/summary, year order and open, chips, Xóa only on user rows, hidden input, error alert, no nested form, invalid value
- settings.test.tsx › card and `name="holidays"` rendered

### Checks (actual output summary)
- typecheck: all 4 workspaces pass, no errors
- lint: all pass, no errors or warnings
- test: core 539, db 121 (+1 todo), worker 236, web 226, all passed
- Manual dev-server check (add, remove, Hủy, save): NOT run (no browser in this environment). Hủy reset rests on the keyed remount only.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Seed exclusion list; `reopen-holiday-gaps` job; names for user dates; jsdom tests (from plan).
- `apps/web/test/no-calc-in-ui.test.ts` forbids `new Date(`, so the page uses existing `todayVn()` from `server/clock` for `currentYear` (plan said `vnDateOf(new Date())`).

### Scope self-check
- Could the diff be smaller? No.
- Diff size: not measured (directory is not a git repo); roughly +650 lines including tests.
