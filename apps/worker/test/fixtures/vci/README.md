# VCI fixtures

**SYNTHETIC — hand-written from the shape read in vnstock's source, not recorded. Verify against a live response (curl command below) before trusting; replace with a recorded capture after the first dry-run (ADR 0004).**

Shape assumed for `gap-chart`: `[{ symbol, t: [epoch s], o: [], h: [], l: [], c: [], v: [] }]` (columnar), prices in VND, values as numbers or digit strings.

```
curl -sS -A 'stoktok/0.1 (manual check)' \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"timeFrame":"ONE_DAY","symbols":["VNM"],"to":1792688400,"countBack":10}' \
  'https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart'
```

Only these three headers are allowed; no Origin/Referer/browser headers.

Files: `chart-ok.json` (valid, both `t` encodings), `chart-wrapped.json` (`{data:[...]}` root), `chart-thousand-vnd.json` (wrong unit), `chart-malformed.json` (one good bar plus bad ones), `chart-unequal-arrays.json`, `chart-empty.json`, `chart-other-symbol.json`, `chart-too-many-bars.json`.
