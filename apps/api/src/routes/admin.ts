import { logPrisma, prisma } from "@newsweb/shared/db";
import type { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const paramsSchema = z.object({
  messageId: z.coerce.number().int().positive()
});

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function nextRewriteContext(messageId: number): Promise<{
  targetVersion: number;
  previousRewriteJson: Prisma.JsonValue | null;
}> {
  const maxRow = await prisma.rewrite.findFirst({
    where: { messageId },
    orderBy: { version: "desc" },
    select: { version: true }
  });
  const previousRewrite = await prisma.rewrite.findFirst({
    where: {
      messageId,
      status: { in: ["published", "pending"] }
    },
    orderBy: { version: "desc" },
    select: { rewriteJson: true }
  });
  return {
    targetVersion: (maxRow?.version ?? 0) + 1,
    previousRewriteJson: previousRewrite?.rewriteJson ?? null
  };
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/admin/reprocess/:messageId", async (request, reply) => {
    const adminKey = request.headers["x-admin-key"];
    if (!adminKey || adminKey !== fastify.config.ADMIN_API_KEY) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const { messageId } = paramsSchema.parse(request.params);
    const { targetVersion, previousRewriteJson } =
      await nextRewriteContext(messageId);
    const generationRun = await logPrisma.generationRun.create({
      data: {
        messageId,
        version: targetVersion,
        reason: "manual-reprocess",
        status: "queued",
        userInstruction: null,
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

    try {
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

      await logPrisma.generationRun.update({
        where: { id: generationRun.id },
        data: {
          jobId: job.id != null ? String(job.id) : null,
          jobName: "rewrite-manual"
        }
      });

      try {
        await logPrisma.userActionEvent.create({
          data: {
            messageId,
            version: targetVersion,
            action: "admin_reprocess_request",
            payloadJson: toJsonValue({
              generationRunId: generationRun.id,
              jobId: job.id ?? null
            })
          }
        });
      } catch (error) {
        request.log.error(
          { err: error, messageId },
          "Failed to write admin reprocess action event"
        );
      }
    } catch (error) {
      await logPrisma.generationRun.update({
        where: { id: generationRun.id },
        data: {
          status: "failed",
          errorText: error instanceof Error ? error.message : String(error),
          finishedAt: new Date()
        }
      });
      throw error;
    }

    return reply.send({
      queued: true,
      version: targetVersion
    });
  });
};
