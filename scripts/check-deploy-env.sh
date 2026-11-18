#!/usr/bin/env bash
# STK-094: cutover state (migrate + /readyz). STK-018/STK-037 (R3): keep docs/deploy.md env table, the draft deployment-repo compose, release.yml
# and .env.example in sync, STK-044: one runner user and agreeing paths across drafts, and guard the draft compose against secrets and published ports.
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

allowed="$(printf '%s\n' $DEPLOY_ONLY | sort -u)"
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
if [ "$(grep -c '^\s*env_file:' "$COMPOSE")" -lt 3 ]; then
  echo "FAIL: compose needs env_file on web, worker and migrate" >&2
  fail=1
fi
if ! grep -q 'name: web' "$COMPOSE" || ! grep -q 'external: true' "$COMPOSE"; then
  echo "FAIL: compose must use the external network 'web'" >&2
  fail=1
fi
# STK-084: the shared Postgres network `db` is external; web is on tunnel + db, the worker on default + db (db is internal: no egress).
if ! grep -qE '^  db:' "$COMPOSE" || ! grep -qE '^    name: db\s*$' "$COMPOSE"; then
  echo "FAIL: compose must declare the external network 'db'" >&2
  fail=1
fi
# A service block: from `  NAME:` up to, not including, the next service key or top-level key.
svc_block() {
  awk -v n="$1" '
    $0 == "  " n ":" { p = 1; print; next }
    p && (/^  [A-Za-z0-9_-]+:/ || /^[^[:space:]#]/) { exit }
    p { print }' "$COMPOSE"
}
web_block="$(svc_block stoktok-web)"
worker_block="$(svc_block stoktok-worker)"
migrate_block="$(svc_block migrate)"
for pair in "web:$web_block" "worker:$worker_block" "migrate:$migrate_block"; do
  if ! echo "${pair#*:}" | grep -qE '^[[:space:]]+env_file:'; then
    echo "FAIL: compose service ${pair%%:*} lacks env_file" >&2
    fail=1
  fi
done
nets_re() { echo "^[[:space:]]+networks: \\[(.*, *)?$1(, *.*)?\\][[:space:]]*\$"; }
for n in tunnel db; do
  if ! echo "$web_block" | grep -qE "$(nets_re $n)"; then
    echo "FAIL: stoktok-web networks must contain $n" >&2
    fail=1
  fi
done
for n in default db; do
  if ! echo "$worker_block" | grep -qE "$(nets_re $n)"; then
    echo "FAIL: stoktok-worker networks must contain $n" >&2
    fail=1
  fi
done
# STK-094: web health check is /readyz with a client timeout; migrate is a one-shot on `db` only.
if ! echo "$web_block" | grep -qF "fetch('http://127.0.0.1:3000/readyz',{signal:AbortSignal.timeout(3000)})" \
   || echo "$web_block" | grep -q '/healthz'; then
  echo "FAIL: stoktok-web health check must be fetch('http://127.0.0.1:3000/readyz',{signal:AbortSignal.timeout(3000)}) and not /healthz" >&2
  fail=1
fi
if echo "$web_block" | grep -qE '^[[:space:]]+profiles:'; then
  echo "FAIL: stoktok-web must have no profiles" >&2
  fail=1
fi
if [ -z "$migrate_block" ]; then
  echo "FAIL: compose lacks the migrate service" >&2
  fail=1
else
  migrate_lines="$(echo "$migrate_block" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  if ! echo "$migrate_lines" | grep -qE '^image: \$\{STOKTOK_WORKER_IMAGE:\?[^}]*\}$'; then
    echo "FAIL: migrate image must be \${STOKTOK_WORKER_IMAGE:?...}" >&2
    fail=1
  fi
  for want in 'restart: "no"' 'profiles: [migrate]' 'command: ["migrate"]' 'networks: [db]' \
              'cap_drop: [ALL]' 'security_opt: ["no-new-privileges:true"]'; do
    if ! echo "$migrate_lines" | grep -qxF -- "$want"; then
      echo "FAIL: migrate service lacks the line: $want" >&2
      fail=1
    fi
  done
  # Allow-list over every line: blank, comment, an allowed indent-4 key, or a indent-6 list item. Quoted keys, flow maps, re-indents fail.
  bad_lines="$(echo "$migrate_block" | sed -n '2,$p' | grep -vE '^[[:space:]]*(#.*)?$' \
    | grep -vE '^    (image|restart|profiles|env_file|cap_drop|security_opt|command|networks):( |$)' \
    | grep -vE '^      - ' || true)"
  if [ -n "$bad_lines" ]; then
    echo "FAIL: migrate has lines outside the allow-list (keys: image restart profiles env_file cap_drop security_opt command networks): $bad_lines" >&2
    fail=1
  fi
fi
if grep -vE '^[[:space:]]*#' "$COMPOSE" | grep -E '<<[[:space:]]*:|(^|[[:space:]:,{[-])[&*][A-Za-z_]'; then
  echo "FAIL: compose uses a YAML merge key, anchor or alias" >&2
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

for f in "$ROOT"/deploy/deployment-repo/apps/stoktok/*.sh "$ROOT"/deploy/deployment-repo/ops/*.sh "$ROOT"/scripts/*.sh; do
  if ! bash -n "$f"; then
    echo "FAIL: bash -n $f" >&2
    fail=1
  fi
done

# STK-043: the deploy workflow gets the secrets from the `stoktok` environment and never prints them.
WF="$ROOT/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml"
DRAFTS="$ROOT/deploy/deployment-repo"
# The workflow-only guards (secrets step, deny lists, triggers, migrate detection) live in one portable script that is
# also copied to the deployment repo (STK-097); everything below needs another file.
if ! bash "$DRAFTS/ops/check-stoktok-workflow.sh" "$WF"; then
  echo "FAIL: ops/check-stoktok-workflow.sh" >&2
  fail=1
fi
wf_env_file="$(sed -n 's/^  ENV_FILE: //p' "$WF")"
compose_env_files="$(sed -n 's/^\s*env_file: //p' "$COMPOSE" | sort -u)"
if [ -z "$wf_env_file" ] || [ "$compose_env_files" != "$wf_env_file" ]; then
  echo "FAIL: ENV_FILE in workflow differs from env_file in compose" >&2
  fail=1
fi
if grep -rqF -e 'SUPABASE_SERVICE_ROLE_KEY=' -e 'STOKTOK_DATABASE_URL=' -e 'STOKTOK_AI_KEYS_MASTER_KEY=' "$ROOT/deploy/deployment-repo/apps/stoktok/"; then
  echo "FAIL: env-file writer must be in the workflow, not under apps/stoktok/" >&2
  fail=1
fi

# STK-004/STK-072: every `required` and `optional` row of the doc table is written by the workflow (printf NAME=,
# env mapping STOKTOK_NAME) and the workflow writes nothing else. Required keys have a `missing` line, optional
# keys have none and an empty-allowed charset check.
env_table="$(sed -n '/<!-- env-list:start -->/,/<!-- env-list:end -->/p' "$DOC")"
bad_status="$(echo "$env_table" | grep -E '^\| `[A-Z][A-Z0-9_]*`' \
  | awk -F'|' '{ s = $4; gsub(/^ +| +$/, "", s); if (s != "required now" && s != "optional" && s != "reserved" && s != "derived") print $2 "-> " s }' || true)"
if [ -n "$bad_status" ]; then
  echo "FAIL: docs/deploy.md env row has unknown status (allowed: required now, optional, reserved, derived): $bad_status" >&2
  fail=1
fi
required="$(echo "$env_table" | grep -E '^\| `[A-Z][A-Z0-9_]*` \|.*\| required now \|' | sed -E 's/^\| `([A-Z0-9_]+)`.*/\1/' | sort -u || true)"
optional="$(echo "$env_table" | grep -E '^\| `[A-Z][A-Z0-9_]*` \|.*\| optional \|' | sed -E 's/^\| `([A-Z0-9_]+)`.*/\1/' | sort -u || true)"
derived="$(echo "$env_table" | grep -E '^\| `[A-Z][A-Z0-9_]*` \|.*\| derived \|' | sed -E 's/^\| `([A-Z0-9_]+)`.*/\1/' | sort -u || true)"
if [ "$derived" != "STOKTOK_DATABASE_URL" ]; then
  echo "FAIL: the only derived key must be STOKTOK_DATABASE_URL, found: $(echo $derived)" >&2
  fail=1
fi
# The secret behind an env name: names that already start with STOKTOK_ map to themselves.
secret_of() { case "$1" in STOKTOK_*) echo "$1" ;; *) echo "STOKTOK_$1" ;; esac; }
if [ -z "$optional" ]; then
  echo "FAIL: no optional keys in the doc table of docs/deploy.md (expected the AI keys)" >&2
  fail=1
fi
# secrets step without comment lines (line order kept).
secrets_step="$(sed -n '/^      - name: secrets\s*$/,/^      - name: pull\s*$/p' "$WF" | grep -vE '^\s*#' || true)"
# Exactly one printf, and it is the plain `printf '<format>' "$VAR"... > "$tmp"` line (no second command on it, no other target).
printf_shape="^[[:space:]]+printf '[^']*'( \"\\\$[A-Z][A-Z0-9_]*\")+ > \"\\\$tmp\"[[:space:]]*\$"
printf_line="$(echo "$secrets_step" | grep -E "$printf_shape" || true)"
written_keys="$(echo "$printf_line" | grep -oE '[A-Z][A-Z0-9_]*=%s' | sed 's/=%s//' | sort -u || true)"
wanted_keys="$(printf '%s\n' $required $optional $derived | grep . | sort -u || true)"
if ! diff <(echo "$wanted_keys") <(echo "$written_keys"); then
  echo "FAIL: printf keys in the workflow differ from required + optional + derived keys in docs/deploy.md (< doc, > workflow)" >&2
  fail=1
fi
for k in $required $optional; do
  sk="$(secret_of "$k")"
  if ! grep -qE "^\s+$k: \\$\{\{ secrets\.$sk \}\}\s*$" "$WF"; then
    echo "FAIL: workflow lacks '$k: \${{ secrets.$sk }}'" >&2
    fail=1
  fi
done
if grep -qF 'secrets.STOKTOK_STOKTOK_' "$WF"; then
  echo "FAIL: doubled STOKTOK_ prefix in a secret name" >&2
  fail=1
fi
for k in $derived; do
  if grep -qE "^\s+$k: .*secrets\." "$WF"; then
    echo "FAIL: derived key $k must not come from a secret" >&2
    fail=1
  fi
done
for k in $required; do
  sk="$(secret_of "$k")"
  if ! grep -qF "[ -n \"\$$k\" ] || missing=\"\$missing $sk\"" "$WF"; then
    echo "FAIL: required key $k lacks its missing line in the workflow" >&2
    fail=1
  fi
done
for k in $optional; do
  if grep -qE "missing=.*STOKTOK_$k([^A-Z0-9_]|\$)" "$WF"; then
    echo "FAIL: optional key $k has a missing line in the workflow (an unset optional secret must not fail the run)" >&2
    fail=1
  fi
  # The guard is a whole non-comment line `if ! [[ ... ]]; then` with `exit 1` within 4 lines, in the secrets step, before mktemp and the printf.
  guard_ok="$(echo "$secrets_step" | awk -v k="$k" '
    { l = $0; sub(/^[[:space:]]+/, "", l); sub(/[[:space:]]+$/, "", l) }
    l == "if ! [[ \"$" k "\" =~ ^[A-Za-z0-9._-]*$ ]]; then" && !g { g = NR; next }
    g && !x && NR <= g + 4 && /^[[:space:]]*exit 1[[:space:]]*$/ { x = 1 }
    /mktemp/ && !m { m = NR }
    /^[[:space:]]*printf .*> "\$tmp"/ && !p { p = NR }
    END { print (g && x && m && p && g < m && g < p) ? "yes" : "no" }')"
  if [ "$guard_ok" != yes ]; then
    echo "FAIL: optional key $k lacks the guard 'if ! [[ \"\$$k\" =~ ^[A-Za-z0-9._-]*\$ ]]; then' + exit 1 before mktemp in the secrets step" >&2
    fail=1
  fi
done
# STK-084: the "database is ahead" literal is pinned in migrate.ts; the deploy workflow must grep the same text.
ahead_prefix="$(sed -n "s/^export const MIGRATE_AHEAD_PREFIX = '\(.*\)';\$/\1/p" "$ROOT/packages/db/src/pg/migrate.ts")"
if [ -z "$ahead_prefix" ] || ! grep -qF "AHEAD_PREFIX: '$ahead_prefix'" "$WF"; then
  echo "FAIL: workflow AHEAD_PREFIX differs from MIGRATE_AHEAD_PREFIX in packages/db/src/pg/migrate.ts" >&2
  fail=1
fi

# STK-044: one runner user; env file, scheduler dir and log dir agree across workflow, compose, scripts, plist, runbook.
ADR="$ROOT/docs/adr/0003-deploy-and-scheduling.md"
RUNCHECK="$DRAFTS/.github/workflows/runner-check.yml"
PLIST="$DRAFTS/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist"
RUNJOB="$DRAFTS/apps/stoktok/run-job.sh"
RUNSCHED="$DRAFTS/apps/stoktok/run-schedule.sh"
if grep -rn 'gh-runner' "$DRAFTS" "$DOC" "$ADR"; then
  echo "FAIL: gh-runner found in drafts, docs/deploy.md or ADR 0003" >&2
  fail=1
fi
users="$(grep -rhoE '/Users/[A-Za-z0-9._-]+' "$DRAFTS" "$DOC" | sed 's#/Users/##' | sort -u)"
if [ "$(echo "$users" | grep -c .)" -ne 1 ]; then
  echo "FAIL: expected exactly one /Users/<name> in drafts and docs/deploy.md, found: $(echo $users)" >&2
  fail=1
fi
RUNNER_USER="$(echo "$users" | head -n 1)"
if ! grep -qF "!= \"$RUNNER_USER\"" "$RUNCHECK"; then
  echo "FAIL: runner-check.yml does not expect runner user $RUNNER_USER" >&2
  fail=1
fi
sched_dir="$(sed -n 's/^  SCHED_DIR: //p' "$WF")"
job_dir="$(sed -n 's/^DIR="\${STOKTOK_DIR:-\(.*\)}"$/\1/p' "$RUNJOB")"
plist_prog="$(sed -n 's#^ *<string>\(/Users/[^<]*\)/run-schedule\.sh</string>#\1#p' "$PLIST")"
if [ -z "$sched_dir" ] || [ "$sched_dir" != "$job_dir" ] || [ "$sched_dir" != "$plist_prog" ]; then
  echo "FAIL: scheduler dir differs (workflow SCHED_DIR '$sched_dir', run-job.sh '$job_dir', plist '$plist_prog')" >&2
  fail=1
fi
log_job="$(sed -n 's/^LOG_DIR="\${STOKTOK_LOG_DIR:-\(.*\)}"$/\1/p' "$RUNJOB")"
log_sched="$(sed -n 's/^LOG_DIR="\${STOKTOK_LOG_DIR:-\(.*\)}"$/\1/p' "$RUNSCHED")"
log_out="$(sed -n 's#.*<key>StandardOutPath</key><string>\(.*\)/[^/]*</string>.*#\1#p' "$PLIST")"
log_err="$(sed -n 's#.*<key>StandardErrorPath</key><string>\(.*\)/[^/]*</string>.*#\1#p' "$PLIST")"
log_doc="$(sed -n 's#^| Log dir (`STOKTOK_LOG_DIR`) | `\([^`]*\)`.*#\1#p' "$DOC")"
if [ -z "$log_job" ] || [ "$log_job" != "$log_sched" ] || [ "$log_job" != "$log_out" ] \
   || [ "$log_job" != "$log_err" ] || [ "$log_job" != "$log_doc" ]; then
  echo "FAIL: log dir differs (run-job '$log_job', run-schedule '$log_sched', plist out '$log_out' err '$log_err', doc '$log_doc')" >&2
  fail=1
fi
if grep -q '<key>UserName</key>' "$PLIST"; then
  echo "FAIL: plist must be a LaunchAgent without UserName" >&2
  fail=1
fi
if command -v plutil >/dev/null 2>&1 && ! plutil -lint "$PLIST" >/dev/null; then
  echo "FAIL: plutil -lint $PLIST" >&2
  fail=1
fi

# STK-045: Mac-side setup in the workflow: no root, no system settings, one publish list, ordered steps, secrets confined.
if grep -nwE 'sudo' "$WF"; then
  echo "FAIL: sudo in workflow" >&2
  fail=1
fi
if grep -nE 'fdesetup|pmset|systemsetup|sysadminctl|defaults write|osascript|orb start|addexclusion -p' "$WF"; then
  echo "FAIL: system-setting command in workflow" >&2
  fail=1
fi
agent_label="$(sed -n 's/^  AGENT_LABEL: //p' "$WF")"
plist_label="$(sed -n 's#.*<key>Label</key><string>\(.*\)</string>.*#\1#p' "$PLIST")"
doc_label="$(sed -n 's#.*/Library/LaunchDaemons/\([A-Za-z0-9._-]*\)\.plist.*#\1#p' "$DOC" | sort -u)"
if [ -z "$agent_label" ] || [ "$(basename "$PLIST" .plist)" != "$agent_label" ] || [ "$plist_label" != "$agent_label" ] || [ "$doc_label" != "$agent_label" ]; then
  echo "FAIL: plist label differs (workflow '$agent_label', plist '$plist_label', file '$(basename "$PLIST")', doc '$doc_label')" >&2
  fail=1
fi
publish_files="$(sed -n 's/^  PUBLISH_FILES: //p' "$WF")"
case " $publish_files " in *" launchd/$agent_label.plist "*) ;; *)
  echo "FAIL: PUBLISH_FILES lacks launchd/$agent_label.plist" >&2
  fail=1 ;;
esac
for f in $publish_files; do
  if [ "$f" != release.env ] && [ ! -f "$DRAFTS/apps/stoktok/$f" ]; then
    echo "FAIL: PUBLISH_FILES lists missing file $f" >&2
    fail=1
  fi
done
if [ "$(grep -cF 'for f in $PUBLISH_FILES; do cp "$APP_DIR/$f" "$SCHED_DIR.new/"; done' "$WF")" -ne 2 ] \
   || grep -nE 'cp .*run-job\.sh' "$WF"; then
  echo "FAIL: publish and rollback must both copy \$PUBLISH_FILES (no literal list)" >&2
  fail=1
fi
step_line() { grep -nE "^      - name: $1\s*$" "$WF" | head -n 1 | cut -d: -f1 || true; }
prev=0
for n in preflight release envdir secrets pull backup migrate deploy publish rollback agent notify; do
  l="$(step_line "$n")"
  if [ -z "$l" ] || [ "$l" -le "$prev" ]; then
    echo "FAIL: workflow step '$n' missing or out of order (preflight, release, envdir, secrets, pull, backup, migrate, deploy, publish, rollback, agent, notify)" >&2
    fail=1
  fi
  prev="${l:-$prev}"
done
if awk '/^      - (name|uses):/{ if (blk ~ /secrets\./ && blk ~ /tmutil|launchctl|plutil|xattr/) bad=1; blk="" } { blk = blk $0 "\n" } END { if (blk ~ /secrets\./ && blk ~ /tmutil|launchctl|plutil|xattr/) bad=1; exit !bad }' "$WF"; then
  echo "FAIL: a step that uses secrets also does Mac setup (tmutil/launchctl/plutil/xattr)" >&2
  fail=1
fi
if ! grep -qF 'launchctl bootstrap "$dom"' "$WF" || ! grep -qF 'dom="gui/$(id -u)"' "$WF" \
   || grep -n 'system/' "$WF" | grep -vF 'launchctl print system/'; then
  echo "FAIL: agent must use the gui domain; system/ only in the read-only preflight print" >&2
  fail=1
fi

# STK-097: the deployment-side guard job is exactly the least-privilege PR job: pull_request_target on main only,
# read-only token, no secrets or environment, nothing credentialed, one run line (the checker from main, on the PR's file).
# STK097_GUARDS_WF lets scripts/test-deploy-guards.sh point this check at a mutated copy.
GUARDS_WF="${STK097_GUARDS_WF:-$DRAFTS/.github/workflows/stoktok-guards.yml}"
if [ ! -f "$GUARDS_WF" ]; then
  echo "FAIL: missing stoktok-guards.yml draft" >&2
  fail=1
else
  g_nc="$(grep -vE '^[[:space:]]*#' "$GUARDS_WF" || true)"
  g_block() { echo "$g_nc" | awk -v k="$1" '$0 == k { o = 1; print; next } o && /^[^[:space:]]/ { o = 0 } o && NF { print }'; }
  if [ "$(g_block 'on:')" != "$(printf '%s\n' 'on:' '  pull_request_target:' '    branches: [main]')" ]; then
    echo "FAIL: stoktok-guards.yml on: must be exactly pull_request_target with branches [main]" >&2
    fail=1
  fi
  if [ "$(g_block 'permissions:')" != "$(printf '%s\n' 'permissions:' '  contents: read')" ]; then
    echo "FAIL: stoktok-guards.yml permissions must be exactly contents: read" >&2
    fail=1
  fi
  if [ "$(echo "$g_nc" | grep -cE '^[[:space:]]+persist-credentials: false[[:space:]]*$')" -ne 2 ] \
     || [ "$(echo "$g_nc" | grep -c 'persist-credentials')" -ne 2 ]; then
    echo "FAIL: stoktok-guards.yml needs persist-credentials: false on both checkouts" >&2
    fail=1
  fi
  if [ "$(echo "$g_nc" | grep -cxF '          ref: refs/pull/${{ github.event.pull_request.number }}/merge')" -ne 1 ] \
     || ! echo "$g_nc" | grep -qxF '          path: pr'; then
    echo "FAIL: stoktok-guards.yml must check out refs/pull/<n>/merge into path: pr" >&2
    fail=1
  fi
  if [ "$(echo "$g_nc" | grep -cE '^[[:space:]]+uses: actions/checkout@v7[[:space:]]*$')" -ne 2 ] || [ "$(echo "$g_nc" | grep -c 'uses:')" -ne 2 ]; then
    echo "FAIL: stoktok-guards.yml must use only the two actions/checkout@v7 steps" >&2
    fail=1
  fi
  if echo "$g_nc" | grep -qE 'secrets\.|environment:'; then
    echo "FAIL: stoktok-guards.yml must not use secrets or an environment" >&2
    fail=1
  fi
  if [ "$(echo "$g_nc" | grep -c 'run:')" -ne 1 ] \
     || ! echo "$g_nc" | grep -qxF '        run: bash ops/check-stoktok-workflow.sh pr/.github/workflows/deploy-stoktok.yml'; then
    echo "FAIL: stoktok-guards.yml must have exactly one run: bash ops/check-stoktok-workflow.sh pr/.github/workflows/deploy-stoktok.yml" >&2
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "OK: deploy env lists consistent"
