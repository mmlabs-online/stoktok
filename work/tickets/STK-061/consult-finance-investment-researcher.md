# Consult: finance-investment-researcher, STK-061

I read `ticket.md`, ADR 0002, ADR 0005, `packages/core/src/market/financials.ts`, `financials-derive.ts` and `signals/growth.ts`, plus the ratio units in `signals/config.ts`. I did not fetch any live data. I have not seen cash-flow values from VietCap. The `CASH_FLOW` section only exists in the field dictionary (STK-039 `live-probe.md`), so everything I say about cash flow is unverified.

## Findings
1. **The ticket's ratio unit doesn't match the code.** The ticket says ratios are stored in basis points. All existing core ratio code uses **ppm**: `growthThresholdPpm`, `minBasePpmOfRevenue`, `mulDiv(..., PPM)`. If we store bps next to ppm thresholds, unit-mixing bugs follow. R2 also says rounding is defined in one place.
2. **Quarterly cash flow is year-to-date under VAS.** Vietnamese interim cash-flow statements (Circular 200) report from the start of the year, not the single quarter. VietCap may or may not split them back into quarters. If they don't and we treat the numbers as quarterly, Q2–Q4 CFO, capex and FCF are overstated by about 2–4×, and summing the last four quarters double-counts. The same check is worth doing once for the income statement.
3. **"Operating profit" under VAS is not EBIT.** "Lợi nhuận thuần từ hoạt động kinh doanh" includes financial income and expense (interest and FX) and the share of profit from associates. If the AI is told it is EBIT, its commentary will be wrong. Interest expense ("Chi phí lãi vay") is a separate line and is cheap to store.
4. **Some lines don't exist or mean nothing for some company types:**
   - NH (banks): no gross profit, COGS, "debt" in the corporate sense, capex-driven FCF or meaningful CFO (it is driven by deposits and loans). D/E and FCF are not meaningful.
   - CK (brokers): no classic gross profit. Borrowings are mostly margin-lending funding, so D/E means leverage, not distress.
   - BH (insurers): has gross insurance-business profit. Liabilities are mostly technical reserves, so liabilities/equity is misleading.
   - So "missing because not applicable" must differ from "missing because of a gap". If they aren't separated, bank symbols will create permanent open gaps every quarter. These gaps never close and add noise to `data_gaps`.
5. **Debt is not total liabilities.** Real-estate and construction companies carry large customer advances ("Người mua trả tiền trước"). Liabilities/equity therefore inflates their leverage. Debt should mean short-term plus long-term interest-bearing borrowings and finance leases ("Vay và nợ thuê tài chính ngắn/dài hạn").
6. **Cash is usually understated.** Many Vietnamese companies keep large term deposits in held-to-maturity investments ("Đầu tư nắm giữ đến ngày đáo hạn"), not in cash and cash equivalents. Net debt from cash alone understates liquidity, e.g. for MWG or FPT-type balance sheets.
7. **Audited annual figures can differ from the sum of the four quarters.** The full-year figure (`lengthReport = 5`) may not equal Q1+Q2+Q3+Q4 because of post-audit adjustments ("chênh lệch sau kiểm toán"). This is a well-known signal in Vietnam.
8. **Existing code already covers the key definitions:**
   - **P/E** uses TTM EPS (`deriveVciIqQuarter`). It is suppressed until the EPS basis changes from `'unverified'` to `'ttm'`.
   - **Vendor `pe`/`pb`** are deliberately not used (ADR 0005).
   - **Growth with negative bases** is solved in `growth.ts`. The classes are `up`, `down`, `flat`, `turnaround`, `to_loss` and `loss`. A non-positive or tiny base gives a direction only and no percentage.

## Recommendations
1. **Ratio unit (AC2, R2).** Ask Ming to switch the AC to ppm to match core. If he keeps bps, add one `toBps(num, den)` helper (bigint, `roundDiv` half away from zero) next to `toVndAmount`, and name columns with the unit (`*_bps`). Either way, multiples (P/E, P/B) have their own unit, e.g. ×10⁴ or ×10⁶. Name them explicitly (`pe_x1e4`) so nobody reads 153000 as 15.3%.
2. **Derive almost every ratio in core (AC2, R1, R9).** Compute P/E, P/B, ROE, ROA, margins, D/E, FCF and YoY from stored lines. This keeps one definition across company types and lets the AI cite stored line IDs (R9). It also matches ADR 0005, which already ignores vendor pe/pb. Store vendor `roe`/`pe`/`pb` from `statistics-financial` only as cross-check values tagged with source, not as the figures the AI uses. Leave source-only ratios (bank NIM, NPL, CAR, CASA) to a follow-up, because they need the `NOTE` section.
3. **Definitions to fix in the plan and test** (rounding half away from zero throughout):
   - **P/E** = close price / TTM EPS, and only when the EPS basis is `'ttm'`. With EPS ≤ 0 it is null with reason `negative_earnings`, never a negative number. Never multiply one quarter's EPS by 4 (seasonality). For storage, either compute at read time against the latest close or store it with `price_date`. Reuse whatever the existing P/E-vs-sector rule computes; don't create a second P/E.
   - **P/B** = close / BVPS, where BVPS is parent equity per share. Null when BVPS ≤ 0.
   - **ROE** = TTM parent net income / average parent equity. Parent equity is `bsa78 − bsa210`, so it matches the parent-NI numerator. Average = (equity at P + equity at P−4) / 2. Null if either end is ≤ 0 or missing.
   - **ROA** = TTM parent net income / average total assets. Parent NI is the Vietnamese vendor convention; document it.
   - **Gross margin** = gross profit / net revenue (`isa3`, after deductions). Store it per quarter, and optionally TTM.
   - **Net margin** = parent net income / net revenue (per type, as in ADR 0005).
   - **D/E** = (short-term + long-term borrowings incl. finance leases) / total equity incl. minority. Store liabilities/equity separately only if wanted, and never under the name D/E.
   - **FCF** = CFO − |capex|. Capex is the "Tiền chi mua sắm, xây dựng TSCĐ…" line, stored with its source sign. Do not net disposal proceeds. Assert the sign in the mapper.
   - **YoY** = quarter vs the same quarter a year earlier, and year vs year. Reuse `growth.ts` `compare` semantics (factor it into core rather than copying). A percentage only when the base is > 0 and passes `minBasePpmOfRevenue`; otherwise null plus a class. For revenue YoY the base must be > 0.
4. **Not applicable is not a gap (AC4, R4).** In `VCI_IQ_FIELDS_BY_COMPANY_TYPE`, map such lines explicitly to `null` with the meaning "not applicable for this company type". Write no row and no gap for them, and give derived ratios reason `not_applicable`. A mapped line with a null value is still a gap. Lock this per type with a test.
5. **Cash-flow basis (AC1/AC3 fixture).** Record live CASH_FLOW samples for HPG, VCB, VND and BMI. Check whether quarterly CFO summed over Q1–Q4 equals the annual row, and whether Q2 > Q1 looks cumulative. If the data is YTD, convert it to discrete quarters in core (Qn − Qn−1 within the fiscal year; Q1 as-is). A missing earlier quarter then makes the later one a gap. Run the same Q-sum vs annual check on revenue and net income.
6. **Store annual rows directly; never derive them by summing quarters.** Expose the Q4 vs audited-annual difference to the AI as a fact it can cite later (follow-up, not this diff).
7. **Lines worth adding at near-zero cost.** These are optional; if they're out of scope (R7), list them as follow-ups:
   - interest expense
   - held-to-maturity short-term investments
   - share of associates' profit
   - for NH: net interest income and loan-loss provision expense.
8. **Identity tests on fixtures (AC6, R8).** Assert:
   - assets = liabilities + equity (±1 VND, or exact)
   - gross profit ≤ revenue for CT
   - FCF = CFO − |capex|
   - parent equity ≤ total equity
   - ROE cross-check against vendor `roe` within a stated tolerance, for at least 3 symbols, mirroring the ADR 0005 cross-check.
9. **Consolidated basis.** Confirm VietCap returns consolidated statements ("hợp nhất"), not the parent-only ones, and record it in the ADR.

## Risks
- **YTD cash flow read as quarterly.** FCF and CFO would be silently wrong by up to 4× and the AI would cite them as fact. This is the biggest risk; recommendation 5 is the guard.
- **Gaps for non-applicable lines.** If bank, broker and insurer lines that don't exist are recorded as gaps, there will be permanent open gaps. Also, if a line is missing only for that line, any whole-period suppression rule could block signals for NH/CK/BH.
- **Mixed units.** bps and ppm side by side is an easy off-by-100 error.
- **Misleading ratios.** D/E and FCF for banks, and liabilities/equity for insurers, look precise but mislead. Mark them not applicable; don't calculate them anyway.
- **Share-count effects.** A bonus issue inside the TTM window (TCB 2026Q3) restates EPS. P/E across that boundary jumps, which is expected but should be explained to the AI. Whether `numberOfSharesMktCap` excludes treasury shares is still unverified.
- **Very large P/E.** With a tiny positive EPS, P/E gets huge but stays a safe integer. Add a sanity cap or flag rather than an overflow.
- **Terms and stability.** One more unofficial endpoint section (CASH_FLOW) on the same host carries the ADR 0005 posture. A layout change hits all statements at once.

## Open questions (each with a proposed default)
1. Ratio unit: bps (as in the AC) or ppm (as in the code)? **Default: ppm**, for consistency with signals. This needs Ming because it changes the AC wording.
2. Should P/E and P/B be stored per period at the period-end close, or computed at read time from the latest close? **Default: compute at read time in core.** Store only fundamental ratios per period; the AI cites the price row and the financials row.
3. D/E definition: interest-bearing debt / total equity, or total liabilities / equity? **Default: interest-bearing debt / total equity**, with liabilities/equity optional as a separately named ratio.
4. ROE/ROA averaging: two points (P and P−4) or five quarter-ends? **Default: two points**, the simplest and closest to vendor practice. Confirm with the vendor `roe` cross-check.
5. For NH/CK/BH, should FCF, D/E and gross margin be `not_applicable`, or should we add type-specific substitutes (bank NII, provisions)? **Default: not_applicable now; substitutes as a debt issue.**
6. Should vendor ratios (`roe`, `pe`, `pb`) be stored as cross-check columns? **Default: use them in tests or the dry-run only, not stored**, so nothing the AI reads comes from an unverified source.
