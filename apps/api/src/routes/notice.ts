import {
  normalizeRewriteJson,
  noticeResponseSchema,
  rewriteOutputSchema
} from "@newsweb/shared";
import { logPrisma, prisma } from "@newsweb/shared/db";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { FastifyPluginAsync } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  editorialTelemetrySchema,
  passiveEditorialActionSchema,
  toJsonValue,
  tryCreateUserActionEvent
} from "../services/editorial-telemetry.js";
import {
  buildGenerationStatusPayload,
  chooseGenerationRun
} from "../services/generation-status.js";
import {
  createAttachmentContentDisposition,
  normalizeNewswebAttachments,
  resolveNewswebAttachmentDownload
} from "../services/newsweb-attachments.js";

const paramsSchema = z.object({
  messageId: z.coerce.number().int().positive()
});

const attachmentParamsSchema = z.object({
  messageId: z.coerce.number().int().positive(),
  attachmentId: z.coerce.number().int().positive()
});

const statusQuerySchema = z.object({
  jobId: z.string().optional()
});

const generateBodySchema = z
  .object({
    instruction: z.string().max(2000).optional(),
    reasoningEffortOverride: z.enum(["xhigh"]).optional(),
    telemetry: editorialTelemetrySchema
  })
  .optional();

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

function buildSourcePayload(notice: {
  messageId: number;
  title: string;
  issuerName: string;
  issuerSign: string;
  publishedAt: Date;
  categoriesJson: Prisma.JsonValue;
  marketsJson: Prisma.JsonValue;
  bodyText: string;
  hasAttachments: boolean;
  rawMessageJson: Prisma.JsonValue;
}) {
  return {
    messageId: notice.messageId,
    title: notice.title,
    issuerName: notice.issuerName,
    issuerSign: notice.issuerSign,
    publishedAt: notice.publishedAt.toISOString(),
    categories: (notice.categoriesJson as string[]) ?? [],
    markets: (notice.marketsJson as string[]) ?? [],
    bodyText: notice.bodyText,
    hasAttachments: notice.hasAttachments,
    attachments: normalizeNewswebAttachments(notice.rawMessageJson)
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
          source: buildSourcePayload(notice),
          processing: true
        });
      }

      // Failed rewrite with no published version -> keep source visible and retryable.
      if (
        latestRewrite.status === "failed" &&
        !notice.rewrites.some((r) => r.status === "published")
      ) {
        return reply.send({
          source: buildSourcePayload(notice),
          failed: true
        });
      }

      if (
        latestRewrite.status === "skipped" &&
        !notice.rewrites.some((r) => r.status === "published")
      ) {
        return reply.send({
          source: buildSourcePayload(notice),
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
        source: buildSourcePayload(notice),
        rewrite,
        rewrites
      };

      return reply.send(noticeResponseSchema.parse(payload));
    }
  );

  fastify.get(
    "/notice/:messageId/attachments/:attachmentId",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId, attachmentId } = attachmentParamsSchema.parse(
        request.params
      );
      const notice = await prisma.sourceNotice.findUnique({
        where: { messageId },
        select: { rawMessageJson: true }
      });

      if (!notice) {
        return reply.code(404).send({ message: "Notis ikke funnet." });
      }

      let download;
      try {
        download = await resolveNewswebAttachmentDownload({
          rawMessageJson: notice.rawMessageJson,
          messageId,
          attachmentId
        });
      } catch (error) {
        request.log.error(
          { err: error, messageId, attachmentId },
          "Failed to fetch Newsweb attachment"
        );
        return reply
          .code(502)
          .send({ message: "Kunne ikke laste ned vedlegg." });
      }

      if (!download.ok) {
        if (download.reason === "not_found") {
          return reply.code(404).send({ message: "Vedlegg ikke funnet." });
        }
        return reply
          .code(502)
          .send({ message: "Kunne ikke laste ned vedlegg." });
      }

      const contentLength =
        download.response.headers.get("content-length") ??
        (download.attachment.fileSize == null
          ? null
          : String(download.attachment.fileSize));
      const contentType =
        download.response.headers.get("content-type") ??
        download.attachment.fileType ??
        "application/octet-stream";

      reply.header("Content-Type", contentType);
      reply.header(
        "Content-Disposition",
        createAttachmentContentDisposition(download.attachment.fileName)
      );
      reply.header("Cache-Control", "private, no-store");
      if (contentLength) {
        reply.header("Content-Length", contentLength);
      }

      if (!download.response.body) {
        const buffer = Buffer.from(await download.response.arrayBuffer());
        return reply.send(buffer);
      }

      return reply.send(
        Readable.fromWeb(
          download.response.body as unknown as NodeReadableStream<Uint8Array>
        )
      );
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
      let jobGenerationRun = null;
      if (jobId) {
        const job = await fastify.rewriteQueue.getJob(jobId);
        jobState = job ? await job.getState() : "unknown";
        jobGenerationRun = await logPrisma.generationRun.findFirst({
          where: {
            messageId,
            jobId,
            reason: { in: ["new-message", "manual-reprocess"] }
          },
          orderBy: { requestedAt: "desc" },
          select: {
            id: true,
            status: true,
            phase: true,
            phaseUpdatedAt: true
          }
        });
      }

      const latestGenerationRun = await logPrisma.generationRun.findFirst({
        where: {
          messageId,
          reason: { in: ["new-message", "manual-reprocess"] }
        },
        orderBy: { requestedAt: "desc" },
        select: {
          id: true,
          status: true,
          phase: true,
          phaseUpdatedAt: true
        }
      });

      return reply.send(
        buildGenerationStatusPayload({
          generationRun: chooseGenerationRun(jobGenerationRun, latestGenerationRun),
          rewrite,
          jobState
        })
      );
    }
  );

  const eventBodySchema = z.object({
    action: passiveEditorialActionSchema,
    telemetry: editorialTelemetrySchema,
    payload: z.unknown().optional()
  });

  fastify.post(
    "/notice/:messageId/event",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      const body = eventBodySchema.parse(request.body ?? {});

      const event = await tryCreateUserActionEvent({
        logger: request.log,
        sessionSecret: fastify.config.SESSION_SECRET,
        messageId,
        action: body.action,
        telemetry: body.telemetry,
        actionSource: body.telemetry?.actionSource ?? "notice_page",
        payload: body.payload ?? {}
      });

      return reply.send({ ok: true, eventId: event.id });
    }
  );

  const editLogBodySchema = z.object({
    originalTitle: z.string(),
    originalBody: z.string(),
    editedTitle: z.string(),
    editedBody: z.string(),
    hasEdits: z.boolean(),
    telemetry: editorialTelemetrySchema
  });

  fastify.post(
    "/notice/:messageId/edit-log",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      const body = editLogBodySchema.parse(request.body);
      const action = body.hasEdits ? "copy_text_with_edits" : "copy_text";
      const event = await tryCreateUserActionEvent({
        logger: request.log,
        sessionSecret: fastify.config.SESSION_SECRET,
        messageId,
        action,
        telemetry: body.telemetry,
        actionSource: body.telemetry?.actionSource ?? "editable_rewrite",
        payload: {
          originalTitle: body.originalTitle,
          originalBody: body.originalBody,
          editedTitle: body.editedTitle,
          editedBody: body.editedBody,
          hasEdits: body.hasEdits
        }
      });

      try {
        await prisma.editLog.create({
          data: {
            eventId: event.id,
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

      return reply.send({ ok: true });
    }
  );

  const feedbackBodySchema = z.object({
    text: z.string().min(1).max(2000),
    version: z.number().int().positive().optional(),
    telemetry: editorialTelemetrySchema
  });

  fastify.post(
    "/notice/:messageId/feedback",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      const body = feedbackBodySchema.parse(request.body);
      const event = await tryCreateUserActionEvent({
        logger: request.log,
        sessionSecret: fastify.config.SESSION_SECRET,
        messageId,
        version: body.version ?? null,
        action: "feedback_submit",
        telemetry: body.telemetry,
        actionSource: body.telemetry?.actionSource ?? "instruction_input",
        payload: {
          text: body.text,
          version: body.version ?? null
        }
      });

      await prisma.feedback.create({
        data: {
          eventId: event.id,
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
    selectedTitle: z.string().nullable().optional(),
    selectedIndex: z.number().int().nonnegative().nullable().optional(),
    selectedWasOriginal: z.boolean().optional(),
    action: z
      .enum([
        "title_suggestion_request",
        "title_suggestion_refresh",
        "title_suggestion_select"
      ])
      .optional(),
    telemetry: editorialTelemetrySchema
  });

  fastify.post(
    "/notice/:messageId/title-suggestion-log",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      const body = titleSuggestionLogSchema.parse(request.body);
      const action =
        body.action ??
        (body.selectedTitle
          ? "title_suggestion_select"
          : "title_suggestion_request");
      const event = await tryCreateUserActionEvent({
        logger: request.log,
        sessionSecret: fastify.config.SESSION_SECRET,
        messageId,
        action,
        telemetry: body.telemetry,
        actionSource: body.telemetry?.actionSource ?? "title_suggestions",
        payload: {
          currentTitle: body.currentTitle,
          suggestions: body.suggestions,
          selectedTitle: body.selectedTitle ?? null,
          selectedIndex: body.selectedIndex ?? null,
          selectedWasOriginal: body.selectedWasOriginal ?? false
        }
      });

      try {
        await prisma.titleSuggestionLog.create({
          data: {
            eventId: event.id,
            messageId,
            currentTitle: body.currentTitle,
            suggestions: body.suggestions,
            selectedTitle: body.selectedTitle ?? null,
            action,
            selectedIndex: body.selectedIndex ?? null,
            selectedWasOriginal: body.selectedWasOriginal ?? false
          }
        });
      } catch (error) {
        request.log.error(
          { err: error, messageId },
          "Failed to write title suggestion log"
        );
      }

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
      const reasoningEffortOverride = body?.reasoningEffortOverride;
      const { targetVersion, previousRewriteJson } =
        await nextRewriteContext(messageId);
      const phaseUpdatedAt = new Date();
      const generationRun = await logPrisma.generationRun.create({
        data: {
          messageId,
          version: targetVersion,
          reason: "manual-reprocess",
          status: "queued",
          phase: "queued",
          phaseUpdatedAt,
          userInstruction: instruction ?? null,
          ...(previousRewriteJson
            ? { previousRewriteJson: toJsonValue(previousRewriteJson) }
            : {}),
          inputJson: toJsonValue({
            endpoint: "/notice/:messageId/generate",
            messageId,
            targetVersion,
            previousRewriteJson,
            instruction: instruction ?? null,
            reasoningEffortOverride: reasoningEffortOverride ?? null
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
            ...(reasoningEffortOverride ? { reasoningEffortOverride } : {}),
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
            phase: "failed",
            phaseUpdatedAt: new Date(),
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

      await tryCreateUserActionEvent({
        logger: request.log,
        sessionSecret: fastify.config.SESSION_SECRET,
        messageId,
        version: body?.telemetry?.version ?? null,
        action: "regenerate_request",
        telemetry: body?.telemetry,
        actionSource: body?.telemetry?.actionSource ?? "instruction_input",
        payload: {
          instruction: instruction ?? null,
          reasoningEffortOverride: reasoningEffortOverride ?? null,
          targetVersion,
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
