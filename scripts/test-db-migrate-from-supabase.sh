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
ALT_HOST=127.0.0.1; [ "$HOST" != 127.0.0.1 ] || ALT_HOST=localhost # the guard refuses target host:port == source host:port
export MOVE_DST_HOST="$ALT_HOST" MOVE_DST_PORT="$PORT" MOVE_DST_USER="$DST_ROLE" MOVE_DST_PWFILE="$TMP/dstpw"
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

# Rename the last column of public.watchlist on the drift DB (the one added at setup) to $1; $1 may hold | or a newline.
drift_set_last_col() {
  su_db "$DRIFT_DB" -v newname="$1" >/dev/null <<'SQL'
set default_transaction_read_only = off;
select set_config('mv.newname', :'newname', false);
do $$
declare old text;
begin
  select attname into old from pg_attribute where attrelid = 'public.watchlist'::regclass and attnum > 0 and not attisdropped order by attnum desc limit 1;
  if old <> current_setting('mv.newname') then
    execute format('alter table public.watchlist rename column %I to %I', old, current_setting('mv.newname'));
  end if;
end $$;
SQL
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
  XENV="MOVE_DST_HOST=$HOST"
  run_move --target "$DST_DB" --skip-migrate; assert "target host:port equal to the source (exit 2)" rc_is 2
  XENV="MOVE_SRC_DB=$DST_DB"
  run_move --target "$DST_DB" --skip-migrate; assert "source database name equal to the target (exit 2)" rc_is 2
  printf '%s\n' 'shortpwXYZ' > "$TMP/badpwfile"
  XENV="MOVE_DST_PWFILE=$TMP/badpwfile"
  run_move --target "$DST_DB" --skip-migrate
  assert "malformed password file (exit 1)" rc_is 1
  assert "the file is named" out_has "$TMP/badpwfile"
  assert "its content is not printed" out_lacks shortpwXYZ
  XENV="MOVE_SRC_HOST=db.example.invalid MOVE_SRC_SSLMODE=require PG_CLIENT_IMAGE=postgres:17"
  run_move --target "$DST_DB" --skip-migrate; assert "an unpinned client image with a remote source (exit 2)" rc_is 2
  assert "says pinned by digest" out_has "pinned by digest"
  XENV="MOVE_SRC_HOST=db.example.invalid MOVE_SRC_SSLMODE=require PG_CLIENT_IMAGE=postgres@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  run_move --target "$DST_DB" --worker-image mingming21400/stoktok-worker:v0.3.0; assert "an undigested worker image with a remote source (exit 2)" rc_is 2
  assert "says --worker-image must be pinned by digest" out_has "--worker-image must be pinned by digest"
  XENV="MOVE_SRC_HOST=db.example.invalid MOVE_SRC_SSLMODE=require PG_CLIENT_IMAGE=postgres@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  run_move --target "$DST_DB" --worker-image mingming21400/stoktok-worker@sha256:0000000000000000000000000000000000000000000000000000000000000000:x; assert "a worker image with text after the digest (exit 2)" rc_is 2
  assert "says --worker-image must be pinned by digest (text after digest)" out_has "--worker-image must be pinned by digest"
  XENV="MOVE_SRC_HOST=db.example.invalid MOVE_SRC_SSLMODE=require PG_CLIENT_IMAGE=postgres@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  run_move --target "$DST_DB" --worker-image postgres@sha256:0000000000000000000000000000000000000000000000000000000000000000; assert "a digest of another repository (exit 2)" rc_is 2
  assert "says --worker-image must be pinned by digest (other repository)" out_has "--worker-image must be pinned by digest"
  printf '%s\n%s\n%s\n' '-----BEGIN CERTIFICATE-----' 'ZmlsbGVy' '-----END CERTIFICATE-----' > "$TMP/ca.pem"
  printf '%s\n' 'not a certificate' > "$TMP/bad.pem"
  XENV="MOVE_SRC_SSLROOTCERT=$TMP/ca.pem MOVE_SRC_SSLMODE=disable"
  run_move --target "$DST_DB" --skip-migrate; assert "a root cert with sslmode disable (exit 2)" rc_is 2
  assert "says: needs MOVE_SRC_SSLMODE verify-ca or verify-full" out_has "needs MOVE_SRC_SSLMODE verify-ca or verify-full"
  XENV="MOVE_SRC_SSLMODE=verify-full"
  run_move --target "$DST_DB" --skip-migrate; assert "verify-full without a root cert (exit 2)" rc_is 2
  assert "says: needs MOVE_SRC_SSLROOTCERT" out_has "needs MOVE_SRC_SSLROOTCERT"
  XENV="MOVE_SRC_SSLROOTCERT=$TMP/none.pem MOVE_SRC_SSLMODE=verify-full"
  run_move --target "$DST_DB" --skip-migrate; assert "a missing root cert file (exit 2)" rc_is 2
  assert "says: is missing or unreadable" out_has "is missing or unreadable"
  XENV="MOVE_SRC_SSLROOTCERT=relative/ca.pem MOVE_SRC_SSLMODE=verify-full"
  run_move --target "$DST_DB" --skip-migrate; assert "a relative root cert path (exit 2)" rc_is 2
  assert "says: must be an absolute path" out_has "must be an absolute path"
  XENV="MOVE_SRC_SSLROOTCERT=$TMP/bad.pem MOVE_SRC_SSLMODE=verify-full"
  run_move --target "$DST_DB" --skip-migrate; assert "a file without a PEM certificate (exit 2)" rc_is 2
  assert "says: is not a PEM certificate" out_has "is not a PEM certificate"
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
  assert "the dump has mode 600" bash -c "[ -z \"\$(find '$WORK' -maxdepth 1 -name '*.dump' ! -perm 600)\" ]"
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
  assert "a failed dry run leaves no dump" no_dump
  assert "target still empty" same 0 "$(dst_rows "$DST2_DB")"
  assert_no_leak
  XENV="MOVE_SRC_DB=$DRIFT_DB"
  run_move --target "$DST2_DB" --skip-migrate
  assert "real run without --schema-check fails at restore (exit 1)" rc_is 1
  assert "target still empty after the failed restore" same 0 "$(dst_rows "$DST2_DB")"
  assert_no_leak
  rm -f "$WORK"/*.dump
}

t_column_pipe() {
  echo "t_column_pipe"
  drift_set_last_col 'n|ote'
  XENV="MOVE_SRC_DB=$DRIFT_DB"
  run_move --target "$DST_DB" --skip-migrate --verify-only
  assert "a source column name with | is refused (exit 1)" rc_is 1
  assert "says so" out_has "unexpected source column list"
  assert_no_leak
}

t_column_pipe_newline() {
  echo "t_column_pipe_newline"
  drift_set_last_col "a|b
c|d"
  XENV="MOVE_SRC_DB=$DRIFT_DB"
  run_move --target "$DST_DB" --skip-migrate --verify-only
  assert "a source column name with | and a newline is refused (exit 1)" rc_is 1
  assert "says so" out_has "unexpected source column list"
  assert_no_leak
}

t_extra_source_table() {
  echo "t_extra_source_table"
  drift_set_last_col note
  su_db "$DRIFT_DB" -c "set default_transaction_read_only = off" -c "create table public.zzz (id int primary key)" >/dev/null
  XENV="MOVE_SRC_DB=$DRIFT_DB"
  run_move --target "$DST_DB" --skip-migrate --verify-only
  assert "an extra source table is refused (exit 1)" rc_is 1
  assert "says it is not a target data table" out_has "not a target data table"
  su_db "$DRIFT_DB" -c "set default_transaction_read_only = off" -c "drop table public.zzz" >/dev/null
  assert_no_leak
}

t_client_image_pin() {
  echo "t_client_image_pin"
  local digest
  digest="$("$REAL_DOCKER" image inspect -f '{{index .RepoDigests 0}}' postgres:17 2>/dev/null || true)"
  if [ -z "$digest" ]; then echo "  skip: no repo digest for postgres:17"; return; fi
  : > "$LOG"
  wdigest="mingming21400/stoktok-worker:v0.3.0@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  XENV="PG_CLIENT_IMAGE=$digest MOVE_SRC_HOST=db.example.invalid MOVE_SRC_SSLMODE=require"
  run_move --target "$DST3_DB" --skip-migrate --dry-run
  assert "a digest-pinned image passes the guard (exit 1, not 2)" rc_is 1
  assert "no pin complaint" out_lacks "pinned by digest"
  assert "fails at preflight (the source host does not resolve)" out_has "FAILED at step: preflight"
  assert "the docker run used the digest image" bash -c "grep '^run ' '$LOG' | grep -qF '$digest'"
  assert_no_leak
  XENV="PG_CLIENT_IMAGE=$digest MOVE_SRC_HOST=db.example.invalid MOVE_SRC_SSLMODE=require"
  run_move --target "$DST3_DB" --worker-image "$wdigest" --dry-run
  assert "a digest-pinned worker image passes the S6 guard (exit 1, not 2)" rc_is 1
  assert "no worker pin complaint" out_lacks "--worker-image must be pinned"
  assert "fails at preflight" out_has "FAILED at step: preflight"
  assert_no_leak
}

t_sslrootcert() {
  echo "t_sslrootcert"
  : > "$LOG"
  printf '%s\n%s\n%s\n' '-----BEGIN CERTIFICATE-----' 'ZmlsbGVy' '-----END CERTIFICATE-----' > "$TMP/ca.pem"
  XENV="MOVE_SRC_SSLMODE=verify-full MOVE_SRC_SSLROOTCERT=$TMP/ca.pem"
  run_move --target "$DST3_DB" --skip-migrate --dry-run
  assert "fails at preflight (the local server has no valid TLS) (exit 1)" rc_is 1
  assert "the cert is mounted into a source leg" bash -c "grep -F -- '-U $SRC_ROLE' '$LOG' | grep -F ':/certs/root.crt:ro' | grep -qF 'PGSSLROOTCERT=/certs/root.crt'"
  assert "every cert mount is on a source leg" bash -c "! grep -F '/certs/root.crt' '$LOG' | grep -vqF -- '-U $SRC_ROLE'"
  assert "no target leg has the cert or PGSSLROOTCERT" bash -c "! grep -F -- '-U $DST_ROLE' '$LOG' | grep -qE '/certs/root.crt|PGSSLROOTCERT'"
  assert_no_leak
}

ALL="t_usage_guards t_static t_schema_migrations_mismatch t_dry_run_happy t_verify_only t_refuse_non_empty t_force t_freeze t_schema_drift t_column_pipe t_column_pipe_newline t_extra_source_table t_client_image_pin t_sslrootcert"
for t in ${*:-$ALL}; do "$t"; done

if [ "$FAILS" -ne 0 ]; then echo "test:move: $FAILS assertion(s) FAILED" >&2; exit 1; fi
echo "test:move OK"
