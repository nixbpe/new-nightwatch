#!/bin/sh
# Create the least-privilege runtime role used by the application and tests.
# NOBYPASSRLS is explicit: the runtime role must never be able to bypass RLS.
# Owner access (nightwatch_owner) stays DDL/migrations-only.
#
# Runs once per data volume via docker-entrypoint-initdb.d (compose) and in CI
# via:
#   docker run --rm --network host \
#     -v "$PWD/scripts/db/init:/init:ro" \
#     -e POSTGRES_USER=nightwatch_owner -e POSTGRES_DB=nightwatch \
#     -e POSTGRES_HOST=localhost -e PGPASSWORD=<owner> -e NW_DB_PASSWORD=<runtime> \
#     postgres:17.11-alpine sh /init/001-roles.sh
# Passwords and identifiers are passed as psql variables so authorized
# overrides containing quotes/apostrophes cannot break the SQL.
set -eu

psql -v ON_ERROR_STOP=1 \
  -h "${POSTGRES_HOST:-/var/run/postgresql}" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -v nw_db_password="$NW_DB_PASSWORD" \
  -v nw_db="$POSTGRES_DB" <<'SQL'
CREATE ROLE nightwatch LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'nw_db_password';
GRANT CONNECT, TEMPORARY ON DATABASE :"nw_db" TO nightwatch;
SQL
