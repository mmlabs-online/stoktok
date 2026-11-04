#!/usr/bin/env bash
# STK-042: record VietCap IQ samples (honest headers only; ADR 0005). Run from the repo root.
set -u
BASE='https://iq.vietcap.com.vn/api/iq-insight-service/v1/company'
UA='stoktok/0.1 (personal portfolio tracker; low-volume daily financials check)'
OUT=work/tickets/STK-042/live-samples
mkdir -p "$OUT"
get() { # $1=url $2=file
  for try in 1 2; do
    code=$(curl -sS -o "$OUT/$2.tmp" -w '%{http_code}' -H "User-Agent: $UA" -H 'Accept: application/json' "$1")
    if [ "$code" = 200 ]; then
      if gzip -t "$OUT/$2.tmp" 2>/dev/null; then gunzip -c "$OUT/$2.tmp" > "$OUT/$2"; else mv "$OUT/$2.tmp" "$OUT/$2"; fi
      rm -f "$OUT/$2.tmp"; echo "200 $2"; sleep 3; return 0
    fi
    rm -f "$OUT/$2.tmp"; echo "HTTP $code $2 (try $try)"
    [ "$code" = 403 ] && { echo 'Blocked (403): stopping, no bypass.'; exit 1; }
    sleep 10
  done
  sleep 3
}
for S in VCB TCB VND BMI; do
  get "$BASE/$S/financial-statement/metrics"                       "${S}_financial-statement_metrics.json"
  get "$BASE/$S/financial-statement?section=INCOME_STATEMENT"       "${S}_financial-statement_section_INCOME_STATEMENT.json"
  get "$BASE/$S/financial-statement?section=BALANCE_SHEET"          "${S}_financial-statement_section_BALANCE_SHEET.json"
  get "$BASE/$S/statistics-financial"                               "${S}_statistics-financial.json"
  get "$BASE/details?ticker=$S"                                     "details_ticker_${S}.json"
done
printf 'Recorded %s by Ming (WSL), honest UA + Accept only. Script: STK-042 plan.md Q1.\n' "$(date -u +%FT%TZ)" > "$OUT/README.md"
grep -ho '"comTypeCode":"[A-Z]*"' "$OUT"/details_ticker_*.json
