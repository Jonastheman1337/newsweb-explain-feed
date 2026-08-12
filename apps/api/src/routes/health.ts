import { healthResponseSchema } from "@newsweb/shared";
import { prisma } from "@newsweb/shared/db";
import type { FastifyPluginAsync } from "fastify";

function percentile(values: number[], p: number): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async (_request, reply) => {
    let db: "up" | "down" = "up";
    let redis: "up" | "down" = "up";
    let worker: "up" | "down" | "disabled" = "disabled";
    let queueLagSec = 0;
    let modelLatencyP95 = 0;

    const workerExpected =
      fastify.config.NEWSWEB_POLLING_ENABLED && fastify.config.START_WORKER;

    // These probes are independent and must fit inside Render's five-second
    // health-check deadline. Running them serially made cold-start checks take
    // long enough for the web proxy to abort and Render to restart the instance.
    const [dbProbe, redisProbe, queueProbe, workerProbe, latencyProbe] =
      await Promise.allSettled([
        prisma.$queryRaw`SELECT 1`,
        fastify.redis.ping(),
        fastify.rewriteQueue.getJobs(["waiting", "delayed"], 0, 50),
        workerExpected
          ? prisma.jobRun.findFirst({
              where: { jobType: "poll" },
              orderBy: { startedAt: "desc" },
              select: { startedAt: true }
            })
          : Promise.resolve(null),
        prisma.jobRun.findMany({
          where: {
            jobType: "rewrite",
            status: "success",
            finishedAt: { not: null }
          },
          orderBy: {
            startedAt: "desc"
          },
          take: 120
        })
      ]);

    if (dbProbe.status === "rejected") {
      db = "down";
    }

    if (redisProbe.status === "rejected") {
      redis = "down";
    }

    if (queueProbe.status === "fulfilled") {
      const waitingJobs = queueProbe.value;
      const oldestTimestamp = waitingJobs.reduce<number>(
        (oldest, job) =>
          oldest === 0 ? job.timestamp : Math.min(oldest, job.timestamp),
        0
      );
      queueLagSec =
        oldestTimestamp > 0
          ? Math.max(0, Math.floor((Date.now() - oldestTimestamp) / 1000))
          : 0;
    } else {
      redis = "down";
    }

    if (workerExpected) {
      // The worker heartbeat is its poll job: one job_runs row per poll cycle.
      // A stale (or missing) latest row means the process is alive-but-wedged;
      // the resulting 503 makes Render restart the container — the same
      // recovery path the process supervisor already uses for crashes.
      if (workerProbe.status === "fulfilled") {
        const lastPollAt = workerProbe.value?.startedAt ?? null;
        worker =
          lastPollAt &&
          Date.now() - lastPollAt.getTime() < fastify.config.WORKER_HEARTBEAT_STALE_MS
            ? "up"
            : "down";
      } else {
        db = "down";
        worker = "down";
      }
    }

    if (latencyProbe.status === "fulfilled") {
      const latenciesMs = latencyProbe.value
        .filter((run) => run.finishedAt)
        .map((run) => run.finishedAt!.getTime() - run.startedAt.getTime())
        .filter((value) => value >= 0);
      modelLatencyP95 = percentile(latenciesMs, 0.95);
    } else {
      db = "down";
    }

    const payload = healthResponseSchema.parse({
      ok: db === "up" && redis === "up" && worker !== "down",
      db,
      redis,
      worker,
      queueLagSec,
      modelLatencyP95
    });

    return reply.code(payload.ok ? 200 : 503).send(payload);
  });
};
