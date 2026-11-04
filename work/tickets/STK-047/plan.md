Status: READY

# Plan — STK-047: Holiday calendar editor on the Settings screen

## Spec summary
- docs/spec-v1.md §2.1: "All values below are **configuration, not hard-coded**, and must be verified against current exchange and TCBS rules before go-live." Settlement row: "T+2: bought shares can be sold from T+2 | Never suggest selling a lot that is not yet sellable".
- §2.2: "Gaps happen (sleep, Windows Update, network). Gaps must be detected, not silently interpolated."
- §5: "`settings` | fee_rate, tax_rate, concentration_threshold, rule configs".
- CLAUDE.md R1: "No financial calculation in UI. … Components format and display." R5: "Market rules are configuration, never hard-coded". R4: "Stale or gapped data never produces a signal; gaps are recorded." Conventions: "UI labels in Vietnamese."
- Ticket goal: "Ming can see and edit the market holiday calendar on `/settings`, so new or changed exchange holidays can be added without a code change."
- STK-046 plan D1 (merged): "effective = seed ∪ stored … Cost: Ming cannot remove a seeded date through settings. Removal is a code change to the seed. If STK-047 needs removal, it adds an explicit exclusion list. Its contract: `getAppSettings` returns raw stored dates, and core exports `VN_MARKET_HOLIDAYS` / `effectiveHolidays`."
- STK-046 security review, Risks: "Stored `settings.holidays` entries are not validated as ISO weekday dates. … STK-047 should validate entries on input." Open question: a re-open action when a date is removed.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | A Settings card lists the effective holidays (seeded or stored) by year, shows which are provisional, and lets Ming add or remove dates. | Static-markup tests in `holiday-calendar-card.test.tsx` (listed below). They check: the card "Lịch nghỉ giao dịch"; year groups newest first with the current year open; chips "Có sẵn" / "Tạm tính" / "Bạn thêm" shown as text; "Xóa" only on user rows, with `aria-label="Xóa ngày dd/mm/yyyy"`; no "Xóa" on seeded rows; an add-date input plus a `type="button"` "Thêm" button, with no nested `<form>`. Core `holidayCalendarView` tests cover grouping, status, Vietnamese names and weekdays. "Remove" means removing dates Ming added (decision D1 below). Manual check, recorded in impl-log: run `pnpm --filter web dev`, then on /settings add a date, remove a date, press Hủy (the list resets), and save. |
| 2 | Validation lives in `packages/core`: ISO dates, weekdays only, no duplicates; invalid input gets Vietnamese errors and nothing is written. | `holiday-editor.test.ts` covers `parseHolidayList` and `checkNewHoliday`: invalid format, impossible date, Saturday/Sunday, duplicate, out-of-range year, too many dates, and an already-seeded date on add. Each test asserts the error code and the Vietnamese `entryMessage` text. `validate-settings.test.ts` checks that a bad `holidays` value gives `errors.holidays`. `handlers.test.ts` checks that an invalid holiday list returns a Vietnamese `fieldErrors.holidays` and that `saveAppSettings` is **not called**. The UI only calls core functions; the reviewer checks by grep that the editor has no `Date`/`getDay` math. |
| 3 | Saving writes `settings.holidays` in the same save as the existing settings form without touching other settings. | `handlers.test.ts` checks one `saveAppSettings` call whose input carries `holidays: [...]` next to the other fields. `mappers.test.ts` checks that `settingsInputToRow` takes `holidays` from the input and keeps withholding, cost method and other `rule_configs` keys from the existing row. `settings.test.ts` (db) checks the upsert payload `holidays` equals the input. **Seed never written**: tests in core (`parseHolidayList` strips seeded dates), the mapper (seeded input is stripped; empty input with no row gives `[]`), the handler (form `2026-11-24,2026-10-20` saves `['2026-10-20']`) and the card (the hidden input holds user dates only). |
| 4 | Unit and handler tests; no auth (R6 suspended). | The tests below exist and pass. `pnpm typecheck`, `pnpm lint` and `pnpm test` are green. The diff contains no auth code (grep for `requireUser`). |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/market/holiday-editor.ts` | **New.** `HOLIDAY_EDITOR_BOUNDS = { minYear: 2020, maxYear: 2035, maxUserDates: 100 }`; `HOLIDAY_NAMES_VI` (English seed name → Vietnamese label); `holidayNameVi(name)`; `vnWeekdayLabel(date)`; `splitHolidayList(raw)`; `userHolidayDates(stored)`; `parseHolidayList(raw)`; `checkNewHoliday(candidate, currentUser)`; `addUserHoliday` / `removeUserHoliday`; `holidayCalendarView(savedUser, currentUser)` | AC1 and AC2 in core (R1). The seed module stays untouched |
| `packages/core/src/market/holiday-editor.test.ts` | **New.** | AC2, AC4, R8 |
| `packages/core/src/calendar.ts` | Export `dayOfWeek(date): number` (0 = Sunday), built on the private `toUtc` | Weekday without ad-hoc `Date` parsing (time-zone trap) |
| `packages/core/src/calendar.test.ts` | Add a `dayOfWeek` test | R8 |
| `packages/core/src/entry/messages-vi.ts` | 6 new codes plus Vietnamese text (Approach step 2) | AC2: Vietnamese errors, text defined once |
| `packages/core/src/settings/validate-settings.ts` | `SettingsFormRaw.holidays: string`; `SettingsInput.holidays: string[]`; `validateSettingsInput` calls `parseHolidayList`; `settingsToFormValues` sets `holidays: userHolidayDates(s.holidays).join(',')` | AC2 and AC3: rides the existing form and validation |
| `packages/core/src/settings/validate-settings.test.ts` | Add `holidays` to the fixtures and `holidays: []` to expected values; new cases | AC2 |
| `packages/core/src/db/mappers.ts` | `settingsInputToRow`: `holidays: userHolidayDates(input.holidays)` (input, seed stripped) instead of `existing.holidays`; update the doc comment | AC3. Single choke point against materializing the seed |
| `packages/core/src/db/mappers.test.ts` | Update the "keeps withholding, holidays…" test (holidays now come from the input); add the seed-strip case | AC3 |
| `packages/core/src/index.ts` | Export the new symbols and `dayOfWeek` | Web consumers |
| `packages/db/src/repos/settings.test.ts` | Add `holidays` to the `input` fixture; upsert payload `holidays` equals `input.holidays` | AC3 |
| `apps/web/server/settings/handlers.ts` | `readSettingsForm`: `holidays: str(fd, 'holidays')` | AC3 |
| `apps/web/server/settings/handlers.test.ts` | Fixture `holidays: ''`; expected `holidays: []`; new cases | AC2, AC3, AC4 |
| `apps/web/components/settings/holiday-calendar-card.tsx` | **New.** The card: summary, year groups, rows, chips, Xóa, add-date row, notices, the hidden `holidays` input | AC1 |
| `apps/web/components/settings/holiday-calendar-card.test.tsx` | **New.** Static-markup tests | AC1, AC3 |
| `apps/web/components/settings/settings-form.tsx` | Render `<HolidayCalendarCard>` after "Quy tắc thị trường"; new props `savedHolidays`, `currentYear`; `onReset` on the form bumps a `resetKey` that keys the card | AC1, AC3, the Hủy trap |
| `apps/web/components/settings/settings.test.tsx` | Pass the new props; assert the card and `name="holidays"` are rendered | AC1 |
| `apps/web/app/(app)/settings/page.tsx` | Pass `savedHolidays={userHolidayDates(settings.holidays)}` and `currentYear={Number(vnDateOf(new Date()).slice(0, 4))}` | AC1 |
| `apps/worker/src/jobs/medium-signals.test.ts` | Add `holidays: ''` to the raw form literal (line ~95) | Typecheck only (`SettingsFormRaw` gains a required field) |
| `apps/worker/README.md` | Holidays section: dates can be added in Cài đặt → "Lịch nghỉ giao dịch"; removing one does not re-open gaps; per-date re-open SQL (Approach step 6) | Ops documentation for the removal consequence (R4) |

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `holiday-editor.test.ts` › `parseHolidayList('')` → `{ ok: true, value: [] }`; whitespace and empty items are ignored | AC2 |
| › `'2026-10-20,2026-03-02'` → sorted `['2026-03-02','2026-10-20']` | AC2 |
| › `'2026-13-01'`, `'2026-02-30'`, `'20/10/2026'`, `'abc'` → `HOLIDAY_DATE_INVALID` with `params.value` | AC2 ISO |
| › `'2026-10-24'` (Saturday) and `'2026-10-25'` (Sunday) → `HOLIDAY_WEEKEND` | AC2 weekdays |
| › `'2026-10-20,2026-10-20'` → `HOLIDAY_DUPLICATE` | AC2 duplicates |
| › `'2019-12-31'` and `'2036-01-01'` → `HOLIDAY_YEAR_RANGE` (min 2020, max 2035); `'2020-01-02'` and `'2035-12-31'` pass | year bound (D4) |
| › 101 distinct valid weekdays → `HOLIDAY_TOO_MANY` | count cap |
| › **seeded dates are stripped, not errors**: `'2026-11-24,2026-10-20'` → `['2026-10-20']`; `'2026-01-01'` → `[]` | AC3 seed never written |
| › every error code has a non-empty Vietnamese `entryMessage`; the weekend message for 2026-10-24 contains `24/10/2026` | AC2 Vietnamese |
| › `checkNewHoliday('', [])` → `REQUIRED`; `('2026-11-24', [])` → `HOLIDAY_SEEDED`; `('2026-10-20', ['2026-10-20'])` → `HOLIDAY_DUPLICATE`; a Saturday → `HOLIDAY_WEEKEND`; a valid date → `null`; at the cap → `HOLIDAY_TOO_MANY` | AC2 add path |
| › `addUserHoliday(['2026-10-20'], '2026-03-02')` → sorted, input not mutated; error passthrough; `removeUserHoliday` removes exactly one date | AC1 |
| › `userHolidayDates(['2026-11-24','2026-10-20','2026-10-20','bad'])` → `['2026-10-20','bad']` (seed removed, unique, sorted, invalid kept for display) | AC1, D1 |
| › `holidayCalendarView([], [])`: years `[2027, 2026, 2025]`, 38 rows, summary `{ total: 38, provisional: 13, user: 0 }`, 2026-11-24 has status `provisional` and every 2027 row is `provisional` | AC1 |
| › a seeded row has `removable: false`, a Vietnamese `name` ("Ngày Văn hóa Việt Nam" for 2026-11-24), a `source`, and `weekdayLabel` "Thứ Ba" for 2026-11-24 | AC1 |
| › user date 2026-10-20 saved and current: status `user`, `removable: true`, `pending: false`, `name: null`; a date in current but not in saved has `pending: true`; a date in saved but not in current appears in `removed` | AC1, notices |
| › a user date in 2024 creates a 2024 group; an invalid stored value goes to `invalid`, not to a year group | AC1, security note |
| › `HOLIDAY_NAMES_VI` has an entry for every distinct `VN_MARKET_HOLIDAYS` name; `holidayNameVi` of an unknown name returns it unchanged | Vietnamese UI labels (D3) |
| › `vnWeekdayLabel('2026-10-20')` = "Thứ Ba", `('2026-10-25')` = "Chủ Nhật" (independent of process TZ) | R1 formatting in core |
| `calendar.test.ts` › `dayOfWeek('2026-10-25') === 0`, `('2026-10-24') === 6`; throws on an invalid date | helper |
| `validate-settings.test.ts` › valid form gives `value.holidays: []`; `holidays: '2026-10-24'` gives `errors.holidays.code === 'HOLIDAY_WEEKEND'` and `ok: false` | AC2 |
| › `settingsToFormValues` with stored `['2026-11-24','2026-10-20']` gives `holidays: '2026-10-20'`; the default row gives `''` | AC3 |
| `mappers.test.ts` › holidays come from the input; withholding, cost method and other `rule_configs` keys come from the existing row | AC3 |
| › input holidays `['2026-11-24','2026-10-20']` → row holidays `['2026-10-20']`; no existing row and `[]` input → `[]` | seed never written |
| `settings.test.ts` (db) › `saveAppSettings` upsert payload `holidays` equals `input.holidays` (for example `['2026-10-20']`) even when the existing row holds `['2026-01-01']` | AC3 |
| `handlers.test.ts` › form with `holidays: '2026-10-20'` → `saveAppSettings` called once with `holidays: ['2026-10-20']` plus all other fields | AC3 same save |
| › `holidays: '2026-11-24,2026-10-20'` → saved `['2026-10-20']` | seed never written |
| › `holidays: '2026-10-24'` → `fieldErrors.holidays.message` contains "Thứ Bảy", `values.holidays` is echoed, `saveAppSettings` not called | AC2 nothing written |
| › an invalid holiday list together with a valid rest still saves nothing | AC2 |
| `holiday-calendar-card.test.tsx` › title "Lịch nghỉ giao dịch" and the note; summary "Tổng 38 ngày: 13 tạm tính, 0 do bạn thêm" | AC1 |
| › `<details>` for 2027, 2026, 2025 in that order; only `currentYear` has `open` | AC1 |
| › chip texts "Có sẵn", "Tạm tính" (with "chưa có thông báo của sàn") and "Bạn thêm" | AC1 |
| › with saved `['2026-10-20']`: exactly one "Xóa" button with `aria-label="Xóa ngày 20/10/2026"` and `type="button"`; seeded rows show "Ngày có sẵn trong ứng dụng, không xóa được tại đây" and no Xóa | AC1, D1 |
| › hidden input `name="holidays"` has value `2026-10-20` and never contains a seeded date | AC3 |
| › a `holidays` field error renders `id="holidays-error"` `role="alert"` with the message | AC2 |
| › markup contains no nested `<form`; the add button is `type="button"`; the date input has no `name` (it is not submitted) | form integration |
| › an invalid stored value is listed with "Không hợp lệ" and a Xóa button | security note |
| `settings.test.tsx` › form renders the holiday card and `name="holidays"` | AC1 |

## Approach
1. **Core helpers (R1, R5).** Create `market/holiday-editor.ts`:
   - `splitHolidayList(raw)`: split on `,`, trim, drop empty items. No validation.
   - `parseHolidayList(raw): { ok: true; value: string[] } | { ok: false; error: EntryError }`. For each item, in order:
     - `isValidDate`, else `HOLIDAY_DATE_INVALID {value}`.
     - Year within `HOLIDAY_EDITOR_BOUNDS`, else `HOLIDAY_YEAR_RANGE {min,max}`.
     - Not Saturday or Sunday (`dayOfWeek`), else `HOLIDAY_WEEKEND {date}`.
     - Not a duplicate within the list, else `HOLIDAY_DUPLICATE {date}`.

     Then drop any item that is in `SEEDED_HOLIDAY_DATES` (normalization, not an error, so a legacy redundant stored entry never blocks saving). Then apply the count cap `HOLIDAY_TOO_MANY {max}`. Return the sorted list. The first error wins (one field, one message naming the date).
   - `checkNewHoliday(candidate, currentUser)` is the add path: empty gives `REQUIRED`; then the same per-item checks; a seeded date gives `HOLIDAY_SEEDED {date}`; a date already in the list gives `HOLIDAY_DUPLICATE`; a full list gives `HOLIDAY_TOO_MANY`. Returns `EntryError | null`.
   - `addUserHoliday(current, candidate)` returns `{ ok: true; dates } | { ok: false; error }` (sorted, no mutation). `removeUserHoliday(current, date)`.
   - `userHolidayDates(stored)`: stored minus seed, unique, sorted. Invalid strings are kept so the editor can show them.
   - `holidayCalendarView(savedUser, currentUser)` returns `{ years: { year, rows }[] /* newest first */, invalid: string[], removed: string[], summary: { total, provisional, user } }`. It is built from `VN_MARKET_HOLIDAYS` plus the valid `currentUser` dates. Row fields: `{ date, dateLabel /* formatDate */, weekdayLabel, name: string | null /* holidayNameVi */, status: 'seeded' | 'provisional' | 'user', source: string | null, removable, pending }`. `removed` = `savedUser` minus `currentUser`.
   - `HOLIDAY_NAMES_VI`: a lookup with one entry per distinct seed name, for example "Tết Dương lịch", "Tết Nguyên đán Bính Ngọ", "Giỗ Tổ Hùng Vương", "Ngày Giải phóng miền Nam (30/4)", "Ngày Quốc tế Lao động (1/5)", "Quốc khánh (2/9)", "Nghỉ lễ Quốc khánh", "Nghỉ hoán đổi (làm bù Thứ Bảy 10/01/2026)", "Ngày Văn hóa Việt Nam". Substitute and bridge variants carry their dates in `dd/mm/yyyy`. Do **not** edit `holiday-calendar.ts`, so the seed data and its snapshot test stay unchanged.
   - Add `dayOfWeek` to `calendar.ts`. `vnWeekdayLabel` maps 0–6 to "Chủ Nhật", "Thứ Hai", …, "Thứ Bảy".
2. **Messages.** Add to `EntryErrorCode` and `entryMessage` (exhaustive switch):
   - `HOLIDAY_DATE_INVALID`: "Ngày nghỉ không hợp lệ: {value}."
   - `HOLIDAY_WEEKEND`: "Ngày {dd/mm/yyyy} là Thứ Bảy hoặc Chủ Nhật, vốn không giao dịch."
   - `HOLIDAY_DUPLICATE`: "Ngày {dd/mm/yyyy} đã có trong danh sách."
   - `HOLIDAY_SEEDED`: "Ngày {dd/mm/yyyy} đã có trong lịch có sẵn."
   - `HOLIDAY_YEAR_RANGE`: "Năm phải từ {min} đến {max}."
   - `HOLIDAY_TOO_MANY`: "Tối đa {max} ngày do bạn thêm."
3. **Settings form contract (AC2, AC3).**
   - `SettingsFormRaw.holidays` is a comma-separated string of user-owned dates.
   - `validateSettingsInput` sets `errors.holidays` from `parseHolidayList` and includes the result in the ok-check. On success, `value.holidays` is the parsed list.
   - `settingsToFormValues` sets `holidays: userHolidayDates(s.holidays).join(',')`.
   - `settingsInputToRow` writes `holidays: userHolidayDates(input.holidays)`. Every other column keeps its current source.
   - `readSettingsForm` reads `holidays`.
   - Result: one submit, one `saveAppSettings` call, one upsert. `getAppSettings`, `getSettings` and `getEntrySettings` are unchanged, so the STK-046 contract holds.
4. **Card (AC1).** `holiday-calendar-card.tsx`. Props: `{ savedHolidays: string[]; initialHolidays: string /* values.holidays */; currentYear: number; error?: FormMessage }`.
   - State: `useState(splitHolidayList(initialHolidays))`, plus a draft date and an add error.
   - All derived data comes from `holidayCalendarView(savedHolidays, current)`. The UI does no date math.
   - Layout follows the existing `Card` / `Field` patterns:
     - Note: "Ba sàn nghỉ cùng ngày. Xác minh với thông báo của HOSE/HNX."
     - Summary line: "Tổng N ngày: X tạm tính, Y do bạn thêm".
     - One `<details>` per year (`open` only for `currentYear`), each holding a `<ul>` with an accessible label.
     - Row: `dateLabel`, `weekdayLabel`, name (or "—"), chip.
       - Chips are neutral, border-only, and use **no price colors**. "Tạm tính" has a warning outline, an icon and the text "chưa có thông báo của sàn".
       - Seeded rows have a `<details><summary>Nguồn</summary>` with the source as plain text.
       - Seeded rows show the lock text "Ngày có sẵn trong ứng dụng, không xóa được tại đây". User rows get Xóa (`type="button"`, `min-h-11`, aria-label).
       - Pending rows are marked "chưa lưu".
     - `invalid` values are listed first, marked "Không hợp lệ", with Xóa.
   - Add row (stacked on mobile, `sm:grid-cols-…`):
     - `<input type="date" id="holidayNew">` with no `name` attribute.
     - "Thêm" `type="button"`. It calls `addUserHoliday` and shows the error under the input via `entryMessage` (`id="holidayNew-error"`, `role="alert"`).
     - Hint under the input: "Sau khi lưu, các khoảng trống dữ liệu giá nằm hoàn toàn trong ngày nghỉ sẽ được đánh dấu là ngày không giao dịch ở lần đồng bộ cuối ngày tiếp theo."
   - When `removed` is non-empty, show `role="status"`: "Sẽ xóa N ngày khi lưu: dd/mm/yyyy, …. Các khoảng trống dữ liệu đã được đánh dấu theo những ngày này không tự mở lại (xem apps/worker/README.md, mục Holidays)."
   - Server error `error` renders as `<p id="holidays-error" role="alert">`.
   - Hidden input `<input type="hidden" name="holidays" value={current.join(',')}>`. It is always rendered.
   - No expand animation, so `prefers-reduced-motion` is not an issue.
5. **Form wiring.**
   - In `settings-form.tsx`:
     - Add `const [resetKey, setResetKey] = useState(0)`.
     - Add `onReset={() => setResetKey((k) => k + 1)}` on the `<form>`. The native reset still resets the other inputs.
     - Render `<HolidayCalendarCard key={`${resetKey}:${values.holidays}`} savedHolidays={savedHolidays} initialHolidays={values.holidays} currentYear={currentYear} error={errors.holidays} />` after "Quy tắc thị trường".
     - Keying on `values.holidays` also re-derives the list after a failed save, or after a redirect that re-renders with new props.
   - Hooks must stay above the existing `if (state.ok) return null`.
   - `page.tsx` passes `savedHolidays` and `currentYear`.
6. **Docs (R4 consequence of removal).** README Holidays section:
   - Dates can be added in Cài đặt → "Lịch nghỉ giao dịch".
   - Seeded dates are changed only in code.
   - Removing a date does not re-open gaps resolved because of it. To re-open them for date D: `update public.data_gaps set resolved_at = null, resolved_reason = null where data_type = 'prices_daily' and resolved_reason = 'non_trading_day' and from_ts <= 'DT23:59:59+07:00' and to_ts >= 'DT00:00:00+07:00';`. The next EOD run re-resolves any gap whose bar is stored.
   - Mark it "manual until a `reopen-holiday-gaps` job exists (follow-up)".
7. Run `pnpm typecheck`, `pnpm lint` and `pnpm test` (R8). Record the manual dev-server check in impl-log.

How the rules are met:
- R1: validation, normalization, status, grouping, names and weekdays are all in core. The component holds a list of strings and renders.
- R2: no money involved.
- R3: the browser posts FormData to the existing server action; there is no DB access from the client.
- R4: dates are validated strictly with a year bound, and the removal consequence is stated, not hidden.
- R5: holidays stay configuration; bounds are core constants.
- R6: suspended; no auth added.
- R7: limited to the file list; the extras are follow-ups.
- R8: tests above.
- R9/R10: n/a.

## Specialist input used
- **data-visualization-engineer:**
  - Adopted:
    - Card title and note, year grouping newest first with the current year open, the three text chips with neutral styling and no price colors, the source behind a disclosure.
    - No Xóa on seeded rows, plus the lock text (rec 2). `HOLIDAY_SEEDED` on add.
    - No exclusion list, no auto-reopen.
    - Hidden-input transport in the same FormData. A pure core validator with ISO, weekday, duplicate, seeded and year/count bounds.
    - Native date input with a `type="button"` add and no nested form. "chưa lưu" marking. The Hủy reset.
    - The add hint and the removal notice. The summary line. Weekday via a core helper (time-zone trap). The test that saving never writes seeded dates.
  - Adopted with change:
    - Seeded dates in the *submitted* list are stripped, not rejected. Otherwise a legacy redundant stored date would block every save.
    - One error per field (first offending date named in the message) instead of per-row error keys. A basic implementation is enough for a ≤100-item list.
  - Rejected:
    - A confirm step for near or provisional additions. It is friction and not in the AC; the inline hint covers it.
    - Interactive DOM tests for Hủy. apps/web runs Vitest in `node` with static markup and has no jsdom; adding a test dependency is outside this ticket. The reset is covered by the keyed remount, a code read and the manual check.

### Planner defaults for Ming to confirm in the PR (non-blocking)
- **D1. "Remove" covers only dates Ming added. No exclusion list now.**
  - AC1 says "lets Ming add or remove dates". `settings.holidays` is the only thing settings can write, and under STK-046 D1 (merged, effective = seed ∪ stored) it holds only Ming's dates. So add/remove applies to those.
  - The goal sentence asks for exactly this: "new or changed exchange holidays can be added without a code change".
  - Removing a *seeded* date would need a second source of truth (`settings.holidays_excluded`). That is a new stored field, new merge semantics in `effectiveHolidays`, and new tests in db and worker. It is a second feature, so it is a follow-up.
  - Cost: if the exchanges move a provisional date, Ming can add the new date but the old seeded one stays a holiday until a one-line seed fix. That is the cautious direction (sellability and freshness one day late, never early), as in STK-046 D3.
  - The UI says so on every seeded row.
- **D2. No automatic gap re-open on removal.**
  - Only user-added dates are removable, and `data_gaps` does not record which date caused a resolution.
  - This ticket shows a removal notice and documents per-date re-open SQL in the README.
  - Follow-up: a `reopen-holiday-gaps [--dry-run]` worker job, the inverse of `resolve-holiday-gaps`.
- **D3. Vietnamese names for seeded dates through a core lookup (`HOLIDAY_NAMES_VI`).**
  - CLAUDE.md requires Vietnamese UI labels.
  - The seed module is not edited, and a test enforces that every seed name has a label.
  - User-added dates carry **no name**: `settings.holidays` is `string[]`, and an object array needs a schema and mapper change (follow-up if wanted). Their rows show "—" and the chip "Bạn thêm".
- **D4. Year bound 2020–2035 and at most 100 user dates (`HOLIDAY_EDITOR_BOUNDS`).**
  - 2020 lets Ming add 2024 (or earlier) holidays for a deeper `--backfill` (STK-046 D4) and older ledger history.
  - 2035 catches typos such as 2062.
  - These are fixed core constants (core never reads the clock), to be raised in code when needed.
- **D5. Saving normalizes the stored list.** Any stored date that is also seeded is dropped on the next save of the settings form. The effective calendar is unchanged, and a later seed correction then propagates. This deliberately reads STK-046's "dates Ming has stored are kept" as "the effective calendar keeps them".

### Follow-ups (not in this diff, R7)
- Seed exclusion list (`settings.holidays_excluded`), if Ming wants to un-holiday seeded dates in the UI.
- `reopen-holiday-gaps [--dry-run]` worker job.
- Optional names for user-added dates (object-array storage).
- jsdom/testing-library for interactive settings tests.

## Assumptions
- `values.holidays` is always posted, because the hidden input is always rendered. A stale pre-STK-047 browser tab posting without `holidays` would save `[]`. That is acceptable for a single user (reload after deploy) and is noted in the PR.
- `<input type="date">` posts `YYYY-MM-DD` in the browsers Ming uses. Anything else gets `HOLIDAY_DATE_INVALID`.
- The `pnpm --filter web dev` package filter name may differ. The implementer uses the actual web package name.
- Ledger, worker and signals pick up added dates through `getSettings`/`getEntrySettings` (STK-046), with no change.
- The existing redirect after a successful save (`/settings?saved=1`) re-renders the page with new props. The card key includes `values.holidays`, so the list follows the server.
- Approximate size: ~350–420 non-test lines (core ~170, card ~170, wiring ~40, docs ~15).

## Blocking questions
None.

## Split proposal
None. This is one spec feature (the settings editor for one configuration field), at about the ~400-line guide. The exclusion list and the reopen job are already split out as follow-ups.
