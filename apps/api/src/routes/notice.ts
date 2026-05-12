import {
  normalizeRewriteJson,
  noticeResponseSchema,
  rewriteOutputSchema
} from "@newsweb/shared";
import { logPrisma, prisma } from "@newsweb/shared/db";
import type { FastifyBaseLogger, FastifyPluginAsync } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

const paramsSchema = z.object({
  messageId: z.coerce.number().int().positive()
});

const statusQuerySchema = z.object({
  jobId: z.string().optional()
});

const generateBodySchema = z
  .object({
    instruction: z.string().max(2000).optional()
  })
  .optional();

const RUNNING_JOB_STATES = new Set([
  "active",
  "delayed",
  "prioritized",
  "waiting",
  "waiting-children"
]);

function isJobStillRunning(jobState: string | null): boolean {
  return jobState ? RUNNING_JOB_STATES.has(jobState) : false;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function logUserAction(
  logger: FastifyBaseLogger,
  args: {
    messageId: number;
    version?: number | null;
    action: string;
    payload?: unknown;
  }
): Promise<void> {
  try {
    await logPrisma.userActionEvent.create({
      data: {
        messageId: args.messageId,
        version: args.version ?? null,
        action: args.action,
        payloadJson: toJsonValue(args.payload ?? {})
      }
    });
  } catch (error) {
    logger.error(
      { err: error, action: args.action, messageId: args.messageId },
      "Failed to write user action event"
    );
  }
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

export const noticeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/notice/:messageId",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      const notice = await prisma.sourceNotice.findUnique({
        where: { messageId },
        include: {
          rewrites: {
            orderBy: { version: "asc" }
          }
        }
      });

      if (!notice) {
        return reply.code(404).send({ message: "Notis ikke funnet." });
      }

      const publishedRewrites = notice.rewrites.filter(
        (r) => r.status === "published"
      );

      // Find the latest rewrite by generatedAt for backward-compat status checks
      const latestRewrite = notice.rewrites.length
        ? notice.rewrites.reduce((a, b) =>
            a.generatedAt > b.generatedAt ? a : b
          )
        : null;

      // No rewrite, or still pending with no published fallback -> processing
      if (
        !latestRewrite ||
        ((latestRewrite.status === "pending" ||
          latestRewrite.status === "needs_retry") &&
          publishedRewrites.length === 0)
      ) {
        return reply.send({
          source: {
            messageId: notice.messageId,
            title: notice.title,
            issuerName: notice.issuerName,
            issuerSign: notice.issuerSign,
            publishedAt: notice.publishedAt.toISOString(),
            categories: (notice.categoriesJson as string[]) ?? [],
            markets: (notice.marketsJson as string[]) ?? [],
            bodyText: notice.bodyText,
            hasAttachments: notice.hasAttachments
          },
          processing: true
        });
      }

      // Failed rewrite with no published version → 404
      if (
        latestRewrite.status === "failed" &&
        !notice.rewrites.some((r) => r.status === "published")
      ) {
        return reply
          .code(404)
          .send({ message: "Omskrivingen feilet." });
      }

      if (
        latestRewrite.status === "skipped" &&
        !notice.rewrites.some((r) => r.status === "published")
      ) {
        return reply.send({
          source: {
            messageId: notice.messageId,
            title: notice.title,
            issuerName: notice.issuerName,
            issuerSign: notice.issuerSign,
            publishedAt: notice.publishedAt.toISOString(),
            categories: (notice.categoriesJson as string[]) ?? [],
            markets: (notice.marketsJson as string[]) ?? [],
            bodyText: notice.bodyText,
            hasAttachments: notice.hasAttachments
          },
          skipped: true
        });
      }

      // Build rewrites array from all published versions
      const latestPublished = publishedRewrites.length
        ? publishedRewrites[publishedRewrites.length - 1]
        : latestRewrite;

      const rewrite = rewriteOutputSchema.parse(
        normalizeRewriteJson(latestPublished.rewriteJson)
      );

      const rewrites = publishedRewrites.map((r) => ({
        version: r.version,
        rewrite: rewriteOutputSchema.parse(
          normalizeRewriteJson(r.rewriteJson)
        ),
        userInstruction: r.userInstruction,
        generatedAt: r.generatedAt.toISOString()
      }));

      const payload = {
        source: {
          messageId: notice.messageId,
          title: notice.title,
          issuerName: notice.issuerName,
          issuerSign: notice.issuerSign,
          publishedAt: notice.publishedAt.toISOString(),
          categories: (notice.categoriesJson as string[]) ?? [],
          markets: (notice.marketsJson as string[]) ?? [],
          bodyText: notice.bodyText,
          hasAttachments: notice.hasAttachments
        },
        rewrite,
        rewrites
      };

      return reply.send(noticeResponseSchema.parse(payload));
    }
  );

  fastify.get(
    "/notice/:messageId/status",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      const { jobId } = statusQuerySchema.parse(request.query);
      const rewrite = await prisma.rewrite.findFirst({
        where: { messageId },
        orderBy: { generatedAt: "desc" },
        select: { status: true, generatedAt: true, version: true }
      });

      let jobState: string | null = null;
      if (jobId) {
        const job = await fastify.rewriteQueue.getJob(jobId);
        jobState = job ? await job.getState() : "unknown";
      }

      if (!rewrite) {
        return reply.send({
          ready: false,
          failed: false,
          generatedAt: null,
          version: null,
          jobState
        });
      }

      const failed = rewrite.status === "failed" && !isJobStillRunning(jobState);

      return reply.send({
        ready: rewrite.status === "published" || rewrite.status === "skipped",
        failed,
        generatedAt: rewrite.generatedAt.toISOString(),
        version: rewrite.version,
        jobState: failed && jobState === "completed" ? "failed" : jobState
      });
    }
  );

  const editLogBodySchema = z.object({
    originalTitle: z.string(),
    originalBody: z.string(),
    editedTitle: z.string(),
    editedBody: z.string(),
    hasEdits: z.boolean()
  });

  fastify.post(
    "/notice/:messageId/edit-log",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      const body = editLogBodySchema.parse(request.body);

      try {
        await prisma.editLog.create({
          data: {
            messageId,
            originalTitle: body.originalTitle,
            originalBody: body.originalBody,
            editedTitle: body.editedTitle,
            editedBody: body.editedBody,
            hasEdits: body.hasEdits
          }
        });
      } catch (error) {
        request.log.error(
          { err: error, messageId },
          "Failed to write edit log"
        );
      }

      await logUserAction(request.log, {
        messageId,
        action: body.hasEdits ? "copy_text_with_edits" : "copy_text",
        payload: body
      });

      return reply.send({ ok: true });
    }
  );

  const feedbackBodySchema = z.object({
    text: z.string().min(1).max(2000),
    version: z.number().int().positive().optional()
  });

  fastify.post(
    "/notice/:messageId/feedback",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      const body = feedbackBodySchema.parse(request.body);

      await prisma.feedback.create({
        data: {
          messageId,
          version: body.version ?? null,
          text: body.text
        }
      });

      await logUserAction(request.log, {
        messageId,
        version: body.version ?? null,
        action: "feedback_submit",
        payload: body
      });

      return reply.send({ ok: true });
    }
  );

  const titleSuggestionLogSchema = z.object({
    currentTitle: z.string(),
    suggestions: z.array(z.string()),
    selectedTitle: z.string().nullable().optional(),
    action: z
      .enum([
        "title_suggestion_request",
        "title_suggestion_refresh",
        "title_suggestion_select"
      ])
      .optional()
  });

  fastify.post(
    "/notice/:messageId/title-suggestion-log",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      const body = titleSuggestionLogSchema.parse(request.body);

      try {
        await prisma.titleSuggestionLog.create({
          data: {
            messageId,
            currentTitle: body.currentTitle,
            suggestions: body.suggestions,
            selectedTitle: body.selectedTitle ?? null
          }
        });
      } catch (error) {
        request.log.error(
          { err: error, messageId },
          "Failed to write title suggestion log"
        );
      }

      await logUserAction(request.log, {
        messageId,
        action:
          body.action ??
          (body.selectedTitle
            ? "title_suggestion_select"
            : "title_suggestion_request"),
        payload: body
      });

      return reply.send({ ok: true });
    }
  );

  fastify.post(
    "/notice/:messageId/generate",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      const body = generateBodySchema.parse(request.body);

      const source = await prisma.sourceNotice.findUnique({
        where: { messageId },
        select: { messageId: true }
      });

      if (!source) {
        return reply.code(404).send({ message: "Notis ikke funnet." });
      }

      const instruction = body?.instruction?.trim() || undefined;
      const { targetVersion, previousRewriteJson } =
        await nextRewriteContext(messageId);
      const generationRun = await logPrisma.generationRun.create({
        data: {
          messageId,
          version: targetVersion,
          reason: "manual-reprocess",
          status: "queued",
          userInstruction: instruction ?? null,
          ...(previousRewriteJson
            ? { previousRewriteJson: toJsonValue(previousRewriteJson) }
            : {}),
          inputJson: toJsonValue({
            endpoint: "/notice/:messageId/generate",
            messageId,
            targetVersion,
            previousRewriteJson,
            instruction: instruction ?? null
          })
        }
      });

      let job;
      try {
        job = await fastify.rewriteQueue.add(
          "rewrite-on-demand",
          {
            messageId,
            reason: "manual-reprocess",
            generationRunId: generationRun.id,
            targetVersion,
            ...(previousRewriteJson ? { previousRewriteJson } : {}),
            ...(instruction ? { instruction } : {})
          },
          {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: 2000,
            removeOnFail: 2000
          }
        );
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

      await logPrisma.generationRun.update({
        where: { id: generationRun.id },
        data: {
          jobId: job.id != null ? String(job.id) : null,
          jobName: "rewrite-on-demand"
        }
      });

      await logUserAction(request.log, {
        messageId,
        version: targetVersion,
        action: "regenerate_request",
        payload: {
          instruction: instruction ?? null,
          generationRunId: generationRun.id,
          jobId: job.id ?? null
        }
      });

      return reply.send({
        queued: true,
        jobId: job.id ?? null,
        version: targetVersion
      });
    }
  );
};
