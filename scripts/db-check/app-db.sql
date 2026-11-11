-- Create or update one app's login role and database. Idempotent: safe to run again.
-- Run as the superuser, connected to `postgres`, with psql variables:
--   app       role and database name (^[a-z][a-z0-9_]*$, checked by the callers)
--   password  the role's password (postgres/secrets/apps/<app>.password)
-- Used by postgres/init/10-app-dbs.sh (empty volume) and postgres/scripts/add-app-db.sh (live
-- instance). Never echo this script with -e/-a: the generated ALTER ROLE carries the password.
\set ON_ERROR_STOP on

-- Role: login only, no special rights.
SELECT format('CREATE ROLE %I LOGIN', :'app')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app')
\gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
              :'app', :'password')
\gexec

-- Database owned by the role.
SELECT format('CREATE DATABASE %I OWNER %I', :'app', :'app')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app')
\gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'app', :'app')
\gexec

-- Only the owner (and the superuser) may connect.
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'app')
\gexec

-- The built-in databases are not for apps either.
REVOKE CONNECT, TEMPORARY ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE template1 FROM PUBLIC;

-- Inside the app's database: its schema `public` belongs to the role (Postgres 15+ already denies
-- CREATE on it to PUBLIC).
\connect :"app"
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app')
\gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
