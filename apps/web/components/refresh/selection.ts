import type { FeedItem } from "@newsweb/shared";
import type { RewriteVersion } from "../../lib/api";
import { getViewedRewrite, rememberViewedFeedItem } from "../../lib/viewed-rewrite";
import type { FeedEntry, FeedState } from "./feed-state";

export function versionToFeedItem(version: RewriteVersion, latest: FeedItem): FeedItem {
  return {
    ...latest,
    title: version.rewrite.title,
    lead: version.rewrite.lead,
    body: version.rewrite.body,
    keyFacts: version.rewrite.key_facts,
    negativeOrSurprising: version.rewrite.negative_or_surprising,
    sourceLimitations: version.rewrite.source_limitations,
    confidence: version.rewrite.confidence,
    importance: version.rewrite.importance,
    rewriteId: version.rewriteId,
    rewriteVersion: version.version,
    contentHash: version.contentHash,
    finalizedAt: version.generatedAt,
    isFinal: true,
    notGenerated: false,
    processing: false,
    regenerating: false,
    skipped: false,
    failed: false
  };
}

export function restoreSelection(entry: FeedEntry): FeedEntry {
  const remembered = getViewedRewrite(entry.current.messageId);
  if (
    !remembered ||
    !entry.latest.isFinal ||
    !remembered.item.isFinal ||
    (remembered.item.rewriteVersion ?? 0) > (entry.latest.rewriteVersion ?? 0)
  )
    return entry;
  const current = { ...entry.latest, ...remembered.item };
  const pending =
    (entry.latest.rewriteVersion ?? 0) > remembered.latestVersion &&
    entry.latest.rewriteId !== current.rewriteId
      ? entry.latest
      : undefined;
  return { ...entry, current, pending };
}

export function selectVersion(state: FeedState, selected: FeedItem): FeedState {
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.current.messageId === selected.messageId
        ? { current: selected, latest: entry.latest }
        : entry
    )
  };
}

export function rememberSelection(entry: FeedEntry) {
  if (entry.current.isFinal)
    rememberViewedFeedItem(entry.current, entry.latest.rewriteVersion ?? 1);
}
