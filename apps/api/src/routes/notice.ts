import {
  fixDoubleEncodedUtf8,
  normalizeRewriteJson,
  noticeMaterialsResponseSchema,
  noticeResponseSchema,
  outputModeSchema,
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
import {
  MAX_TOTAL_MATERIAL_TEXT_CHARS,
  extractPdfMaterialText,
  fetchNewswebMaterial,
  parseNewswebMaterialMessageId,
  pdfTitleFromFileName,
  sanitizeMaterialTitle,
  truncateMaterialText
} from "../services/notice-materials.js";
import {
  ActiveGenerationConflictError,
  releaseRewriteGenerationSlot,
  reserveRewriteGeneration
} from "../services/rewrite-reservation.js";

const paramsSchema = z.object({
  messageId: z.coerce.number().int().positive()
});

const attachmentParamsSchema = z.object({
  messageId: z.coerce.number().int().positive(),
  attachmentId: z.coerce.number().int().positive()
});

const materialParamsSchema = z.object({
  messageId: z.coerce.number().int().positive(),
  materialId: z.string().min(1).max(80)
});

const statusQuerySchema = z.object({
  jobId: z.string().optional()
});

const generateBodySchema = z
  .object({
    instruction: z.string().max(2000).optional(),
    outputMode: outputModeSchema.optional(),
    selectedMaterialIds: z.array(z.string().min(1).max(80)).max(20).optional(),
    reasoningEffortOverride: z.enum(["xhigh"]).optional(),
    telemetry: editorialTelemetrySchema
  })
  .optional();

const textMaterialBodySchema = z.object({
  title: z.string().max(180).optional(),
  text: z.string().min(1).max(50_000)
});

const newswebMaterialBodySchema = z.object({
  url: z.string().min(1).max(500).optional(),
  messageId: z.coerce.number().int().positive().optional()
}).refine((value) => value.url || value.messageId, {
  message: "Newsweb-lenke eller messageId mangler."
});

const updateMaterialBodySchema = z.object({
  enabled: z.boolean()
});

type MaterialSnapshot = {
  id: string;
  sourceId: string;
  kind: string;
  title: string;
  url: string | null;
  text: string;
  textChars: number;
};

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
    categories: ((notice.categoriesJson as string[]) ?? []).map(fixDoubleEncodedUtf8),
    markets: (notice.marketsJson as string[]) ?? [],
    bodyText: notice.bodyText,
    hasAttachments: notice.hasAttachments,
    attachments: normalizeNewswebAttachments(notice.rawMessageJson)
  };
}

function materialPayload(material: {
  id: string;
  messageId: number;
  kind: string;
  title: string;
  url: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  extractedText: string;
  status: string;
  errorText: string | null;
  enabled: boolean;
  metadataJson: Prisma.JsonValue | null;
  createdAt: Date;
}) {
  return {
    id: material.id,
    messageId: material.messageId,
    kind: material.kind,
    title: material.title,
    url: material.url,
    fileName: material.fileName,
    mimeType: material.mimeType,
    fileSize: material.fileSize,
    extractedTextChars: material.extractedText.length,
    status: material.status,
    errorText: material.errorText,
    enabled: material.enabled,
    metadata: material.metadataJson ?? null,
    createdAt: material.createdAt.toISOString()
  };
}

async function ensureNoticeExists(messageId: number): Promise<boolean> {
  const source = await prisma.sourceNotice.findUnique({
    where: { messageId },
    select: { messageId: true }
  });
  return Boolean(source);
}

async function selectedMaterialSnapshots(
  messageId: number,
  selectedMaterialIds?: string[]
): Promise<MaterialSnapshot[]> {
  if (selectedMaterialIds && selectedMaterialIds.length === 0) {
    return [];
  }

  const materials = await prisma.noticeMaterial.findMany({
    where: {
      messageId,
      status: "ready",
      enabled: true,
      ...(selectedMaterialIds ? { id: { in: selectedMaterialIds } } : {})
    },
    orderBy: { createdAt: "asc" }
  });

  const truncationMarker = "\n\n[... mer valgt materiale er avkortet ...]";
  let remainingChars = MAX_TOTAL_MATERIAL_TEXT_CHARS;
  const snapshots: MaterialSnapshot[] = [];
  for (const material of materials) {
    if (remainingChars <= truncationMarker.length) break;
    let text = material.extractedText.trim();
    if (!text) continue;
    if (text.length > remainingChars) {
      text = `${text.slice(0, remainingChars - truncationMarker.length)}${truncationMarker}`;
    }
    remainingChars -= text.length;
    snapshots.push({
      id: material.id,
      sourceId: `material_${material.id}`,
      kind: material.kind,
      title: material.title,
      url: material.url,
      text,
      textChars: text.length
    });
  }
  return snapshots;
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
            orderBy: { version: "asc" },
            select: {
              status: true,
              generatedAt: true,
              version: true
            }
          },
          publishedRewrites: {
            orderBy: { version: "asc" }
          },
          feedItem: {
            include: {
              activePublishedRewrite: true
            }
          }
        }
      });

      if (!notice) {
        return reply.code(404).send({ message: "Notis ikke funnet." });
      }

      const activePublishedRewrite = notice.feedItem?.activePublishedRewrite ?? null;

      // Find the latest rewrite by generatedAt for backward-compat status checks
      const latestRewrite = notice.rewrites.length
        ? notice.rewrites.reduce((a, b) =>
            a.generatedAt > b.generatedAt ? a : b
          )
        : null;

      if (!activePublishedRewrite) {
        if (
          !latestRewrite ||
          latestRewrite.status === "pending" ||
          latestRewrite.status === "needs_retry"
        ) {
          return reply.send({
            source: buildSourcePayload(notice),
            processing: true
          });
        }
        if (latestRewrite.status === "failed") {
          return reply.send({
            source: buildSourcePayload(notice),
            failed: true
          });
        }
        if (latestRewrite.status === "skipped") {
          return reply.send({
            source: buildSourcePayload(notice),
            skipped: true
          });
        }
      }

      if (!activePublishedRewrite || !notice.feedItem) {
        return reply.send({
          source: buildSourcePayload(notice),
          processing: true
        });
      }

      const rewrite = rewriteOutputSchema.parse(
        normalizeRewriteJson(activePublishedRewrite.rewriteJson)
      );

      const rewrites = notice.publishedRewrites.map((r) => ({
        rewriteId: r.id,
        version: r.version,
        rewrite: rewriteOutputSchema.parse(
          normalizeRewriteJson(r.rewriteJson)
        ),
        userInstruction: r.userInstruction,
        generatedAt: r.finalizedAt.toISOString(),
        contentHash: r.contentHash,
        isFinal: true as const
      }));

      const payload = {
        source: buildSourcePayload(notice),
        publication: {
          rewriteId: activePublishedRewrite.id,
          version: activePublishedRewrite.version,
          revision: Math.max(1, notice.feedItem.publicationRevision),
          contentHash: activePublishedRewrite.contentHash,
          finalizedAt: activePublishedRewrite.finalizedAt.toISOString(),
          isFinal: true as const
        },
        rewrite,
        rewrites
      };

      return reply.send(noticeResponseSchema.parse(payload));
    }
  );

  fastify.get(
    "/notice/:messageId/materials",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      if (!(await ensureNoticeExists(messageId))) {
        return reply.code(404).send({ message: "Notis ikke funnet." });
      }

      const materials = await prisma.noticeMaterial.findMany({
        where: { messageId },
        orderBy: { createdAt: "asc" }
      });

      return reply.send(
        noticeMaterialsResponseSchema.parse({
          materials: materials.map(materialPayload)
        })
      );
    }
  );

  fastify.post(
    "/notice/:messageId/materials/text",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      if (!(await ensureNoticeExists(messageId))) {
        return reply.code(404).send({ message: "Notis ikke funnet." });
      }
      const body = textMaterialBodySchema.parse(request.body);
      const text = truncateMaterialText(body.text);
      const material = await prisma.noticeMaterial.create({
        data: {
          messageId,
          kind: "text",
          title: sanitizeMaterialTitle(body.title ?? "Tekstmateriale"),
          extractedText: text,
          status: "ready",
          enabled: true
        }
      });

      return reply.code(201).send(materialPayload(material));
    }
  );

  fastify.post(
    "/notice/:messageId/materials/newsweb",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      if (!(await ensureNoticeExists(messageId))) {
        return reply.code(404).send({ message: "Notis ikke funnet." });
      }
      const body = newswebMaterialBodySchema.parse(request.body);
      const sourceInput = body.messageId ? String(body.messageId) : body.url ?? "";
      const materialMessageId =
        body.messageId ?? parseNewswebMaterialMessageId(sourceInput);
      if (!materialMessageId) {
        return reply.code(400).send({ message: "Ugyldig Newsweb-lenke." });
      }
      if (materialMessageId === messageId) {
        return reply.code(400).send({ message: "Denne meldingen er allerede hovedkilden." });
      }

      let materialData: Awaited<ReturnType<typeof fetchNewswebMaterial>> | null = null;
      let errorText: string | null = null;
      try {
        materialData = await fetchNewswebMaterial(materialMessageId);
      } catch (error) {
        errorText = error instanceof Error ? error.message : String(error);
      }

      const material = await prisma.noticeMaterial.create({
        data: {
          messageId,
          kind: "newsweb",
          title: materialData?.title ?? `Newsweb ${materialMessageId}`,
          url: `https://newsweb.oslobors.no/message/${materialMessageId}`,
          extractedText: materialData?.text ?? "",
          status: materialData ? "ready" : "failed",
          errorText,
          enabled: Boolean(materialData),
          metadataJson: toJsonValue(
            materialData?.metadata ?? { messageId: materialMessageId }
          )
        }
      });

      return reply.code(201).send(materialPayload(material));
    }
  );

  fastify.post(
    "/notice/:messageId/materials/pdf",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId } = paramsSchema.parse(request.params);
      if (!(await ensureNoticeExists(messageId))) {
        return reply.code(404).send({ message: "Notis ikke funnet." });
      }

      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ message: "PDF mangler." });
      }
      const fileName = sanitizeMaterialTitle(file.filename || "materiale.pdf");
      const isPdf =
        file.mimetype === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        return reply.code(415).send({ message: "Bare PDF-filer støttes." });
      }

      const buffer = await file.toBuffer();
      let extracted: Awaited<ReturnType<typeof extractPdfMaterialText>> | null = null;
      let errorText: string | null = null;
      try {
        extracted = await extractPdfMaterialText(buffer);
        if (!extracted.text.trim()) {
          throw new Error("PDF-en ga ingen lesbar tekst.");
        }
      } catch (error) {
        errorText = error instanceof Error ? error.message : String(error);
      }

      const material = await prisma.noticeMaterial.create({
        data: {
          messageId,
          kind: "pdf",
          title: pdfTitleFromFileName(fileName),
          fileName,
          mimeType: file.mimetype,
          fileSize: buffer.length,
          extractedText: extracted?.text ?? "",
          status: extracted ? "ready" : "failed",
          errorText,
          enabled: Boolean(extracted),
          metadataJson: toJsonValue({
            pageCount: extracted?.pageCount ?? null
          })
        }
      });

      return reply.code(201).send(materialPayload(material));
    }
  );

  fastify.patch(
    "/notice/:messageId/materials/:materialId",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId, materialId } = materialParamsSchema.parse(request.params);
      const body = updateMaterialBodySchema.parse(request.body);
      const material = await prisma.noticeMaterial.findFirst({
        where: { id: materialId, messageId }
      });
      if (!material) {
        return reply.code(404).send({ message: "Materiale ikke funnet." });
      }

      const updated = await prisma.noticeMaterial.update({
        where: { id: material.id },
        data: { enabled: body.enabled && material.status === "ready" }
      });

      return reply.send(materialPayload(updated));
    }
  );

  fastify.delete(
    "/notice/:messageId/materials/:materialId",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const { messageId, materialId } = materialParamsSchema.parse(request.params);
      const material = await prisma.noticeMaterial.findFirst({
        where: { id: materialId, messageId },
        select: { id: true }
      });
      if (!material) {
        return reply.code(404).send({ message: "Materiale ikke funnet." });
      }

      await prisma.noticeMaterial.delete({ where: { id: material.id } });
      return reply.send({ ok: true });
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
            phaseUpdatedAt: true,
            requestedAt: true
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
          phaseUpdatedAt: true,
          requestedAt: true
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
      const outputMode = body?.outputMode ?? "notice";
      const reasoningEffortOverride = body?.reasoningEffortOverride;
      const supplementalMaterials = await selectedMaterialSnapshots(
        messageId,
        body?.selectedMaterialIds
      );
      const phaseUpdatedAt = new Date();
      const generationRun = await logPrisma.generationRun.create({
        data: {
          messageId,
          version: null,
          reason: "manual-reprocess",
          status: "queued",
          phase: "queued",
          phaseUpdatedAt,
          userInstruction: instruction ?? null,
          inputJson: toJsonValue({
            endpoint: "/notice/:messageId/generate",
            messageId,
            reservation: "pending",
            instruction: instruction ?? null,
            outputMode,
            reasoningEffortOverride: reasoningEffortOverride ?? null,
            supplementalMaterials
          })
        }
      });

      let targetVersion: number;
      let previousRewriteJson: Prisma.JsonValue | null;
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
            message: "En ny versjon genereres allerede.",
            generationRunId: conflictRunId
          });
        }
        throw error;
      }

      let queuedJobId: string | null = null;
      try {
        await logPrisma.generationRun.update({
          where: { id: generationRun.id },
          data: {
            version: targetVersion,
            ...(previousRewriteJson
              ? { previousRewriteJson: toJsonValue(previousRewriteJson) }
              : {}),
            inputJson: toJsonValue({
              endpoint: "/notice/:messageId/generate",
              messageId,
              targetVersion,
              previousRewriteJson,
              instruction: instruction ?? null,
              outputMode,
              reasoningEffortOverride: reasoningEffortOverride ?? null,
              supplementalMaterials
            })
          }
        });

        const job = await fastify.rewriteQueue.add(
          "rewrite-on-demand",
          {
            messageId,
            reason: "manual-reprocess",
            generationRunId: generationRun.id,
            targetVersion,
            ...(reasoningEffortOverride ? { reasoningEffortOverride } : {}),
            outputMode,
            ...(supplementalMaterials.length > 0 ? { supplementalMaterials } : {}),
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
            jobName: "rewrite-on-demand"
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
        version: body?.telemetry?.version ?? null,
        action: "regenerate_request",
        telemetry: body?.telemetry,
        actionSource: body?.telemetry?.actionSource ?? "instruction_input",
        payload: {
          instruction: instruction ?? null,
          outputMode,
          reasoningEffortOverride: reasoningEffortOverride ?? null,
          selectedMaterialIds: supplementalMaterials.map((material) => material.id),
          targetVersion,
          generationRunId: generationRun.id,
          jobId: queuedJobId
        }
      });

      return reply.send({
        queued: true,
        jobId: queuedJobId,
        version: targetVersion,
        generationRunId: generationRun.id
      });
    }
  );
};
