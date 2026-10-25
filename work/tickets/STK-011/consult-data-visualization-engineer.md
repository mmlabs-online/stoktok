# consult-data-visualization-engineer — STK-011

## STK-011 consult: Watchlist price board (ui/data)

### Findings

**Data gaps that decide the design (read these first)**
1. **No exchange per symbol anywhere.** `watchlist` has only `symbol, group_name, added_at`. `prices_daily` has no exchange column. `MarketRules.priceLimitPpm` is keyed by `Exchange`. `grep exchange` in packages returns only `market-rules.ts`. So ref/ceiling/floor cannot be computed from stored data alone. This is a blocker for AC2.
2. **No reference price is stored.** The reference is the previous trading day's close, or an adjusted reference after a corporate action. The board needs the last two `prices_daily` rows per symbol. The current `PriceQuote` has a single close with no volume. The planner must add a "latest two closes + volume" query, or a new repo function. That function also feeds the holdings-group quotes.
3. **Rounding is not defined.** HOSE ceiling and floor are rounded to the tick size, and tick size depends on price band. The tick table is exchange configuration (R5). This is not a plain `ref * (1 ± ppm)`. If it is ignored, ceiling and floor are wrong by up to a tick, and `priceTone`'s `>= ceiling` comparison misfires. This must be settled in core and recorded as a rule.
4. `priceTone` throws on `floor > ref` or `ceiling < ref`, and `assertVnd` throws on non-integers. Page code must not let one bad symbol crash the whole board. Use a per-row try/catch in the loader, or have the core helper return null.
5. Reusable pieces already exist:
   - `TONE_STYLES` has glyph, tag and `srLabel` for all 5 tones. Ceiling shows "Trần" and floor shows "Sàn". Color is therefore already never the only signal.
   - `PriceChange` takes change, changePct (ppm) and tone.
   - `DataFreshnessBadge` takes `fresh: boolean|null`.
   - `SymbolLink`, `EmptyState`, and `priceStatus`/`expectedPriceDate` in core.
   - HoldingsTable's `badgeFresh` mapping (fresh→true, stale→false, missing→null) is a good template, but it is private to that file.
6. HoldingsTable already uses the dual layout: `table hidden md:table` plus `ul md:hidden` cards. No `overflow-x-auto` pattern is used. Follow it.
7. `no-calc-in-ui` forbids `.toFixed`, `Math.`, `*/ 100`, `/1000`, `reduce(`, `new Date(` in components and app `.tsx`. Counts such as "Đang nắm giữ (3)" must come from `.length` or from a core or loader field. `.length` is OK.
8. Prompt 5 asks for tabs. The ticket says "groups". Tabs hide half the board and need client state. They also fight the "holding is also watched" case.
9. The R6 waiver means no auth code. Keep handlers in `apps/web/server/watchlist/handlers.ts` with `getDb()` passed in, like assets, so `requireUser()` is one line per action later.

### Recommendations

**Layout (AC2, AC3)**
- Use **two stacked sections** with `<h2>` and a count: "Đang nắm giữ (n)" and "Đang theo dõi (n)". Do not use tabs. This is a deviation from Prompt 5 and should be flagged to Ming. Reasons:
  - No client state.
  - The page is scannable top to bottom.
  - The server component stays simple.
  - The set is small (single user).
- **Desktop (md+)**: one `PriceBoard` table per group. Columns: Mã, Sàn, TC, Trần, Sàn(floor), Giá, +/-, %, KL, Cập nhật. Right-align with `num`. For the floor column, use the header "Sàn" for the floor price and label the exchange column "Thị trường" or "HOSE". Prompt 5 uses "Sàn" for both and that is ambiguous.
- **375px**: cards as `<li>`, like HoldingsTable.
  - Line 1: SymbolLink and exchange chip on the left, a remove button on the right (watching only).
  - Line 2: big price with `PriceChange` below it.
  - Line 3: a compact "TC / Trần / Sàn" strip of three small cells, each with a label and a value. See below.
  - Line 4: KL and freshness.
  - No horizontal scroll. Use at least 44px (`min-h-11`) tap targets for remove.
- Share one `PriceBoardRow` view-model type. Build it in the loader with `formatPrice`/`formatQuantity` called only in components.

**Ref / ceiling / floor compactly**
- Each of the three values is a text cell with a **short label and a glyph**, colored by its own tone: TC with ■ in yellow, Trần with ▲ in purple, Sàn with ▼ in cyan. Use the `TONE_STYLES[...].text` and `.glyph` classes. Do not add a second tone map. On mobile, render labels visibly as "TC 25,40 · Trần 27,15 · Sàn 23,65" in `text-xs`. The label and glyph carry meaning, and the color is reinforcement.
- Current price: apply the `priceTone` result. When the price is at the ceiling or floor, `PriceChange` already shows a "Trần"/"Sàn" tag and an `srLabel`. Also tint the row with `TONE_STYLES.bg` for those two states only. Do not tint every row, because it is noisy.
- Yellow on a light theme has contrast risk. `test/contrast.test.ts` already exists. Verify that `price-ref` and `price-ref-bg` are covered for both themes. Purple versus down-red and cyan versus up-green are hard under CVD, so the glyph and label matter.
- Do not add sparklines or bars. Not needed for an EOD board.
- Rule 4 of the viz brief: do not draw a "position within the limit band" bar unless asked. It is an extra encoding with no AC.

**Add symbol (AC1, AC5)**
- Use an **inline form** above the Watching table, a one-line input plus an "Thêm mã" button.
  - It is a single field, so a page is overkill.
  - The page reload when navigating away would lose the board.
  - Pattern: a `'use client'` form with `onSubmit` + `e.preventDefault()` + `startTransition(() => formAction(fd))`, as in `AssetForm`. Do not use `<form action>`, because React 19 resets the field.
  - Use `useActionState` with the same `FormState` shape `{ok, fieldErrors, values, formError}`.
  - Keep the typed value in `values` on error so the user can fix it. Clear it on success. On success, the action calls `revalidatePath('/watchlist')` and does not redirect, because the user stays on the page.
- Validation lives in the handler, using `normalizeSymbol` (3 to 10 chars A-Z0-9). The DB check allows 1 to 20, so the core rule is stricter. That is fine, but the planner should note the mismatch.
- Messages in Vietnamese, in `FormBanner` / field error with `aria-describedby`:
  - Invalid format: "Mã gồm 3-10 ký tự chữ hoặc số".
  - Duplicate: map `DataError CONFLICT` to "Mã đã có trong danh sách theo dõi".
  - A symbol already held: reject or accept? See open questions.
- Do not build a combobox with autocomplete. There is no symbol master table, so there is nothing to suggest. A plain text input with `autoCapitalize="characters"`, `autoComplete="off"` and `inputMode="text"` is enough. Say this to Ming as a deliberate departure from Prompt 5.
- A new symbol has no price until the next EOD sync (AC5: it joins the sync set). Show the row immediately with "Chưa có dữ liệu" (`DataFreshnessBadge fresh=null`) and a one-line hint. Do not make the user guess whether the add worked.
- AC5 means the worker's symbol set must be the union of holdings and watchlist. Confirm that the worker reads `listWatchlist`, and add a test on that union function.

**Remove symbol**
- **No confirm dialog.** It is a cheap, reversible action (re-adding takes five seconds, and no data is lost). A confirm dialog would add a second tap for no gain.
- Use a plain icon button with a visible label on mobile ("Bỏ theo dõi") and `aria-label="Bỏ theo dõi {symbol}"` on desktop. Put it in a `<form>` with a hidden symbol field and `useActionState` or a bound action. Show `FormBanner` errors per row (for example NOT_FOUND, which should be treated as success, because the end state is what the user wanted).
- Make the action idempotent: swallow `NOT_FOUND`.
- Holding rows get no remove button. Prompt 5 asks for a tooltip, but tooltips do not exist on touch. Show a muted text "Đang nắm giữ" or a disabled lock-style control with `aria-disabled` and visible helper text "Tự động theo danh mục" under the group header. No tooltip needed.

**Held and watched at once**
- Holdings group is derived and the watchlist table is stored, so the same symbol can legitimately be in both.
- Recommendation: **show it once, in Holdings only.** Filter it out of the Watching list in the loader (a core or loader function, with a test). The row in Holdings carries a small badge "Đang theo dõi" so the user knows it is also stored.
  - Duplicated rows would double the count and confuse the "n" in the headings.
  - Removal from the watchlist stays possible. Offer it as a text link on that held row ("Bỏ khỏi danh sách theo dõi"), or else a symbol that is sold later would reappear unexpectedly in Watching. This is the one case where a hidden stored row matters.
- Simplest alternative if the planner wants to stay inside scope: just hide the duplicate, with no badge and no link. The ticket does not specify this, so confirm with Ming (R7).
- A symbol that was held and then fully sold drops out of Holdings automatically. If it is in the watchlist it appears in Watching. That is correct behavior.

**Per-row freshness (AC4, R4)**
- Compute status in the loader with `expectedPriceDate` and `priceStatus` from core, using `settings.holidays` and the cutoff the dashboard loader already uses. Do not call `new Date()` in components. Use `server/clock.ts`.
- Pass `fresh` (true/false/null) to `DataFreshnessBadge`. Extract the `badgeFresh` mapping from `holdings-table.tsx` into a shared helper only if it does not widen the diff. Otherwise duplicate the one line.
- Display for each row: "Cập nhật {fetchedAt}" with `formatDateTime` (shown always on the board, since AC4 says last update time per symbol), plus the trade date ("giá {formatDate(tradeDate)}") when it differs from the expected date.
- Stale rows: dim the text (`opacity-60`) and show the badge with its icon and "Dữ liệu cũ". Keep the dimming secondary. Opacity alone would fail the "color not the only signal" rule, and the badge text is the real signal.
- **Stale or gapped data must not show a ceiling/floor tone as if it were current.** A stale close with a computed tone is misleading. Recommendation: for stale rows, still show the last close, but render the tone as neutral and omit the Trần/Sàn tag. This is a judgment call, so list it as an open question.
- Gapped: the data layer records gaps in `data_gaps`. If STK-006 exposes a per-symbol gap query, mark gapped symbols with the same warning style. If it does not, flag it as a follow-up and treat stale and missing as the AC4 minimum.
- Page header, top right (Prompt 5 point 4): "Giá có thể trễ vài phút" and last refresh (the max `fetchedAt` across rows). The max must be computed in the loader, not in the component. Note the data is EOD, so "trễ vài phút" is misleading. Suggest "Giá đóng cửa phiên gần nhất" as the wording. Ask Ming.

**Empty states (use `EmptyState`)**
- No holdings and no watching: one `EmptyState` with the title "Chưa có mã nào" and a description pointing to the add form and to `/transactions/new`.
- Holdings empty: a short `EmptyState` inside the section, "Chưa nắm giữ mã nào. Danh sách này tự cập nhật từ giao dịch" with a link to add a transaction.
- Watching empty: `EmptyState` with the description "Thêm mã để theo dõi giá" and keep the add form **visible above it**. The form must stay reachable in the empty case.
- A symbol with no price yet: row stays, values show "—", badge "Chưa có dữ liệu". No zeroes and no fake tone.

**Cheap tests (R8)**
1. **Core (required by AC6)**: `priceBand({ref, limitPpm})` or similar in `packages/core`, returning `{ceiling, floor}` as integer VND. Cover:
   - HOSE ±7% on a round reference.
   - HNX ±10%, UPCoM ±15%.
   - Tick rounding at band edges (ceiling rounded down, floor rounded up, which is the standard rule, to be verified).
   - A non-integer or negative ref throws.
   - Limit 0 gives ceiling = floor = ref.
   - Ppm inputs from `DEFAULT_MARKET_RULES` and from a custom config (R5: no hard-coded 0.07 in the helper).
   - Then `priceTone` round trip: a price equal to ceiling gives 'ceiling', one equal to ref gives 'ref'.
2. **Core or loader**: `splitWatchlist(holdings, watchlist)` returns `{holding, watching}` with the held-and-watched symbol only in holding. Pure and tiny. Also test the symbol-set union for the worker.
3. **Loader** (`server/watchlist/load-watchlist.test.ts`, modeled on `load-dashboard.test.ts`): fresh, stale, missing; a single missing previous close (no ref) gives no band; an unknown exchange.
4. **Handlers** (`handlers.test.ts`, modeled on assets): invalid symbol, duplicate gives CONFLICT message, success, remove NOT_FOUND is treated as success, `isUuid` is not needed (symbol, not an id), but the handler must run the symbol through `normalizeSymbol` before the DB call.
5. **Component tests** in `components.test.tsx` style with `renderToStaticMarkup`:
   - Ceiling row contains the text "Trần" and the `srLabel`, plus `text-price-ceiling`. This asserts that color is not the only signal.
   - A stale row contains "Dữ liệu cũ".
   - A holding row has no remove control.
   - The empty states render.
6. `no-calc-in-ui` runs unchanged. Watch for `/ 100` in any formatting code you add.

### Risks
- **Exchange source is the main risk.** Options: (a) add a column `exchange` to `watchlist` (a migration, which triggers `database-optimizer` and the security audit because it touches migrations) and a per-symbol exchange for holdings; (b) a static symbol-to-exchange map in config (R5 says configuration, not code); (c) a worker fetch from the market adapter (STK-005 may already receive it, but `prices_daily` does not store it). A wrong exchange gives a wrong ceiling and floor, which is a quietly misleading number. Show "—" rather than guess when the exchange is unknown.
- The tick-size table and the rounding direction are market rules that must be verified before go-live (consistent with the CLAUDE.md note) and kept in configuration.
- Reference price after a corporate action (ex-dividend, split) differs from the previous close. Using the previous close then shows a false limit band on ex-dates. Either flag the row, or record a follow-up. Do not silently ignore.
- R4: the "change" and "%" come from two stored closes. If the previous close is missing (a gap), omit change and the band instead of computing against an older day.
- Yellow (ref) text contrast on the light theme, and green/purple and red/cyan pairs for CVD users. Glyphs and tags mitigate this. Verify in `contrast.test.ts`.
- Scope: combobox, tabs, tooltips, sparkline and confirm dialogs are all in Prompt 5 or tempting, and all are optional. Per R7, keep them out unless Ming asks.
- Server-action revalidation: adding a symbol does not fetch a price, so the new row stays empty until the worker runs. Users may think it is broken without the hint.

### Open questions (for Ming or the planner)
1. Where does the exchange per symbol come from (migration column, config map, or adapter)? Needed for AC2.
2. Is the reference price simply the previous trading day's close for v1, with corporate-action adjustment deferred?
3. Which tick-size and rounding rule should the core helper use, and is it already in `settings.rule_configs`?
4. Held and watched: hide it from Watching (recommended), or show in both?
5. May adding a symbol that is already held be rejected, or accepted silently?
6. OK to replace tabs with two stacked sections, and the combobox with a plain input? Both depart from Prompt 5.
7. For stale rows, suppress the ceiling/floor tone (recommended), or show the last close's tone dimmed?
8. Is "Giá có thể trễ vài phút" correct, given the data is end-of-day?
9. Does STK-006 expose per-symbol gaps (`data_gaps`) for the "gapped" flag in AC4?

Files read: /home/user/stoktok/work/tickets/STK-011/ticket.md, /home/user/stoktok/docs/figma-make-prompts.md, /home/user/stoktok/apps/web/components/{tone.ts,price-change.tsx,data-freshness-badge.tsx,symbol-link.tsx,empty-state.tsx,portfolio/holdings-table.tsx,assets/asset-form.tsx,assets/delete-asset-form.tsx}, /home/user/stoktok/apps/web/app/(app)/{watchlist/page.tsx,assets/actions.ts}, /home/user/stoktok/apps/web/test/no-calc-in-ui.test.ts, /home/user/stoktok/packages/core/src/{tone.ts,portfolio/freshness.ts,settings/market-rules.ts,symbol.ts}, /home/user/stoktok/packages/db/src/repos/watchlist.ts, /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql.
