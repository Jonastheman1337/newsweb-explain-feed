import {
  normalizeRewriteJson,
  noticeResponseSchema,
  rewriteOutputSchema
} from "@newsweb/shared";
import { prisma } from "@newsweb/shared/db";
import type { FastifyPluginAsync } from "fastify";
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

      // Find the latest rewrite by generatedAt for backward-compat status checks
      const latestRewrite = notice.rewrites.length
        ? notice.rewrites.reduce((a, b) =>
            a.generatedAt > b.generatedAt ? a : b
          )
        : null;

      // No rewrite or still pending → processing
      if (
        !latestRewrite ||
        latestRewrite.status === "pending" ||
        latestRewrite.status === "needs_retry"
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
      const publishedRewrites = notice.rewrites.filter(
        (r) => r.status === "published"
      );
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

      return reply.send({
        ready: rewrite.status === "published" || rewrite.status === "skipped",
        failed: rewrite.status === "failed",
        generatedAt: rewrite.generatedAt.toISOString(),
        version: rewrite.version,
        jobState
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

      return reply.send({ ok: true });
    }
  );

  const titleSuggestionLogSchema = z.object({
    currentTitle: z.string(),
    suggestions: z.array(z.string()),
    selectedTitle: z.string().nullable().optional()
  });

  fastify.post(
    "/notice/:messageId/title-suggestion-log",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      const body = titleSuggestionLogSchema.parse(request.body);

      await prisma.titleSuggestionLog.create({
        data: {
          messageId,
          currentTitle: body.currentTitle,
          suggestions: body.suggestions,
          selectedTitle: body.selectedTitle ?? null
        }
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

      const job = await fastify.rewriteQueue.add(
        "rewrite-on-demand",
        {
          messageId,
          reason: "manual-reprocess",
          ...(body?.instruction ? { instruction: body.instruction } : {})
        },
        {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 2000,
          removeOnFail: 2000
        }
      );

      return reply.send({ queued: true, jobId: job.id ?? null });
    }
  );
};
