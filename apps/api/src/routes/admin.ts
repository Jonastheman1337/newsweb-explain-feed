import { logPrisma } from "@newsweb/shared/db";
import type { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  toJsonValue,
  tryCreateUserActionEvent
} from "../services/editorial-telemetry.js";
import {
  ActiveGenerationConflictError,
  releaseRewriteGenerationSlot,
  reserveRewriteGeneration
} from "../services/rewrite-reservation.js";

const paramsSchema = z.object({
  messageId: z.coerce.number().int().positive()
});

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/admin/reprocess/:messageId", async (request, reply) => {
    const adminKey = request.headers["x-admin-key"];
    if (!adminKey || adminKey !== fastify.config.ADMIN_API_KEY) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const { messageId } = paramsSchema.parse(request.params);
    const phaseUpdatedAt = new Date();
    const generationRun = await logPrisma.generationRun.create({
      data: {
        messageId,
        version: null,
        reason: "manual-reprocess",
        status: "queued",
        phase: "queued",
        phaseUpdatedAt,
        userInstruction: null,
        inputJson: toJsonValue({
          endpoint: "/admin/reprocess/:messageId",
          messageId,
          reservation: "pending"
        })
      }
    });

    let targetVersion: number;
    let previousRewriteJson: Prisma.JsonValue | null;
    let queuedJobId: string | null = null;
    try {
      const reservation = await reserveRewriteGeneration(
        messageId,
        generationRun.id
      );
      targetVersion = reservation.targetVersion;
      previousRewriteJson = reservation.previousRewriteJson;
    } catch (error) {
      const conflictRunId =
        error instanceof ActiveGenerationConflictError
          ? error.generationRunId
          : null;
      await logPrisma.generationRun.update({
        where: { id: generationRun.id },
        data: {
          status: conflictRunId ? "superseded" : "failed",
          phase: "failed",
          phaseUpdatedAt: new Date(),
          errorText: conflictRunId
            ? `GENERATION_ALREADY_ACTIVE:${conflictRunId}`
            : error instanceof Error
              ? error.message
              : String(error),
          finishedAt: new Date()
        }
      });
      if (conflictRunId) {
        return reply.code(409).send({
          message: "Generation already active.",
          generationRunId: conflictRunId
        });
      }
      throw error;
    }

    try {
      await logPrisma.generationRun.update({
        where: { id: generationRun.id },
        data: {
          version: targetVersion,
          ...(previousRewriteJson
            ? { previousRewriteJson: toJsonValue(previousRewriteJson) }
            : {}),
          inputJson: toJsonValue({
            endpoint: "/admin/reprocess/:messageId",
            messageId,
            targetVersion,
            previousRewriteJson
          })
        }
      });

      const job = await fastify.rewriteQueue.add(
        "rewrite-manual",
        {
          messageId,
          reason: "manual-reprocess",
          generationRunId: generationRun.id,
          targetVersion,
          ...(previousRewriteJson ? { previousRewriteJson } : {})
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000
          },
          removeOnComplete: 2000,
          removeOnFail: 2000
        }
      );
      queuedJobId = job.id != null ? String(job.id) : null;
    } catch (error) {
      await releaseRewriteGenerationSlot(messageId, generationRun.id);
      await logPrisma.generationRun.update({
        where: { id: generationRun.id },
        data: {
          status: "failed",
          phase: "failed",
          phaseUpdatedAt: new Date(),
          errorText: error instanceof Error ? error.message : String(error),
          finishedAt: new Date()
        }
      });
      throw error;
    }

    await logPrisma.generationRun
      .update({
        where: { id: generationRun.id },
        data: {
          jobId: queuedJobId,
          jobName: "rewrite-manual"
        }
      })
      .catch((error) => {
        request.log.error(
          { err: error, generationRunId: generationRun.id },
          "Failed to attach queue job id to generation run"
        );
      });

    await tryCreateUserActionEvent({
      logger: request.log,
      sessionSecret: fastify.config.SESSION_SECRET,
      messageId,
      version: targetVersion,
      action: "admin_reprocess_request",
      actionSource: "admin_api",
      payload: {
        generationRunId: generationRun.id,
        jobId: queuedJobId
      }
    });

    return reply.send({
      queued: true,
      version: targetVersion,
      generationRunId: generationRun.id,
      jobId: queuedJobId
    });
  });
};
