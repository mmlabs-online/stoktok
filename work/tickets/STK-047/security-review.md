# STK-047 security review, attempt 1

## Security review: STK-047 attempt 1

**Verdict: no 🔴 findings.** I found one 🟡 issue with the acceptance criteria and test evidence, plus a few 🟢 notes. The workspace is not a git repo, so I couldn't diff HEAD~1..HEAD. I read the files the plan names in their current state. I did not open any .env files.

### Findings

**🟡 1. The card test asserts the opposite of its own name (AC3, "Seed never written")**
- `apps/web/components/settings/holiday-calendar-card.test.tsx:41-45` is named "hidden input holds user dates only". Its assertion is `value="2026-11-24,2026-10-20"`, which means the seeded date 2026-11-24 *is* in the hidden input.
- The plan's AC3 row says the card test proves "the hidden input holds user dates only", and the tests table says it "never contains a seeded date". The card passes `splitHolidayList(initialHolidays)` straight into the hidden input at `holiday-calendar-card.tsx:39,148` without removing seeded dates.
- **Real risk is low.** The server still removes seeded dates twice before anything is written:
  - `parseHolidayList` calls `userHolidayDates` (`holiday-editor.ts:82`).
  - `settingsInputToRow` calls `userHolidayDates(input.holidays)` again (`mappers.ts:229`).
- In normal use `initialHolidays` is already filtered (`validate-settings.ts:133`). The only way a seeded date reaches the input is when a crafted or failed POST is echoed back.
- **Fix:** either apply `userHolidayDates` to `current` before rendering the hidden input and change the test to assert `value="2026-10-20"`, or rename the test and record the change from the plan. As it stands, the test evidence for AC3 is wrong.

**🟢 2. Server-side validation of the `holidays` field is sound**
- `handlers.ts:28`: the form value is read as `String(fd.get(...) ?? '')`, so a missing field or a File value can't break the type.
- `validate-settings.ts:96-97,102`: an invalid list sets `errors.holidays` and returns before `saveAppSettings` is called (`handlers.ts:53`).
- `calendar.ts:5,7-13`: dates must match the anchored regex `^\d{4}-\d{2}-\d{2}$` and survive a round trip through `toISOString`, so impossible dates and injection-shaped strings are rejected. Weekend dates, years outside 2020–2035 and duplicates are rejected too (`holiday-editor.ts:58-66,79`).
- Values never reach SQL or the model; they go to PostgREST as a jsonb array through `.upsert`.

**🟢 3. Size caps: suggestion only**
- `splitHolidayList` (`holiday-editor.ts:43`) splits the whole raw string before any count check, and the 100-date cap runs only after the loop (`:83`).
- The work is bounded anyway. The loop stops at the first invalid or duplicate item, and only about 4,170 valid weekdays exist in 2020–2035. Next's server-action body limit (about 1 MB by default) caps the input.
- Two optional hardenings:
  - Reject when `raw.length` is over about 1,200 characters (100 × 11).
  - Stop as soon as `seen.size` passes 100 plus the seed count.
- The `HOLIDAY_DATE_INVALID` message echoes the raw item (`params.value`) without truncation. React escapes it, but a long value makes a long error message; consider truncating it, for example to 32 characters.

**🟢 4. The service role key and DB access stay server-only (R3)**
- The card is a client component. It imports only pure functions from `@stoktok/core` and posts FormData to the existing `'use server'` action (`app/(app)/settings/actions.ts`).
- `server/db.ts:1` imports `server-only`.
- No `service_role` or `SUPABASE` reference appears in the web source outside `.next/` build output and tests.
- I found no new browser-to-DB path.

**🟢 5. Other settings are not overwritten**
- `settingsInputToRow` (`mappers.ts:221-237`) still keeps withholding and `cost_method` from the existing row and merges `rule_configs` (market and signals). Only the `holidays` source changed, from the existing row to the input.
- The only callers are `saveAppSettings` and one worker test.

**🟢 6. No XSS in the new card**
- Seed sources, names, invalid values and error messages are all rendered as React text nodes (`holiday-calendar-card.tsx:65,86,100,132,139,145`).
- The card has no `href`, no `dangerouslySetInnerHTML`, and doesn't turn source URLs into links. The only `dangerouslySetInnerHTML` in the app is the existing theme script in `app/layout.tsx:12`, which this ticket didn't touch.

**🟢 7. Out-of-date doc comment**
- `packages/db/src/repos/settings.ts:131` still says the save keeps "withholding, holidays and other rule_configs keys". Holidays now come from the form input. This is documentation only.

### Recommendations
- **AC3 / R8:** fix 🟡 1. Make the hidden input carry user dates only and assert `value="2026-10-20"`, or rename the test and log the change from the plan.
- **AC2 (optional):** add the raw-length cap and an early exit on the count cap in `parseHolidayList`, and truncate the echoed invalid value.
- Update the comment at `settings.ts:131`.

### Risks
- **Stale browser tab:** a tab opened before this deploy posts without a `holidays` field, so saving from it stores `[]` and wipes Ming's added dates. The plan accepts this; note it in the PR.
- **Read-modify-write without a lock:** two saves at the same moment could overwrite each other. This existed before the ticket and is negligible for a single user.
- **Removed dates don't reopen data gaps:** the plan documents this under D2, and the README covers it with a manual SQL step.

### Open questions
- None blocking.
