#!/usr/bin/env bash
# STK-018 (R3): keep docs/deploy.md env table, deploy/compose.stoktok.yml and .env.example in sync.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_EXAMPLE="$ROOT/.env.example"
DOC="$ROOT/docs/deploy.md"
COMPOSE="$ROOT/deploy/compose.stoktok.yml"
DEPLOY_ONLY="STOKTOK_TAG STOKTOK_TUNNEL_NETWORK"
fail=0

example_keys="$(grep -E '^[A-Z][A-Z0-9_]*=' "$ENV_EXAMPLE" | cut -d= -f1 | sort -u)"
doc_keys="$(sed -n '/<!-- env-list:start -->/,/<!-- env-list:end -->/p' "$DOC" \
  | grep -E '^\| `[A-Z][A-Z0-9_]*`' | sed -E 's/^\| `([A-Z0-9_]+)`.*/\1/' | sort -u)"

if ! diff <(echo "$example_keys") <(echo "$doc_keys"); then
  echo "FAIL: docs/deploy.md env table differs from .env.example (< .env.example, > doc)" >&2
  fail=1
fi

allowed="$(printf '%s\n' "$example_keys" $DEPLOY_ONLY | sort -u)"
used="$(grep -oE '\$\{[A-Z][A-Z0-9_]*' "$COMPOSE" | sed 's/^\${//' | sort -u)"
extra="$(comm -13 <(echo "$allowed") <(echo "$used"))"
if [ -n "$extra" ]; then
  echo "FAIL: compose uses undeclared variables: $extra" >&2
  fail=1
fi

if grep -E '^\s*[A-Za-z_]*(KEY|SECRET|TOKEN)[A-Za-z_]*:\s*[^$[:space:]#]' "$COMPOSE"; then
  echo "FAIL: literal secret-like value in compose" >&2
  fail=1
fi
if grep -q 'NEXT_PUBLIC_' "$COMPOSE"; then
  echo "FAIL: NEXT_PUBLIC_ in compose" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "OK: deploy env lists consistent"
