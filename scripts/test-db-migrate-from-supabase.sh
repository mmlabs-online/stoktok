#!/usr/bin/env bash
# STK-091: test harness for scripts/db-migrate-from-supabase.sh. Runs it against two databases on a THROWAWAY local Postgres
# (the "source" stands in for Supabase). Needs docker (the script drives pg clients in containers) and MOVE_TEST_URL, e.g.
#   MOVE_TEST_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm test:move
# localhost only. Creates roles and databases named stoktok_mv*/stoktok_scratch_mv* and drops them on exit; refuses if they exist.
# Optional: pass test names (t_static t_usage_guards ...) to run only those; later tests depend on earlier ones.
set -euo pipefail
unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGDATABASE PGUSER PGOPTIONS PGPASSWORD PGPASSFILE PGSSLMODE

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/db-migrate-from-supabase.sh"
HARNESS="$ROOT/scripts/test-db-migrate-from-supabase.sh"
FIXTURE="$ROOT/scripts/test-fixtures/move-source-data.sql"
BASELINE="$(ls "$ROOT"/db/migrations/*_baseline.sql)"

if [ -z "${MOVE_TEST_URL:-}" ]; then echo "test:move: set MOVE_TEST_URL (superuser URL of a throwaway local Postgres)" >&2; exit 1; fi
url_re='^postgres(ql)?://([^@/?]*@)?(localhost|127\.0\.0\.1)(:[0-9]+)?(/[^?@]*)?(\?[^@]*)?$'
[[ "$MOVE_TEST_URL" =~ $url_re ]] || { echo "test:move refuses MOVE_TEST_URL: host must be localhost or 127.0.0.1" >&2; exit 1; }
HOST="${BASH_REMATCH[3]}"
PORT="${BASH_REMATCH[4]#:}"; PORT="${PORT:-5432}"
[[ "${BASH_REMATCH[6]}" != *%* ]] || { echo "test:move refuses MOVE_TEST_URL: no % in the query" >&2; exit 1; }

REAL_DOCKER="$(command -v docker || true)"
[ -n "$REAL_DOCKER" ] || { echo "test:move: docker not found" >&2; exit 1; }

TMP="$(mktemp -d)"
SRC_DB="stoktok_mvsrc_$$"; SRC_ROLE="stoktok_mvsrc_$$"
DRIFT_DB="stoktok_mvdrift_$$"
DST_DB="stoktok_scratch_mv$$"; DST_ROLE="stoktok_mvdst_$$"
DST2_DB="stoktok_scratch_mvd$$"
DST3_DB="stoktok_scratch_mvu$$"
FREEZE_PROJECT="stoktok_mvtest_$$"
FREEZE_CT="stoktok_mvfreeze_$$"
SRC_PW="SENTINELsrc$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"
DST_PW="SENTINELdst$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"
WORK="$TMP/work"; mkdir -m 700 "$WORK"
mkdir -m 700 "$TMP/sd" "$TMP/shim"
LOCK="$TMP/lock"
OUT="$TMP/out"
LOG="$TMP/docker.log"
: > "$LOG"
printf '%s\n' "$DST_PW" > "$TMP/dstpw"; chmod 600 "$TMP/dstpw"
FAILS=0; RC=0; XENV=""

su_url() { printf '%s' "$MOVE_TEST_URL" | sed -E "s#^([a-z]+://[^/?]*)(/[^?]*)?#\\1/$1#"; }
su_psql() { psql "$(su_url postgres)" -X -q -v ON_ERROR_STOP=1 "$@"; }
su_db() { local db="$1"; shift; psql "$(su_url "$db")" -X -q -v ON_ERROR_STOP=1 "$@"; }
role_psql() { local role="$1" pw="$2" db="$3"; shift 3; PGPASSWORD="$pw" PGTZ=UTC psql -h "$HOST" -p "$PORT" -U "$role" -d "$db" -X -q -At -v ON_ERROR_STOP=1 "$@"; }

cleanup() {
  local rc=$?
  trap - EXIT
  "$REAL_DOCKER" rm -f "$FREEZE_CT" >/dev/null 2>&1 || true
  for d in "$SRC_DB" "$DRIFT_DB" "$DST_DB" "$DST2_DB" "$DST3_DB"; do
    su_psql -c "drop database if exists \"$d\" with (force)" >/dev/null 2>&1 || echo "test:move: WARNING could not drop database $d" >&2
  done
  for r in "$SRC_ROLE" "$DST_ROLE"; do
    su_psql -c "drop role if exists \"$r\"" >/dev/null 2>&1 || echo "test:move: WARNING could not drop role $r" >&2
  done
  rm -rf "$TMP"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ---- setup ----
existing="$(su_psql -At -c "select (select count(*) from pg_database where datname in ('$SRC_DB','$DRIFT_DB','$DST_DB','$DST2_DB','$DST3_DB')) + (select count(*) from pg_roles where rolname in ('$SRC_ROLE','$DST_ROLE'))")"
[ "$existing" = 0 ] || { echo "test:move refuses: its own role or database names already exist" >&2; exit 1; }

su_psql -c "create role \"$SRC_ROLE\" login password '$SRC_PW'" -c "create role \"$DST_ROLE\" login password '$DST_PW'"
for d in "$SRC_DB" "$DRIFT_DB"; do su_psql -c "create database \"$d\" owner \"$SRC_ROLE\""; done
for d in "$DST_DB" "$DST2_DB" "$DST3_DB"; do su_psql -c "create database \"$d\" owner \"$DST_ROLE\""; done
role_psql "$SRC_ROLE" "$SRC_PW" "$SRC_DB" --single-transaction -f "$BASELINE" >/dev/null
role_psql "$SRC_ROLE" "$SRC_PW" "$SRC_DB" --single-transaction -f "$FIXTURE" >/dev/null
role_psql "$SRC_ROLE" "$SRC_PW" "$DRIFT_DB" --single-transaction -f "$BASELINE" >/dev/null
role_psql "$SRC_ROLE" "$SRC_PW" "$DRIFT_DB" -c "alter table public.watchlist add column note text" >/dev/null

migrate_db() { # database name: run the worker migrate runner (same code as the image) with the URL in env only
  ( cd "$ROOT" && STOKTOK_DATABASE_URL="postgres://$DST_ROLE:$DST_PW@$HOST:$PORT/$1" pnpm --filter @stoktok/worker job migrate >/dev/null )
}
migrate_db "$DST_DB"
migrate_db "$DST2_DB"
su_psql -c "alter database \"$SRC_DB\" set default_transaction_read_only = on" -c "alter database \"$DRIFT_DB\" set default_transaction_read_only = on"

# docker shim: logs argv, then runs the real docker
cat > "$TMP/shim/docker" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$LOG"
exec "$REAL_DOCKER" "\$@"
EOF
chmod 755 "$TMP/shim/docker"
export PATH="$TMP/shim:$PATH"
export TMPDIR="$TMP/sd"

export PG_CLIENT_IMAGE=postgres:17 MOVE_SRC_NETWORK=host MOVE_DST_NETWORK=host
export MOVE_SRC_HOST="$HOST" MOVE_SRC_PORT="$PORT" MOVE_SRC_SSLMODE=disable MOVE_SRC_USER="$SRC_ROLE" MOVE_SRC_DB="$SRC_DB" MOVE_SRC_PGPASSWORD="$SRC_PW"
export MOVE_DST_HOST="$HOST" MOVE_DST_PORT="$PORT" MOVE_DST_USER="$DST_ROLE" MOVE_DST_PWFILE="$TMP/dstpw"
export MOVE_JOB_LOCK="$LOCK" MOVE_FREEZE_PROJECT="$FREEZE_PROJECT"

# ---- helpers ----
run_move() { set +e; env $XENV bash "$SCRIPT" --work-dir "$WORK" "$@" > "$OUT" 2>&1; RC=$?; set -e; XENV=""; }
assert() {
  local msg="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "  ok: $msg"; else echo "  FAIL: $msg"; FAILS=$((FAILS + 1)); [ ! -s "$OUT" ] || sed 's/^/    | /' "$OUT" | tail -25; fi
}
rc_is() { [ "$RC" = "$1" ]; }
out_has() { grep -qF -- "$1" "$OUT"; }
out_lacks() { ! grep -qF -- "$1" "$OUT"; }
no_dump() { [ -z "$(find "$WORK" -maxdepth 1 -name '*.dump')" ]; }
dir_empty() { [ -z "$(ls -A "$1")" ]; }
same() { [ "$1" = "$2" ]; }
assert_no_leak() {
  assert "no password sentinel in output" out_lacks SENTINEL
  assert "no password sentinel in docker argv" bash -c "! grep -qF SENTINEL '$LOG'"
  assert "no password sentinel in the work dir" bash -c "! grep -rqF SENTINEL '$WORK'"
  assert "pgpass dir removed" dir_empty "$TMP/sd"
}

# Per-table count and ordered md5 on a database, computed independently of the script.
oracle() { # db role pw
  local t
  for t in $(role_psql "$2" "$3" "$1" -c "select tablename from pg_tables where schemaname = 'public' and tablename not in ('schema_migrations','ai_keys') order by 1"); do
    printf '%s|%s\n' "$t" "$(role_psql "$2" "$3" "$1" -c "select count(*) || '|' || md5(coalesce(string_agg(x::text, chr(10) order by x::text collate \"C\"), '')) from public.$t x")"
  done
}
seqs() { role_psql "$2" "$3" "$1" -c "select sequencename || '|' || coalesce(last_value::text, 'null') from pg_sequences where schemaname = 'public' order by 1"; }
src_fingerprint() { oracle "$SRC_DB" "$SRC_ROLE" "$SRC_PW"; seqs "$SRC_DB" "$SRC_ROLE" "$SRC_PW"; }
dst_oracle() { oracle "$DST_DB" "$DST_ROLE" "$DST_PW"; }
dst_rows() { # total rows over all public tables of a database, superuser
  local t sum=0 n
  for t in $(su_db "$1" -At -c "select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'"); do
    n="$(su_db "$1" -At -c "select count(*) from public.$t")"; sum=$((sum + n))
  done
  echo "$sum"
}

# ---- tests ----
t_usage_guards() {
  echo "t_usage_guards"
  : > "$LOG"
  local t
  for t in postgres stoktok_other Stoktok 'stoktok;x'; do
    run_move --target "$t" --skip-migrate
    assert "target '$t' refused (exit 2)" rc_is 2
  done
  run_move --target stoktok --dry-run --skip-migrate; assert "--dry-run --target stoktok refused (exit 2)" rc_is 2
  run_move --target "$DST_DB" --skip-migrate --bogus; assert "unknown flag (exit 2)" rc_is 2
  run_move --target "$DST_DB" --skip-migrate --force; assert "--force without --confirm (exit 2)" rc_is 2
  XENV="MOVE_SRC_SSLMODE=disable MOVE_SRC_HOST=db.example.invalid"
  run_move --target "$DST_DB" --skip-migrate; assert "sslmode disable with a remote source (exit 2)" rc_is 2
  printf '%s\n' 'shortpwXYZ' > "$TMP/badpwfile"
  XENV="MOVE_DST_PWFILE=$TMP/badpwfile"
  run_move --target "$DST_DB" --skip-migrate
  assert "malformed password file (exit 1)" rc_is 1
  assert "the file is named" out_has "$TMP/badpwfile"
  assert "its content is not printed" out_lacks shortpwXYZ
  assert "no docker call for any guard" bash -c "[ ! -s '$LOG' ]"
}

t_static() {
  echo "t_static"
  local pat f
  pat='map''file|read''array|declare -''A|\$\{[A-Za-z_]+(,,|\^\^)\}|\|''&|&''>>|;;''&|local -''n|co''proc|sed -''i|sed -''z|grep -''P|readlink -''f|date -''d|set -''x'
  for f in "$SCRIPT" "$HARNESS"; do
    assert "no bash 4 / GNU-only constructs in $(basename "$f")" bash -c "! grep -v '^  pat=' '$f' | grep -nE '$pat'"
    assert "bash 3.2 syntax check of $(basename "$f")" "$REAL_DOCKER" run --rm -v "$ROOT/scripts:/s:ro" bash:3.2 bash -n "/s/$(basename "$f")"
  done
}

t_schema_migrations_mismatch() {
  echo "t_schema_migrations_mismatch"
  run_move --target "$DST3_DB" --skip-migrate --dry-run
  assert "unmigrated target refused (exit 1)" rc_is 1
  assert "names schema_migrations" out_has schema_migrations
  local sum
  sum="$(su_db "$DST_DB" -At -c "select checksum from public.schema_migrations limit 1")"
  su_db "$DST_DB" -c "update public.schema_migrations set checksum = '00'" >/dev/null
  run_move --target "$DST_DB" --skip-migrate --dry-run
  assert "changed checksum refused (exit 1)" rc_is 1
  assert "no dump created" no_dump
  su_db "$DST_DB" -c "update public.schema_migrations set checksum = '$sum'" >/dev/null
}

t_dry_run_happy() {
  echo "t_dry_run_happy"
  mkdir "$LOCK"
  local before after
  before="$(src_fingerprint)"
  run_move --target "$DST_DB" --skip-migrate --dry-run
  assert "exit 0" rc_is 0
  assert "prints current_database" out_has current_database
  assert "prints current_user" out_has current_user
  assert "prints server_version_num" out_has server_version_num
  assert "schema check clean" out_has "schema check: no unexpected differences"
  assert "news sequence bumped" out_has "bumped public.news_id_seq"
  assert "dry run with a lock dir only warns" out_has WARNING
  assert "dry run OK verdict" out_has "dry run OK"
  assert "every moved table equals the source (independent oracle)" same "$(oracle "$SRC_DB" "$SRC_ROLE" "$SRC_PW")" "$(dst_oracle)"
  assert "the oracle covers 17 tables" same 17 "$(dst_oracle | wc -l | tr -d ' ')"
  assert "source ai_keys has 1 row" same 1 "$(role_psql "$SRC_ROLE" "$SRC_PW" "$SRC_DB" -c 'select count(*) from public.ai_keys')"
  assert "target ai_keys has 0 rows" same 0 "$(role_psql "$DST_ROLE" "$DST_PW" "$DST_DB" -c 'select count(*) from public.ai_keys')"
  local dst_seq src_seq
  src_seq="$(seqs "$SRC_DB" "$SRC_ROLE" "$SRC_PW")"; dst_seq="$(seqs "$DST_DB" "$DST_ROLE" "$DST_PW")"
  assert "data_gaps sequence equals the source and is above max(id)" bash -c "[ \"\$(printf '%s\n' '$dst_seq' | grep '^data_gaps_id_seq|')\" = \"\$(printf '%s\n' '$src_seq' | grep '^data_gaps_id_seq|')\" ]"
  assert "news sequence is at least 100" [ "$(role_psql "$DST_ROLE" "$DST_PW" "$DST_DB" -c "select last_value from pg_sequences where sequencename = 'news_id_seq'")" -ge 100 ]
  assert "signals sequence still uncalled" bash -c "printf '%s\n' '$dst_seq' | grep -qx 'signals_id_seq|null'"
  after="$(src_fingerprint)"
  assert "source fingerprint unchanged" same "$before" "$after"
  assert "no dump left in the work dir" no_dump
  assert "work dir mode 700" bash -c "[ -n \"\$(find '$WORK' -maxdepth 0 -perm 700)\" ]"
  assert_no_leak
  rmdir "$LOCK"
}

t_verify_only() {
  echo "t_verify_only"
  run_move --target "$DST_DB" --verify-only; assert "unchanged target verifies (exit 0)" rc_is 0
  su_db "$DST_DB" -c "update public.watchlist set group_name = 'changed' where symbol = 'HPG'" >/dev/null
  run_move --target "$DST_DB" --verify-only
  assert "a changed row fails (exit 1)" rc_is 1
  assert "names watchlist" out_has watchlist
  su_db "$DST_DB" -c "update public.watchlist set group_name = 'watching' where symbol = 'HPG'" >/dev/null
  run_move --target "$DST_DB" --verify-only; assert "reverted target verifies again" rc_is 0
}

t_refuse_non_empty() {
  echo "t_refuse_non_empty"
  local before
  before="$(dst_oracle)"
  run_move --target "$DST_DB" --skip-migrate
  assert "non-empty target refused (exit 1)" rc_is 1
  assert "says it is not empty" out_has "not empty"
  assert "target unchanged" same "$before" "$(dst_oracle)"
  assert "no dump created" no_dump
}

t_force() {
  echo "t_force"
  local sm
  sm="$(su_db "$DST_DB" -At -c "select * from public.schema_migrations order by version")"
  run_move --target "$DST_DB" --skip-migrate --force --confirm wrongname; assert "wrong --confirm (exit 2)" rc_is 2
  run_move --target "$DST_DB" --skip-migrate --force --confirm "$DST_DB"
  assert "forced move (exit 0)" rc_is 0
  assert "move OK" out_has "move OK"
  assert "target equals the source again" same "$(oracle "$SRC_DB" "$SRC_ROLE" "$SRC_PW")" "$(dst_oracle)"
  assert "schema_migrations unchanged" same "$sm" "$(su_db "$DST_DB" -At -c "select * from public.schema_migrations order by version")"
  assert "the dump is kept in a real run" bash -c "! [ -z \"\$(find '$WORK' -maxdepth 1 -name '*.dump')\" ]"
  rm -f "$WORK"/*.dump
}

t_freeze() {
  echo "t_freeze"
  mkdir "$LOCK"
  run_move --target "$DST_DB" --skip-migrate
  assert "lock dir blocks a real run (exit 1)" rc_is 1
  assert "names the freeze" out_has freeze
  assert "no dump created" no_dump
  rmdir "$LOCK"
  "$REAL_DOCKER" run -d --rm --name "$FREEZE_CT" --label "com.docker.compose.project=$FREEZE_PROJECT" postgres:17 sleep 120 >/dev/null
  run_move --target "$DST_DB" --skip-migrate
  assert "a running project container blocks a real run (exit 1)" rc_is 1
  assert "no dump created (container)" no_dump
  "$REAL_DOCKER" rm -f "$FREEZE_CT" >/dev/null
}

t_schema_drift() {
  echo "t_schema_drift"
  XENV="MOVE_SRC_DB=$DRIFT_DB"
  run_move --target "$DST2_DB" --skip-migrate --dry-run
  assert "dry run with drift fails (exit 1)" rc_is 1
  assert "the diff names watchlist" out_has watchlist
  assert "target still empty" same 0 "$(dst_rows "$DST2_DB")"
  assert_no_leak
  XENV="MOVE_SRC_DB=$DRIFT_DB"
  run_move --target "$DST2_DB" --skip-migrate
  assert "real run without --schema-check fails at restore (exit 1)" rc_is 1
  assert "target still empty after the failed restore" same 0 "$(dst_rows "$DST2_DB")"
  assert_no_leak
  rm -f "$WORK"/*.dump
}

ALL="t_usage_guards t_static t_schema_migrations_mismatch t_dry_run_happy t_verify_only t_refuse_non_empty t_force t_freeze t_schema_drift"
for t in ${*:-$ALL}; do "$t"; done

if [ "$FAILS" -ne 0 ]; then echo "test:move: $FAILS assertion(s) FAILED" >&2; exit 1; fi
echo "test:move OK"
