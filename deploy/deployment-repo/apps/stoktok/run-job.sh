#!/usr/bin/env bash
# STK-037: run one stoktok worker job on the Mac (macOS bash 3.2 safe).
# usage: run-job.sh <eod-prices|financials|signals> [--dry-run]
# Env: STOKTOK_DIR (published copy of compose.yml + release.env), STOKTOK_LOG_DIR.
set -uo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: run-job.sh <job> [flags]" >&2
  exit 2
fi

JOB="$1"
DIR="${STOKTOK_DIR:-/Users/gh-runner/stoktok/current}"
LOG_DIR="${STOKTOK_LOG_DIR:-/Users/gh-runner/stoktok/logs}"
LOCK=/tmp/stoktok-jobs.lock # macOS clears /tmp at boot
LOG="$LOG_DIR/$JOB.log"
now() { date -u +%FT%TZ; }

mkdir -p "$LOG_DIR"

# One shared lock serializes all stoktok jobs (they all write data_gaps). mkdir is atomic.
waited=0
until mkdir "$LOCK" 2>/dev/null; do
  pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    rm -rf "$LOCK" # stale: the holder is gone
    continue
  fi
  if [ "$waited" -ge 1800 ]; then
    echo "$(now) $JOB lock wait timed out" >>"$LOG"
    exit 1
  fi
  sleep 5
  waited=$((waited + 5))
done
echo "$$" >"$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

VERSION="$(sed -n 's/^STOKTOK_VERSION=//p' "$DIR/release.env" 2>/dev/null)"
echo "$(now) start job=$JOB version=${VERSION:-unset}" >>"$LOG"
docker compose -p stoktok -f "$DIR/compose.yml" --env-file "$DIR/release.env" \
  --profile jobs run --rm stoktok-worker "$@" >>"$LOG" 2>&1
code=$?
echo "$(now) end job=$JOB exit=$code version=${VERSION:-unset}" >>"$LOG"
exit "$code"
