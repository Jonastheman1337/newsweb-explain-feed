#!/bin/sh
set -u

export API_PORT="${API_PORT:-4000}"
export API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:${API_PORT}}"

npm run start -w apps/api &
api_pid=$!

npm run start -w apps/worker &
worker_pid=$!

npm run start:render -w apps/web &
web_pid=$!

cleanup() {
  kill "$api_pid" "$worker_pid" "$web_pid" 2>/dev/null || true
}

trap cleanup INT TERM

while true; do
  for pid in "$api_pid" "$worker_pid" "$web_pid"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
      exit_code=$?
      cleanup
      exit "$exit_code"
    fi
  done
  sleep 2
done
