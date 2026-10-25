Status: READY

# Plan — STK-030: Cash and other assets management

> Slice 2 of STK-009 (see `work/tickets/STK-009/plan.md` › Split proposal). STK-009 already reads and sums `assets` into net worth (`buildPortfolio`, `loadDashboard`). This ticket adds the CRUD and the dashboard link. It needs no migration and no new dependency.

## Spec summary
`docs/spec-v1.md` §3 F2 Portfolio & assets:
> - Cash balance and other assets entered manually; total net worth view.

§5: `assets | id, type (cash/other), name, value, as_of`.

DB (`supabase/migrations/20261023000100_v1_tables.sql:47`): `type text check in ('cash','other')`, `name text not null`, `value bigint check >= 0`, `as_of date not null`.

CLAUDE.md:
- R1: validation and all numbers come from `packages/core`; components only format.
- R2: integer VND, parsed with BigInt in `parseIntegerInput`.
- R3: data access only through `apps/web/server/db`.
- R6 is suspended. Add no auth code; the auth tests are waived (ticket AC5).
- R7: stay inside the AC.

Note: the ticket text says `parseVndInput`. That function does not exist. Use the existing `parseIntegerInput(text, {max})` from `packages/core/src/entry/parse-input.ts`, and add no alias, so there is a single parse path (R2).

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | `/assets` lists cash and other assets (name, type, value in VND, as-of date). Desktop table plus phone cards, following the STK-008 list pattern. | `assets.test.tsx › list renders name, type label, formatted value and date in table and cards`, `› value 0 renders "0 ₫", not "—"`, `› edit/delete hrefs`, `› empty state links to /assets/new`. Inspection: `asset-list.tsx` uses `hidden md:table` and `md:hidden` `<ul>`, with `min-h-11` actions. |
| 2 | Add, edit and delete via full-page forms and server actions (`apps/web/server/assets/handlers.ts`), with a delete confirmation page. Non-UUID ids give 404 / NOT_FOUND. | `handlers.test.ts` (cases below). Inspection: `/assets/new`, `/assets/[id]/edit` and `/assets/[id]/delete` pages call `isUuid` and then `notFound()`, and catch `DataError` NOT_FOUND from `getAsset` → `notFound()`. Each action calls `revalidatePath('/assets')` and `revalidatePath('/')`, then `redirect('/assets')`. |
| 3 | Validation lives in `packages/core` (`validateAssetInput`): name required, type `cash`\|`other`, value integer VND ≥ 0, valid as-of date. Vietnamese messages are keyed by code (R1, R2). | `validate-asset.test.ts` (cases below). `messages-vi.test.ts › has a non-empty Vietnamese message for every code`, with the new codes added. |
| 4 | The dashboard links to `/assets`; net worth (STK-009) picks up changes. | `portfolio.test.tsx › summary links to /assets`. `build-portfolio.test.ts › net worth: several rows at ASSET_VALUE_MAX plus holdings do not throw`. Net worth needs no code change: `/` is `force-dynamic`, re-sums on every load, and the actions revalidate `/`. |
| 5 | Unit tests for core validation, and handler tests (invalid input → no write; unknown id → NOT_FOUND). Auth tests are waived. | The test files listed below. `pnpm typecheck && pnpm lint && pnpm test` are green and `pnpm build` succeeds (R8). `no-calc-in-ui.test.ts` stays green; it already scans all of `components/` and `app/` recursively. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/entry/rules.ts` | Add `ASSET_VALUE_MAX = 100_000_000_000_000` (10^14 VND) and `ASSET_NAME_MAX_LENGTH = 100`. | AC3. A sanity bound that keeps the sum of many rows under MAX_SAFE_INTEGER (finance consult finding 2) |
| `packages/core/src/entry/messages-vi.ts` | Add codes `ASSET_TYPE_INVALID`, `NAME_TOO_LONG`, `AS_OF_IN_FUTURE` and `ASSET_NOT_FOUND`, with Vietnamese text. | AC3. The existing `DATE_IN_FUTURE` and `NOT_FOUND` texts say "giao dịch" |
| `packages/core/src/entry/validate-asset.ts` | New: `AssetFormRaw`, `AssetInput`, `AssetField`, `ValidateAssetResult`, `validateAssetInput(raw, {today})` and `assetToFormValues(asset)`. | AC3 (R1, R2) |
| `packages/core/src/entry/validate-asset.test.ts` | New: validation tests. | AC5, R8 |
| `packages/core/src/entry/messages-vi.test.ts` | Add the 4 new codes to `CODES`. | AC3 |
| `packages/core/src/portfolio/build-portfolio.test.ts` | Add one regression case for the overflow bound. | AC4. Proves the cap prevents a dashboard 500 |
| `packages/core/src/index.ts` | Export the new functions, types and constants. | Consumers import from `@stoktok/core` |
| `packages/db/src/repos/assets.ts` | Add `getAsset(db, id): Promise<Asset>`. It uses `unwrapFound` + `maybeSingle` and throws `DataError` NOT_FOUND, like `getTransaction`. | The edit and delete pages need it |
| `packages/db/src/repos/assets-watchlist.test.ts` | Tests for `getAsset`. | R8 |
| `packages/db/src/index.ts` | Export `getAsset`. | Public API |
| `apps/web/server/transactions/handlers.ts` | Add `export` to the existing `message`, `fieldErrors` and `failForm` helpers. No behaviour change. | Reuse the STK-008 form-state helpers instead of copying them |
| `apps/web/server/assets/handlers.ts` | New: `readAssetForm`, `AssetFormState`, `handleCreateAsset`, `handleUpdateAsset` and `handleDeleteAsset`. | AC2 |
| `apps/web/server/assets/handlers.test.ts` | New: handler tests that mock `../db`, as in `transactions/handlers.test.ts`. | AC5 |
| `apps/web/app/(app)/assets/actions.ts` | New: `'use server'` actions `createAssetAction`, `updateAssetAction(id, …)` and `deleteAssetAction(id)`. Each revalidates `/assets` and `/` and then redirects to `/assets`. | AC2, AC4 |
| `apps/web/app/(app)/assets/page.tsx` | New: list page, `force-dynamic`. Header "Tiền mặt & tài sản khác" plus a "Thêm tài sản" link, then `<AssetList>`. | AC1. The page has no searchParams, so without `force-dynamic` it would prerender at build time |
| `apps/web/app/(app)/assets/new/page.tsx` | New: add page, `force-dynamic`. Initial values `{type:'cash', name:'', value:'', asOf: todayVn()}`. | AC2 |
| `apps/web/app/(app)/assets/[id]/edit/page.tsx` | New: `isUuid` check, `getAsset` (NOT_FOUND → `notFound()`), and the form prefilled from `assetToFormValues`. | AC2 |
| `apps/web/app/(app)/assets/[id]/delete/page.tsx` | New: confirmation page "Xóa {name} ({formatVnd(value)})? Tổng tài sản sẽ được tính lại." | AC2 |
| `apps/web/components/assets/asset-list.tsx` | New: table plus cards, type badge, `RowActions`, `EmptyState`. | AC1 |
| `apps/web/components/assets/asset-form.tsx` | New: client form (type select, name, value, as-of). Uses `onSubmit` + `startTransition`, like `corporate-action-form.tsx`. | AC2 |
| `apps/web/components/assets/delete-asset-form.tsx` | New: copy of `DeleteTransactionForm` with Hủy linking to `/assets`. | AC2 |
| `apps/web/components/assets/assets.test.tsx` | New: render tests for the list and form. | AC1 |
| `apps/web/components/portfolio/portfolio-summary.tsx` | Add the link "Quản lý tiền mặt & tài sản khác" → `/assets` below the stat grid. | AC4 |
| `apps/web/components/portfolio/portfolio.test.tsx` | Add the `/assets` link test. | AC4 |

There are no nav changes, no migration, and no change to `listAssets` ordering.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| validate-asset.test.ts › valid cash and valid other → `{ok:true}` with integer value and trimmed name | AC3 |
| validate-asset.test.ts › type "", "CASH", "stock" → `ASSET_TYPE_INVALID`, and other fields are still validated (all errors reported together) | AC3 |
| validate-asset.test.ts › name: "" and "   " → REQUIRED; "  TCBS   tiền  " → "TCBS tiền"; exactly 100 code points passes; 101 → NAME_TOO_LONG; a Vietnamese name with diacritics (decomposed input, NFC-normalised) at 100 code points passes | AC3 |
| validate-asset.test.ts › value: "0" → 0; "125.400" → 125400; "" → REQUIRED; "abc", "-1", "1,5", "1.5" → NOT_INTEGER; "100.000.000.000.000" (= ASSET_VALUE_MAX) passes; ASSET_VALUE_MAX+1 → TOO_LARGE; a 20-digit string → TOO_LARGE | AC3, R2 |
| validate-asset.test.ts › asOf: today passes; a past date passes; today+1 → AS_OF_IN_FUTURE; "2026-02-30" → DATE_INVALID; "" → REQUIRED | AC3 |
| validate-asset.test.ts › assetToFormValues: value 50000000 → "50000000", and type, name and asOf are passed through | edit prefill |
| messages-vi.test.ts › every code (including ASSET_TYPE_INVALID, NAME_TOO_LONG, AS_OF_IN_FUTURE, ASSET_NOT_FOUND) has a message | AC3 |
| build-portfolio.test.ts › net worth: 10 rows at ASSET_VALUE_MAX plus a priced holding sum without throwing | AC4, overflow |
| assets-watchlist.test.ts › getAsset: `eq('id', …)` + `maybeSingle`, maps the bigint value; no row → DataError NOT_FOUND; DB error → DataError | data layer |
| handlers.test.ts › create: valid form → `createAsset` called with `{type, name (normalised), value: 125400, asOf}` and `{ok:true}` | AC2 |
| handlers.test.ts › create: invalid input (blank name, bad value, future date) → fieldErrors keyed by field with Vietnamese messages, values echoed, `createAsset` not called | AC5 |
| handlers.test.ts › update: valid → `updateAsset(db, id, …)`; invalid → no `updateAsset` call; non-UUID id → formError ASSET_NOT_FOUND with no repo call; repo DataError NOT_FOUND → formError ASSET_NOT_FOUND | AC2, AC5 |
| handlers.test.ts › delete: valid UUID → `deleteAsset` and `{ok:true}`; non-UUID → ASSET_NOT_FOUND with no repo call; DataError NOT_FOUND → ASSET_NOT_FOUND; other DataError → SAVE_FAILED; a non-DataError is rethrown | AC2, AC5 |
| assets.test.tsx › list renders name, "Tiền mặt"/"Khác" badge, formatted value and dd/mm/yyyy date | AC1 |
| assets.test.tsx › value 0 renders "0 ₫" (not "—") | AC1 |
| assets.test.tsx › edit/delete links are `/assets/${id}/edit` and `/assets/${id}/delete` | AC1, AC2 |
| assets.test.tsx › empty list → "Chưa có tiền mặt hoặc tài sản khác" with a link to `/assets/new` | AC1 |
| assets.test.tsx › form shows field error messages and keeps typed values | AC2 |
| portfolio.test.tsx › summary links to /assets (also when there are no transactions) | AC4 |

## Approach
1. **Core rules and messages.**
   - Add the two constants to `rules.ts`.
   - Add the 4 codes to `EntryErrorCode` and `entryMessage`:
     - `ASSET_TYPE_INVALID`: "Chọn Tiền mặt hoặc Khác."
     - `NAME_TOO_LONG`: "Tên tối đa 100 ký tự." (use the `max` param or the constant)
     - `AS_OF_IN_FUTURE`: "Ngày cập nhật không được ở tương lai."
     - `ASSET_NOT_FOUND`: "Không tìm thấy tài sản."
2. **`validateAssetInput(raw: AssetFormRaw, ctx: { today: string })`** in `entry/validate-asset.ts`. It returns the same shape as `validateCorporateActionInput` (`{ok:true, value: AssetInput} | {ok:false, errors: Partial<Record<AssetField, EntryError>>}`).
   - **type:** must be exactly `'cash'` or `'other'`, otherwise `ASSET_TYPE_INVALID`. Keep validating the other fields so all errors show together.
   - **name:** `raw.name.normalize('NFC').trim().replace(/\s+/g, ' ')`. Empty gives `REQUIRED`. `[...name].length > ASSET_NAME_MAX_LENGTH` gives `NAME_TOO_LONG`.
   - **value:** `parseIntegerInput(raw.value, { max: ASSET_VALUE_MAX })`, with the code mapped unchanged. 0 is allowed. A negative sign fails the regex, so it gives NOT_INTEGER.
   - **asOf:** trimmed. Empty gives `REQUIRED`. `!isValidDate` gives `DATE_INVALID`. `asOf > ctx.today` (ISO string compare) gives `AS_OF_IN_FUTURE`.
   - `AssetInput = { type: 'cash' | 'other'; name: string; value: number; asOf: string }`. This is structurally equal to the db `Omit<Asset,'id'>`.
   - `assetToFormValues(a: AssetInput): AssetFormRaw` uses `String(a.value)`.
   - Core reads no clock.
3. **DB.** Add `getAsset` mirroring `getTransaction`, and export it.
4. **Handlers (`server/assets/handlers.ts`).**
   - Reuse `FormState`, `message`, `fieldErrors` and `failForm` exported from `../transactions/handlers`.
   - `readAssetForm(fd)` reads the 4 strings.
   - `handleCreateAsset(db, fd, today)` and `handleUpdateAsset(db, id, fd, today)` work in this order:
     1. Read the values.
     2. If the id is present and `!isUuid(id)`, return `failForm(values, 'ASSET_NOT_FOUND')`.
     3. Validate. If not ok, return the field errors with no repo call.
     4. Call `createAsset` or `updateAsset`, then return `{ok:true}`.
   - `handleDeleteAsset(db, id)`: `!isUuid` gives ASSET_NOT_FOUND. Otherwise call `deleteAsset` (a hard delete).
   - Error handling in all handlers: a caught `DataError` with code NOT_FOUND gives ASSET_NOT_FOUND. Any other DataError gives SAVE_FAILED. Anything else is rethrown.
   - Add a comment that `requireUser()` goes here when R6 is restored.
5. **Actions (`app/(app)/assets/actions.ts`).** Copy the transactions pattern. `done()` calls `revalidatePath('/assets')`, `revalidatePath('/')` and `redirect('/assets')`. `today` comes from `todayVn()`.
6. **Pages.**
   - All pages are server components, and the list and new pages are `force-dynamic`.
   - Edit and delete follow `transactions/[id]/edit|delete/page.tsx` exactly: `isUuid` → `notFound()`, and `getAsset(...).catch(NOT_FOUND → notFound())`.
   - The list uses `listAssets` order unchanged (as_of desc, id).
7. **Components (R1: format only).**
   - **`AssetList`:**
     - Desktop table columns: Tên | Loại | Giá trị (right, `num`, `MoneyText`) | Cập nhật (`formatDate`) | actions.
     - Card: name (bold, `break-words`) with the type badge on the right. Below that, the value (`MoneyText`) and "Cập nhật dd/mm/yyyy" in muted text, then `RowActions` (`min-h-11`).
     - No total row.
   - **`AssetForm`:**
     - Controlled `<select name="type">` with Tiền mặt / Khác.
     - `TextField name="name" label="Tên"`.
     - `TextField name="value" label="Giá trị (₫)" inputMode="numeric"` with help "Số nguyên đồng, có thể dùng dấu chấm, ví dụ 50.000.000".
     - `TextField name="asOf" type="date" label="Ngày cập nhật" max={today}`.
     - A `FormBanner`, then submit and Hủy (→ `/assets`).
   - **`PortfolioSummary`:** add a `<Link href="/assets" className="inline-flex min-h-11 items-center text-sm underline">Quản lý tiền mặt & tài sản khác</Link>` after the grid. It is always rendered, so asset-only users can find it.
8. **Rules check.**
   - R1: validation, parsing and sums are in core; the UI only formats.
   - R2: BigInt parse with a 10^14 cap, stored as an integer.
   - R3: `getDb` and repos are used only in server code and actions.
   - R5: not applicable. The cap is a sanity bound, not a market rule.
   - R6: waived, with a comment only.
   - R7: no nav item, no duplicate warning, no staleness hint, no total on `/assets`.
   - R8: tests listed above.

## Specialist input used
- **finance-investment-researcher**
  - Adopted:
    - The `validateAssetInput(raw, {today})` shape, with all errors reported together.
    - Name normalisation with a 100-code-point limit enforced in core only (no migration).
    - The `ASSET_VALUE_MAX = 10^14` cap in `rules.ts`, plus the overflow regression test.
    - Rejecting future as-of dates.
    - Allowing duplicate names.
    - Hard delete and full overwrite on edit.
    - `revalidatePath('/assets')` and `('/')`.
    - `isUuid` before any DB call.
    - `getAsset`.
    - The test list.
  - Adapted: "today+1 → DATE_IN_FUTURE" becomes the new code `AS_OF_IN_FUTURE`, because the existing message says "Ngày giao dịch".
  - Deferred to follow-ups:
    - The duplicate-name warning.
    - A staleness hint for an old `as_of`.
    - Liabilities and margin.
- **data-visualization-engineer**
  - Adopted:
    - The list layout (columns, card, `break-words`, 44px actions).
    - The value input with no live formatting and the hint text.
    - `todayVn()` as the default on add, with the stored date kept on edit.
    - The dashboard text link inside `PortfolioSummary`, not a whole-card link.
    - The empty-state copy.
    - No 6th nav item.
    - The component tests, and the "0 ₫ not —" check.
  - Rejected:
    - `max: Number.MAX_SAFE_INTEGER`: the finance overflow finding wins, so the cap is 10^14.
    - Extending the `no-calc-in-ui` file list: it already scans `components/` and `app/` recursively.
    - Sorting by value or name in the handler: it is not in the AC, so the existing repo order (as_of desc) is kept (R7).
    - The `autoComplete` attribute: `TextField` has no such prop, and adding one grows the diff.

## Assumptions
1. **Value cap:** 10^14 VND per row (`ASSET_VALUE_MAX`). This keeps about 90 maximum-size rows plus holdings under `Number.MAX_SAFE_INTEGER`, so `addVnd` cannot throw on the dashboard.
2. **Name limit:** 100 Unicode code points, after NFC, trim and whitespace collapse. It is enforced in core only, with no DB constraint.
3. **Future as-of dates are rejected,** using the VN date from `todayVn()`. There is no lower bound.
4. **Add-form defaults:** type `cash` and as-of = today (VN). Edit prefills the stored date and does not auto-bump it.
5. **Duplicate names are allowed** with no warning (follow-up).
6. **List order** is the existing `listAssets` order: as_of descending, then id. There is no total on `/assets`; the dashboard shows the sums from core.
7. **Not-found handling:**
   - Pages: non-UUID or unknown ids give `notFound()` (404).
   - Handlers: they return formError code `ASSET_NOT_FOUND`. This is the asset-specific NOT_FOUND code, mapped from `DataError` NOT_FOUND. A separate code is used because the shared `NOT_FOUND` text says "giao dịch".
8. **Navigation:** there is no nav item. `/assets` is reached from the dashboard link, and no nav item is highlighted on `/assets`.
9. **UI labels:**
   - Page title: "Tiền mặt & tài sản khác".
   - Add and edit titles: "Thêm tài sản" and "Sửa tài sản".
   - Type labels: "Tiền mặt" and "Khác".
   - Date label: "Ngày cập nhật".
   - Delete confirm button: "Xóa".
10. **Edit and delete are a hard overwrite or delete** with no history, consistent with the "current balance" semantics in the STK-009 plan, assumption 5.
11. **Size:** about 700–800 changed lines, more than half of them tests and page boilerplate copied from STK-008. It is one spec feature and already the split-off slice, so it is not split further.

## Blocking questions
None.

## Split proposal
None. This ticket is already slice 2 of STK-009.

**Follow-ups (not in this diff):**
- A duplicate-name ("possible double-count") warning.
- A staleness hint for an old `as_of`.
- A liabilities/margin asset type.
- An optional `cancelHref` prop to unify `DeleteTransactionForm` and `DeleteAssetForm`.
