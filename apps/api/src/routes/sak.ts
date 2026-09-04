import {
  JOB_NAMES,
  SAK_TARGET_CHARS_DEFAULT,
  sakCreateRequestSchema,
  sakDraftResponseSchema,
  sakDraftSchema,
  sakGenerateRequestSchema,
  sakGenerateResponseSchema,
  sakListResponseSchema,
  type SakDraftJobData
} from "@newsweb/shared";
import { logPrisma, prisma } from "@newsweb/shared/db";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { toJsonValue } from "../services/editorial-telemetry.js";
import {
  buildGenerationStatusPayload,
  chooseGenerationRun
} from "../services/generation-status.js";
import {
  extractPdfMaterialText,
  pdfTitleFromFileName,
  sanitizeMaterialTitle,
  truncateMaterialText
} from "../services/notice-materials.js";
import {
  ActiveGenerationConflictError,
  activeRunIsStillLive
} from "../services/rewrite-reservation.js";
import {
  SAK_MAX_MATERIAL_TEXT_CHARS,
  SAK_MAX_TEXT_MATERIAL_INPUT_CHARS,
  SAK_MAX_URL_LENGTH,
  buildSakMaterialSnapshots,
  hasReadableSakMaterial
} from "../services/sak-materials.js";
import { parseSakOwnerHeader, sakExpiresAt } from "../services/sak-owner.js";
import {
  parseStoredSakArticle,
  sakDraftPayload,
  sakListItemPayload,
  sakMaterialPayload,
  sakVersionAsRewriteStatus,
  sakVersionPayload
} from "../services/sak-payloads.js";
import {
  releaseSakGenerationSlot,
  reserveSakGeneration
} from "../services/sak-reservation.js";
import { fetchUrlMaterial } from "../services/url-material.js";

const SAK_NOT_FOUND_MESSAGE = "Saken finnes ikke.";
const SAK_INVALID_REQUEST_MESSAGE = "Ugyldig forespørsel.";
const OWNER_MISSING_MESSAGE = "Mangler eier-id for saken (x-sak-owner).";
const MATERIAL_NOT_FOUND_MESSAGE = "Materiale ikke funnet.";
const SAK_GENERATION_REASON = "sak-draft";
const SAK_GENERATION_MESSAGE_ID = -1;
const SAK_LIST_LIMIT = 50;

const sakParamsSchema = z.object({
  id: z.string().min(1).max(80)
});

const sakMaterialParamsSchema = z.object({
  id: z.string().min(1).max(80),
  materialId: z.string().min(1).max(80)
});

const statusQuerySchema = z.object({
  jobId: z.string().optional(),
  version: z.coerce.number().int().positive().optional()
});

const urlMaterialBodySchema = z.object({
  url: z.string().trim().min(1).max(SAK_MAX_URL_LENGTH)
});

const textMaterialBodySchema = z.object({
  title: z.string().max(180).optional(),
  text: z.string().min(1).max(SAK_MAX_TEXT_MATERIAL_INPUT_CHARS)
});

const updateMaterialBodySchema = z.object({
  enabled: z.boolean()
});

const generationRunSelect = {
  id: true,
  status: true,
  phase: true,
  phaseUpdatedAt: true,
  requestedAt: true
} as const;

async function loadOwnedDraft(id: string, ownerId: string) {
  return prisma.sakDraft.findFirst({
    where: { id, ownerId, expiresAt: { gt: new Date() } }
  });
}

async function touchDraft(id: string): Promise<void> {
  await prisma.sakDraft.update({
    where: { id },
    data: { lastActivityAt: new Date() }
  });
}

export const sakRoutes: FastifyPluginAsync = async (fastify) => {
  // Every /sak route needs the browser's owner id; the login only says
  // "someone from the desk", the header says which browser.
  const requireOwner = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<string | null> => {
    const ownerId = parseSakOwnerHeader(request.headers);
    if (!ownerId) {
      await reply.code(400).send({ message: OWNER_MISSING_MESSAGE });
      return null;
    }
    return ownerId;
  };

  fastify.post(
    "/sak",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const ownerId = await requireOwner(request, reply);
      if (!ownerId) return;
      const parsed_body = sakCreateRequestSchema.safeParse(request.body ?? {});
      if (!parsed_body.success) {
        return reply.code(400).send({ message: SAK_INVALID_REQUEST_MESSAGE });
      }
      const body = parsed_body.data;
      const now = new Date();
      const draft = await prisma.sakDraft.create({
        data: {
          ownerId,
          titleOverride: body.titleOverride?.trim() || null,
          targetChars: body.targetChars ?? null,
          createdAt: now,
          lastActivityAt: now,
          expiresAt: sakExpiresAt(now, fastify.config.SAK_TTL_HOURS)
        }
      });
      return reply.code(201).send(sakDraftSchema.parse(sakDraftPayload(draft)));
    }
  );

  fastify.get(
    "/sak",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const ownerId = await requireOwner(request, reply);
      if (!ownerId) return;
      const drafts = await prisma.sakDraft.findMany({
        where: { ownerId, expiresAt: { gt: new Date() } },
        orderBy: { lastActivityAt: "desc" },
        take: SAK_LIST_LIMIT,
        include: {
          _count: { select: { materials: true, versions: true } },
          versions: {
            where: { status: { in: ["ready", "needs_review"] } },
            orderBy: { version: "desc" },
            take: 1,
            select: { articleJson: true }
          }
        }
      });

      return reply.send(
        sakListResponseSchema.parse({
          drafts: drafts.map((draft) =>
            sakListItemPayload({
              ...draft,
              versionCount: draft._count.versions,
              materialCount: draft._count.materials,
              latestArticleJson: draft.versions[0]?.articleJson ?? null
            })
          )
        })
      );
    }
  );

  fastify.get(
    "/sak/:id",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const ownerId = await requireOwner(request, reply);
      if (!ownerId) return;
      const { id } = sakParamsSchema.parse(request.params);
      const draft = await loadOwnedDraft(id, ownerId);
      if (!draft) {
        return reply.code(404).send({ message: SAK_NOT_FOUND_MESSAGE });
      }

      const [materials, versions] = await Promise.all([
        prisma.sakMaterial.findMany({
          where: { sakId: draft.id },
          orderBy: { createdAt: "asc" }
        }),
        prisma.sakVersion.findMany({
          where: { sakId: draft.id },
          orderBy: { version: "asc" }
        })
      ]);

      let activeGeneration: { generationRunId: string; jobId: string | null; version: number } | null =
        null;
      if (draft.activeGenerationRunId) {
        const pendingVersion = versions.find(
          (version) => version.generationRunId === draft.activeGenerationRunId
        );
        const stillLive = await activeRunIsStillLive(draft.activeGenerationRunId);
        if (pendingVersion && stillLive) {
          const run = await logPrisma.generationRun.findUnique({
            where: { id: draft.activeGenerationRunId },
            select: { jobId: true }
          });
          activeGeneration = {
            generationRunId: draft.activeGenerationRunId,
            jobId: run?.jobId ?? null,
            version: pendingVersion.version
          };
        }
      }

      return reply.send(
        sakDraftResponseSchema.parse({
          draft: sakDraftPayload(draft),
          materials: materials.map(sakMaterialPayload),
          versions: versions.map(sakVersionPayload),
          activeGeneration
        })
      );
    }
  );

  fastify.delete(
    "/sak/:id",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const ownerId = await requireOwner(request, reply);
      if (!ownerId) return;
      const { id } = sakParamsSchema.parse(request.params);
      const draft = await loadOwnedDraft(id, ownerId);
      if (!draft) {
        return reply.code(404).send({ message: SAK_NOT_FOUND_MESSAGE });
      }
      await prisma.sakDraft.delete({ where: { id: draft.id } });
      return reply.send({ ok: true });
    }
  );

  fastify.post(
    "/sak/:id/materials/pdf",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const ownerId = await requireOwner(request, reply);
      if (!ownerId) return;
      const { id } = sakParamsSchema.parse(request.params);
      const draft = await loadOwnedDraft(id, ownerId);
      if (!draft) {
        return reply.code(404).send({ message: SAK_NOT_FOUND_MESSAGE });
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
        extracted = await extractPdfMaterialText(buffer, {
          maxChars: SAK_MAX_MATERIAL_TEXT_CHARS
        });
        if (!extracted.text.trim()) {
          throw new Error("PDF-en ga ingen lesbar tekst.");
        }
      } catch (error) {
        extracted = null;
        errorText = error instanceof Error ? error.message : String(error);
      }

      const text = extracted?.text ?? "";
      const material = await prisma.sakMaterial.create({
        data: {
          sakId: draft.id,
          kind: "pdf",
          title: pdfTitleFromFileName(fileName),
          fileName,
          fileSize: buffer.length,
          extractedText: text,
          textChars: text.length,
          status: extracted ? "ready" : "failed",
          errorText,
          enabled: Boolean(extracted),
          metadataJson: toJsonValue({
            pageCount: extracted?.pageCount ?? null,
            mimeType: file.mimetype
          })
        }
      });
      await touchDraft(draft.id);

      return reply.code(201).send(sakMaterialPayload(material));
    }
  );

  fastify.post(
    "/sak/:id/materials/url",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const ownerId = await requireOwner(request, reply);
      if (!ownerId) return;
      const { id } = sakParamsSchema.parse(request.params);
      const draft = await loadOwnedDraft(id, ownerId);
      if (!draft) {
        return reply.code(404).send({ message: SAK_NOT_FOUND_MESSAGE });
      }
      const parsed_body = urlMaterialBodySchema.safeParse(request.body);
      if (!parsed_body.success) {
        return reply.code(400).send({ message: SAK_INVALID_REQUEST_MESSAGE });
      }
      const body = parsed_body.data;

      const result = await fetchUrlMaterial(body.url);
      let fallbackTitle = body.url;
      try {
        fallbackTitle = new URL(body.url).hostname || body.url;
      } catch {
        // keep the raw input as the title
      }

      // Failed URLs stay enabled: the model may link them as coverage, it
      // just cannot take facts from them. The row carries the reason.
      const material = await prisma.sakMaterial.create({
        data: {
          sakId: draft.id,
          kind: "url",
          title: result.ok ? result.title : sanitizeMaterialTitle(fallbackTitle),
          url: result.ok ? result.finalUrl : body.url,
          extractedText: result.ok ? result.text : "",
          textChars: result.ok ? result.text.length : 0,
          status: result.ok ? "ready" : "failed",
          errorText: result.ok ? null : result.errorText,
          enabled: true,
          metadataJson: toJsonValue(
            result.ok
              ? {
                  contentType: result.contentType,
                  pageCount: result.pageCount ?? null,
                  requestedUrl: body.url
                }
              : { errorCode: result.errorCode, requestedUrl: body.url }
          )
        }
      });
      await touchDraft(draft.id);

      return reply.code(201).send(sakMaterialPayload(material));
    }
  );

  fastify.post(
    "/sak/:id/materials/text",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const ownerId = await requireOwner(request, reply);
      if (!ownerId) return;
      const { id } = sakParamsSchema.parse(request.params);
      const draft = await loadOwnedDraft(id, ownerId);
      if (!draft) {
        return reply.code(404).send({ message: SAK_NOT_FOUND_MESSAGE });
      }
      const parsed_body = textMaterialBodySchema.safeParse(request.body);
      if (!parsed_body.success) {
        return reply.code(400).send({ message: SAK_INVALID_REQUEST_MESSAGE });
      }
      const body = parsed_body.data;
      const text = truncateMaterialText(body.text, SAK_MAX_MATERIAL_TEXT_CHARS);
      if (!text) {
        return reply.code(400).send({ message: "Teksten er tom." });
      }
      const material = await prisma.sakMaterial.create({
        data: {
          sakId: draft.id,
          kind: "text",
          title: sanitizeMaterialTitle(body.title ?? "Tekstmateriale", "Tekstmateriale"),
          extractedText: text,
          textChars: text.length,
          status: "ready",
          enabled: true
        }
      });
      await touchDraft(draft.id);

      return reply.code(201).send(sakMaterialPayload(material));
    }
  );

  fastify.patch(
    "/sak/:id/materials/:materialId",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const ownerId = await requireOwner(request, reply);
      if (!ownerId) return;
      const { id, materialId } = sakMaterialParamsSchema.parse(request.params);
      const parsed_body = updateMaterialBodySchema.safeParse(request.body);
      if (!parsed_body.success) {
        return reply.code(400).send({ message: SAK_INVALID_REQUEST_MESSAGE });
      }
      const body = parsed_body.data;
      const draft = await loadOwnedDraft(id, ownerId);
      if (!draft) {
        return reply.code(404).send({ message: SAK_NOT_FOUND_MESSAGE });
      }
      const material = await prisma.sakMaterial.findFirst({
        where: { id: materialId, sakId: draft.id },
        select: { id: true }
      });
      if (!material) {
        return reply.code(404).send({ message: MATERIAL_NOT_FOUND_MESSAGE });
      }

      const updated = await prisma.sakMaterial.update({
        where: { id: material.id },
        data: { enabled: body.enabled }
      });
      await touchDraft(draft.id);

      return reply.send(sakMaterialPayload(updated));
    }
  );

  fastify.delete(
    "/sak/:id/materials/:materialId",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const ownerId = await requireOwner(request, reply);
      if (!ownerId) return;
      const { id, materialId } = sakMaterialParamsSchema.parse(request.params);
      const draft = await loadOwnedDraft(id, ownerId);
      if (!draft) {
        return reply.code(404).send({ message: SAK_NOT_FOUND_MESSAGE });
      }
      const material = await prisma.sakMaterial.findFirst({
        where: { id: materialId, sakId: draft.id },
        select: { id: true }
      });
      if (!material) {
        return reply.code(404).send({ message: MATERIAL_NOT_FOUND_MESSAGE });
      }

      await prisma.sakMaterial.delete({ where: { id: material.id } });
      await touchDraft(draft.id);
      return reply.send({ ok: true });
    }
  );

  fastify.post(
    "/sak/:id/generate",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const ownerId = await requireOwner(request, reply);
      if (!ownerId) return;
      const { id } = sakParamsSchema.parse(request.params);
      const parsed_body = sakGenerateRequestSchema.safeParse(request.body ?? {});
      if (!parsed_body.success) {
        return reply.code(400).send({ message: SAK_INVALID_REQUEST_MESSAGE });
      }
      const body = parsed_body.data;
      const draft = await loadOwnedDraft(id, ownerId);
      if (!draft) {
        return reply.code(404).send({ message: SAK_NOT_FOUND_MESSAGE });
      }

      const instruction = body.instruction?.trim() || undefined;
      const titleOverride =
        body.titleOverride !== undefined
          ? body.titleOverride.trim() || null
          : draft.titleOverride;
      const targetChars = body.targetChars ?? draft.targetChars ?? SAK_TARGET_CHARS_DEFAULT;
      const reasoningEffortOverride = body.reasoningEffortOverride;

      const materialRows = await prisma.sakMaterial.findMany({
        where: {
          sakId: draft.id,
          enabled: true,
          ...(body.selectedMaterialIds ? { id: { in: body.selectedMaterialIds } } : {})
        },
        orderBy: { createdAt: "asc" }
      });
      const materials = buildSakMaterialSnapshots(materialRows);
      if (!hasReadableSakMaterial(materials.snapshots)) {
        return reply.code(400).send({
          message: "Legg til minst ett lesbart materiale før du lager utkast."
        });
      }

      const phaseUpdatedAt = new Date();
      const generationRun = await logPrisma.generationRun.create({
        data: {
          messageId: SAK_GENERATION_MESSAGE_ID,
          version: null,
          reason: SAK_GENERATION_REASON,
          status: "queued",
          phase: "queued",
          phaseUpdatedAt,
          userInstruction: instruction ?? null,
          inputJson: toJsonValue({
            endpoint: "/sak/:id/generate",
            sakId: draft.id,
            reservation: "pending",
            instruction: instruction ?? null,
            titleOverride,
            targetChars,
            reasoningEffortOverride: reasoningEffortOverride ?? null,
            materials: {
              included: materials.included,
              truncated: materials.truncated,
              dropped: materials.dropped
            }
          })
        }
      });

      let targetVersion: number;
      let previousArticleJson: Prisma.JsonValue | null;
      try {
        const reservation = await reserveSakGeneration(draft.id, generationRun.id);
        targetVersion = reservation.targetVersion;
        previousArticleJson = reservation.previousArticleJson;
      } catch (error) {
        const conflictRunId =
          error instanceof ActiveGenerationConflictError ? error.generationRunId : null;
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

      const previousArticle = parseStoredSakArticle(previousArticleJson);
      const todayIso = new Date().toISOString();
      let queuedJobId: string | null = null;
      try {
        // The pending row gives the UI its tab immediately; the worker
        // updates it by sakId_version.
        await prisma.sakVersion.create({
          data: {
            sakId: draft.id,
            version: targetVersion,
            status: "pending",
            userInstruction: instruction ?? null,
            generationRunId: generationRun.id
          }
        });
        await prisma.sakDraft.update({
          where: { id: draft.id },
          data: {
            titleOverride,
            targetChars,
            lastActivityAt: new Date()
          }
        });

        await logPrisma.generationRun.update({
          where: { id: generationRun.id },
          data: {
            version: targetVersion,
            ...(previousArticle
              ? { previousRewriteJson: toJsonValue(previousArticle) }
              : {}),
            inputJson: toJsonValue({
              endpoint: "/sak/:id/generate",
              sakId: draft.id,
              targetVersion,
              instruction: instruction ?? null,
              titleOverride,
              targetChars,
              reasoningEffortOverride: reasoningEffortOverride ?? null,
              hasPreviousArticle: Boolean(previousArticle),
              materials: {
                included: materials.included,
                truncated: materials.truncated,
                dropped: materials.dropped
              }
            })
          }
        });

        const payload: SakDraftJobData = {
          sakId: draft.id,
          generationRunId: generationRun.id,
          targetVersion,
          materials: materials.snapshots,
          ...(instruction ? { instruction } : {}),
          ...(previousArticle ? { previousArticleJson: previousArticle } : {}),
          titleOverride,
          targetChars,
          ...(reasoningEffortOverride ? { reasoningEffortOverride } : {}),
          todayIso
        };
        const job = await fastify.sakQueue.add(JOB_NAMES.sakDraft, payload, {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 2000,
          removeOnFail: 2000
        });
        queuedJobId = job.id != null ? String(job.id) : null;
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        await releaseSakGenerationSlot(draft.id, generationRun.id);
        await prisma.sakVersion
          .updateMany({
            where: { sakId: draft.id, version: targetVersion, status: "pending" },
            data: { status: "failed", errorText }
          })
          .catch(() => undefined);
        await logPrisma.generationRun.update({
          where: { id: generationRun.id },
          data: {
            status: "failed",
            phase: "failed",
            phaseUpdatedAt: new Date(),
            errorText,
            finishedAt: new Date()
          }
        });
        throw error;
      }

      await logPrisma.generationRun
        .update({
          where: { id: generationRun.id },
          data: { jobId: queuedJobId, jobName: JOB_NAMES.sakDraft }
        })
        .catch((error) => {
          request.log.error(
            { err: error, generationRunId: generationRun.id },
            "Failed to attach queue job id to sak generation run"
          );
        });

      return reply.send(
        sakGenerateResponseSchema.parse({
          queued: true,
          jobId: queuedJobId,
          version: targetVersion,
          generationRunId: generationRun.id,
          materials: {
            included: materials.included,
            truncated: materials.truncated,
            dropped: materials.dropped
          }
        })
      );
    }
  );

  fastify.get(
    "/sak/:id/status",
    {
      preHandler: fastify.authenticate
    },
    async (request, reply) => {
      const ownerId = await requireOwner(request, reply);
      if (!ownerId) return;
      const { id } = sakParamsSchema.parse(request.params);
      const parsed_query = statusQuerySchema.safeParse(request.query);
      if (!parsed_query.success) {
        return reply.code(400).send({ message: SAK_INVALID_REQUEST_MESSAGE });
      }
      const { jobId, version } = parsed_query.data;
      const draft = await loadOwnedDraft(id, ownerId);
      if (!draft) {
        return reply.code(404).send({ message: SAK_NOT_FOUND_MESSAGE });
      }

      const sakVersion = version
        ? await prisma.sakVersion.findUnique({
            where: { sakId_version: { sakId: draft.id, version } }
          })
        : await prisma.sakVersion.findFirst({
            where: { sakId: draft.id },
            orderBy: { version: "desc" }
          });

      let jobState: string | null = null;
      let jobGenerationRun = null;
      if (jobId) {
        const job = await fastify.sakQueue.getJob(jobId);
        jobState = job ? await job.getState() : "unknown";
        jobGenerationRun = await logPrisma.generationRun.findFirst({
          where: {
            messageId: SAK_GENERATION_MESSAGE_ID,
            jobId,
            reason: SAK_GENERATION_REASON
          },
          orderBy: { requestedAt: "desc" },
          select: generationRunSelect
        });
      }

      const versionGenerationRun = sakVersion?.generationRunId
        ? await logPrisma.generationRun.findUnique({
            where: { id: sakVersion.generationRunId },
            select: generationRunSelect
          })
        : null;

      return reply.send(
        buildGenerationStatusPayload({
          generationRun: chooseGenerationRun(jobGenerationRun, versionGenerationRun),
          rewrite: sakVersionAsRewriteStatus(sakVersion),
          jobState
        })
      );
    }
  );
};
