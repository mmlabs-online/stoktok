Status: READY

# Plan — STK-035: Medium-term signals on the symbol screen

## Spec summary
- docs/spec-v1.md §3 F4: "Medium term (1–6 months) | P/E and P/B vs sector, earnings growth trend, plan completion vs annual target, price vs 50/200-day MA | Daily OHLCV, quarterly financials". "Signals are suppressed if the underlying data is stale or has gaps." "Each signal stores its inputs (snapshot) so it can be audited later."
- docs/spec-v1.md §2.3: "The UI shows a persistent "reference only, not investment advice" notice on suggestion views."
- docs/spec-v1.md §2.2: "Every price carries a `fetched_at` timestamp and a source." "Gaps must be detected, not silently interpolated."
- CLAUDE.md R4: "Every market-data record carries `source` and `fetched_at`. Stale or gapped data never produces a signal; gaps are recorded." R9: "every factual claim cites a stored input ID". R10: "no order placement". R1: "Cost basis, P&L, weights, sellable quantity, fees, tax, signals live in `packages/core` only. Components format and display."
- Ticket goal: "`/symbols/[symbol]` lists the stored medium-term signals with their inputs, hidden with an explanation when data is stale."

This ticket only reads and displays rows the STK-015 worker has already stored. It adds no new rule, and it does not include "plan completion vs annual target", which is not built yet.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Medium-term signals with their inputs (each cited ref shows source and fetched_at); labels are directions only, never buy/sell. | `present.test.ts › ok row: direction, value text and one input per cited ref with source + fetched_at`, `› MA row adds a window summary line (count, from–to, sources, fetched range)`, `› price/financials/sector ref without source or fetchedAt → row hidden as snapshot_invalid`. `labels-vi.test.ts › no label contains an action word`. `signals-section.test.tsx › ok row renders source and "Cập nhật"` and `› no action words in the rendered section (disclaimer excluded)`. Waiver for gap and corporate-action refs: see Assumption D3. |
| 2 | Hidden with an explanation and the last signal date when stale (signal_date before the expected price date, or an open gap overlaps its window). Visibility is decided in `packages/core`, with unit tests. | `visibility.test.ts` (the full list is under Tests). `present.test.ts › all rows hidden → section kind 'hidden' with lastSignalDate and cause texts`. `signals-section.test.tsx › hidden state shows "Tín hiệu gần nhất" and no direction/value text`. `load-symbol.test.ts › signals hidden when signal_date < expected date`. |
| 3 | Suppressed rows show Vietnamese reasons from an exhaustive reason-code label map. | `labels-vi.ts` has `REASON_LABELS` typed `satisfies Record<ReasonCode, string>`, so `pnpm typecheck` fails if a code is missing. `labels-vi.test.ts › every REASON_ORDER code has a non-empty label without "_"` and `› unknown code → "Lý do khác (<code>)"`. `signals-section.test.tsx › suppressed row lists each Vietnamese reason as <li>, never the raw code`. |
| 4 | New db read `listLatestSignals` with tests. Disclaimer notice shown. | `packages/db/src/repos/signals.test.ts › listLatestSignals …` (cases under Tests). `signals-section.test.tsx › DISCLAIMER_TEXT present in empty, hidden and list states`. |
| — | Checks (R8) | `pnpm typecheck && pnpm lint && pnpm test` all green, including the existing `no-calc-in-ui.test.ts` and `no-hardcoded-rules.test.ts`. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/signals/types.ts` | Add `parseMaRuleId(id): number \| null` next to `maRuleId`, `isReasonCode(s): s is ReasonCode`, and the `StoredSignal` interface (the domain shape of a stored row). | One ID parser shared by the visibility and label code. The db mapper's return type. |
| `packages/core/src/signals/visibility.ts` (new) | `expectedRuleIds(rules)`, `parseSignalSnapshot(row)`, `signalVisibility(row, ctx)`. | AC2: visibility is decided in core. Also builds the rule-ID filter for AC4. |
| `packages/core/src/signals/visibility.test.ts` (new) | Unit tests for the file above. | AC2, R8 |
| `packages/core/src/signals/labels-vi.ts` (new) | `RULE_LABELS`, `ruleName(id)`, `DIRECTION_LABELS`, `REASON_LABELS`, `reasonLabel(code)`, `VISIBILITY_LABELS`. | AC3, AC1 |
| `packages/core/src/signals/labels-vi.test.ts` (new) | Exhaustiveness, no code leakage, banned-word scan. | AC1, AC3 |
| `packages/core/src/signals/present.ts` (new) | `presentMediumSignals(...)` → `SignalsSectionVM`. All value text, input lines and date text are built here. | R1: the component only renders strings. |
| `packages/core/src/signals/present.test.ts` (new) | Unit tests for the view model. | AC1–AC3, R8 |
| `packages/core/src/market/quarters.ts` | Add `export const FINANCIALS_GAP_TYPE = 'financials'`. | The web app needs it. Same move STK-034 made for `PRICES_GAP_TYPE` (finance consult R-7). |
| `packages/core/src/index.ts` | Export the new functions, constants and types. | Public API |
| `apps/worker/src/jobs/financials-sync.ts` | Replace the local constant with `import { FINANCIALS_GAP_TYPE } from '@stoktok/core'` plus `export { FINANCIALS_GAP_TYPE }`. | One definition. `store.ts` and `medium-signals.ts` imports stay unchanged. |
| `packages/db/src/rows.ts` | Add `SignalRow` (selected columns). | Typed read |
| `packages/db/src/mappers.ts` | Add `signalFromRow(row): StoredSignal`. | Row → domain mapping, safe integers (R2) |
| `packages/db/src/repos/signals.ts` | Add `listLatestSignals(db, symbol, ruleIds)`. | AC4 |
| `packages/db/src/repos/signals.test.ts` | Tests for `listLatestSignals` and the mapper. | AC4, R8 |
| `packages/db/src/index.ts` | Export `listLatestSignals`. | Web reads it through `server/db.ts` |
| `apps/web/server/symbols/load-symbol.ts` | Read the signal rules, the price and financials gaps, and the latest signals. Call `presentMediumSignals`. Add `signals: SignalsSectionVM` to `SymbolView`. | Server-only orchestration (R3) |
| `apps/web/server/symbols/load-symbol.test.ts` | Mock `getSignalRules` and `listLatestSignals`, and add the wiring tests. | AC2, AC4 |
| `apps/web/components/symbol/signals-section.tsx` (new) | Presentational section. It renders the view model's strings and does no logic. | UI |
| `apps/web/components/symbol/signals-section.test.tsx` (new) | Render tests for the section. | AC1–AC4 |
| `apps/web/app/(app)/symbols/[symbol]/page.tsx` | Render `<SignalsSection>` full-width between `PriceChart` and the two-column grid. | Placement |

No migration and no RLS change: `signals` already grants select to `service_role` only.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `visibility.test.ts › expectedRuleIds: defaults → pe, pb, growth, price_vs_ma_50, price_vs_ma_200 in that order` | AC4, orphan rows |
| `› expectedRuleIds: disabled valuation/growth/MA left out; MA 20/100 settings → price_vs_ma_20/100` | Default D2 |
| `› parseMaRuleId: 'price_vs_ma_50' → 50; 'price_vs_ma_x', 'price_vs_ma_' and 'pe_vs_sector' → null` | ID parsing |
| `› signal date equal to the expected date → not outdated; one day before → signal_outdated; after → not outdated` | AC2 (a) |
| `› expected date on Monday before the cutoff is the previous Friday (row dated Friday stays visible); after the cutoff it is Monday (hidden)` | AC2 (a). Uses `expectedPriceDate` in the test, not in visibility |
| `› holiday: expected date skips the holiday` | AC2 (a) |
| `› MA row: open symbol price gap inside [window.fromDate, signalDate] → price_gap_open with gap ids and VN dates` | AC2 (b) |
| `› MA row: market-wide gap (symbol null) → hidden; gap on another symbol → ignored` | AC2 (b) |
| `› MA row: gap touching only the window's first day → hidden; gap ending the VN day before fromDate → visible` | Boundaries |
| `› MA row with window.fromDate null → window from subtractTradingDays(signalDate, N−1, holidays)` | Window fallback |
| `› P/E row: price gap on signalDate only → hidden; price gap the day before → visible` | Valuation price window |
| `› P/E epsBasis 'ttm' → 1-quarter window; 'quarterly'/'unverified'/missing → 4 quarters ending at L` | Financials window |
| `› P/B: financials gap on L → hidden; gap on L−1 with no cited L−1 ref → visible` | P/B window (req 1) |
| `› growth with snapshot params.comparisons = 8 → 12-quarter window; comparisons missing → current rules value` | Growth window |
| `› financials refs absent → window derived from L only` | Fallback |
| `› cited period older than L−(req−1) widens the window to that period` | Window min |
| `› rule_version ≠ RULE_VERSION → rule_version_outdated` | Default D6 |
| `› malformed snapshot (not an object, refs not an array, ref without string 'ref', unparsable fetchedAt, unknown ref prefix) → snapshot_invalid, never throws` | Defensive parse |
| `› prices_daily/financials/symbols ref without source or fetchedAt → snapshot_invalid` | R4, AC1 |
| `› stale outranks suppressed: suppressed row with signal_outdated → hidden` | State precedence |
| `› fresh suppressed row → { state: 'suppressed', reasons }; fresh ok row → { state: 'ok' }` | States |
| `› several causes are all reported in fixed order` | Explanation completeness |
| `labels-vi.test.ts › every REASON_ORDER code has a non-empty Vietnamese label without "_"` | AC3 |
| `› reasonLabel: unknown code → "Lý do khác (<code>)"; isReasonCode false for it` | AC3, forward-compat |
| `› every VisibilityCode and SignalLabel has a label` | AC2, AC1 |
| `› ruleName: pe/pb/growth fixed labels; price_vs_ma_20 → "Giá so với MA20"; unknown id → the raw id` | Labels |
| `› no label contains an action word` (tokenised scan, see Approach 3) | AC1, R9/R10 |
| `present.test.ts › ok row: direction, value text and one input per cited ref with source + fetched_at` | AC1 |
| `› P/E value −124000 → "P/E thấp hơn trung vị ngành 12,40% (6 mã cùng ngành)"; +ve → "cao hơn"; 0 → "bằng"` | Value text |
| `› MA value +32000 on price_vs_ma_50 → "Giá trên MA50 3,20%"; negative → "dưới"; 0 → "bằng"` | Value text |
| `› growth value 3 → "Lợi nhuận tăng 3 quý liên tiếp (so cùng kỳ)"; −2 → "giảm 2"; 0 → flat text` | Value text uses stored value, not label |
| `› MA row adds a window summary line (count, from–to, sources, fetched range)` | AC1 for the uncited MA window |
| `› gap ref → "Từ dd/mm/yyyy đến dd/mm/yyyy" with no source line; corporate_actions ref → "#id", source "Nhập tay (sổ giao dịch)"` | Default D3 |
| `› suppressed row: no direction, no value, reasons in REASON_ORDER with kind data/rule, inputs kept` | AC3 |
| `› hidden row: ruleName, lastSignalDate text, cause texts, and no direction/value/inputs keys` | AC2 |
| `› all rows hidden → section kind 'hidden' with lastSignalDate and cause texts` | AC2 |
| `› no rows → kind 'empty'; enabled rule without a row among others → 'no_signal' row` | Default D2 |
| `› order: ok, then suppressed, then hidden, then no_signal; expectedRuleIds order inside each group` | Stable layout |
| `› summary "3 tín hiệu, 2 tạm ẩn"` | Section header |
| `signals.test.ts (db) › listLatestSignals: one query per rule id with eq symbol, eq horizon 'medium', eq rule_id, order signal_date desc, limit 1` | AC4 |
| `› rule with no row (maybeSingle null) is omitted; result keeps ruleIds order` | AC4 |
| `› empty ruleIds → [] and no call` | AC4 |
| `› maps value given as a string "123" to 123; unsafe integer → DataError` | R2 |
| `› invalid status/label/signal_date → DataError; unknown reason code string is kept as-is` | Mapping |
| `› inputs_snapshot passed through untouched (core parses it)` | Mapping |
| `load-symbol.test.ts › reads signal rules, both gap types, and listLatestSignals with expectedRuleIds` | Wiring |
| `› signals hidden when signal_date < expected date` | AC2 end to end |
| `› financials gap from listOpenGaps('financials') hides the P/B row` | Gap type wiring |
| `› price gaps are read once and shared by chart and signals` | No duplicate reads |
| `signals-section.test.tsx › ok row renders rule name, direction text, value, and an inputs <details> with "Nguồn:" and "Cập nhật"` | AC1 |
| `› hidden state shows "Tín hiệu gần nhất" and no direction/value text` | AC2 |
| `› suppressed row lists each Vietnamese reason as <li>, never the raw code` | AC3 |
| `› empty state shows "Chưa có tín hiệu cho mã này"` | Empty |
| `› DISCLAIMER_TEXT present in empty, hidden and list states` | AC4, §2.3 |
| `› no action words in the rendered section (disclaimer excluded); no <table> inside the section` | AC1, mobile |

## Approach
1. **Core constants and types (R5, R7).**
   - Move `FINANCIALS_GAP_TYPE` into `market/quarters.ts`. Re-export it from the worker's `financials-sync.ts`.
   - Add `parseMaRuleId` (regex `^price_vs_ma_(\d{1,3})$`, result checked against `SIGNAL_RULE_BOUNDS.maDays`) and `isReasonCode` in `types.ts`.
   - Add to `types.ts`:
     ```ts
     interface StoredSignal {
       symbol: string; ruleId: string; signalDate: string; status: SignalStatus;
       label: SignalLabel | null; value: number | null; reasonCodes: string[];
       inputs: unknown; ruleVersion: number; computedAt: string;
     }
     ```

2. **`visibility.ts` (AC2, R4).** All functions are pure. They read no clock and never throw on bad input.
   - `expectedRuleIds(rules: SignalRules): string[]` returns the enabled `pe_vs_sector`, `pb_vs_sector` and `earnings_growth_trend`, plus `maRuleId(shortDays)` and `maRuleId(longDays)` when MA is enabled. This order is the display order.
   - `parseSignalSnapshot(row)` returns `{ ok: true, refs, maWindow?, epsBasis?, comparisons?, peerCount? }` or `{ ok: false }`. It uses manual guards: `inputs` must be an object and `refs` an array of `{ ref: string, ... }`. Allowed ref prefixes are `prices_daily:`, `financials:`, `symbols:`, `data_gaps:` and `corporate_actions:`; any other prefix makes the snapshot invalid. `prices_daily`, `financials` and `symbols` refs must have a non-empty `source` and a parsable `fetchedAt` (R4). `data_gaps` refs need `fromTs`/`toTs`.
   - `signalVisibility(row, ctx)` takes `ctx = { expectedDate, holidays, publishLagDays, rules, priceGaps: GapRef[], financialsGaps: GapRef[] }` and returns `{ state: 'ok' } | { state: 'suppressed', reasons: string[] } | { state: 'hidden', causes: VisibilityCause[] }`. `VisibilityCause = { code: VisibilityCode, gapIds?, fromDate?, toDate?, expectedDate? }`, and `VisibilityCode = 'signal_outdated' | 'price_gap_open' | 'financials_gap_open' | 'rule_version_outdated' | 'snapshot_invalid'`.
   - Causes are collected in that fixed order:
     - (a) `row.signalDate < ctx.expectedDate` → `signal_outdated`. This applies to every rule. `data_fresh` is not used.
     - (b) An open gap overlaps the rule's window. A gap counts when `gap.symbol === row.symbol` or `gap.symbol === null`. Use `gapOverlaps` and `vnDayBounds` from `inputs.ts`, and `quarterBounds`. Windows (finance consult R-1 table):
       - `price_vs_ma_N`, prices: `[maWindow.fromDate ?? subtractTradingDays(signalDate, N−1, holidays), signalDate]`.
       - `pe_vs_sector` / `pb_vs_sector`, prices: `[signalDate, signalDate]`.
       - `pe_vs_sector` / `pb_vs_sector` / `earnings_growth_trend`, financials: let `L = latestExpectedPeriod(signalDate, publishLagDays)` and take `req` from `requiredQuarters`. For P/E the basis is the snapshot's `epsBasis` (default `'unverified'`, which gives 4). For growth, `comparisons` is the snapshot's `params.comparisons` when it is a valid integer within `SIGNAL_RULE_BOUNDS.comparisons`, otherwise `rules.earningsGrowth.comparisons`. The window runs from `min(oldest cited financials period, addQuarters(L, −(req−1)))` to `max(newest cited period, L)`, and is converted to bounds with `quarterBounds`.
     - (c) `row.ruleVersion !== RULE_VERSION` → `rule_version_outdated`.
     - (d) An invalid snapshot → `snapshot_invalid`. This skips (b), because no window can be derived.
   - If there is any cause, the result is `hidden` (stale outranks suppressed). Otherwise `status === 'suppressed'` → `suppressed` with the stored `reasonCodes`. Otherwise `ok`.
   - Gap dates for the text are `vnDateOf(new Date(fromTs/toTs))`, computed here, not in the UI.

3. **`labels-vi.ts` (AC1, AC3).**
   - Maps, all typed with `satisfies Record<…, string>`: `REASON_LABELS` (`ReasonCode`), `DIRECTION_LABELS` (`SignalLabel`: "Tích cực" / "Tiêu cực" / "Trung tính"), `VISIBILITY_LABELS` (`VisibilityCode`), and `RULE_LABELS` (keyed by `RULE_IDS` values).
   - `ruleName(id)` uses `parseMaRuleId` for `price_vs_ma_N` → "Giá so với MA{N}". An unknown ID returns the raw ID and never crashes.
   - `reasonLabel(code)` returns the map value for a known code, else `Lý do khác (${code})`.
   - Copy: the reason labels are the finance consult's R-3 strings (they avoid "nên"). The rule names are the finance consult's ("P/E so với trung vị ngành", "P/B so với trung vị ngành", "Xu hướng lợi nhuận so cùng kỳ"). The visibility labels are finance R-3, with `signal_outdated` worded "Tín hiệu chưa được tính lại cho phiên {dd/mm/yyyy}" (filled in `present.ts`).
   - Banned-word test: lowercase the label, split it on whitespace and punctuation (`/[\s,.;:()\/—–-]+/u`), and reject the tokens `mua`, `bán`, `nên`, `buy`, `sell`. Also reject the phrases `khuyến nghị`, `cơ hội`, `vùng mua`, `chốt lời`, `cắt lỗ` and `nắm giữ` as substrings. Do not use `\b`: JS `\b` without the `u` flag fails next to Vietnamese diacritics, so `\bnên\b` would never match. Example: the data-viz consult's "EPS không dương nên không tính P/E" would fail this test, which is why the finance copy is used.

4. **`present.ts` (R1: the UI only renders strings).**
   - Signature: `presentMediumSignals({ ruleIds, rows: StoredSignal[], ctx }): SignalsSectionVM`.
     ```ts
     type SignalsSectionVM =
       | { kind: 'empty' }
       | { kind: 'hidden'; lastSignalDateText: string; causes: string[] }
       | { kind: 'list'; lastSignalDateText: string; summaryText: string; rows: SignalRowVM[] };
     ```
   - `SignalRowVM` is a union over `state`:
     - `'ok'`: `ruleName`, `signalDateText`, `directionText`, `directionGlyph` (`▲ ▼ ■`), `valueText`, `inputs: InputVM[]`.
     - `'suppressed'`: `ruleName`, `signalDateText`, `reasons: { text, kind: 'data'|'rule' }[]`, `inputs`.
     - `'hidden'`: `ruleName`, `lastSignalDateText`, `causes: string[]`. It has no direction, value or inputs.
     - `'no_signal'`: `ruleName`, `text: 'Chưa có tín hiệu'`.
   - `InputVM = { kindLabel, refText, sourceText: string|null, fetchedAtText: string|null }`.
   - Section kind: `empty` when no row is stored for any expected rule. `hidden` when every stored row is hidden; its causes are the deduplicated cause texts, and `lastSignalDateText` is the newest `signalDate`. `list` otherwise.
   - Row order: ok, then suppressed, then hidden, then no_signal, with `ruleIds` order inside each group. `summaryText` is "{shown} tín hiệu, {suppressed+hidden} tạm ẩn".
   - Value text uses `formatPercent` on the absolute stored `value`. Integer negation is done here, in core:
     - P/E, P/B: "P/E thấp hơn / cao hơn / bằng trung vị ngành x%", with "({peerCount} mã cùng ngành)" when `peerCount` is a valid integer.
     - MA: "Giá trên / dưới / bằng MA{N} x%".
     - Growth: "Lợi nhuận tăng / giảm {|v|} quý liên tiếp (so cùng kỳ)", or "Lợi nhuận quý gần nhất đi ngang so cùng kỳ" when v = 0. The sign comes from `value`, not from `label` (finance R-4).
     - Nothing is recomputed. Only the stored `value` and `peerCount` are used.
   - Inputs:
     - `prices_daily:SYM:DATE` → "Giá đóng cửa", "phiên dd/mm/yyyy".
     - `financials:SYM:YYYYQn` → "Báo cáo tài chính", "Quý n/YYYY".
     - `symbols:SYM:sector` → "Ngành", with the snapshot's `sector` string when present.
     - All three show "Nguồn: {source}" and "Cập nhật: {formatDateTime(fetchedAt)}".
     - `data_gaps:id` → "Khoảng thiếu dữ liệu", "Từ dd/mm/yyyy đến dd/mm/yyyy", with no source line.
     - `corporate_actions:id` → "Sự kiện quyền", "#id", source "Nhập tay (sổ giao dịch)".
     - MA rows also get one window line from `inputs.window` when `fromDate` is non-null: "Cửa sổ giá {count} phiên", "từ … đến …", sources joined with ", ", and "Cập nhật: {min} – {max}".

5. **db read (AC4, R3).**
   - `listLatestSignals(db, symbol, ruleIds): Promise<StoredSignal[]>` runs one query per rule ID in `Promise.all`: `.from('signals').select(COLS).eq('symbol', symbol).eq('horizon', 'medium').eq('rule_id', id).order('signal_date', { ascending: false }).limit(1).maybeSingle()`. NOT_FOUND → omitted. This mirrors `getLatestCloses`.
   - It is exact (no dedupe, no row cap) and runs at most 5 small queries. Each `inputs_snapshot` is at most 32 KB.
   - `signalFromRow` is strict on the columns the DB checks guarantee: `status` and `label` in their sets, a valid `signal_date`, `value` as a safe integer via `toSafeInt` (PostgREST may return bigint as a string), and `rule_version` as an integer. A violation throws `RowMappingError` → DataError. It is lenient on `reason_codes` (kept as strings; core labels unknown ones) and `inputs_snapshot` (passed through; core parses it).
   - Empty `ruleIds` → `[]` with no call.

6. **`loadSymbol` wiring.**
   - Add `getSignalRules(db)`, `listOpenGaps(db, PRICES_GAP_TYPE, [symbol])`, `listOpenMarketGaps(db, PRICES_GAP_TYPE)`, `listOpenGaps(db, FINANCIALS_GAP_TYPE, [symbol])` and `listOpenMarketGaps(db, FINANCIALS_GAP_TYPE)` to the reads.
   - The price-gap reads move out of the chart's `win.from > win.to` branch and are shared with the chart. `listCloseHistory` stays conditional, so the existing "not called" test still holds.
   - Then `listLatestSignals(db, symbol, expectedRuleIds(rules))` and `presentMediumSignals` with `{ expectedDate: expected, holidays, publishLagDays: DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS, rules, priceGaps, financialsGaps }`.
   - `DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS` is the constant the worker uses, and `no-hardcoded-rules.test.ts` does not ban it (R5).
   - The R6 comment stays as it is. No auth code is added.

7. **`SignalsSection` component.**
   - Structure: `<section aria-labelledby>` with an h2 "Tín hiệu trung hạn" and the `summaryText`, then `<DisclaimerNote className="text-sm" />` directly under the heading, then the helper line "Tín hiệu mô tả chiều hướng theo quy tắc cố định, không phải đề xuất giao dịch. Giờ cập nhật theo giờ Việt Nam."
   - Section states:
     - `empty` → `EmptyState` "Chưa có tín hiệu cho mã này".
     - `hidden` → a bordered `text-warn` panel with an `AlertTriangle` icon, "Tín hiệu tạm ẩn do dữ liệu chưa cập nhật", "Tín hiệu gần nhất: {date}", and the causes as a `<ul>`.
     - `list` → a `<ul>` of cards with the rule name as an h3.
   - Row states:
     - ok: a neutral-colour direction badge with an `aria-hidden` glyph plus text, then the value with `tabular-nums`.
     - suppressed: a muted "Tạm ẩn" chip (EyeOff icon), then the reasons as a `<ul>` with a warn icon for data reasons and an info icon for rule reasons.
     - hidden: "Tạm ẩn — dữ liệu chưa cập nhật", the causes, and the last signal date.
     - no_signal: one muted line.
   - Inputs go in `<details><summary className="min-h-11 …">Dữ liệu đầu vào ({n})</summary>` with a compact `<ul>`. Long ref text gets `break-all`.
   - No table, tooltip or chart. No arithmetic, `Math.`, or `new Date(`, so `no-calc-in-ui` keeps passing.

8. **Page.** Insert `<SignalsSection vm={view.signals} />` between `PriceChart` and the grid. The section is shown whether the symbol is held or only watched.

Rules: R1 (all decisions and text in core; the component only maps strings to markup), R2 (integers only, `formatPercent`, `toSafeInt`), R3 (the read goes through `server/db.ts`; no client fetch), R4 (refs without provenance hide the row; gaps hide rows), R5 (MA days, comparisons and publish lag come from settings or core config), R7 (follow-ups below are not in the diff), R9/R10 (direction labels only; banned-word tests).

## Specialist input used
- **Finance R-1 (three states, per-rule windows, stale outranks suppressed, rule version):** adopted, except the `rule_unknown` code. It was dropped because the ID filter only ever returns known rules, and `ruleName` falls back safely. Finance's `no_signal` code is kept as a row state, not a visibility code.
- **Finance R-2 (`listLatestSignals(db, symbol, ruleIds)` + `expectedRuleIds` + `parseMaRuleId`):** adopted. I chose one `limit(1)` query per rule over DISTINCT ON/RPC, so no migration is needed and the existing `getLatestCloses` pattern is reused.
- **Finance R-3 vs data-viz A.3, where the label maps live:** I chose **core** (`signals/labels-vi.ts`). The maps sit next to `REASON_ORDER`, so a new reason code fails typecheck in the same package that adds it. Core already holds Vietnamese UI copy (`entry/messages-vi.ts`, `settings/signal-rules-form.ts`). And the value text needs sign-dependent wording, which belongs in core under R1. Finance's web `lib/` placement was rejected for those reasons. Its copy and the `Lý do khác (<code>)` fallback were adopted.
- **Finance R-4 (directions, growth sign from value, banned words):** adopted, with the banned-word test tokenised instead of `\b` (see Approach 3).
- **Finance R-5 (what each state shows):** adopted.
- **Finance R-6 vs data-viz E, where the disclaimer goes:** I chose **the top of the section, under the h2**. Spec §2.3 asks for a *persistent* notice. Above the list it is visible and read first in every state, including a long list on mobile, and it is still inside the section it qualifies, which was data-viz's adjacency concern. Data-viz's `text-sm` sizing was adopted. There is no second copy at the page bottom.
- **Finance R-7 (move `FINANCIALS_GAP_TYPE` to core):** adopted.
- **Data-viz A.1 vs finance R-1, group vs per-row hiding:** I chose **a per-row decision in core, plus a section-level notice when every stored row is hidden**. The worker writes one `signal_date` for the whole run, so `signal_outdated` already hits all rows together and gives data-viz's whole-block notice. Gap overlap is rule-specific: an MA50 price gap should not hide P/B. Per-row is the literal AC2 reading ("an open gap overlaps *its* window").
- **Data-viz A.1 vs finance R-1, gap windows:** I chose finance's per-rule table, derived from the stored row (snapshot `window.fromDate`, `epsBasis`, `params.comparisons`) with config fallbacks (R5). Data-viz's "from config" suggestion is used only as that fallback.
- **Data-viz B (cards not a table, glyph + text, `<details>` inputs, 44px summaries, h3 rule names) and C/D (three distinct empty states, no stale values anywhere, reasons as a list):** adopted. The "fresh but every row suppressed" summary line was not adopted, because the suppressed rows already explain themselves.
- **Data-viz B, ref compaction by (kind, source):** rejected as unnecessary. The MA rule cites only the latest close and stores the window as one summary (finance Finding 5), so there are no 200-ref lists. Each row has a handful of refs, all listed. The MA window gets one summary line.
- **Data-viz B, direction badge colour:** I chose a neutral colour for all three directions, with glyph + text, so a green "Tích cực" never contradicts a red price change on the same screen, and no ceiling/floor colours are used (finance R-4).
- **Data-viz F, placement:** adopted the full-width row between the chart and the grid.
- **Data-viz H (`value` as number or string, unknown reason codes don't fail the page):** adopted.
- **Data-viz G, no sparkline or tooltips:** adopted.
- **Data-viz A.4 copy containing "nên":** rejected, because it fails the banned-word rule.

## Assumptions
Planner defaults for Ming to confirm in the PR. None of them blocks; each can be changed in a follow-up without reworking the structure.
- **D1, strict stale rule (finance Q1, data-viz Q1):** hidden whenever `signal_date < expectedPriceDate(now, holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN)`, with no grace period. Between the price cutoff and the end of the worker run every signal is hidden, and the notice names the session being waited for. This follows AC2 literally. Before the cutoff, the expected date is still the previous session, so the morning does not flicker.
- **D2, orphan and disabled rules (finance Q3):** rows of disabled rules and orphan `price_vs_ma_N` rows (from old MA settings) are not read at all. An enabled rule with no stored row shows "Chưa có tín hiệu" (for example right after the MA days change).
- **D3, AC1 citation waiver (finance Q4, data-viz risk):** "each cited ref shows source and fetched_at" applies to `prices_daily`, `financials` and `symbols` refs. A ref of those kinds without provenance hides the row. `data_gaps` refs show their interval only: they record missing data and have no source. `corporate_actions` refs show "Nhập tay (sổ giao dịch)", because corporate actions are entered by hand (spec F1). The uncited MA window is shown from the snapshot's `sources` and `minFetchedAt`–`maxFetchedAt`.
- **D4, peer gaps (finance Q5):** not checked. A gap opened later on a peer does not hide P/E or P/B. Market-wide gaps are covered. Logged as a follow-up.
- **D5, ref compaction:** none needed (see Specialist input).
- **D6, rule version:** `rule_version ≠ RULE_VERSION` hides the row as "Quy tắc đã thay đổi, chờ tính lại". This covers both an older stored version and a worker deployed ahead of the web app.
- **D7, hidden rows (finance Q2):** no old label, value or inputs, only the rule name, causes and last signal date.
- **D8, precision:** percent with 2 decimals via the existing `formatPercent`. Core already owns the rounding (R2). No new formatter.
- **D9, P/E and P/B ratio and median values:** not displayed in this ticket. Only the stored premium `value` and `peerCount` are shown. Showing "P/E 12,34 vs trung vị 14,05" needs a new ratio formatter, so it is a follow-up.
- **D10, mobile order:** Header, Chart, Signals, Position, Lots, Transactions. This differs from the STK-016 consult's order, which put Position before Signals, because the section is a full-width row.
- R6 stays suspended. The signals read is as public as the rest of the page until STK-018 is decided.

Follow-ups (not in this diff, R7):
- Peer-gap check for P/E and P/B (D4).
- Ratio and median display (D9).
- Store provenance on corporate-action refs if Ming wants AC1 to be literal (D3).
- A softer "đang chờ tính" style if the D1 window proves confusing.

## Blocking questions
None.

## Split proposal
None. This is one feature (STK-016 slice 3). The estimate is about 550 lines of product code (core about 330, db about 60, web about 160) plus tests, which is above the rough 400-line guide. Splitting core from UI would leave a slice with no observable behaviour against the ACs. If the implementer goes past about 750 product lines, record it in impl-log.md and stop to ask before adding more.
