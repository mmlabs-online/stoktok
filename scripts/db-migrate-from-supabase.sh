#!/usr/bin/env bash
# STK-091 (STK-084 slice A2a): one-time data move from the Supabase `public` tables to the shared Postgres.
# READ-ONLY on Supabase: every source connection goes through src_dump (pg_dump) or src_ro (psql in a READ ONLY
# transaction that is rolled back). Nothing here applies a migration to, or writes to, the source.
# Reference: docs/deploy.md "Data move script (STK-091)". Bash 3.2 compatible (macOS /bin/bash).
# STK-096: a remote source needs PG_CLIENT_IMAGE pinned by digest (F4); MOVE_SRC_SSLROOTCERT (optional, F7) is
# mounted read-only into the source legs only. Runbook: docs/deploy.md "Cutover runbook (STK-096)".
set -euo pipefail
unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGDATABASE PGUSER PGOPTIONS PGPASSWORD PGPASSFILE PGSSLMODE
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage_err() { echo "db-migrate-from-supabase: $1" >&2; echo "usage: $0 --target <db> (--worker-image <ref> | --skip-migrate) [--dry-run] [--schema-check] [--force --confirm <db>] [--keep-dump] [--verify-only] [--work-dir <dir>]" >&2; exit 2; }
fail() { echo "db-migrate-from-supabase: $1" >&2; exit 1; }
step() { STEP="$1"; echo "==> $1"; }

TARGET=""; IMAGE=""; SKIP_MIGRATE=0; DRY=0; SCHEMA_CHECK=0; FORCE=0; CONFIRM=""; KEEP_DUMP=0; VERIFY_ONLY=0
WORK="${HOME:-/tmp}/srv/backups/stoktok-cutover"
STEP="arguments"
SECRETS=""
DUMP=""

while [ $# -gt 0 ]; do
  case "$1" in
    --target) [ $# -ge 2 ] || usage_err "--target needs a value"; TARGET="$2"; shift 2 ;;
    --worker-image) [ $# -ge 2 ] || usage_err "--worker-image needs a value"; IMAGE="$2"; shift 2 ;;
    --skip-migrate) SKIP_MIGRATE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --schema-check) SCHEMA_CHECK=1; shift ;;
    --force) FORCE=1; shift ;;
    --confirm) [ $# -ge 2 ] || usage_err "--confirm needs a value"; CONFIRM="$2"; shift 2 ;;
    --keep-dump) KEEP_DUMP=1; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    --work-dir) [ $# -ge 2 ] || usage_err "--work-dir needs a value"; WORK="$2"; shift 2 ;;
    *) usage_err "unknown argument '$1'" ;;
  esac
done

# ---- 1. Guards before any connection or docker call ----
[ -n "$TARGET" ] || usage_err "--target is required"
if [ "$DRY" = 1 ]; then
  [[ "$TARGET" =~ ^stoktok_scratch[a-z0-9_]*$ ]] || usage_err "a dry run needs a scratch target (stoktok_scratch...)"
else
  [[ "$TARGET" =~ ^stoktok(_scratch[a-z0-9_]*)?$ ]] || usage_err "target must be stoktok or stoktok_scratch..."
fi
if [ "$FORCE" = 1 ]; then
  [ "$CONFIRM" = "$TARGET" ] || usage_err "--force needs --confirm <the same database name>"
elif [ -n "$CONFIRM" ]; then
  usage_err "--confirm is only valid with --force"
fi
if [ "$VERIFY_ONLY" = 0 ]; then
  if [ -n "$IMAGE" ] && [ "$SKIP_MIGRATE" = 1 ]; then usage_err "use either --worker-image or --skip-migrate"; fi
  if [ -z "$IMAGE" ] && [ "$SKIP_MIGRATE" = 0 ]; then usage_err "one of --worker-image or --skip-migrate is required"; fi
else
  SKIP_MIGRATE=1
  if [ "$FORCE" = 1 ]; then usage_err "--verify-only cannot be combined with --force"; fi
fi
if [ -n "$IMAGE" ]; then [[ "$IMAGE" =~ ^[A-Za-z0-9._/:@-]+$ ]] || usage_err "bad --worker-image"; fi

SRC_HOST="${MOVE_SRC_HOST:-}"
SRC_PORT="${MOVE_SRC_PORT:-5432}"
SRC_USER="${MOVE_SRC_USER:-}"
SRC_DB="${MOVE_SRC_DB:-postgres}"
SRC_SSL="${MOVE_SRC_SSLMODE:-require}"
DST_HOST="${MOVE_DST_HOST:-postgres}"
DST_PORT="${MOVE_DST_PORT:-5432}"
DST_USER="${MOVE_DST_USER:-stoktok}"
DST_PWFILE="${MOVE_DST_PWFILE:-${HOME:-}/srv/postgres/secrets/apps/stoktok.password}"
SRC_NET="${MOVE_SRC_NETWORK:-bridge}"
DST_NET="${MOVE_DST_NETWORK:-db}"
PG_CLIENT_IMAGE="${PG_CLIENT_IMAGE:-pgvector/pgvector:pg17-trixie}"
JOB_LOCK="${MOVE_JOB_LOCK:-/tmp/stoktok-jobs.lock}"
FREEZE_PROJECT="${MOVE_FREEZE_PROJECT:-stoktok}"

[ -n "$SRC_HOST" ] || usage_err "MOVE_SRC_HOST is required"
[[ "$SRC_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || usage_err "MOVE_SRC_HOST has unexpected characters"
[ -n "$SRC_USER" ] || usage_err "MOVE_SRC_USER is required"
[[ "$SRC_USER" =~ ^[A-Za-z0-9._-]+$ ]] || usage_err "MOVE_SRC_USER has unexpected characters"
[[ "$SRC_DB" =~ ^[A-Za-z0-9_]+$ ]] || usage_err "MOVE_SRC_DB has unexpected characters"
[[ "$SRC_PORT" =~ ^[0-9]+$ ]] || usage_err "MOVE_SRC_PORT must be numeric"
[[ "$DST_PORT" =~ ^[0-9]+$ ]] || usage_err "MOVE_DST_PORT must be numeric"
[[ "$DST_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || usage_err "MOVE_DST_HOST has unexpected characters"
src_hp="$(printf '%s:%s' "$SRC_HOST" "$SRC_PORT" | tr 'A-Z' 'a-z')"
dst_hp="$(printf '%s:%s' "$DST_HOST" "$DST_PORT" | tr 'A-Z' 'a-z')"
[ "$src_hp" != "$dst_hp" ] || usage_err "the target host:port equals the source host:port; refusing"
[ "$SRC_DB" != "$TARGET" ] || usage_err "the source database name equals the target database name; refusing"
[[ "$DST_USER" =~ ^stoktok[a-z0-9_]*$ ]] || usage_err "MOVE_DST_USER must match ^stoktok[a-z0-9_]*\$"
[[ "$SRC_NET" =~ ^[A-Za-z0-9_.-]+$ ]] || usage_err "MOVE_SRC_NETWORK has unexpected characters"
[[ "$DST_NET" =~ ^[A-Za-z0-9_.-]+$ ]] || usage_err "MOVE_DST_NETWORK has unexpected characters"
[[ "$PG_CLIENT_IMAGE" =~ ^[A-Za-z0-9._/:@-]+$ ]] || usage_err "bad PG_CLIENT_IMAGE"
[[ "$FREEZE_PROJECT" =~ ^[A-Za-z0-9_.-]+$ ]] || usage_err "bad MOVE_FREEZE_PROJECT"
case "$SRC_SSL" in
  require|verify-ca|verify-full) ;;
  disable|prefer|allow)
    case "$SRC_HOST" in
      localhost|127.0.0.1) ;;
      *) usage_err "MOVE_SRC_SSLMODE=$SRC_SSL is only allowed for a local source" ;;
    esac ;;
  *) usage_err "bad MOVE_SRC_SSLMODE" ;;
esac
SRC_LOCAL=0; case "$SRC_HOST" in localhost|127.0.0.1) SRC_LOCAL=1 ;; esac
if [ "$SRC_LOCAL" = 0 ] && ! [[ "$PG_CLIENT_IMAGE" =~ ^[A-Za-z0-9._/:-]+@sha256:[0-9a-f]{64}$ ]]; then
  usage_err "PG_CLIENT_IMAGE must be pinned by digest (<repo>@sha256:<64 hex>) for a remote source; see docs/deploy.md Cutover runbook"
fi
SRC_CERT="${MOVE_SRC_SSLROOTCERT:-}"
if [ -n "$SRC_CERT" ]; then
  [[ "$SRC_CERT" =~ ^/[A-Za-z0-9._/-]+$ ]] || usage_err "MOVE_SRC_SSLROOTCERT must be an absolute path (A-Za-z0-9._/-)"
  { [ -f "$SRC_CERT" ] && [ -r "$SRC_CERT" ]; } || usage_err "MOVE_SRC_SSLROOTCERT $SRC_CERT is missing or unreadable"
  grep -q -- '-----BEGIN CERTIFICATE-----' "$SRC_CERT" || usage_err "MOVE_SRC_SSLROOTCERT $SRC_CERT is not a PEM certificate"
  case "$SRC_SSL" in verify-ca|verify-full) ;; *) usage_err "MOVE_SRC_SSLROOTCERT needs MOVE_SRC_SSLMODE verify-ca or verify-full" ;; esac
else
  case "$SRC_SSL" in verify-ca|verify-full) usage_err "MOVE_SRC_SSLMODE=$SRC_SSL needs MOVE_SRC_SSLROOTCERT (the Supabase root certificate)" ;; esac
fi

# Target password: one line, same guard as the deploy. Name the file on error, never its content.
[ -r "$DST_PWFILE" ] || fail "target password file $DST_PWFILE is missing or unreadable"
DST_PW=""
IFS= read -r DST_PW < "$DST_PWFILE" || [ -n "$DST_PW" ] || true
[[ "$DST_PW" =~ ^[A-Za-z0-9_-]{16,}$ ]] || fail "target password file $DST_PWFILE is malformed (one line of at least 16 characters from A-Za-z0-9_-)"
if [ "$(wc -l < "$DST_PWFILE" | tr -d ' ')" -gt 1 ]; then fail "target password file $DST_PWFILE has more than one line"; fi

# Source password: MOVE_SRC_PGPASSWORD, else a prompt on the terminal.
SRC_PW="${MOVE_SRC_PGPASSWORD:-}"
unset MOVE_SRC_PGPASSWORD
if [ -z "$SRC_PW" ]; then
  if [ -r /dev/tty ] && { : < /dev/tty; } 2>/dev/null; then
    printf 'Source password for %s@%s: ' "$SRC_USER" "$SRC_HOST" > /dev/tty
    IFS= read -rs SRC_PW < /dev/tty || true
    echo > /dev/tty
  fi
  [ -n "$SRC_PW" ] || usage_err "no source password: set MOVE_SRC_PGPASSWORD or run from a terminal"
fi
case "$SRC_PW" in *$'\n'*|*$'\r'*) usage_err "the source password must be one line" ;; esac

command -v docker >/dev/null 2>&1 || fail "docker not found"

UIDGID="$(id -u):$(id -g)"

# ---- cleanup (secrets dir) ----
cleanup() {
  local rc=$?
  trap - EXIT
  if [ -n "$SECRETS" ]; then rm -rf "$SECRETS"; fi
  if [ "$rc" -ne 0 ] && [ "$DRY" = 1 ] && [ "$KEEP_DUMP" = 0 ] && [ -n "$DUMP" ]; then rm -f "$WORK/$DUMP"; fi
  if [ "$rc" -ne 0 ]; then
    echo "db-migrate-from-supabase: FAILED at step: $STEP" >&2
    rc=1
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
trap 'exit 129' HUP

# ---- 2. Freeze checks ----
if [ "$VERIFY_ONLY" = 0 ]; then
  step "freeze checks"
  frozen=0
  if [ -d "$JOB_LOCK" ]; then echo "freeze: job lock $JOB_LOCK exists (a job is running or was killed)" >&2; frozen=1; fi
  running="$(docker ps -q --filter "label=com.docker.compose.project=$FREEZE_PROJECT" | tr '\n' ' ')"
  if [ -n "${running// /}" ]; then echo "freeze: containers of compose project $FREEZE_PROJECT are running" >&2; frozen=1; fi
  if [ "$frozen" = 1 ]; then
    if [ "$DRY" = 1 ]; then echo "WARNING: the source is not frozen (allowed in a dry run)" >&2; else fail "freeze the apps first (see docs/deploy.md); nothing was dumped"; fi
  fi
fi

# ---- 3. Secrets dir and work dir ----
step "secrets and work dir"
SECRETS="$(mktemp -d)"
esc_pg() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/:/\\:/g'; }
{
  printf '%s:%s:*:%s:%s\n' "$(esc_pg "$SRC_HOST")" "$SRC_PORT" "$(esc_pg "$SRC_USER")" "$(esc_pg "$SRC_PW")"
  printf '%s:%s:*:%s:%s\n' "$(esc_pg "$DST_HOST")" "$DST_PORT" "$(esc_pg "$DST_USER")" "$(esc_pg "$DST_PW")"
} > "$SECRETS/pgpass"
chmod 600 "$SECRETS/pgpass"
mkdir -p "$WORK"
[ -n "$(find "$WORK" -maxdepth 0 -perm 700)" ] || fail "work dir $WORK must have mode 700"

# One pg client container. First arg: network; second: the tool; stdin is passed through (-i).
pg_run() {
  local net="$1" tool="$2"; shift 2
  if [ -n "$PG_CERT_CUR" ]; then
    docker run --rm -i --network "$net" --user "$UIDGID" \
      -e PGPASSFILE=/secrets/pgpass -e "PGSSLMODE=$PG_SSL_CUR" -e PGSSLROOTCERT=/certs/root.crt \
      -v "$SECRETS:/secrets:ro" -v "$WORK:/work" -v "$PG_CERT_CUR:/certs/root.crt:ro" --entrypoint "$tool" "$PG_CLIENT_IMAGE" "$@"
  else
    docker run --rm -i --network "$net" --user "$UIDGID" \
      -e PGPASSFILE=/secrets/pgpass -e "PGSSLMODE=$PG_SSL_CUR" \
      -v "$SECRETS:/secrets:ro" -v "$WORK:/work" --entrypoint "$tool" "$PG_CLIENT_IMAGE" "$@"
  fi
}
PG_CERT_CUR=""
PSQL_FLAGS="-X -q -A -t -v ON_ERROR_STOP=1"

# The ONLY functions that name the source host (read-only access).
src_dump() { PG_SSL_CUR="$SRC_SSL"; PG_CERT_CUR="$SRC_CERT"; pg_run "$SRC_NET" pg_dump -h "$SRC_HOST" -p "$SRC_PORT" -U "$SRC_USER" -d "$SRC_DB" "$@" < /dev/null; }
src_ro() {
  PG_SSL_CUR="$SRC_SSL"; PG_CERT_CUR="$SRC_CERT"
  { printf '%s\n' 'set default_transaction_read_only = on; begin transaction isolation level repeatable read read only;'; cat; printf '%s\n' ';' 'rollback;'; } \
    | pg_run "$SRC_NET" psql $PSQL_FLAGS -h "$SRC_HOST" -p "$SRC_PORT" -U "$SRC_USER" -d "$SRC_DB"
}
# Target legs.
dst_ro() {
  PG_SSL_CUR="prefer"; PG_CERT_CUR=""
  { printf '%s\n' 'set default_transaction_read_only = on; begin transaction isolation level repeatable read read only;'; cat; printf '%s\n' ';' 'rollback;'; } \
    | pg_run "$DST_NET" psql $PSQL_FLAGS -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d "$TARGET"
}
dst_psql() { PG_SSL_CUR="prefer"; PG_CERT_CUR=""; pg_run "$DST_NET" psql $PSQL_FLAGS -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d "$TARGET"; }
dst_dump() { PG_SSL_CUR="prefer"; PG_CERT_CUR=""; pg_run "$DST_NET" pg_dump -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d "$TARGET" "$@" < /dev/null; }
q_src() { printf '%s\n' "$1" | src_ro; }
q_dst() { printf '%s\n' "$1" | dst_psql; }

sha_stdin() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 | cut -d' ' -f1; else sha256sum | cut -d' ' -f1; fi; }

# ---- 4. Preflight ----
step "preflight"
pf="$(q_dst "select current_database() || '|' || current_user || '|' || current_setting('server_version_num') || '|' || (select rolsuper::text from pg_roles where rolname = current_user)")"
IFS='|' read -r pf_db pf_user pf_ver pf_super <<EOF
$pf
EOF
echo "target: current_database=$pf_db current_user=$pf_user server_version_num=$pf_ver"
[ "$pf_db" = "$TARGET" ] || fail "connected to $pf_db, expected $TARGET"
[ "$pf_super" = "false" ] || fail "target login $pf_user is a superuser; use the app role"
[ "$pf_ver" -ge 170000 ] || fail "target server is below Postgres 17 ($pf_ver)"
src_ver="$(q_src "show server_version_num")"
[[ "$src_ver" =~ ^[0-9]+$ ]] || fail "could not read the source server version"
echo "source: server_version_num=$src_ver"
PG_SSL_CUR="prefer"; PG_CERT_CUR=""
client_major="$(pg_run none pg_dump --version < /dev/null | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
[ "$client_major" = 17 ] || fail "pg client major is $client_major, expected 17 (PG_CLIENT_IMAGE)"
[ "$client_major" -ge $((src_ver / 10000)) ] || fail "pg client 17 is older than the source server"

# ---- 5. Schema ----
step "expected schema"
EXPECTED="$(for f in "$ROOT"/db/migrations/*.sql; do b="$(basename "$f")"; printf '%s|%s\n' "${b%%_*}" "$(tr -d '\r' < "$f" | sha_stdin)"; done | sort)"
[ -n "$EXPECTED" ] || fail "no migrations in db/migrations"
if [ -n "$IMAGE" ]; then
  IMG_LIST="$(docker run --rm --network none --entrypoint sh "$IMAGE" -c 'cd /app/migrations && for f in *.sql; do printf "%s|%s\n" "${f%%_*}" "$(tr -d "\r" < "$f" | sha256sum | cut -d" " -f1)"; done' | sort)"
  [ "$IMG_LIST" = "$EXPECTED" ] || fail "the worker image migrations differ from this checkout (wrong tag checked out?)"
  if [ "$VERIFY_ONLY" = 0 ]; then
    step "migrate (worker image)"
    STOKTOK_DATABASE_URL="postgres://$DST_USER:$DST_PW@$DST_HOST:$DST_PORT/$TARGET" \
      docker run --rm --network "$DST_NET" -e STOKTOK_DATABASE_URL "$IMAGE" migrate
  fi
fi
step "assert schema_migrations"
ACTUAL="$(q_dst "select version || '|' || checksum from public.schema_migrations" 2>/dev/null | sort)" || ACTUAL=""
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "expected (version|checksum):" >&2; printf '%s\n' "$EXPECTED" >&2
  echo "target has:" >&2; printf '%s\n' "$ACTUAL" >&2
  fail "target schema_migrations does not equal db/migrations (migrate the target first)"
fi
echo "schema_migrations matches db/migrations"

TABLES="$(q_dst "select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations' order by tablename collate \"C\"")"
[ -n "$TABLES" ] || fail "target has no tables"
for t in $TABLES; do [[ "$t" =~ ^[a-z_][a-z0-9_]*$ ]] || fail "unexpected table name '$t'"; done
DATA_TABLES="$(printf '%s\n' "$TABLES" | grep -vx 'ai_keys')"

verify_phase() {
  step "verify (ordered md5 per table, source vs target)"
  local cols vsql="" line tname tcols tpk
  cols="$(q_src "select c.relname || '|' || (select string_agg(quote_ident(a.attname), ',' order by a.attnum) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)
    || '|' || coalesce((select string_agg(quote_ident(a.attname), ',' order by array_position(i.indkey::int2[], a.attnum)) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey::int2[]) where i.indrelid = c.oid and i.indisprimary), '')
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname not in ('schema_migrations', 'ai_keys') order by c.relname")"
  [ -n "$cols" ] || fail "source has no tables to verify"
  local list_re='^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$'
  local line_re='^[a-z_][a-z0-9_]*[|][^|]+[|][^|]*$'
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    [[ "$line" =~ $line_re ]] || fail "unexpected source column list (a name with | or a newline?)"
    IFS='|' read -r tname tcols tpk <<EOT
$line
EOT
    [[ "$tname" =~ ^[a-z_][a-z0-9_]*$ ]] || fail "unexpected source table name '$tname'"
    [ -n "$tpk" ] || fail "source table $tname has no primary key"
    [[ "$tcols" =~ $list_re ]] || fail "unexpected source column list for table $tname"
    [[ "$tpk" =~ $list_re ]] || fail "unexpected source primary key list for table $tname"
    case "
$DATA_TABLES
" in *"
$tname
"*) ;; *) fail "source table $tname is not a target data table" ;; esac
    vsql="$vsql select 't|$tname|' || count(*) || '|' || md5(coalesce(string_agg(md5(ROW($tcols)::text), '' order by (ROW($tpk)::text) collate \"C\"), '')) from public.$tname;"$'\n'
  done <<EOF
$cols
EOF
  local pre="set TimeZone='UTC'; set DateStyle='ISO, YMD'; set IntervalStyle='postgres'; set extra_float_digits=1; set bytea_output='hex'; set statement_timeout=0;"
  printf '%s\n%s' "$pre" "$vsql" | src_ro > "$WORK/verify-source.txt"
  printf '%s\n%s' "$pre" "$vsql" | dst_ro > "$WORK/verify-target.txt"
  if ! diff -u "$WORK/verify-source.txt" "$WORK/verify-target.txt" > "$WORK/verify.diff"; then
    echo "verify: MISMATCH in table(s): $(grep '^[-+]t|' "$WORK/verify.diff" | sed -E 's/^[-+]t\|([^|]*)\|.*/\1/' | sort -u | tr '\n' ' ')" >&2
    fail "verification failed; writers may be running; re-run with --verify-only"
  fi
  VERIFIED_TABLES="$(wc -l < "$WORK/verify-target.txt" | tr -d ' ')"
  VERIFIED_ROWS="$(awk -F'|' '{s += $3} END {print s + 0}' "$WORK/verify-target.txt")"
  [ "$(q_dst "select count(*) from public.ai_keys")" = 0 ] || fail "target ai_keys is not empty"
  echo "verified $VERIFIED_TABLES tables, $VERIFIED_ROWS rows; ai_keys is empty on the target"
}

if [ "$VERIFY_ONLY" = 1 ]; then
  verify_phase
  echo "verify-only OK"
  exit 0
fi

# ---- 6. Empty or force ----
step "target emptiness"
count_sql="select coalesce(sum(c), 0) from ("
sep=""
for t in $TABLES; do count_sql="$count_sql$sep select count(*) as c from public.$t"; sep=" union all"; done
rows="$(q_dst "$count_sql) x")"
if [ "$rows" != 0 ]; then
  if [ "$FORCE" = 0 ]; then fail "target $TARGET is not empty ($rows rows); nothing was written (use --force --confirm $TARGET to truncate)"; fi
  step "force: truncate target tables"
  list=""; sep=""
  for t in $TABLES; do list="$list${sep}public.$t"; sep=", "; done
  printf 'begin; truncate table %s restart identity; commit;\n' "$list" | dst_psql
fi

# ---- 7. Schema check ----
SCHEMA_DIFF=0
normalise() {
  awk '
    function flush() { if (hdr != "" && !drop) printf "%s", buf; hdr = ""; buf = ""; drop = 0 }
    /^SET / || /set_config/ || /^\\restrict/ || /^\\unrestrict/ || /^-- Dumped (from|by)/ || /ENABLE ROW LEVEL SECURITY;/ { next }
    /^-- Name: / { flush(); hdr = $0; if ($0 ~ /Type: ROW SECURITY/ || $0 ~ /ai_keys/) drop = 1; buf = $0 "\n"; next }
    { if ($0 ~ /ai_keys/) drop = 1; if (hdr == "") print; else buf = buf $0 "\n" }
    END { flush() }
  '
}
if [ "$DRY" = 1 ] || [ "$SCHEMA_CHECK" = 1 ]; then
  step "schema check (source vs target)"
  SCHEMA_FLAGS="--schema-only --schema=public --no-owner --no-privileges --no-tablespaces --exclude-table=public.schema_migrations"
  # shellcheck disable=SC2086
  src_dump $SCHEMA_FLAGS -f /work/schema-source.sql
  # shellcheck disable=SC2086
  dst_dump $SCHEMA_FLAGS -f /work/schema-target.sql
  normalise < "$WORK/schema-source.sql" > "$WORK/schema-source.norm"
  normalise < "$WORK/schema-target.sql" > "$WORK/schema-target.norm"
  rm -f "$WORK/schema-source.sql" "$WORK/schema-target.sql"
  if diff -u "$WORK/schema-source.norm" "$WORK/schema-target.norm" > "$WORK/schema-check.diff"; then
    echo "schema check: no unexpected differences"
  else
    cat "$WORK/schema-check.diff"
    if [ "$DRY" = 1 ]; then SCHEMA_DIFF=1; echo "schema check: DIFFERENCES (mandatory in a dry run; the verdict will be FAIL)" >&2
    else echo "schema check: differences listed above (informational at the real cutover)"; fi
  fi
fi

# ---- 8. Dump and TOC ----
step "dump (read-only pg_dump)"
DUMP="stoktok-supabase-$(date -u +%Y%m%d-%H%M%S).dump"
: > "$WORK/$DUMP"
src_dump -Fc --data-only --schema=public --no-owner --no-privileges --exclude-table=public.ai_keys --exclude-table=public.schema_migrations -f "/work/$DUMP"
chmod 600 "$WORK/$DUMP"
step "dump table of contents"
toc="$(pg_run none pg_restore -l "/work/$DUMP" < /dev/null | awk '$4 == "TABLE" && $5 == "DATA" && $6 == "public" {print $7}' | LC_ALL=C sort)"
if ! diff <(printf '%s\n' "$DATA_TABLES") <(printf '%s\n' "$toc") >&2; then
  fail "dump table list differs from the target tables (< target, > dump)"
fi

# ---- 9. Restore ----
step "restore (single transaction)"
PG_SSL_CUR="prefer"; PG_CERT_CUR=""
pg_run "$DST_NET" pg_restore --data-only --single-transaction --no-owner --no-privileges -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d "$TARGET" "/work/$DUMP" < /dev/null
step "analyze"
list=""; sep=""
for t in $TABLES; do list="$list${sep}public.$t"; sep=", "; done
q_dst "analyze $list"

# ---- 10. Sequences ----
step "sequences"
seq_state_sql="select sequencename || '|' || coalesce(last_value::text, 'null') from pg_sequences where schemaname = 'public' order by sequencename"
SRC_SEQ="$(q_src "$seq_state_sql")"
DST_SEQ="$(q_dst "$seq_state_sql")"
[ "$SRC_SEQ" = "$DST_SEQ" ] || { diff <(printf '%s\n' "$SRC_SEQ") <(printf '%s\n' "$DST_SEQ") >&2 || true; fail "sequence state differs between the source and the restored target"; }
idents="$(q_dst "select c.relname || '|' || a.attname || '|' || pg_get_serial_sequence('public.' || quote_ident(c.relname), a.attname) from pg_attribute a join pg_class c on c.oid = a.attrelid where a.attidentity <> '' and not a.attisdropped and c.relnamespace = 'public'::regnamespace order by 1")"
BUMPED=0; NSEQ=0
while IFS='|' read -r rel col seq; do
  [ -n "$rel" ] || continue
  [[ "$rel" =~ ^[a-z_][a-z0-9_]*$ && "$col" =~ ^[a-z_][a-z0-9_]*$ && "$seq" =~ ^public\.[a-z_][a-z0-9_]*$ ]] || fail "unexpected identity column '$rel|$col|$seq'"
  NSEQ=$((NSEQ + 1))
  mx="$(q_dst "select coalesce(max($col)::text, '') from public.$rel")"
  [ -n "$mx" ] || continue
  [[ "$mx" =~ ^-?[0-9]+$ ]] || fail "unexpected max($col) of $rel: '$mx'"
  last="$(q_dst "select coalesce(last_value::text, '') from pg_sequences where schemaname || '.' || sequencename = '$seq'")"
  if [ -z "$last" ] || [ "$last" -lt "$mx" ]; then
    q_dst "select setval('$seq', $mx, true)" > /dev/null
    echo "bumped $seq to $mx (was ${last:-not called})"
    BUMPED=$((BUMPED + 1))
  fi
done <<EOF
$idents
EOF
[ "$NSEQ" = 6 ] || fail "expected 6 identity sequences on the target, found $NSEQ"
echo "sequences: $NSEQ identity sequences, $BUMPED bumped"

# ---- 11. Verify ----
verify_phase

# ---- 12. End ----
step "summary"
echo "summary: $VERIFIED_TABLES tables, $VERIFIED_ROWS rows, $BUMPED sequences bumped; work dir $WORK"
if [ "$DRY" = 1 ]; then
  if [ "$KEEP_DUMP" = 0 ]; then rm -f "$WORK/$DUMP"; else echo "dump kept: $WORK/$DUMP (unencrypted financial data; delete it)"; fi
  echo "dry run: drop the scratch database $TARGET when done"
  if [ "$SCHEMA_DIFF" = 1 ]; then echo "dry run FAIL: schema check found differences ($WORK/schema-check.diff)" >&2; exit 1; fi
  echo "dry run OK"
else
  echo "dump kept: $WORK/$DUMP (unencrypted financial data, not offsite-synced); delete it when the 14-day rollback window closes (STK-095)"
  echo "move OK"
fi
