# consult-finance-investment-researcher — STK-008 (validation rules)

## Findings

1. **What core does today.** `buildLedger` (`packages/core/src/ledger/build-ledger.ts`) accepts `price >= 0`, `quantity > 0`, and `fee`/`tax >= 0`. It replays every event dated on or before `asOf` and returns the **first** `OVERSELL`, with `transactionId`, `date`, `requested` and `sellable`. The sellable check only counts lots whose `sellableFrom` (T+settlementDays trading days, or `listingDate` for stock-dividend lots) is on or before the sell date. There is no lot-size check and no tick check.
2. **No exchange data anywhere.** `transactions`, `watchlist` and `prices_daily` have no exchange column (STK-003 decision Q5). Without it, a per-exchange tick rule can't be applied.
3. **Lot size is not readable yet.** It is meant to live in `settings.rule_configs` jsonb. `settingsFromRow` and `getSettings` ignore that column, `LedgerSettings` has no lot-size field, and STK-010 (which types it) is still BACKLOG.
4. **`getSettings` throws `NOT_CONFIGURED`** when `fee_rate_ppm` is NULL or the settings row is missing. Fee rate has no default and is only entered on the STK-010 screen. So any validation that calls `loadLedger` fails until Ming sets a fee rate.
5. **Fee and tax NULL means "estimate at read time"** (`estimateFees`, using the current settings). Changing the fee rate later silently changes the P&L of every past trade saved without a fee.
6. **`seq` never changes.** It is an identity column set on insert, and updates don't touch it. A back-dated insert sorts last among that day's trades. This is harmless for sellability, because a buy on day D can't fund a sell on day D under T+2.
7. **Corporate actions.**
   - The schema allows only `cash_dividend` and `stock_dividend`, unique on `(symbol, type, ex_date)`.
   - The core type has no `recordDate`, though the DB has `record_date`.
   - Core treats `amountPerShare = 0` as valid.
   - An action on a symbol with zero quantity on the ex-date does nothing.
   - The repo supports update and delete for actions too.
8. **Market facts** (secondary sources, check against an official HOSE/SSC notice):
   - **Tick size.** HOSE stocks and closed-end funds: 10 VND under 10,000; 50 VND from 10,000 to 49,950; 100 VND from 50,000. HOSE ETFs: 10 VND at every price. HNX and UPCoM stocks: 100 VND [from memory, not checked].
   - **Lot size.** The HOSE board lot has been 100 since 2021-01-04; before that it was 10. Odd lots (1–99) are legitimate, and stock dividends routinely create them (e.g. holding 100 with a 100:15 dividend gives 115).

## Recommendations

1. **Add a separate core entry point, e.g. `validateTransactionInput(input, rules, today)`.** Keep `buildLedger` permissive, since imports may legitimately differ. It should return a list of typed `{ field, code }` errors. Vietnamese messages come from a core map keyed by `code`, so the UI only displays them (R1). *(AC4, R1)*
   - `price > 0`, a safe integer, and `<= 2_147_483_647` (int32, matching the DB column). The same int32 cap applies to `quantity`, so the user gets a form error instead of a DB error.
   - **Unit warning, not an error, when `price < 1000`.** The list shows prices in thousands ("125,40"), so typing `125` instead of `125400` is the most likely input mistake. Show the form hint "Giá nhập bằng đồng (VND), ví dụ 125400". *(R2)*
   - **Tick rule: defer per-exchange checks** to a follow-up that adds exchange metadata. For now, at most check `price % minPriceStep === 0`, where `minPriceStep = 10` is a config default next to `DEFAULT_MARKET_SETTINGS`. Every stock tick on every exchange is a multiple of 10. Don't hard-code it in components. *(R5, R7)*
   - **`tradeDate`:** a valid date, not after today in Asia/Ho_Chi_Minh, and a trading day (`isTradingDay` with the configured holidays). Future-dated trades would also fall outside the `asOf` replay.
   - **Lot size:** `quantity % lotSize === 0` unless the "lô lẻ" flag is set.
     - Read `lotSize` from config and fall back to a core default of 100 until STK-010 types it. *(R5)*
     - The flag can be validation-only, since there is no column for it. On edit, re-derive it as `quantity % lotSize !== 0` so the checkbox comes back pre-ticked. Don't add a column (R7).
     - Odd-lot sells after stock dividends and pre-2021 HOSE trades (lot 10) depend on this flag, so the rule must never block them.
   - **Tax on a buy:** reject `tax > 0`, or at least warn.
2. **Sellable-quantity check by replaying the whole ledger.** Do it in core: `checkLedgerChange(currentTxs, currentActions, change, settings)`, where `change` is an add, edit or delete of a trade or a corporate action. *(AC4)*
   - Build the candidate list (append / replace by id / remove), then run `buildLedger(candidate, actions, settings, asOf = max(today, latest date))`. A replay limited to the edited trade's date would miss later sells that are no longer covered.
   - If the result is `OVERSELL` on the transaction being changed, show an error on the quantity field: "Vượt số lượng có thể bán (khả dụng X tại ngày D)".
   - If it is `OVERSELL` on a **different, later sell**, reject the edit or delete. Show "Thay đổi này làm lệnh bán SYM ngày DD/MM/YYYY không hợp lệ (cần X, khả dụng Y)". Never cascade-delete, and never auto-fix.
   - The same check covers deleting or editing a stock dividend whose shares were later sold, moving a buy's date later, and lowering a buy quantity.
   - Run the check **before** the write, inside the server action. Validate-then-write isn't atomic, which is acceptable for a single user; note it.
   - If the **current** ledger is already invalid (bad data), reject only if the change makes it worse, meaning the first error moves earlier or appears new. Otherwise Ming can't delete his way out of a bad state.
3. **Fee and tax defaults.** *(R2, R5)*
   - Show a live preview of the core estimate from `estimateFees` and a "Phí/Thuế ước tính" hint. If the field is left empty, I recommend **saving the concrete estimate** rather than NULL. That freezes historical P&L against later rate changes and matches the earlier conclusion that the entered amount is the truth.
   - If the planner keeps NULL to stay within the current data-layer behaviour, document that past P&L moves when the rate changes.
   - **Fee rate not configured:** don't let `NOT_CONFIGURED` crash the screen.
     - Require fee (and tax on sells) to be entered explicitly until a rate exists.
     - Run the oversell replay with the rate unset. Fees don't affect quantities, so the replay can use a core helper that doesn't need `feeRatePpm`. Alternatively, show a "Chưa cài đặt phí giao dịch" banner. Planner/Ming to choose.
   - Sanity warnings, not errors:
     - fee above about 0.5% of trade value;
     - sell tax different from 0.1% of value. Legitimate when it includes the 5%-on-par income tax on sold bonus shares, so warn only.
4. **Corporate action inputs.** *(AC3)*
   - **Cash dividend:**
     - `symbol`, `exDate` (a trading day), and `amountPerShare` as an integer VND **> 0**. This is stricter than core's `>= 0`; put it in the new form validator.
     - Optional `payDate >= exDate`.
     - Offer "% mệnh giá" input that core converts (10% → 1,000 VND, using a 10,000 VND par from config).
     - Warn if the holding is 0 on the ex-date, because the action will do nothing.
   - **Stock dividend / bonus shares:**
     - Ratio as integers `held > 0`, `received > 0`; offer "%" input (20% → 100:20) converted in core.
     - Optional `listingDate >= exDate`. Without it, the shares become sellable at ex-date + T+2, which is earlier than in reality, so warn.
   - Map the unique-constraint violation to "Đã có sự kiện này cho mã/ngày GDKHQ".
   - Edits and deletes of actions go through the same replay check as Recommendation 2.
   - Leave `recordDate` out of the form, since core doesn't use it (R7).
5. **Defer rights issue.** It needs a migration (new type, subscription price, ratio, subscribed quantity, payment and listing dates). It also needs new core logic: added cost = subscribed qty × subscription price, plus a lot sellable at the listing date. Rights are also transferable. All of this is outside the ticket's areas (no `db`) and R7.
   - The planner should mark AC3's "rights issue" part as deferred, open a follow-up, and flag the conflict with spec §3 F1 to Ming.
   - Interim workaround, to document: enter the subscribed shares as a buy at the subscription price with fee 0. Caveat: it becomes sellable at T+2, not the listing date.

## Risks

- **Over-strict rules block real history.** That includes odd lots, pre-2021 lot 10, sub-1,000 VND UPCoM prices and promo zero fees. Keep these as warnings or flags, not hard rejects.
- **Empty holidays list** (STK-019 not done). `sellableFrom` comes out too early around Tết and other holidays, so the check lets through some sells it should reject, but never rejects a valid one.
- **Tick facts are unverified** against an official current HOSE notice, and HNX/UPCoM tick values are from memory.
- **NULL fee/tax drift** if the estimate is not saved as a value.
- **Whole-ledger replay on every write** is fine for single-user volumes (thousands of rows).
- **First-error-only replay:** core reports one OVERSELL at a time, so Ming may fix them one by one.
- **Rights issues missing:** P&L drifts for any symbol where Ming took up rights until the follow-up lands.

## Open questions

1. Save the estimated fee/tax as concrete values when the fields are left empty (recommended), or keep NULL meaning "estimate"?
2. Until a fee rate is set (STK-010), should fee and tax be required on the form, or should the screen show a blocking banner? Is there a seeded settings row?
3. Is rights issue deferred to a follow-up (needs a migration and core logic), with the spec §3 F1 conflict acknowledged by Ming?
4. Tick validation now: only the universal multiple-of-10 check, or none until exchange metadata exists?
5. Should the price input be integer VND (per AC5), even though the list shows prices in thousands? Or should core parse a thousand-VND decimal ("125,4" → 125400)? The second is friendlier, but the AC says integer VND.
6. Allow back-dated trades on non-trading days (for example a statement date convention), or reject them?

Sources: [vnbusiness: tick sizes 10/50/100](https://vnbusiness.vn/ap-dung-lo-chan-100-chung-khoan-la-phu-hop-voi-thong-le-quoc-te.html), [baodautu: HOSE lot 10→100 from 2021](https://baodautu.vn/hose-tang-lo-giao-dich-tu-10-len-100-co-phieu-tu-dau-nam-2021-d135847.html), [DSC: board lot vs odd lot](https://www.dsc.com.vn/kien-thuc/huong-dan-giao-dich-lo-chan-lo-le), [Tuoi Tre: KRX live 2025-05-05](https://tuoitre.vn/nld/krx-system-officially-goes-live-19625050517142482.htm).
