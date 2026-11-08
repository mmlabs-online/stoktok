# STK-061: Full financial statements and ratios for the AI layer

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | data, db, finance |
| Attempts | 0 |
| Created | 2026-11-08 |
| PR | — |

## Goal
Extend the quarterly financials from STK-014 (eps, bvps, revenue, net_income) to the main lines of the income statement, balance sheet and cash-flow statement, plus key ratios. The AI summaries (STK-064) and the chat agent (STK-066) need this data to "read the financial reports" for Ming. The data is structured and comes from a data API, not from PDFs.

## Spec reference
docs/spec-v1.md §3 F4 (quarterly financials), §4 `FinancialsSource`, §5 `financials`; open question 4 (data sources). CLAUDE.md R2, R4, R5.

## Acceptance criteria
- [ ] For each symbol in the watchlist and holdings, the worker stores quarterly and annual statement lines. Income statement: revenue, gross profit, operating profit, profit before tax, net income attributable to the parent. Balance sheet: total assets, total liabilities, equity, cash, short- and long-term debt. Cash flow: operating cash flow, capex, free cash flow. Each record has `source` and `fetched_at` (R4).
- [ ] Stored ratios include P/E, P/B, ROE, ROA, gross margin, net margin, debt/equity and YoY growth for revenue and net income. Each ratio is either taken from the source with provenance, or derived in `packages/core` with tests (R1). Money is integer VND (R2) and ratios are integer basis points.
- [ ] Use the existing VCI/TCBS adapter pattern (`FinancialsSource`), with a recorded fixture and a terms check noted in the plan. Do not parse PDFs.
- [ ] The sync is idempotent (upsert on symbol + period + statement line). A missing period or line is recorded as a gap, never written as zero (R4).
- [ ] The migration has RLS on and service_role-only grants, matching existing tables, and comes with a rollback file.
- [ ] `typecheck`, `lint` and `test` are green, with unit tests for the mappers and the derived ratios.

## Notes / answers from Ming
- 2026-11-08: Read financial reports via structured API data first. PDF reading is a later ticket.
