# consult-finance-investment-researcher — STK-030

## Consult: finance-investment-researcher, STK-030 (cash and other assets CRUD)

### Findings
1. The DB has `assets(type text check in ('cash','other'), name text not null, value bigint check >= 0, as_of date not null)` (`supabase/migrations/20261023000100_v1_tables.sql:47`). It has no limit on name length, no unique constraint and no `updated_at`. The repo (`packages/db/src/repos/assets.ts`) has list, create, update and delete, but no `getAsset`, which the STK-009 plan's Slice 2 asks for. `updateAsset` and `deleteAsset` already return NOT_FOUND when no row matches.
2. `buildPortfolio` sums assets with `addVnd`, and `addVnd` throws `RangeError` above `Number.MAX_SAFE_INTEGER` (`money.test.ts:46`). The net worth line is `addVnd(denom, cash, otherAssets)` (`build-portfolio.ts:113-132`). So if every row may go up to MAX_SAFE_INTEGER, two large rows overflow the sum and the dashboard returns a 500. A per-row cap does not by itself keep the total safe.
3. Existing patterns to reuse:
   - `parseIntegerInput(text, {max})`: BigInt range check; accepts "125400" or "125.400".
   - `isValidDate` (now exported from core).
   - `DATE_IN_FUTURE` checked against `ctx.today` (`validate-transaction.ts:44`).
   - The `{ok, value} | {ok:false, errors: Partial<Record<Field, EntryError>>}` shape (`validate-corporate-action.ts`).
   - `messages-vi.test.ts` lists every code, so new codes must be added there.
4. The STK-009 plan (rec 5) defines each row as one account's current balance. All rows are summed, and there are no liabilities.

### Recommendations
- **R1/R2, AC3: put `validateAssetInput(raw: {type,name,value,asOf}, ctx: {today})` in `packages/core/src/entry/validate-asset.ts`** and return field errors the same way as the existing validators.
  - **type:** must be exactly `cash` or `other`, otherwise the new code `ASSET_TYPE_INVALID`. Unlike corporate actions, keep checking the other fields so all errors show together.
  - **name:** trim and collapse inner whitespace (NFC-normalise if cheap). Blank gives `REQUIRED`. More than 100 characters gives the new code `NAME_TOO_LONG`. Count code points, because Vietnamese diacritics can be multi-unit, and test this. Enforcing the limit in core only, with no migration, is fine for this ticket.
  - **value:** `parseIntegerInput(raw.value, { max: ASSET_VALUE_MAX })`. Allow 0 (an empty account is valid). Put `ASSET_VALUE_MAX = 100_000_000_000_000` (10^14 VND) in `entry/rules.ts`, next to `INT32_MAX`. That still leaves room for about 90 maximum-size rows plus holdings under MAX_SAFE_INTEGER, which avoids finding 2. It is a sanity bound, not a market rule, so R5 config is not needed. Map the error codes unchanged (`REQUIRED`, `NOT_INTEGER`, `TOO_LARGE`).
  - **asOf:** blank gives `REQUIRED`. `!isValidDate` gives `DATE_INVALID`. A date after `ctx.today` (VN date from the server clock) gives `DATE_IN_FUTURE`. Reject future dates: a balance "as of" tomorrow is not an observed balance, and this matches both transactions and the STK-009 plan. Set no lower bound.
- **Duplicate names: do not block, and leave a warning out of this ticket.** Two accounts with the same name ("TCBS", "Tiền mặt") can be legitimate. A non-blocking warning needs a confirm step or extra list-time logic, which falls outside AC1–AC5 (R7). Log "possible double-count: warn on same type+normalised name" as a follow-up. If the planner wants something cheap now, the list page could sort by type then name so duplicates sit next to each other. Sort order is display only, so R1 is fine either way.
- **How edits affect net worth (AC4):**
  - An edit fully overwrites the row's balance and `as_of`, with no history. That is consistent with "current balance" semantics.
  - After create, update and delete, the server actions must call `revalidatePath('/assets')` and `revalidatePath('/')`, or the page must be dynamic. This keeps a cached dashboard from showing an old net worth.
  - No core change is needed. `buildPortfolio` already re-sums on every load.
  - Delete is a hard delete.
  - The handler must validate first and write only on `ok`.
  - Check `isUuid` before any DB call, and return NOT_FOUND for non-UUID or unknown ids. Edit/delete pages need a new `getAsset(db, id)`.
- **Unit tests (R8, AC5):**
  - *Core `validate-asset.test.ts`:*
    - Valid cash and valid other.
    - Type "", "CASH" and "stock" are rejected.
    - Name: blank, whitespace only, trimmed and collapsed, exactly 100 characters passes, 101 fails, a Vietnamese name with diacritics at the limit.
    - Value: "0" ok; "125.400" gives 125400; "-1", "1,5" and "1.5" give NOT_INTEGER; exactly ASSET_VALUE_MAX ok; +1 gives TOO_LARGE; a 20-digit number gives TOO_LARGE.
    - asOf: today ok, today+1 gives DATE_IN_FUTURE, "2026-02-30" gives DATE_INVALID, blank gives REQUIRED.
    - Several errors at once are all reported.
  - *`messages-vi.test.ts`:* add the new codes.
  - *`build-portfolio.test.ts`:* a regression case where several rows at ASSET_VALUE_MAX plus holdings still sum without throwing.
  - *Handlers:* invalid input means no repo call. Non-UUID and unknown ids give NOT_FOUND on edit, update and delete. Success calls create/update/delete with the normalised value and triggers revalidation.
  - *db:* `getAsset` returns the mapped row, returns null or NOT_FOUND when missing, and propagates a DB error.

### Risks
- **Overflow 500 (high if not capped):** see finding 2. The value cap fixes it in practice. If the planner keeps MAX_SAFE_INTEGER as the cap, the dashboard loader has to catch the error, which is worse.
- **Double counting:** the same account entered twice, or brokerage cash entered here and also implied by the ledger, overstates net worth. There is no cash ledger from TCBS, so this relies on user discipline; the follow-up warning would mitigate it.
- **Stale balances:** an old `as_of` still counts at full value, so net worth looks more current than it is. Showing `as_of` in the list (AC1) is enough for now. A staleness hint is a follow-up.
- **Margin users:** net worth is overstated because there are no liabilities. This is already logged as an STK-009 follow-up.

### Open questions (for Ming; none blocking, defaults above)
1. Is 10^14 VND per row an acceptable cap?
2. Should the add form pre-fill `as_of` with today? The edit form should keep the stored date so changing it is a deliberate act.
3. Is a duplicate-name warning wanted later, matching on type+name or on name only?

Relevant files: /home/user/stoktok/packages/core/src/portfolio/build-portfolio.ts, /home/user/stoktok/packages/core/src/entry/parse-input.ts, /home/user/stoktok/packages/core/src/entry/validate-corporate-action.ts, /home/user/stoktok/packages/core/src/entry/rules.ts, /home/user/stoktok/packages/core/src/entry/messages-vi.ts, /home/user/stoktok/packages/db/src/repos/assets.ts, /home/user/stoktok/packages/db/src/mappers.ts, /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql
