#!/usr/bin/env bash
# STK-018: cron wrapper for one-shot worker jobs.
# usage: run-job.sh <eod-prices|financials|signals> [--dry-run]
# Env: STOKTOK_COMPOSE_FILE, STOKTOK_LOG_DIR, STOKTOK_LOCK (defaults below).
set -uo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: run-job.sh <job> [flags]" >&2
  exit 2
fi

JOB="$1"
COMPOSE_FILE="${STOKTOK_COMPOSE_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose.stoktok.yml}"
LOG_DIR="${STOKTOK_LOG_DIR:-$HOME/stoktok-logs}"
LOCK="${STOKTOK_LOCK:-/tmp/stoktok-jobs.lock}"
LOG="$LOG_DIR/$JOB.log"

mkdir -p "$LOG_DIR"

# One shared lock serializes all stoktok jobs (they all write data_gaps).
exec 9>"$LOCK"
if ! flock -w 1800 9; then
  echo "$(date -Is) $JOB lock wait timed out" >>"$LOG"
  exit 1
fi

echo "$(date -Is) start job=$JOB tag=${STOKTOK_TAG:-unset}" >>"$LOG"
docker compose -f "$COMPOSE_FILE" --profile jobs run --rm stoktok-worker "$@" >>"$LOG" 2>&1
code=$?
echo "$(date -Is) end job=$JOB exit=$code" >>"$LOG"
exit "$code"
