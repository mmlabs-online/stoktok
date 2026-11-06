## STK-052 consult: finance-investment-researcher (Vietlott rules)

**I could not reach any official source.** vietlott.vn, thuvienphapluat.vn, hethongphapluat.com and news.laodong.vn all failed DNS from this session (`ENOTFOUND`). To check against the official sources, vietlott.vn (and ideally thuvienphapluat.vn) must be allowed in the session's network settings. Everything below comes from web search snippets of Vietnamese news and legal-help sites. Confidence is noted per item.

### Findings

**1. The tax rule in the ticket is out of date. This blocks AC4.**
- Personal Income Tax Law 2025 (Law 109/2025/QH15) took effect on 2026-07-01. It raised the per-prize threshold for lottery winnings from 10,000,000 to **20,000,000 VND**. The rate stays at 10%.
- The taxable amount is the part of the prize above 20M on one lottery ticket in one draw ("trên 1 vé xổ số … trong một đợt quay thưởng").
- The tax point is when the prize is **paid**, not the draw date.
- Some legal sites still quote 10M from Circular 111/2013, because no circular under the new law had been issued when they were written.
- Today is 2026-11-05, so the AC's "10% above 10,000,000" and its boundary tests (10,000,000 / 10,000,001) describe the old rule. Confidence: medium-high. Several sources agree, but I could not read the law text.

**2. Tax basis is per ticket per draw, not per combination.**
- Both the old and new wording say "per ticket (vé) per draw". On that reading, the prizes on one bao ticket, or one multi-line ticket, are **summed and then taxed once**.
- No source addresses bao tickets directly, so this is **unverified**.
- It changes real numbers. Example: a Power bao 7 win of Jackpot 1 plus 6 × 1st prize (40M each). Taxed per combination, each 1st prize pays 2M. Taxed per ticket, they are added to the jackpot base.

**3. Game rules**

| | Mega 6/45 | Power 6/55 |
|---|---|---|
| Number range | 6 of 01–45 | 6 of 01–55, plus 1 bonus ball drawn from the rest |
| Draw days | Wed / Fri / Sun | Tue / Thu / Sat, from about 18:00 |
| Price per combination | 10,000 | 10,000 |

- Draw days: high confidence, from many dated result articles.
- Price: high confidence.

**4. Prize table**

| Tier | Mega 6/45 | Power 6/55 |
|---|---|---|
| Jackpot | 6 numbers | **Jackpot 1:** 6 regular numbers |
| Jackpot 2 | — | 5 regular numbers + bonus |
| 1st | 5 → 10,000,000 | 5 (no bonus) → 40,000,000 |
| 2nd | 4 → 300,000 | 4 → 500,000 |
| 3rd | 3 → 30,000 | 3 → 50,000 |

- The bonus ball counts **only** for Jackpot 2.
- One combination cannot match 6 regular numbers *and* the bonus, because the bonus is distinct from the 6 regular numbers.
- Jackpot minimums are not needed, since the jackpot amount comes from the draw result. Reported values: Mega about 12 bn; Power JP1 30 bn or 50 bn (sources conflict); Power JP2 5 bn.
- Confidence: Mega fixed prizes medium-high (a 2025 article). Power fixed prizes medium; one snippet had obvious typos in the match conditions.

**5. Highest tier only, per combination.** Confirmed: "Nếu vé … trúng cùng lúc nhiều hạng giải thưởng thì người trúng thưởng chỉ được lĩnh một hạng mục giải thưởng cao nhất" (VTC). A combination that matches 6 is not also paid for 5, 4 or 3. Each combination in a bao is checked on its own; news of bao wins lists a jackpot plus several 1st prizes on one ticket.

**6. Jackpot sharing is pro rata, not per person.** The rule is "chia đều theo tỷ lệ giá trị tham gia dự thưởng của người trúng thưởng" (VTC, VOH). Each winning combination is worth 10,000 of participation, so in practice:
- one combination's share = jackpot total ÷ number of winning combinations;
- I assume the same applies to Power Jackpot 2, but that is **unverified**.

**7. Bao (system) tickets: price = 10,000 × number of combinations.**
- Bao 5: Mega has 40 combinations (400,000 VND, confirmed). Power has 50 combinations (500,000 VND, confirmed).
- Bao k for k = 7–18: C(k,6) combinations. That gives 7, 28, 84, 210, 462, 924, 1716, 3003, 5005, 8008, 12376, 18564 for k = 7 … 18. Power bao 18 = 18,564 combinations, confirmed.
- Mega range bao 5–18 is confirmed. For Power, I only saw bao 5, 7, 8 and 18 mentioned, so its full range is **unverified**.
- There is no bao 6; that is just a normal ticket.
- Bao 5 covers the 5 chosen numbers combined with each remaining number. On Power, the combination that contains the bonus ball can hit Jackpot 2.

**8. Unverified:** any 2026 rule change on vietlott.vn (searches found none); prize rounding; whether fixed prizes can be capped or shared; the 60-day claim window (not needed for core).

### Recommendations
- **R5, AC1:** add one config object per game:
  ```
  { gameId, pickCount: 6, numberMin: 1, numberMax: 45|55, hasBonus,
    pricePerCombination: 10000, systemSizes: [5,7..18], drawWeekdays: [ISO],
    tiers: [{ id, regularMatches, requiresBonus, prize: {kind:'fixed', amount} | {kind:'pool'} }] }
  ```
  Order `tiers` by rank. Tier ids: `jackpot` / `jackpot1` / `jackpot2` / `first` / `second` / `third`.
- **R5, AC4:** make tax a separate, date-dependent config:
  ```
  { effectiveFrom, thresholdVnd, ratePpm: 100000, basis: 'perTicketPerDraw' }
  ```
  Use two entries: 2026-07-01 → 20,000,000 and the earlier period → 10,000,000. Pick the entry by payment date (default: the draw date). Reuse `applyRatePpm` from `packages/core/src/money.ts`, as the ledger already does with `sellTaxRatePpm`. Rule: tax = applyRatePpm(max(0, gross − threshold), rate). Keep `basis` configurable (`perCombination` as the other option) until Ming or Vietlott confirms it.
- **AC2:** `checkCombination(rules, combo, draw)` returns the single highest matching tier or none. Check JP1 → JP2 → 1st → 2nd → 3rd and return the first match.
- **AC3:** `expandTicket(rules, ticket)` validates the input: count is 6 or one of the allowed bao sizes; numbers are unique, integers and in range. It then generates the combinations. Cost = combinations × price. Compute the combination count with a C(n,k) helper (bao 5 = numberMax − 5) and compare it to the length of the expanded list as a check.
- **AC4, R2:** the draw-result input should carry, per pool tier, `poolAmount` and `winnerCount` (combinations), both integer VND/counts, as in Vietlott's published table. One combination's share = floor(pool ÷ winnerCount). Use floor rounding and write it down as a known approximation. If the published table already gives a per-winner amount, store that instead.
- **AC6:** update the tax boundary tests to 20,000,000 / 20,000,001 for current rules, and keep one test for the earlier 10M period. Also add these tests:
  - Power bao 5 hitting Jackpot 2;
  - a bao 7 with 6 hits (1 jackpot + 6 × 1st);
  - per-ticket aggregation of tax;
  - a jackpot share with winnerCount > 1.
- Size check: Power bao 18 costs 185,640,000 VND and the largest jackpots are about 3e11 VND. Both are safe integers.

### Risks
- If the old 10M threshold is shipped as the AC says, net results for tickets paid since 2026-07-01 come out wrong, by up to 1,000,000 VND per taxed prize.
- Getting the tax basis wrong (per ticket vs per combination) misstates net wins on bao and multi-line tickets.
- Power's prize table and bao range rest on weak sources. Mega's values are better supported but still not read from the official site.
- Rule changes on Vietlott's side are silent, so dating the game config too (`effectiveFrom`) is cheap insurance.

### Open questions for Ming
1. Accept the 20M threshold from 2026-07-01 (Law 109/2025/QH15), and change AC4/AC6 to match?
2. Tax basis: per Vietlott ticket per draw (summed, my default) or per combination? Ideally confirm from a real Vietlott payout or an official FAQ.
3. Is one "ticket" in the ledger one Vietlott ticket ID? An SMS or paper ticket can hold several lines, which matters for tax aggregation.
4. Can vietlott.vn be allowed in the session's network settings, so the prize tables and the Power bao range can be checked against the official pages before go-live?

Sources (search snippets only; none fetched):
- [VTC News – Mega 6/45 18/1/2023](https://vtcnews.vn/vietlott-mega-6-45-18-1-ket-qua-xo-so-vietlott-mega-hom-nay-18-1-2023-ar737120.html)
- [VTC – Power 6/55 bao (2017)](https://www.vtcnews.vn/jackpot-mega-6-45-lai-no-lam-the-nao-de-an-not-giai-200-ty-dong-cua-power-6-55-ar372459.html)
- [VOH – Power 6/55 18/6/2020](https://voh.com.vn/xo-so-vietlott/vietlott-power-655-18-6-ket-qua-xo-so-vietlott-hom-nay-thu-5-18-6-2020-367295.html)
- [VOH – Mega 6/45 18/8/2024](https://voh.com.vn/xo-so-vietlott/vietlott-mega-645-188-ket-qua-xo-so-vietlott-hom-nay-chu-nhat-1882024-544323.html)
- [nongnghiepmoitruong – Mega 6/45 6/4/2025](https://nongnghiepmoitruong.vn/vietlott-mega-6-45-ket-qua-xo-so-vietlott-hom-nay-ngay-6-4-2025-d746832.html)
- [nongnghiepmoitruong – Power 6/55 20/3/2025](https://nongnghiepmoitruong.vn/vietlott-power-6-55-ket-qua-xo-so-vietlott-hom-nay-ngay-20-3-2025-d744097.html)
- [MoMo – Mega 6/45 guide](https://www.momo.vn/blog/huong-dan-cach-choi-vietlott-6-45-don-gian-de-hieu-c115dt1865)
- [thuvienphapluat – 20M threshold from 1/7/2026](https://thuvienphapluat.vn/ma-so-thue/phap-luat-thue/chinh-thuc-trung-so-tren-20-trieu-moi-phai-nop-thue-tncn-tu-172026-225114.html)
- [vietnamfinance – 20M threshold from 1/7](https://vietnamfinance.vn/nang-nguong-chiu-thue-cua-5-khoan-thu-nhap-len-20-trieu-tu-1-7-d146732.html)
- [Cần Thơ PBGDPL – new PIT law points](https://pbgdpl.cantho.gov.vn/tu-ngay-0172026-nhieu-diem-moi-cua-luat-thue-thu-nhap-ca-nhan-can-luu-y-1)
- [hethongphapluat – Law 2025 Art. 15](https://hethongphapluat.com/luat-thue-thu-nhap-ca-nhan-2025/dieu-15)
- [thuvienphapluat – Vietlott PIT (old rule)](https://thuvienphapluat.vn/hoi-dap-phap-luat/trung-vietlott-phai-dong-thue-tncn-287661.html)
- [laodong – bao 7 Jackpot 83 bn](https://news.laodong.vn/kinh-doanh/trung-vietlott-hon-83-ti-dong-nguoi-dan-ong-10-nam-mua-xo-so-tu-choi-deo-mat-na-1714253.ldo)

Files consulted: /home/user/stoktok/work/tickets/STK-052/ticket.md, /home/user/stoktok/docs/spec-v1.md, /home/user/stoktok/packages/core/src/ledger/settings.ts, /home/user/stoktok/packages/core/src/money.ts
