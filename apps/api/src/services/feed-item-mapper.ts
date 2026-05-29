import { normalizeRewriteJson, rewriteOutputSchema, type FeedItem } from "@newsweb/shared";
import type { FeedItem as PrismaFeedItem, Rewrite, SourceNotice } from "@prisma/client";
import { normalizeNewswebAttachments } from "./newsweb-attachments.js";

type FeedItemWithRelations = PrismaFeedItem & {
  sourceNotice: SourceNotice & {
    rewrites: Rewrite[];
  };
};

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
    notGenerated: flags.notGenerated ?? false,
    skipped: flags.skipped ?? false,
    failed: flags.failed ?? false,
    processing: flags.processing ?? false
  };
}

export function mapDbItemToFeedItem(item: FeedItemWithRelations): FeedItem | null {
  const latestRewrite = item.sourceNotice.rewrites[0];
  const rewriteRecord =
    item.sourceNotice.rewrites.find((rewrite) => rewrite.status === "published") ??
    latestRewrite;

  if (!rewriteRecord) {
    return sourceOnlyFeedItem(item, { notGenerated: true });
  }

  if (rewriteRecord.status === "pending" || rewriteRecord.status === "needs_retry") {
    return sourceOnlyFeedItem(item, { processing: true });
  }

  if (rewriteRecord.status === "failed") {
    return sourceOnlyFeedItem(item, { failed: true });
  }

  if (rewriteRecord.status === "skipped") {
    return sourceOnlyFeedItem(item, { skipped: true });
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
    notGenerated: false,
    skipped: false,
    failed: false,
    processing: false
  };
}
