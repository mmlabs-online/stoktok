STK-042 consult (data-engineer, read-only)

> Orchestrator note (2026-11-04): after this consult, the orchestrator tried one GET with the honest stoktok User-Agent and `Accept: application/json` to `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/VCB/details` from the sandbox. Result: `CONNECT tunnel failed, response 403` from the sandbox egress proxy. The sandbox cannot record live samples; no bypass was attempted.

## Findings

**Recorded fixtures and dictionary: nothing usable for NH/CK/BH line items.**
- The only recorded financials are for HPG (`comTypeCode` CT). They are in `/home/user/stoktok/work/tickets/STK-039/live-samples/` and trimmed in `/home/user/stoktok/apps/worker/test/fixtures/vci-iq/`.
- The one non-CT fixture, `details-bank.json`, is hand-written (made-up ticker TST, `comTypeCode` NH, sector "Banks", `sectorVn` "Ngân hàng", `isBank` true). Its README says it is not recorded. It has no statement rows, so it only tests the reject path.
- `HPG_financial-statement_metrics.json` is one HPG response. I searched it for `isb*/isi*/iss*` income codes and `bsb*/bsi*/bss*` balance codes. It holds only three stray codes, all balance-sheet children (`bsb108`, `bsi141`, `bss134`), and no bank/broker/insurer income lines.
- The dictionary therefore cannot choose revenue or net income for NH/CK/BH. The STK-039 live probe only assumed that other types use `isb*`/`isi*` (ADR 0005 "UNVERIFIED": layouts not probed). I did not find the broker prefix confirmed anywhere.
- AC1 says "from the recorded metrics dictionary and live samples". The dictionary half does not exist for these types, so live samples are required.

**Live samples are needed.** Per type, record these four responses for one symbol each (suggested: TCB or VCB, VND, BVH or another listed insurer):
- `/{SYM}/financial-statement/metrics`: the per-type dictionary. The `metrics` response may be type-specific or may list all layouts; this is unconfirmed.
- `financial-statement?section=INCOME_STATEMENT` and `?section=BALANCE_SHEET`.
- `statistics-financial` and `details?ticker=`.
- `/details` also gives `comTypeCode` and the real `isBank` flag.
- Note that none of Ming's 11 symbols is an insurer (the list is SHB, TCB, TPB, VCB; AGR, BSI, VND; the other 4 are CT). The BH sample needs a symbol outside the watchlist (BVH, BMI, PVI or similar). Ming should confirm that is acceptable. The `comTypeCode` for an insurer (BH) should also be confirmed from `details`.

**Sandbox reach: not tested.** My toolset here has only Read, Grep, Glob and WebFetch, with no shell, so I could not do a curl GET with the honest stoktok User-Agent. WebFetch goes through a third-party fetcher with its own headers and a summarising model. That would break the ADR 0005 header policy ("only honest User-Agent and Accept") and would not return raw JSON, so I deliberately did not use it. The sandbox has a policy-enforcing egress proxy (see `/root/.ccr/README.md`), so `iq.vietcap.com.vn` may be blocked. STK-039's samples were recorded from Ming's WSL machine. Assume the sandbox cannot record them, and have the orchestrator try one curl GET (honest UA) per endpoint. If it gets a 403, 405 or 407 from the proxy, fall back to Ming's machine. Do not bypass.

**Current adapter** (`/home/user/stoktok/apps/worker/src/sources/vci-iq-financials.ts`)
- It hard-codes `VCI_IQ_FIELDS` (`isa3`, `isa22`, `bsa78`, `bsa210`) and `SUPPORTED_COMPANY_TYPE = 'CT'`.
- It checks `comTypeCode` after fetching and parsing statements, and rejects every emitted period as `unsupported_company_type` when the type is not CT.
- Details are fetched only if periods exist, and the result is cached for the sector lookup.
- `deriveVciIqQuarter` in `/home/user/stoktok/packages/core/src/market/financials-derive.ts` is generic: it takes `netIncomeByPeriod`, `equity`, `minority` and `shares`. It needs no change if the equity/minority/net-income codes are mapped per type.
- Revenue goes through `normalizeQuarterlyFinancials` and `DEFAULT_FINANCIALS_SANITY`. Bounds tuned for industrial firms may reject a bank's or broker's real values (large numbers, or zero or negative revenue-like lines). Check them against the samples.

## Recommendations
1. **Sample recording (AC1).** Record the four responses above per type, trimmed, into `apps/worker/test/fixtures/vci-iq/` (for example `bank-*`, `broker-*`, `insurer-*`). Document in the fixtures README that they are real recordings, and remove or replace the hand-written `details-bank.json` for the bank case. Also store the raw samples in `work/tickets/STK-042/live-samples/`.
2. **Mapping constant (AC1).** Replace the single field set with one constant keyed by `comTypeCode`, for example `VCI_IQ_FIELDS_BY_TYPE: Record<'CT'|'NH'|'CK'|'BH', {netSales, parentNetIncome, ownersEquity, minorityInterests}>`. `shares`, `companyType` and `sector` stay global. Record the same table in ADR 0005 with the dictionary `titleEn` for each code, and update the ADR's UNVERIFIED line. Supported types are the keys of that map, so any other value (including `comTypeCode` missing or a 404 on details) stays `unsupported_company_type` (AC4). Consider a distinct `missing_company_type` for missing details, as the STK-039 review suggested.
3. **Branching.** Fetch `details` first (before statements), look up the field set, and parse income and balance with those codes. This costs the same four GETs, and for an unsupported type it can skip the statement fetches and lower the request count (details is cached anyway). Keep the "emit only the latest N quarters" logic and report unsupported types for the emitted range only. If you keep the current order, the behaviour is unchanged for CT.
4. **Revenue line per type: a finance decision, to confirm from the live dictionary.**
   - Bank (NH): candidates are total operating income, which is usually the line labelled "Total operating income" or "Thu nhập hoạt động" in the dictionary, or net interest income plus net fee income. Pick one total line, because banks have no "net sales".
   - Broker (CK): total operating revenue.
   - Insurer (BH): net premium revenue, or total revenue including investment income.
   - Every type needs the parent net income line ("attributable to parent"), not total net profit including minorities. Record the chosen code and the dictionary title next to each constant so the choice is auditable. Ask `finance-investment-researcher` to sign off on the revenue choice.
5. **Equity and minority per type.** The equity and minority-interest codes for bank, broker and insurer balance sheets almost certainly differ from `bsa78` and `bsa210`. Take them from each type's dictionary. A null minority stays "missing", not 0 (existing rule). BVPS must stay the parent-equity figure.
6. **Core unit tests (AC2).** `deriveVciIqQuarter` is already generic, so add per-type tests for the field mapping. Put the mapping resolver in a small function or constant that the adapter tests exercise with the recorded fixtures.
7. **Gaps and validation (R4).**
   - Missing mapped codes, null values or missing quarters follow the existing rule: the period is rejected and recorded as a gap, with no zero-fill.
   - If a mapped code is absent from a whole response (a renamed code or a layout change), every period is rejected rather than stored wrong. That is the existing behaviour: "A renamed code makes periods rejected, never wrong".
   - Add a test for each type with one code removed.
   - Run health: `nonFailingRejectReasons` defaults to `['unsupported_company_type']`. Once NH/CK/BH are supported, rejects for those symbols are real failures and should fail the run. A genuinely unsupported type (for example `BH` before the insurer sample exists, or another code) still produces non-failing `unsupported_company_type`.
   - Check the unit guards (`toVndAmount`, `DEFAULT_FINANCIALS_SANITY`) with real bank-sized values, since bank balance sheets are far larger than HPG's.
   - Banks report some quarters semi-annually or with different year/quarter structure. The existing `lengthReport` 5 handling should work, but verify with the sample.
8. **Cross-check (AC3).**
   - Method: for each type, compute derived TTM EPS and BVPS with `deriveVciIqQuarter` for the latest quarter. Compare to `marketCap / pe / shares` and `marketCap / pb / shares` from the symbol's `statistics-financial` row (the vendor ratio rows have `pe`, `pb`, `marketCap`, `numberOfSharesMktCap`). Pass if each is within ±3%.
   - Run it from `pnpm worker:financials --dry-run` on Ming's machine (that is also where STK-039's live samples came from, and its dry-run checklist item 2 is the same comparison). It needs live network, which tests must not use (AC5).
   - Alternatively, if live samples are recorded, run the comparison offline from the recorded `statistics-financial` and statement files with a small script or a test that asserts the ratio against recorded values. This gives a reproducible record of the ±3% result, and it avoids a live run in tests. Record the numbers (derived, vendor, delta per symbol and type) in the impl-log or ADR 0005.
   - Interpreting failures: a bank's P/B often disagrees if `numberOfSharesMktCap` includes treasury shares or if the vendor P/B uses total equity. Do not tune the tolerance. If a type fails, leave it rejected (AC4) and record why.
   - The EPS-basis flip (`VCI_IQ_FINANCIALS_EPS_BASIS` to `'ttm'`) is a separate STK-039 gate (3 symbols). STK-042 should not flip it.

## Risks
- Live samples are the critical path, and the sandbox probably cannot fetch them, so the ticket likely blocks on Ming (or a command run on his machine) before the plan is fully decidable. The planner should list the samples as a prerequisite and not guess codes.
- Unofficial API, and the earlier BALANCE_SHEET call reset the connection twice (STK-039 live-probe). Expect flaky recording; use one request at a time with delays.
- Per-type code tables may drift. The all-or-nothing reject behaviour limits the damage but creates gap noise.
- The EPS and BVPS formulas may be semantically off for financials. TTM EPS and parent BVPS are standard, but banks with preferred shares, or brokers and insurers with unusual equity items, could fail ±3%. Insurer coverage depends on a symbol that is not in Ming's list.
- With types now supported and rejects now run-failing, a bad type mapping can fail the whole financials job. Consider per-symbol isolation (the job's existing reject handling) and check it.
- ADR 0005 and the finance sign-off on revenue lines are required by AC1.

## Open questions
1. Is the sandbox allowed to reach `iq.vietcap.com.vn` (try a curl GET with the honest UA)? If not, will Ming run the recording command on his machine?
2. Which insurer symbol should be used for the BH sample, since none of the watched symbols is an insurer? Is a non-watched symbol acceptable?
3. Does `/financial-statement/metrics` return a type-specific dictionary per symbol, or one for all types? (Unknown until a bank sample exists.)
4. Which revenue definition does Ming want for banks (total operating income vs net interest income) and for insurers (net premium vs total revenue)? This is a finance-researcher call.
5. Should a missing `comTypeCode` / details 404 get its own reject reason, and should it be non-failing?

Files read: `/home/user/stoktok/work/tickets/STK-042/ticket.md`, `/home/user/stoktok/docs/adr/0005-vci-iq-financials-source.md`, `/home/user/stoktok/apps/worker/src/sources/vci-iq-financials.ts`, `/home/user/stoktok/packages/core/src/market/financials-derive.ts`, `/home/user/stoktok/work/tickets/STK-039/live-probe.md`, `/home/user/stoktok/apps/worker/test/fixtures/vci-iq/` (README, details-bank.json), `/home/user/stoktok/work/tickets/STK-039/live-samples/HPG_financial-statement_metrics.json` (searched).
