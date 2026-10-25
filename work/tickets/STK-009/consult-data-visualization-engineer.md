# consult-data-visualization-engineer — STK-009

## Findings
I read the ticket, Prompt 1, StatCard, DataFreshnessBadge, TransactionList, tone.ts and the no-calc test. I did not read spec-v1 or the core package.

- Reusable pieces exist. `StatCard` takes `label`, `value`, `sub` and `icon`. `DataFreshnessBadge` takes `fresh` as `true`, `false` or `null`: `false` shows "Dữ liệu cũ", `null` shows "Chưa có dữ liệu", and a fresh price shows its date. `EmptyState`, `MoneyText`, `SymbolLink` and `TONE_STYLES` (glyph plus sr-label, so color is never the only signal) are also there.
- `TransactionList` already sets the table/card pattern. It renders a `md:table` and an `md:hidden` card list from the same rows. Row actions are links to full-page `/edit` and `/delete` routes, with a `min-h-11` touch target.
- `no-calc-in-ui.test.ts` bans `reduce(`, `.toFixed(`, `Math.`, `parseInt(`, `*100`, `/1000` and `new Date(` in `.tsx` files under `components/` and `app/`. Any percent or rate display must be pre-formatted in `packages/core`. A CSS bar width of the form `style={{ width: \`${row.weightPct}%\` }}` does not trip the regexes, provided core supplies the number.
- Prompt 1 is broader than the ticket. It asks for a donut, today's change, YTD realized P&L, a signals card and sortable headers. The ticket's acceptance criteria cover none of the signals, today's change or sorting. The donut would need recharts, which is not installed.

## Recommendations

**Layout (criteria 1, 3, 5)**
1. **Stat cards.** Use a grid of `grid-cols-2 lg:grid-cols-4`.
   - Order: Tổng tài sản (full-width hero on mobile via `col-span-2`), Giá trị cổ phiếu, Tiền mặt + tài sản khác, Lãi/lỗ chưa chốt.
   - Lãi/lỗ chưa chốt takes VND as the value and % as `sub`, with a glyph and tone from `TONE_STYLES`.
   - Add Lãi/lỗ đã chốt as a fifth card. This is the "realized P&L total" in criterion 1. Use the label "Lãi/lỗ đã chốt", not YTD, unless core returns a YTD figure.
   - Drop "Biến động hôm nay". It is not in the ticket and needs the previous close.
   - The net-worth sub line should show the breakdown or the "as of" price date. It must not be computed in the UI.
2. **Holdings: dual render.** Follow the STK-008 pattern: `md:table` plus `md:hidden` cards.
   - Desktop table columns: Mã, KL, KL khả dụng, Giá vốn TB, Giá hiện tại (with date and badge underneath), Giá trị, Lãi/lỗ (VND over %), Tỷ trọng.
   - Skip the Sàn column unless the data is already on the row.
   - Mobile card: top line is `SymbolLink` plus P&L VND/% (glyph, tone) on the right. Then two or three short key/value lines (KL / khả dụng, giá vốn → giá hiện tại, giá trị). The bottom line is weight, with warning and badge.
   - Do not use a horizontally scrolling 10-column table at 375px.
   - Skip sortable headers for now. Sort by market value descending in core. If sorting is wanted later, do it server-side via a URL param, as in `transaction-list-query`.
3. **Weight: number plus thin CSS bar.** Show the number ("23,4%") and a 4px-high bar under or next to it.
   - The bar is `<div role="presentation">` with an inner div whose inline width is `${row.weightPct}%`.
   - The number is the accessible value, so the bar is decorative.
   - Core must supply `weightPct` as a numeric percentage plus a pre-formatted label, so the UI does no division or rounding.
   - Bars share a 0–100% scale and start at zero. Do not rescale to the max row, which would exaggerate small holdings.
   - Do not use a donut. With Ming's likely 3–15 holdings, sorted bars (a ranking) are read more accurately than angles, and a donut adds a dependency and a CVD problem.
4. **Chart decision: no chart now.**
   - The CSS bars carry the weight story.
   - A chart earns its place only with time series (portfolio value over time). That needs a snapshot history that does not exist yet, so defer it to a separate ticket and add recharts or a similar library then.
   - Putting a stacked CSS bar of the allocation by stock, cash and other assets above the holdings table is optional. It is cheap and answers "how much is in stocks vs cash". The segments need direct labels with percentages, not a hue-only legend. Skip it if it grows the diff.
5. **Concentration warning (criterion 3).**
   - Per row, put a warning glyph (AlertTriangle, `text-warn`) with text next to the weight: "Vượt ngưỡng 30%". The threshold text comes from config via core. The icon alone is not enough.
   - Tint the bar `warn`, and keep the number's text readable.
   - Add one summary `role="status"` banner above the table when `overConcentration.length > 0`: "N mã vượt ngưỡng tỷ trọng X%: AAA, BBB". The same banner can list stale-price symbols. This replaces Prompt 1's right-hand Cảnh báo card on mobile and fits the single column.
   - Core returns the boolean flag per row, and the UI never compares weight to threshold (R1/R5).
6. **Stale or missing price per row (criterion 5, R4).**
   - Always show the price date under "Giá hiện tại" ("giá 22/10"). Use `DataFreshnessBadge` with `fresh=false` for stale, and `null` for no price.
   - Missing price means market value, P&L and weight show "—" (not 0), and the row is excluded from or flagged in the totals.
   - The net-worth card must carry a visible note when any holding is unpriced or stale ("chưa gồm N mã thiếu giá"). That note is the main honesty risk.
   - Core must expose `priceAsOf`, `fresh` and `missingPrice` per row. Freshness is decided by core or the server and passed in, since the components never read the clock.

**Assets flow (criterion 4)**
7. **Routes.** Reuse STK-008 exactly, with full-page routes:
   - `/assets` list (or a section on `/` with a "Quản lý" link).
   - `/assets/new`, `/assets/[id]/edit`, `/assets/[id]/delete`.
   - Server actions in `apps/web/app/(app)/assets/actions.ts` delegating to `apps/web/server/assets/handlers.ts` with handler tests, and forms using onSubmit+startTransition.
   - The list uses the same `md:table` / cards pattern. Rows show name, type (Tiền mặt / Khác), value in VND and the updated date. Actions are Sửa / Xóa links with `min-h-11`.
   - Delete is a confirm page like `delete-transaction-form`. Nothing is deleted without it.
   - Amount input is an integer VND, with no decimals. Parse and validate in the handler or core (R2), not with `parseInt` in `.tsx`.
   - Reuse `form-fields.tsx` for the labeled field and error-message pattern.
   - Per the R6 suspension, add no auth code. The ticket's "behind auth" is waived.
   - Dashboard stat card "Tiền mặt + tài sản khác" links to `/assets`. Add one "Thêm tài sản" link in the empty assets state.
8. **Empty state (criterion 6).** With no transactions, show `EmptyState` "Chưa có giao dịch" with the action link "Thêm giao dịch đầu tiên" to `/transactions/new`.
   - Cash and other assets still render if any exist, and net worth is shown as cash/assets only. The holdings section carries its own empty state.
   - Show `DisclaimerNote` at the bottom.

**Tests (cheap)**
9. **Core.** Unit tests for the net worth sum, weights (including the sum of weights and a zero-total guard), the concentration flag at the threshold boundary (equal is not over), a missing price (excluded and flagged), a stale price, and sellable quantity passthrough. The R8 requirement is that core logic has tests.
10. **Components.** Render tests like `transactions.test.tsx` and `components.test.tsx`:
    - Holdings: a row with an over-threshold weight shows the warning text, a stale row shows "Dữ liệu cũ", and a missing-price row shows "—" and "Chưa có dữ liệu".
    - Net-worth card: it shows the incomplete-data note.
    - Empty state: the link text and href.
    - Assets list: the edit and delete hrefs.
    - Weight bar: the inline width equals the passed `weightPct`.
11. **Existing guard.** `no-calc-in-ui.test.ts` already covers the new files automatically, so no new test is needed.
12. **Handlers.** Add tests for assets validation (negative or non-integer amount, empty name, unknown id, delete of a missing id), following `handlers.test.ts`.
13. **Contrast.** If you add a `warn`-tinted bar or token, extend `contrast.test.ts` for it.

## Risks
- **Partial totals presented as complete.** An unpriced or stale holding makes net worth look low or wrong. This is the R4 risk, and the visible note in rec 6 is the mitigation.
- **Scope creep from Prompt 1.** The donut, today's change, signals card and sort pull in recharts, previous-close data and the signals pipeline. Keep these out and list them as follow-ups (R7).
- **The no-calc test.** It is a regex check, and `%` literals like `${x}%` pass. Writing `weight * 100`, `.toFixed` or `Math.round` in a component will fail it. All formatting belongs in core formatters.
- **Weights that don't sum to 100%.** Weight needs a defined denominator, and the ticket text doesn't say which. Either holdings-only or net worth would be a legitimate choice. The wrong choice would make the concentration warning misleading.
- **Mobile density.** Ten columns at 375px is unusable, so the card layout is required.
- **Colour-only P&L.** Keep the glyph and sr-label from `TONE_STYLES`. The weight bar and warning must carry a text label as well.
- **Wide-money overflow.** VND values in the billions can overflow stat cards at 375px. Use `text-xl` on mobile and `lg:text-2xl`, or wrap.

## Open questions
1. What is the weight denominator: holdings market value only, or total net worth including cash and other assets? I recommend holdings only, labelled "Tỷ trọng danh mục CP", with the threshold applied to that. Ming should confirm.
2. What is the concentration threshold, and where does the setting live (R5)? Is there a default (e.g. 30%) in config, and is it editable on the Settings screen in this ticket or later?
3. Is "đã chốt" all-time or YTD? The ticket says "realized P&L total", which suggests all-time. Do the lots or ledger give YTD cheaply?
4. What defines stale: the last trading day, or N days? A holiday or weekend must not flag every price as stale. This belongs in core and config.
5. What are the `assets` types in spec §5 (cash only, or also gold, savings or property)? Does cash get a single row or several accounts?
6. Should unpriced holdings fall back to average cost, or be excluded from totals? I recommend excluding with the visible flag, never silently valuing at cost.
7. Do you want the optional stacked allocation bar (stocks / cash / other) in this ticket, or defer it?
