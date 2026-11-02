#!/usr/bin/env bash
# TEST ONLY: start PostgREST + the fake Supabase stack against the throwaway DB.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export JWT_SECRET="${JWT_SECRET:-local-e2e-secret-not-real-0123456789abcdef}"
export DATABASE_URL="postgres://postgres@127.0.0.1:${PGPORT:-55432}/crm_e2e"
export PGRST_DB_URI="postgres://authenticator:local-test-only@127.0.0.1:${PGPORT:-55432}/crm_e2e"
export PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT=3001 PGRST_SERVER_HOST=127.0.0.1
"${POSTGREST_BIN:-postgrest}" > /tmp/crm-e2e-postgrest.log 2>&1 &
NODE_PATH="${E2E_NODE_MODULES:-}" node "${STACK_SCRIPT:-$HERE/stack.mjs}" > /tmp/crm-e2e-stack.log 2>&1 &
sleep 2; cat /tmp/crm-e2e-stack.log
