#!/usr/bin/env bash
# STK-037: image checks shared by ci.yml and release.yml.
# usage: check-image.sh <web|worker> <image-ref>
set -uo pipefail

if [ "$#" -ne 2 ] || { [ "$1" != web ] && [ "$1" != worker ]; }; then
  echo "usage: check-image.sh <web|worker> <image-ref>" >&2
  exit 2
fi
APP="$1"
IMAGE="$2"

echo "== no secrets in image"
if docker image inspect "$IMAGE" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | cut -d= -f1 | grep -Ei 'KEY|SECRET|TOKEN|PASSWORD'; then
  echo "::error::secret-like env name in image"; exit 1
fi
found=$(docker run --rm --user 0 --entrypoint sh "$IMAGE" -c "find / -xdev -name '.env*' -not -path '/proc/*' 2>/dev/null; true")
if [ -n "$found" ]; then echo "::error::.env files in image: $found"; exit 1; fi

if [ "$APP" = worker ]; then
  echo "== smoke: worker"
  err="$(mktemp)"
  docker run --rm "$IMAGE" 2> "$err"
  code=$?
  cat "$err"
  size="$(wc -c < "$err")"
  rm -f "$err"
  if [ "$code" -ne 2 ] || [ "$size" -eq 0 ]; then
    echo "::error::expected exit 2 with usage, got $code"; exit 1
  fi
  exit 0
fi

echo "== smoke: web"
NAME="stoktok-smoke-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1' EXIT
docker run -d --name "$NAME" \
  -e SUPABASE_URL=http://127.0.0.1:9 -e SUPABASE_SERVICE_ROLE_KEY=dummy \
  "$IMAGE" >/dev/null

probe() {
  docker exec "$NAME" node -e "fetch('http://127.0.0.1:3000$1').then(r=>process.exit($2)).catch(()=>process.exit(1))"
}

ok=0
for _ in $(seq 1 30); do
  if probe /healthz 'r.status===200?0:1' 2>/dev/null; then ok=1; break; fi
  sleep 1
done
docker logs "$NAME"
if [ "$ok" -ne 1 ]; then echo "::error::web smoke failed: /healthz did not return 200"; exit 1; fi
if ! probe / '0'; then echo "::error::web smoke failed: / did not answer"; exit 1; fi
if ! docker exec -w /app/apps/web "$NAME" node -e "Promise.all([import('@anthropic-ai/sdk'),import('@google/genai')]).then(()=>process.exit(0),()=>process.exit(1))"; then
  echo "::error::web smoke failed: AI SDKs do not resolve from /app/apps/web"; exit 1
fi
if docker logs "$NAME" 2>&1 | grep -E 'Cannot find module|MODULE_NOT_FOUND'; then
  echo "::error::web smoke failed: module not found"; exit 1
fi
