# Stock Investment Assistant — Figma Make Prompts (v1.0 screens)

> Source: [spec-v1.md](spec-v1.md) · Target: Next.js `apps/web` (components ported from Figma Make)
> Date: 2026-10-22

---

## How to use

1. Create **one** Figma Make file for the whole app (keeps one shared component set).
2. Paste **Prompt 0 (Foundation)** first. Check that the shell, types and mock data look right before moving on.
3. Paste **Prompts 1–6** one at a time, in order. After each, check against the "Acceptance" list under that prompt; fix with short follow-up prompts rather than re-pasting.
4. When all screens are done, export the code and follow **Export & port checklist** at the end.

Assumptions (change in Prompt 0 if wrong):
- UI language: **Vietnamese** labels, English code identifiers.
- Symbols in mock data are real tickers with **made-up numbers** — mock only.

---

## Prompt 0 — Foundation (paste first)

```
Build the UI shell for a personal Vietnamese stock portfolio tracker web app. This is a UI prototype whose components will later be ported into a Next.js app, so follow these engineering rules strictly.

TECH
- React + TypeScript, Tailwind CSS, shadcn/ui components, lucide-react icons, recharts for charts.
- No other UI libraries.

ARCHITECTURE RULES (very important)
1. All mock data lives in ONE file: src/mock/mock-data.ts. No data hard-coded inside components.
2. All TypeScript types live in ONE file: src/types/domain.ts.
3. Components are presentational: they receive data and callbacks via props only. No fetch, no localStorage, no global state libraries.
4. NO financial calculations inside components. Every number shown (average cost, market value, P&L, P&L %, weights, totals, sellable quantity) must be a pre-computed field in the mock data. Components only format and display.
5. Formatting helpers (VND, percent, price, date) live in ONE file: src/lib/format.ts.
6. Screens live in src/screens/, reusable pieces in src/components/. Each screen is a component that takes its data as props; App.tsx wires mock data into screens.
7. Login screen: one simple `/login` page (email + password, Vietnamese labels; no sign-up, no password reset). Ming, 2026-11-05.

DOMAIN TYPES (create in src/types/domain.ts)
- Transaction { id, date, symbol, side: 'buy'|'sell', quantity, price, fee, tax, source: 'manual'|'import' }
- CorporateAction { id, symbol, type: 'cash_dividend'|'stock_dividend'|'rights_issue', recordDate, description, applied: boolean }
- Lot { id, symbol, buyDate, quantityRemaining, costPerShare, sellableFrom, status: 'pending'|'sellable' }
- Holding { symbol, exchange: 'HOSE'|'HNX'|'UPCOM', quantity, sellableQuantity, avgCost, lastPrice, marketValue, unrealizedPnl, unrealizedPnlPct, weightPct, overConcentration: boolean, priceUpdatedAt, dataFresh: boolean }
- Asset { id, type: 'cash'|'other', name, value, asOf }
- PortfolioSummary { totalNetWorth, stockValue, cash, otherAssets, unrealizedPnl, unrealizedPnlPct, realizedPnlYtd, dayChange, dayChangePct }
- WatchItem { symbol, group: 'holding'|'watching', exchange, lastPrice, change, changePct, volume, refPrice, ceilingPrice, floorPrice, updatedAt, dataFresh }
- Signal { id, symbol, ruleName, horizon: 'short'|'medium', direction: 'bullish'|'bearish'|'neutral', description, createdAt, dataFresh }
- PricePoint { date, close, volume }
- ImportRow { rowNumber, date, symbol, side, quantity, price, fee, tax, status: 'new'|'duplicate'|'error', errorMessage? }
- ReconcileDiff { symbol, appQuantity, statementQuantity, difference }
- Settings { feeRatePct, sellTaxPct, concentrationThresholdPct, priceLimits: { HOSE, HNX, UPCOM }, settlementDays, rules: { id, name, horizon, enabled, params: Record<string, number> }[] }

MOCK DATA
- About 8 holdings (e.g. FPT, VNM, HPG, MWG, VCB, SSI, DGC, PNJ) and 6 watching-only symbols, ~30 transactions over the last 6 months, 3 corporate actions, 2 lots still 'pending' (T+2 not reached), 1 holding with overConcentration = true, 1 symbol with dataFresh = false.
- Prices in thousand VND with 2 decimals (e.g. 125.40), money values in VND.

LAYOUT SHELL
- Left sidebar navigation (collapsible on mobile): Tổng quan, Sổ giao dịch, Nhập sao kê, Danh sách theo dõi, Cài đặt. Symbol detail opens from any symbol link (no sidebar item).
- Top bar: app name placeholder "Stock Assistant", last data update time, a data-freshness indicator, light/dark toggle.
- Use simple in-app state in App.tsx to switch screens (no router library).

VISUAL STYLE
- Clean, dense, professional finance UI. Neutral background, high contrast, tabular (monospace) numbers, right-aligned numeric columns.
- Vietnamese market color convention: up = green, down = red, unchanged/reference = yellow, ceiling = purple, floor = cyan.
- Light and dark themes via Tailwind dark: classes.
- Desktop-first, usable down to 375px width (tables scroll horizontally inside their card, page itself never scrolls sideways).

SHARED COMPONENTS (create now, reuse later)
- PriceChange (value + percent with market colors), MoneyText (VND formatting), DataFreshnessBadge (shows "Dữ liệu cũ" warning when dataFresh = false), LotStatusBadge (pending / sellable with sellable date), SymbolLink, StatCard, EmptyState, DisclaimerNote ("Thông tin chỉ mang tính tham khảo, không phải khuyến nghị đầu tư").

For now, show a placeholder for each screen. Do not build the screens yet.
```

**Acceptance**
- `src/mock/mock-data.ts`, `src/types/domain.ts`, `src/lib/format.ts` exist; no numbers hard-coded in components.
- Sidebar with 5 items, dark mode works, shared components exist.

---

## Prompt 1 — Dashboard (Tổng quan)

```
Build the Dashboard screen (src/screens/DashboardScreen.tsx) using the existing types, mock data and shared components. Follow all architecture rules from before: props only, no calculations in components.

Content, top to bottom:
1. Stat cards row: Tổng tài sản, Giá trị cổ phiếu, Tiền mặt, Lãi/lỗ chưa chốt (value + %), Lãi/lỗ đã chốt YTD, Biến động hôm nay. Data from PortfolioSummary.
2. Two columns:
   - Left (wider): Holdings table — Mã (SymbolLink), Sàn, KL, KL khả dụng, Giá vốn TB, Giá hiện tại, Giá trị, Lãi/lỗ, % Lãi/lỗ, Tỷ trọng. Rows with overConcentration show a warning icon on Tỷ trọng; rows with dataFresh = false show DataFreshnessBadge. Sortable column headers (sorting is UI-only on already-computed fields).
   - Right: Allocation donut chart by weightPct (recharts) + legend; below it a "Cảnh báo" card listing over-concentrated holdings and stale-data symbols.
3. "Tín hiệu gần đây" card: latest 5 medium-term signals (ruleName, symbol, direction badge, time), each with DataFreshnessBadge. Link "Xem tất cả" (no-op).
4. DisclaimerNote at the bottom.

Empty state when there are no holdings: EmptyState with a button "Thêm giao dịch đầu tiên" (calls an onAddTransaction prop).
```

**Acceptance**
- Every number comes from `PortfolioSummary` / `Holding` fields; no `reduce`/`sum` in components.
- Over-concentration and stale data visibly flagged.

---

## Prompt 2 — Transactions ledger (Sổ giao dịch)

```
Build the Transactions screen (src/screens/TransactionsScreen.tsx). Props only, no calculations in components.

1. Header with buttons: "Thêm giao dịch", "Thêm sự kiện quyền" (corporate action), "Nhập sao kê" (navigates to import screen via onNavigate prop).
2. Filters bar: symbol search, side (Tất cả / Mua / Bán), date range, source (Tất cả / Nhập tay / Sao kê).
3. Tabs: "Giao dịch" and "Sự kiện quyền".
   - Giao dịch table: Ngày, Mã, Loại (Mua/Bán badge), KL, Giá, Phí, Thuế, Nguồn, actions (Sửa, Xóa). Pagination.
   - Sự kiện quyền table: Ngày chốt, Mã, Loại (Cổ tức tiền / Cổ tức cổ phiếu / Quyền mua), Mô tả, Đã áp dụng (badge).
4. "Thêm giao dịch" opens a Sheet (side panel) form: Ngày, Mã (combobox from symbols in mock data), Loại (Mua/Bán), Khối lượng, Giá (thousand VND), Phí, Thuế (shown only for Bán). Show inline validation messages for: quantity must be a multiple of 100 (with an "lô lẻ" checkbox to allow odd lots), price must be > 0, sell quantity cannot exceed sellable quantity (use a sellableQuantity value passed in via props for the selected symbol, do not compute it). Submit calls onSubmitTransaction(formValues) — no state mutation beyond the form.
5. "Thêm sự kiện quyền" opens a similar Sheet form: Mã, Loại, Ngày chốt, Tỷ lệ / Số tiền, Mô tả. Submit calls onSubmitCorporateAction.
6. Delete asks for confirmation in an AlertDialog.
```

**Acceptance**
- Forms call callbacks only; validation messages visible; sell-quantity check uses a passed-in value.

---

## Prompt 3 — Statement import & reconciliation (Nhập sao kê)

```
Build the Import screen (src/screens/ImportScreen.tsx). Props only, no parsing or calculations in components — parsed rows and diffs come from mock data.

Step indicator with 3 steps:
1. "Tải file": drag-and-drop zone for a CSV file plus a short note "Xuất sao kê lệnh khớp từ TCInvest dưới dạng CSV". On file select, call onFileSelected(file). Show the selected file name.
2. "Xem trước": table of ImportRow — Dòng, Ngày, Mã, Loại, KL, Giá, Phí, Thuế, Trạng thái (badge: Mới / Trùng / Lỗi with errorMessage tooltip). Summary chips above the table: số dòng mới, trùng, lỗi. Toggle "Chỉ hiện dòng lỗi". Buttons: "Quay lại", "Nhập N dòng mới" (calls onConfirmImport).
3. "Đối soát": table of ReconcileDiff — Mã, KL trong app, KL theo sao kê, Chênh lệch. Rows with difference ≠ 0 highlighted with a warning style and a short hint "Kiểm tra giao dịch hoặc sự kiện quyền bị thiếu". If no differences, show a success state "Khớp với sao kê".

Use mock ImportRow and ReconcileDiff arrays that include at least 2 duplicates, 1 error row and 2 symbols with differences.
```

**Acceptance**
- No CSV parsing logic in components; three steps navigable; differences clearly highlighted.

---

## Prompt 4 — Symbol detail (Chi tiết mã)

```
Build the Symbol detail screen (src/screens/SymbolDetailScreen.tsx), opened when any SymbolLink is clicked. Props only, no calculations in components.

1. Header: symbol, exchange badge, last price with PriceChange, ref / ceiling / floor prices in their market colors, volume, updatedAt + DataFreshnessBadge. Button "Thêm vào theo dõi" / "Bỏ theo dõi".
2. Price chart (recharts): close price line + volume bars, range tabs 1T / 3T / 6T / 1N (mock PricePoint arrays per range). Show a gap marker area if the mock data has a missing-days range.
3. If the symbol is held — "Vị thế" card: KL, KL khả dụng, Giá vốn TB, Giá trị, Lãi/lỗ, Tỷ trọng; then "Các lô" table: Ngày mua, KL còn lại, Giá vốn, Ngày được bán, Trạng thái (LotStatusBadge — pending lots clearly show "Chưa về (T+2)").
4. "Tín hiệu" card with tabs Ngắn hạn / Trung hạn: list of Signal (ruleName, direction badge, description, time, DataFreshnessBadge). If data is stale, show a notice "Tín hiệu tạm ẩn do dữ liệu chưa cập nhật" instead of the list.
5. "Giao dịch của mã này": compact transactions table filtered to this symbol (filtered list passed via props).
6. DisclaimerNote.

Provide a back button to the previous screen via an onBack prop.
```

**Acceptance**
- Pending (T+2) lots unmistakable; stale data hides signals; ceiling/floor/ref colors correct.

---

## Prompt 5 — Watchlist (Danh sách theo dõi)

```
Build the Watchlist screen (src/screens/WatchlistScreen.tsx). Props only, no calculations in components.

1. Tabs: "Đang nắm giữ" (group = holding) and "Đang theo dõi" (group = watching), with counts.
2. Price board style table: Mã, Sàn, Giá tham chiếu, Trần, Sàn, Giá hiện tại, +/-, %, KL, Cập nhật. Cell text uses the Vietnamese market colors (up green, down red, ref yellow, ceiling purple, floor cyan). Rows with dataFresh = false are dimmed with DataFreshnessBadge.
3. "Thêm mã" input with combobox; calls onAddSymbol(symbol). Each watching row has a remove action calling onRemoveSymbol. Holding rows cannot be removed (tooltip explains why).
4. Top-right: last refresh time and a note "Giá có thể trễ vài phút".
```

**Acceptance**
- Board readable at a glance; colors follow VN convention; holding rows not removable.

---

## Prompt 6 — Settings (Cài đặt)

```
Build the Settings screen (src/screens/SettingsScreen.tsx). Props only; on save call onSaveSettings(values).

Sections (cards):
1. "Phí & thuế": Phí giao dịch (%), Thuế bán (%), with helper text "Kiểm tra lại biểu phí TCBS hiện tại".
2. "Quy tắc thị trường": Biên độ giá HOSE / HNX / UPCOM (%), Số ngày thanh toán (T+), helper text "Cấu hình — xác minh với quy định sàn hiện hành".
3. "Danh mục": Ngưỡng cảnh báo tỷ trọng (%).
4. "Quy tắc tín hiệu": list of rules grouped by horizon (Ngắn hạn / Trung hạn). Each rule row: name, enabled Switch, and its numeric params as small inputs (e.g. MA ngắn 20, MA dài 50, RSI quá mua 70, RSI quá bán 30, Hệ số KL đột biến 2.0, P/E so với ngành ±%).
5. "Tài sản khác": table of Asset (Loại, Tên, Giá trị, Ngày cập nhật) with add/edit/delete via a Dialog; calls onSaveAsset / onDeleteAsset.

Sticky footer with "Lưu thay đổi" (disabled until something changes) and "Hủy".
```

**Acceptance**
- All config values from `Settings` mock; rule params editable; save disabled until dirty.

---

## Follow-up prompts (use as needed)

- "Move any hard-coded numbers you find in components into src/mock/mock-data.ts and pass them as props."
- "Remove any calculation (sum, average, percentage, reduce) from components; add the pre-computed field to the mock data and types instead."
- "Make [table] usable at 375px: keep the page width fixed and let the table scroll horizontally inside its card."
- "Check dark mode on [screen]; fix any text with insufficient contrast."

---

## Export & port checklist

**After export**
- [ ] Replace `figma:asset/...` imports with files under `public/` or `src/assets/`.
- [ ] Normalize version-suffixed imports (e.g. `pkg@1.2.3`) to plain package names and add them to `package.json`.
- [ ] Search components for `reduce(`, `* 100`, `/ ` in JSX — any calculation left must be removed.

**Port into Next.js (`apps/web`)**

| Figma Make | Next.js |
|---|---|
| `src/components/*` | `apps/web/components/*` (add `"use client"` only where there is interaction) |
| `src/screens/XScreen.tsx` | `apps/web/app/(app)/<route>/page.tsx` renders the screen; data loaded server-side |
| `src/types/domain.ts` | `packages/core/src/types.ts` (single source; web and worker import it) |
| `src/lib/format.ts` | `packages/core/src/format.ts` |
| `src/mock/mock-data.ts` | Kept only for Storybook/tests; replaced by `packages/core` + DB queries in pages |
| App.tsx screen switching | Next.js routes: `/`, `/transactions`, `/import`, `/watchlist`, `/settings`, `/symbols/[symbol]` |
| Callback props (`onSubmitTransaction`, …) | Server Actions or API routes, behind auth (`requireUser()`) |
