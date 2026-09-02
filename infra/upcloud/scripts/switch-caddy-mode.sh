#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! $1 =~ ^(preview|production)$ ]]; then
  echo "Usage: switch-caddy-mode.sh <preview|production>" >&2
  exit 1
fi

mode=$1
AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
INFRA_DIR=${INFRA_DIR:-${AUTOWEB_ROOT}/current/infra/upcloud}
HOST_ENV=${HOST_ENV:-${AUTOWEB_ROOT}/secrets/host.env}

case ${mode} in
  preview) caddyfile=./Caddyfile.preview ;;
  production) caddyfile=./Caddyfile ;;
esac
[[ -f ${INFRA_DIR}/${caddyfile#./} ]] || {
  echo "Caddy configuration not found for ${mode}: ${INFRA_DIR}/${caddyfile#./}" >&2
  exit 1
}

temp=$(mktemp "${AUTOWEB_ROOT}/secrets/host.env.XXXXXX")
cleanup() {
  [[ ! -e ${temp} ]] || rm -f -- "${temp}"
}
trap cleanup EXIT

awk -v value="${caddyfile}" '
  BEGIN { found=0 }
  /^CADDYFILE_PATH=/ { print "CADDYFILE_PATH=" value; found=1; next }
  { print }
  END { if (!found) print "CADDYFILE_PATH=" value }
' "${HOST_ENV}" >"${temp}"
chmod 600 "${temp}"
mv "${temp}" "${HOST_ENV}"

compose=(docker compose --env-file "${HOST_ENV}" -f "${INFRA_DIR}/compose.yml")
"${compose[@]}" config --quiet
"${compose[@]}" up -d --force-recreate --wait caddy
echo "Caddy mode PASS mode=${mode} file=${caddyfile}"
