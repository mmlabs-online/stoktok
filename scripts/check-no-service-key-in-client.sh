#!/usr/bin/env bash
# STK-006 (R3): build web with a sentinel service key and prove it is absent from client bundles.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SENTINEL="sb-service-SENTINEL-$RANDOM$RANDOM"
STATIC="$ROOT/apps/web/.next/static"

SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY="$SENTINEL" pnpm --filter @stoktok/web build

if [ ! -d "$STATIC" ]; then
  echo "FAIL: $STATIC missing" >&2
  exit 1
fi

fail=0
for needle in "$SENTINEL" SUPABASE_SERVICE_ROLE_KEY service_role; do
  hits="$( { grep -rlF -- "$needle" "$STATIC" || true; } | wc -l)"
  echo "hits for '$needle' in .next/static: $hits"
  if [ "$hits" -ne 0 ]; then fail=1; fi
done
if [ "$fail" -ne 0 ]; then
  echo "FAIL: service key material found in client bundle" >&2
  exit 1
fi
echo "OK: no service key material in client bundle"
