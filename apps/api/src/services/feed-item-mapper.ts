import { normalizeRewriteJson, rewriteOutputSchema, type FeedItem } from "@newsweb/shared";
import type { FeedItem as PrismaFeedItem, Rewrite, SourceNotice } from "@prisma/client";

type FeedItemWithRelations = PrismaFeedItem & {
  sourceNotice: SourceNotice & {
    rewrites: Rewrite[];
  };
};

export function mapDbItemToFeedItem(item: FeedItemWithRelations): FeedItem | null {
  const rewriteRecord = item.sourceNotice.rewrites[0];

  if (
    !rewriteRecord ||
    rewriteRecord.status === "pending" ||
    rewriteRecord.status === "needs_retry"
  ) {
    return {
      messageId: item.messageId,
      publishedAt: item.publishedAt.toISOString(),
      visibilityStatus: item.visibilityStatus,
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
      sourceTitle: item.sourceNotice.title,
      sourceBodyText: item.sourceNotice.bodyText,
      skipped: false,
      processing: true
    };
  }

  if (rewriteRecord.status === "failed") {
    return null;
  }

  if (rewriteRecord.status === "skipped") {
    return {
      messageId: item.messageId,
      publishedAt: item.publishedAt.toISOString(),
      visibilityStatus: item.visibilityStatus,
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
      sourceTitle: item.sourceNotice.title,
      sourceBodyText: item.sourceNotice.bodyText,
      skipped: true,
      processing: false
    };
  }

  const rewrite = rewriteOutputSchema.parse(
    normalizeRewriteJson(rewriteRecord.rewriteJson)
  );
  return {
    messageId: item.messageId,
    publishedAt: item.publishedAt.toISOString(),
    visibilityStatus: item.visibilityStatus,
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
    sourceTitle: item.sourceNotice.title,
    sourceBodyText: item.sourceNotice.bodyText,
    skipped: false,
    processing: false
  };
}
