#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && $1 != "--assert-drained" ) ]]; then
  echo "Usage: render-queue-status.sh [--assert-drained]" >&2
  exit 1
fi

AUTOWEB_ROOT=${AUTOWEB_ROOT:-/srv/autoweb}
HOST_ENV=${HOST_ENV:-${AUTOWEB_ROOT}/secrets/host.env}
RENDER_KV_ENV=${RENDER_KV_ENV:-${AUTOWEB_ROOT}/secrets/render-kv.env}
[[ -f ${HOST_ENV} && -f ${RENDER_KV_ENV} ]] || {
  echo "Render queue connection input is missing." >&2
  exit 1
}
[[ $(stat -c '%a' "${RENDER_KV_ENV}") == "600" ]] || {
  echo "${RENDER_KV_ENV} must have mode 600." >&2
  exit 1
}

set -a
source "${HOST_ENV}"
source "${RENDER_KV_ENV}"
set +a
[[ -n ${RENDER_REDIS_URL:-} ]] || {
  echo "RENDER_REDIS_URL is missing." >&2
  exit 1
}
[[ ${APP_RELEASE_SHA:-} =~ ^[0-9a-f]{40}$ ]] || {
  echo "APP_RELEASE_SHA is invalid." >&2
  exit 1
}

assert_drained=false
[[ ${1:-} == "--assert-drained" ]] && assert_drained=true

docker run --rm -i \
  --env RENDER_REDIS_URL \
  --env "ASSERT_DRAINED=${assert_drained}" \
  "autoweb-worker:${APP_RELEASE_SHA}" \
  node <<'NODE'
const { Queue } = require("bullmq");
const Redis = require("ioredis");

const connection = new Redis(process.env.RENDER_REDIS_URL, {
  maxRetriesPerRequest: null,
});
const queueNames = ["notice-ingest", "notice-rewrite", "notice-publish"];
const allowedIngestDelayed = new Set([
  "poll-list",
  "cleanup-job-runs",
  "numeric-shadow-monitor",
]);
const queues = queueNames.map((name) => new Queue(name, { connection }));

(async () => {
  let blocked = false;
  const results = [];
  try {
    for (const queue of queues) {
      const counts = await queue.getJobCounts(
        "active",
        "waiting",
        "delayed",
        "prioritized",
        "waiting-children",
        "paused",
      );
      const delayedJobs = await queue.getJobs(["delayed"], 0, 100, true);
      const delayed = delayedJobs.map((job) => ({ id: job.id, name: job.name }));
      const unsafeDelayed = delayed.filter((job) =>
        queue.name === "notice-ingest"
          ? !allowedIngestDelayed.has(job.name)
          : true,
      );
      if (
        counts.active ||
        counts.waiting ||
        counts.prioritized ||
        counts["waiting-children"] ||
        counts.paused ||
        unsafeDelayed.length
      ) {
        blocked = true;
      }
      results.push({ queue: queue.name, counts, delayed, unsafeDelayed });
    }
    process.stdout.write(`${JSON.stringify({ blocked, queues: results }, null, 2)}\n`);
  } finally {
    await Promise.all(queues.map((queue) => queue.close()));
    connection.disconnect();
  }

  if (process.env.ASSERT_DRAINED === "true" && blocked) process.exitCode = 2;
})().catch((error) => {
  console.error(`Render queue status failed: ${error.message}`);
  process.exitCode = 1;
});
NODE
