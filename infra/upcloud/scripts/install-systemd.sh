#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run install-systemd.sh as root." >&2
  exit 1
fi

AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
INFRA_DIR=${INFRA_DIR:-${AUTOWEB_ROOT}/current/infra/upcloud}
chmod 0755 "${INFRA_DIR}"/scripts/*.sh "${INFRA_DIR}"/scripts/*.py
install -m 0644 "${INFRA_DIR}"/systemd/autoweb-* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now autoweb-backup.timer autoweb-watchdog.timer autoweb-restore-drill.timer
systemctl list-timers 'autoweb-*' --no-pager
