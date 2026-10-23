# consult-data-visualization-engineer — STK-008

## Findings

**Existing code (read-only review)**
- `/transactions` is a placeholder (`apps/web/app/(app)/transactions/page.tsx`, just `EmptyState`). The shell and small components from STK-007 exist (`EmptyState`, `MoneyText`, `PriceChange`, `SymbolLink`, `StatCard`, `LotStatusBadge`). There is **no shadcn, no Radix, no form or UI-primitive library**. `apps/web/package.json` has only next, react, tailwind 4 and lucide-react.
- The repos (`packages/db/src/repos/transactions.ts`) have **no filter, pagination or count support**. `listTransactions` accepts only `{symbol}`, fetches everything via `fetchAll`, and sorts ascending by date then seq. Create, update and delete exist, and update never changes source. There is no `listTransactionsPage`.
- The core `Transaction` type has **no `source` field** (it exists only in the row and insert mapper), but Prompt 2 asks for a "Nguồn" column and a source filter.
- Core `CorporateAction` supports only `cash_dividend` and `stock_dividend`, with no rights issue. `exDate` is the key date; the repo takes `recordDate` as optional meta. There is no description field. Prompt 2 asks for "Quyền mua", "Ngày chốt", "Mô tả" and "Đã áp dụng". The corporate-action form is therefore partly un-implementable without a core or schema change.
- `LedgerSettings` has **no lot size and no odd-lot concept**. AC4 requires "multiple of the configured lot size (R5)", so core needs a config home for it (see Recommendations).
- Core has `buildLedger` (returns `OVERSELL` with `requested` and `sellable`), `estimateFees`, and `formatPrice` (125400 -> "125,40"). It has **no parser** for user input.
- `apps/web/test/no-calc-in-ui.test.ts` scans every `.tsx` in `components/` and `app/`. It bans `parseInt`, `parseFloat`, `Math.`, `.toFixed(`, `/ 1000`, `* 100`, `new Date(` and `reduce(`. A thousand-VND input parser or a "today" default **cannot live in a `.tsx` file**.
- `getDb()` in `apps/web/server/db.ts` is the only web entry into the data layer. R6 is suspended, so the AC wording "call the auth helper" and "reject-without-auth" tests are waived. Keep `getDb()` calls inside the server action and loader so `requireUser()` is one line later.

## Recommendations

**1. List layout (AC1; design brief Prompt 2)**
- Use one server component that renders **both** a semantic `<table>` (`hidden md:table`) and a card list (`md:hidden`) from the same row view-models. Do not rely on horizontal scroll at 375px: nine columns is unreadable.
- Card layout: line 1 is the symbol (`SymbolLink`) and a Mua/Bán badge on the right; line 2 is the date, quantity x price (`formatPrice`, labeled "nghìn ₫") and the total; line 3 is fee and tax in muted text; Sửa and Xóa are icon buttons with 44px tap targets.
- The Mua/Bán badge must carry text, not only color. Reuse the existing tone helpers. Buy and sell use text plus a green or red tint, which also holds under CVD.
- Right-align numeric columns and use tabular-nums.
- Show the total value and the fee/tax actually used. Take both from core (a `describeTransaction` or `ledger-row` helper) so the page does not multiply quantity by price (R1). If fee is absent, show the estimate marked "ước tính".
- Tabs "Giao dịch" and "Sự kiện quyền": use a URL param `?tab=ca` with plain links styled as tabs. This avoids a client tab component and makes tabs deep-linkable.
- Default sort is **newest first**. The repo currently returns ascending, so the new paged query needs `ascending: false` for the page. Use `trade_date desc, seq desc` as a stable total order.

**2. Filters and pagination via URL (AC1)**
- Use a plain `<form method="get">` with a Lọc button. It needs no client JS, works server-side, and is shareable. Fields are `symbol`, `side` (all/buy/sell), `from`, `to`, `page`, and `tab`. `source` is optional (see Open questions).
- Parse and validate `searchParams` in one pure function in `packages/core` or `apps/web/lib` (not `.tsx`). The `searchParams` promise must be awaited in Next 16. Uppercase and trim `symbol` using the existing `symbol.ts`. Whitelist `side`. Validate dates as `YYYY-MM-DD` and swap or reject `from > to`. Clamp `page` to an integer >= 1 and use a fixed page size (e.g. 20).
- Add a `listTransactionsPage(db, {symbol?, side?, from?, to?, limit, offset})` to `packages/db` returning `{rows, total}`. Use `select(COLS, {count:'exact'})` and `.range()`, with filters pushed to SQL. Do **not** reuse `fetchAll`-then-slice. Add a fake-client test. This is a db-repo change; flag it to the planner as in scope because AC1 needs it.
- Pagination UI: Trước and Sau links plus "Trang X / Y (N giao dịch)". Compute the page count in a core or lib helper, not in the component.
- An out-of-range page should redirect to the last page or show the empty state with a reset link. The no-results state should be the existing `EmptyState` with "Xóa bộ lọc".
- Symbol filter: a text input with `<datalist>` of held or known symbols is enough. Skip a combobox.

**3. Add/edit form: sheet vs dialog vs page, and shadcn**
- Recommended: **a separate route pair, `/transactions/new` and `/transactions/[id]/edit`**, with a normal server-rendered form using `useActionState`. On 375px phones a full page beats a sheet or dialog. The numeric keyboard, validation messages and back navigation all work, and it needs no focus-trap or portal dependency. Redirect back to `/transactions?...` (preserving the filters) on success.
- The brief says "Sheet form". If Ming wants it literally, use Next intercepting and parallel routes, or defer the sheet to a polish ticket. The route form stays as the no-JS fallback either way.
- **shadcn: do not add it just for this ticket.** It brings the Radix dependencies and `components.json`. It also needs a `cn`/clsx/tailwind-merge setup and Tailwind 4 theme token wiring that STK-007 has not made. The ticket's plan does not include it, and the stack must not change without Ming (R7). The only things needing Radix are AlertDialog and Sheet.
- Delete confirmation without a library: the native `<dialog>` element. Put a small client component `ConfirmDelete` (dialog `showModal()`, a Hủy button and a destructive "Xóa" submit) around a server action form. It is focus-trapped by the browser, Esc closes it, and it works at 375px. Alternatively use a no-JS confirmation page `/transactions/[id]/delete`, which is the cheapest. If Ming wants the shadcn look later, swap in AlertDialog in a dedicated "add shadcn" ticket. Put the confirmation behind a small component with a stable prop interface so the swap is local.
- Delete text should name the record: "Xóa giao dịch Bán 200 FPT ngày 12/10/2026?" and note that holdings and P&L will be recalculated (this is the real consequence). Disable the submit button while pending.
- A delete or edit can make later sells oversell. The server action must re-run core validation (see 5) on the whole resulting ledger, not only the edited row.

**4. Money and price entry (R1, R2)**
- Price input: the field is in **nghìn đồng**, matching `formatPrice` and what TCBS shows. A user types "125,4" or "125.4" and it is stored as 125400. Label: "Giá (nghìn ₫)", `inputmode="decimal"`, with a live helper line from the server value "= 125.400 ₫/cp".
- Put `parsePriceInput(text): {ok, vnd} | {ok:false, message}` and `parseVndInput(text)` (for fee and tax, plain VND with "." grouping) in `packages/core` next to `format.ts`, using string and BigInt only, no floats. Rules: accept "," or "." as the decimal separator for price (at most 2 decimals, since the price tick is 10 VND), reject ambiguous grouping, reject empty, negative or non-numeric input, and return a safe integer. The Vietnamese convention is "." for thousands, so "125.400" in the price field is ambiguous. Resolve it by treating the price field as thousand VND with a decimal point only up to 2 digits after it, and give a clear error otherwise. Unit-test the edge cases (`125,4`, `125.40`, `125.400`, `1.250,5`, ` `, `1e3`, `-5`, `0`).
- Fee and tax are optional. Blank means "use estimate" (the type allows `fee?`). Show the estimate as placeholder text computed server-side by `estimateFees`. This is a nice way to avoid R1 violations: for the form, either fetch the estimate through a server action/route when quantity, price and side change, or show it after the first submit. A simpler MVP is a static hint "Để trống để dùng phí ước tính theo cài đặt".
- Quantity: integer, `inputmode="numeric"`, parse in core. No parse in `.tsx` (the R1 test bans `parseInt`). Put the form-data-to-input mapping in a server-only `lib/` module (`.ts`), not `.tsx`.
- Date: `<input type="date">` posts `YYYY-MM-DD` natively, so no Date math in components. The default value "today in VN time" must come from the server (a `todayVn()` helper in core or server code, because `new Date(` is banned in tsx). Reject future dates in core validation (check this with the planner).
- Echo the submitted raw text back on error so the user does not lose input. Return `values` in the action state, as strings.

**5. Core validation and Vietnamese errors (AC4)**
- Add `validateTransactionInput(input, ctx)` to `packages/core`. It returns `{ok:true, value} | {ok:false, errors: Record<field, {code, message}>}`. It should be field-keyed, so the form can show each message next to its input, plus a form-level error. Do not throw.
- Messages live in **core**, in one `messages.vi.ts` keyed by error code, with the codes staying stable and English so tests assert on codes, not strings. Examples: `PRICE_NOT_POSITIVE` "Giá phải lớn hơn 0"; `QTY_NOT_LOT` "Khối lượng phải là bội số của 100 (lô chẵn). Chọn 'Lô lẻ' nếu bạn mua/bán lô lẻ"; `QTY_NOT_POSITIVE`; `SYMBOL_INVALID`; `DATE_INVALID`; `OVERSELL` "Chỉ có thể bán tối đa {sellable} cổ phiếu {symbol} tại ngày này (bạn nhập {requested})"; `FEE_INVALID`.
- Odd lot: add an explicit `oddLot: boolean` checkbox on the form. Lot size must come from config (R5): add `lotSize` (default 100) to the market-settings defaults, and thread it as a parameter into the validator. It need not be a DB column in this ticket if the planner wants to avoid a migration. Core's constant plus a parameter, with a note in follow-ups, is acceptable. Odd-lot rules (quantity < lot size, only for sells, etc.) need Ming/finance input (see Open questions).
- Sell check: build the ledger with the candidate transaction in place of (or added to) the existing list and call the existing `buildLedger`. Map `OVERSELL.requested` and `.sellable` into the message. For edits, replace by id; for deletes, run the same check and block it with a message like "Không thể xóa: các lệnh bán sau đó sẽ vượt số lượng có thể bán". This reuses T+2 and the lot logic, so the UI never computes sellable quantity. It does mean loading all transactions and corporate actions per write (`loadLedger` already does that, at personal scale this is fine).
- Add a "sell on the same date as the buy" case to the tests. T+2 means a sell before sellableFrom is an oversell; the message should say so ("còn x cổ phiếu chưa về, sẽ bán được từ dd/mm/yyyy" if cheap to include, since `Lot.sellableFrom` exists).
- Server action returns a typed state `{ok:true} | {ok:false, fieldErrors, formError, values}`. Map `DataError` (NOT_FOUND, NOT_CONFIGURED for the missing fee rate) to Vietnamese form-level messages too. A missing fee rate is likely on a fresh DB, so point to /settings.
- Never trust the client: re-parse and re-validate the raw FormData in the action. Do not accept a pre-validated payload.

**6. Corporate actions (AC3)**
- Cash dividend and stock dividend map to existing core types. Rights issue is not in core, and adding it changes cost-basis logic (a finance and core ticket), so I recommend **splitting it out** or recording it as "chưa hỗ trợ tính giá vốn" and not accepting it in this ticket. Raise it with the planner and Ming (see Open questions); the AC says all three, but core cannot adjust the cost for it.
- Form fields from the types: Mã, Loại, Ngày GDKHQ (ex-date), Ngày chốt (optional record date, as repo meta), Ngày thanh toán (cash) or Ngày niêm yết (stock), Số tiền/cp (VND, integer) or Tỷ lệ (held:received). Ratio input like "100:20" parsed in core. The "Mô tả" and "Đã áp dụng" columns have no backing fields, so derive the description from the type and values in core (e.g. "Cổ tức tiền 1.000 ₫/cp") and drop "Đã áp dụng" or compute it (ex-date <= today) in core. Flag this.
- Reuse the same route-page form pattern (`/transactions/actions/new`) and the same validation approach. Provide only add (as the AC says), with delete deferred unless it is cheap.

**7. Cheap tests (AC6, R8)**
- Core (Vitest, pure): `validateTransactionInput` (each error code, lot multiples, odd lot, price <= 0, integer overflow), `parsePriceInput` and `parseVndInput` table tests, `parseListQuery` (search param whitelist and clamping), the page-count helper, and the Vietnamese message map covering every error code (a completeness test: every code has a non-empty message).
- Oversell via `buildLedger`: sell more than sellable, sell within T+2, an edit that creates an oversell, and a delete that makes a later sell oversell.
- Server actions: call the exported action function directly with FormData and the existing fake db client (`packages/db/test/fake-client.ts`). Assert (a) invalid input returns field errors and the fake client received **no** insert, (b) valid input inserts integer VND (125,4 becomes 125400), (c) NOT_FOUND on edit and delete. Skip reject-without-auth while R6 is suspended, and note it in the impl-log as waived.
- db repo: `listTransactionsPage` filter and range assertions on the fake client.
- UI: one `renderToString` test of the row component with a buy and a sell (badge text present, no crash), and the existing `no-calc-in-ui` test must stay green. No Playwright yet.
- Verify the 375px layout manually (or one check that both the table and card markup render). That is a manual step for the reviewer; add it to the review checklist.

## Risks
- **R1 drift**: the biggest risk is a component multiplying quantity x price, parsing numbers or computing "today" in tsx. The existing guard test will catch the obvious cases. Keep every parsing and totalling helper in core or in non-tsx server modules.
- **Price unit confusion**: entering 125,4 as thousand VND versus 125400 as VND. A wrong unit is a 1000x error on real money. Mitigate with the unit in the label, the live "= 125.400 ₫" echo, and rejecting prices implausibly low or high relative to the exchange price limits if reference data exists (optional).
- **Edit and delete cascade**: they can invalidate later sells. If validation only checks the edited row, the ledger could become unbuildable, and `loadLedger` then errors for the dashboard. Validate the full resulting ledger.
- **Non-atomic validate-then-write**: validating against a loaded ledger and then inserting leaves a race window (negligible for a single user). Note it, do not engineer around it.
- **Scope creep**: adding shadcn, rights issue cost-basis logic, a lot-size DB column or source filter would each stretch the ticket (R7). Record them as follow-ups.
- **Spec gaps in the brief**: "Nguồn", "Mô tả", "Đã áp dụng" and rights issue are in the design brief but not in core types. Without a decision, the implementer may invent fields.
- Page size and the unbounded `listTransactions` used by `loadLedger` are fine at personal scale (hundreds to low thousands of rows). Revisit if imports (STK-0xx) bring in many rows.
- `<dialog>` and `useActionState` are fine on current browsers; the form must still work with JS disabled for the plain submit path. Server action inputs are public endpoints even without auth, so validation must be complete.

## Open questions
1. Rights issue (quyền mua): do we accept it in this ticket with no cost-basis effect, split it into a finance and core ticket, or implement the cost adjustment now? The AC lists it, but `CorporateAction` in core has no such type.
2. Odd-lot rules: should the odd-lot checkbox be allowed on both buy and sell? Is odd-lot quantity restricted to 1..99? Does the lot size come from a constant in core settings defaults (no migration) or a new settings column?
3. Is a source filter ("Nhập tay"/"Sao kê") and "Nguồn" column wanted now? It needs `source` added to the core `Transaction` view (a small mapper change). The import screen (STK-0xx) is where `source=import` first appears; a column showing only "Nhập tay" is noise until then.
4. Form presentation: is a full-page form acceptable instead of the brief's Sheet? If a Sheet is mandatory, should shadcn be added in a separate ticket first? My advice is to ship pages and native `<dialog>` now.
5. Price input unit: confirm thousand-VND input (125,4 means 125.400 ₫) for price, with fee and tax in plain VND. Should the form default the fee and tax to the settings estimate, or leave them blank meaning "estimate"?
6. Should future-dated transactions be rejected? Should the same-day sell-after-buy produce the T+2 hint message?
7. "Đã áp dụng" badge and "Mô tả" for corporate actions: derive them in core (ex-date <= today), or drop these columns until a data model exists?
8. Corporate action edit and delete: required now, or add-only as the AC states?
