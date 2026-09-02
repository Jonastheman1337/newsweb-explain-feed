#!/usr/bin/env bash
set -euo pipefail

AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
INFRA_DIR=${INFRA_DIR:-${AUTOWEB_ROOT}/current/infra/upcloud}
HOST_ENV=${HOST_ENV:-${AUTOWEB_ROOT}/secrets/host.env}
APP_ENV=${APP_ENV:-${AUTOWEB_ROOT}/secrets/app.env}
state_dir="${AUTOWEB_ROOT}/state/watchdog"
mkdir -p "${state_dir}"

set -a
source "${HOST_ENV}"
set +a
compose=(docker compose --env-file "${HOST_ENV}" -f "${INFRA_DIR}/compose.yml")
issues=()

counter_update() {
  local name=$1
  local active=$2
  local value=0
  [[ -f ${state_dir}/${name} ]] && value=$(<"${state_dir}/${name}")
  if [[ ${active} == true ]]; then
    value=$((value + 1))
  else
    value=0
  fi
  printf '%s\n' "${value}" >"${state_dir}/${name}"
  printf '%s' "${value}"
}

for service in postgres redis api worker web caddy; do
  container_id=$("${compose[@]}" ps -q "${service}")
  if [[ -z ${container_id} ]]; then
    issues+=("service ${service} has no running container")
    continue
  fi
  status=$(docker inspect --format '{{.State.Status}}' "${container_id}")
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${container_id}")
  oom=$(docker inspect --format '{{.State.OOMKilled}}' "${container_id}")
  restarts=$(docker inspect --format '{{.RestartCount}}' "${container_id}")
  name=$(docker inspect --format '{{.Name}}' "${container_id}" | tr -d '/')
  [[ ${status} == "running" ]] || issues+=("${service} status=${status}")
  [[ ${health} == "none" || ${health} == "healthy" ]] || issues+=("${service} health=${health}")
  [[ ${oom} == "false" ]] || issues+=("${service} was OOM-killed")
  previous_restarts=0
  [[ -f ${state_dir}/restarts-${name} ]] && previous_restarts=$(<"${state_dir}/restarts-${name}")
  if (( restarts > previous_restarts )); then
    issues+=("${service} restart count increased ${previous_restarts}->${restarts}")
  fi
  printf '%s\n' "${restarts}" >"${state_dir}/restarts-${name}"
done

mem_total=$(awk '/MemTotal:/ {print $2}' /proc/meminfo)
mem_available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
mem_used_pct=$(( (mem_total - mem_available) * 100 / mem_total ))
swap_total=$(awk '/SwapTotal:/ {print $2}' /proc/meminfo)
swap_free=$(awk '/SwapFree:/ {print $2}' /proc/meminfo)
swap_used_pct=0
if (( swap_total > 0 )); then
  swap_used_pct=$(( (swap_total - swap_free) * 100 / swap_total ))
fi

memory_high=false
(( mem_used_pct >= 80 || swap_used_pct >= 10 )) && memory_high=true
memory_samples=$(counter_update memory-high "${memory_high}")
if (( memory_samples >= 3 )); then
  issues+=("host pressure sustained: memory=${mem_used_pct}% swap=${swap_used_pct}%")
fi

read -r cpu user nice system idle iowait irq softirq steal _ </proc/stat
first_idle=$((idle + iowait))
first_total=$((user + nice + system + idle + iowait + irq + softirq + steal))
sleep 1
read -r cpu user nice system idle iowait irq softirq steal _ </proc/stat
second_idle=$((idle + iowait))
second_total=$((user + nice + system + idle + iowait + irq + softirq + steal))
total_delta=$((second_total - first_total))
idle_delta=$((second_idle - first_idle))
cpu_used_pct=0
(( total_delta > 0 )) && cpu_used_pct=$(( (total_delta - idle_delta) * 100 / total_delta ))
cpu_high=false
(( cpu_used_pct >= 70 )) && cpu_high=true
cpu_samples=$(counter_update cpu-high "${cpu_high}")
if (( cpu_samples >= 3 )); then
  issues+=("host CPU sustained at ${cpu_used_pct}%")
fi

disk_used_pct=$(df -P "${AUTOWEB_ROOT}" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')
(( disk_used_pct < 70 )) || issues+=("disk usage=${disk_used_pct}%")

latest_backup=$(find "${AUTOWEB_ROOT}/backups" -maxdepth 1 -type f -name "${POSTGRES_DB}-*.dump" -printf '%T@ %p\n' 2>/dev/null | sort -nr | awk 'NR==1 {print $2}')
if [[ -z ${latest_backup} ]]; then
  issues+=("no logical database backup found")
else
  backup_age=$(( $(date +%s) - $(stat -c %Y "${latest_backup}") ))
  (( backup_age <= 93600 )) || issues+=("latest database backup is older than 26 hours")
fi

health_ok=false
if curl --silent --show-error --fail --max-time 10 \
  --resolve autoweb24.no:443:127.0.0.1 \
  https://autoweb24.no/api/health >/dev/null; then
  health_ok=true
fi
health_failures=$(counter_update public-health "$([[ ${health_ok} == true ]] && echo false || echo true)")
if (( health_failures >= 3 )); then
  issues+=("public health failed ${health_failures} consecutive checks")
fi

worker_stats=$(docker stats --no-stream --format '{{.Name}}|{{.MemPerc}}' 2>/dev/null | awk -F'|' '$1 ~ /worker/ {gsub(/%/, "", $2); print $2; exit}')
if [[ -n ${worker_stats} ]] && awk -v value="${worker_stats}" 'BEGIN {exit !(value >= 80)}'; then
  issues+=("worker container memory=${worker_stats}%")
fi

body_file=$(mktemp "${state_dir}/alert.XXXXXX")
trap 'rm -f -- "${body_file}"' EXIT
if (( ${#issues[@]} > 0 )); then
  {
    echo "Autoweb watchdog found ${#issues[@]} issue(s) on $(hostname) at $(date --iso-8601=seconds):"
    printf -- '- %s\n' "${issues[@]}"
  } >"${body_file}"
  fingerprint=$(sha256sum "${body_file}" | awk '{print $1}')
  previous_fingerprint=""
  [[ -f ${state_dir}/last-alert ]] && previous_fingerprint=$(<"${state_dir}/last-alert")
  if [[ ${fingerprint} != "${previous_fingerprint}" ]]; then
    python3 "${INFRA_DIR}/scripts/send-alert.py" "${APP_ENV}" "${ALERT_EMAIL}" \
      "[Autoweb] infrastructure alert" "${body_file}"
    printf '%s\n' "${fingerprint}" >"${state_dir}/last-alert"
  fi
  cat "${body_file}" >&2
  exit 1
fi

if [[ -f ${state_dir}/last-alert ]]; then
  echo "Autoweb watchdog recovered on $(hostname) at $(date --iso-8601=seconds)." >"${body_file}"
  python3 "${INFRA_DIR}/scripts/send-alert.py" "${APP_ENV}" "${ALERT_EMAIL}" \
    "[Autoweb] infrastructure recovered" "${body_file}" || true
  rm -f "${state_dir}/last-alert"
fi

echo "Watchdog PASS memory=${mem_used_pct}% swap=${swap_used_pct}% cpu=${cpu_used_pct}% disk=${disk_used_pct}%"
