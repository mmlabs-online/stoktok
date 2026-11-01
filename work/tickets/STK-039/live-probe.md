# STK-039: live probe of VietCap IQ (orchestrator, 2026-11-01)

The orchestrator made one GET per endpoint from Ming's WSL machine. Each request sent only the honest stoktok User-Agent and `Accept: application/json`, with no Origin, Referer, cookies or browser UA. All four returned **HTTP 200, application/json, gzip-encoded**. The raw responses (symbol HPG, gunzipped) are in `live-samples/`. This is public market data with no credentials.

Base: `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company`

| Endpoint | Result |
|---|---|
| `HPG/statistics-financial` | 40 quarterly rows (2018 Q1 → 2026 Q3). `ratioType: 'RATIO_TTM'`. The rows have **no `earningPerShare` or `bookValuePerShare` fields**; vnstock's map is stale. They do have `pe`, `pb`, `roe`, `marketCap`, `numberOfSharesMktCap` (current share count, the same 8,442,964,520 on every recent row) and `ownersEquity`, which is a **ratio** (e.g. 0.18), not an amount. `ticker` is null on rows. |
| `HPG/financial-statement?section=INCOME_STATEMENT` | `data.quarters` (35 rows) and `data.years`. Period = `yearReport` + `lengthReport` (1–4 = quarter, 5 = full year). Amounts are in **full VND** (e.g. 2026 Q3 net sales `isa3` = 62,214,187,236,976). Codes from `/metrics`: `isa1` Sales, `isa3` **Net sales**, `isa20` Net profit after tax, `isa22` **Attributable to parent company**, `isa23` EPS basic (VND). `isa23` is **0 in Q1 and Q3** and non-zero in Q2/Q4 (semi-annual reporting), so it can't be used as quarterly EPS. Bank/insurer line items use other prefixes (`isb*`, `isi*`). |
| `HPG/financial-statement/metrics` | Field dictionary per section: `BALANCE_SHEET`, `INCOME_STATEMENT`, `CASH_FLOW`, `NOTE`, each item `{field, titleEn, titleVi, parent}`. |
| `details?ticker=HPG` | `sector: 'Basic Resources'` and `sectorVn: 'Tài nguyên Cơ bản'` (ICB level-2 style), `icbCodeLv2`, `icbCodeLv4`, `isBank`, `issueShare`, `numberOfSharesMktCap`. |

## Implications for the plan
- **EPS and BVPS must be derived; the source doesn't provide them per quarter.** Candidates: EPS = `isa22` (parent net income, quarter) ÷ shares; BVPS = parent equity from `section=BALANCE_SHEET` ÷ shares. The share count needs a decision: current `numberOfSharesMktCap`/`issueShare` vs. a period count. Per R1/R2 this derivation belongs in `packages/core` with tests, and it's a finance decision (see consult-finance-investment-researcher.md).
- The TTM `pe`/`pb` exist but are vendor-computed. Using them would break R9-style traceability and the existing core valuation path. They are not recommended as signal inputs.
- Units are full VND, not billion VND as in TCBS. The core unit guards must be configured for this source.
- The balance-sheet section was not probed. Its equity field code must come from `/metrics` → `BALANCE_SHEET` (already in `live-samples/HPG_financial-statement_metrics.json`).

## Balance-sheet pre-step (planner request), 2026-11-01
`HPG/financial-statement?section=BALANCE_SHEET` failed twice with `curl: (56) Failure when receiving data from the peer` (connection reset, no HTTP status), right after the four successful calls above. No more retries were made. Still open: record that response and confirm that `bsa78` (owner's equity) and `bsa210` (minority interests) exist, in full VND.
