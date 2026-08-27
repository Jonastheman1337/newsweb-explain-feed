#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! $1 =~ ^(disabled|enabled)$ ]]; then
  echo "Usage: set-polling-mode.sh <disabled|enabled>" >&2
  exit 1
fi

mode=$1
AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
INFRA_DIR=${INFRA_DIR:-${AUTOWEB_ROOT}/current/infra/upcloud}
HOST_ENV=${HOST_ENV:-${AUTOWEB_ROOT}/secrets/host.env}
case ${mode} in
  disabled) value=false ;;
  enabled) value=true ;;
esac

temp=$(mktemp "${AUTOWEB_ROOT}/secrets/host.env.XXXXXX")
cleanup() {
  [[ ! -e ${temp} ]] || rm -f -- "${temp}"
}
trap cleanup EXIT

awk -v value="${value}" '
  BEGIN { found=0 }
  /^NEWSWEB_POLLING_ENABLED=/ {
    print "NEWSWEB_POLLING_ENABLED=" value
    found=1
    next
  }
  { print }
  END {
    if (!found) print "NEWSWEB_POLLING_ENABLED=" value
  }
' "${HOST_ENV}" >"${temp}"
chmod 600 "${temp}"
mv "${temp}" "${HOST_ENV}"

compose=(docker compose --env-file "${HOST_ENV}" -f "${INFRA_DIR}/compose.yml")
"${compose[@]}" config --quiet
"${compose[@]}" up -d --force-recreate --wait api worker
worker_count=$("${compose[@]}" ps --status running --services | grep -cx worker || true)
[[ ${worker_count} == "1" ]] || {
  echo "Expected exactly one running worker service, found ${worker_count}." >&2
  exit 1
}
echo "Polling mode PASS mode=${mode} worker_services=${worker_count}"
