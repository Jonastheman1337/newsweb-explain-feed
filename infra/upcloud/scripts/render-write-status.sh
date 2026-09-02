#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && $1 != "--assert-idle" ) ]]; then
  echo "Usage: render-write-status.sh [--assert-idle]" >&2
  exit 1
fi

AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
RENDER_DB_ENV=${RENDER_DB_ENV:-${AUTOWEB_ROOT}/secrets/render-db.env}
[[ -f ${RENDER_DB_ENV} ]] || {
  echo "Render database connection input is missing." >&2
  exit 1
}
[[ $(stat -c '%a' "${RENDER_DB_ENV}") == "600" ]] || {
  echo "${RENDER_DB_ENV} must have mode 600." >&2
  exit 1
}

set -a
source "${RENDER_DB_ENV}"
set +a
[[ -n ${RENDER_DATABASE_URL:-} ]] || {
  echo "RENDER_DATABASE_URL is missing." >&2
  exit 1
}

status=$(
  docker run --rm -i \
    --env RENDER_DATABASE_URL \
    --env PGSSLMODE=require \
    postgres:16-alpine \
    sh -ceu 'exec psql "$RENDER_DATABASE_URL" -v ON_ERROR_STOP=1 -AtF "|"' <<'SQL'
SELECT 'generation_runs', count(*)
FROM generation_runs
WHERE status IN ('queued', 'started', 'pending')
  AND finished_at IS NULL
  AND requested_at >= now() - interval '6 hours';

SELECT 'job_runs', count(*)
FROM job_runs
WHERE status = 'started'
  AND finished_at IS NULL
  AND started_at >= now() - interval '6 hours';
SQL
)
printf '%s\n' "${status}"

active=$(awk -F'|' '{total += $2} END {print total + 0}' <<<"${status}")
echo "render_write_status active=${active}"
if [[ ${1:-} == "--assert-idle" && ${active} != "0" ]]; then
  exit 2
fi
