# consult-data-visualization-engineer — STK-030

STK-030 consult (UI). Read-only; I read the ticket, nav.ts, portfolio-summary.tsx, transaction-list.tsx, the dashboard page, clock.ts and parse-input.ts.

**Findings**
- `parseVndInput` does NOT exist in core. The only parser is `parseIntegerInput(text, {max})` in `packages/core/src/entry/parse-input.ts`, exported from the core index. It accepts "125400" or "125.400" (dot = thousands), and returns REQUIRED / NOT_INTEGER / TOO_LARGE. It already enforces ≥0, because there is no sign in the regex, and it uses BigInt, so it is R2-safe. `validateAssetInput` should call it with `max: Number.MAX_SAFE_INTEGER`, as fee and tax do in validate-transaction.ts.
- The input is a plain text field and the parser takes the raw string. Nothing re-groups digits as you type.
- `todayVn()` in `apps/web/server/clock.ts` is the single server clock. `transactions/new/page.tsx` calls it and passes it to the form as the default date.
- The dashboard already shows "Tiền mặt + tài sản khác" in `PortfolioSummary`, with a sub-line giving cash and other. It has no link to /assets. The dashboard page has an empty state for no transactions and links only to /transactions.
- `NAV_ITEMS` has 5 entries: Tổng quan, Giao dịch, Nhập, Theo dõi, Cài đặt. `nav.test.ts` exists.
- The transaction list uses `hidden md:table` for the table, `md:hidden` `<ul>` cards, `EmptyState` with an action link, and a `RowActions` component whose links are `min-h-11`.

**Recommendations**
1. List layout.
   - Copy the `TransactionList` structure into `components/assets/asset-list.tsx`.
   - Desktop columns are Tên | Loại | Giá trị (right-aligned, `num`) | Cập nhật (`formatDate`) | actions.
   - A phone card has line 1 as name (bold) with a type badge on the right (Tiền mặt / Khác), and line 2 as value (`MoneyText`, larger) with "Cập nhật dd/mm/yyyy" in muted text. Row actions go at the bottom, with Sửa/Xóa keeping the 44px tap height.
   - Use `break-words` on the name so long account names don't overflow at 375px.
   - Sort by value descending, or by name. Do it in the handler or repo, not in the component.
   - Add a footer total only if core already supplies it. Showing the sum on /assets duplicates the dashboard and could break R1 if computed in the UI. Safest is to skip it, or to show `totals.cash` and `totals.otherAssets` from a core function.
2. Value input.
   - Use `inputMode="numeric"` and `autoComplete="off"`.
   - Label it "Giá trị (₫)", with hint text "Số nguyên, có thể dùng dấu chấm, ví dụ 50.000.000".
   - Do not format while typing. This is the cheap choice, it matches STK-008, and it avoids caret bugs.
   - On edit, prefill with the raw integer string.
   - Keep the typed text on error, as the STK-008 forms do. Map the three parse codes to Vietnamese messages keyed by code. The ticket also needs a negative-value case, which in practice surfaces as NOT_INTEGER (the "-" character).
   - Put the Vietnamese messages in core, per the ticket.
3. As-of date.
   - The default on add is `todayVn()`, passed from the server page, as in transactions/new. Use `<input type="date">`.
   - On edit, prefill with the stored date and do not auto-bump it. If it should refresh on every value edit, that is a product decision (see Open questions).
   - Reject future dates in `validateAssetInput` only if you pass `today` in. Otherwise only validate the calendar date (core already has date validation for transactions, which you should reuse).
4. Dashboard link.
   - Add a text link "Quản lý tiền mặt & tài sản khác" (`underline`, `min-h-11 inline-flex items-center`) directly under the StatCard grid in `PortfolioSummary`, next to the existing notes. Alternatively, make it a StatCard footer link if StatCard supports one.
   - Do not wrap the whole card in a link.
   - Because it sits inside `PortfolioSummary`, it shows even with zero transactions. That matters, because an asset-only user would otherwise never find it.
   - If `nonStockAssets` is 0 and there are no assets, the link text could be "Thêm tiền mặt".
   - `PortfolioSummary` is a component test target, so add the link there and cover it in `portfolio.test.tsx`.
5. Empty state.
   - Use `EmptyState` with the title "Chưa có tiền mặt hoặc tài sản khác". The description is "Thêm số dư tiền mặt để tổng tài sản đầy đủ." The action is a link "Thêm tài sản" to `/assets/new`.
   - Also show a primary "Thêm" button or link in the page header when the list is non-empty.
6. Nav.
   - Do not add a sixth top-level item. If `nav-links.tsx` renders a mobile bottom bar, six items at 375px get cramped (shortLabel is already used, which suggests a tight bar).
   - Link /assets from the dashboard, and optionally from Cài đặt too.
   - `isNavActive` is prefix-based, so /assets won't highlight any item. That is acceptable. Alternatively, treat `/assets` as active for Tổng quan, but that adds special-casing to a tested function, so skip it.
   - If Ming does want a nav item, replace the label rather than append: "Tài sản" with the Wallet icon, and update `nav.test.ts`.
7. Cheap tests.
   - Core `validateAssetInput`: empty name, whitespace-only name, bad type, value "", "abc", "-1", "1.5", "1.000.000" accepted, "0" accepted, too large, bad date "2026-02-30", and valid input.
   - Handlers: invalid input means no repo write (spy on the mock), unknown or non-UUID id gives NOT_FOUND, create/update/delete happy path.
   - Component tests (`components.test.tsx` style): `AssetList` empty state renders the add link, rows render both the table and the cards (check that the name and formatted value appear), and edit/delete hrefs are `/assets/${id}/edit` and `/assets/${id}/delete`.
   - `PortfolioSummary` renders the /assets link.
   - Extend the no-calc-in-ui test file list to cover `components/assets/*`.
   - Skip e2e.

**Risks**
- The ticket says to use `parseVndInput`, but it doesn't exist. Adding a new alias creates a second rounding and parsing path (R2). Use `parseIntegerInput` directly.
- Dot grouping is ambiguous for a decimal-comma user: "1,5" is rejected, which is correct, but the hint text must explain the accepted format.
- A footer sum or a "last updated" computation done in the component would violate R1.
- A sixth nav item would crowd the mobile bar.
- Value 0 is valid. Make sure `MoneyText` doesn't render it as "—", since that marker means null.

**Open questions**
- Should the as-of date auto-update to today when the value is edited? Default: no, prefill the stored date.
- Is a future as-of date allowed? Default: reject it.
- Is the asset name unique? The ticket doesn't say, so default to allowing duplicates.
- Should the list show a total? Default: no.
