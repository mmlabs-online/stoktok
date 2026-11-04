## STK-042 consult: finance-investment-researcher (read-only)

I didn't reach VietCap from here. The bank, broker and insurer field codes below are **UNVERIFIED** until someone records a live sample. What I did verify comes from the STK-039 live samples and the current code.

### Findings

**F1. The recorded `metrics` dictionary only covers ordinary companies (`CT`), so AC1 can't be met from it yet.**
- `work/tickets/STK-039/live-samples/HPG_financial-statement_metrics.json` lists only `isa1`–`isa24` under INCOME_STATEMENT. It has no `isb*`, `iss*` or `isi*` titles.
- The HPG income rows do carry a **union schema** with every type's columns:
  - `isb25`–`isb41`: 17 bank lines.
  - `iss42`–`iss50` and `iss115`–`iss174`: securities firm lines.
  - `isi51`–`isi180`: insurer lines.
- On a `CT` row these columns hold **`0.0`, not null**. Only the newest codes (`isi168`+) are null.
- So the metrics dictionary (it is probably per-symbol) and the statements must be recorded for one bank, one broker and one insurer, e.g. VCB, VND and BVH/BMI. The mapping can only be chosen from those recordings.

**F2. A zero-filled schema makes a wrong field fail silently.**
- `normalizeQuarterlyFinancials` accepts `revenue === 0`. Only negative or out-of-band values are rejected.
- If the mapping picks a column that is "not applicable" for that type (e.g. `isa3` on a bank), revenue is stored as 0.
- In `growth.ts:32`, `base.netIncome >= mulDiv(0, …)` is then always true, so the `minBasePpmOfRevenue` gate is quietly switched off.
- The same applies to `bsa210`. A 0.0 minority on a type whose minority sits in a `bsb*` line makes BVPS = total equity, without any error.
- `bsa78` = 0.0 is caught, because BVPS 0 is below `minAbsBvpsVnd` 100.

**F3. Revenue line per type.** Revenue feeds only the 1% base gate in growth. The pick needs to be (a) always > 0, (b) a measure of scale, and (c) a single source field, not a sum we compute.

| Type | Recommended "revenue" | Why | Typical parent NI ÷ revenue |
|---|---|---|---|
| NH | Total operating income (Tổng thu nhập hoạt động, TOI) | Market convention for bank "revenue"; net of interest expense, so the ratio is comparable with CT net sales; never negative in practice | ~25–50% |
| CK | Total operating revenue (Cộng doanh thu hoạt động), gross | Gross line stays ≥ 0 because FVTPL losses are booked in expenses, so it avoids `negative_revenue` rejects; a net figure can go negative | ~15–50% |
| BH | Net revenue from insurance business (Doanh thu thuần hoạt động kinh doanh bảo hiểm) | The insurer equivalent of `isa3`; more stable than gross written premium | ~3–15% (life insurers lowest) |

- Fallback for NH: if no TOI line exists, use gross interest income (Thu nhập lãi và các khoản thu nhập tương tự). Do not add NII and non-interest lines ourselves.
- At 1%, every type passes the gate easily except near-zero quarters, which is the gate's purpose.
- Bank TOI is about 1.6e13 VND per quarter for VCB, inside `maxAbsTotalVnd` 1e15.

**F4. Parent net income.**
- The VietCap layout probably reuses `isa16`/`isa20`/`isa21`/`isa22` (PBT, NPAT, minority, parent) for every type, since the type-specific blocks are only the operating lines. Unverified.
- Accept `isa22`, or a type-specific line, only if the live sample satisfies `parent ≈ isa20 − isa21` and is non-zero in every emitted quarter.
- Banks, brokers and insurers have small minority interests. A ±3% check against VietCap therefore **cannot tell parent from total NPAT** for these types, so the identity check is the real guard.

**F5. Peer grouping.**
- Peers match exactly on `sectorVn` (ICB level 2), and `minPeers` 5 excludes the subject itself.
- Watched today: 4 banks (SHB, TCB, TPB, VCB) and 3 brokers (AGR, BSI, VND). If the universe is the tracked symbols, every one gets `peers_insufficient` on P/E and P/B. P/E/P/B signals need at least 6 banks and 6 brokers tracked.
- VietCap's `comTypeCode` comes from ICB level 4. `NH` also covers "Tài chính cá nhân" and "Quản lý tài sản" (vnstock const.py), so `NH` is not only banks.
- Level-2 "Dịch vụ tài chính" mixes `CK` brokers with `CT` and `NH` financial firms. A broker's P/B median could include a consumer-finance or holding company.
- No insurer is on Ming's watchlist, so AC1 and AC3 need an extra symbol.

**F6. The P/E and P/B meaning for financials.**
- For banks P/B is the primary metric; for brokers and insurers it is about equal with P/E.
- Bank P/B dispersion is **structural**: VCB around 2–2.5x versus SHB/TPB around 1x, driven by ROE, asset quality and state ownership. A plain "vs sector median" rule will flag VCB "expensive" and SHB "cheap" almost permanently, which is not a mean-reversion signal.

**F7. Basic EPS reported in Vietnam differs from our derivation.**
- Vietnamese basic EPS (VAS 30, isa23) uses parent NI minus the bonus and welfare fund appropriation, divided by weighted-average shares restated for bonus and stock dividends.
- Ours is TTM parent NI ÷ shares in the period row.
- So derived EPS will run a few % above company-reported EPS, more at banks with large welfare funds. The ±3% check must be against VietCap's `pe`, which appears to use plain NI ÷ market cap. It must not be against isa23 or company reports.

### Recommendations

1. **(AC1)** Record `metrics`, `INCOME_STATEMENT`, `BALANCE_SHEET`, `statistics-financial` and `details` for VCB (NH), VND (CK) and one insurer (BMI or BVH). Choose codes by `titleVi` in those files.
   - Put one constant `VCI_IQ_FIELDS_BY_COMPANY_TYPE: Record<'CT'|'NH'|'CK'|'BH', {revenue, parentNetIncome, ownersEquity, minorityInterests | null}>`.
   - Mirror it in ADR 0005 with code, `titleVi` and the date recorded.
   - `minorityInterests: null` should mean "this layout has no minority line; parent equity = equity". That must be an explicit per-type declaration, never inferred from a 0.0.
2. **(AC1/AC2, R4)** Treat **0 on the mapped revenue field as missing** for vci-iq (new reason, e.g. `zero_revenue` / `missing_revenue`), with a core unit test. Add a fixture test per type asserting that the mapped revenue, parent NI and equity are non-zero in every fixture quarter, and that `parent == isa20 − isa21`. This is the guard against picking a "not applicable" column.
3. **(AC4, R5)** Replace `SUPPORTED_COMPANY_TYPE = 'CT'` with a config list `supportedCompanyTypes` (default `['CT']`).
   - Add a type only after its cross-check passes. Anything not listed, including unknown codes, stays `unsupported_company_type`.
   - Reason: `VCI_IQ_FINANCIALS_EPS_BASIS` applies to the whole source. Once it flips to `'ttm'`, an unverified bank mapping would immediately feed live P/E.
4. **(AC3) Cross-check method.** Compare amounts, not per-share values, so share-count issues stay separate.
   - TTM: `marketCap_P / pe_P` vs Σ mapped parent NI over P..P−3, within ±3%.
   - Book: `marketCap_P / pb_P` vs (equity − minority)_P, within ±3%.
   - Then the per-share version the AC asks for: `marketCap_P / pe_P / shares_P` vs derived EPS. It uses the same `shares_P`, so it adds nothing beyond the amount check, but it satisfies the AC wording.
   - Pair statement period P with the **stats row for P**, never the latest row; the ratio endpoint can lag.
   - Use profitable quarters only, skipping `pe` ≤ 0.
   - Record the rounding precision of `pe` and `pb`. One decimal on `pe` around 6 already costs about ±0.8% of the 3% budget.
   - Run it on at least one symbol per type; two banks if possible, since banks are 4 of the 7 symbols.
5. **(AC3) Share-count timing pitfalls.** Spell these out in the dry-run notes:
   - **Market-cap date vs share-count date.** If `marketCap` = price × shares at date X but VietCap's EPS used shares at date Y, then `marketCap/pe` = TTM NI × shares_X/shares_Y. SHB, TPB, VCB, VND and BSI pay stock dividends or run rights issues often (10–50%), so one corporate action between X and Y blows the 3% budget. Before comparing, check that `marketCap_P ≈ close(date) × numberOfSharesMktCap_P`, and pick a P with no share change around it.
   - **Is `numberOfSharesMktCap` per period or current?** On HPG it was the same on every recent row. Check a symbol with a recent stock dividend (e.g. VCB or SHB). If it is current-only, historical BVPS for older quarters is understated after any issue. TTM EPS is already restated by design (ADR 0005).
   - **Treasury shares.** The VietCap check cancels them out, because both sides use VietCap's own count. Compare shares independently with paid-in capital ÷ 10,000 VND par. If they match, the count is issued shares, treasury included, which overstates the denominator for brokers that hold treasury stock.
   - **Restatements.** Audited Q2/Q4 figures can differ from the earlier quarterly ones VietCap used. Avoid a P whose window spans a recent audit, or note it.
6. **(R7, follow-ups, not this diff)**
   - Peer key = `sectorVn` + `comTypeCode`.
   - P/B for banks adjusted for ROE, or a "persistent premium/discount" caveat.
   - A per-type `minBasePpmOfRevenue` only if Ming ever raises it well above 1%; at 5% it would suppress insurers and low-margin `CT` companies first.
   - Tracked-universe size, so bank and broker valuation signals can ever reach `minPeers`.
   - The `financials_source_mixed` check (old TCBS bank rows likely used other definitions).
7. **ADR 0005 text.** Document that the single global 1% gate means different things per type (TOI vs net sales vs net insurance revenue), and that this is accepted because the gate only screens out near-zero bases.

### Risks

- **Silent mis-mapping from 0.0 fill.** Wrong-column revenue gives 0 and disables the growth gate. A wrong minority column overstates BVPS slightly. Severity: medium, invisible without Rec 2.
- **Structural P/B labels.** VCB "expensive" and SHB/TPB "cheap" can last for years. Treating them as signals could cause bad trades. Severity: high once peers suffice, latent until then.
- **Stock-dividend timing.** VN financials issue shares often. A share-count mismatch causes false fails (blocking the ticket) or, worse, a false pass that hides a stale share count in older BVPS.
- **Insurer layout drift.** VN insurers are moving to new reporting formats (2022 Insurance Business Law and its circulars), which may move the revenue line to new `isi1xx` codes (note `isi168`+ are null today). A 16-quarter window can straddle the switch, so the old field turns 0 or null partway through. Rec 2 catches this as a reject, not wrong data.
- **`NH` is not only banks.** A consumer-finance or asset-management company tagged `NH` gets the bank mapping. Its layout is probably the credit-institution one, but this is unverified.
- **Mixed sources.** Older TCBS rows for these symbols, if any, have a different revenue definition and possibly a different NI one. Growth at the source boundary may be biased, with only the staleness check guarding it.

### Open questions (each with a proposed default)

1. **Insurer sample.** None is on the watchlist. Temporarily track one insurer for the dry-run (default: BMI on HOSE), or defer `BH` (stays `unsupported_company_type`, AC4) and record that AC1/AC3 are met for NH/CK only? Ming decides; my default is to track BMI for the dry-run.
2. **Insurer revenue.** Net insurance business revenue (default) or net premium earned? STK-039 proposed net premium; either passes a 1% gate.
3. **Bank revenue.** TOI (default) or gross interest income?
4. **Gate types on verification** with `supportedCompanyTypes` (default yes, so a type is enabled only after its ±3% pass)?
5. **Universe.** Should Ming add banks or brokers so they reach `minPeers` 5, or accept `peers_insufficient` for these 7 for now (default: accept, follow-up)?

Files read:
- /home/user/stoktok/work/tickets/STK-042/ticket.md
- /home/user/stoktok/docs/adr/0005-vci-iq-financials-source.md
- /home/user/stoktok/work/tickets/STK-039/consult-finance-investment-researcher.md
- /home/user/stoktok/work/tickets/STK-039/live-probe.md
- /home/user/stoktok/work/tickets/STK-039/live-samples/HPG_financial-statement_metrics.json
- /home/user/stoktok/work/tickets/STK-039/live-samples/HPG_financial-statement_section_INCOME_STATEMENT.json
- /home/user/stoktok/apps/worker/src/sources/vci-iq-financials.ts
- /home/user/stoktok/packages/core/src/market/financials-derive.ts
- /home/user/stoktok/packages/core/src/market/financials.ts
- /home/user/stoktok/packages/core/src/market/config.ts
- /home/user/stoktok/packages/core/src/signals/growth.ts
- /home/user/stoktok/packages/core/src/signals/valuation.ts

Sources:
- [vnstock VCI const.py (com_type_code map by ICB level 4)](https://raw.githubusercontent.com/thinh-vu/vnstock/main/vnstock/explorer/vci/const.py)
