#!/usr/bin/env bash
# db:check (STK-003, rewritten in STK-086 for the single-owner model).
# Bootstraps the role and database exactly as production does (scripts/db-check/app-db.sql), applies db/migrations
# as the NON-superuser owner (psql --single-transaction, one file at a time), runs checks.sql (as the owner) and
# checks-acl.sql (as superuser, plus injected-violation canaries), applies db/rollback in reverse, asserts nothing
# is left and the roles/ACLs are unchanged, then re-applies and re-checks.
#
# Provenance of scripts/db-check/app-db.sql: byte-identical copy of mmlabs-online/deployment postgres/sql/app-db.sql
#   sha256 cc8fe9424f11fa4e4e6e39ab265579904db0c8ddf8762fe78915cc885003c321
#   copied 2026-11-11 from deployment commit 9bfc613257d5a0ec0845dfa7b916608b7748a5fc
#   re-check: cmp scripts/db-check/app-db.sql <deployment>/postgres/sql/app-db.sql
#
# Default: a throwaway cluster on a unix socket with trust auth (PG_BIN picks the binaries; default 17, then 16).
# DB_CHECK_URL=postgresql://<superuser>:<pw>@localhost:<port>/postgres uses an existing server instead (localhost only).
#   THROWAWAY SERVERS ONLY. It refuses when any database besides postgres/template0/template1 exists or when the
#   roles $DB_CHECK_APP (default stoktok), stoktok_nobody or dbcheck_canary exist, and on exit drops what it created.
#   app-db.sql also revokes CONNECT/TEMPORARY from PUBLIC on the postgres and template1 databases; that is not undone.
# The generated owner password lives only in a shell variable, a stdin pipe and a per-command PGPASSWORD (never argv).
# The server major must be 17 (production): a mismatch fails when CI is set and warns otherwise.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL_OPTS=(-X -q -v ON_ERROR_STOP=1)
APP="${DB_CHECK_APP:-stoktok}"
NOBODY=stoktok_nobody
CANARY_ROLE=dbcheck_canary
TMP=""
RUNAS=()
CREATED=0

if ! [[ "$APP" =~ ^[a-z][a-z0-9_]*$ ]]; then
  echo "db:check: DB_CHECK_APP must match ^[a-z][a-z0-9_]*\$" >&2
  exit 1
fi
PW="$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')"

cleanup() {
  if [ "$CREATED" = 1 ]; then
    su_psql -c "drop database if exists \"$APP\" with (force)" >/dev/null 2>&1 || echo "db:check: WARNING could not drop database $APP" >&2
    for r in "$CANARY_ROLE" "$NOBODY" "$APP"; do
      su_psql -c "drop role if exists \"$r\"" >/dev/null 2>&1 || echo "db:check: WARNING could not drop role $r" >&2
    done
  fi
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
  if printf '%s' "$DB_CHECK_URL" | grep -qE '[?&](host|hostaddr|port)='; then
    echo "db:check refuses a DB_CHECK_URL with host, hostaddr or port query parameters" >&2
    exit 1
  fi
  port="$(printf '%s' "$DB_CHECK_URL" | sed -E 's#^[a-z]+://([^@/]*@)?(\[[^]]*\]|[^:/?]*)(:([0-9]+))?.*#\4#')"
  port="${port:-5432}"
  APP_URL="$(printf '%s' "$DB_CHECK_URL" | sed -E "s#^([a-z]+://[^/?]*)(/[^?]*)?#\\1/$APP#")"
  su_psql() { psql "$DB_CHECK_URL" "${PSQL_OPTS[@]}" "$@"; }
  su_app() { psql "$APP_URL" "${PSQL_OPTS[@]}" "$@"; }
  owner_psql() { PGPASSWORD="$PW" psql "postgresql://$APP@$host:$port/$APP" "${PSQL_OPTS[@]}" "$@"; }
else
  if [ -z "${PG_BIN:-}" ]; then
    for d in /usr/lib/postgresql/17/bin /usr/lib/postgresql/16/bin; do
      if [ -x "$d/initdb" ]; then PG_BIN="$d"; break; fi
    done
  fi
  if [ -z "${PG_BIN:-}" ] || [ ! -x "$PG_BIN/initdb" ]; then
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
    -o "-c listen_addresses='' -k '$TMP'" start >/dev/null
  su_psql() { "$PG_BIN/psql" -h "$TMP" -U postgres -d postgres "${PSQL_OPTS[@]}" "$@"; }
  su_app() { "$PG_BIN/psql" -h "$TMP" -U postgres -d "$APP" "${PSQL_OPTS[@]}" "$@"; }
  owner_psql() { PGPASSWORD="$PW" "$PG_BIN/psql" -h "$TMP" -U "$APP" -d "$APP" "${PSQL_OPTS[@]}" "$@"; }
fi

step() { echo "==> $1"; }

# Postgres major (production runs 17).
echo "server: $(su_psql -At -c 'select version()')"
major=$(( $(su_psql -At -c 'show server_version_num') / 10000 ))
if [ "$major" != 17 ]; then
  if [ -n "${CI:-}" ]; then
    echo "db:check: Postgres major $major, expected 17 (production)" >&2
    exit 1
  fi
  echo "WARNING: Postgres major $major, expected 17 (production)" >&2
fi

# Migrations and rollbacks: names, one-to-one parity. Fails before any database work.
shopt -s nullglob
UP=(); DOWN=()
for f in "$ROOT"/db/migrations/*; do
  b="$(basename "$f")"
  [ "$b" = README.md ] && continue
  if ! [[ "$b" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]]; then echo "db:check: bad migration file name '$b'" >&2; exit 1; fi
  UP+=("$f")
done
for f in "$ROOT"/db/rollback/*; do
  b="$(basename "$f")"
  if ! [[ "$b" =~ ^[0-9]{14}_[a-z0-9_]+\.down\.sql$ ]]; then echo "db:check: bad rollback file name '$b'" >&2; exit 1; fi
  DOWN+=("$f")
done
shopt -u nullglob
if [ "${#UP[@]}" -eq 0 ]; then echo "db:check: no migrations found" >&2; exit 1; fi
if ! diff <(for f in "${UP[@]}"; do b="$(basename "$f")"; echo "${b%.sql}"; done | sort) \
          <(for f in "${DOWN[@]}"; do b="$(basename "$f")"; echo "${b%.down.sql}"; done | sort) >&2; then
  echo "db:check: db/migrations and db/rollback are not one-to-one (< migrations only, > rollbacks only)" >&2
  exit 1
fi
mapfile -t UP < <(printf '%s\n' "${UP[@]}" | sort)
mapfile -t DOWN < <(printf '%s\n' "${DOWN[@]}" | sort -r)

apply_owner() { for f in "$@"; do step "apply $(basename "$f") (as $APP)"; owner_psql --single-transaction -f "$f"; done; }
run_checks() {
  step "checks$1"
  owner_psql -f "$ROOT/scripts/db-check/checks.sql"
  step "acl checks$1"
  su_app -v "app=$APP" -v "nobody=$NOBODY" -f "$ROOT/scripts/db-check/checks-acl.sql"
}

# URL mode: only run on a server that holds nothing else, then clean up what we create.
if [ -n "${DB_CHECK_URL:-}" ]; then
  other="$(su_psql -At -c "select count(*) from pg_database where datname not in ('postgres','template0','template1')")"
  roles="$(su_psql -At -c "select count(*) from pg_roles where rolname in ('$APP','$NOBODY','$CANARY_ROLE')")"
  if [ "$other" != 0 ] || [ "$roles" != 0 ]; then
    echo "db:check refuses: the server has a non-system database ($other) or one of the roles $APP, $NOBODY, $CANARY_ROLE ($roles); use a throwaway server" >&2
    exit 1
  fi
  CREATED=1
fi

step "bootstrap (app-db.sql, role and database $APP)"
{ printf '\\set password %s\n' "$PW"; cat "$ROOT/scripts/db-check/app-db.sql"; } | su_psql -v "app=$APP"
su_psql -c "create role $NOBODY nologin"
echo "owner role flags: $(su_psql -At -F'|' -c "select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls from pg_roles where rolname = '$APP'")"

snapshot() {
  su_app -At -c "select (select string_agg(concat_ws(',', rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolcanlogin, rolinherit, rolconnlimit), ';' order by rolname) from pg_roles where rolname in ('$APP', '$NOBODY'))
    || ' | ' || (select concat_ws(',', nspowner::regrole, coalesce(nspacl::text, 'null')) from pg_namespace where nspname = 'public')
    || ' | ' || (select concat_ws(',', datdba::regrole, coalesce(datacl::text, 'null')) from pg_database where datname = current_database())"
}
SNAP0="$(snapshot)"

apply_owner "${UP[@]}"
run_checks ""

# Canaries: inject one violation per run into a transaction that is never committed; checks-acl.sql must catch it by name.
canary() {
  local name="$1" sql="$2" out
  if out="$(su_app --single-transaction -v "app=$APP" -v "nobody=$NOBODY" -c "$sql" -f "$ROOT/scripts/db-check/checks-acl.sql" 2>&1)"; then
    echo "db:check: canary $name was not caught" >&2
    exit 1
  fi
  if ! printf '%s' "$out" | grep -q "CHECK FAILED: $name"; then
    printf '%s\n' "$out" >&2
    echo "db:check: canary $name failed for another reason" >&2
    exit 1
  fi
  echo "canary $name: caught"
}
C="$CANARY_ROLE"
canary nobody_table_privileges "grant select on public.watchlist to public"
canary nobody_function_privileges "grant execute on function public.ai_month_spend(timestamptz, timestamptz) to public"
canary nobody_schema_privileges "grant usage on schema public to public"
canary nobody_database_privileges "grant connect on database $APP to public"
canary acl_owner_only_relations "create role $C nologin; grant select on public.settings to $C"
canary acl_owner_only_columns "create role $C nologin; grant select (symbol) on public.watchlist to $C"
canary acl_owner_only_functions "create role $C nologin; grant execute on function public.ai_reserve(text, text, text, bigint, bigint, timestamptz, timestamptz) to $C"
canary acl_owner_only_types "create role $C nologin; create type public.dbcheck_t as enum ('a'); alter type public.dbcheck_t owner to $APP; grant usage on type public.dbcheck_t to $C"
canary acl_owner_only_schema "create role $C nologin; grant usage on schema public to $C"
canary acl_owner_only_database "create role $C nologin; grant connect on database $APP to $C"
canary default_acl_empty "create role $C nologin; alter default privileges for role $APP in schema public grant select on tables to $C"
canary no_extra_schemas "create schema dbcheck_extra authorization $APP"
canary owned_by_app "create role $C nologin; alter table public.watchlist owner to $C"

apply_owner "${DOWN[@]}"
left="$(su_app -At -c "select (select count(*) from pg_class where relnamespace = 'public'::regnamespace), (select count(*) from pg_proc where pronamespace = 'public'::regnamespace), (select count(*) from pg_type where typnamespace = 'public'::regnamespace)")"
echo "after rollback: $left"
if [ "$left" != "0|0|0" ]; then echo "db:check: rollback left objects in public (class|proc|type = $left)" >&2; exit 1; fi
SNAP1="$(snapshot)"
if [ "$SNAP1" != "$SNAP0" ]; then
  echo "db:check: roles or ACLs changed across the rollback" >&2
  echo "before: $SNAP0" >&2
  echo "after:  $SNAP1" >&2
  exit 1
fi
echo "snapshot unchanged"

apply_owner "${UP[@]}"
run_checks " (after re-apply)"
echo "db:check OK"
