#!/usr/bin/env bash
set -euo pipefail

AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
INFRA_DIR=${INFRA_DIR:-${AUTOWEB_ROOT}/current/infra/upcloud}
HOST_ENV=${HOST_ENV:-${AUTOWEB_ROOT}/secrets/host.env}
backup_dir="${AUTOWEB_ROOT}/backups"
mkdir -p "${backup_dir}"

set -a
source "${HOST_ENV}"
set +a
compose=(docker compose --env-file "${HOST_ENV}" -f "${INFRA_DIR}/compose.yml")

stamp=$(date -u +%Y%m%dT%H%M%SZ)
temp_file="${backup_dir}/.${POSTGRES_DB}-${stamp}.dump.tmp"
final_file="${backup_dir}/${POSTGRES_DB}-${stamp}.dump"

cleanup() {
  rm -f -- "${temp_file}"
}
trap cleanup EXIT

"${compose[@]}" exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --format=custom --no-owner --no-acl \
  >"${temp_file}"
"${compose[@]}" exec -T postgres pg_restore --list <"${temp_file}" >/dev/null
mv "${temp_file}" "${final_file}"
sha256sum "${final_file}" >"${final_file}.sha256"

mapfile -t backups < <(find "${backup_dir}" -maxdepth 1 -type f -name "${POSTGRES_DB}-*.dump" -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
if (( ${#backups[@]} > 7 )); then
  for old_backup in "${backups[@]:7}"; do
    [[ ${old_backup} == "${backup_dir}/${POSTGRES_DB}-"*.dump ]] || continue
    rm -f -- "${old_backup}" "${old_backup}.sha256"
  done
fi

echo "Backup PASS file=${final_file}"
