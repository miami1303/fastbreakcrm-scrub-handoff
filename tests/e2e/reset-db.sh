#!/usr/bin/env bash
# TEST ONLY: recreate the throwaway local database and apply every migration in order.
set -euo pipefail
PSQL="psql -h 127.0.0.1 -p ${PGPORT:-55432} -U postgres -v ON_ERROR_STOP=1 -q"
HERE="$(cd "$(dirname "$0")" && pwd)"
$PSQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'crm_e2e' and pid <> pg_backend_pid()" >/dev/null
$PSQL -d postgres -c "drop database if exists crm_e2e" -c "create database crm_e2e"
for r in anon authenticated service_role authenticator; do $PSQL -d postgres -c "drop role if exists $r" 2>/dev/null || true; done
$PSQL -d crm_e2e -f "$HERE/bootstrap.sql"
for f in "$HERE"/../../supabase/migrations/*.sql; do echo "apply $(basename "$f")"; $PSQL -d crm_e2e -f "$f"; done
$PSQL -d crm_e2e -f "$HERE/seed.sql"
echo "database ready"
