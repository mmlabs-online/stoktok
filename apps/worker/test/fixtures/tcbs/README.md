# TCBS fixtures

**SYNTHETIC — hand-written from the recalled shape, not recorded. Verify against a live response (curl command below) before trusting; replace with a recorded capture when possible.**

Shape assumed for `bars-long-term`: `{ ticker, data: [{ open, high, low, close, volume, tradingDate }] }`, prices in VND.

```
curl -sS -A 'stoktok/0.1 (manual check)' \
  'https://apipubaws.tcbs.com.vn/stock-insight/v1/stock/bars-long-term?ticker=VNM&type=stock&resolution=D&from=1760000000&to=1761200000'
```

Files: `bars-ok.json` (valid bars, both date encodings), `bars-empty.json`, `bars-malformed.json` (one good bar plus bad ones).
