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
  | cut -d= -f1 | grep -Ei 'KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL'; then
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
  echo "== smoke: worker resolves pg and kysely at runtime"
  if ! docker run --rm -w /app/dist --entrypoint node "$IMAGE" -e "Promise.all([import('pg'),import('kysely')]).then(()=>process.exit(0),()=>process.exit(1))"; then
    echo "::error::worker smoke failed: pg or kysely does not resolve in the image"; exit 1
  fi
  echo "== smoke: worker with an unreachable database exits 1 without hanging or leaking"
  NAME="stoktok-smoke-$$"
  trap 'docker rm -f "$NAME" "$NAME-mig" >/dev/null 2>&1' EXIT
  err="$(mktemp)"
  timeout 20 docker run --rm --name "$NAME" \
    -e STOKTOK_DATABASE_URL=postgres://smoke:smoke-pw@127.0.0.1:9/smoke \
    "$IMAGE" signals > "$err" 2>&1
  code=$?
  cat "$err"
  leaked="$(grep -cE 'smoke-pw|127\.0\.0\.1' "$err" || true)"
  rm -f "$err"
  if [ "$code" -eq 124 ]; then echo "::error::worker hung with an unreachable database"; exit 1; fi
  if [ "$code" -ne 1 ]; then echo "::error::expected exit 1 with an unreachable database, got $code"; exit 1; fi
  if [ "$leaked" -ne 0 ]; then echo "::error::worker output leaked the database host or password"; exit 1; fi

  echo "== smoke: worker migrate without a URL exits 2"
  err="$(mktemp)"
  docker run --rm "$IMAGE" migrate 2> "$err"
  code=$?
  cat "$err"
  size="$(wc -c < "$err")"
  rm -f "$err"
  if [ "$code" -ne 2 ] || [ "$size" -eq 0 ]; then
    echo "::error::expected migrate exit 2 with a message, got $code"; exit 1
  fi

  echo "== smoke: worker migrate with an unreachable database exits 1 without hanging or leaking"
  # exit 1 (not 2) also proves /app/migrations resolved: the runner reads the directory before connecting.
  err="$(mktemp)"
  timeout 20 docker run --rm --name "$NAME-mig" \
    -e STOKTOK_DATABASE_URL=postgres://smoke:smoke-pw@127.0.0.1:9/smoke \
    "$IMAGE" migrate > "$err" 2>&1
  code=$?
  cat "$err"
  leaked="$(grep -cE 'smoke-pw|127\.0\.0\.1' "$err" || true)"
  rm -f "$err"
  if [ "$code" -eq 124 ]; then echo "::error::worker migrate hung with an unreachable database"; exit 1; fi
  if [ "$code" -ne 1 ]; then echo "::error::expected migrate exit 1 with an unreachable database, got $code"; exit 1; fi
  if [ "$leaked" -ne 0 ]; then echo "::error::worker migrate output leaked the database host or password"; exit 1; fi

  echo "== image: /app/migrations ships only regular forward migrations"
  if ! docker run --rm --user 0 --entrypoint sh "$IMAGE" -c 'test -f /app/migrations/20261111000200_baseline.sql && [ -z "$(find /app/migrations -mindepth 1 ! -type f)" ] && [ -z "$(find /app/migrations -name "*.down.sql")" ]'; then
    echo "::error::/app/migrations is missing the baseline, holds a non-regular file, or ships a .down.sql"; exit 1
  fi
  echo "== image: /app/migrations is read-only for node"
  if ! docker run --rm --entrypoint sh "$IMAGE" -c '! test -w /app/migrations && ! test -w /app/migrations/20261111000200_baseline.sql'; then
    echo "::error::/app/migrations is writable by the runtime user"; exit 1
  fi
  exit 0
fi

echo "== smoke: web"
NAME="stoktok-smoke-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1' EXIT
docker run -d --name "$NAME" \
  -e STOKTOK_DATABASE_URL=postgres://smoke:smoke@127.0.0.1:9/smoke \
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
# The server loads the SDKs and pg through Turbopack's hashed aliases in .next/node_modules
# (the hash changes per build), from the server chunk directory. Probe exactly that.
if ! docker exec -w /app/apps/web/.next/server/chunks/ssr "$NAME" node -e "const fs=require('fs');const d='../../../node_modules';const ids=[['@anthropic-ai','sdk-'],['@google','genai-']].map(([s,p])=>{const n=fs.readdirSync(d+'/'+s).filter(x=>x.startsWith(p));if(n.length!==1)process.exit(2);return s+'/'+n[0]});const pgs=fs.readdirSync(d).filter(x=>/^pg-[0-9a-f]+\$/.test(x));if(pgs.length!==1)process.exit(3);ids.push(pgs[0]);Promise.all(ids.map(i=>import(i))).then(()=>process.exit(0),()=>process.exit(1))"; then
  echo "::error::web smoke failed: AI SDK or pg externals do not resolve in the image"; exit 1
fi
if docker logs "$NAME" 2>&1 | grep -E 'Cannot find module|MODULE_NOT_FOUND'; then
  echo "::error::web smoke failed: module not found"; exit 1
fi
