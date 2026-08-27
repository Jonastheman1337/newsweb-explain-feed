#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run install-systemd.sh as root." >&2
  exit 1
fi

enable_watchdog=true
if [[ $# -gt 1 ]]; then
  echo "Usage: install-systemd.sh [--without-watchdog]" >&2
  exit 1
fi
if [[ $# -eq 1 ]]; then
  [[ $1 == "--without-watchdog" ]] || {
    echo "Usage: install-systemd.sh [--without-watchdog]" >&2
    exit 1
  }
  enable_watchdog=false
fi

AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
INFRA_DIR=${INFRA_DIR:-${AUTOWEB_ROOT}/current/infra/upcloud}
chmod 0755 "${INFRA_DIR}"/scripts/*.sh "${INFRA_DIR}"/scripts/*.py
install -m 0644 "${INFRA_DIR}"/systemd/autoweb-* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now autoweb-backup.timer autoweb-restore-drill.timer
if [[ ${enable_watchdog} == true ]]; then
  systemctl enable --now autoweb-watchdog.timer
else
  systemctl disable --now autoweb-watchdog.timer >/dev/null 2>&1 || true
  echo "Watchdog timer remains disabled until SMTP alert delivery is configured and tested."
fi
systemctl list-timers 'autoweb-*' --no-pager
