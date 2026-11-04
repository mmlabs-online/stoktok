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
- Unsupported-type tests copy a recorded `details` in memory and change `comTypeCode`; no hand-written fixture is kept.

## STK-042 (banks, securities, insurers)
Trimmed copies of REAL responses recorded 2026-11-04 (honest User-Agent and `Accept` only), from
`work/tickets/STK-042/live-samples/`. Quarter and year rows from 2022 onward (so the 16-quarter window 2022Q4-2026Q3 and
its TTM look-back are present); only identifying fields, the mapped fields, `isa20`/`isa21` (parent NI identity) and, for
banks, the equity components `bsb118 bsb121 bsa84 bsa85 bsa90` are kept; values are unchanged. Statistics rows keep `pe`,
`pb`, `marketCap`, `numberOfSharesMktCap`; details keep `ticker`, `comTypeCode`, `isBank`, `sector`, `sectorVn`.
- `vcb-*` (VCB, `NH`), `tcb-*` (TCB, `NH`), `vnd-*` (VND, `CK`), `bmi-*` (BMI, `BH`), each with `-statistics`, `-income`, `-balance`, `-details`.

`{base}` is `https://iq.vietcap.com.vn/api/iq-insight-service/v1/company`.
