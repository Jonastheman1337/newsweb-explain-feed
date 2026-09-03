#!/usr/bin/env bash
# Frees disk on the UpCloud production host so the deploy preflight (25 GiB
# free under /srv/autoweb) passes again.
#
#   bash scripts/prod-prune-images.sh            # keep current, previous, HEAD
#   bash scripts/prod-prune-images.sh <sha> ...  # keep those SHAs too
#   bash scripts/prod-prune-images.sh --dry-run  # only report
#
# Removes autoweb-{api,worker,web} images whose tag is not in the keep set,
# then dangling images and stale builder cache. Never touches running
# containers, volumes (Postgres/Redis data), or release directories.
set -euo pipefail

AUTOWEB_HOST=${AUTOWEB_HOST:-autoweb@81.27.105.83}
AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
dry_run=0
keep=()
for arg in "$@"; do
  case "${arg}" in
    --dry-run) dry_run=1 ;;
    *) keep+=("${arg}") ;;
  esac
done
if [[ ${#keep[@]} -eq 0 ]]; then
  keep+=("$(git rev-parse HEAD)")
fi

ssh -o BatchMode=yes -o ConnectTimeout=25 "${AUTOWEB_HOST}" \
  "AUTOWEB_ROOT='${AUTOWEB_ROOT}' DRY_RUN='${dry_run}' EXTRA_KEEP='${keep[*]}' bash -s" <<'REMOTE'
set -euo pipefail
keep=" ${EXTRA_KEEP} "
for state in current-release previous-release; do
  if [[ -f ${AUTOWEB_ROOT}/state/${state} ]]; then
    keep+="$(<"${AUTOWEB_ROOT}/state/${state}") "
  fi
done
# Whatever is running stays, regardless of state files.
for running in $(docker ps --format '{{.Image}}' | grep -E '^autoweb-(api|worker|web):' | sed 's/.*://' | sort -u); do
  keep+="${running} "
done
echo "[prune] keeping tags:${keep}"
echo "[prune] before: $(df -h "${AUTOWEB_ROOT}" | awk 'NR==2 {print $4" free of "$2}')"

removed=0
while read -r image; do
  [[ -z ${image} ]] && continue
  tag=${image##*:}
  case "${keep}" in
    *" ${tag} "*) ;;
    *)
      echo "[prune] remove ${image}"
      if [[ ${DRY_RUN} != "1" ]]; then
        docker rmi "${image}" >/dev/null && removed=$((removed + 1))
      fi
      ;;
  esac
done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^autoweb-(api|worker|web):' || true)

if [[ ${DRY_RUN} != "1" ]]; then
  docker image prune -f >/dev/null
  docker builder prune -f --keep-storage 4GB >/dev/null
fi
echo "[prune] removed ${removed} release image(s)"
echo "[prune] after:  $(df -h "${AUTOWEB_ROOT}" | awk 'NR==2 {print $4" free of "$2}')"
REMOTE
