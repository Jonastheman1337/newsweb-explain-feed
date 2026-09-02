#!/usr/bin/env bash
# Deploy a pushed commit to the Autoweb production host on UpCloud (autoweb24.no).
#
#   bash scripts/deploy-upcloud.sh [git-ref] [--allow-unpushed]
#   bash scripts/deploy-upcloud.sh --status
#
# Steps: git archive <ref> -> sha256 -> scp to /srv/autoweb/releases/incoming ->
# build images on the host (skipped if that release was already built) ->
# infra/upcloud/scripts/deploy.sh -> health check on https://autoweb24.no.
# Rollback: ssh "$AUTOWEB_HOST" /srv/autoweb/current/infra/upcloud/scripts/rollback.sh
set -euo pipefail

AUTOWEB_HOST=${AUTOWEB_HOST:-autoweb@81.27.105.83}
AUTOWEB_URL=${AUTOWEB_URL:-https://autoweb24.no}
AUTOWEB_ROOT=/srv/autoweb
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=20 "${AUTOWEB_HOST}")

ref=HEAD
allow_unpushed=0
for arg in "$@"; do
  case "${arg}" in
    --status)
      "${SSH[@]}" "echo current=\$(cat ${AUTOWEB_ROOT}/state/current-release); echo previous=\$(cat ${AUTOWEB_ROOT}/state/previous-release 2>/dev/null || echo none); docker ps --format '{{.Names}} {{.Status}}'"
      curl -s -m 20 "${AUTOWEB_URL}/api/health"; echo
      exit 0
      ;;
    --allow-unpushed) allow_unpushed=1 ;;
    -h|--help) sed -n 2,10p "$0"; exit 0 ;;
    *) ref=${arg} ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"
sha=$(git rev-parse --verify "${ref}^{commit}")
short=${sha:0:7}

if (( ! allow_unpushed )) && ! git branch -r --contains "${sha}" | grep -q 'origin/main'; then
  echo "Commit ${short} is not on origin/main. Push first, or pass --allow-unpushed." >&2
  exit 1
fi

release_dir="tmp/upcloud-release-${short}"
archive_name="autoweb-app-${sha}.tar"
mkdir -p "${release_dir}"
git archive --format=tar --output="${release_dir}/${archive_name}" "${sha}"
hash=$(sha256sum "${release_dir}/${archive_name}" | awk '{print $1}')
printf '%s  %s\n' "${hash}" "${archive_name}" >"${release_dir}/${archive_name}.sha256"
echo "Release ${short}: ${archive_name} sha256=${hash}"

incoming="${AUTOWEB_ROOT}/releases/incoming"
scp -o BatchMode=yes "${release_dir}/${archive_name}" "${release_dir}/${archive_name}.sha256" "${AUTOWEB_HOST}:${incoming}/"

"${SSH[@]}" bash -s -- "${sha}" "${incoming}/${archive_name}" "${hash}" <<'REMOTE'
set -euo pipefail
sha=$1; archive=$2; hash=$3
root=/srv/autoweb
scripts=${root}/current/infra/upcloud/scripts
cd "$(dirname "${archive}")"
sha256sum -c "$(basename "${archive}").sha256"
if [[ -d ${root}/releases/${sha}/source ]]; then
  echo "Images for ${sha:0:7} already built, skipping build."
else
  "${scripts}/build-release.sh" "${sha}" "${archive}" "${hash}"
fi
"${scripts}/deploy.sh" "${sha}"
echo "current-release=$(cat ${root}/state/current-release)"
REMOTE

echo "Public health:"
curl -s -m 30 "${AUTOWEB_URL}/api/health"; echo
