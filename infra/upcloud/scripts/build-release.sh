#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: build-release.sh <40-char-app-sha> <source.tar> <expected-sha256>" >&2
  exit 1
fi

release_sha=$1
archive=$2
expected_hash=$3
AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}

[[ ${release_sha} =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid release SHA" >&2; exit 1; }
[[ ${expected_hash} =~ ^[0-9a-f]{64}$ ]] || { echo "Invalid SHA256" >&2; exit 1; }
[[ -f ${archive} ]] || { echo "Archive not found: ${archive}" >&2; exit 1; }

actual_hash=$(sha256sum "${archive}" | awk '{print $1}')
[[ ${actual_hash} == "${expected_hash}" ]] || { echo "Archive checksum mismatch" >&2; exit 1; }

release_dir="${AUTOWEB_ROOT}/releases/${release_sha}"
source_dir="${release_dir}/source"
mkdir -p "${release_dir}"
if [[ -e ${source_dir} ]]; then
  echo "Release source already exists: ${source_dir}" >&2
  exit 1
fi
mkdir -p "${source_dir}"
tar -xf "${archive}" -C "${source_dir}"

exec 9>"${AUTOWEB_ROOT}/state/build.lock"
flock -n 9 || { echo "Another release build is running" >&2; exit 1; }

pushd "${source_dir}" >/dev/null
for component in api worker web; do
  docker build \
    --label "org.opencontainers.image.revision=${release_sha}" \
    --label "org.opencontainers.image.source=https://github.com/Jonastheman1337/newsweb-explain-feed" \
    --tag "autoweb-${component}:${release_sha}" \
    --file "apps/${component}/Dockerfile" \
    .
done
popd >/dev/null

printf '%s\n' "${actual_hash}" >"${release_dir}/source.sha256"
date --iso-8601=seconds >"${release_dir}/built-at"
echo "Built Autoweb images for ${release_sha}."
