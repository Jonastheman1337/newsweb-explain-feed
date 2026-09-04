import {
  parseStoredSakArticle as parseStoredSakArticleLenient,
  sakMaterialKindSchema,
  sakMaterialStatusSchema,
  sakVersionStatusSchema,
  type SakDraft,
  type SakListItem,
  type SakMaterial,
  type SakVersion
} from "@newsweb/shared";
import type { Prisma } from "@prisma/client";

/**
 * DB row → shared API contract. Pure mappers so the route file stays thin
 * and the contract can be checked with the shared zod schemas in tests.
 */

export type SakDraftRow = {
  id: string;
  titleOverride: string | null;
  targetChars: number | null;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
};

export type SakMaterialRowFull = {
  id: string;
  sakId: string;
  kind: string;
  title: string;
  url: string | null;
  fileName: string | null;
  fileSize: number | null;
  extractedText: string;
  textChars: number;
  status: string;
  errorText: string | null;
  enabled: boolean;
  metadataJson: Prisma.JsonValue | null;
  createdAt: Date;
};

export type SakVersionRow = {
  id: string;
  sakId: string;
  version: number;
  status: string;
  articleJson: Prisma.JsonValue | null;
  userInstruction: string | null;
  changeNote: string | null;
  promptVersion: string | null;
  model: string | null;
  errorText: string | null;
  validationJson: Prisma.JsonValue | null;
  generationRunId: string | null;
  requestedAt: Date;
  generatedAt: Date | null;
};

export function sakDraftPayload(draft: SakDraftRow): SakDraft {
  return {
    id: draft.id,
    titleOverride: draft.titleOverride,
    targetChars: draft.targetChars,
    createdAt: draft.createdAt.toISOString(),
    lastActivityAt: draft.lastActivityAt.toISOString(),
    expiresAt: draft.expiresAt.toISOString()
  };
}

export function sakMaterialPayload(material: SakMaterialRowFull): SakMaterial {
  const kind = sakMaterialKindSchema.safeParse(material.kind);
  const status = sakMaterialStatusSchema.safeParse(material.status);
  return {
    id: material.id,
    sakId: material.sakId,
    kind: kind.success ? kind.data : "text",
    title: material.title,
    url: material.url,
    fileName: material.fileName,
    fileSize: material.fileSize,
    extractedTextChars: material.textChars || material.extractedText.length,
    status: status.success ? status.data : "failed",
    errorText: material.errorText,
    enabled: material.enabled,
    metadata: material.metadataJson ?? null,
    createdAt: material.createdAt.toISOString()
  };
}

export function parseStoredSakArticle(json: Prisma.JsonValue | null) {
  // Lenient on read: the worker may store text the strict model schema would
  // reject (owner title override, a quote grown by its sitatstrek).
  return parseStoredSakArticleLenient(json);
}

export function sakVersionPayload(version: SakVersionRow): SakVersion {
  const status = sakVersionStatusSchema.safeParse(version.status);
  return {
    id: version.id,
    sakId: version.sakId,
    version: version.version,
    status: status.success ? status.data : "failed",
    article: parseStoredSakArticle(version.articleJson),
    userInstruction: version.userInstruction,
    changeNote: version.changeNote,
    promptVersion: version.promptVersion,
    model: version.model,
    errorText: version.errorText,
    validation: version.validationJson ?? null,
    generationRunId: version.generationRunId,
    requestedAt: version.requestedAt.toISOString(),
    generatedAt: version.generatedAt?.toISOString() ?? null
  };
}

export function sakListItemPayload(
  draft: SakDraftRow & {
    versionCount: number;
    materialCount: number;
    latestArticleJson: Prisma.JsonValue | null;
  }
): SakListItem {
  const article = parseStoredSakArticle(draft.latestArticleJson);
  return {
    id: draft.id,
    title: article?.title ?? draft.titleOverride ?? null,
    createdAt: draft.createdAt.toISOString(),
    lastActivityAt: draft.lastActivityAt.toISOString(),
    expiresAt: draft.expiresAt.toISOString(),
    versionCount: draft.versionCount,
    materialCount: draft.materialCount
  };
}

/**
 * Sak version statuses on the notice-shaped status payload: ready and
 * needs_review both mean "there is an article to show".
 */
export function sakVersionAsRewriteStatus(
  version: Pick<SakVersionRow, "status" | "generatedAt" | "requestedAt" | "version"> | null
): { status: string; generatedAt: Date; version: number } | null {
  if (!version) return null;
  const status =
    version.status === "ready" || version.status === "needs_review"
      ? "published"
      : version.status;
  return {
    status,
    generatedAt: version.generatedAt ?? version.requestedAt,
    version: version.version
  };
}
