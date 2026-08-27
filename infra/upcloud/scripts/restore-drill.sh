#!/usr/bin/env bash
set -euo pipefail

AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
INFRA_DIR=${INFRA_DIR:-${AUTOWEB_ROOT}/current/infra/upcloud}
HOST_ENV=${HOST_ENV:-${AUTOWEB_ROOT}/secrets/host.env}
backup_dir="${AUTOWEB_ROOT}/backups"

set -a
source "${HOST_ENV}"
set +a
compose=(docker compose --env-file "${HOST_ENV}" -f "${INFRA_DIR}/compose.yml")

latest_backup=$(find "${backup_dir}" -maxdepth 1 -type f -name "${POSTGRES_DB}-*.dump" -printf '%T@ %p\n' | sort -nr | awk 'NR==1 {print $2}')
[[ -n ${latest_backup} ]] || { echo "No logical backup available for restore drill" >&2; exit 1; }
sha256sum --check "${latest_backup}.sha256"

drill_db="newsweb_restore_drill_$(date -u +%Y%m%d%H%M%S)"
cleanup() {
  "${compose[@]}" exec -T postgres dropdb -U "${POSTGRES_USER}" --if-exists "${drill_db}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${compose[@]}" exec -T postgres createdb -U "${POSTGRES_USER}" "${drill_db}"
"${compose[@]}" exec -T postgres pg_restore \
  -U "${POSTGRES_USER}" -d "${drill_db}" --no-owner --no-acl --exit-on-error \
  <"${latest_backup}"
table_count=$("${compose[@]}" exec -T postgres psql -U "${POSTGRES_USER}" -d "${drill_db}" -Atc \
  "select count(*) from pg_tables where schemaname='public';")
(( table_count > 0 )) || { echo "Restore drill produced no public tables" >&2; exit 1; }

echo "Restore drill PASS backup=${latest_backup} tables=${table_count}"
