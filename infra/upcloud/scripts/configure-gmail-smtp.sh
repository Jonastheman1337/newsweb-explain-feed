#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run configure-gmail-smtp.sh as root." >&2
  exit 1
fi
if [[ $# -ne 1 || ! $1 =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Usage: configure-gmail-smtp.sh <gmail-address>" >&2
  exit 1
fi

email=$1
AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
INFRA_DIR=${INFRA_DIR:-${AUTOWEB_ROOT}/current/infra/upcloud}
APP_ENV=${APP_ENV:-${AUTOWEB_ROOT}/secrets/app.env}
HOST_ENV=${HOST_ENV:-${AUTOWEB_ROOT}/secrets/host.env}

[[ -f ${APP_ENV} && -f ${HOST_ENV} ]] || {
  echo "Autoweb secret environment files are missing." >&2
  exit 1
}

read -r -s -p "Google App Password for ${email}: " app_password
echo
app_password=${app_password//[[:space:]]/}
if [[ ! ${app_password} =~ ^[A-Za-z0-9]{16}$ ]]; then
  unset app_password
  echo "Expected a 16-character Google App Password." >&2
  exit 1
fi

temp=$(mktemp "${AUTOWEB_ROOT}/secrets/app.env.XXXXXX")
body_file=$(mktemp "${AUTOWEB_ROOT}/state/smtp-test.XXXXXX")
cleanup() {
  unset app_password
  [[ ! -e ${temp} ]] || rm -f -- "${temp}"
  [[ ! -e ${body_file} ]] || rm -f -- "${body_file}"
}
trap cleanup EXIT

chmod 600 "${temp}" "${body_file}"
SMTP_APP_PASSWORD=${app_password} awk -v email="${email}" '
  BEGIN {
    values["SMTP_HOST"]="smtp.gmail.com"
    values["SMTP_PORT"]="465"
    values["SMTP_USER"]=email
    values["SMTP_FROM"]=email
    values["SMTP_PASS"]=ENVIRON["SMTP_APP_PASSWORD"]
  }
  /^[A-Za-z_][A-Za-z0-9_]*=/ {
    split($0, parts, "=")
    key=parts[1]
    if (key in values) {
      print key "=" values[key]
      seen[key]=1
      next
    }
  }
  { print }
  END {
    for (key in values) {
      if (!(key in seen)) print key "=" values[key]
    }
  }
' "${APP_ENV}" >"${temp}"
mv "${temp}" "${APP_ENV}"
chmod 600 "${APP_ENV}"
unset app_password

printf 'Autoweb SMTP alert delivery is working on %s at %s.\n' \
  "$(hostname)" "$(date --iso-8601=seconds)" >"${body_file}"
python3 "${INFRA_DIR}/scripts/send-alert.py" \
  "${APP_ENV}" "${email}" "[Autoweb] SMTP test PASS" "${body_file}"

systemctl enable --now autoweb-watchdog.timer
systemctl is-active --quiet autoweb-watchdog.timer
echo "SMTP alert PASS; autoweb-watchdog.timer enabled."
