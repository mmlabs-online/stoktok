#!/usr/bin/env bash
# STK-083: faithfulness proof of the squashed baseline. One-off, not part of CI or package.json.
#   A'  = full legacy chain (supabase/migrations, all 15 files) on the Supabase-shaped reference bootstrap
#   A   = legacy chain through 20261110000300 (what the Supabase project actually runs)
#   B   = db/migrations baseline as a non-superuser owner, then the down file, then re-applied
# Pass: normalised schema of A' equals B. A vs B is printed and recorded; only the ai_keys difference is expected.
# Throwaway cluster on a unix socket with trust auth; no TCP, no secrets. Set PG_BIN to pick the binaries.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL_OPTS=(-X -q -v ON_ERROR_STOP=1)
TMP=""
RUNAS=()

cleanup() {
  if [ -n "$TMP" ]; then
    "${RUNAS[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

if [ -z "${PG_BIN:-}" ]; then
  for d in /usr/lib/postgresql/17/bin /usr/lib/postgresql/16/bin; do
    if [ -x "$d/initdb" ]; then PG_BIN="$d"; break; fi
  done
fi
if [ -z "${PG_BIN:-}" ] || [ ! -x "$PG_BIN/initdb" ]; then
  PG_BIN="$(pg_config --bindir 2>/dev/null || true)"
fi
if [ -z "$PG_BIN" ] || [ ! -x "$PG_BIN/initdb" ]; then
  echo "schema-diff: no Postgres binaries found (set PG_BIN)" >&2
  exit 1
fi

TMP="$(mktemp -d)"
OUT="${SCHEMA_DIFF_OUT:-$(mktemp -d)}"
mkdir -p "$OUT"
if [ "$(id -u)" = 0 ]; then
  chown postgres "$TMP"
  RUNAS=(runuser -u postgres --)
fi
"${RUNAS[@]}" "$PG_BIN/initdb" -D "$TMP/data" --auth=trust -U postgres >/dev/null
"${RUNAS[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -w -l "$TMP/pg.log" \
  -o "-c listen_addresses='' -k '$TMP'" start >/dev/null

psql_as() { local u="$1" db="$2"; shift 2; "$PG_BIN/psql" -h "$TMP" -U "$u" -d "$db" "${PSQL_OPTS[@]}" "$@"; }
dump() { "$PG_BIN/pg_dump" -h "$TMP" -U postgres -d "$1" --schema-only --schema=public --no-owner --no-privileges --no-tablespaces \
  | sed -E '/^\\(un)?restrict /d; /ENABLE ROW LEVEL SECURITY;$/d; /^-- Dumped (from|by) /d' \
  | sed -z -E 's/--\n-- Name: [^\n]*; Type: ROW SECURITY;[^\n]*\n--\n\n\n//g' > "$2"; }

echo "server: $(psql_as postgres postgres -At -c 'select version()')"
echo "pg_dump: $("$PG_BIN/pg_dump" --version)"

UP_ALL=("$ROOT"/supabase/migrations/*.sql)
UP_SUPABASE=()
for f in "${UP_ALL[@]}"; do
  case "$(basename "$f")" in 20261111000100_*) ;; *) UP_SUPABASE+=("$f") ;; esac
done

legacy() { # $1 = db, rest = files
  local db="$1"; shift
  psql_as postgres postgres -c "create database $db"
  psql_as postgres "$db" -f "$ROOT/supabase/legacy/bootstrap-roles.sql"
  for f in "$@"; do psql_as postgres "$db" --single-transaction -f "$f"; done
}
legacy legacy_full "${UP_ALL[@]}"
legacy legacy_supabase "${UP_SUPABASE[@]}"

BASE="$ROOT/db/migrations/20261111000200_baseline.sql"
DOWN="$ROOT/db/rollback/20261111000200_baseline.down.sql"
psql_as postgres postgres -c "create role stoktok_diff login nosuperuser nocreatedb nocreaterole noreplication nobypassrls"
psql_as postgres postgres -c "create database baseline owner stoktok_diff"
psql_as postgres baseline -c "alter schema public owner to stoktok_diff; revoke all on schema public from public"
echo "owner role flags: $(psql_as postgres postgres -At -c "select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls from pg_roles where rolname = 'stoktok_diff'")"
psql_as stoktok_diff baseline --single-transaction -f "$BASE"
psql_as stoktok_diff baseline --single-transaction -f "$DOWN"
left="$(psql_as postgres baseline -At -c "select (select count(*) from pg_class where relnamespace='public'::regnamespace), (select count(*) from pg_proc where pronamespace='public'::regnamespace), (select count(*) from pg_type where typnamespace='public'::regnamespace)")"
echo "after rollback (pg_class|pg_proc|pg_type in public): $left"
if [ "$left" != "0|0|0" ]; then echo "schema-diff: rollback left objects" >&2; exit 1; fi
psql_as stoktok_diff baseline --single-transaction -f "$BASE"

dump legacy_full "$OUT/A_prime.sql"
dump legacy_supabase "$OUT/A.sql"
dump baseline "$OUT/B.sql"

status=0
if diff -u "$OUT/A_prime.sql" "$OUT/B.sql" > "$OUT/A_prime_vs_B.diff"; then
  echo "A' vs B: identical"
else
  echo "A' vs B: DIFFERENT" >&2
  cat "$OUT/A_prime_vs_B.diff" >&2
  status=1
fi
echo "==> A (Supabase chain) vs B (baseline), expected: ai_keys only"
diff -u "$OUT/A.sql" "$OUT/B.sql" | tee "$OUT/A_vs_B.diff" || true
echo "output: $OUT"
exit "$status"
