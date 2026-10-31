STK-035 consult (finance-investment-researcher). I only read files; nothing was edited.

## Findings

1. **What gets stored and what doesn't.**
   - `signals` has one row per (symbol, rule_id, horizon, signal_date) (`supabase/migrations/20261026000200_signals.sql`).
   - `signal_date` is one date for the whole run: `resolveSignalDate(expectedDate, newest of all symbols)` in `apps/worker/src/jobs/medium-signals.ts`. It is never earlier than the expected date at run time. So a symbol with no bar for today still gets today's `signal_date`, with the `price_stale` reason.
   - Only `db/repos/signals.ts` `upsertSignals` exists. There is no read function.
2. **The stored windows are not the same for every rule.** The STK-016 consult said to use `inputs.window`, but only the MA rules store one:
   - `price_vs_ma_N` stores `inputs.window.{fromDate,toDate}` and `inputs.params.days`. `fromDate`/`toDate` are **null** whenever the window was incomplete (`insufficient_history` / `price_gap`).
   - `pe_vs_sector` / `pb_vs_sector` store no window. What they have: `refs` (`prices_daily:SYM:date`, `financials:SYM:YYYYQn`, `symbols:SYM:sector`, `data_gaps:id`), `epsBasis` (P/E only), `params`, `missingPeriods`, plus peer ratios that are not cited as refs. They read **both** the close on `signal_date` and financials.
   - `earnings_growth_trend` stores financial refs and `params.comparisons`. It reads financials only and needs `comparisons + 4` quarters.
   - The worker checks financial gaps over `quarterBounds(oldest required).from` to `quarterBounds(max(newest stored, latestExpectedPeriod(signalDate, lag))).to` (`checkFinancials`). Price gaps are checked from `vnDayBounds(fromDate, signalDate)`.
3. **Reason codes (`signals/types.ts`).** There are 18, in the fixed order of `REASON_ORDER`:
   - Data reasons (11): price_missing, price_stale, insufficient_history, price_gap, price_gap_recorded, financials_missing, financials_stale, financials_gap, financials_gap_recorded, financials_fetch_stale, sector_missing.
   - Rule reasons (7): eps_basis_unverified, eps_non_positive, bvps_non_positive, peers_insufficient, value_out_of_range, corporate_action_in_window, price_jump_beyond_limit.
   - The DB check only enforces the format `[a-z0-9_]`, so the UI may read codes it does not know.
4. **MA rule IDs depend on settings.** The ID is `maRuleId(days)` = `price_vs_ma_${days}`. The defaults are now **50/200** (`DEFAULT_SIGNAL_RULES`), not the 20/50 named in the STK-016 consult. If Ming changes the settings (STK-033), old `price_vs_ma_50/200` rows stay in the table, and so do rows of rules that were later disabled. A plain "newest row per rule_id" would show those stale orphan rows.
5. **AC1 citation conflict.**
   - Corporate-action refs (`{ ref: 'corporate_actions:id' }`) and gap refs (`fromTs`/`toTs`) carry **no source/fetchedAt**.
   - The MA rule cites only the latest close as a ref. For the rest of the window it stores `sources` and `minFetchedAt`/`maxFetchedAt`.
   - So "each cited ref shows source and fetched_at" cannot be met literally.
6. **Existing pieces to reuse.**
   - The disclaimer component exists: `apps/web/components/disclaimer-note.tsx`, `DISCLAIMER_TEXT = 'Thông tin chỉ mang tính tham khảo, không phải khuyến nghị đầu tư'`.
   - `PRICES_GAP_TYPE` is in core (`market/price-gaps.ts`). `FINANCIALS_GAP_TYPE = 'financials'` is **worker-only** (`apps/worker/src/jobs/financials-sync.ts`), and the web app needs it.
   - `load-symbol.ts` already computes `expectedPriceDate` and price gaps (symbol and market-wide).
   - There is no Vietnamese label map in the codebase yet.

## Recommendations

**R-1 (AC2): one core function, `signalVisibility`, with three states. Stale wins over suppressed, and suppressed wins over ok.**

Inputs: `row` (ruleId, signalDate, status, ruleVersion, inputs), `expectedDate`, `holidays`, `publishLagDays`, `priceGaps`, `financialsGaps` (each list holds the symbol's gaps plus the market-wide ones).

**State 1, `hidden_stale`.** The row is hidden if any of these is true:
- **(a)** `signalDate < expectedDate`. Use `expectedPriceDate(now, holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN)`, the same value the worker uses. Do not rely on `data_fresh`.
  - This applies to **every** rule, including the financials-only ones: a new run can bring a new quarter or a refreshed fetch.
  - `signalDate >= expectedDate` counts as current.
- **(b)** An open gap overlaps the rule's window (the gap's symbol equals the row's symbol, or the gap is market-wide). Reuse `gapOverlaps` and `vnDayBounds`. The window per rule:

  | Rule | Gap type | Window |
  |---|---|---|
  | `price_vs_ma_N` | prices | `[window.fromDate ?? subtractTradingDays(signalDate, N−1, holidays), signalDate]`. N comes from the rule ID. |
  | `pe_vs_sector`, `pb_vs_sector` | prices | the single day `[signalDate, signalDate]` |
  | `pe_vs_sector`, `pb_vs_sector` | financials | quarters from `min(oldest cited period, L − (req−1))` to `max(newest cited period, L)`, where `L = latestExpectedPeriod(signalDate, lag)`. `req` = 1 for P/B, and for P/E 1 if `epsBasis = 'ttm'`, else 4. Same as `requiredQuarters`. |
  | `earnings_growth_trend` | financials | as for P/E and P/B, with `req = params.comparisons + 4` |

  - Take cited periods from refs matching `^financials:[A-Z0-9]+:(\d{4}Q[1-4])$`. If there are none (missing data or a gap), fall back to the window derived from `L`.
- **(c)** `ruleVersion < RULE_VERSION`.
- **(d)** The rule ID is unknown, or the snapshot is malformed. Validate the jsonb defensively and never throw.

**Visibility codes.** These are separate from the stored `ReasonCode` list:
- `signal_outdated`
- `price_gap_open` / `financials_gap_open` (with the `data_gaps` IDs)
- `rule_version_outdated`
- `snapshot_invalid` / `rule_unknown`
- `no_signal`, for an enabled rule with no row yet

**State 2, `suppressed`.** The row is current and its stored status is `suppressed`. Show the stored reasons.

**State 3, `ok`.** Everything else.

**Unit tests (R8):**
- signal date equal to, before and after the expected date
- the expected date before and after the cutoff, and on a weekend or holiday
- a market-wide gap
- a gap touching only the edge of the window, and a gap ending right before it
- an MA row with a null window
- P/E with ttm and with quarterly EPS
- P/B with one quarter
- growth with comparisons = 8
- financial refs missing
- outdated rule version
- malformed JSON
- stale outranking suppressed

**R-2 (AC4): add `listLatestSignals(db, symbol, ruleIds)`.**
- Filter on `symbol`, `horizon = 'medium'`, `rule_id in ruleIds`, ordered by `signal_date` descending. Dedupe to the newest row per `rule_id` in code, or use DISTINCT ON via a view or RPC; ask the db-optimizer.
- Build `ruleIds` in core from the **current** settings: `expectedRuleIds(rules)` returns the enabled valuation and growth rules plus `maRuleId(shortDays)` and `maRuleId(longDays)`.
- Leave orphan MA rows and rows of disabled rules out. Never hard-code `price_vs_ma_50/200` (STK-033, Finding 5).
- Add `parseMaRuleId(id): number | null` next to `maRuleId`.
- Tests:
  - newest row per rule wins
  - other symbols are excluded
  - IDs that are not in the list are excluded
  - row → domain mapping, including reason codes and the snapshot

**R-3 (AC3): exhaustive Vietnamese label maps, in a web `lib/` file, typed with `satisfies Record<ReasonCode, string>`.**
- Write a test that iterates `REASON_ORDER`. Give unknown DB codes a fallback, `Lý do khác (<code>)`, behind an `isReasonCode` guard.
- Suggested labels for the data reasons, grouped under "Dữ liệu cũ/thiếu":
  - price_missing "Chưa có dữ liệu giá"
  - price_stale "Giá chưa cập nhật phiên gần nhất"
  - insufficient_history "Chưa đủ số phiên giá để tính"
  - price_gap "Thiếu giá một số phiên trong khoảng tính"
  - price_gap_recorded "Có khoảng mất dữ liệu giá đã ghi nhận"
  - financials_missing "Chưa có báo cáo tài chính"
  - financials_stale "Chưa có BCTC quý gần nhất"
  - financials_gap "Thiếu BCTC một số quý cần thiết"
  - financials_gap_recorded "Có khoảng mất dữ liệu BCTC đã ghi nhận"
  - financials_fetch_stale "Dữ liệu BCTC lâu chưa được làm mới"
  - sector_missing "Chưa rõ ngành"
- Suggested labels for the rule reasons, grouped under "Không đủ điều kiện tính":
  - eps_basis_unverified "Chưa xác minh cách tính EPS của nguồn dữ liệu"
  - eps_non_positive "EPS 4 quý ≤ 0 — P/E không có ý nghĩa"
  - bvps_non_positive "Giá trị sổ sách/CP ≤ 0 — P/B không có ý nghĩa"
  - peers_insufficient "Không đủ mã cùng ngành để so sánh"
  - value_out_of_range "Giá trị vượt ngưỡng tính toán"
  - corporate_action_in_window "Có sự kiện quyền (cổ tức cổ phiếu/phát hành thêm) trong khoảng tính — giá chưa điều chỉnh"
  - price_jump_beyond_limit "Có phiên biến động vượt biên độ sàn — giá có thể chưa được điều chỉnh"
- Suggested labels for the visibility codes:
  - signal_outdated "Tín hiệu chưa được tính lại cho phiên dd/mm"
  - price_gap_open "Đang có khoảng mất dữ liệu giá trong khoảng tính"
  - financials_gap_open "Đang có khoảng mất dữ liệu BCTC trong khoảng tính"
  - rule_version_outdated "Quy tắc đã thay đổi, chờ tính lại"
  - snapshot_invalid / rule_unknown "Dữ liệu tín hiệu không đọc được"
  - no_signal "Chưa có tín hiệu"
- Rule names:
  - pe_vs_sector "P/E so với trung vị ngành"
  - pb_vs_sector "P/B so với trung vị ngành"
  - earnings_growth_trend "Xu hướng lợi nhuận so cùng kỳ"
  - `price_vs_ma_N` "Giá so với MA{N}", built from `parseMaRuleId`

**R-4 (AC1, R9/R10): wording gives a direction only.**
- Direction labels: bullish "Tích cực", bearish "Tiêu cực", neutral "Trung tính".
- Descriptions: "Thấp/Cao hơn trung vị ngành x%" and "Trên/Dưới MA50 x%". For growth, take the sign from the stored `value` (the signed streak), not from the label: "LN tăng/giảm N quý liên tiếp (so cùng kỳ)". A neutral label can still have a non-zero streak, for example when `minConsecutive` > 1.
- Render `classification` cheap/expensive as relative wording, never as "rẻ/đắt/hấp dẫn".
- Banned words: mua, bán, nên, khuyến nghị, cơ hội, vùng mua, chốt lời, cắt lỗ, nắm giữ. Add a test over every label string that rejects `/\b(mua|bán|nên|khuyến nghị)\b/i`.
- Format ppm values with the existing core formatters. Show the stored `value`, `medianPpm` and `ratioPpm`, and never recompute them in the component (R1).
- Pair the colour with the text. Do not reuse the ceiling/floor colours.

**R-5 (AC1, AC2, AC3): what each row state shows.**
- **ok:** the direction badge, the value with its unit, and its inputs.
  - Each `prices_daily`/`financials`/`symbols` ref shows its source and fetchedAt.
  - The MA window shows its source list and the fetched range from min to max.
  - Corporate-action refs show as "Sự kiện quyền #id (nhập tay)". Gap refs show their from–to range.
- **suppressed:** a "Không tính được" badge and the grouped Vietnamese reasons. Keep the cited refs visible, for example which corporate action triggered the reason. No label and no value.
- **hidden_stale:** the rule name, "Tạm ẩn — dữ liệu chưa cập nhật", the visibility reason(s), and "Tín hiệu gần nhất: phiên dd/mm/yyyy". Show **no** old label, value or inputs.

**R-6 (§2.3): disclaimer.**
- Render `<DisclaimerNote/>` at the top of the signals section. It must show even when every row is hidden or there are no rows. Do not create a second copy of the text.
- An optional helper line, which passes the R-4 word test: "Tín hiệu mô tả chiều hướng theo quy tắc cố định, không phải đề xuất giao dịch."

**R-7 (R5/R7):** Move `FINANCIALS_GAP_TYPE` into core, the same way STK-034 moved `PRICES_GAP_TYPE`, and re-export it from the worker. Take the publish lag from `DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS`, the same constant the worker uses.

## Risks

- **Every signal is hidden for part of each trading day.** Between the price cutoff and the end of the worker run, the strict `signalDate < expectedDate` rule hides all signals. That is correct, but it can look broken. The `signal_outdated` wording should name the session being waited for.
- **An incomplete holiday list moves `expectedDate` forward.** Every signal is then hidden as outdated. This is the same risk as the price gaps in STK-016.
- **Peer gaps are not checked.** A gap opened later on a peer can change the P/E or P/B median without hiding the row. Market-wide gaps are covered. I accept this for v1 and suggest it as a follow-up.
- **Prices are raw, not adjusted.** Cash dividends are deliberately not guarded. When the exchange is null, the guard uses the widest limit (15%), so HOSE jumps can pass unflagged. Conviction in MA labels for watch-only symbols stays low; this is already documented in the STK-036 consult.
- **AC1's citation wording cannot be met literally** for corporate-action and gap refs, as described in Finding 5.

## Open questions

1. Should there be a grace period from the cutoff until the worker run (keep showing the previous session's signals), or should the rule stay strict as the AC says? My recommendation: strict, with clear wording.
2. Hidden rows: confirm "no old values at all, only the reason and the last signal date". This was STK-016 open question 5; I recommend yes.
3. Rows from disabled rules and orphan MA rows: leave them out completely (my recommendation), or list them as "Đang tắt"?
4. Is the AC1 waiver acceptable for corporate-action and gap refs that have no source/fetched_at? Or should provenance be added as a follow-up?
5. Should peer gaps hide P/E and P/B rows (more reads per page), or be logged as a follow-up?

Key files:
- /home/user/stoktok/packages/core/src/signals/types.ts
- /home/user/stoktok/packages/core/src/signals/inputs.ts
- /home/user/stoktok/packages/core/src/signals/moving-average.ts
- /home/user/stoktok/packages/core/src/signals/valuation.ts
- /home/user/stoktok/packages/core/src/signals/growth.ts
- /home/user/stoktok/packages/core/src/signals/raw-price-guard.ts
- /home/user/stoktok/packages/core/src/signals/config.ts
- /home/user/stoktok/packages/core/src/portfolio/freshness.ts
- /home/user/stoktok/packages/core/src/market/quarters.ts
- /home/user/stoktok/apps/worker/src/jobs/medium-signals.ts
- /home/user/stoktok/apps/worker/src/jobs/financials-sync.ts
- /home/user/stoktok/packages/db/src/repos/signals.ts
- /home/user/stoktok/packages/db/src/repos/data-gaps.ts
- /home/user/stoktok/apps/web/server/symbols/load-symbol.ts
- /home/user/stoktok/apps/web/components/disclaimer-note.tsx
