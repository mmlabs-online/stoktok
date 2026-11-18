#!/usr/bin/env bash
# Guards for .github/workflows/deploy-stoktok.yml: the workflow that writes stoktok's env file (database URL, AI master
# key, Supabase keys) from the `stoktok` environment secrets and the committed Postgres password file, and must never print them.
# Usage: bash ops/check-stoktok-workflow.sh <workflow-file>      exit 0 = OK, 1 = FAIL, 2 = usage.
# Source of truth: stoktok repo, deploy/deployment-repo/ops/check-stoktok-workflow.sh (STK-097). Copy it verbatim; do not edit here.
# Portable: runs on macOS /bin/bash 3.2 with BSD grep, sed and awk (the self-hosted macbook-runner). No \s \w \b, no grep -P,
# no sed -i, no mapfile, no awk intervals {n}. Workflow text that is printed goes through show() (CR stripped, prefixed) and
# between ::stop-commands:: and its per-run token, so it cannot become a workflow command.
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

# YAML parsers (and bash for CR) treat CR, NEL, U+2028 and U+2029 as line breaks, grep does not: such a file could hide a line
# from every line-based check below, and a CR in printed text would start a new line in the runner's log. Reject up front,
# printing nothing from the file.
for lb in '\r' '\302\205' '\342\200\250' '\342\200\251'; do
  if LC_ALL=C grep -qF "$(printf "$lb")" "$WF"; then
    echo "FAIL: workflow contains a carriage return or a Unicode line break" >&2
    exit 1
  fi
done

# Text from the PR's file is printed only between stop-commands and its per-run token (unknowable to the PR author).
tok="stk$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
echo "::stop-commands::$tok" >&2
trap 'echo "::$tok::" >&2' EXIT

show() { tr -d '\r' | sed 's/^/  | /'; }
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
# xtrace in any spelling (set -x, set -o xtrace with any spacing, a `shell:` or bash invocation with -x) would echo expanded secrets.
{ grep -E 'set[[:space:]]+-[A-Za-z]*x|set[[:space:]]+-o[[:space:]]+xtrace|shell:.*(-[A-Za-z]*x|xtrace)|bash[[:space:]]+-[A-Za-z]*x' "$WF" || true; } \
  | flag "xtrace (set -x, set -o xtrace, shell: bash -x) in workflow" || fail=1
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
# owner+mode check; order: umask < home-prefix check < dir= < rm -f stale temp files (STK-097) < pwfile < chmod 700 dir < mktemp "$dir/ < trap < printf < chmod 600 < mv -f < stat check + exit 1.
mode_ok="$(echo "$secrets_step" | awk '
  { l = $0; sub(/^[[:space:]]+/, "", l); sub(/[[:space:]]+$/, "", l) }
  l == "umask 077" && !a { a = NR }
  index(l, "[[ \"$ENV_FILE\" == \"$HOME/\"* ]] ||") == 1 && !h { h = NR }
  l == "dir=\"$(dirname \"$ENV_FILE\")\"" && !dd { dd = NR }
  l == "rm -f \"$dir\"/.stoktok.env.??????" && !rm { rm = NR }
  l == "pwfile=\"postgres/secrets/apps/$DB_APP.password\"" && !f { f = NR }
  l == "chmod 700 \"$dir\"" && !d { d = NR }
  l == "tmp=\"$(mktemp \"$dir/.stoktok.env.XXXXXX\")\"" && !m { m = NR }
  l == "trap '"'"'rm -f \"$tmp\"'"'"' EXIT" && !t { t = NR }
  l ~ /^printf .* > "\$tmp"$/ && !p { p = NR }
  l == "chmod 600 \"$tmp\"" && !c { c = NR }
  l == "mv -f \"$tmp\" \"$ENV_FILE\"" && !v { v = NR }
  l == "if [ \"$(stat -f '"'"'%Su %Lp'"'"' \"$ENV_FILE\")\" != \"$(id -un) 600\" ]; then" && !s { s = NR; next }
  s && !x && NR <= s + 4 && l == "exit 1" { x = NR }
  END { print (a && h && dd && rm && f && d && m && t && p && c && v && s && x && a < h && h < dd && dd < rm && rm < f && f < d && d < m && m < t && t < p && p < c && c < v && v < s && s < x) ? "yes" : "no" }')"
if [ "$mode_ok" != yes ]; then
  bad "the secrets step must keep, in order: umask 077, the home-prefix check, dir=\"\$(dirname \"\$ENV_FILE\")\", rm -f \"\$dir\"/.stoktok.env.??????, the password file steps, chmod 700 \"\$dir\", mktemp \"\$dir/.stoktok.env.XXXXXX\", trap rm, the printf, chmod 600 \"\$tmp\", mv -f \"\$tmp\" \"\$ENV_FILE\", the owner+mode stat check + exit 1"
fi
# STK-093/STK-097: nothing in the workflow may dump the shell or the env file into the log (name-independent deny list).
# Tripwire for accidental leaks, not a complete control: the password is readable by everyone with deployment-repo read
# access, and a determined edit can always find another spelling. The real controls are review of this file and the
# environment protections.
{ echo "$wf_nc" | grep -nE -e '^[[:space:]]*(set|env|export|declare|typeset|readonly|printenv)[[:space:]]*$' \
     -e '(declare|typeset|export|readonly)[[:space:]]+-[A-Za-z]*p' -e 'printenv' -e '(^|[^A-Za-z_])env[[:space:]]*\|' || true; } \
  | flag "workflow dumps the shell (bare set/env/export/declare -p/printenv)" || fail=1
# `set` alone dumps every variable: at the start of a command, after ; { ( | & then do else, followed by an end or a redirect/pipe.
{ echo "$wf_nc" | grep -nE '(^|[;{(|&]|then|do|else)[[:space:]]*set[[:space:]]*($|[|>;)}&])' || true; } \
  | flag "workflow runs a bare 'set' (dumps all variables)" || fail=1
{ echo "$wf_nc" | grep -nE -e 'compgen' -e '\$\{![A-Za-z_]' -e '\$\([[:space:]]*<' || true; } \
  | flag "workflow lists variables indirectly (compgen, \${!v}) or reads a file with \$(<file)" || fail=1
# Input redirects from the env file, its temp file or the password file; only the one password read is allowed.
{ echo "$wf_nc" | grep -E -e '<[[:space:]]*"?\$\{?(ENV_FILE|tmp|pwfile)([^A-Za-z0-9_]|$)' -e '<[^<]*secrets/' \
  | grep -vxE '[[:space:]]*IFS= read -r pw < "\$pwfile" \|\| true[[:space:]]*' || true; } \
  | flag "workflow reads the env file, its temp file or the password file by redirect" || fail=1
# Readers and copiers (at the start of a command) aimed at the env file, $tmp, $pwfile, secrets/ or a .env file ("release.env" is not a .env file).
re_reader='(^|[;&|({`]|then|do|else)[[:space:]]*(/[^[:space:]]*/)?(cat|head|tail|less|more|xxd|od|strings|grep|egrep|fgrep|sed|awk|base64|tac|rev|cp|dd|nl)[[:space:]]+'
re_target="ENV_FILE|\\\$\\{?tmp([^A-Za-z0-9_]|\$)|\\\$\\{?pwfile|secrets/|stoktok\\.env|(^|[/[:space:]\"'])\\.env([^A-Za-z0-9_.]|\$)"
{ echo "$wf_nc" | grep -nE "${re_reader}.*(${re_target})" || true; } \
  | flag "workflow reads or copies a secret file (cat/grep/sed/awk/base64/cp/dd/... of the env file, \$tmp, \$pwfile or secrets/)" || fail=1
{ echo "$wf_nc" | grep -nE -e '(compose\[@\]\}"|docker compose).*[[:space:]]convert([[:space:]]|$)' \
     -e '[[:space:]](exec|run)[[:space:]].*[[:space:]](env|printenv)([[:space:]]|$)' -e '/proc/[^[:space:]]*environ' || true; } \
  | flag "workflow prints a container or process environment (compose convert, exec/run env, /proc/*/environ)" || fail=1
{ echo "$wf_nc" | grep -E 'docker[[:space:]]+(container[[:space:]]+)?inspect' | grep -vE -- '[[:space:]](-f|--format)([[:space:]=]|$)' || true; } \
  | flag "docker inspect without -f in workflow" || fail=1
{ echo "$wf_nc" | grep -E 'docker[[:space:]]+(container[[:space:]]+)?inspect' \
  | grep -E 'Config\.Env|\.Env([^A-Za-z]|$)|\{\{[[:space:]]*json[[:space:]]+\.[[:space:]]*\}\}|\{\{[[:space:]]*\.[[:space:]]*\}\}|\.Config[[:space:]]*\}\}' || true; } \
  | flag "docker inspect -f format dumps the container environment (Config.Env, {{json .}}, {{.}})" || fail=1
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

# STK-097: the step layout the range checks above depend on.
if [ "$(grep -cE '^      - name: secrets[[:space:]]*$' "$WF")" -ne 1 ] || [ "$(grep -cE '^      - name: pull[[:space:]]*$' "$WF")" -ne 1 ] \
   || [ "$(grep -nE '^      - name: secrets[[:space:]]*$' "$WF" | cut -d: -f1)" -ge "$(grep -nE '^      - name: pull[[:space:]]*$' "$WF" | cut -d: -f1)" ]; then
  bad "exactly one '- name: secrets' step, followed by exactly one '- name: pull' step, is required"
fi
# STK-097: every `run:` is a plain `|` block scalar: a quoted or one-line run (`run: "true\nset"`) hides code from the line checks.
{ echo "$wf_nc" | grep -E '(^|[[:space:]-])run[[:space:]]*:' | grep -vE '^[[:space:]]+run: \|[[:space:]]*$' || true; } \
  | flag "every run: must be a '|' block scalar (no quoted or one-line run:)" || fail=1
# STK-097: every printf key except the derived database URL has a format guard, a whole line
# `if ! [[ "$KEY" =~ ... ]]; then` with `exit 1` within 4 lines, before mktemp (name-independent: no key list here).
for k in $(echo "$printf_line" | grep -oE '[A-Z][A-Z0-9_]*=%s' | sed 's/=%s//' | grep -vx STOKTOK_DATABASE_URL || true); do
  guard_ok="$(echo "$secrets_step" | K="$k" awk '
    BEGIN { k = ENVIRON["K"] }
    { l = $0; sub(/^[[:space:]]+/, "", l); sub(/[[:space:]]+$/, "", l) }
    index(l, "if ! [[ \"$" k "\" =~ ") == 1 && l ~ /\]\]; then$/ && !g { g = NR; next }
    g && !x && NR <= g + 4 && l == "exit 1" { x = 1 }
    /mktemp/ && !m { m = NR }
    END { print (g && x && m && g < m) ? "yes" : "no" }')"
  if [ "$guard_ok" != yes ]; then
    bad "printf key $k has no 'if ! [[ \"\$$k\" =~ ... ]]; then' guard + exit 1 before mktemp in the secrets step"
  fi
done
# STK-097: one temp file, one tmp variable, in the secrets step.
if [ "$(echo "$secrets_step" | grep -c 'mktemp')" -ne 1 ] || [ "$(echo "$secrets_step" | grep -cE '(^|[^A-Za-z0-9_])tmp=')" -ne 1 ]; then
  bad "the secrets step must have exactly one mktemp and one tmp= assignment"
fi
# STK-097: chmod only on the env dir (700) and on the temp file (600); never on $ENV_FILE.
{ echo "$wf_nc" | grep -E '(^|[^A-Za-z_])chmod([^A-Za-z_]|$)' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
  | grep -vxF -e 'chmod 700 "$dir"' -e 'chmod 600 "$tmp"' || true; } \
  | flag "chmod other than 'chmod 700 \"\$dir\"' and 'chmod 600 \"\$tmp\"'" || fail=1
# STK-097: ENV_FILE is set once, at the top level; no step-level override, no assignment, no GITHUB_ENV.
if [ "$(echo "$wf_nc" | grep -cE '(^|[^A-Za-z0-9_$])ENV_FILE:')" -ne 1 ] || [ "$(grep -cE '^  ENV_FILE: [^[:space:]]+$' "$WF")" -ne 1 ]; then
  bad "ENV_FILE must be defined exactly once, as a top-level env entry (no step-level override)"
fi
{ echo "$wf_nc" | grep -nE -e '(^|[^A-Za-z0-9_])ENV_FILE=' -e 'GITHUB_ENV.*ENV_FILE|ENV_FILE.*GITHUB_ENV' || true; } \
  | flag "ENV_FILE is assigned or exported through GITHUB_ENV" || fail=1
# STK-097: outside the secrets step, $ENV_FILE appears only on these known lines (copied verbatim from the workflow;
# editing one of them in the workflow means editing it here, in the same stoktok PR).
known_env_lines='[[ "$ENV_FILE" == "$HOME/"* ]] || { echo "::error::ENV_FILE $ENV_FILE is not under the runner user'"'"'s home $HOME ($(id -un)). Nothing was started."; exit 1; }
dir="$(dirname "$ENV_FILE")"
if [ ! -f "$ENV_FILE" ] || [ "$(stat -f '"'"'%Su %Lp'"'"' "$ENV_FILE")" != "$(id -un) 600" ]; then
echo "::error::$ENV_FILE is missing or not owned by $(id -un) with mode 600. Nothing was restored."
failure:env-missing)       msg="env-missing: \`$IMAGE\` failed its health check and $ENV_FILE is missing or has the wrong owner or mode; nothing was restored." ;;'
{ echo "$out_of_step" | grep 'ENV_FILE' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
  | grep -vxE 'ENV_FILE: [^[:space:]]+' | grep -vxF -e "$known_env_lines" || true; } \
  | flag "ENV_FILE is used outside the secrets step on a line that is not a known one" || fail=1
# STK-097: pull fails closed. The service list is a plain assignment (a config error fails the step), must name
# stoktok-web (else the list is garbage and nothing starts), and only then is `migrate` looked for.
pull_step="$(echo "$wf_nc" | sed -n '/^      - name: pull[[:space:]]*$/,/^      - name: backup[[:space:]]*$/p')"
pull_ok="$(echo "$pull_step" | awk '
  { l = $0; sub(/^[[:space:]]+/, "", l); sub(/[[:space:]]+$/, "", l) }
  l == "services=\"$(\"${compose[@]}\" --profile migrate config --services)\"" { n++; if (!s) s = NR }
  l == "if ! printf '"'"'%s\\n'"'"' \"$services\" | grep -qx stoktok-web; then" && !g { g = NR; next }
  g && !x && NR <= g + 4 && l == "exit 1" { x = NR }
  l == "if printf '"'"'%s\\n'"'"' \"$services\" | grep -qx migrate; then" && !i { i = NR }
  END { print (n == 1 && s && g && x && i && s < g && g < x && x < i) ? "yes" : "no" }')"
if [ "$pull_ok" != yes ]; then
  bad "the pull step must capture services=\"\$(\"\${compose[@]}\" --profile migrate config --services)\", fail unless it lists stoktok-web, and only then test for migrate"
fi
{ echo "$pull_step" | grep -nE -e 'config --services[^"]*\|' -e 'set \+e' -e '\|\|[[:space:]]*true' || true; } \
  | flag "the pull step swallows a config error (config --services piped directly, set +e, || true)" || fail=1

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "OK: $WF"
