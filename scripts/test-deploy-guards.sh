#!/usr/bin/env bash
# STK-097: mutation proofs for deploy/deployment-repo/ops/check-stoktok-workflow.sh. Each mutation of the draft
# workflow must make the checker exit 1; the unchanged draft and the negative controls must exit 0. Also runs the
# `pull` step of the draft against a docker shim (fail-closed migrate detection) and the stoktok-guards.yml pins.
# Portable to macOS bash 3.2 and BSD tools (CI job deploy-guards-macos); no GNU-only flags, awk gets text via ENVIRON.
# STK097_SKIP_CROSSFILE=1 skips the cases that run scripts/check-deploy-env.sh (the macOS job sets it).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DR="$ROOT/deploy/deployment-repo"
CHK="$DR/ops/check-stoktok-workflow.sh"
DRAFT="$DR/.github/workflows/deploy-stoktok.yml"
GUARDS="$DR/.github/workflows/stoktok-guards.yml"
W="$(mktemp -d "${TMPDIR:-/tmp}/stk097.XXXXXX")"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/c/.github/workflows" "$W/bin"
cur="$W/c/.github/workflows/deploy-stoktok.yml"
q="'"
failures=0

fresh() { cp "$DRAFT" "$cur"; }
apply() { mv "$W/next" "$cur"; }
# ins_end <step> <line>: append <line> (10-space indent) at the end of that step's run block.
ins_end() {
  STEP="$1" LINE="          $2" awk '
    BEGIN { t = "      - name: " ENVIRON["STEP"] }
    $0 == t { inside = 1; print; next }
    inside && ($0 == "" || $0 ~ /^      #/ || $0 ~ /^      - /) { print ENVIRON["LINE"]; inside = 0 }
    { print }' "$cur" > "$W/next" && apply
}
# ins_after <trimmed anchor> <line>: after the first line whose trimmed text equals the anchor, with the anchor's indent.
ins_after() {
  ANCHOR="$1" LINE="$2" awk '
    { print; t = $0; sub(/^[[:space:]]+/, "", t); sub(/[[:space:]]+$/, "", t)
      if (!d && t == ENVIRON["ANCHOR"]) { ind = $0; sub(/[^[:space:]].*$/, "", ind); print ind ENVIRON["LINE"]; d = 1 } }' "$cur" > "$W/next" && apply
}
# repl <trimmed old> <new>: replace the first matching line, keeping its indent.
repl() {
  OLD="$1" NEW="$2" awk '
    { t = $0; sub(/^[[:space:]]+/, "", t); sub(/[[:space:]]+$/, "", t)
      if (!d && t == ENVIRON["OLD"]) { ind = $0; sub(/[^[:space:]].*$/, "", ind); print ind ENVIRON["NEW"]; d = 1 } else print }' "$cur" > "$W/next" && apply
}
# del <trimmed> [count]: delete the first matching line and the count-1 lines after it.
del() {
  OLD="$1" CNT="${2:-1}" awk '
    { t = $0; sub(/^[[:space:]]+/, "", t); sub(/[[:space:]]+$/, "", t)
      if (!d && t == ENVIRON["OLD"]) { d = 1; skip = ENVIRON["CNT"] }
      if (skip > 0) { skip--; next } print }' "$cur" > "$W/next" && apply
}
check_rc() { # <want> <id> <rc> <out-file>
  local want="$1" id="$2" rc="$3" out="$4"
  if [ "$rc" -ne "$want" ]; then
    echo "FAILED $id: exit $rc, wanted $want"; sed 's/^/    /' "$out" | head -n 8
    failures=$((failures + 1))
  elif tr '\r' '\n' < "$out" | sed 's/^[[:space:]]*//' | grep '^::' \
       | grep -vE '^::stop-commands::stk[0-9a-f]+$|^::stk[0-9a-f]+::$' | grep -q .; then
    echo "FAILED $id: output has a workflow command line (only the stop-commands pair is allowed)"
    failures=$((failures + 1))
  else
    echo "ok $id"
  fi
}
# expect <want-rc> <id>: run the checker on the mutated copy.
expect() {
  if [ "$2" != B0-unchanged-draft ] && cmp -s "$DRAFT" "$cur"; then
    echo "FAILED $2: the mutation did not change the workflow"; failures=$((failures + 1)); return
  fi
  bash "$CHK" "$cur" > "$W/out" 2>&1
  check_rc "$1" "$2" "$?" "$W/out"
}

fresh; expect 0 B0-unchanged-draft
bash "$CHK" > /dev/null 2>&1; [ "$?" -eq 2 ] && echo "ok U1-no-argument-exit-2" || { echo "FAILED U1"; failures=$((failures + 1)); }
bash "$CHK" "$W/missing.yml" > /dev/null 2>&1; [ "$?" -eq 2 ] && echo "ok U2-missing-file-exit-2" || { echo "FAILED U2"; failures=$((failures + 1)); }
mkdir -p "$W/s/.github/workflows"; ln -s "$DRAFT" "$W/s/.github/workflows/deploy-stoktok.yml"
bash "$CHK" "$W/s/.github/workflows/deploy-stoktok.yml" > /dev/null 2>&1; [ "$?" -eq 2 ] && echo "ok U3-symlink-exit-2" || { echo "FAILED U3"; failures=$((failures + 1)); }

# docker inspect -f formats that dump the environment
fresh; ins_end deploy "docker inspect -f ${q}{{json .Config.Env}}${q} x"; expect 1 M1-inspect-Config.Env
fresh; ins_end deploy "docker inspect -f ${q}{{json .}}${q} x"; expect 1 M2-inspect-json-dot
fresh; ins_end deploy "docker inspect --format ${q}{{.}}${q} x"; expect 1 M3-inspect-dot
fresh; ins_end deploy "docker container inspect -f ${q}{{json .Config}}${q} x"; expect 1 M4-inspect-Config

# dumps of the shell, variables, the env file, the temp file, the password file, secrets/
fresh; ins_end secrets 'set | grep DATABASE'; expect 1 M5-set-piped
fresh; ins_end secrets 'set > "$GITHUB_STEP_SUMMARY"'; expect 1 M6-set-redirected
fresh; ins_end secrets '{ set; }'; expect 1 M7-set-in-group
fresh; ins_end secrets '( set -o posix; set )'; expect 1 M8-set-in-subshell
fresh; ins_end secrets 'for v in $(compgen -v); do echo "${!v}"; done'; expect 1 M9-compgen-indirect
fresh; ins_end secrets 'echo "$(<"$pwfile")"'; expect 1 M10-command-substitution-file
fresh; ins_end secrets '< "$ENV_FILE" cat'; expect 1 M11-redirect-before-command
fresh; ins_end secrets 'grep . "$ENV_FILE"'; expect 1 M12-grep
fresh; ins_end secrets 'sed -n p "$ENV_FILE"'; expect 1 M13-sed
fresh; ins_end secrets 'awk 1 "$tmp"'; expect 1 M14-awk-tmp
fresh; ins_end secrets 'base64 "$ENV_FILE"'; expect 1 M15-base64
fresh; ins_end secrets 'tac "$tmp"'; expect 1 M16-tac
fresh; ins_end deploy 'cp "$ENV_FILE" "$RUNNER_TEMP/x"'; expect 1 M17-cp
fresh; ins_end secrets 'dd if="$ENV_FILE"'; expect 1 M18-dd
fresh; ins_end secrets 'while IFS= read -r l; do echo "$l"; done < "$ENV_FILE"'; expect 1 M19-while-read
fresh; ins_end secrets 'grep . "$pwfile"'; expect 1 M20-pwfile
fresh; ins_end deploy 'cp postgres/secrets/apps/stoktok.password "$RUNNER_TEMP/p"'; expect 1 M21-secrets-dir
fresh; ins_end pull '"${compose[@]}" convert'; expect 1 M22-compose-convert
fresh; ins_end deploy '"${compose[@]}" exec -T stoktok-web env'; expect 1 M23-compose-exec-env
fresh; ins_end deploy '"${compose[@]}" run --rm stoktok-web env'; expect 1 M24-compose-run-env
fresh; ins_end deploy "tr ${q}\\0${q} ${q}\\n${q} < /proc/1/environ"; expect 1 M25-proc-environ
fresh; ins_after 'id: deploy' 'shell: bash -x {0}'; expect 1 M26-shell-bash-x
fresh; ins_end deploy 'set -o  xtrace'; expect 1 M27-xtrace-extra-space

# one temp file, chmod, ENV_FILE confinement
fresh; ins_after "trap ${q}rm -f \"\$tmp\"${q} EXIT" 'tmp="$(mktemp)"'; expect 1 M28-second-tmp-and-mktemp
fresh; ins_end secrets 'x="$(mktemp)"'; expect 1 M29-second-mktemp
fresh; ins_end secrets 'chmod 644 "$ENV_FILE"'; expect 1 M30-chmod-env-file-in-step
fresh; ins_end deploy 'chmod 644 "$ENV_FILE"'; expect 1 M31-chmod-env-file-outside
fresh; ins_end deploy 'ln "$ENV_FILE" "$RUNNER_TEMP/e"'; expect 1 M32-env-file-outside-known-lines
fresh; ins_after 'STOKTOK_AI_KEYS_MASTER_KEY: ${{ secrets.STOKTOK_AI_KEYS_MASTER_KEY }}' 'ENV_FILE: /tmp/stoktok.env'; expect 1 M33-step-level-ENV_FILE
fresh; ins_end envdir 'echo "ENV_FILE=/tmp/x" >> "$GITHUB_ENV"'; expect 1 M34-ENV_FILE-via-GITHUB_ENV

# fail-closed migrate detection
SVC='services="$("${compose[@]}" --profile migrate config --services)"'
GUARD_IF="if ! printf ${q}%s\\n${q} \"\$services\" | grep -qx stoktok-web; then"
MIG_IF="if printf ${q}%s\\n${q} \"\$services\" | grep -qx migrate; then"
fresh; del "$SVC"; del "$GUARD_IF" 4
repl "$MIG_IF" 'if "${compose[@]}" --profile migrate config --services | grep -qx migrate; then'; expect 1 M35-old-fail-open-shape
fresh; repl "$SVC" 'services="$("${compose[@]}" --profile migrate config --services || true)"'; expect 1 M36-swallowed-config-error
fresh; del "$GUARD_IF" 4; expect 1 M37-stoktok-web-guard-deleted

# stale temp-file cleanup
RM='rm -f "$dir"/.stoktok.env.??????'
fresh; del "$RM"; expect 1 M38-stale-cleanup-deleted
fresh; del "$RM"; ins_after 'tmp="$(mktemp "$dir/.stoktok.env.XXXXXX")"' "$RM"; expect 1 M39-stale-cleanup-after-mktemp

# the moved checks still fail
fresh; del 'umask 077'; expect 1 R1-no-umask
fresh; repl 'tmp="$(mktemp "$dir/.stoktok.env.XXXXXX")"' 'tmp="$(mktemp)"'; expect 1 R2-bare-mktemp
fresh; ins_after 'on:' '  pull_request_target:'; expect 1 R3-pull_request_target
fresh; ins_end deploy 'set'; expect 1 R4-bare-set
fresh; ins_end deploy 'declare -p'; expect 1 R5-declare-p
fresh; ins_end deploy 'cat "$ENV_FILE"'; expect 1 R6-cat-env-file
fresh; ins_end deploy 'docker inspect stoktok-web'; expect 1 R7-inspect-without-format
fresh; ins_end secrets "printf ${q}x=%s\\n${q} \"\$SUPABASE_URL\" > \"\$tmp\""; expect 1 R8-second-printf
fresh; del 'if ! [[ "$SUPABASE_URL" =~ ^https://[A-Za-z0-9.-]+$ ]]; then'; expect 1 R9-key-guard-deleted

# negative controls
fresh; ins_end deploy 'cat "$APP_DIR/release.env"'; expect 0 C1-release.env-not-flagged
fresh; ins_end deploy "docker inspect -f ${q}{{.State.Health.Status}}${q} x"; expect 0 C2-safe-inspect-format
fresh; ins_end deploy 'set -euo pipefail'; expect 0 C3-set-with-options

# output: workflow text is never printed at the start of a line
fresh; ins_end secrets 'echo "::warning::x"; set'; expect 1 P1-no-line-starts-with-colons

# CR / Unicode line breaks: rejected up front (they hide lines from grep but not from YAML or bash), nothing printed from the file
fresh; ins_end deploy 'run: "true\nset"'; expect 1 M44-quoted-run
fresh; ins_end deploy 'run: true'; expect 1 M45-plain-oneline-run
fresh; ins_end deploy "$(printf 'echo hi\r          set')"; expect 1 M40-cr-hides-bare-set
fresh; ins_end deploy "$(printf 'set | true\r::error::x')"; expect 1 P2-cr-forged-command
fresh; ins_end deploy "$(printf 'echo hi\302\205          set')"; expect 1 M41-nel
fresh; ins_end deploy "$(printf 'echo hi\342\200\250          set')"; expect 1 M42-u2028
fresh; ins_end deploy "$(printf 'echo hi\342\200\251          set')"; expect 1 M43-u2029
fresh; ins_end deploy "$(printf 'set | true\r::error::x')"; bash "$CHK" "$cur" > "$W/out" 2>&1
if grep -q 'error::x' "$W/out"; then echo "FAILED P3: the rejected line was printed"; failures=$((failures + 1)); else echo "ok P3-nothing-printed-from-the-file"; fi

# the stoktok-guards.yml pins (run through scripts/check-deploy-env.sh; needs GNU grep, so not in the macOS job)
if [ "${STK097_SKIP_CROSSFILE:-0}" != 1 ]; then
  gcur="$W/g.yml"
  gcase() { # <want> <id>
    STK097_GUARDS_WF="$gcur" bash "$ROOT/scripts/check-deploy-env.sh" > "$W/out" 2>&1
    check_rc "$1" "$2" "$?" "$W/out"
  }
  cur="$gcur"
  cp "$GUARDS" "$cur"; gcase 0 G0-unchanged-guards
  cp "$GUARDS" "$cur"; repl 'contents: read' 'contents: write'; gcase 1 G1-contents-write
  cp "$GUARDS" "$cur"; del 'persist-credentials: false'; gcase 1 G2-persist-credentials-removed
  cp "$GUARDS" "$cur"; ins_after 'path: pr' 'X: ${{ secrets.X }}'; gcase 1 G3-secret-added
  cp "$GUARDS" "$cur"; printf '      - name: x\n        run: bash pr/x.sh\n' >> "$cur"; gcase 1 G4-extra-run
  cp "$GUARDS" "$cur"; ins_after 'persist-credentials: false' 'ref: ${{ github.event.pull_request.head.sha }}'; gcase 1 G5-second-ref
  cp "$GUARDS" "$cur"; ins_after 'timeout-minutes: 5' 'permissions: { contents: write }'; gcase 1 G6-job-permissions
  cp "$GUARDS" "$cur"; ins_after 'timeout-minutes: 5' 'env: { GH_TOKEN: "${{ github.token }}" }'; gcase 1 G7-job-env-token
  cp "$GUARDS" "$cur"; del 'sparse-checkout: .github/workflows/deploy-stoktok.yml' 2; gcase 1 G8-sparse-checkout-removed
  cp "$GUARDS" "$cur"; del 'HEAD_SHA: ${{ github.event.pull_request.head.sha }}'; gcase 1 G9-head-sha-env-removed
  cp "$GUARDS" "$cur"; del 'git -C pr cat-file -p HEAD | grep -qxF "parent $HEAD_SHA" || { echo "merge ref is not current for head $HEAD_SHA; re-run" >&2; exit 1; }'; gcase 1 G10-parent-check-removed
  cp "$GUARDS" "$cur"; ins_after 'persist-credentials: false' '"ref": ${{ github.event.pull_request.head.sha }}'; gcase 1 G11-quoted-ref
  cp "$GUARDS" "$cur"; ins_after 'path: pr' "X: \${{ github['token'] }}"; gcase 1 G12-github-token-bracket
  cp "$GUARDS" "$cur"; ins_after 'timeout-minutes: 5' 'continue-on-error: true'; gcase 1 G13-continue-on-error
  cp "$GUARDS" "$cur"; ins_after 'path: pr' "if: always()"; gcase 1 G14-if
  cp "$GUARDS" "$cur"; ins_after 'timeout-minutes: 5' 'defaults: { run: { shell: sh } }'; gcase 1 G15-shell
  cp "$GUARDS" "$cur"; ins_after 'path: pr' 'working-directory: pr'; gcase 1 G16-working-directory
  cp "$GUARDS" "$cur"; ins_after 'path: pr' 'repository: someone/else'; gcase 1 G17-repository
  cur="$W/c/.github/workflows/deploy-stoktok.yml"
fi

# the `pull` step against a docker shim: B1 expand (no migrate), B2 cutover, B3 config error, B4 garbage, B5 no -e
awk '
  $0 == "      - name: pull" { s = 1; next }
  s && /^      - name: backup/ { exit }
  s && /^        run: \|/ { r = 1; next }
  r && ($0 == "" || $0 ~ /^      #/) { exit }
  r { sub(/^          /, ""); print }' "$DRAFT" > "$W/pull.sh"
cat > "$W/bin/docker" <<'SHIM'
#!/bin/sh
case " $* " in
  *" config --services "*)
    [ -n "${SHIM_SERVICES:-}" ] && printf '%s\n' "$SHIM_SERVICES"
    exit "${SHIM_RC:-0}" ;;
esac
exit 0
SHIM
chmod 755 "$W/bin/docker"
run_pull() { # <services> <rc> [bash flags...]
  local svc="$1" rc="$2"; shift 2
  : > "$W/gho"
  env PATH="$W/bin:$PATH" APP_DIR=x PROJECT=p GITHUB_OUTPUT="$W/gho" SHIM_SERVICES="$svc" SHIM_RC="$rc" \
    bash --noprofile --norc "$@" "$W/pull.sh" > "$W/out" 2>&1
}
pull_case() { # <id> <step rc was zero? 0|1> <expected GITHUB_OUTPUT line or ->
  local id="$1" wantzero="$2" line="$3" rc="$4"
  if { [ "$wantzero" = 0 ] && [ "$rc" -ne 0 ]; } || { [ "$wantzero" = 1 ] && [ "$rc" -eq 0 ]; }; then
    echo "FAILED $id: step exit $rc"; failures=$((failures + 1)); return
  fi
  if [ "$line" = - ]; then
    if grep -q '^migrate=' "$W/gho"; then echo "FAILED $id: wrote a migrate= output"; failures=$((failures + 1)); return; fi
  elif ! grep -qx "$line" "$W/gho"; then
    echo "FAILED $id: no $line output"; failures=$((failures + 1)); return
  fi
  echo "ok $id"
}
run_pull "$(printf 'stoktok-web\nstoktok-worker')" 0 -e; pull_case B1-expand-no-migrate 0 migrate=false "$?"
run_pull "$(printf 'stoktok-web\nstoktok-worker\nmigrate')" 0 -e; pull_case B2-cutover-migrate 0 migrate=true "$?"
run_pull "" 1 -e; pull_case B3-config-error-fails-closed 1 - "$?"
run_pull "" 0 -e; pull_case B4-empty-list-fails 1 - "$?"
run_pull "" 1; pull_case B5-config-error-without-e 1 - "$?"

if [ "$failures" -ne 0 ]; then
  echo "FAIL: $failures deploy-guard case(s) failed" >&2
  exit 1
fi
echo "OK: deploy guard mutation proofs"
