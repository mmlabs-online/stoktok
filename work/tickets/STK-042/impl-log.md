## Attempt 1 — 2026-11-04

All `titleVi` values in the plan's Field mapping table were re-checked against each symbol's `*_metrics.json` before coding: all 16 match. No fetch was made; the samples were only read.

### Files touched
| File | Required because |
|---|---|
| `apps/worker/src/sources/vci-iq-financials.ts` | `VCI_IQ_FIELDS_BY_COMPANY_TYPE` (CT/NH/CK/BH), `VCI_IQ_COMMON_FIELDS`, `resolveVciIqFields`; fetchQuarterly uses the resolved set; `rejectZeroRevenue: true`; `supportedCompanyTypes` option (AC1, AC2, AC4) |
| `apps/worker/src/config.ts` | `VCI_IQ_CONFIG.supportedCompanyTypes = ['CT','NH','CK','BH']` (R5, AC4) |
| `packages/core/src/market/config.ts` | optional `FinancialsSanity.rejectZeroRevenue` (default unchanged) |
| `packages/core/src/market/financials.ts` | `zero_revenue` reject |
| `packages/core/src/market/financials.test.ts` | zero-revenue tests (R8) |
| `packages/core/src/market/financials-derive.test.ts` | bank-scale and minority-0 tests (AC2) |
| `apps/worker/src/sources/vci-iq-financials.test.ts` | per-type, identity, equity-component, missing-code, zero-revenue, gating tests; retargeted the two `details-bank.json` tests |
| `apps/worker/src/sources/vci-iq-financials.crosscheck.test.ts` | new offline +-3% cross-check (AC3) |
| `apps/worker/test/fixtures/vci-iq/{vcb,tcb,vnd,bmi}-{statistics,income,balance,details}.json` | 16 new trimmed fixtures (rows from 2022, values unchanged) |
| `apps/worker/test/fixtures/vci-iq/details-bank.json` | deleted (hand-written; replaced by in-memory edit of a recorded details) |
| `apps/worker/test/fixtures/vci-iq/README.md` | new files listed, hand-written entry removed |
| `docs/adr/0005-vci-iq-financials-source.md` | type table, findings, gating, cross-check results, UNVERIFIED and follow-ups |
| `work/tickets/STK-042/impl-log.md` | this log |

### Tests added / changed
- `financials.test.ts` › rejectZeroRevenue: revenue 0 -> zero_revenue; rejectZeroRevenue unset: revenue 0 still accepted
- `financials-derive.test.ts` › bank-scale (VCB 2026Q3 -> 4,986 / 30,359); minority 0 -> BVPS = equity / shares
- `vci-iq-financials.test.ts` › per type (VCB, TCB, VND, BMI): derives for 2026Q3; non-zero in every window quarter; parent NI identity (NH `isa22 = isa20 + isa21`; CK/BH `isa21 = 0`, `isa22 = isa20`); removing each mapped code rejects all 16 periods (4 codes); revenue 0 in one quarter -> `zero_revenue`
- `› NH mapping equity` (VCB, TCB): `bsa78 - bsa210` = sum of components
- `› company type gating`: 'XX', type not in `supportedCompanyTypes`, details 404 / missing comTypeCode, `resolveVciIqFields`, HPG unchanged
- `› minorityInterests null / null value`: null mapping -> minority 0 (synthetic type `ZZ` added to the constant for the test and removed in `finally`); null value -> `missing_bvps`
- `vci-iq-financials.crosscheck.test.ts` › per case: shares stable P-3..P; TTM NI and EPS within 3%; parent equity and BVPS within 3%; stats row paired by period

### Cross-check numbers (recomputed from the fixtures; tolerance 3%, untouched)
| Symbol (type) | P | TTM parent NI | marketCap / pe | Delta | Parent equity | marketCap / pb | Delta | EPS / BVPS | Vendor EPS / BVPS |
|---|---|---|---|---|---|---|---|---|---|
| VCB (NH) | 2026Q3 | 41,661,194,000,000 | 41,661,193,969,891 | +0.000007% | 253,668,704,000,000 | 253,668,704,002,129 | -0.0000001% | 4,986 / 30,359 | 4,985.98 / 30,358.85 |
| TCB (NH) | 2026Q2 | 27,116,046,000,000 | 27,136,067,578,864 | -0.0738% | 179,162,267,000,000 | 179,162,266,999,889 | 0.0000% | 3,827 / 25,283 | 3,829.40 / 25,283.12 |
| VND (CK) | 2026Q3 | 2,099,341,876,358 | 2,099,341,876,362 | -0.00000002% | 21,761,582,798,518 | 21,761,582,798,393 | +0.0000001% | 1,379 / 14,295 | 1,379.06 / 14,295.20 |
| BMI (BH) | 2026Q3 | 260,493,093,057 | 260,493,093,056 | +0.00000002% | 3,076,644,073,949 | 3,076,644,074,131 | -0.0000006% | 1,730 / 20,436 | 1,730.30 / 20,436.35 |

All within 3% (worst: TCB 2026Q2, -0.07%), so no type was dropped: `supportedCompanyTypes = ['CT','NH','CK','BH']`. `pe`/`pb` have 10 decimals, so precision is negligible. TCB 2026Q3 (bonus issue) is not used as P; its amounts also agree (+0.002%).
2026Q3 per-symbol expectations from the plan hold exactly: VCB revenue 25,431,117,000,000 NI 9,033,302,000,000 EPS 4,986 BVPS 30,359; TCB 16,587,715,000,000 / 7,942,932,000,000 / 2,694 / 17,601; VND 1,714,820,453,789 / 329,458,120,320 / 1,379 / 14,295; BMI 1,563,314,122,394 / 75,776,567,450 / 1,730 / 20,436.

### Checks (actual output summary)
- typecheck: `pnpm typecheck` clean (core, db, web, worker)
- lint: `pnpm lint` clean, no warnings
- test: core 498 passed; db 117 passed, 1 todo; worker 228 passed (14 files); web 214 passed

### Out-of-plan files
None. (No git repo here, so the diff size is estimated; nothing committed, as instructed.)

### Follow-ups (noticed, not done)
- Peer key `sectorVn` + `comTypeCode`; ROE-adjusted bank P/B or a structural premium/discount caveat; tracked-universe size (only 4 banks, 3 brokers -> `peers_insufficient`); `financials_source_mixed` check; distinct `missing_company_type` reason; EPS-basis flip to `'ttm'` (separate ADR gate); per-type `minBasePpmOfRevenue` if the gate is raised; verify `NH` on a consumer-finance or asset-manager symbol. (Also in the ADR.)
- The AC1 grep `grep -nE "'(isb38|isi64|isa1|isa3|isa22|bsa78|bsa210)'" apps/worker/src` matches only the constant (lines 46-52 of `vci-iq-financials.ts`); the tests read codes from the constant, except `isa20`, `isa21`, the bank component codes and one `row.bsa210 = null` (unquoted property).

### Scope self-check
- Could the diff be smaller? No; source is about 40 lines, the rest is tests, fixtures and ADR text.
- Diff size: about +60 source, +260 tests, 16 fixture files added, 1 deleted, ADR +45 lines.
