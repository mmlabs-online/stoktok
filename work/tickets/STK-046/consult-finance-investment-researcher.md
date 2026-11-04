# STK-046 consult: finance-investment-researcher

Fetching pages directly failed: hnx.vn, luatvietnam.vn, thitruongtaichinhtiente.vn and baophapluat.vn do not resolve in this session's network allowlist. Everything below comes from web-search results that quote the exchange notices, not from the notice PDFs themselves. Before marking any date "official", someone should open the cited notices on hsx.vn / hnx.vn, or allow those domains.

## Findings

### Calendar facts
- **One calendar covers all three boards.** HOSE, HNX and UPCoM (which HNX runs) close on the same days, set by a single Vietnam Exchange (SGDVN) letter each year. Each exchange then publishes its own notice. A single `ALL` scope is enough for v1.
- **Saturday make-up workdays are never trading days.** When the government swaps a weekday off for a Saturday worked, the exchanges confirmed no trading on those Saturdays (26/4/2025, 10/1/2026, 22/8/2026). The existing weekend logic in `packages/core/src/calendar.ts` is already correct. Seed only weekdays.
- **The exchanges add bridge days after the yearly calendar is out.** Examples: 2/5/2025, 2/1/2026 and 31/8/2026. HNX first said 2026 had 1 day off for New Year, then changed it to 2. The seed has to be editable (STK-047), and each entry needs its own source.

### 2025 — official, high confidence
Sources: HOSE notice 2079/TB-SGDHCM (26/12/2024), based on SGDVN letter 1046/SGDVN-GSTT (25/12/2024), plus later notices from each exchange.

| Date | Day | Holiday |
|---|---|---|
| 2025-01-01 | Wed | New Year's Day |
| 2025-01-27 … 2025-01-31 | Mon–Fri (5 days) | Tết Ất Tỵ |
| 2025-04-07 | Mon | Hùng Kings' Day (10/3 lunar) |
| 2025-04-30, 2025-05-01 | Wed, Thu | 30/4 and 1/5 |
| 2025-05-02 | Fri | Bridge day, swapped with Sat 26/4 (no trading on 26/4). HNX notice: closed 30/4 to 2/5, reopened Mon 5/5 |
| 2025-09-01, 2025-09-02 | Mon, Tue | National Day plus the added day |

That is 12 weekdays. Sources: [Nhân Dân – HNX 30/4–2/5/2025](https://nhandan.vn/ocop/hnx-nghi-giao-dich-3-ngay-dip-le-chien-thang-304-va-ngay-quoc-te-lao-dong-15-post874441.html), [Nhân Dân – 2/9/2025, 2 days](https://nhandan.vn/ocop/chung-khoan-nghi-giao-dich-2-ngay-dip-quoc-khanh-29-post903022.html), [Nhân Dân – New Year 2025, 1 day](https://nhandan.vn/ocop/chung-khoan-nghi-giao-dich-1-ngay-dip-tet-duong-lich-nam-2025-post852361.html), [TTTC – Tết Ất Tỵ 2025](https://thitruongtaichinhtiente.vn/lich-nghi-giao-dich-chung-khoan-dip-tet-nguyen-dan-at-ty-2025-65365.html), [Thuvienphapluat – HOSE Tết 2025](https://thuvienphapluat.vn/hoi-dap-phap-luat/lich-nghi-giao-dich-chung-khoan-tet-am-lich-2025-san-hose-138043012.html).

### 2026 — official (high confidence), plus one open date
Sources: SGDVN letter 1403/SGDVN-THHC (28/11/2025), HOSE notice 2294/TB-SGDHCM, the HNX notice "công bố lịch nghỉ giao dịch trong năm 2026", plus later updates.

| Date | Day | Holiday |
|---|---|---|
| 2026-01-01, 2026-01-02 | Thu, Fri | New Year's Day, with 2/1 as a swapped bridge day (Sat 10/1 make-up, no trading). Confirmed: the first session of 2026 was Mon 5/1 |
| 2026-02-16 … 2026-02-20 | Mon–Fri (5 days) | Tết Bính Ngọ (HNX notice 5305/TB-SGDHN); reopened Mon 23/2 |
| 2026-04-27 | Mon | Hùng Kings' Day falls on Sun 26/4, so the Monday is the substitute |
| 2026-04-30, 2026-05-01 | Thu, Fri | 30/4 and 1/5; reopened Mon 4/5 |
| 2026-08-31, 2026-09-01, 2026-09-02 | Mon–Wed | National Day: 31/8 swapped with Sat 22/8 (no trading on 22/8); reopened Thu 3/9 |

That is 13 weekdays. The original calendar said 12; 31/8 was added later.

**Open date: 2026-11-24 (Tue), Vietnamese Culture Day.** It becomes a paid public holiday for the first time under National Assembly Resolution 28/2026/QH16 (in force from 1/7/2026). Government Office letter 10065/VPCP-KGVX sets one day off with no swap. As of 26/10/2026, no source shows HOSE or HNX announcing a trading closure. I rate the chance the market closes at about 85%, because the exchanges have closed on every statutory paid holiday so far. Seed it only as **provisional**.

Sources: [HNX 2026 calendar notice](https://hnx.vn/vi-vn/chi-tiet-lich-nghi-gd-60021971.html?_page=1), [LuatVietnam – 2294/TB-SGDHCM](https://luatvietnam.vn/chung-khoan/thong-bao-2294-tb-sgdhcm-2025-cong-bo-lich-nghi-giao-dich-nam-2026-421232-d6.html), [Nhân Dân – Tết 2026, 5 days](https://nhandan.vn/ocop/chung-khoan-nghi-giao-dich-5-ngay-dip-tet-am-lich-nam-2026-post943421.html), [Nhân Dân – HNX Hùng Kings and 30/4–1/5 2026](https://nhandan.vn/ocop/hnx-nghi-giao-dich-dip-gio-to-hung-vuong-ngay-giai-phong-mien-nam-thong-nhat-dat-nuoc-va-ngay-quoc-te-lao-dong-post957517.html), [TTTC – New Year 2026, 2 sessions](https://thitruongtaichinhtiente.vn/lich-nghi-giao-dich-chung-khoan-tet-duong-lich-2026-75790.html), [Nhân Dân – HNX's earlier "1 day" New Year notice](https://nhandan.vn/hnx-nghi-giao-dich-1-ngay-dip-tet-duong-lich-nam-2026-post930092.html), [Thời báo Tài chính – first session on 5/1/2026](https://thoibaotaichinhvietnam.vn/chung-khoan-ngay-51-vn-index-tang-diem-trong-phien-giao-dich-dau-tien-cua-nam-2026-190012.html), [Báo Pháp luật – HOSE 2/9/2026, no trading on 22/8](https://doanhnhan.baophapluat.vn/hose-thong-bao-lich-nghi-le-quoc-khanh-2-9-khong-giao-dich-bu-vao-thu-bay-22-08.html), [Thuvienphapluat – HOSE Hùng Kings 2026](https://thuvienphapluat.vn/hoi-dap-phap-luat/san-hose-khi-nao-nghi-gio-to-hung-vuong-2026-138084516.html), [Thuvienphapluat – HOSE 30/4–1/5 2026](https://thuvienphapluat.vn/hoi-dap-phap-luat/san-hose-nghi-le-30-4-1-5-nam-2026-tu-ngay-nao-138085279.html), [Báo Văn hóa – Culture Day 2026, one day](https://baovanhoa.vn/van-hoa/ngay-van-hoa-viet-nam-nam-2026-chinh-thuc-duoc-nghi-mot-ngay-270980.html), [reviewchungkhoan – 24/11 not yet announced as of 26/10](https://reviewchungkhoan.com/lich-nghi-le-chung-khoan/).

### 2027 — all provisional
The exchanges have not published a 2027 calendar yet. Going by 2024 and 2025, expect it in late November to late December 2026. The dates below are inferred from the Labour Code and the Ministry of Home Affairs (MoHA) public-sector schedule. MoHA notice 11483/TB-BNV (~10/10/2026) follows Government Office letter of 02/10/2026, approved by Deputy PM Phạm Thị Thanh Trà.

| Date | Day | Basis | Confidence |
|---|---|---|---|
| 2027-01-01 | Fri | New Year's Day, statutory | ~95% |
| 2027-02-04, 02-05, 02-08, 02-09, 02-10 | Thu, Fri, Mon, Tue, Wed | Tết Đinh Mùi: lunar new year is Sat 6/2. MoHA public sector is off 4/2–10/2 (5 Tết days plus 2 compensatory days). Private employers may pick other options, but the exchanges have always matched the public-sector Tết schedule | ~85–90% |
| 2027-04-16 | Fri | Hùng Kings' Day, 10/3 lunar | ~95% |
| 2027-04-30, 2027-05-03 | Fri, Mon | 1/5 falls on Sat, so Mon 3/5 is the substitute | ~90% |
| 2027-09-02, 2027-09-03 | Thu, Fri | MoHA public sector off 2/9–5/9. Employers may choose 1/9 instead of 3/9 | ~85–90% |
| 2027-11-24 | Wed | Culture Day; depends on what the exchanges decide for 2026 | ~75% |

Sources: [CafeF – MoHA Tết and National Day 2027](https://cafef.vn/bo-noi-vu-thong-bao-chi-tiet-lich-nghi-tet-am-lich-quoc-khanh-2027-188261010120450778.chn), [VietnamPlus – Culture Day 2026, Tết and National Day 2027 confirmed](https://www.vietnamplus.vn/chot-lich-nghi-dip-ngay-van-hoa-viet-nam-2026-tet-nguyen-dan-va-quoc-khanh-nam-2027-post1139707.vnp), [Hà Tĩnh gov – Tết 2027, 7 days](https://hatinh.gov.vn/vi/bai-viet/tet-nguyen-dan-2027-cong-chuc-vien-chuc-duoc-nghi-7-ngay-lien-tuc), [VnEconomy – expected 2027 holidays](https://vneconomy.vn/du-kien-cac-ngay-nghi-le-tet-trong-nam-2027.htm), [Thuvienphapluat – 2027 holiday overview](https://thuvienphapluat.vn/hoi-dap-phap-luat/chu-de/lich-nghi-le).

### How the code depends on the calendar
- **`expectedPriceDate` / freshness.** This is used in the EOD job, the medium-signals job, the dashboard, the watchlist and the symbol page. Without the holiday list, on a holiday or the day after one the app expects a bar that will never come. Every symbol then shows stale, and under R4 the signals are suppressed. A whole Tết week of false staleness is the most visible symptom.
- **T+2 settlement (sellable quantity, `addTradingDays` in the ledger).** A missing holiday makes the app show shares as sellable too early. For example, a buy on Fri 13/2/2026 shows as sellable 17/2 when the real date is 24/2. Showing shares sellable too early is the dangerous direction. Not checked yet: whether the ledger reads the settings holidays or `DEFAULT_MARKET_SETTINGS.holidays = []` (`packages/core/src/ledger/settings.ts`).
- **Gap detection (`planPriceGaps`, `packages/core/src/market/price-gaps.ts`).** Once the seed is in, resolution already happens: `gapDays(...)` returns `[]` for a gap made only of holidays, `every` on an empty list is true, so the gap resolves. A gap that also covers a real trading day stays open, as AC3 requires. Gaps:
  1. `store.resolveGaps(ids, fetchedAt)` records no reason.
  2. Only symbols in the current sync set are processed. Open gaps on symbols since removed from the watchlist stay open forever. A one-off resolution pass over all open `prices_daily` gaps is needed.
- **Signal windows and the chart (`subtractTradingDays`, `tradingDaysBetween`, `buildChartSeries`).** Missing holidays make lookback windows shorter than intended. For example, a 20-session moving average across Tết uses only about 15 real sessions. The chart also shows fake gap markers.
- **Backfill (`planBackfillChunks`, STK-032).** Chunk sizes and window starts are counted in trading days, so they move. If the backfill reaches before 2025-01-01, 2024 holidays are not seeded and will produce false gaps.

## Recommendations
1. **(AC1, R5)** Seed entries as `{ date, name, source, provisional }`. Mark all 2025 and 2026 dates `provisional: false`, except 2026-11-24, and mark every 2027 date `provisional: true`. Put each notice number in `source`. Store dates in `YYYY-MM-DD` (VN date), sorted. A test should check there are no duplicates and no weekends; the 22/8, 10/1 and 26/4 Saturdays must never appear.
2. **(AC1)** Add 2026-11-24 as provisional. If it is seeded as a holiday but the market trades, the cost is small and on the cautious side: freshness and sellable dates lag one day, and the next run picks up the bar. If it is left out but the market closes, the app shows false staleness, records a false gap, and shows sellability one day early. The second mistake is worse. Re-check the HOSE notice around mid-November.
3. **(AC2)** Use the **union** of the seed and Ming's stored dates. If any stored date replaces the whole seed, then the moment Ming adds one date (say 24/11), every seeded 2025–2027 date disappears. The union keeps both AC2 promises: the seed is used, and Ming's dates are not overwritten. Only an all-or-nothing reading would conflict.
4. **(AC3, R4)** Add a resolution reason, e.g. `resolved_reason = 'market_holiday'`. That needs a column, so this is a `db` area change. Run a one-off resolution over **all** open price gaps, not only symbols currently synced. Reuse the `planPriceGaps` rule: resolve only when the gap has no trading days left once holidays are excluded.
5. **(R1)** Merge the seed with the settings in `packages/core` (e.g. `effectiveHolidays(settings)`). Web loaders, worker jobs and the ledger should all call it, so none of them keeps reading raw `settings.holidays`.
6. **(AC4)** Add tests for:
   - a T+2 buy on 2026-02-13 settling on 2026-02-24;
   - `expectedPriceDate` on 2026-02-23 before the cutoff returning 2026-02-13;
   - a gap spanning 2026-02-13 to 2026-02-23 staying open.

## Risks
- Every source I could reach is secondary (news outlets or legal aggregators quoting the notices). There is a small risk that a notice number or a date is transcribed wrong. Verify against hsx.vn / hnx.vn before go-live; the CLAUDE.md "verify before go-live" rule applies.
- The 2027 dates may change. Tết could follow a different option, and National Day could use 1/9 instead of 3/9. Extra swap days are also possible, though less likely in 2027 because every holiday already sits next to a weekend.
- Ad-hoc closures (system outages, KRX go-live work) are not holidays. They should stay as gaps, not be seeded.
- Leaving the 2027 dates in the seed indefinitely risks provisional dates silently becoming the truth. Show the provisional status somewhere (STK-047), or log a warning when a provisional date is within 30 days.

## Open questions for Ming
1. Should 2026-11-24 be seeded as provisional now, or added only after HOSE announces it?
2. For AC2, is a union of seed and stored dates acceptable, or should the seed apply only when the stored list is empty?
3. Does the backfill reach before 2025? If yes, should 2024 be seeded too (adds 2024 Tết, 2024 bridge days and so on)?
4. Should a "provisional" flag be stored, so STK-047 can show it, or is it enough as a source comment?
5. Can hsx.vn / hnx.vn be allowed in the session network, so the planner or implementer can check the original notices?

Files referenced: `/home/user/stoktok/packages/core/src/calendar.ts`, `/home/user/stoktok/packages/core/src/ledger/settings.ts`, `/home/user/stoktok/packages/core/src/market/price-gaps.ts`, `/home/user/stoktok/apps/worker/src/jobs/eod-sync.ts`, `/home/user/stoktok/apps/worker/src/jobs/medium-signals.ts`, `/home/user/stoktok/apps/worker/src/store.ts`.
