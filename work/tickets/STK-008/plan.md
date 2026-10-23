Status: READY

# Plan: STK-008, Transactions ledger screen

## Spec summary
- docs/spec-v1.md §3 F1: "Manual entry per transaction: date, symbol, side (buy/sell), quantity, price, fee, tax." and "Corporate action entry: cash dividend, stock dividend, rights issue."
- docs/spec-v1.md §2.1: "All values below are **configuration, not hard-coded**" with "Board lot | 100 shares (odd lots handled separately)" and "Settlement | T+2: bought shares can be sold from T+2 | Never suggest selling a lot that is not yet sellable".
- CLAUDE.md R1 "No financial calculation in UI … sellable quantity … live in `packages/core` only", R2 "Money and prices are integers in VND", R5 "Market rules are configuration … lot size", R6 suspended (auth ACs waived, keep server-only data access), R7 stay in plan.
- Ticket AC5: "Money and prices are entered and stored as integer VND (R2)".

**Spec divergence, flagged for Ming:** this plan does **not** implement rights issue (quyền mua). See Assumptions A1 and follow-up F1.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Transaction list with filters (symbol, side, date range) and pagination, loaded server-side through the data layer | `packages/db/src/repos/transactions.test.ts` › `listTransactionsPage …` tests (filters pushed to SQL: `eq`/`gte`/`lte`, `range`, `count:'exact'`, order `trade_date desc, seq desc`). `apps/web/lib/transaction-list-query.test.ts` (param whitelist, clamping, from>to swap, page meta). `page.tsx` is an async server component that calls `listTransactionsPage(getDb(), …)`; there is no client fetch. Manual: `/transactions?symbol=fpt&side=sell&from=2026-01-01&to=2026-06-30&page=2` filters and pages. |
| 2 | Add / edit / delete transaction (date, symbol, side, quantity, price, fee, tax) via server actions. *The auth-helper part is waived (R6 suspended).* | `apps/web/server/transactions/handlers.test.ts`: valid create calls `createTransaction` with integer VND; valid update calls `updateTransaction(id, …)`; valid delete calls `deleteTransaction(id)`; NOT_FOUND on edit/delete returns a form error. `actions.ts` has `'use server'`, and every export goes through `getDb()` and a handler. Manual: the add, edit and delete pages work end to end. |
| 3 | Add corporate action via a server action: cash dividend and stock dividend. *Rights issue is deferred (A1, F1).* | `handlers.test.ts` › `createCorporateAction …` tests (valid cash and stock dividends inserted; invalid input means no insert; CONFLICT maps to "Đã có sự kiện này…"; a `rights_issue` post is rejected with `CA_TYPE_UNSUPPORTED`). Manual: `/transactions/corporate-actions/new` saves, and the row appears in the "Sự kiện quyền" section on `/transactions`. |
| 4 | Validation in core: price > 0; quantity a multiple of the configured lot size unless odd lot is chosen; a sell cannot exceed the core sellable quantity. Errors are shown in Vietnamese on the form. | `packages/core/src/entry/validate-transaction.test.ts`, `check-ledger-change.test.ts`, `messages-vi.test.ts` (every code has a non-empty Vietnamese message). `handlers.test.ts` asserts the field errors carry `code` and a Vietnamese `message`. Manual: submit price 0 / qty 150 / an oversell and see the messages next to the fields. |
| 5 | Money and prices entered and stored as integer VND (R2); no calculation in components (R1) | `parse-input.test.ts` (accepts `125400` and `125.400`, rejects `125,4`, `1e3`, `-5`, `12.34`). `handlers.test.ts` › "stores 125.400 as 125400". `apps/web/test/no-calc-in-ui.test.ts` stays green. Reviewer greps the new `.tsx` files: no arithmetic, no `Number(`, no parsing. |
| 6 | Unit tests for the new core validation; server action tests for reject-on-invalid. *Reject-without-auth is waived (R6).* | `pnpm test` is green. In `handlers.test.ts`, each invalid case asserts that `createTransaction`/`updateTransaction`/`deleteTransaction`/`createCorporateAction` was **not called**. The impl-log notes "reject-without-auth waived (R6 suspended)". |
| — | Checks (R8) | `pnpm typecheck && pnpm lint && pnpm test` are green. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/entry/rules.ts` | **new**. `TradingRules { lotSize }`, `DEFAULT_TRADING_RULES = { lotSize: 100 }`, `INT32_MAX`, `LOW_PRICE_CONFIRM_BELOW = 1000` | AC4, R5: the lot size is a config value passed as a parameter, not a literal in logic |
| `packages/core/src/entry/parse-input.ts` | **new**. `parseIntegerInput(text, { max })` returns `{ok:true,value}` or `{ok:false,code}` | AC5: string → integer VND without floats; components must not parse (R1) |
| `packages/core/src/entry/messages-vi.ts` | **new**. `EntryErrorCode` union, `entryMessage(code, params?)` returns a Vietnamese string | AC4: Vietnamese messages defined once in core |
| `packages/core/src/entry/validate-transaction.ts` | **new**. `validateTransactionInput(raw, ctx)`, `transactionToFormValues(tx, rules)` | AC4 |
| `packages/core/src/entry/check-ledger-change.ts` | **new**. `checkLedgerChange(...)`: whole-ledger replay through `buildLedger` | AC4: sellable check from core |
| `packages/core/src/entry/validate-corporate-action.ts` | **new**. `validateCorporateActionInput(raw)` | AC3 |
| `packages/core/src/entry/describe.ts` | **new**. `describeCorporateAction(action)`, e.g. "Cổ tức tiền 1.000 ₫/cp" or "Cổ tức cổ phiếu 100:20" | AC3: the list shows a description without logic in the component |
| `packages/core/src/calendar.ts` | add `vnDateOf(instant: Date): string` ('YYYY-MM-DD' in Asia/Ho_Chi_Minh) | "today" for the future-date check and the form default; `new Date(` is banned in tsx |
| `packages/core/src/index.ts` | export the new symbols | public API |
| `packages/core/src/entry/*.test.ts`, `packages/core/src/calendar.test.ts` | new tests (see Tests) | R8 |
| `packages/db/src/repos/transactions.ts` | add `listTransactionsPage(db, {symbol?, side?, from?, to?, limit, offset})` returning `{rows, total}`, and `getTransaction(db, id)` | AC1 (paged, filtered SQL query); the edit and delete pages load one row |
| `packages/db/src/repos/settings.ts` | add `getEntrySettings(db)` returning `{ settings: LedgerSettings; feeRateConfigured: boolean }`. It never throws NOT_CONFIGURED: a missing row gives `{...DEFAULT_MARKET_SETTINGS, feeRatePpm: 0}`, and a NULL fee gives the row mapped with `feeRatePpm: 0` | AC4: the oversell replay must work before STK-010 sets a fee rate |
| `packages/db/src/index.ts` | export `listTransactionsPage`, `getTransaction`, `getEntrySettings` | public API |
| `packages/db/test/fake-client.ts` | add `gte`, `lte` to METHODS; add optional `count` to `Res` | test the new paged query |
| `packages/db/src/repos/transactions.test.ts`, `packages/db/src/repos/settings.test.ts` | new tests | R8 |
| `apps/web/lib/transaction-list-query.ts` | **new**. `parseTransactionListQuery(searchParams)`, `pageMeta(total, page, pageSize)`, `listHref(query, overrides)` | AC1: URL parsing and page counts outside `.tsx` |
| `apps/web/lib/transaction-list-query.test.ts` | **new** | R8 |
| `apps/web/server/clock.ts` | **new**. `todayVn()` returns `vnDateOf(new Date())` | one server-side clock |
| `apps/web/server/transactions/handlers.ts` | **new**. `handleCreateTransaction(db, formData, today)`, `handleUpdateTransaction(db, id, formData, today)`, `handleDeleteTransaction(db, id, today)`, `handleCreateCorporateAction(db, formData)`, plus `FormState` types. FormData → raw strings → core → repo | AC2, AC3, AC4; testable without Next |
| `apps/web/server/transactions/handlers.test.ts` | **new** | AC6 |
| `apps/web/app/(app)/transactions/actions.ts` | **new**. `'use server'` wrappers: `createTransactionAction`, `updateTransactionAction`, `deleteTransactionAction`, `createCorporateActionAction`. Each calls `getDb()`, `todayVn()` and a handler; on `ok` it calls `revalidatePath('/transactions')` and `redirect('/transactions')` | AC2, AC3 (server actions); one entry point per action for a later `requireUser()` |
| `apps/web/app/(app)/transactions/page.tsx` | replace the placeholder: header buttons, filter form, list, pagination, "Sự kiện quyền" section | AC1, AC3 |
| `apps/web/app/(app)/transactions/new/page.tsx` | **new**. Add form page (passes `todayVn()` and `feeRateConfigured`) | AC2 |
| `apps/web/app/(app)/transactions/[id]/edit/page.tsx` | **new**. Edit form pre-filled from `transactionToFormValues`; calls `notFound()` on NOT_FOUND | AC2 |
| `apps/web/app/(app)/transactions/[id]/delete/page.tsx` | **new**. Confirmation page | AC2 |
| `apps/web/app/(app)/transactions/corporate-actions/new/page.tsx` | **new**. Corporate action form page | AC3 |
| `apps/web/components/transactions/transaction-form.tsx` | **new**. `'use client'`, `useActionState`, field errors, odd-lot and low-price-confirm checkboxes | AC2, AC4 |
| `apps/web/components/transactions/delete-transaction-form.tsx` | **new**. `'use client'`, `useActionState`, shows the form error when the delete would break a later sell | AC2, AC4 |
| `apps/web/components/transactions/corporate-action-form.tsx` | **new**. `'use client'`, `useActionState` | AC3 |
| `apps/web/components/transactions/transaction-list.tsx` | **new**. Table (`hidden md:table`) plus cards (`md:hidden`) from the same rows; formatting only | AC1 |
| `apps/web/components/transactions/transaction-filters.tsx` | **new**. `<form method="get">` | AC1 |
| `apps/web/components/transactions/pagination.tsx` | **new**. Trước/Sau links from `pageMeta` | AC1 |
| `apps/web/components/transactions/corporate-action-list.tsx` | **new**. Simple table with no filters | AC3 (observable result) |
| `apps/web/components/transactions/transactions.test.tsx` | **new**. `renderToStaticMarkup` tests | R8 |

No migration and no new dependency (no shadcn, no form library).

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `core/entry/parse-input.test.ts` › accepts `"125400"`, `"125.400"`, `" 1.250.000 "`, `"0"` | AC5 |
| › rejects `""`→`REQUIRED`, `"125,4"`, `"12.34"`, `"1.2345"`, `"1e3"`, `"-5"`, `"+5"`, `"abc"`, `"1 000"`→`NOT_INTEGER` | AC5 |
| › value > `max` → `TOO_LARGE`; above `Number.MAX_SAFE_INTEGER` → `TOO_LARGE` (string/BigInt compare, no float) | R2 |
| `core/entry/validate-transaction.test.ts` › valid buy returns typed `{tradeDate, symbol, side, quantity, price}`; blank fee and tax are omitted (stored NULL) | AC2 |
| › symbol `" fpt "` normalised to `FPT`; `"F"` → `SYMBOL_INVALID` | AC4 |
| › invalid date, and a date after `today` → `DATE_INVALID` / `DATE_IN_FUTURE` | AC4 |
| › side not buy/sell → `SIDE_INVALID` | AC4 |
| › price `0` → `PRICE_NOT_POSITIVE`; price > INT32_MAX → `TOO_LARGE` | AC4 |
| › price `500` without `confirmLowPrice` → `PRICE_LOW_UNCONFIRMED`; with `confirmLowPrice` → ok | AC5 (unit guard) |
| › qty `150`, lot 100, no odd lot → `QTY_NOT_LOT` (message contains "100"); with `oddLot` → ok; qty `115` with odd lot → ok | AC4 |
| › `lotSize: 10` rules: qty 50 ok (proves the parameter is used, R5) | AC4, R5 |
| › qty `0` → `QTY_NOT_POSITIVE`; qty > INT32_MAX → `TOO_LARGE` | AC4 |
| › fee `-1` / `"1,5"` → `NOT_INTEGER`; fee `0` ok | AC4 |
| › `feeRateConfigured:false`: blank fee → `FEE_REQUIRED_NO_RATE`; sell with blank tax → `TAX_REQUIRED_NO_RATE`; buy with blank tax → ok | AC4 |
| › returns **all** field errors at once (price 0 + qty 150 → two errors) | AC4 |
| › `transactionToFormValues`: qty 115 → `oddLot: true`; qty 200 → `false`; fee undefined → `""` | AC2 edit |
| `core/entry/check-ledger-change.test.ts` › add a sell within sellable → ok | AC4 |
| › add a sell above sellable → `OVERSELL` with `onChange: true`, plus `requested`, `sellable`, `date` | AC4 |
| › add a sell on T+1 after a buy (T+2 pending) → `OVERSELL` with sellable 0 | AC4 T+2 |
| › partial sells across multiple lots: buy 100 (D1) + buy 200 (D2), sell 250 after both settle → ok; sell 301 → OVERSELL | AC4 |
| › stock dividend lot counts once sellable (listingDate), and not before | AC4 |
| › edit: lowering a buy's quantity below a later sell → `OVERSELL` with `onChange: false`, naming the later sell | AC4 |
| › edit: moving a buy's date later so a sell falls before its T+2 → OVERSELL on the other tx | AC4 |
| › delete: deleting a buy that funds a later sell → OVERSELL with `onChange: false`; deleting the sell itself → ok | AC4 |
| › edit replaces by id and keeps seq; add gets seq = max+1 | correctness |
| › current ledger already invalid (oversell at sell S): deleting S → ok; a change that creates an **earlier** oversell → rejected; an unrelated later change → ok | escape hatch |
| › works with `feeRatePpm: 0` settings (fee not configured) | AC4 |
| › replay `asOf` = max(today, latest date in candidate): a future-dated existing sell is still checked | AC4 |
| `core/entry/validate-corporate-action.test.ts` › valid cash dividend (`amountPerShare` integer > 0, optional payDate ≥ exDate) | AC3 |
| › cash `amountPerShare` 0 → `AMOUNT_NOT_POSITIVE`; `"1,5"` → `NOT_INTEGER` | AC3 |
| › valid stock dividend (held/received integers > 0, optional listingDate ≥ exDate); held 0 → `RATIO_NOT_POSITIVE` | AC3 |
| › payDate/listingDate before exDate → `DATE_BEFORE_EX` | AC3 |
| › `type: 'rights_issue'` or unknown → `CA_TYPE_UNSUPPORTED` | AC3 deferral |
| `core/entry/describe.test.ts` › cash → "Cổ tức tiền 1.000 ₫/cp"; stock → "Cổ tức cổ phiếu 100:20" | AC3 |
| `core/entry/messages-vi.test.ts` › every `EntryErrorCode` has a non-empty message; OVERSELL messages interpolate formatted qty and DD/MM/YYYY date | AC4 |
| `core/calendar.test.ts` › `vnDateOf(new Date('2026-10-22T17:30:00Z'))` → `'2026-10-23'`; `'2026-10-22T16:59:00Z'` → `'2026-10-22'` | today in VN |
| `db/repos/transactions.test.ts` › `listTransactionsPage` with all filters: `eq('symbol')`, `eq('side')`, `gte('trade_date')`, `lte('trade_date')`, `range(20,39)`, select has `{count:'exact'}`, order desc/desc; returns `{rows, total}` | AC1 |
| › no filters: no `eq`/`gte`/`lte` calls; `count: null` → total 0 | AC1 |
| › `getTransaction` NOT_FOUND on null | AC2 |
| `db/repos/settings.test.ts` › `getEntrySettings`: fee NULL → `feeRateConfigured:false, feeRatePpm:0`, stored settlementDays/holidays kept; row missing → defaults, false; fee set → true | AC4 |
| `web/lib/transaction-list-query.test.ts` › whitelists side; normalises symbol, and an invalid symbol is dropped and reported; invalid dates dropped; from>to swapped; page clamped ≥1, non-numeric → 1; `pageMeta(45,3,20)` → `{pageCount:3, hasPrev, !hasNext}`; `pageMeta(0,1,20)` → pageCount 1; `listHref` keeps filters | AC1 |
| `web/server/transactions/handlers.test.ts` (mocks `@stoktok/db` repo functions with `vi.fn`, plus `vi.mock('server-only', () => ({}))` if imported) › create with price `"125.400"` qty `"100"` calls `createTransaction` with `price: 125400` and `source:'manual'` | AC2, AC5 |
| › create invalid (price 0, qty 150) returns `fieldErrors.price.code==='PRICE_NOT_POSITIVE'`, `fieldErrors.quantity.code==='QTY_NOT_LOT'`, Vietnamese messages, `values` echoed; `createTransaction` **not called** | AC4, AC6 |
| › create oversell → `fieldErrors.quantity.code==='OVERSELL_SELF'`; no insert | AC4, AC6 |
| › update that breaks a later sell → `formError.code==='OVERSELL_OTHER'`; `updateTransaction` not called | AC4, AC6 |
| › update unknown id → `formError NOT_FOUND`; no write | AC2 |
| › delete that breaks a later sell → `formError OVERSELL_OTHER`; `deleteTransaction` not called; valid delete → called with id | AC2, AC6 |
| › fee not configured (`getEntrySettings` returns false) + blank fee → `FEE_REQUIRED_NO_RATE`; no insert | AC4 |
| › create corporate action valid cash → `createCorporateAction` called with `amountPerShare` integer; invalid → not called; repo throws `DataError('CONFLICT')` → `formError CA_DUPLICATE` | AC3, AC6 |
| › repo throws `DataError('DB_ERROR')` → `formError SAVE_FAILED` (no raw error text leaked) | robustness |
| `web/components/transactions/transactions.test.tsx` › list renders a buy and a sell: "Mua"/"Bán" text badges, `formatPrice` output, "Ước tính" when fee is undefined, both table and card markup present | AC1 |
| › empty list renders `EmptyState` with "Xóa bộ lọc" link | AC1 |
| › transaction form renders field error messages from a given state (export the inner presentational part or render with an initial state) | AC4 |
| `web/test/no-calc-in-ui.test.ts` (existing) stays green | R1 |

## Approach
1. **Core config (R5).** `entry/rules.ts`: `DEFAULT_TRADING_RULES = { lotSize: 100 }`. Every validator takes `rules: TradingRules` as a parameter; nothing reads the constant directly except the web handler, which passes it. (STK-010 will later source it from `settings.rule_configs`, see F3.)
2. **Core parsing (R2).** `parseIntegerInput` trims, then accepts `^\d+$` or `^\d{1,3}(\.\d{3})+$` (Vietnamese thousand grouping), strips dots, and compares against `max` as a BigInt/string before converting. No floats and no `parseInt` on unvalidated text. Anything else returns `NOT_INTEGER`, whose message tells the user to enter whole đồng ("ví dụ 125400 hoặc 125.400").
3. **Core transaction validator.** `validateTransactionInput(raw: TransactionFormRaw, ctx: { rules, today, feeRateConfigured })`. `raw` is all strings or booleans: `tradeDate, symbol, side, quantity, price, fee, tax, oddLot, confirmLowPrice`. It returns `{ ok: true; value: Omit<Transaction,'id'|'seq'> } | { ok: false; errors: Partial<Record<Field, EntryError>> }`, where `EntryError = { code, params? }`. It collects all field errors and never throws. Rules: `normalizeSymbol`; `isValidDate` and `tradeDate <= today`; side whitelist; quantity integer, > 0, ≤ INT32_MAX, `% lotSize === 0` unless `oddLot`; price integer, > 0, ≤ INT32_MAX, and `< 1000` needs `confirmLowPrice`; fee and tax blank → omitted, else integer ≥ 0 within the safe range; if `!feeRateConfigured`, fee is required, and tax is required on sells. `transactionToFormValues(tx, rules)` gives the strings back for edit, with `oddLot = quantity % lotSize !== 0`.
4. **Core sellable check.** `checkLedgerChange({ transactions, actions, settings, today, change })` with `change = { kind:'add', input } | { kind:'edit', id, input } | { kind:'delete', id }`. It builds the candidate list (add: id `'__new__'`, seq = max+1; edit: replace by id, keep seq; delete: filter), sets `asOf = max(today, latest tradeDate/exDate)`, and calls the existing `buildLedger`. If ok, it returns ok. On `OVERSELL`, it also replays the current list. If the current list fails too, the change is allowed when the candidate's error is on the same transaction or on a later date than the current error. Otherwise it returns `{ ok:false, error: { code: onChange ? 'OVERSELL_SELF' : 'OVERSELL_OTHER', symbol, date, requested, sellable } }`, where `onChange` means `transactionId` is the changed or new id. An `INVALID_INPUT` from `buildLedger` comes back as `LEDGER_INVALID`. This puts T+2, lots and stock-dividend listing dates in one place (R1).
5. **Core corporate actions.** `validateCorporateActionInput(raw)`. `type` must be `cash_dividend` or `stock_dividend`; anything else, including `rights_issue`, gives `CA_TYPE_UNSUPPORTED`. Then symbol, `exDate` valid (future allowed, since announced ex-dates are entered ahead), cash `amountPerShare` integer > 0 with optional `payDate ≥ exDate`, and stock `held`/`received` integers > 0 with optional `listingDate ≥ exDate`. No replay is needed on **add**, because adding a dividend cannot reduce sellable quantity. `describeCorporateAction` uses `formatVnd`.
6. **Core messages.** `messages-vi.ts` maps each `EntryErrorCode` to Vietnamese. Codes are English and stable, and tests assert codes. Codes: `REQUIRED, NOT_INTEGER, TOO_LARGE, SYMBOL_INVALID, DATE_INVALID, DATE_IN_FUTURE, SIDE_INVALID, PRICE_NOT_POSITIVE, PRICE_LOW_UNCONFIRMED, QTY_NOT_POSITIVE, QTY_NOT_LOT, FEE_REQUIRED_NO_RATE, TAX_REQUIRED_NO_RATE, OVERSELL_SELF, OVERSELL_OTHER, LEDGER_INVALID, CA_TYPE_UNSUPPORTED, AMOUNT_NOT_POSITIVE, RATIO_NOT_POSITIVE, DATE_BEFORE_EX, CA_DUPLICATE, NOT_FOUND, SAVE_FAILED`. Example messages:
   - OVERSELL_SELF: "Vượt số lượng có thể bán: chỉ có {sellable} cổ phiếu {symbol} khả dụng ngày {DD/MM/YYYY} (bạn nhập {requested}). Cổ phiếu mua về sau T+2 mới bán được."
   - OVERSELL_OTHER: "Không thể lưu: thay đổi này làm lệnh bán {symbol} ngày {DD/MM/YYYY} vượt số lượng có thể bán (cần {requested}, khả dụng {sellable})."
   - QTY_NOT_LOT: "Khối lượng phải là bội số của {lotSize} (lô chẵn). Chọn "Lô lẻ" nếu đây là giao dịch lô lẻ."
   - PRICE_LOW_UNCONFIRMED: "Giá nhập bằng đồng (VND), ví dụ 125400 cho 125,4 nghìn. Nếu giá thực sự dưới 1.000 ₫, đánh dấu xác nhận."
   - FEE_REQUIRED_NO_RATE: "Chưa cài đặt tỷ lệ phí giao dịch, hãy nhập phí."
   - CA_DUPLICATE: "Đã có sự kiện này cho mã và ngày GDKHQ."
   - SAVE_FAILED: "Không lưu được, vui lòng thử lại."
7. **db.** `listTransactionsPage` uses `select(COLS, { count: 'exact' })` and adds `eq`/`gte`/`lte` only for the filters given. Order is `trade_date desc, seq desc`, and `.range(offset, offset+limit-1)`. It returns `{ rows: rows.map(transactionFromRow), total: res.count ?? 0 }` with no client-side re-sort. `getTransaction` uses `.eq('id').maybeSingle()` with `unwrapFound`. `getEntrySettings` handles a missing row and a NULL fee as described in Files. `loadLedger`/`getSettings` stay unchanged.
8. **Web lib and clock.** `parseTransactionListQuery(sp: Record<string, string|string[]|undefined>)` returns `{ query: {symbol?, side?, from?, to?, page}, notices: string[] }`, with `PAGE_SIZE = 20`. `pageMeta` and `listHref` live here too. `todayVn()` lives in `server/clock.ts`.
9. **Handlers.** `server/transactions/handlers.ts` reads FormData into raw strings (`String(formData.get(x) ?? '')` and `formData.get('oddLot') === 'on'`), then calls `getEntrySettings`, the core validator, `listTransactions` + `listCorporateActions` + `checkLedgerChange`, and finally the repo write. It maps codes to `{ code, message: entryMessage(...) }`. It returns `FormState = { ok: true } | { ok: false; fieldErrors; formError?; values }`. `DataError` maps to `NOT_FOUND`, `CA_DUPLICATE` (CONFLICT) or `SAVE_FAILED`; raw error text is never returned. Every path re-validates on the server, because server actions are public endpoints. Validate-then-write is not atomic; that is accepted for a single user and noted in a code comment.
10. **Server actions.** `actions.ts` has `'use server'`. Signatures are `(prev: FormState, formData: FormData) => Promise<FormState>`, with ids bound via `.bind(null, id)` on the page. Each one calls `const db = getDb()` first, which is where `requireUser()` goes when R6 returns. On `ok`: `revalidatePath('/transactions')` then `redirect('/transactions')`.
11. **Pages and components (R1).**
    - `page.tsx` awaits `searchParams` and renders, in order: the header (h1 "Sổ giao dịch", links "Thêm giao dịch" → `/transactions/new` and "Thêm sự kiện quyền" → `/transactions/corporate-actions/new`), the filter form, the list, then pagination. Under that sits the section "Sự kiện quyền", showing `listCorporateActions` (all, newest first) with Ngày GDKHQ, Mã, Loại and Mô tả from `describeCorporateAction`.
    - List columns: Ngày (`formatDate`), Mã (`SymbolLink`), Loại (Mua/Bán text badge), KL (`formatQuantity`), Giá (nghìn ₫) (`formatPrice`), Phí, Thuế (`MoneyText`, or "Ước tính" when undefined), and Sửa/Xóa links. Numbers are right-aligned with `num`/tabular-nums. On mobile, cards replace the table and tap targets are ≥ 44px.
    - The forms are client components using `useActionState`. Labels are Vietnamese, numeric inputs use `inputMode="numeric"`, dates use `type="date"` with `max={today}` passed from the server, and submit buttons are disabled while pending. Error text sits under each field, and `aria-describedby` points at it. The odd-lot checkbox is "Lô lẻ". A "Tôi xác nhận giá dưới 1.000 ₫" checkbox renders only when the state has `PRICE_LOW_UNCONFIRMED`. A banner "Chưa cài đặt phí giao dịch: nhập phí/thuế thủ công" links to `/settings` when `!feeRateConfigured`. Price help text reads: "Nhập bằng đồng, ví dụ 125400 hoặc 125.400 (= 125,40 nghìn)".
    - The corporate action form uses `<select>` Loại with only "Cổ tức tiền" and "Cổ tức cổ phiếu". Its fields are Mã, Ngày GDKHQ, Số tiền/cp (₫) or Tỷ lệ (sở hữu : nhận, two integer inputs), and Ngày thanh toán / Ngày niêm yết, all rendered (the irrelevant one is ignored by the validator, so no client toggling is needed). Static note: "Quyền mua chưa được hỗ trợ. Tạm thời nhập cổ phiếu mua quyền như một lệnh Mua với giá phát hành, phí 0."
    - Delete page text: "Xóa giao dịch {Bán} {200} {FPT} ngày {12/10/2026}? Danh mục và lãi/lỗ sẽ được tính lại." It has Hủy (a link back) and a destructive "Xóa" button.
    - Components contain no arithmetic, `Number(`, parsing or `new Date(`; all values arrive pre-formatted or as core-formatted integers.
12. Run `pnpm typecheck && pnpm lint && pnpm test`. In the impl-log, record "reject-without-auth tests waived (R6 suspended)", plus manual checks at 375px and ≥ 768px.

Rules: R1 (steps 3–6, 11), R2 (steps 2–3, integer storage), R3 (only `getDb()` in server code; client components import only the action references), R5 (lot size and settlement as parameters/config), R6 waived but each action is one entry point, R7 (no migration, no shadcn, no rights issue, no CA edit/delete), R8 (tests above).

## Specialist input used
**finance-investment-researcher**
- Adopted:
  - Separate `validateTransactionInput` (`buildLedger` stays permissive).
  - Field-keyed codes with a Vietnamese map in core.
  - INT32 caps.
  - Future-date reject.
  - Lot-size multiple with an odd-lot flag (validation-only; on edit it is re-derived as `qty % lotSize`).
  - Lot size from a core config default until STK-010.
  - Whole-ledger replay with add/edit/delete, `asOf = max(today, latest)`, OVERSELL on self vs on another trade, and no cascade.
  - The "don't make a bad ledger worse" escape hatch.
  - A replay that works without a fee rate, by passing `feeRatePpm` 0 (fees don't affect quantity).
  - Fee/tax required when no rate is set.
  - Cash dividend amount > 0; stock ratio > 0; `payDate`/`listingDate` ≥ exDate.
  - Unique violation → Vietnamese message.
  - `recordDate` left out of the form.
  - Rights issue deferred with a workaround note.
  - The low-price guard, as a confirm checkbox rather than a soft warning, because a server-rendered form has no warning channel.
- Rejected or deferred:
  - Tick check (`% 10`): not in the AC; F4.
  - Trading-day check on `tradeDate`: not in the AC, and an empty holiday list makes it half-right; F4.
  - Fee > 0.5% and sell-tax ≠ 0.1% sanity warnings, and tax-on-buy reject: not in the AC (R7); F4.
  - Saving the estimated fee as a concrete value: kept NULL (A3, flagged).
  - "% mệnh giá" and "%" ratio inputs: nice-to-have; F5.
  - Zero-holding warning on a CA: F5.
  - Edit/delete of corporate actions: the AC says "Add"; F2.

**data-visualization-engineer**
- Adopted:
  - Server component with table + card views and text badges.
  - GET filter form with URL params and a validated query parser outside `.tsx`.
  - `listTransactionsPage` with `count:'exact'` and `.range()`, sorted newest first by `trade_date desc, seq desc`.
  - Trước/Sau pagination with the page count computed in lib.
  - Full-page forms (`/new`, `/[id]/edit`) with `useActionState`, and no shadcn.
  - Handlers testable with mocked repos.
  - "Today" from server code.
  - Values echoed back on error; "Ước tính" for a NULL fee.
- Adapted: the delete confirmation is a no-JS page `/transactions/[id]/delete` rather than a `<dialog>`, because it is the cheapest and needs no client focus handling. A swap to AlertDialog later is local.
- Rejected:
  - **Thousand-VND price input ("125,4")**: the ticket's AC5 explicitly says prices are "entered and stored as integer VND" (A2, flagged).
  - Tabs `?tab=ca`: replaced by a plain section below the list (less code).
  - Source filter / "Nguồn" column, "Đã áp dụng" badge, symbol `<datalist>`, live fee-estimate preview: not in the AC (R7); F5.
  - Redirect for an out-of-range page: an empty state with a link to the last page instead.

## Assumptions
- **A1. Rights issue deferred: spec divergence, flagged for Ming.** Spec §3 F1 and §2.1 list rights issues, but `corporate_actions.type` allows only `cash_dividend`/`stock_dividend` and core has no rights logic (it needs a migration, subscription price × qty cost, a lot sellable at listing date, and transferability). Adding it breaks the ticket's areas (no `db`) and R7. AC3 is delivered for cash and stock dividends; the form explains the interim workaround (enter the subscribed shares as a Buy at the subscription price with fee 0; caveat: it becomes sellable at T+2, not the listing date). Follow-up F1.
- **A2. Price input is integer VND, flagged for Ming.** I chose this because AC5 is explicit ("entered and stored as integer VND"). It contradicts the design brief ("Giá (thousand VND)"); the ticket AC wins. "125.400" (Vietnamese grouping) is accepted as 125400; "125,4" is rejected with a hint. The 1000× mistake (typing 125) is caught by `PRICE_LOW_UNCONFIRMED`. The list displays prices in thousands (`formatPrice`) per the app convention, with the help text bridging the two. If Ming prefers thousand-VND entry, only `parseIntegerInput`'s caller for price changes (F6).
- **A3. Blank fee/tax stays NULL** ("use settings estimate", the existing schema semantics from STK-003/006). Consequence, flagged: changing the fee rate later changes the P&L of trades saved without a fee. While the fee rate is not configured, fee (and tax on sells) are required, so NULL is only saved when a rate exists.
- A4. Lot size comes from `DEFAULT_TRADING_RULES.lotSize = 100`, passed as a parameter. It is not yet read from `settings.rule_configs` (STK-010 types that; F3). Odd lot is allowed on buy and sell, at any quantity (e.g. 115 after a stock dividend).
- A5. Future trade dates are rejected; non-trading days are accepted. Corporate action ex-dates may be in the future.
- A6. After a successful save or delete, the action redirects to `/transactions` (filters are not preserved). Page size is 20.
- A7. An edit never changes `seq`; a back-dated insert sorts last on its day (harmless under T+2, per the finance consult).
- A8. The corporate action list is read-only, newest first, and unpaginated (personal volumes).
- A9. Validate-then-write is not atomic; this is accepted for a single user.
- A10. Imported transactions (`source='import'`) can be edited and deleted the same way; the repo never changes `source`.
- A11. Auth: no `requireUser()` (R6 suspended); reject-without-auth tests are waived and noted in the impl-log.

**Follow-ups (not in this diff):**
- F1: Rights issue support (migration + core cost/lot logic + form), spec §3 F1.
- F2: Edit/delete corporate actions (repo exists; needs the replay check, e.g. deleting a stock dividend whose shares were sold).
- F3: STK-010 types `rule_configs.lotSize`, and the handler reads it.
- F4: Extra input checks: tick-size multiple (needs exchange metadata), trading-day check, tax-on-buy, fee/tax sanity warnings.
- F5: UX: source filter/"Nguồn" column, "Đã áp dụng" badge, live fee estimate, % inputs for dividends, Sheet/AlertDialog with shadcn, filter preservation on redirect, symbol datalist.
- F6: Optional thousand-VND price entry if Ming prefers it (A2).

## Blocking questions
None.

## Split proposal
At about 900 product lines plus tests, the ticket is above the ~400-line guide. It has one spec feature (F1 manual entry), and the corporate action part reuses the same parse/messages/handler infrastructure (about 150 lines). So this plan covers the whole ticket except rights issue (A1). The implementer should build in this order so a split is clean if the cycle runs long:
- **Slice A (core of the ticket):** steps 1–4, 6–11 for transactions (AC1, AC2, AC4, AC5, AC6).
- **Slice B:** step 5 plus the corporate action form, page, list and handler (AC3).

If the reviewer or orchestrator wants a smaller diff, Slice B becomes its own ticket. Slice A does not depend on it.
