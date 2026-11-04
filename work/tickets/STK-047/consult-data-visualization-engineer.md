## STK-047 consult (data-viz / UI): holiday calendar editor

### Findings
- The Settings screen is one client form, `/home/user/stoktok/apps/web/components/settings/settings-form.tsx`.
  - It is a stack of `Card`s with a sticky "Lưu thay đổi" / "Hủy" bar.
  - It uses `useActionState`, with `onSubmit` calling `startTransition(formAction(FormData))`. This avoids React 19's form reset.
  - `type="reset"` on "Hủy" resets only native inputs. Any React-state list (the added or removed dates) would not reset unless it is keyed or reset explicitly.
- `page.tsx` loads `getAppSettings`, which is raw. So the page has the stored dates, and the seed is available from `VN_MARKET_HOLIDAYS` and `effectiveHolidays` in core.
- `docs/figma-make-prompts.md` Prompt 6 does not mention holidays, so there is no design to follow. Follow the existing Card and Field patterns.
- Union rule from STK-046 (plan D1): effective = seed ∪ stored.
  - Seeded dates cannot be removed through settings.
  - A stored date that is also seeded is redundant.
  - Only stored-and-not-seeded dates are user-owned and removable.
- The security review (🟡) says a wrong weekday has the same effect as a wrong provisional date: it hides a real gap, and the only undo is manual SQL.
- The security review also notes that stored dates are not validated today (the core validator in AC2 closes this).
- The data is a list of dates, not a quantity, so this is a table or list, not a chart. The viz-relevant part is labelling and grouping, so a reader can tell "official" from "provisional" from "mine" at a glance.

### Recommendations

**1. Presentation (AC1)**
- Add a Card "Lịch nghỉ giao dịch" with the note "Ba sàn nghỉ cùng ngày. Xác minh với thông báo của HOSE/HNX".
- Group by year, newest first. Each year is a `<details>` (or heading plus list), with the current year open.
- Each row shows these fields:
  - Date as `dd/mm/yyyy` plus the weekday in Vietnamese ("Thứ Hai").
  - Name.
  - A status chip.
- Status chips carry meaning as text, not hue alone:
  - "Có sẵn": seeded and confirmed.
  - "Tạm tính": seeded with `provisional`. Show an icon and the text "chưa có thông báo của sàn". A tooltip or expandable row shows the `source`, as plain text or a link.
  - "Bạn thêm": stored and not seeded.
- Do not use the price-color semantics (green, red, purple, cyan) for these chips. Use neutral, border-only chips. "Tạm tính" can use a warning outline plus an icon, and must keep a text label so it works in grayscale and for CVD readers.
- Seed names are in English. Translating to Vietnamese would be a core content change and is out of scope for this ticket. Either show the name as is, or add Vietnamese labels in core as a follow-up (open question 3).

**2. What "remove" means**
- Seeded rows have no delete button. Show a lock icon and the help text "Ngày có sẵn trong ứng dụng, không xóa được tại đây".
  - Do not render a disabled "Xóa" button. It invites the question "why can't I?".
- Only "Bạn thêm" rows get "Xóa", with a 44px touch target and `aria-label="Xóa ngày 20/10/2026"`.
- If Ming adds a date that is already seeded, reject it with a Vietnamese error like "Ngày này đã có trong lịch có sẵn". The core validator should treat seed-or-stored as a duplicate. This keeps the stored list free of redundant entries.
- A seed mistake is fixed by a code change to the seed, as STK-046 D1 decided.
  - Do not add an exclusion list in this ticket. It is scope creep and creates a second source of truth.
  - If Ming needs to un-holiday a seeded date, record it as a follow-up.

**3. Form integration (AC3)**
- Submit the stored list as repeated hidden inputs (`holidays`) or one JSON field, so it rides the existing FormData and the same save.
- The server handler builds the list, validates it with a core function, and writes `settings.holidays`. All other fields stay as they are.
- The core function should be pure. For example `validateHolidayInput(candidates, seedDates)` returns `{ ok, dates, errors[] }`. Checks, in order:
  - ISO `YYYY-MM-DD` that is a real calendar date.
  - Weekday only (Vietnamese error "Thứ Bảy/Chủ Nhật vốn không giao dịch").
  - No duplicates within the list.
  - Not already seeded.
  - Sorted output.
  - Cap the count and the year range (for example 2020 to 2035). This catches a typo such as 2062.
- Add per-row errors keyed by date or index so `aria-describedby` can point at them.
- Add UI to add a date: a native `<input type="date">` plus an optional name, and an "Thêm" button.
  - Adding is client state only until "Lưu thay đổi".
  - The pending list is visibly marked "chưa lưu".
  - "Hủy" must also reset this list.
- Do not make the add button a nested `<form>`. It sits inside the settings form, so use `type="button"`.
- Name storage: `settings.holidays` is a string array, so a user-entered name has nowhere to go. Do not add a name (open question 2).
- Per R1, the UI only formats. It must not compute weekdays or duplicates itself, so call the core validator (pure and importable) or get results from the action.
  - Weekday labels for display are formatting. Use a core date helper, not ad hoc `Date` math.
  - Time zone trap: parse `YYYY-MM-DD` as a date-only value and avoid `new Date('2026-10-20')` in local time.

**4. Re-opening gaps (security review question)**
- Do not auto-reopen on removal in this ticket.
  - Only user-added dates can be removed. Those are the ones that were possibly wrong.
  - The gap-resolving job marks gaps with `resolved_reason = 'non_trading_day'` and a `resolvedAt` timestamp. It does not record which holiday date caused the resolution.
  - A precise reopen therefore means recomputing, for each such gap, whether it is still holiday-only under the new calendar.
- Preferred approach: a follow-up worker job `reopen-holiday-gaps [--dry-run]`.
  - It is the inverse of `resolve-holiday-gaps`.
  - It lists gaps with reason `non_trading_day` where `holidayOnlyGapIds(gap, newCalendar)` is no longer true, using the pure core function. Then it reopens them.
  - This needs no schema change and is idempotent.
  - It matches the dry-run-first pattern from STK-046.
- Cheaper stopgap inside this ticket: after a save that removes dates, show the notice "Đã xóa N ngày. Các khoảng trống dữ liệu từng được xử lý theo ngày này chưa được mở lại. Chạy `run-job.sh reopen-holiday-gaps`" (or the manual SQL from the STK-046 README until the job exists).
  - This is honest and does not hide the consequence.
- Adding a date also needs a note. The next EOD run or `resolve-holiday-gaps` will auto-resolve matching gaps. The confirmation text should say so: "Các khoảng trống dữ liệu nằm hoàn toàn trong ngày nghỉ sẽ được đánh dấu là ngày không giao dịch".
- Because a wrong date hides real gaps (R4), show a confirm step only when the added date is `provisional`-like or close to today. Otherwise it is friction. A short inline hint under the date input is enough.

**5. Accessibility and layout**
- Use semantic list or table markup with a caption. Do not rely on color.
- Keep the add-date row stacked on mobile (`sm:grid-cols-…`) as the other cards do.
- Add a summary line above the list ("Tổng 38 ngày: 2 tạm tính, 1 do bạn thêm") so a screen-reader user gets the overview first.
- Respect `prefers-reduced-motion` for any expand animation.

### Risks
- A wrong weekday or date hides real gaps (R4), and the only undo is manual SQL. Mitigations are strict validation, the year range, the confirmation hint, and the follow-up reopen job.
- The "Hủy" reset trap: React-state rows do not reset with `type="reset"`. The test must cover cancel after add and after remove.
- The seed union means the editor shows the effective list but saves only the stored subset. If the implementer saves the full effective list, the seed gets materialized into the DB and later seed corrections stop propagating. This is the exact reason STK-046 kept `getAppSettings` raw. Add a test that saving never writes seeded dates.
- Two `useActionState` code paths: `if (state.ok) return null` in the form means a successful save redirects. Check that the holiday list state is re-derived from the server after redirect.
- The seed is data-heavy (38 dates, long source strings). Do not render the sources inline in every row. Use an expandable detail.
- Scope: the reopen job and a seed exclusion list are both outside the ticket's ACs. R7 says to list them as follow-ups.

### Open questions
1. Reopen gaps: approve a follow-up ticket (`reopen-holiday-gaps` job), with only a notice and README SQL in STK-047?
2. Should user-added holidays carry a name? That needs a storage change (an object array instead of a string array) and a schema decision, so recommend no for v1.
3. Should seed names be translated to Vietnamese (a core content change), or shown in English for now?
4. Should the editor allow adding dates before the first seeded year (2025) or only a bounded window? Recommend 2020 to 2035.
5. Is "seeded dates are not removable here" acceptable to Ming, or does he want the exclusion-list design now (a second field, `settings.holidays_excluded`)?

Files read: `/home/user/stoktok/apps/web/components/settings/settings-form.tsx`, `/home/user/stoktok/apps/web/app/(app)/settings/page.tsx`, `/home/user/stoktok/packages/core/src/market/holiday-calendar.ts`, `/home/user/stoktok/work/tickets/STK-047/ticket.md`, `/home/user/stoktok/work/tickets/STK-046/plan.md`, `/home/user/stoktok/work/tickets/STK-046/security-review.md`.
