#!/usr/bin/env bash
# STK-006 (R3): build web with sentinel service, AI and database credentials and prove they, the AI SDKs and their hosts are absent from client bundles.
# usage: check-no-service-key-in-client.sh [--scan-only <dir>]   (--scan-only skips the build and scans <dir> with the fixed needles)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATIC="$ROOT/apps/web/.next/static"
NEEDLES=(SUPABASE_SERVICE_ROLE_KEY service_role ANTHROPIC_API_KEY GOOGLE_AI_API_KEY @anthropic-ai/sdk @google/genai api.anthropic.com generativelanguage.googleapis.com STOKTOK_DATABASE_URL postgres:// postgresql:// pg-protocol)

if [ "${1:-}" = "--scan-only" ]; then
  [ -n "${2:-}" ] || { echo "usage: check-no-service-key-in-client.sh --scan-only <dir>" >&2; exit 2; }
  STATIC="$2"
else
  SENTINEL="sb-service-SENTINEL-$RANDOM$RANDOM"
  AI_A="sk-ant-SENTINEL-$RANDOM$RANDOM"
  AI_G="goog-SENTINEL-$RANDOM$RANDOM"
  DB_PW="pw-SENTINEL-$RANDOM$RANDOM"
  DB_URL="postgres://stoktok_app:$DB_PW@db.invalid:5432/stoktok"
  SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY="$SENTINEL" ANTHROPIC_API_KEY="$AI_A" GOOGLE_AI_API_KEY="$AI_G" STOKTOK_DATABASE_URL="$DB_URL" pnpm --filter @stoktok/web build
  NEEDLES=("$SENTINEL" "$AI_A" "$AI_G" "$DB_PW" "${NEEDLES[@]}")
fi

if [ ! -d "$STATIC" ]; then
  echo "FAIL: $STATIC missing" >&2
  exit 1
fi

fail=0
for needle in "${NEEDLES[@]}"; do
  hits="$( { grep -rlF -- "$needle" "$STATIC" || true; } | wc -l)"
  echo "hits for '$needle' in .next/static: $hits"
  if [ "$hits" -ne 0 ]; then fail=1; fi
done
if [ "$fail" -ne 0 ]; then
  echo "FAIL: secret or AI SDK material found in client bundle" >&2
  exit 1
fi
echo "OK: no secret or AI SDK material in client bundle"
