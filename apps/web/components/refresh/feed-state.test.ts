import { describe, expect, it } from "vitest";
import type { FeedItem } from "@newsweb/shared";
import { initialFeedState, receiveFeedItem, revealIncoming, selectPending } from "./feed-state";
const item = {
  messageId: 1,
  publishedAt: "2026-09-07T07:00:00Z",
  rewriteId: "v1",
  publicationRevision: 1,
  contentHash: "h1",
  isFinal: true,
  title: "Original"
} as FeedItem;

describe("refresh feed publications", () => {
  it("keeps the exact editor props through progress and completion until explicitly selected", () => {
    let state = initialFeedState([item]);
    state = receiveFeedItem(state, { ...item, regenerating: true });
    expect(state.entries[0].current).toBe(item);
    const completed = {
      ...item,
      rewriteId: "v2",
      publicationRevision: 2,
      contentHash: "h2",
      title: "New title"
    };
    state = receiveFeedItem(state, completed);
    expect(state.entries[0].current).toBe(item);
    expect(state.entries[0].pending).toBe(completed);
    state = receiveFeedItem(state, item); // late replay
    expect(state.entries[0].pending).toBe(completed);
    state = selectPending(state, 1);
    expect(state.entries[0].current).toBe(completed);
    expect(state.entries[0].pending).toBeUndefined();
  });
  it("buffers and deduplicates new notices without moving existing cards", () => {
    const newer = { ...item, messageId: 2, publishedAt: "2026-09-07T08:00:00Z" };
    let state = receiveFeedItem(initialFeedState([item]), newer);
    state = receiveFeedItem(state, newer);
    expect(state.entries.map((entry) => entry.current.messageId)).toEqual([1]);
    expect(state.incoming).toHaveLength(1);
    state = revealIncoming(state);
    expect(state.entries.map((entry) => entry.current.messageId)).toEqual([2, 1]);
    expect(state.incoming).toEqual([]);
  });
  it("shows the first usable publication directly when the source was waiting", () => {
    const waiting = { ...item, isFinal: false, rewriteId: null, publicationRevision: 0 };
    const state = receiveFeedItem(initialFeedState([waiting]), item);
    expect(state.entries[0].current).toBe(item);
    expect(state.entries[0].pending).toBeUndefined();
  });
});

const fast = {
  ...item, isFinal: false, rewriteId: null, contentHash: null, publicationRevision: 0,
  fastDraft: { id: "short-1", status: "ready", startedAt: "2026-09-07T07:00:00Z", finishedAt: "2026-09-07T07:00:07Z", rewrite: { title: "First draft", lead: "First checked lead", body: [], company_sentence: "", excluded_hype: [], source_spans: ["Source excerpt"], key_facts: [], negative_or_surprising: [], source_limitations: [], confidence: "high", importance: "viktig" } }
} as FeedItem;
it("keeps a usable first draft through full completion, failure and late replay", () => {
  let state = initialFeedState([fast]);
  const selected = state.entries[0].current;
  expect(selected.publicationKind).toBe("fast");
  state = receiveFeedItem(state, { ...fast, failed: true });
  expect(state.entries[0].current).toBe(selected);
  state = receiveFeedItem(state, { ...item, fastDraft: fast.fastDraft });
  expect(state.entries[0].current).toBe(selected);
  expect(state.entries[0].pending?.rewriteId).toBe("v1");
  state = receiveFeedItem(state, fast);
  expect(state.entries[0].current).toBe(selected);
  state = selectPending(state, 1);
  expect(state.entries[0].current.rewriteId).toBe("v1");
});
it("never replaces a full article when the fast result arrives second", () => {
  const state = receiveFeedItem(initialFeedState([item]), { ...item, fastDraft: fast.fastDraft });
  expect(state.entries[0].current).toBe(item);
  expect(state.entries[0].pending).toBeUndefined();
  expect(state.entries[0].latest.fastDraft?.id).toBe("short-1");
});
