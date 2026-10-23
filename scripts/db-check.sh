#!/usr/bin/env bash
# STK-003: apply migrations to a throwaway Postgres, run schema checks, roll back, re-apply, re-check.
# Set DB_CHECK_URL (localhost only) to use an existing Postgres instead of starting a throwaway one.
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

if [ -n "${DB_CHECK_URL:-}" ]; then
  host="$(printf '%s' "$DB_CHECK_URL" | sed -E 's#^[a-z]+://([^@/]*@)?(\[[^]]*\]|[^:/?]*).*#\2#')"
  case "$host" in
    localhost|127.0.0.1) ;;
    *) echo "db:check refuses non-local DB_CHECK_URL host '$host'" >&2; exit 1 ;;
  esac
  run_psql() { psql "$DB_CHECK_URL" "${PSQL_OPTS[@]}" "$@"; }
else
  PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
  if [ ! -x "$PG_BIN/initdb" ]; then
    PG_BIN="$(pg_config --bindir 2>/dev/null || true)"
  fi
  if [ -z "$PG_BIN" ] || [ ! -x "$PG_BIN/initdb" ]; then
    echo "db:check: no Postgres binaries found (set PG_BIN) and DB_CHECK_URL is unset" >&2
    exit 1
  fi
  TMP="$(mktemp -d)"
  if [ "$(id -u)" = 0 ]; then
    chown postgres "$TMP"
    RUNAS=(runuser -u postgres --)
  fi
  "${RUNAS[@]}" "$PG_BIN/initdb" -D "$TMP/data" --auth=trust -U postgres >/dev/null
  "${RUNAS[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -w -l "$TMP/pg.log" \
    -o "-c listen_addresses='' -k $TMP" start >/dev/null
  run_psql() { "$PG_BIN/psql" -h "$TMP" -U postgres -d postgres "${PSQL_OPTS[@]}" "$@"; }
fi

step() { echo "==> $1"; }
apply() { for f in "$@"; do step "apply $(basename "$f")"; run_psql --single-transaction -f "$f"; done; }

mapfile -t UP < <(ls "$ROOT"/supabase/migrations/*.sql | sort)
mapfile -t DOWN < <(ls "$ROOT"/supabase/rollback/*.sql | sort -r)

step "bootstrap roles"
run_psql -f "$ROOT/scripts/db-check/bootstrap-roles.sql"
apply "${UP[@]}"
step "checks"
run_psql -f "$ROOT/scripts/db-check/checks.sql"

apply "${DOWN[@]}"
n="$(run_psql -At -c "select count(*) from pg_tables where schemaname = 'public'")"
if [ "$n" != "0" ]; then echo "db:check: rollback left $n tables" >&2; exit 1; fi

apply "${UP[@]}"
step "checks (after re-apply)"
run_psql -f "$ROOT/scripts/db-check/checks.sql"
echo "db:check OK"
