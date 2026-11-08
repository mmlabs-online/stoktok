#!/usr/bin/env bash
# STK-061 gate for the cash-flow slice: record the VietCap IQ cash-flow response for a few symbols.
# Human step: Ming runs this once from his own machine, then commits the output (see ADR 0007, "Open: cash flow").
#
# usage: scripts/probe-vci-iq-cashflow.sh [OUT_DIR] [SYMBOL...]
#   OUT_DIR  default work/tickets/STK-061/live-samples
#   SYMBOL   default HPG VCB VND BMI
#
# Posture (ADR 0005 decision 4): the same honest User-Agent as VCI_IQ_CONFIG.userAgent, Accept only. No cookies, no
# Origin, no Referer, no browser User-Agent, no credentials. One request per symbol, 1 s apart. A 403 stops the
# script at once and is never retried or worked around.
set -u

BASE='https://iq.vietcap.com.vn/api/iq-insight-service/v1/company'
UA='stoktok/0.1 (personal portfolio tracker; low-volume daily financials check)'

OUT="${1:-work/tickets/STK-061/live-samples}"
if [ "$#" -gt 0 ]; then shift; fi
if [ "$#" -gt 0 ]; then SYMBOLS="$*"; else SYMBOLS='HPG VCB VND BMI'; fi

mkdir -p "$OUT" || exit 1

first=1
for sym in $SYMBOLS; do
  case "$sym" in
    *[!A-Z0-9]*) echo "skip invalid symbol: $sym" >&2; continue ;;
  esac
  if [ "$first" -eq 0 ]; then sleep 1; fi
  first=0
  file="$OUT/${sym}_financial-statement_section_CASH_FLOW.json"
  status=$(curl -sS --compressed -A "$UA" -H 'Accept: application/json' -o "$file" -w '%{http_code}' \
    "$BASE/$sym/financial-statement?section=CASH_FLOW") || status='curl-error'
  echo "$sym $status $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT/probe.log"
  echo "$sym $status"
  if [ "$status" = '403' ]; then
    echo 'blocked (HTTP 403): stopping, no retry, no bypass (ADR 0005)' >&2
    exit 1
  fi
done

cat <<EOF
Done. Next:
  1. Commit the files in $OUT (they are the fixture source for the cash-flow slice).
  2. Answer for the cash-flow slice: are quarterly values YTD-cumulative or per quarter? Which codes are operating
     cash flow and capex (cfa18 and cfa19 are only recorded in the /metrics dictionary)? Do banks and brokers differ?
EOF
