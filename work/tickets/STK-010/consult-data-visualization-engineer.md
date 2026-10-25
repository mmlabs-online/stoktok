# consult-data-visualization-engineer — STK-010

STK-010 consult (data-visualization-engineer, read-only). This is a form screen with no charts. I advise on form UX and on the units and validation boundary.

## Findings
- /settings is currently an EmptyState placeholder (`apps/web/app/(app)/settings/page.tsx`).
- Table `settings` has these columns: `fee_rate_ppm` (nullable, no default), `sell_tax_rate_ppm`, `dividend_withholding_rate_ppm` (not null), `settlement_days`, `holidays date[]`, `cash_dividend_treatment` ('reduceCost' | 'income'), `cost_method` (only 'WAC'), `concentration_threshold_ppm` (nullable, 0..1,000,000), `rule_configs jsonb` (default `{}`, must be an object). The column comment says rule_configs holds "price limits, lot size, signal rule params; no money values". There is no row-level check on rule_configs content, so core must validate it.
- `saveSettings` upserts ledger columns only (via `settingsToRow`). It does not write `concentration_threshold_ppm` or `rule_configs`. `getConcentrationThreshold` is read-only. STK-010 therefore needs new repo functions: a read and a write for the portfolio and rule columns. Also check that `settingsToRow` does not overwrite those columns with defaults on upsert. An upsert that omits them should leave them untouched on update. On insert they take the column defaults.
- Defaults live in four places:
  - `DEFAULT_MARKET_SETTINGS` (core/ledger/settings.ts): settlement 2, tax 1000 ppm, withholding 50000 ppm, reduceCost, holidays [].
  - `DEFAULT_TRADING_RULES` (core/entry/rules.ts): lotSize 100. Its comment says "until rule_configs is typed (STK-010)".
  - `DEFAULT_CONCENTRATION_THRESHOLD_PPM` = 200000 (core/portfolio/config.ts).
  - `DEFAULT_PRICE_SANITY` (core/market/config.ts).
- There are no per-exchange price limits in core yet. HOSE 7%, HNX 10% and UPCoM 15% exist only in CLAUDE.md. They need a new core type and default.
- Hard-coded rule use in web or worker, found by grep:
  - `apps/web/server/transactions/handlers.ts:111` passes `DEFAULT_TRADING_RULES` to `validateTransactionInput`. After STK-010 this must read lot size from stored settings, or the setting has no effect.
  - `apps/web/app/(app)/transactions/[id]/edit/page.tsx:25` uses `DEFAULT_TRADING_RULES` for `transactionToFormValues`.
  - `apps/web/components/transactions/transactions.test.tsx:43` has the literal "bội số của 100" in a test fixture. This is only a test string, but it shows the message text may hard-code 100. Check `entry/messages-vi.ts` for the same.
  - `DEFAULT_PRICE_CUTOFF_MINUTES_VN` is used in `load-dashboard.ts` and the worker `eod-sync.ts`. It is a defaults constant imported from core, not a rule typed in web or worker. It is outside this ticket (the ticket lists no cutoff field).
  - Worker `config.ts` has timeouts and backoff (1000 ms). These are infrastructure, not market rules.
- `apps/web/test/no-calc-in-ui.test.ts` already scans `components` and `app` for `.tsx` files, forbidding `* 100`, `/ 1000`, `Math.`, `parseFloat(`, `parseInt(`, `toFixed(`. That blocks percent-to-ppm conversion in the form component, which is the intent. Percent parsing must live in core.
- Handler pattern (`server/assets/handlers.ts`): `readXForm(FormData)` returns raw strings, a core `validateXInput` runs, then the repo is called. The result is `{ok:true}` or `{ok:false, fieldErrors, values}` via `failForm` and `fieldErrors`. Reuse this shape, with the raw string values echoed back so the user's typing is preserved on error.

## Recommendations

### 1. Form layout (AC 1)
Use one full-page form, matching STK-008/009/030: `onSubmit` + `startTransition`, with the handler in `apps/web/server/settings/handlers.ts`. Follow the brief (Prompt 6) section names, but only the sections in ticket scope. Do not build "Quy tắc tín hiệu" (AC 5 excludes it) or "Tài sản khác" (that is STK-030's /assets).
- Card 1 "Phí & thuế":
  - "Phí giao dịch (%)" with helper "Kiểm tra lại biểu phí TCBS hiện tại". Show a required marker, because there is no default (`fee_rate_ppm` is NULL).
  - "Thuế bán (%)".
  - Dividend withholding is a ledger setting but not in the AC. Either leave it out and carry the stored value through unchanged, or add it as an optional "Thuế cổ tức (%)" field. This is an open question (Q1).
- Card 2 "Quy tắc thị trường", helper "Cấu hình — xác minh với quy định sàn hiện hành":
  - "Biên độ giá" as three labelled fields (HOSE / HNX / UPCoM), in a single-column 3-row group, or as a small table with the exchange in the row header.
  - "Số ngày thanh toán (T+)".
  - "Lô giao dịch (cổ phiếu)".
- Card 3 "Danh mục": "Ngưỡng cảnh báo tỷ trọng (%)" and "Xử lý cổ tức tiền mặt", as radios with a one-line explanation per option.
- Sticky footer "Lưu thay đổi" (disabled until dirty) and "Hủy" (reset to the saved values), as in the brief. Compare dirty state on the raw strings against the initial strings. That is a string comparison with no arithmetic, so R1 is fine.
- At 375px:
  - One column, cards stacked, labels above inputs, inputs full width.
  - `inputMode="decimal"` for percent fields and `inputMode="numeric"` for integers.
  - Put a unit suffix ("%", "ngày", "cp") inside or beside the input so the unit is never inferred from the label alone.
  - Make the footer `sticky bottom-0` with safe-area padding, and make sure it does not cover the last field (add bottom padding to the form).
  - Touch targets of at least 44px.
- Desktop: cap the form at roughly `max-w-2xl` single column. A two-column grid is only useful for the three exchange limits (three small fields in a row is fine). Do not widen the whole form, because short numeric inputs on very wide rows read badly.
- Show errors per field (inline, under the input, with `aria-describedby` and `aria-invalid`) plus a summary at the top for the screen reader. Keep all text Vietnamese from `messages-vi`.
- Show a saved/failed status after submit. A short text confirmation is enough.

### 2. Percent input and ppm (AC 2)
Add `parseRatePercentInput(text, {maxPpm})` next to `parseIntegerInput` in `core/entry/parse-input.ts`, using the same BigInt approach. Do not use `parseFloat` or `* 10000`.
- Accept `^\d+([.,]\d{1,4})?$` after trim. Accept both "," and "." as the decimal separator, since users type "0,15" in Vietnamese. This conflicts with the integer parser, where "." is a thousands separator, so document that percent fields never take thousands grouping. Reject anything with two separators or a thousands-style group (for example "1.000").
- 1% = 10,000 ppm, so 4 decimals of percent = 1 ppm. Split on the separator, right-pad the fraction to 4 digits, and compute `BigInt(int) * 10000n + BigInt(frac)`. More than 4 decimals gives a `TOO_PRECISE` code and is rejected, never silently rounded.
- Check the range on the BigInt before converting to Number (as `parseIntegerInput` does). Codes: REQUIRED / NOT_NUMBER / TOO_PRECISE / TOO_LARGE / NEGATIVE. A leading "-" should return NEGATIVE, not the generic NOT_NUMBER.
- Add the inverse `formatRatePercent(ppm)` in core, for the initial form values. It returns a string such as "0,15" using integer division and modulo, trimming trailing zeros and using the Vietnamese decimal comma. The page must not call it with arithmetic in JSX. Compute the initial strings in a core function `settingsToFormValues`, like `transactionToFormValues`. Round-trip property: `parse(format(p)) === p` for all p in range, which is a cheap test.
- Ranges per field. These are validation bounds, not market rules, so they are legitimate constants in core:
  - Fee rate: 0..1% to 5% (suggest 0 to 50,000 ppm). A fee of 0 is valid, though it hides the "not configured" state. Treat a blank fee field as REQUIRED on first save. Decide whether Ming may save with the fee blank (see Q2).
  - Sell tax: 0..50,000 ppm (also 0..5%).
  - Concentration: 0..1,000,000 ppm (matches the DB check). Consider rejecting 0, because a 0% threshold warns on every holding. Treat 1..1,000,000 as the valid range, or allow 0 to mean "disabled" (see Q3).
  - Price limit: 1..30% is a sensible bound (HOSE 7, HNX 10, UPCoM 15 are well inside).
- Validation errors are `EntryErrorCode`s with Vietnamese messages in `entry/messages-vi.ts`. Add codes such as `RATE_NOT_NUMBER`, `RATE_TOO_PRECISE`, `RATE_OUT_OF_RANGE`, `DAYS_OUT_OF_RANGE`, `LOT_SIZE_INVALID`, and `TREATMENT_INVALID`. Put the range in the message ("từ 0% đến 5%") from the same constant, so the text and the check cannot drift. Add the codes to `messages-vi.test.ts` so every code has a message.

### 3. Price limits per exchange and rule_configs (AC 1, R5)
Proposed JSON shape in `rule_configs` (a ratio in ppm, no money values, consistent with the column comment):
```
{ "market": { "lotSize": 100,
              "priceLimitPpm": { "HOSE": 70000, "HNX": 100000, "UPCOM": 150000 } } }
```
- Use a namespaced key (`market`) so the signals ticket can add `signals` later without a collision. The save must merge into the existing JSON (read-modify-write, or `jsonb ||` in a function), never replace the whole object. Otherwise saving the settings screen deletes signal parameters stored by a later ticket. Add a test: saving with an existing `signals` key preserves it.
- Core type `MarketRules { lotSize: number; priceLimitPpm: Record<'HOSE'|'HNX'|'UPCOM', number> }`, `DEFAULT_MARKET_RULES`, and `parseMarketRules(json: unknown, defaults)`. The parser takes unknown JSON and returns a typed value. A missing or invalid key falls back to the default per key, not for the whole object, so a partly filled row still works.
- Use the same exchange key spelling everywhere. CLAUDE.md writes "UPCoM", the brief writes "UPCOM". Pick one internal key (`UPCOM` for a stable ASCII key) and keep the display label "UPCoM" in a core label map. Check what the `assets`/symbols data uses for the exchange column and match it.
- Price limits are not consumed by anything in v1 yet (no price-limit check). That is fine. The ticket only requires they are stored and shown. Do not add consumers (R7). Put it in the follow-ups list that entry validation and the signals logic should read them.

### 4. Lot size and DEFAULT_TRADING_RULES
- Make `DEFAULT_TRADING_RULES` derive from `DEFAULT_MARKET_RULES` (`{ lotSize: DEFAULT_MARKET_RULES.lotSize }`) so 100 is defined once. Remove its "until typed (STK-010)" comment.
- Add a loader `getTradingRules(db)` in the db repo (reads `rule_configs`, calls core `parseMarketRules`, returns `TradingRules`). Replace `DEFAULT_TRADING_RULES` in `handlers.ts:111` and the edit page with it. This is what makes AC 4 true for lot size.
- Validation for lot size: integer, 1..10,000 (suggest). Reject 0. Changing the lot size does not rewrite history, but old transactions that are no longer multiples of the new lot size may fail revalidation on edit. Check `check-ledger-change` and `validateTransactionInput` for how the lot rule applies to existing rows. Note odd lots are "handled separately" per CLAUDE.md, so confirm the lot rule applies to buys only if that is the existing behavior. Do not change it here.
- The message "Khối lượng phải là bội số của 100" must interpolate the configured lot size. Check `messages-vi.ts`; if it hard-codes 100 it breaks AC 4.

### 5. Settlement days
Integer, 0..5 (the DB allows >= 0; the upper bound is a core sanity limit, not a market rule). Show "T+" as a prefix. Help text: "Cổ phiếu mua được bán từ T+N". A change affects the computed `sellableFrom` of lots on the next ledger replay. State this in the helper text, because lot status will shift for recent buys. `LotStatusBadge` already takes `settlementDays` as a prop, so make sure its callers pass the stored value.

### 6. Concentration threshold
Percent input, parsed with the shared parser, stored as ppm. Blank means "use the default": store NULL and show the default as a placeholder and a helper ("Mặc định 20%"). This matches `resolveConcentrationThreshold(null)`. The default text must come from the core constant through the formatter, not a literal "20" in JSX. Decide whether blank is allowed or the field is always filled with the effective value (see Q3).

### 7. Cash dividend treatment
Two radio options, with Vietnamese labels and an explanation each:
- `reduceCost` "Giảm giá vốn" (cash dividend reduces cost basis, matching the CLAUDE.md corporate-actions rule that all actions adjust cost basis).
- `income` "Ghi nhận thu nhập" (dividend is booked as income, cost basis unchanged).
Keep the option list and labels in core (a `CASH_DIVIDEND_TREATMENTS` const with labels), not a hard-coded array in the component. Validate that the submitted value is one of the two; reject anything else. Add a warning that changing it changes realized P&L for the whole history on the next replay, since the ledger is rebuilt from transactions. Check `build-ledger.ts` to confirm there is no stored derived state that goes stale.

### 8. Showing defaults when no row exists (AC 3)
- Add `loadSettingsForm(db)` server-side (in `apps/web/server/settings/`) that never throws NOT_CONFIGURED: row missing returns defaults, `feeRatePpm` null, and `isDefault: true`. `getEntrySettings` already returns defaults on a missing row, so build on it or on a sibling function. Do not use `getSettings`, which throws on a missing row or null fee.
- Show defaults as real field values (so saving writes them) rather than placeholders. The exception is the fee, which stays blank with a "Chưa cấu hình" note. Add a small banner on the first visit: "Đang dùng giá trị mặc định — chưa lưu" (core can return `source: 'default' | 'stored'`).
- Test AC 3 as a core/handler test: with no row, the form values equal the CLAUDE.md table (settlement 2, tax "0,1", HOSE "7", HNX "10", UPCoM "15", lot 100). Write the expected strings as literals in the test. That makes the test a second, independent copy of the table, which is the point.
- First save must also write the NOT NULL columns the form does not show (withholding, cost_method, holidays). Take them from `DEFAULT_MARKET_SETTINGS` or the existing row.

### 9. Proving no hard-coded rule values (AC 4)
Add a source-scan test, `apps/web/test/no-hardcoded-rules.test.ts` (and a similar one in `apps/worker/test/`), modelled on `no-calc-in-ui.test.ts`. Scan non-test `.ts`/`.tsx` under `apps/*/` (excluding `.next`, `node_modules`, and `*.test.*`) and fail on:
- Rule-shaped literals: `lotSize\s*[:=]\s*\d`, `settlementDays\s*[:=]\s*\d`, `RatePpm\s*[:=]\s*\d`, `0\.001\b`, `1000\s*(ppm)?` next to tax or fee words, `\b(HOSE|HNX|UPCOM)\b.*\d` price-limit literals, `T\+\d`.
- Imports of defaults used as live values: `DEFAULT_TRADING_RULES` and `DEFAULT_MARKET_SETTINGS` in non-test web or worker code, except in an explicit allowlist (the settings loader that falls back for a missing row).
- Keep an explicit allowlist file of path + reason, so each exception is visible in review. A test that only greps for numbers is fragile, so combine it with the import check, which is the stronger guarantee.
Legitimate defaults (stay in core only):
- `DEFAULT_MARKET_SETTINGS`, `DEFAULT_MARKET_RULES` (new), `DEFAULT_CONCENTRATION_THRESHOLD_PPM`.
- Validation bounds (ranges) in core.
- `DEFAULT_PRICE_CUTOFF_MINUTES_VN` and `DEFAULT_PRICE_SANITY`: defaults, not user-editable in this ticket. Allow their current imports in `load-dashboard.ts` and the worker, and note them in the allowlist as "out of scope for the settings form".
- Test fixtures (`*.test.*`) may use literals.
Also add a behavioral test that proves the wiring: save lot size 10, then `handleCreateTransaction` with quantity 10 succeeds and with quantity 100's old default behavior no longer applies. Similarly settlement days 3 gives a `sellableFrom` one trading day later. These prove "core reads these values everywhere" better than a grep can.

### 10. Cheap tests
All Vitest, no browser:
- Core `parseRatePercentInput`: "0,15" gives 1500; "0.15" gives 1500; "0,1" gives 1000; "7" gives 70000; "100" gives 1,000,000; "" is REQUIRED; "-1" is NEGATIVE; "0,12345" is TOO_PRECISE; "1.000,5" and "1,2,3" and "abc" are rejected; "0,0001" gives 1; huge input is TOO_LARGE without precision loss; round trip with `formatRatePercent` over a table of values.
- Core `validateSettingsInput`: each field's range edges (min, max, max+1), all errors reported together (not first only), lot 0 rejected, treatment outside the enum rejected, all-valid input returns the typed value in ppm.
- Core `parseMarketRules`: empty `{}`, partial object, wrong types (string for lotSize, array), extra unknown keys preserved by the merge function.
- Merge test: saving settings keeps an existing `signals` key in `rule_configs`.
- Repo tests with `packages/db/test/fake-client.ts`: new save and load functions, missing row, null fee, and upsert payload does not clobber the columns it does not own.
- Handler tests (like `assets/handlers.test.ts`): invalid input returns `fieldErrors` with Vietnamese messages and the raw `values` echoed; DataError becomes `SAVE_FAILED`; success returns `{ok:true}`.
- Component test (`components.test.tsx` style): renders defaults, the required-fee marker, and error text. Dirty-state: the save button is disabled when the strings are unchanged.
- The two source-scan tests from section 9, run against the repo so they fail if a later ticket reintroduces a literal.

## Risks
- A fee rate of 0 is a valid number but also what `getEntrySettings` substitutes when unset. If the form saves "0" on a blank, `feeRateConfigured` flips to true and the manual-fee prompt disappears. Keep blank = NULL and require explicit entry.
- Overwriting `rule_configs` wholesale will destroy signal parameters from later tickets. Merge by namespace.
- Percent parsing with floats (`0.15 * 10000 = 1500.0000000000002`) is the classic bug. Keep it BigInt/string-based, and keep it out of components (the R1 scan would also catch it).
- Decimal comma vs dot: "1.000" is 1000 in the integer parser but invalid for a percent. Using two parsers with different separator rules can confuse users. Mitigate with inline examples ("ví dụ 0,15") and clear error text.
- Changing settlement days, the cash dividend treatment, or the lot size changes the replayed ledger and the validation of older rows. The user may see new OVERSELL errors or shifted P&L after saving. Warn on the form and keep the old rows unmodified.
- Unit confusion in the label: a user who types "0,15" in a field labelled "%" is right, but one who types "1500" from reading the ppm column is off by 10^4. The max-range check (fee at most 5%) will catch most of it.
- R6 is suspended, so the save action has no auth. Keep the handler taking `db` and `today` as parameters, and call it only from server code (R3), so adding `requireUser()` later is one line. Do not add auth code (CLAUDE.md note). The ticket text "behind auth" is waived.
- Two places defining UPCoM/UPCOM and exchange keys can drift. Define it once in core.
- A grep-based hard-code check can pass trivially on code that does not import constants but computes from a literal elsewhere. The behavioral wiring tests cover that gap.

## Open questions
1. Should the form expose the dividend withholding rate (stored as `dividend_withholding_rate_ppm`, default 5%) and holidays? The AC lists neither. Suggest leaving both out (R7) and carrying the stored values through unchanged, and adding a follow-up for them. Holidays especially affect T+2 and the price-date logic, so someone must own that list.
2. May Ming save the other fields while the fee is still blank? Suggest yes (NULL stays valid, entry keeps asking for manual fees), with the form showing "Chưa cấu hình" until it is filled.
3. Is 0% an acceptable concentration threshold (as "off") and may the field be blank (NULL, default 20%)? Suggest blank = default, 0 rejected, with a range of 1%..100%.
4. Exchange key spelling: UPCOM vs UPCoM in the `assets` data and symbol metadata. Confirm which the assets table uses.
5. Is the lot size global, or per exchange? The ticket says one lot size, and HOSE/HNX/UPCoM all use 100 today (odd lots aside). Suggest one global value.
6. Spec §5 (`docs/spec-v1.md`) and `docs/figma-make-prompts.md` Prompt 6 were only partly reviewed (I read Prompt 6 and the ticket's spec citation, not the full spec). Confirm the spec does not list extra settings fields beyond the AC.

Files reviewed: /home/user/stoktok/work/tickets/STK-010/ticket.md, /home/user/stoktok/docs/figma-make-prompts.md (Prompt 6), /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql, /home/user/stoktok/packages/core/src/ledger/settings.ts, /home/user/stoktok/packages/core/src/ledger/types.ts, /home/user/stoktok/packages/core/src/entry/rules.ts, /home/user/stoktok/packages/core/src/entry/parse-input.ts, /home/user/stoktok/packages/core/src/portfolio/config.ts, /home/user/stoktok/packages/core/src/market/config.ts, /home/user/stoktok/packages/db/src/repos/settings.ts, /home/user/stoktok/apps/web/server/assets/handlers.ts, /home/user/stoktok/apps/web/test/no-calc-in-ui.test.ts, /home/user/stoktok/apps/web/app/(app)/settings/page.tsx. I did not open `messages-vi.ts`, `settingsToRow`, `build-ledger.ts`, or the spec, so the points above about those are things to verify.
