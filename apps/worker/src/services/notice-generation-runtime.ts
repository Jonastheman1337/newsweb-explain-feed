import { type PrismaClient } from "@prisma/client";
import { DelayedError, type Job, type Queue } from "bullmq";
import type { Redis } from "ioredis";
import {
  acknowledgeGenerationCancellation,
  admitGenerationRequest,
  generationJobId,
  jsonSnapshot,
} from "@newsweb/shared/generation-control";
import { withGenerationSignal } from "@newsweb/shared/generation-context";

export type ControlledJobData = {
  messageId: number;
  generationRunId?: string;
  targetVersion?: number;
  [key: string]: unknown;
};
export const CONTROLLED_JOB_NAME = "notice-editor-rewrite";
export function createNoticeGenerationRuntime(deps: {
  db: PrismaClient;
  logDb: PrismaClient;
  rewriteQueue: Queue;
  publishQueue: Queue;
  redis: Redis;
  notify: (messageId: number) => Promise<unknown>;
}) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;
  let stopped = false;
  async function finish(runId: string, status: string, errorText?: string) {
    const row = await deps.db.noticeGenerationControl.findUnique({
      where: { generationRunId: runId },
    });
    if (!row) return;
    await deps.db.noticeGenerationControl.updateMany({
      where: { generationRunId: runId, status: { in: ["running", "queued"] } },
      data: { status, errorText: errorText ?? null, finishedAt: new Date() },
    });
    await deps.db.feedItem.updateMany({
      where: { messageId: row.messageId, activeGenerationRunId: runId },
      data: { activeGenerationRunId: null },
    });
    await deps.notify(row.messageId);
  }
  async function enqueue(runId: string, messageId: number) {
    await deps.rewriteQueue.add(
      CONTROLLED_JOB_NAME,
      { messageId, generationRunId: runId, reason: "manual-reprocess" },
      {
        jobId: generationJobId(runId),
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 2000,
        removeOnFail: 2000,
      },
    );
  }
  async function tick() {
    if (ticking || stopped) return;
    ticking = true;
    try {
      const rows = await deps.db.noticeGenerationControl.findMany({
        where: { status: { in: ["queued", "running", "cancelling"] } },
        orderBy: { position: "asc" },
        take: 100,
      });
      for (const row of rows) {
        const job = await deps.rewriteQueue.getJob(
          generationJobId(row.generationRunId),
        );
        const state = job ? await job.getState() : "missing";
        if (row.status === "cancelling") {
          if (state !== "active") {
            await acknowledgeGenerationCancellation(
              deps.db,
              row.generationRunId,
            );
            await deps.logDb.generationRun.updateMany({
              where: { id: row.generationRunId, status: { not: "published" } },
              data: { status: "cancelled", phase: null, finishedAt: new Date() },
            });
            await deps.notify(row.messageId);
          }
          continue;
        }
        if (row.status === "queued") {
          if (state === "completed" || state === "failed") await job?.remove();
          if (["missing", "completed", "failed"].includes(state))
            await enqueue(row.generationRunId, row.messageId);
          continue;
        }
        if (
          [
            "active",
            "waiting",
            "delayed",
            "prioritized",
            "waiting-children",
          ].includes(state)
        )
          continue;
        const publication = await deps.db.publishedRewrite.findUnique({
          where: { generationRunId: row.generationRunId },
        });
        if (publication) {
          await deps.db.noticeGenerationControl.updateMany({
            where: { generationRunId: row.generationRunId, status: "running" },
            data: {
              status: "published",
              resultRewriteId: publication.id,
              finishedAt: new Date(),
            },
          });
          await finish(row.generationRunId, "published");
          continue;
        }
        const candidate = await deps.db.rewrite.findFirst({
          where: { generationRunId: row.generationRunId },
          orderBy: { version: "desc" },
        });
        if (candidate?.status === "pending") {
          const id = `notice-request-publish-${row.generationRunId}`;
          const publish = await deps.publishQueue.getJob(id);
          if (
            publish &&
            ["completed", "failed"].includes(await publish.getState())
          )
            await publish.remove();
          await deps.publishQueue.add(
            "publish-rewrite",
            {
              messageId: row.messageId,
              version: candidate.version,
              generationRunId: row.generationRunId,
            },
            {
              jobId: id,
              attempts: 3,
              removeOnComplete: 2000,
              removeOnFail: 2000,
            },
          );
        } else if (candidate?.status === "skipped")
          await finish(row.generationRunId, "skipped");
        else if (state === "failed" || candidate?.status === "failed")
          await finish(
            row.generationRunId,
            "failed",
            job?.failedReason || "Generering feilet.",
          );
        else {
          // A crash after admission but before queue/worker persistence keeps
          // the same request, snapshot, owner and reserved version on recovery.
          if (job) await job.remove();
          await deps.db.noticeGenerationControl.updateMany({
            where: { generationRunId: row.generationRunId, status: "running" },
            data: { status: "queued" },
          });
          await enqueue(row.generationRunId, row.messageId);
        }
      }
      await deps.redis.set(
        "newsweb:notice-editor-worker:v1",
        "ready",
        "EX",
        15,
      );
    } finally {
      ticking = false;
    }
  }
  async function run<
    T extends {
      messageId: number;
      generationRunId?: string;
      targetVersion?: number;
    },
  >(job: Job<T>, token: string | undefined, execute: () => Promise<unknown>) {
    const controlled = job.name === CONTROLLED_JOB_NAME;
    if (controlled) {
      const admitted = await admitGenerationRequest(
        deps.db,
        job.data.generationRunId!,
      );
      if (admitted.kind === "busy") {
        await job.moveToDelayed(Date.now() + 1000, token);
        throw new DelayedError();
      }
      if (admitted.kind !== "admitted") {
        if (
          admitted.kind === "terminal" &&
          admitted.row.status === "cancelling"
        )
          await acknowledgeGenerationCancellation(
            deps.db,
            admitted.row.generationRunId,
          );
        return;
      }
      const row = admitted.row;
      const snapshot = row.snapshotJson as Record<string, unknown>;
      job.data = {
        ...job.data,
        reason: "manual-reprocess",
        targetVersion: row.targetVersion!,
        instruction: snapshot.instruction ?? undefined,
        outputMode: snapshot.outputMode,
        maxVisibleArticleChars: snapshot.maxVisibleArticleChars,
        reasoningEffortOverride: snapshot.reasoningEffortOverride ?? undefined,
        supplementalMaterials: snapshot.supplementalMaterials,
        previousRewriteJson: snapshot.previousRewriteJson ?? undefined,
      } as T;
      await job.updateData(job.data);
      await deps.logDb.generationRun.upsert({
        where: { id: row.generationRunId },
        update: {},
        create: {
          id: row.generationRunId,
          messageId: row.messageId,
          reason: "manual-reprocess",
          status: "queued",
          phase: "queued",
          phaseUpdatedAt: new Date(),
          version: row.targetVersion,
          jobId: job.id,
          jobName: job.name,
          inputJson: jsonSnapshot(snapshot),
          requestedAt: row.createdAt,
        },
      });
    }
    const controller = new AbortController();
    let checking = false;
    async function check() {
      if (checking || !job.data.generationRunId) return;
      checking = true;
      try {
        const row = await deps.db.noticeGenerationControl.findUnique({
          where: { generationRunId: job.data.generationRunId },
        });
        if (row && ["cancelling", "cancelled"].includes(row.status))
          controller.abort(new Error("GENERATION_CANCELLED"));
        else if (row?.status === "running")
          await deps.db.noticeGenerationControl.updateMany({
            where: { generationRunId: row.generationRunId, status: "running" },
            data: { heartbeatAt: new Date() },
          });
      } finally {
        checking = false;
      }
    }
    await check();
    const heartbeat = setInterval(
      () => void check().catch((error) => controller.abort(error)),
      500,
    );
    heartbeat.unref();
    try {
      controller.signal.throwIfAborted();
      return await withGenerationSignal(controller.signal, execute);
    } catch (error) {
      const row = job.data.generationRunId
        ? await deps.db.noticeGenerationControl.findUnique({
            where: { generationRunId: job.data.generationRunId },
          })
        : null;
      if (row && ["cancelling", "cancelled"].includes(row.status)) return;
      if (controlled && job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        const candidate = await deps.db.rewrite.findFirst({
          where: {
            generationRunId: job.data.generationRunId,
            status: "pending",
          },
        });
        if (!candidate)
          await finish(
            job.data.generationRunId!,
            "failed",
            error instanceof Error ? error.message : String(error),
          );
      }
      throw error;
    } finally {
      clearInterval(heartbeat);
      if (job.data.generationRunId) {
        const row = await deps.db.noticeGenerationControl.findUnique({
          where: { generationRunId: job.data.generationRunId },
        });
        if (row && ["cancelling", "cancelled"].includes(row.status)) {
          await acknowledgeGenerationCancellation(deps.db, row.generationRunId);
          await deps.logDb.generationRun.updateMany({
            where: { id: row.generationRunId, status: { not: "published" } },
            data: { status: "cancelled", phase: null, finishedAt: new Date() },
          });
          await deps.notify(row.messageId);
        }
      }
    }
  }
  return {
    run,
    tick,
    start() {
      stopped = false;
      timer = setInterval(
        () =>
          void tick().catch((error) =>
            console.error("notice request recovery", error),
          ),
        1000,
      );
      timer.unref();
      void tick().catch((error) =>
        console.error("notice request recovery", error),
      );
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      while (ticking) await new Promise((resolve) => setTimeout(resolve, 10));
      await deps.redis.del("newsweb:notice-editor-worker:v1");
    },
  };
}
