import type { FeedItem } from "@newsweb/shared";

export type FeedEntry = {
  current: FeedItem;
  latest: FeedItem;
  pending?: FeedItem;
};
export type FeedState = { entries: FeedEntry[] };
export const sortItems = (items: FeedItem[]) =>
  [...items].sort(
    (a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.messageId - a.messageId
  );
export function fastDraftToFeedItem(item: FeedItem): FeedItem | undefined {
  const draft = item.fastDraft;
  if (draft?.status !== "ready" || !draft.rewrite) return undefined;
  const rewrite = draft.rewrite;
  return { ...item, publicationKind: "fast", rewriteId: `fast:${draft.id}`, rewriteVersion: 1, contentHash: draft.id, finalizedAt: draft.finishedAt, isFinal: true, title: rewrite.title, lead: rewrite.lead, body: rewrite.body, keyFacts: rewrite.key_facts, negativeOrSurprising: rewrite.negative_or_surprising, sourceLimitations: rewrite.source_limitations, confidence: rewrite.confidence, importance: rewrite.importance, notGenerated: false, skipped: false, failed: false, processing: false, regenerating: false };
}
export const initialFeedState = (items: FeedItem[]): FeedState => ({
  entries: sortItems(items).map((item) => ({ current: item.isFinal ? item : fastDraftToFeedItem(item) ?? item, latest: item }))
});

function receive(entry: FeedEntry, item: FeedItem): FeedEntry {
  // Replayed/late events must not roll a publication backwards.
  if (item.publicationRevision < entry.latest.publicationRevision) return entry;
  const changed =
    item.isFinal &&
    !!item.rewriteId &&
    (item.rewriteId !== entry.current.rewriteId || item.contentHash !== entry.current.contentHash);
  const newlyPublished =
    item.rewriteId !== entry.latest.rewriteId || item.contentHash !== entry.latest.contentHash;
  if (changed && entry.current.isFinal && (newlyPublished || entry.pending)) {
    return { ...entry, latest: item, pending: item };
  }
  if (!entry.current.isFinal) return { current: item.isFinal ? item : fastDraftToFeedItem(item) ?? item, latest: item };
  // Keep the editor's publication props identical during progress events.
  return { ...entry, latest: item };
}

export function receiveFeedItem(state: FeedState, item: FeedItem): FeedState {
  if (state.entries.some((entry) => entry.current.messageId === item.messageId)) {
    return {
      ...state,
      entries: state.entries.map((entry) =>
        entry.current.messageId === item.messageId ? receive(entry, item) : entry
      )
    };
  }
  return {
    entries: [...state.entries, ...initialFeedState([item]).entries].sort(
      (a, b) =>
        b.current.publishedAt.localeCompare(a.current.publishedAt) ||
        b.current.messageId - a.current.messageId
    )
  };
}

export function selectPending(state: FeedState, id: number): FeedState {
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.current.messageId === id && entry.pending
        ? { current: entry.pending, latest: entry.latest }
        : entry
    )
  };
}
