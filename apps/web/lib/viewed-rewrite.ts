"use client";

import { feedItemSchema, type FeedItem, type RewriteOutput } from "@newsweb/shared";

const viewedRewriteSchema = feedItemSchema.pick({
  publicationKind: true,
  rewriteId: true,
  rewriteVersion: true,
  publicationRevision: true,
  contentHash: true,
  finalizedAt: true,
  isFinal: true,
  title: true,
  lead: true,
  body: true,
  importance: true,
  keyFacts: true,
  negativeOrSurprising: true,
  sourceLimitations: true,
  confidence: true
});

export const VIEWED_REWRITE_CHANGE_EVENT = "newsweb:viewed-rewrite-change";

function storageKey(messageId: number) {
  return `newsweb:viewed-rewrite:${messageId}`;
}

export function getViewedRewrite(messageId: number) {
  try {
    const stored = window.sessionStorage.getItem(storageKey(messageId));
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    const item = viewedRewriteSchema.safeParse(parsed.item);
    if (!item.success || !Number.isInteger(parsed.latestVersion)) return null;
    return { item: item.data, latestVersion: parsed.latestVersion as number };
  } catch {
    return null;
  }
}

export function rememberViewedRewrite(
  messageId: number,
  active: {
    rewriteId: string;
    version: number;
    rewrite: RewriteOutput;
    generatedAt: string;
    contentHash: string;
    isFinal: true;
  },
  latestVersion: number,
  publicationRevision = 0
) {
  try {
    window.sessionStorage.setItem(
      storageKey(messageId),
      JSON.stringify({
        latestVersion,
        item: {
          ...active.rewrite,
          keyFacts: active.rewrite.key_facts,
          negativeOrSurprising: active.rewrite.negative_or_surprising,
          sourceLimitations: active.rewrite.source_limitations,
          rewriteId: active.rewriteId,
          rewriteVersion: active.version,
          publicationRevision,
          contentHash: active.contentHash,
          finalizedAt: active.generatedAt,
          isFinal: active.isFinal
        }
      })
    );
    window.dispatchEvent(new Event(VIEWED_REWRITE_CHANGE_EVENT));
  } catch {
    // Version navigation still works when browser storage is unavailable.
  }
}

/** Remember the selected feed publication without synthesizing generation fields. */
export function rememberViewedFeedItem(item: FeedItem, latestVersion: number) {
  try {
    window.sessionStorage.setItem(
      storageKey(item.messageId),
      JSON.stringify({
        latestVersion,
        item: viewedRewriteSchema.parse(item)
      })
    );
    window.dispatchEvent(new Event(VIEWED_REWRITE_CHANGE_EVENT));
  } catch {
    // The mounted editor remains usable when session storage is unavailable.
  }
}

export function applyViewedRewrite(item: FeedItem): FeedItem {
  const viewed = getViewedRewrite(item.messageId);
  if (!viewed || viewed.item.publicationKind === "fast") return item;
  // A newly published generation must still reach the feed. Older cached feed
  // responses, however, must not replace the version just viewed in detail.
  if (
    (item.rewriteVersion ?? 0) > viewed.latestVersion ||
    item.publicationRevision > viewed.item.publicationRevision
  )
    return item;

  return {
    ...item,
    ...viewed.item,
    notGenerated: false,
    skipped: false,
    failed: false,
    processing: false
  };
}
