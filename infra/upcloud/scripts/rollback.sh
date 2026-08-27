#!/usr/bin/env bash
set -euo pipefail

AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
state_dir="${AUTOWEB_ROOT}/state"

target_sha=${1:-}
if [[ -z ${target_sha} && -f ${state_dir}/previous-release ]]; then
  target_sha=$(<"${state_dir}/previous-release")
fi
if [[ ! ${target_sha} =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: rollback.sh [40-char-release-sha]; no valid previous release was recorded." >&2
  exit 1
fi

if [[ -f ${state_dir}/release-history ]] && ! grep -qxF "${target_sha}" "${state_dir}/release-history"; then
  echo "Refusing rollback: ${target_sha} is not in release history." >&2
  exit 1
fi

for component in api worker web; do
  docker image inspect "autoweb-${component}:${target_sha}" >/dev/null || {
    echo "Rollback image missing: autoweb-${component}:${target_sha}" >&2
    exit 1
  }
done

exec "${AUTOWEB_ROOT}/current/infra/upcloud/scripts/deploy.sh" "${target_sha}"
