# SYNTHETIC — hand-written from a recalled shape, not recorded

These files were written by hand for STK-014. The development sandbox cannot reach Vietnamese hosts, so nothing here is a real TCBS response. Tickers (`TSTA`, `TSTB`) and figures are made up. Real captures replace them later (follow-up in the STK-014 plan).

## Assumed shapes (UNVERIFIED, see docs/adr/0002-financials-source.md)
- `GET https://apipubaws.tcbs.com.vn/tcanalysis/v1/finance/{SYMBOL}/financialratio?yearly=0&isAll=true` returns a top-level array of `{ ticker, year, quarter, earningPerShare, bookValuePerShare }`. Per-share values are VND.
- `GET .../finance/{SYMBOL}/incomestatement?yearly=0&isAll=true` returns a top-level array of `{ ticker, year, quarter, revenue, shareHolderIncome, postTaxProfit }`. Totals are billions of VND.
- `GET .../ticker/{SYMBOL}/overview` returns an object with a text field `industry`.

## Manual check (from a machine that can reach the host)
```
curl -H 'User-Agent: stoktok/0.1 (manual check)' 'https://apipubaws.tcbs.com.vn/tcanalysis/v1/finance/VNM/financialratio?yearly=0&isAll=true'
curl -H 'User-Agent: stoktok/0.1 (manual check)' 'https://apipubaws.tcbs.com.vn/tcanalysis/v1/finance/VNM/incomestatement?yearly=0&isAll=true'
curl -H 'User-Agent: stoktok/0.1 (manual check)' 'https://apipubaws.tcbs.com.vn/tcanalysis/v1/ticker/VNM/overview'
```

## Files
- `ratio-ok.json`, `income-ok.json`: 6 quarters, unsorted, decimal billions, one negative-income quarter (2025Q3).
- `ratio-malformed.json`, `income-malformed.json`: null eps, quarter 5, a string number, a duplicate period, another ticker.
- `ratio-wrong-unit.json`: per-share values in thousand VND.
- `income-wrong-unit.json`: totals in raw VND.
- `empty.json`: `[]`.
- `overview-ok.json`, `overview-no-industry.json`: sector label present and absent.
