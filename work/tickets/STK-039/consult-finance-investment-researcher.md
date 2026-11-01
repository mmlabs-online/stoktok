## STK-039 consult: finance-investment-researcher (read-only)

Note: I could not reach VietCap from here. The VietCap details below come from the vnstock source on GitHub (`vnstock/explorer/vci/{financial,company,const}.py`). The live response shape and units are **UNVERIFIED**.

### Findings

**F1. What the code needs today**
- **P/E** (`valuation.ts`, `inputs.ts`): `ttmEps` takes either the latest row (`ttm`) or the sum of the last 4 rows (`quarterly`).
  - `resolveEpsBasis` returns `unverified` unless every row for the symbol comes from sources that declare the same basis. `unverified` suppresses P/E (`eps_basis_unverified`).
  - So P/E already refuses to mix sources. The `epsBasisBySource` map in `cli.ts:77` has only `tcbs-public: 'unverified'`, so P/E has never produced a value.
- **P/B**: uses only the latest row's `bvps`. It does **not** check that sources are consistent.
- **Growth** (`growth.ts`): compares `netIncome` year on year across 8 consecutive quarters (`comparisons` + 4).
  - `revenue` is used only in the `minBasePpmOfRevenue` check: a base quarter's net income must be at least 1% of its revenue.
  - It does **not** check that sources are consistent. A new-source quarter can be compared with a TCBS quarter from a year earlier.
- **Sector peers**: grouped by exact string match on `symbols.sector`, with `minPeers` 5 (allowed range 3–50).
  - `sector_source` is stored but the rule never reads it.
  - A missing label never overwrites a known sector (ADR 0002). So a symbol whose sector fetch fails keeps its old TCBS label.
- **Normalize guards** (`financials.ts`): a wrong unit for revenue, net income or BVPS gets rejected, not stored.
  - Billions vs VND moves revenue outside the 1e6..1e15 band, and BVPS below 100 fails `minAbsBvpsVnd`.
  - **EPS has no lower bound.** EPS published in thousands of VND (for example `4.5`) would be stored as 5 VND and pass.
- **Partial-quarter policy**: a period missing any of the four values is rejected. Bank, securities and insurance layouts with no plain `revenue` field would therefore be dropped completely, not stored without revenue.
- **Freshness**: `financialsMaxFetchAgeDays` is 7. Once TCBS has been blocked for more than 7 days, any TCBS row a rule uses triggers `financials_fetch_stale`.
  - This happens to stop growth mixing sources, but the reason code is misleading ("stale", not "mixed source").
- **Re-sync**: overwrites every period in the 12-quarter lookback that the new source returns. On the first live run, every overlapping period will show up in `restated`. That list works as a ready-made per-field diff between the two definitions.

**F2. What VietCap offers (via vnstock)**
- The financials host is `iq.vietcap.com.vn/api/iq-insight-service/v1/company/{sym}/…`, a different host from the price chart in ADR 0004. The paths are:
  - `statistics-financial` (ratios)
  - `financial-statement?section=INCOME_STATEMENT|BALANCE_SHEET|…`
  - `financial-statement/metrics` (field dictionary with vi/en titles)
- Periods are `yearReport` / `lengthReport`. It is not known whether `lengthReport` 5 means a full year; check this.
- The ratio keys include `earningPerShare`, `bookValuePerShare`, `pe`, `pb`.
- vnstock does a session handshake against `trading.vietcap.com.vn/priceboard` first, which suggests the API may need a cookie. That could clash with the honest-header rule in ADR 0004.
- VietCap sorts companies with `com_type_code`, keyed by the Vietnamese ICB level-4 name: `CT` (ordinary company), `NH` (bank), `CK` (securities firm), `BH` (insurer). Each type has a different statement layout.
- Industry labels are Vietnamese ICB names at levels 2, 3 and 4. vnstock's company `details` call uses `sectorVn`.
- Third-party pages show VietCap EPS labelled "EPS (ttm)", so the ratio EPS is **probably TTM**. Unconfirmed.

**F3. Getting the EPS basis wrong mostly cancels out within one source**
- If every peer has the same EPS basis error, P/E vs the peer median is roughly unchanged, because the factor ~4 cancels.
- What does not cancel: the absolute P/E shown and cited in the snapshot, seasonality when a single quarter is treated as TTM, and anything where sources mix. Mixing is where meaning breaks without anyone noticing.

### Recommendations

**R-a. Definitions to pin in the new ADR** (AC1; ADR 0002 "STK-015 must read the recorded EPS basis")
1. **EPS**:
   - Prefer the source's TTM, basic EPS for the parent company, declared `epsBasis: 'ttm'`, and only after it is verified.
   - Do not sum 4 quarterly EPS from statements. After a stock dividend or bonus issue, they use different share counts, and with raw prices (ADR 0004) P/E comes out too high.
   - Computing EPS ourselves (TTM parent net income ÷ current shares) would break ADR 0002's "no value is derived from another" rule. That is Ming's decision.
2. **BVPS**: parent equity (excluding minority interest) ÷ shares outstanding (excluding treasury shares) at quarter end. Take it from the source's `bookValuePerShare`.
3. **Net income**: post-tax profit **attributable to the parent** ("LNST của cổ đông công ty mẹ"), never total post-tax profit. This keeps ADR 0002 unchanged. Map it by the statement field code or `metrics` title, not by a guessed name.
4. **Revenue by company type**:
   - `CT`: net revenue.
   - `NH`: total operating income (TOI).
   - `CK`: total operating revenue.
   - `BH`: net insurance premium revenue, or total operating revenue (pick one and record it).
   - Revenue only drives the 1%-margin check in growth, so the exact pick matters little. What matters is that it **exists**, so bank quarters are not rejected.
   - Record the mapping per `com_type_code` in one constant next to the units (R5).
5. **Source id**: use a separate id such as `vci-iq`, not the price source's `vci-public`. Different host, different verification status (R4 provenance).
   - Add `{ 'vci-iq': <basis> }` to `epsBasisBySource` and keep `tcbs-public: 'unverified'`. P/E stays suppressed for any symbol with mixed rows.
   - Declare the basis `'unverified'` until the dry-run proves it, like TCBS.

**R-b. Sector labels** (ADR 0002 sector rule; AC2)
- Use **ICB level 2**, the Vietnamese name (e.g. "Ngân hàng", "Bảo hiểm", "Dịch vụ tài chính", "Bất động sản"):
  - Level 1 puts banks, insurers and brokers in one group ("Tài chính"), and P/B across those groups is meaningless.
  - Levels 3 and 4 split a personal watchlist so finely that `peers_insufficient` fires almost everywhere with `minPeers` 5.
- Make the ICB level configurable (R5), and log the ICB code in the summary if the source returns one. Names change; codes are stable.
- The "missing label never wipes" rule stays.

**R-c. Live dry-run checklist** (AC4). Run `pnpm worker:financials --dry-run` on the home server against 1 bank, 1 broker, 1 insurer, 1 group with large minority interests (e.g. MSN/VIC) and 1 plain company (e.g. VNM/FPT):
1. No 403 or challenge page, and no cookie or header trick needed. If one is needed, return BLOCKED, Ming's call.
2. **Units**: EPS in the thousands of VND, BVPS around 10,000–60,000, revenue and net income in whole VND (not billions). Check against a published report. EPS is the field the guards do not catch.
3. **EPS basis**:
   - If `eps × shares ≈ sum of the last 4 quarters' parent net income`, it is TTM.
   - If it matches that quarter's parent net income alone, it is quarterly.
   - Allow about ±3% tolerance. Also confirm basic vs diluted.
4. **Net income**: matches the parent line in the published report, not total post-tax profit. The group with large minorities shows the difference.
5. **BVPS × shares ≈ parent equity.**
6. **Bank, broker, insurer**: `rejected` is 0 and revenue is present. Otherwise the type mapping is wrong.
7. **`restated` list**: read it as the TCBS-vs-VietCap diff, if any TCBS rows exist. Systematic per-field differences (for example net income always higher) mean a definition differs, not a real restatement.
8. **Coverage**: the source returns at least 8, ideally 12, quarters. If it returns fewer, older TCBS rows stay in the growth window and the two sources get mixed.
9. **Sectors**: every tracked symbol gets a level-2 label. Compare the labels with the stored TCBS ones, and decide whether to replace all of them in one live run. A partial replacement splits peer groups (see Risks).
10. ETF and fund certificate behaviour (404 vs `[]`) lands in `symbolsWithoutData`.

**R-d. Follow-up tickets** (R7: outside this ticket, because AC2 says signal and sector rules stay unchanged)
- In core, apply the "all rows from one source" check to P/B and growth too, with an explicit `financials_source_mixed` reason code, instead of relying on fetch staleness by accident.
- When grouping peers, require the same `sector_source`.
- Add an EPS sanity cross-check: EPS × shares vs net income.

### Risks
- **Silent change in meaning: growth.** If one source reports parent net income and the other reports total net income, the YoY comparisons at the source boundary are biased.
  - For groups with big minority interests the gap can be 10–50%. The growth threshold is ±10%, so a single boundary quarter can flip bullish ↔ bearish.
  - The 7-day fetch-staleness check is the only guard today.
- **Peer groups split silently.** If the new labels differ in wording or level from TCBS's, or sector fetches fail for some symbols, the same industry ends up under two strings.
  - Result: widespread `peers_insufficient`, or worse, a median taken over a different and smaller set of peers that still reaches 5.
- **EPS unit or basis wrong** while all peers come from the same source: the relative signal survives, but the absolute P/E shown and cited (R9 later) is wrong by about 4× or 1000×.
- **P/B after a stock dividend**: the latest BVPS predates the ex-date while the raw price has already dropped, so P/B reads too cheap until the next quarter.
  - This is not caused by the source switch, but the dry-run on raw vs adjusted prices should look at it.
- **Terms and access**: Vietcap IQ looks like a product platform, not an open endpoint, and the handshake suggests a session is needed. Terms risk is higher than for the chart endpoint. That needs Ming's explicit risk acceptance in the new ADR, as in ADR 0004.

### Open questions (batched for Ming, each with a proposed default)
1. **Do any live TCBS financials rows exist in the DB?** This decides whether mixed rows are a real issue and whether `restated` gives a diff.
   - Default: assume yes, and treat mixing as a risk.
2. **Old TCBS rows**: keep them (default; the overwrite policy replaces overlapping periods) or delete them once the new source covers 12 quarters?
   - Deleting data is irreversible, so Ming decides.
3. **EPS**: use the source's TTM EPS (default), or compute TTM parent net income ÷ shares ourselves? Computing it changes ADR 0002's no-derivation policy.
4. **Sector level**: ICB level 2, Vietnamese name (default), or level 3?
5. **Source id**: `vci-iq` (default) or reuse `vci-public`?
6. **Revenue mapping for insurers**: net premium revenue (default) or total operating revenue?
7. **Access**: if the API needs a session cookie or browser-like headers, return BLOCKED (default, per the ADR 0004 header policy) or ask Ming for an exception?

Files read:
- /home/spaceM/projects/stoktok/work/tickets/STK-039/ticket.md
- /home/spaceM/projects/stoktok/docs/adr/0002-financials-source.md
- /home/spaceM/projects/stoktok/docs/adr/0004-vci-eod-price-source.md
- /home/spaceM/projects/stoktok/packages/core/src/market/financials.ts
- /home/spaceM/projects/stoktok/packages/core/src/signals/{inputs,valuation,growth,config}.ts
- /home/spaceM/projects/stoktok/apps/worker/src/cli.ts
- /home/spaceM/projects/stoktok/apps/worker/src/sources/tcbs-financials.ts
- /home/spaceM/projects/stoktok/apps/worker/src/jobs/financials-sync.ts

Sources:
- [vnstock VCI financial.py](https://raw.githubusercontent.com/thinh-vu/vnstock/main/vnstock/explorer/vci/financial.py)
- [vnstock VCI const.py](https://raw.githubusercontent.com/thinh-vu/vnstock/main/vnstock/explorer/vci/const.py)
- [vnstock VCI company.py](https://raw.githubusercontent.com/thinh-vu/vnstock/main/vnstock/explorer/vci/company.py)
- [vnstock docs: financial statements](https://vnstocks.com/docs/vnstock/bao-cao-tai-chinh)
- [Third-party VCI EPS (ttm) example](https://stockanalysis.com/quote/hose/VCI/statistics)
