# STK-061: Income statement and balance sheet lines for the AI layer

| Field | Value |
|---|---|
| State | IN_PROGRESS |
| Priority | P2 |
| Areas | data, db, finance |
| Attempts | 0 |
| Created | 2026-11-08 |
| PR | — |

## Goal
Extend the quarterly financials from STK-014 (eps, bvps, revenue, net_income) to the main lines of the income statement and balance sheet, quarterly and annual (ratios: STK-067; cash flow: STK-068). The AI summaries (STK-064) and the chat agent (STK-066) need this data to "read the financial reports" for Ming. The data is structured and comes from a data API, not from PDFs.

## Spec reference
docs/spec-v1.md §3 F4 (quarterly financials), §4 `FinancialsSource`, §5 `financials`; open question 4 (data sources). CLAUDE.md R2, R4, R5.

## Acceptance criteria
- [ ] For each symbol in the watchlist and holdings, the worker stores quarterly and annual income statement lines (revenue, gross profit, operating profit, profit before tax, net income attributable to the parent) and balance sheet lines (total assets, total liabilities, equity, cash, short- and long-term borrowings). Each record has `source` and `fetched_at` (R4). Lines that do not apply to a company type (bank, broker, insurer) are recorded as not applicable, not as gaps.
- [ ] Uses the existing VCI IQ adapter pattern, with a recorded fixture and a terms note in an ADR. No PDF parsing. A probe script for the cash-flow section is added for Ming to run (it feeds STK-068).
- [ ] The sync is idempotent (upsert on symbol + period kind + period + line). A missing period or line is recorded as a gap, never written as zero (R4).
- [ ] The migration has RLS on and service_role-only grants, matching existing tables, and comes with a rollback file and db-check updates.
- [ ] `typecheck`, `lint` and `test` are green, with unit tests for the mappers and line guards.

## Notes / answers from Ming
- 2026-11-08: Read financial reports via structured API data first. PDF reading is a later ticket.
- 2026-11-08 (orchestrator): split per plan.md. Ratios moved to STK-067. Cash-flow lines moved to STK-068, which is gated on the cash-flow probe.
