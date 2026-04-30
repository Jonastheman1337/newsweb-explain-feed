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

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "down";
    }

    try {
      await fastify.redis.ping();
    } catch {
      redis = "down";
    }

    const waitingJobs = await fastify.rewriteQueue.getJobs(
      ["waiting", "delayed"],
      0,
      50
    );

    const oldestTimestamp = waitingJobs.reduce<number>(
      (oldest, job) => (oldest === 0 ? job.timestamp : Math.min(oldest, job.timestamp)),
      0
    );
    const queueLagSec =
      oldestTimestamp > 0
        ? Math.max(0, Math.floor((Date.now() - oldestTimestamp) / 1000))
        : 0;

    const recentRuns = await prisma.jobRun.findMany({
      where: {
        jobType: "rewrite",
        status: "success",
        finishedAt: { not: null }
      },
      orderBy: {
        startedAt: "desc"
      },
      take: 120
    });

    const latenciesMs = recentRuns
      .filter((run) => run.finishedAt)
      .map((run) => run.finishedAt!.getTime() - run.startedAt.getTime())
      .filter((value) => value >= 0);

    const payload = healthResponseSchema.parse({
      ok: db === "up" && redis === "up",
      db,
      redis,
      queueLagSec,
      modelLatencyP95: percentile(latenciesMs, 0.95)
    });

    return reply.send(payload);
  });
};
