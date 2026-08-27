import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function publicationContentHash(rewriteJson: unknown): string {
  return createHash("sha256").update(canonicalJson(rewriteJson)).digest("hex");
}

export function shouldActivatePublication(
  activeVersion: number | null,
  candidateVersion: number
): boolean {
  return activeVersion === null || candidateVersion >= activeVersion;
}

type FinalizedPublication = {
  id: string;
  version: number;
  contentHash: string;
};

export type FinalizePublicationResult =
  | {
      outcome: "activated" | "already_active" | "finalized_superseded";
      publication: FinalizedPublication;
      publicationRevision: number;
    }
  | {
      outcome: "candidate_missing" | "ownership_lost" | "not_publishable";
      publication: null;
      publicationRevision: number | null;
    };

type LockedFeedItem = {
  activePublishedRewriteId: string | null;
  publicationRevision: number;
  activeVersion: number | null;
};

async function finalizePublicationTransaction(
  db: PrismaClient,
  args: {
    messageId: number;
    version: number;
    generationRunId?: string;
  }
): Promise<FinalizePublicationResult> {
  return db.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<LockedFeedItem[]>(Prisma.sql`
      SELECT
        f."active_published_rewrite_id" AS "activePublishedRewriteId",
        f."publication_revision" AS "publicationRevision",
        p."version" AS "activeVersion"
      FROM "feed_items" f
      LEFT JOIN "published_rewrites" p
        ON p."id" = f."active_published_rewrite_id"
      WHERE f."message_id" = ${args.messageId}
      FOR UPDATE OF f
    `);
    const feedItem = lockedRows[0];
    if (!feedItem) {
      throw new Error(`feed_items missing for ${args.messageId}`);
    }

    const candidate = await tx.rewrite.findUnique({
      where: {
        messageId_version: {
          messageId: args.messageId,
          version: args.version
        }
      }
    });
    if (!candidate) {
      return {
        outcome: "candidate_missing",
        publication: null,
        publicationRevision: feedItem.publicationRevision
      };
    }

    const expectedOwner = args.generationRunId ?? null;
    if (candidate.generationRunId !== expectedOwner) {
      return {
        outcome: "ownership_lost",
        publication: null,
        publicationRevision: feedItem.publicationRevision
      };
    }
    if (candidate.status !== "pending" && candidate.status !== "published") {
      return {
        outcome: "not_publishable",
        publication: null,
        publicationRevision: feedItem.publicationRevision
      };
    }

    const contentHash = publicationContentHash(candidate.rewriteJson);
    const existing = await tx.publishedRewrite.findUnique({
      where: {
        messageId_version: {
          messageId: args.messageId,
          version: args.version
        }
      }
    });

    if (
      existing &&
      (existing.generationRunId !== expectedOwner ||
        existing.contentHash !== contentHash)
    ) {
      return {
        outcome: "ownership_lost",
        publication: null,
        publicationRevision: feedItem.publicationRevision
      };
    }

    const publication =
      existing ??
      (await tx.publishedRewrite.create({
        data: {
          messageId: candidate.messageId,
          version: candidate.version,
          generationRunId: expectedOwner,
          lang: candidate.lang,
          model: candidate.model,
          promptVersion: candidate.promptVersion,
          rewriteJson:
            candidate.rewriteJson === null
              ? Prisma.JsonNull
              : (candidate.rewriteJson as Prisma.InputJsonValue),
          validationJson:
            candidate.validationJson === null
              ? Prisma.JsonNull
              : (candidate.validationJson as Prisma.InputJsonValue),
          userInstruction: candidate.userInstruction,
          contentHash
        }
      }));

    await tx.rewrite.updateMany({
      where: {
        id: candidate.id,
        generationRunId: expectedOwner,
        status: "pending"
      },
      data: { status: "published" }
    });

    if (feedItem.activePublishedRewriteId === publication.id) {
      return {
        outcome: "already_active",
        publication,
        publicationRevision: feedItem.publicationRevision
      };
    }

    if (!shouldActivatePublication(feedItem.activeVersion, publication.version)) {
      return {
        outcome: "finalized_superseded",
        publication,
        publicationRevision: feedItem.publicationRevision
      };
    }

    const activated = await tx.feedItem.update({
      where: { messageId: args.messageId },
      data: {
        activePublishedRewriteId: publication.id,
        publicationRevision: { increment: 1 }
      },
      select: { publicationRevision: true }
    });
    return {
      outcome: "activated",
      publication,
      publicationRevision: activated.publicationRevision
    };
  });
}

export async function finalizePublication(
  db: PrismaClient,
  args: {
    messageId: number;
    version: number;
    generationRunId?: string;
  }
): Promise<FinalizePublicationResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await finalizePublicationTransaction(db, args);
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034");
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw new Error("Unreachable publication retry state.");
}
