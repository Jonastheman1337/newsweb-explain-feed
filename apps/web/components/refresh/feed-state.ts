import type { FeedItem } from "@newsweb/shared";

export type FeedEntry = {
  current: FeedItem;
  latest: FeedItem;
  pending?: FeedItem;
};
export type FeedState = { entries: FeedEntry[]; incoming: FeedItem[] };
export const sortItems = (items: FeedItem[]) =>
  [...items].sort(
    (a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.messageId - a.messageId
  );
export const initialFeedState = (items: FeedItem[]): FeedState => ({
  entries: sortItems(items).map((item) => ({ current: item, latest: item })),
  incoming: []
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
  if (!entry.current.isFinal) return { current: item, latest: item };
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
  const previous = state.incoming.find((old) => old.messageId === item.messageId);
  if (previous && previous.publicationRevision > item.publicationRevision) return state;
  return {
    ...state,
    incoming: sortItems([...state.incoming.filter((old) => old.messageId !== item.messageId), item])
  };
}

export function revealIncoming(state: FeedState): FeedState {
  return {
    entries: [...state.entries, ...initialFeedState(state.incoming).entries].sort(
      (a, b) =>
        b.current.publishedAt.localeCompare(a.current.publishedAt) ||
        b.current.messageId - a.current.messageId
    ),
    incoming: []
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
