#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: restore-render-export.sh <render-export.dir.tar.gz-or-custom.dump> <expected-sha256-or-file>" >&2
  exit 1
fi

export_file=$(readlink -f "$1")
[[ -f ${export_file} ]] || { echo "Export file not found: ${export_file}" >&2; exit 1; }
expected_input=$2
if [[ -f ${expected_input} ]]; then
  expected_hash=$(awk 'NR==1 {print tolower($1)}' "${expected_input}")
else
  expected_hash=$(printf '%s' "${expected_input}" | tr '[:upper:]' '[:lower:]')
fi
[[ ${expected_hash} =~ ^[0-9a-f]{64}$ ]] || { echo "Expected SHA256 is invalid" >&2; exit 1; }
actual_hash=$(sha256sum "${export_file}" | awk '{print $1}')
[[ ${actual_hash} == "${expected_hash}" ]] || { echo "Render export checksum mismatch" >&2; exit 1; }

AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
INFRA_DIR=${INFRA_DIR:-${AUTOWEB_ROOT}/current/infra/upcloud}
HOST_ENV=${HOST_ENV:-${AUTOWEB_ROOT}/secrets/host.env}
set -a
source "${HOST_ENV}"
set +a

compose=(docker compose --env-file "${HOST_ENV}" -f "${INFRA_DIR}/compose.yml")
restore_id=$(date -u +%Y%m%dT%H%M%SZ)
restore_dir="${AUTOWEB_ROOT}/tmp/render-restore-${restore_id}"
mkdir -p "${restore_dir}"

cleanup() {
  case "${restore_dir}" in
    "${AUTOWEB_ROOT}/tmp/render-restore-"*) rm -rf -- "${restore_dir}" ;;
    *) echo "Refusing unsafe cleanup path: ${restore_dir}" >&2 ;;
  esac
}
trap cleanup EXIT

"${compose[@]}" stop api worker web caddy >/dev/null 2>&1 || true
"${compose[@]}" up -d --wait postgres redis
"${compose[@]}" exec -T redis redis-cli FLUSHALL SYNC >/dev/null
[[ $("${compose[@]}" exec -T redis redis-cli DBSIZE) == "0" ]] || {
  echo "Redis was not empty after reset" >&2
  exit 1
}

printf '%s  %s\n' "${actual_hash}" "${export_file}" \
  >"${AUTOWEB_ROOT}/state/database-source-${restore_id}.sha256"

if tar -tzf "${export_file}" >/dev/null 2>&1; then
  source_format=render-directory-export
  tar -xzf "${export_file}" -C "${restore_dir}"
  dump_dir=$(find "${restore_dir}" -type f -name toc.dat -printf '%h\n' | head -n 1)
  [[ -n ${dump_dir} ]] || { echo "No pg_restore directory found in export" >&2; exit 1; }
  restore_mount="${dump_dir}:/restore:ro"
  restore_path=/restore
elif docker run --rm -i postgres:16-alpine pg_restore --list <"${export_file}" >/dev/null 2>&1; then
  source_format=postgres-custom-dump
  restore_mount="${export_file}:/restore/source.dump:ro"
  restore_path=/restore/source.dump
else
  echo "Unsupported or invalid PostgreSQL export: ${export_file}" >&2
  exit 1
fi

docker run --rm \
  --network autoweb-prod \
  --volume "${restore_mount}" \
  --env "PGPASSWORD=${POSTGRES_PASSWORD}" \
  --env "RESTORE_PATH=${restore_path}" \
  postgres:16-alpine \
  sh -ceu 'psql -h postgres -U "$1" -d "$2" -v ON_ERROR_STOP=1 -c "drop schema if exists public cascade; create schema public;"; pg_restore --no-owner --no-acl --exit-on-error -h postgres -U "$1" -d "$2" "$RESTORE_PATH"' \
  -- "${POSTGRES_USER}" "${POSTGRES_DB}"

"${compose[@]}" --profile ops run --rm migrate
"${INFRA_DIR}/scripts/db-manifest.sh" "${AUTOWEB_ROOT}/state/db-manifest-${restore_id}.txt"
echo "Restore PASS source=${export_file} format=${source_format}"
