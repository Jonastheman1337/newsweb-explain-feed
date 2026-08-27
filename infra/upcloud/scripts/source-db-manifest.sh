#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: source-db-manifest.sh <render-database-env-file> <output>" >&2
  exit 1
fi

connection_env=$(readlink -f "$1")
output=$2
[[ -f ${connection_env} ]] || { echo "Connection environment not found: ${connection_env}" >&2; exit 1; }
mode=$(stat -c '%a' "${connection_env}")
[[ ${mode} == "600" ]] || { echo "${connection_env} must have mode 600, found ${mode}" >&2; exit 1; }

set -a
source "${connection_env}"
set +a
[[ -n ${RENDER_DATABASE_URL:-} ]] || { echo "RENDER_DATABASE_URL is missing" >&2; exit 1; }

LC_ALL=C docker run --rm -i \
  --env RENDER_DATABASE_URL \
  --env PGSSLMODE=require \
  postgres:16-alpine \
  sh -ceu 'exec psql "$RENDER_DATABASE_URL" -v ON_ERROR_STOP=1 -At' <<'SQL' \
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

[[ -s ${output} ]] || { echo "Source database manifest is empty: ${output}" >&2; exit 1; }
echo "Source database manifest: ${output}"
