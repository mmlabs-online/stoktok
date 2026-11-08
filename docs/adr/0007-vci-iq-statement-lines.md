# ADR 0007: VietCap IQ statement lines (income statement and balance sheet)

Status: accepted for slice A of STK-061 (planner and implementer, 2026-11-08). Cash flow is open (see the last section). Builds on ADR 0005.

## Context
The AI layer (STK-064 to STK-066) needs more than revenue and parent net income per quarter. STK-061 slice A stores 12 income and balance-sheet lines per period, quarterly and annual, in a new long table `financial_lines` (migration `20261108000100_financial_lines.sql`). `public.financials` and `runFinancialsSync` are unchanged.

## Endpoint use and terms
No new host and no credentials. The job reads the same `iq.vietcap.com.vn` endpoints as ADR 0005: `financial-statement?section=INCOME_STATEMENT`, `...BALANCE_SHEET` and `details?ticker=`. Terms posture is unchanged: ADR 0005 records "unofficial internal API, no terms found, no SLA" and decision 4, "terms risk accepted by Ming on 2026-11-01, personal low volume, honest headers only". This ADR does not claim a terms page was read.

Added volume: 3 GETs per symbol (income, balance, details) when the job runs alone, 0 extra when `fetchQuarterly` and `fetchStatements` share one `VciIqFinancialsSource` instance (the instance caches these responses by symbol and endpoint). The cash-flow probe script makes 4 one-off GETs.

## Lines and codes
The registry of lines is `STATEMENT_LINES` in `packages/core/src/market/statement-lines.ts`; the codes per company type are `VCI_IQ_STATEMENT_FIELDS_BY_COMPANY_TYPE` in `vci-iq-financials.ts`. `null` means the line does not apply to the type: no row and no gap. Every non-null code was checked against the recorded `/metrics` dictionaries and is numeric in the latest recorded period of the fixtures (a test asserts it).

| Line | CT | NH | CK | BH |
|---|---|---|---|---|
| revenue | isa3 | isb38 | isa1 | isi64 |
| gross_profit | isa5 | null | null | null |
| operating_profit | isa11 | null | null | null |
| profit_before_tax | isa16 | isa16 | null | isa16 |
| net_income_parent | isa22 | isa22 | isa22 | isa22 |
| total_assets | bsa53 | bsa53 | bsa53 | bsa53 |
| total_liabilities | bsa54 | bsa54 | bsa54 | bsa54 |
| equity_total | bsa78 | bsa78 | bsa78 | bsa78 |
| minority_interests | bsa210 | bsa210 | bsa210 | bsa210 |
| cash_and_equivalents | bsa2 | null | bsa2 | bsa2 |
| short_term_borrowings | bsa56 | null | null | null |
| long_term_borrowings | bsa71 | null | null | null |

Notes:
- `isa4` is "Cost of sales" (gross profit is `isa5`); `bsa64` is "Other payables" (short-term borrowings is `bsa56`); long-term borrowings is `bsa71`.
- VND (CK): the dictionary lists `isa16` twice (profit before tax and tax expense). It is ambiguous, so `profit_before_tax` is null for CK and no other code is guessed.
- Banks (NH): `bsa2` is "Cash and precious metals" and is not comparable, so cash is null.
- `operating_profit` is the VAS "Lãi/(lỗ) từ hoạt động kinh doanh", not EBIT.
- `short_term_borrowings` and `long_term_borrowings` are the "Vay" lines only and may exclude bonds and leases. Debt must be computed from borrowings, never from total liabilities.
- NH `revenue` is `isb38` "Tổng thu nhập hoạt động" (as in ADR 0005); it is not revenue in the corporate sense.
- Whether the statements are consolidated or parent-only is not verified from the fixtures (follow-up).

## Units, annual rows, not-applicable versus gap
- Amounts are full VND floats in the response. They are converted to integer VND only through `toVndAmount` (R2, half away from zero).
- Annual rows come from `data.years[]` (`lengthReport` 5) as published and are never summed from quarters. The label is `YYYY`; quarters are `YYYYQn` (fiscal label treated as calendar, as for `financials`).
- Guards: assets, liabilities, cash, borrowings and minority interests must not be negative; a value above `DEFAULT_STATEMENT_LINES_SANITY.maxAbsTotalVnd` is rejected (`<line>_out_of_band`). That bound is 9e15 VND, not the 1e15 of the quarterly financials: bank balance sheets (VCB total assets are above 2e15 VND) exceed 1e15, which the first fixture run showed. A zero on `revenue`, `total_assets` or `equity_total` is a source placeholder and is treated as missing (R4); a zero on other lines is stored.
- A mapped line missing in a period writes no row; the period is recorded in `data_gaps` with `data_type` `financial_lines` (quarters) or `financial_lines_annual` (years), separate from `financials` so signals are unaffected. A gap resolves when every mapped line of the period is stored. A not-applicable line is never a gap, so the AI layer must say "not available" for an absent line.
- Annual publish lag is 120 days (`annualPublishLagDays`), covering the 90-day audited-report deadline plus slack.
- Restated values overwrite stored ones (ADR 0002 policy) and are listed in the run summary.

## Open: cash flow (slice C)
`statement = 'cashflow'` is allowed by the schema so no migration is needed. The endpoint `financial-statement?section=CASH_FLOW` has not been probed. `scripts/probe-vci-iq-cashflow.sh` records it; Ming runs it once and commits the output to `work/tickets/STK-061/live-samples/`. Questions to answer from the samples: are quarterly values year-to-date cumulative (then de-cumulate in core) or per quarter, which codes are operating cash flow and capex (`cfa18`, `cfa19` appear in the recorded dictionary, values unverified), and do banks and brokers differ.
