#!/usr/bin/env bash
# STK-049: record VietCap intraday (ONE_MINUTE gap-chart) samples. Honest headers only (ADR 0006).
# Run from the repo root on the home server DURING a trading session (Mon-Fri 09:00-11:30 or 13:00-15:00 VN).
set -u
FAILED=0
BASE='https://trading.vietcap.com.vn/api'
UA='stoktok/0.1 (personal portfolio tracker; intraday refresh while app open, max one batched request per 30 s)'
OUT=work/tickets/STK-049/live-samples
SYMBOLS='["VNM","FPT","HPG"]'
mkdir -p "$OUT"
post() { # $1=path $2=json body $3=file
  code=$(curl -sS --connect-timeout 10 --max-time 15 -o "$OUT/$3.tmp" -w '%{http_code}' -X POST \
    -H "User-Agent: $UA" -H 'Accept: application/json' -H 'Content-Type: application/json' \
    -d "$2" "$BASE$1")
  if [ "$code" = 200 ]; then
    if gzip -t "$OUT/$3.tmp" 2>/dev/null; then gunzip -c "$OUT/$3.tmp" > "$OUT/$3"; else mv "$OUT/$3.tmp" "$OUT/$3"; fi
    rm -f "$OUT/$3.tmp"; echo "200 $3"; return 0
  fi
  rm -f "$OUT/$3.tmp"; echo "HTTP $code $3"
  [ "$code" = 403 ] && { echo 'Blocked (403): stopping, no bypass.'; exit 1; }
  return 1
}
chart_body() { printf '{"timeFrame":"ONE_MINUTE","symbols":%s,"to":%s,"countBack":360}' "$SYMBOLS" "$(( $(date +%s) + 60 ))"; }

printf '{"symbols":["VNM","FPT","HPG"]}\n' > "$OUT/request.json"
printf 'recorded_at_utc: %s\nhost: %s\nHonest UA + Accept + Content-Type only. Script: STK-049 plan.md section 6.\n' "$(date -u +%FT%TZ)" "$(hostname)" > "$OUT/README.md"
post /chart/OHLCChart/gap-chart "$(chart_body)" gapchart-1.json || FAILED=1
sleep 30
post /chart/OHLCChart/gap-chart "$(chart_body)" gapchart-2.json || FAILED=1
# Info only: board snapshot. Its result does not change the adapter in slice 1.
sleep 3
post /price/symbols/getList '{"symbols":["VNM","FPT","HPG"]}' board-1.json || true
[ "$FAILED" = 0 ] || { echo 'One or more gap-chart calls failed.'; exit 1; }
echo 'Done. Then: pnpm --filter @stoktok/sources test'
