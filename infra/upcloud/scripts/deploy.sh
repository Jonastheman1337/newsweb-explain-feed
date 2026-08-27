#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: deploy.sh <40-char-app-sha>" >&2
  exit 1
fi

release_sha=$1
AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
INFRA_DIR=${INFRA_DIR:-${AUTOWEB_ROOT}/current/infra/upcloud}
HOST_ENV=${HOST_ENV:-${AUTOWEB_ROOT}/secrets/host.env}
state_dir="${AUTOWEB_ROOT}/state"
mkdir -p "${state_dir}"

exec 9>"${state_dir}/deploy.lock"
flock -n 9 || { echo "Another deployment is running" >&2; exit 1; }

set_host_env_release() {
  local value=$1
  local temp
  temp=$(mktemp "${AUTOWEB_ROOT}/secrets/host.env.XXXXXX")
  awk -v value="${value}" '
    BEGIN { found=0 }
    /^APP_RELEASE_SHA=/ { print "APP_RELEASE_SHA=" value; found=1; next }
    { print }
    END { if (!found) print "APP_RELEASE_SHA=" value }
  ' "${HOST_ENV}" >"${temp}"
  chmod 600 "${temp}"
  mv "${temp}" "${HOST_ENV}"
}

previous_sha=""
if [[ -f ${state_dir}/current-release ]]; then
  previous_sha=$(<"${state_dir}/current-release")
fi

set_host_env_release "${release_sha}"
export AUTOWEB_ROOT INFRA_DIR HOST_ENV
"${INFRA_DIR}/scripts/preflight.sh"

compose=(docker compose --env-file "${HOST_ENV}" -f "${INFRA_DIR}/compose.yml")
"${compose[@]}" up -d --wait postgres redis
"${compose[@]}" --profile ops run --rm migrate
"${compose[@]}" up -d --wait --wait-timeout 180 api worker web caddy

"${compose[@]}" exec -T web node -e \
  "fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok){console.error(await r.text());process.exit(1)}}).catch(e=>{console.error(e);process.exit(1)})"

if [[ -n ${previous_sha} && ${previous_sha} != "${release_sha}" ]]; then
  printf '%s\n' "${previous_sha}" >"${state_dir}/previous-release"
fi
printf '%s\n' "${release_sha}" >"${state_dir}/current-release"

history_file="${state_dir}/release-history"
{ printf '%s\n' "${release_sha}"; [[ -f ${history_file} ]] && cat "${history_file}"; } \
  | awk '!seen[$0]++' >"${history_file}.tmp"
mv "${history_file}.tmp" "${history_file}"

mapfile -t old_releases < <(tail -n +4 "${history_file}" || true)
if (( ${#old_releases[@]} > 0 )); then
  for old_sha in "${old_releases[@]}"; do
    [[ ${old_sha} =~ ^[0-9a-f]{40}$ ]] || continue
    docker image rm \
      "autoweb-api:${old_sha}" \
      "autoweb-worker:${old_sha}" \
      "autoweb-web:${old_sha}" >/dev/null 2>&1 || true
  done
  head -n 3 "${history_file}" >"${history_file}.tmp"
  mv "${history_file}.tmp" "${history_file}"
fi

echo "Deployment PASS release=${release_sha} previous=${previous_sha:-none}"
