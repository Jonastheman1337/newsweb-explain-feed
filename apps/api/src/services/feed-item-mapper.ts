import {
  fixDoubleEncodedUtf8,
  normalizeRewriteJson,
  rewriteOutputSchema,
  type FeedItem
} from "@newsweb/shared";
import type {
  FeedItem as PrismaFeedItem,
  PublishedRewrite,
  Rewrite,
  SourceNotice
} from "@prisma/client";
import { normalizeNewswebAttachments } from "./newsweb-attachments.js";

// Feed queries select only these rewrite columns; the mapper must not
// depend on anything heavier (validation_json stays in the database).
export type FeedRewriteRecord = Pick<
  Rewrite,
  "status" | "generatedAt" | "version"
>;

type FeedItemWithRelations = PrismaFeedItem & {
  activePublishedRewrite: Pick<
    PublishedRewrite,
    "id" | "version" | "rewriteJson" | "contentHash" | "finalizedAt"
  > | null;
  sourceNotice: SourceNotice & {
    rewrites: FeedRewriteRecord[];
  };
};

// Rows ingested before the encoding fix may still hold double-encoded UTF-8
// ("BÃ˜RSPAUSE"); the worker repairs on read, so the feed must too, or the
// category shows as mojibake and never matches the mute/filter values.
function sourceCategories(item: FeedItemWithRelations): string[] {
  const raw = item.sourceNotice.categoriesJson;
  return Array.isArray(raw)
    ? raw
        .filter((value): value is string => typeof value === "string")
        .map(fixDoubleEncodedUtf8)
    : [];
}

function sourceOnlyFeedItem(
  item: FeedItemWithRelations,
  flags: {
    notGenerated?: boolean;
    skipped?: boolean;
    failed?: boolean;
    processing?: boolean;
  } = {}
): FeedItem {
  const attachments = normalizeNewswebAttachments(
    item.sourceNotice.rawMessageJson
  );

  return {
    messageId: item.messageId,
    publishedAt: item.publishedAt.toISOString(),
    visibilityStatus: item.visibilityStatus,
    rewriteVersion: item.sourceNotice.rewrites[0]?.version ?? null,
    rewriteId: null,
    publicationRevision: item.publicationRevision,
    contentHash: null,
    finalizedAt: null,
    isFinal: false,
    title: item.sourceNotice.title,
    issuerName: item.sourceNotice.issuerName,
    issuerSign: item.sourceNotice.issuerSign,
    lead: "",
    body: [],
    keyFacts: [],
    negativeOrSurprising: [],
    sourceLimitations: [],
    confidence: "high",
    importance: "uviktig",
    hasAttachments: item.sourceNotice.hasAttachments,
    attachments,
    sourceTitle: item.sourceNotice.title,
    sourceBodyText: item.sourceNotice.bodyText,
    categories: sourceCategories(item),
    notGenerated: flags.notGenerated ?? false,
    skipped: flags.skipped ?? false,
    failed: flags.failed ?? false,
    processing: flags.processing ?? false,
    regenerating: false
  };
}

export function mapDbItemToFeedItem(item: FeedItemWithRelations): FeedItem | null {
  const latestRewrite = item.sourceNotice.rewrites[0];
  const rewriteRecord = item.activePublishedRewrite;

  if (!rewriteRecord) {
    if (!latestRewrite) {
      return sourceOnlyFeedItem(item, { notGenerated: true });
    }
    if (latestRewrite.status === "pending" || latestRewrite.status === "needs_retry") {
      return sourceOnlyFeedItem(item, { processing: true });
    }
    if (latestRewrite.status === "failed") {
      return sourceOnlyFeedItem(item, { failed: true });
    }
    if (latestRewrite.status === "skipped") {
      return sourceOnlyFeedItem(item, { skipped: true });
    }
    return sourceOnlyFeedItem(item, { notGenerated: true });
  }

  const rewrite = rewriteOutputSchema.parse(
    normalizeRewriteJson(rewriteRecord.rewriteJson)
  );
  const attachments = normalizeNewswebAttachments(
    item.sourceNotice.rawMessageJson
  );

  return {
    messageId: item.messageId,
    publishedAt: item.publishedAt.toISOString(),
    visibilityStatus: item.visibilityStatus,
    rewriteVersion: rewriteRecord.version,
    rewriteId: rewriteRecord.id,
    publicationRevision: item.publicationRevision,
    contentHash: rewriteRecord.contentHash,
    finalizedAt: rewriteRecord.finalizedAt.toISOString(),
    isFinal: true,
    title: rewrite.title,
    issuerName: item.sourceNotice.issuerName,
    issuerSign: item.sourceNotice.issuerSign,
    lead: rewrite.lead,
    body: rewrite.body,
    keyFacts: rewrite.key_facts,
    negativeOrSurprising: rewrite.negative_or_surprising,
    sourceLimitations: rewrite.source_limitations,
    confidence: rewrite.confidence,
    importance: rewrite.importance,
    hasAttachments: item.sourceNotice.hasAttachments,
    attachments,
    sourceTitle: item.sourceNotice.title,
    sourceBodyText: item.sourceNotice.bodyText,
    categories: sourceCategories(item),
    notGenerated: false,
    skipped: false,
    failed: false,
    processing: false,
    regenerating: false
  };
}
