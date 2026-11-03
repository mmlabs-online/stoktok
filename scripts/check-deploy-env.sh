#!/usr/bin/env bash
# STK-018/STK-037 (R3): keep docs/deploy.md env table, the draft deployment-repo compose, release.yml
# and .env.example in sync, and guard the draft compose against secrets and published ports.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_EXAMPLE="$ROOT/.env.example"
DOC="$ROOT/docs/deploy.md"
COMPOSE="$ROOT/deploy/deployment-repo/apps/stoktok/compose.yml"
RELEASE="$ROOT/.github/workflows/release.yml"
DEPLOY_ONLY="STOKTOK_WEB_IMAGE STOKTOK_WORKER_IMAGE STOKTOK_VERSION"
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

if grep -q '\${SUPABASE_' "$COMPOSE"; then
  echo "FAIL: compose interpolates SUPABASE_*; secrets come from env_file only" >&2
  fail=1
fi
if [ "$(grep -c '^\s*env_file:' "$COMPOSE")" -lt 2 ]; then
  echo "FAIL: compose needs env_file on both services" >&2
  fail=1
fi
if ! grep -q 'name: web' "$COMPOSE" || ! grep -q 'external: true' "$COMPOSE"; then
  echo "FAIL: compose must use the external network 'web'" >&2
  fail=1
fi
if grep -E '^\s*(ports:|container_name)|:latest' "$COMPOSE"; then
  echo "FAIL: compose has ports, container_name or :latest" >&2
  fail=1
fi

written="$(grep -oE 'STOKTOK_[A-Z_]+=' "$RELEASE" | tr -d = | sort -u)"
wanted="$(printf '%s\n' $DEPLOY_ONLY | sort -u)"
if ! diff <(echo "$written") <(echo "$wanted"); then
  echo "FAIL: keys written by release.yml differ from DEPLOY_ONLY (< release.yml, > DEPLOY_ONLY)" >&2
  fail=1
fi

for f in "$ROOT"/deploy/deployment-repo/apps/stoktok/*.sh "$ROOT"/scripts/*.sh; do
  if ! bash -n "$f"; then
    echo "FAIL: bash -n $f" >&2
    fail=1
  fi
done

# STK-043: the deploy workflow gets the secrets from the `stoktok` environment and never prints them.
WF="$ROOT/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml"
if ! grep -qE '^\s+environment: stoktok\s*$' "$WF"; then
  echo "FAIL: workflow lacks 'environment: stoktok'" >&2
  fail=1
fi
if ! grep -qF "if: github.ref == 'refs/heads/main'" "$WF"; then
  echo "FAIL: workflow lacks the main-only guard" >&2
  fail=1
fi
if grep -E '(^|[^.A-Za-z])secrets\.' "$WF" | grep -vE '^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}\s*$'; then
  echo "FAIL: 'secrets.' used outside a step env mapping" >&2
  fail=1
fi
if grep -nE 'set -[A-Za-z]*x|set -o xtrace' "$WF"; then
  echo "FAIL: set -x in workflow" >&2
  fail=1
fi
if grep -F '" config' "$WF" | grep -vF -- '--quiet'; then
  echo "FAIL: compose config without --quiet" >&2
  fail=1
fi
if grep -nF '<<' "$WF"; then
  echo "FAIL: heredoc in workflow" >&2
  fail=1
fi
wf_env_file="$(sed -n 's/^  ENV_FILE: //p' "$WF")"
compose_env_files="$(sed -n 's/^\s*env_file: //p' "$COMPOSE" | sort -u)"
if [ -z "$wf_env_file" ] || [ "$compose_env_files" != "$wf_env_file" ]; then
  echo "FAIL: ENV_FILE in workflow differs from env_file in compose" >&2
  fail=1
fi
if ! grep -qF "printf 'SUPABASE_URL=" "$WF" \
   || grep -rqF 'SUPABASE_SERVICE_ROLE_KEY=' "$ROOT/deploy/deployment-repo/apps/stoktok/"; then
  echo "FAIL: env-file writer must be in the workflow, not under apps/stoktok/" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "OK: deploy env lists consistent"
