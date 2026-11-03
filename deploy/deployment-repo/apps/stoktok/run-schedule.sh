#!/usr/bin/env bash
# STK-037: called by launchd (online.mmlabs.stoktok.jobs) at 18:30 and 21:00, Mon-Fri.
# Before 21:00: eod-prices, financials, signals. From 21:00: eod-prices (catch-up), signals.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${STOKTOK_LOG_DIR:-/Users/mingming/stoktok/logs}"
mkdir -p "$LOG_DIR"

if [ "$(date +%z)" != "+0700" ]; then
  echo "$(date -u +%FT%TZ) wrong time zone: $(date +%z), expected +0700" >>"$LOG_DIR/schedule.log"
  exit 1
fi

H="$(date +%H)"
if [ "$((10#$H))" -lt 21 ]; then
  jobs="eod-prices financials signals"
else
  jobs="eod-prices signals"
fi

worst=0
for job in $jobs; do
  bash "$DIR/run-job.sh" "$job"
  code=$?
  if [ "$code" -gt "$worst" ]; then worst="$code"; fi
done
exit "$worst"
