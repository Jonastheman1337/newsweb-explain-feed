#!/usr/bin/env bash
set -euo pipefail

AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
INFRA_DIR=${INFRA_DIR:-${AUTOWEB_ROOT}/current/infra/upcloud}
HOST_ENV=${HOST_ENV:-${AUTOWEB_ROOT}/secrets/host.env}
output=${1:-${AUTOWEB_ROOT}/state/db-manifest-$(date -u +%Y%m%dT%H%M%SZ).txt}

set -a
source "${HOST_ENV}"
set +a
compose=(docker compose --env-file "${HOST_ENV}" -f "${INFRA_DIR}/compose.yml")

LC_ALL=C "${compose[@]}" exec -T postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 -At <<'SQL' \
  >"${output}"
SELECT format(
  'SELECT %L || ''|rows|'' || count(*)::text FROM %I.%I;',
  schemaname || '.' || tablename,
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
\gexec

SELECT format(
  'SELECT %L || ''|latest|'' || %L || ''|'' || coalesce(max(%I)::text, ''NULL'') FROM %I.%I;',
  table_schema || '.' || table_name,
  column_name,
  column_name,
  table_schema,
  table_name
)
FROM information_schema.columns
WHERE table_schema = 'public'
  AND data_type IN ('timestamp with time zone', 'timestamp without time zone')
ORDER BY table_name, ordinal_position;
\gexec
SQL

[[ -s ${output} ]] || { echo "Database manifest is empty: ${output}" >&2; exit 1; }

echo "Database manifest: ${output}"
