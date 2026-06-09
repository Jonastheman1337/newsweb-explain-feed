#!/bin/sh
set -u

export API_PORT="${API_PORT:-4000}"
export API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:${API_PORT}}"

pids=""

npm run start -w apps/api &
api_pid=$!
pids="$pids $api_pid"

if [ "${START_WORKER:-true}" = "true" ]; then
  npm run start -w apps/worker &
  worker_pid=$!
  pids="$pids $worker_pid"
else
  echo "[render-start] START_WORKER=false; skipping worker"
fi

npm run start:render -w apps/web &
web_pid=$!
pids="$pids $web_pid"

cleanup() {
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done
}

trap cleanup INT TERM

while true; do
  for pid in $pids; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
      exit_code=$?
      cleanup
      exit "$exit_code"
    fi
  done
  sleep 2
done
