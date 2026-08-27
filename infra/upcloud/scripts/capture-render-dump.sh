#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: capture-render-dump.sh <render-database-env-file> <output.dump>" >&2
  exit 1
fi

connection_env=$(readlink -f "$1")
output=$(readlink -m "$2")
[[ -f ${connection_env} ]] || { echo "Connection environment not found: ${connection_env}" >&2; exit 1; }
[[ $(stat -c '%a' "${connection_env}") == "600" ]] || {
  echo "${connection_env} must have mode 600" >&2
  exit 1
}
[[ ! -e ${output} ]] || { echo "Refusing to overwrite existing dump: ${output}" >&2; exit 1; }
mkdir -p "$(dirname "${output}")"

set -a
source "${connection_env}"
set +a
[[ -n ${RENDER_DATABASE_URL:-} ]] || { echo "RENDER_DATABASE_URL is missing" >&2; exit 1; }

umask 077
temp=$(mktemp "${output}.partial.XXXXXX")
cleanup() {
  [[ ! -e ${temp} ]] || rm -f -- "${temp}"
}
trap cleanup EXIT

started=$(date +%s)
docker run --rm -i \
  --env RENDER_DATABASE_URL \
  --env PGSSLMODE=require \
  postgres:16-alpine \
  sh -ceu 'exec pg_dump --format=custom --compress=6 --no-owner --no-acl "$RENDER_DATABASE_URL"' \
  >"${temp}"

[[ -s ${temp} ]] || { echo "Captured database dump is empty" >&2; exit 1; }
docker run --rm -i postgres:16-alpine pg_restore --list <"${temp}" >/dev/null
mv "${temp}" "${output}"
actual_hash=$(sha256sum "${output}" | awk '{print $1}')
printf '%s  %s\n' "${actual_hash}" "${output}" >"${output}.sha256"
elapsed=$(( $(date +%s) - started ))
size=$(stat -c '%s' "${output}")
echo "Render direct dump PASS file=${output} bytes=${size} sha256=${actual_hash} elapsed_seconds=${elapsed}"
