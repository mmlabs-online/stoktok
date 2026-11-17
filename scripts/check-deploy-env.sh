#!/usr/bin/env bash
# STK-018/STK-037 (R3): keep docs/deploy.md env table, the draft deployment-repo compose, release.yml
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
if [ "$(grep -c '^\s*env_file:' "$COMPOSE")" -lt 2 ]; then
  echo "FAIL: compose needs env_file on both services" >&2
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
web_block="$(sed -n '/^  stoktok-web:/,/^  stoktok-worker:/p' "$COMPOSE")"
worker_block="$(sed -n '/^  stoktok-worker:/,/^networks:/p' "$COMPOSE")"
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
if grep -E '(compose\[@\]\}"|docker compose).* config([[:space:]]|$)' "$WF" | grep -vE -- '--(quiet|services)'; then
  echo "FAIL: compose config without --quiet or --services" >&2
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
if [ "$(echo "$printf_line" | grep -c .)" -ne 1 ] || [ "$(echo "$secrets_step" | grep -cE '^[[:space:]]*printf ')" -ne 1 ]; then
  echo "FAIL: secrets step needs exactly one env-file printf of the form: printf '...' \"\$VAR\"... > \"\$tmp\"" >&2
  fail=1
fi
written_keys="$(echo "$printf_line" | grep -oE '[A-Z][A-Z0-9_]*=%s' | sed 's/=%s//' | sort -u || true)"
wanted_keys="$(printf '%s\n' $required $optional $derived | grep . | sort -u || true)"
if ! diff <(echo "$wanted_keys") <(echo "$written_keys"); then
  echo "FAIL: printf keys in the workflow differ from required + optional + derived keys in docs/deploy.md (< doc, > workflow)" >&2
  fail=1
fi
format_order="$(echo "$printf_line" | grep -oE '[A-Z][A-Z0-9_]*=%s' | sed 's/=%s//' || true)"
argument_order="$(echo "$printf_line" | grep -oE '"\$[A-Z][A-Z0-9_]*"' | tr -d '"$' || true)"
if ! diff <(echo "$format_order") <(echo "$argument_order"); then
  echo "FAIL: printf argument order differs from format key order (< format, > arguments)" >&2
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
# The secrets step writes the env file only with the one printf; no other redirect to $tmp / $ENV_FILE, no tee.
other_writers="$(echo "$secrets_step" | grep -vE "$printf_shape" \
  | grep -E '>(>|\|)?[[:space:]]*"?\$\{?(tmp|ENV_FILE)|(^|[^A-Za-z_])tee([^A-Za-z_]|$)' || true)"
if [ -n "$other_writers" ]; then
  echo "FAIL: secrets step writes to the env file outside the single printf: $other_writers" >&2
  fail=1
fi

# STK-084: the required master key has a format guard (before mktemp and the printf); the database URL is derived from the
# committed password file with builtins only, inside the secrets step before mktemp.
guard_ok="$(echo "$secrets_step" | awk '
  { l = $0; sub(/^[[:space:]]+/, "", l); sub(/[[:space:]]+$/, "", l) }
  l == "re_master_key='"'"'^[A-Za-z0-9+/]{43}=$'"'"'" { r = NR }
  r && l == "if ! [[ \"$STOKTOK_AI_KEYS_MASTER_KEY\" =~ $re_master_key ]]; then" && !g { g = NR; next }
  g && !x && NR <= g + 4 && /^[[:space:]]*exit 1[[:space:]]*$/ { x = 1 }
  /mktemp/ && !m { m = NR }
  /^[[:space:]]*printf .*> "\$tmp"/ && !p { p = NR }
  END { print (r && g && x && m && p && r < g && g < m && g < p) ? "yes" : "no" }')"
if [ "$guard_ok" != yes ]; then
  echo "FAIL: STOKTOK_AI_KEYS_MASTER_KEY lacks re_master_key='^[A-Za-z0-9+/]{43}=\$' and its guard + exit 1 before mktemp in the secrets step" >&2
  fail=1
fi
if ! grep -qE '^  DB_APP: stoktok\s*$' "$WF"; then
  echo "FAIL: workflow lacks 'DB_APP: stoktok'" >&2
  fail=1
fi
mktemp_line="$(echo "$secrets_step" | grep -n 'mktemp' | head -n 1 | cut -d: -f1 || true)"
for lit in 'pwfile="postgres/secrets/apps/$DB_APP.password"' \
           'pw=""' \
           'read -r pw < "$pwfile" || true' \
           "re_pw='^[A-Za-z0-9_-]{16,}\$'" \
           'if ! [[ "$pw" =~ $re_pw ]]; then' \
           'STOKTOK_DATABASE_URL="postgres://$DB_APP:$pw@postgres:5432/$DB_APP"'; do
  l="$(echo "$secrets_step" | grep -nF -- "$lit" | head -n 1 | cut -d: -f1 || true)"
  if [ -z "$l" ] || [ -z "$mktemp_line" ] || [ "$l" -ge "$mktemp_line" ]; then
    echo "FAIL: secrets step lacks (before mktemp): $lit" >&2
    fail=1
  fi
done

# STK-084: the "database is ahead" literal is pinned in migrate.ts; the deploy workflow must grep the same text.
ahead_prefix="$(sed -n "s/^export const MIGRATE_AHEAD_PREFIX = '\(.*\)';\$/\1/p" "$ROOT/packages/db/src/pg/migrate.ts")"
if [ -z "$ahead_prefix" ] || ! grep -qF "AHEAD_PREFIX: '$ahead_prefix'" "$WF"; then
  echo "FAIL: workflow AHEAD_PREFIX differs from MIGRATE_AHEAD_PREFIX in packages/db/src/pg/migrate.ts" >&2
  fail=1
fi
for n in backup migrate; do
  if ! sed -n "/^      - name: $n\s*\$/,/^        run:/p" "$WF" | grep -qF "if: steps.pull.outputs.migrate == 'true'"; then
    echo "FAIL: step '$n' must be guarded by steps.pull.outputs.migrate == 'true'" >&2
    fail=1
  fi
done

# STK-044: one runner user; env file, scheduler dir and log dir agree across workflow, compose, scripts, plist, runbook.
DRAFTS="$ROOT/deploy/deployment-repo"
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

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "OK: deploy env lists consistent"
