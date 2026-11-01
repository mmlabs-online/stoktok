## Findings

Tags: [V] = verified from vnstock source fetched today (thinh-vu/vnstock, main). [R] = recalled or inferred, not verified. Nothing was called live. The sandbox cannot reach VN hosts.

### 1. VietCap IQ (iq.vietcap.com.vn) is the best no-account candidate
- [V] vnstock's VCI financial module uses plain REST GET with no body. The base URL is `https://iq.vietcap.com.vn/api/iq-insight-service`. This is a different host from the one STK-038 uses for prices (`trading.vietcap.com.vn`).
- [V] Quarterly ratios: `GET {base}/v1/company/{SYMBOL}/statistics-financial`, no params.
  - The whole `data` payload is loaded as a table of rows.
  - vnstock labels periods from a year field (`year` or `yearReport`) and a quarter field (`quarter` or `lengthReport`). It labels `Y-Qn` when the quarter is below 5. So a quarter value of 5 or more means a year row. We must skip those.
  - The raw field codes are in `RATIO_COLUMN_MAP_SNAKE`: `earningPerShare`, `bookValuePerShare`, `afterTaxProfitMargin`, `grossMargin`, `roe`, `pe`, `pb`, `numberOfSharesMktCap`, `marketCap`, `equity`, `ebit` and `ebitda`. The map also contains `ratioTTMId` in the EN and VI maps. This hints that these rows are TTM-based ratios.
  - Revenue and net income are NOT in the ratio map.
- [V] Statements: `GET {base}/v1/company/{SYMBOL}/financial-statement?section=INCOME_STATEMENT`. The other section values are `BALANCE_SHEET`, `CASH_FLOW` and `RATIO`.
  - The response has `data.quarters` and `data.years`.
  - Field metadata comes from `GET {base}/v1/company/{SYMBOL}/financial-statement/metrics`. Each record has `field`, `parent`, `titleEn` and `titleVi`, keyed by report name.
  - The income-statement line-item codes were NOT in the files I fetched. The `metrics` endpoint lists them. [R] The codes look like `isa1` for revenue and `isa20` for net profit after tax of the parent, as used in the company-service. This is unverified.
- [V] Sector: `GET https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/details?ticker={SYMBOL}`. vnstock reads `data.sectorVn` and falls back to `data.sector`.
  - [R] These look like ICB industry names. The fixture must confirm whether `sectorVn` is Vietnamese-only. Ticket parity with TCBS `industry` is not guaranteed, and ADR 0002 sector normalization (`normalizeSectorLabel`) should handle it.
- [V] vnstock sends a handshake `GET https://trading.vietcap.com.vn/priceboard` and merges its cookies. It also sends `Origin` and `Referer` set to `https://trading.vietcap.com.vn/`, plus a Chrome Windows User-Agent (the UA is from the `USER_AGENTS` table in `browser_profiles.py`, which I did not fetch).
  - Whether iq.vietcap.com.vn REQUIRES these is not known. Our hard rule forbids them, so we send only the honest UA.
  - STK-038's VCI price source already works under that rule, per the ADR (accepted risk). That is mild evidence the vietcap hosts do not insist on browser headers, but it concerns a different host.
- [V] Units and basis: no unit or scale is stated anywhere in vnstock's code. [R] Per-share values are in VND and totals are in VND (not billions), which differs from the TCBS assumption (`BILLION_VND`). This MUST be confirmed from the first dry-run.
  - EPS basis is probably TTM, because of `ratioTTMId`. Keep `TCBS_FINANCIALS_EPS_BASIS`-style `'unverified'` (P/E stays suppressed per ADR 0002) until the dry-run proves it. Do not assume.
- [V] The GraphQL URL `https://trading.vietcap.com.vn/data-mt/graphql` exists in vnstock's constants. The fetched files show no use of it for financials, so REST on iq.vietcap is the path.

### 2. Fallbacks (all [R], nothing fetched)
- KBS (`kbs.com.vn` finance API, used by newer vnstock versions): unofficial, no account. Not verified here. Revisit only if VietCap IQ fails.
- VNDirect finfo (`finfo-api.vndirect.com.vn`, `/v4/financial_statements`, `/v4/ratios`): was public and keyless. I recall it has been unstable and sometimes bot-protected. Unverified.
- CafeF and others: HTML or scraping. Rejected, since they are fragile and the terms are worse.
- SSI: dropped by Ming. TCBS: blocked, 403.

### 3. Terms
- No published terms were checked for iq.vietcap.com.vn. [R] It is an unofficial internal API of the VietCap IQ web app, with no public license for automated use. This is the same risk class as ADR 0004, which Ming has accepted for prices. The ADR should say so explicitly and keep it low volume.

## Recommendations
1. (AC1, ADR) Choose VietCap IQ REST as the primary `FinancialsSource`, named e.g. `vci-iq-public`. It needs no account, matches the STK-038 vendor, and the endpoints are verified from source. Write the comparison as ADR 0005 and mark the units, EPS basis and sector field as UNVERIFIED until the dry-run.
2. (AC2, ADR 0002 unchanged) Reuse the TCBS structure, with each call per symbol:
   - `statistics-financial` provides EPS and BVPS per quarter.
   - `financial-statement?section=INCOME_STATEMENT` provides revenue and net income per quarter.
   - `company/details?ticker=` provides the sector.
   - The code then feeds `normalizeQuarterlyFinancials`, with these parts reused as they are in `tcbs-financials.ts`: the dup-period dropping, the `ticker_mismatch` check, the `maxPeriodsPerResponse` guard, a 404 meaning no data, and the 403 mapped to a non-retryable `SourceError`, as done for VCI prices.
   - Skip rows with quarter 5 or more (year rows).
   - Map field codes through a single constants block, so a rename fails into `rejected`, not into bad data.
   - Take the income-statement codes from the `metrics` endpoint and record them in the fixtures.
3. (AC2/R4) Use `source` = the new name and `fetched_at` as in the current job. Do not touch the validation, the gap recording or `normalizeSectorLabel`.
4. (AC3/R5) Add a `FINANCIALS_SOURCE` configuration value (default the new source; keep `tcbs-public` selectable) plus the base URL and UA in `config.ts`, as is done with `VCI_CONFIG`. No credentials are needed. Use the honest stoktok UA only. No Origin, Referer, cookie handshake or Chrome UA. On 403, fail with "blocked by source, no bypass".
5. (AC5) Create fixtures by hand, shaped like what the endpoints [R] return, and mark them as synthetic until Ming's dry-run on the real network produces recorded ones. Tests: unit-scale mismatch, a quarter-5 row skipped, duplicate periods, an empty list, a ticker mismatch, an unknown sector, and a 404 and 403.
6. (AC4) Put a one-shot checklist in the ADR for Ming: run `pnpm worker:financials --dry-run` for 2 to 3 symbols, one of them a bank (HDB or VCB, since banks have different line items), and confirm the units, the EPS basis (compare with a published quarterly EPS), revenue and net income, and the sector label. Flip the units and EPS basis constants only after that.
7. Banks and securities firms use different income-statement codes (revenue is not a normal "net sales" line). Decide whether those yield a gap, with a reason, rather than a guess. This is a finance consult item.

## Risks
- Unofficial endpoint: it may change, be rate-limited, or get a bot challenge like TCBS did. Mitigation: low volume, a request delay, and no bypass. The fallback is gap recording, with the signal suppressed per R4.
- Units and EPS basis are not verifiable from source. The wrong unit would be caught by the core guards. A wrong TTM versus quarterly assumption would not be caught. Keep P/E suppressed until confirmed.
- Income-statement field codes are unknown from the fetched files. They need the `metrics` response from a live call (a human step on Ming's network).
- If iq.vietcap.com.vn needs Origin or Referer, we cannot meet the hard rule. Then the outcome is BLOCKED, or a fallback to KBS or VNDirect, still unverified.
- The sector may be in Vietnamese and differ from TCBS naming, which could affect any sector grouping that already exists.
- Several fields in `statistics-financial` may mix quarterly and TTM rows with a similar shape (`ratioTTMId`).

## Open questions
1. Does iq.vietcap.com.vn answer 200 to a request with only the stoktok UA? This needs one live call from Ming's machine. Proposed default: implement it anyway, with the 403 path handled.
2. What are the exact income-statement codes for revenue and net income (parent shareholders), and for banks? Source: the `financial-statement/metrics` response. Proposed default: constants block with the recalled `isa1` and `isa20`, flagged UNVERIFIED.
3. Is EPS in `statistics-financial` TTM? Proposed default: `'unverified'`.
4. Should banks and securities firms be recorded as gaps in v1? Proposed default: yes, if the revenue code is missing.
5. Is a single-step fallback (a second implementation such as KBS) in scope for this ticket? Proposed default: no. Spec §4.3 says primary plus fallback, so open a follow-up ticket.

Files read: /home/spaceM/projects/stoktok/work/tickets/STK-039/ticket.md, /home/spaceM/projects/stoktok/apps/worker/src/sources/tcbs-financials.ts, /home/spaceM/projects/stoktok/apps/worker/src/sources/financials-source.ts, /home/spaceM/projects/stoktok/apps/worker/src/sources/vci.ts. I did not read the other files in the brief (jobs/financials-sync.ts, core financials, ADR 0002 and ADR 0004), so verify that nothing there conflicts with the above. I grepped config.ts only for the User-Agent lines.
