#!/usr/bin/env bash
# Guards for .github/workflows/deploy-stoktok.yml: the workflow that writes stoktok's env file (database URL, AI master
# key, Supabase keys) from the `stoktok` environment secrets and the committed Postgres password file, and must never print them.
# Usage: bash ops/check-stoktok-workflow.sh <workflow-file>      exit 0 = OK, 1 = FAIL, 2 = usage.
# Source of truth: stoktok repo, deploy/deployment-repo/ops/check-stoktok-workflow.sh (STK-097). Copy it verbatim; do not edit here.
# Portable: runs on macOS /bin/bash 3.2 with BSD grep, sed and awk (the self-hosted macbook-runner). No \s \w \b, no grep -P,
# no sed -i, no mapfile, no awk intervals {n}. Workflow text that is printed goes through show(), so no printed line can
# start with `::` and be read as a workflow command.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: bash ops/check-stoktok-workflow.sh <workflow-file>" >&2
  exit 2
fi
WF="$1"
wf_dir="$(dirname "$WF")"
if [ ! -f "$WF" ] || [ -L "$WF" ] || [ -L "$wf_dir" ] || [ -L "$(dirname "$wf_dir")" ]; then
  echo "usage: $WF must be a regular file and neither it nor its two parent directories a symlink" >&2
  exit 2
fi
fail=0

show() { sed 's/^/  | /'; }
# flag <message>: stdin is the offending lines; prints them (prefixed) under the message and returns 1 if there are any.
flag() {
  local out
  out="$(cat)"
  if [ -n "$out" ]; then
    echo "FAIL: $1" >&2
    printf '%s\n' "$out" | show >&2
    return 1
  fi
  return 0
}
bad() { echo "FAIL: $1" >&2; fail=1; }

# STK-043: the deploy workflow gets the secrets from the `stoktok` environment and never prints them.
if ! grep -qE '^[[:space:]]+environment: stoktok[[:space:]]*$' "$WF"; then
  bad "workflow lacks 'environment: stoktok'"
fi
if ! grep -qF "if: github.ref == 'refs/heads/main'" "$WF"; then
  bad "workflow lacks the main-only guard"
fi
{ grep -E '(^|[^.A-Za-z])secrets\.' "$WF" | grep -vE '^[[:space:]]+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}[[:space:]]*$' || true; } \
  | flag "'secrets.' used outside a step env mapping" || fail=1
{ grep -E 'set -[A-Za-z]*x|set -o xtrace' "$WF" || true; } | flag "set -x in workflow" || fail=1
# Assumes the convention: compose is run as "${compose[@]}" (array named compose) or "docker compose" on one line;
# another array name, docker-compose, or a line continuation is not seen.
{ grep -E '(compose\[@\]\}"|docker compose).* config([[:space:]]|$)' "$WF" | grep -vE -- '--(quiet|services)' || true; } \
  | flag "compose config without --quiet or --services" || fail=1
{ grep -F '<<' "$WF" || true; } | flag "heredoc in workflow" || fail=1

# secrets step without comment lines (line order kept).
secrets_step="$(sed -n '/^      - name: secrets[[:space:]]*$/,/^      - name: pull[[:space:]]*$/p' "$WF" | grep -vE '^[[:space:]]*#' || true)"
# Exactly one printf, and it is the plain `printf '<format>' "$VAR"... > "$tmp"` line (no second command on it, no other target).
printf_shape="^[[:space:]]+printf '[^']*'( \"\\\$[A-Z][A-Z0-9_]*\")+ > \"\\\$tmp\"[[:space:]]*\$"
printf_line="$(echo "$secrets_step" | grep -E "$printf_shape" || true)"
if [ "$(echo "$printf_line" | grep -c .)" -ne 1 ] || [ "$(echo "$secrets_step" | grep -cE '^[[:space:]]*printf ')" -ne 1 ]; then
  bad "secrets step needs exactly one env-file printf of the form: printf '...' \"\$VAR\"... > \"\$tmp\""
fi
format_order="$(echo "$printf_line" | grep -oE '[A-Z][A-Z0-9_]*=%s' | sed 's/=%s//' || true)"
argument_order="$(echo "$printf_line" | grep -oE '"\$[A-Z][A-Z0-9_]*"' | tr -d '"$' || true)"
if [ "$format_order" != "$argument_order" ]; then
  bad "printf argument order differs from format key order"
fi
# The secrets step writes the env file only with the one printf; no other redirect to $tmp / $ENV_FILE, no tee.
{ echo "$secrets_step" | grep -vE "$printf_shape" \
  | grep -E '>(>|\|)?[[:space:]]*"?\$\{?(tmp|ENV_FILE)|(^|[^A-Za-z_])tee([^A-Za-z_]|$)' || true; } \
  | flag "secrets step writes to the env file outside the single printf" || fail=1

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
  bad "STOKTOK_AI_KEYS_MASTER_KEY lacks re_master_key='^[A-Za-z0-9+/]{43}=\$' and its guard + exit 1 before mktemp in the secrets step"
fi
if ! grep -qE '^  DB_APP: stoktok[[:space:]]*$' "$WF"; then
  bad "workflow lacks 'DB_APP: stoktok'"
fi
mktemp_line="$(echo "$secrets_step" | grep -n 'mktemp' | head -n 1 | cut -d: -f1 || true)"
for lit in 'pwfile="postgres/secrets/apps/$DB_APP.password"' \
           'pw=""' \
           'IFS= read -r pw < "$pwfile" || true' \
           "re_pw='^[A-Za-z0-9_-]{16,}\$'" \
           'if ! [[ "$pw" =~ $re_pw ]]; then' \
           'STOKTOK_DATABASE_URL="postgres://$DB_APP:$pw@postgres:5432/$DB_APP"'; do
  l="$(echo "$secrets_step" | grep -nF -- "$lit" | head -n 1 | cut -d: -f1 || true)"
  if [ -z "$l" ] || [ -z "$mktemp_line" ] || [ "$l" -ge "$mktemp_line" ]; then
    bad "secrets step lacks (before mktemp): $lit"
  fi
done

# STK-093: the password guard order (pwfile < IFS= read < re_pw < guard < exit 1 within 4 lines < URL < mktemp < printf).
pw_ok="$(echo "$secrets_step" | awk '
  { l = $0; sub(/^[[:space:]]+/, "", l); sub(/[[:space:]]+$/, "", l) }
  l == "pwfile=\"postgres/secrets/apps/$DB_APP.password\"" && !f { f = NR }
  l == "IFS= read -r pw < \"$pwfile\" || true" && !rd { rd = NR }
  l == "re_pw='"'"'^[A-Za-z0-9_-]{16,}$'"'"'" && !r { r = NR }
  r && l == "if ! [[ \"$pw\" =~ $re_pw ]]; then" && !g { g = NR; next }
  g && !x && NR <= g + 4 && l == "exit 1" { x = NR }
  l == "STOKTOK_DATABASE_URL=\"postgres://$DB_APP:$pw@postgres:5432/$DB_APP\"" && !u { u = NR }
  /mktemp/ && !m { m = NR }
  /^[[:space:]]*printf .*> "\$tmp"/ && !p { p = NR }
  END { print (f && rd && r && g && x && u && m && p && f < rd && rd < g && r < g && g < x && x < u && u < m && m < p) ? "yes" : "no" }')"
if [ "$pw_ok" != yes ]; then
  bad "the password guard (re_pw, if ! [[ \"\$pw\" =~ \$re_pw ]] + exit 1) must follow IFS= read and precede STOKTOK_DATABASE_URL=, mktemp and the printf in the secrets step"
fi
# STK-093: the password and the URL are never echoed. Outside the secrets step no code line may mention them; inside it
# $pw appears only on the guard and the URL assignment, $STOKTOK_DATABASE_URL only on the single printf.
re_pwvar='\$\{?pw([^A-Za-z0-9_]|$)'
wf_nc="$(grep -vE '^[[:space:]]*#' "$WF" || true)"
out_of_step="$(echo "$wf_nc" | sed '/^      - name: secrets[[:space:]]*$/,/^      - name: pull[[:space:]]*$/d')"
{ echo "$out_of_step" | grep -nE -e "$re_pwvar" -e 'STOKTOK_DATABASE_URL' || true; } \
  | flag "the database password or URL is referenced outside the secrets step" || fail=1
pw_lines="$(echo "$secrets_step" | grep -E "$re_pwvar" || true)"
pw_count="$(echo "$secrets_step" | grep -cE "$re_pwvar" || true)"
if [ "$pw_count" != 2 ] \
   || ! echo "$pw_lines" | grep -qF 'if ! [[ "$pw" =~ $re_pw ]]; then' \
   || ! echo "$pw_lines" | grep -qF 'STOKTOK_DATABASE_URL="postgres://$DB_APP:$pw@postgres:5432/$DB_APP"'; then
  bad "in the secrets step \$pw may appear only on the guard and the URL assignment"
fi
url_count="$(echo "$secrets_step" | grep -cE '\$\{?STOKTOK_DATABASE_URL' || true)"
if [ "$url_count" != 1 ] || ! echo "$secrets_step" | grep -E '\$\{?STOKTOK_DATABASE_URL' | grep -qE "$printf_shape"; then
  bad "in the secrets step \$STOKTOK_DATABASE_URL may appear only on the single printf"
fi

# STK-093: the env file is written under umask 077, via a temp file in the same dir (atomic rename), mode 600, then an
# owner+mode check; order: umask < pwfile < chmod 700 dir < mktemp "$dir/ < trap < printf < chmod 600 < mv -f < stat check + exit 1.
mode_ok="$(echo "$secrets_step" | awk '
  { l = $0; sub(/^[[:space:]]+/, "", l); sub(/[[:space:]]+$/, "", l) }
  l == "umask 077" && !a { a = NR }
  l == "pwfile=\"postgres/secrets/apps/$DB_APP.password\"" && !f { f = NR }
  l == "chmod 700 \"$dir\"" && !d { d = NR }
  l == "tmp=\"$(mktemp \"$dir/.stoktok.env.XXXXXX\")\"" && !m { m = NR }
  l == "trap '"'"'rm -f \"$tmp\"'"'"' EXIT" && !t { t = NR }
  l ~ /^printf .* > "\$tmp"$/ && !p { p = NR }
  l == "chmod 600 \"$tmp\"" && !c { c = NR }
  l == "mv -f \"$tmp\" \"$ENV_FILE\"" && !v { v = NR }
  l == "if [ \"$(stat -f '"'"'%Su %Lp'"'"' \"$ENV_FILE\")\" != \"$(id -un) 600\" ]; then" && !s { s = NR; next }
  s && !x && NR <= s + 4 && l == "exit 1" { x = NR }
  END { print (a && f && d && m && t && p && c && v && s && x && a < f && f < d && d < m && m < t && t < p && p < c && c < v && v < s && s < x) ? "yes" : "no" }')"
if [ "$mode_ok" != yes ]; then
  bad "the secrets step must keep, in order: umask 077, chmod 700 \"\$dir\", mktemp \"\$dir/.stoktok.env.XXXXXX\", trap rm, the printf, chmod 600 \"\$tmp\", mv -f \"\$tmp\" \"\$ENV_FILE\", the owner+mode stat check + exit 1"
fi
# STK-093: nothing in the workflow may dump the shell or the env file into the log (name-independent deny list).
{ echo "$wf_nc" | grep -nE -e '^[[:space:]]*(set|env|export|declare|typeset|readonly|printenv)[[:space:]]*$' \
     -e '(declare|typeset|export|readonly)[[:space:]]+-[A-Za-z]*p' -e 'printenv' -e '(^|[^A-Za-z_])env[[:space:]]*\|' \
     -e '(^|[^A-Za-z_-])(cat|head|tail|less|more|xxd|od|strings)[[:space:]]+.*(ENV_FILE|\$tmp|\$pwfile|secrets/|\.env)' || true; } \
  | flag "workflow dumps the shell or a secret file (bare set/env/export/declare -p/printenv, cat of the env file, \$tmp or secrets/)" || fail=1
{ echo "$wf_nc" | grep -E 'docker[[:space:]]+(container[[:space:]]+)?inspect' | grep -vE -- '[[:space:]](-f|--format)([[:space:]=]|$)' || true; } \
  | flag "docker inspect without -f in workflow" || fail=1
# STK-093: the trigger set is exactly push on main (apps/stoktok paths) + workflow_dispatch; `if: github.ref == main` is
# also true for pull_request_target, schedule and workflow_run, so those must never appear.
on_block="$(echo "$wf_nc" | awk '/^on:[[:space:]]*$/ { o = 1; print; next } o && /^[^[:space:]]/ { o = 0 } o && NF { print }')"
want_on="$(printf '%s\n' 'on:' '  push:' '    branches: [main]' "    paths: ['apps/stoktok/**']" '  workflow_dispatch:')"
if [ "$on_block" != "$want_on" ]; then
  bad "the on: block must be exactly push (branches [main], paths apps/stoktok/**) and workflow_dispatch"
fi
{ echo "$wf_nc" | grep -nE '^[[:space:]]*(pull_request|pull_request_target|workflow_run|schedule|workflow_call|issue_comment|repository_dispatch)[[:space:]]*:' || true; } \
  | flag "forbidden trigger in workflow (pull_request, pull_request_target, workflow_run, schedule, ...)" || fail=1
for n in backup migrate; do
  if ! sed -n "/^      - name: $n[[:space:]]*\$/,/^        run:/p" "$WF" | grep -qF "if: steps.pull.outputs.migrate == 'true'"; then
    bad "step '$n' must be guarded by steps.pull.outputs.migrate == 'true'"
  fi
done

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "OK: $WF"
