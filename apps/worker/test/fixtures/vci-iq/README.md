# VietCap IQ fixtures (STK-039)

Trimmed copies of REAL responses recorded 2026-11-01 for symbol HPG (honest User-Agent and `Accept` only), from
`work/tickets/STK-039/live-samples/`. Rows are kept for 2023 onward and only the fields the adapter reads are kept
(plus identifying fields); values are unchanged.

Recorded (trimmed):
- `statistics-ok.json`: `GET {base}/HPG/statistics-financial` (quarters 2023Q1-2026Q3 plus year rows with `quarter: 5`).
- `income-ok.json`: `GET {base}/HPG/financial-statement?section=INCOME_STATEMENT` (`data.quarters` and `data.years`).
- `balance-ok.json`: `GET {base}/HPG/financial-statement?section=BALANCE_SHEET`.
- `details-ok.json`: `GET {base}/details?ticker=HPG`.

Derived by hand (the tests edit copies of the recordings in memory): duplicate period, ticker mismatch, wrong unit,
missing shares, missing `bsa210`, empty, too many periods.
- `details-bank.json` is hand-written (not recorded): a non-`CT` company type (`NH`) with a made-up ticker.

`{base}` is `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company`.
