import { describe, expect, it } from "vitest";
import type { FeedItem } from "@newsweb/shared";

process.env.DATABASE_URL ??=
  "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public";

const { appendToRingBuffer, applyFeedUpdateState, eventsAfter, parseFeedUpdate } =
  await import("./feed-stream.js");

const baseItem: FeedItem = {
  messageId: 123,
  publishedAt: "2026-05-29T06:00:00.000Z",
  visibilityStatus: "published",
  rewriteVersion: null,
  title: "Original tittel",
  issuerName: "Test ASA",
  issuerSign: "TEST",
  lead: "",
  body: [],
  keyFacts: [],
  negativeOrSurprising: [],
  sourceLimitations: [],
  confidence: "high",
  importance: "uviktig",
  hasAttachments: false,
  attachments: [],
  sourceTitle: "Original tittel",
  sourceBodyText: "Original meldingstekst.",
  categories: [],
  notGenerated: false,
  skipped: false,
  failed: true,
  processing: false,
  regenerating: false
};

describe("feed stream updates", () => {
  it("accepts failed update state", () => {
    expect(parseFeedUpdate(JSON.stringify({ messageId: 123, state: "failed" }))).toEqual({
      messageId: 123,
      state: "failed"
    });
  });

  it("emits failed items from the mapped database state", () => {
    expect(applyFeedUpdateState(baseItem, "failed")).toEqual(baseItem);
  });

  it("keeps first-time generations in the processing state", () => {
    const firstGenerationItem = {
      ...baseItem,
      rewriteVersion: 1,
      failed: false,
      processing: true
    };

    expect(applyFeedUpdateState(firstGenerationItem, "processing")).toEqual({
      ...firstGenerationItem,
      processing: true,
      regenerating: false
    });
  });

  it("marks published items as regenerating instead of replacing the article", () => {
    const publishedItem = {
      ...baseItem,
      rewriteVersion: 1,
      title: "Publisert tittel",
      lead: "Ingress",
      body: ["Brodtekst"],
      failed: false
    };

    expect(applyFeedUpdateState(publishedItem, "processing")).toEqual({
      ...publishedItem,
      processing: false,
      regenerating: true
    });
  });

  it("parses a valid phase and drops unknown phases", () => {
    expect(
      parseFeedUpdate(
        JSON.stringify({ messageId: 1, state: "processing", phase: "writing_notice" })
      )
    ).toEqual({ messageId: 1, state: "processing", phase: "writing_notice" });

    expect(
      parseFeedUpdate(
        JSON.stringify({ messageId: 1, state: "processing", phase: "not-a-phase" })
      )
    ).toEqual({ messageId: 1, state: "processing", phase: undefined });
  });

  it("attaches the phase to processing and regenerating items", () => {
    const processingItem = { ...baseItem, failed: false };
    expect(
      applyFeedUpdateState(processingItem, "processing", "checking_references").phase
    ).toBe("checking_references");

    const publishedItem = {
      ...baseItem,
      rewriteVersion: 1,
      lead: "Ingress",
      failed: false
    };
    const regenerating = applyFeedUpdateState(
      publishedItem,
      "processing",
      "writing_notice"
    );
    expect(regenerating.regenerating).toBe(true);
    expect(regenerating.phase).toBe("writing_notice");
  });
});

describe("feed stream ring buffer", () => {
  it("caps the buffer and evicts oldest entries", () => {
    const buffer: Array<{ id: string; frame: string }> = [];
    for (let i = 1; i <= 5; i++) {
      appendToRingBuffer(buffer, { id: `e-${i}`, frame: `frame-${i}` }, 3);
    }
    expect(buffer.map((event) => event.id)).toEqual(["e-3", "e-4", "e-5"]);
  });

  it("replays events after a known id", () => {
    const buffer = [
      { id: "e-1", frame: "frame-1" },
      { id: "e-2", frame: "frame-2" },
      { id: "e-3", frame: "frame-3" }
    ];
    expect(eventsAfter(buffer, "e-1")?.map((event) => event.id)).toEqual([
      "e-2",
      "e-3"
    ]);
    expect(eventsAfter(buffer, "e-3")).toEqual([]);
  });

  it("returns null for unknown ids (evicted or stale epoch)", () => {
    const buffer = [{ id: "e-2", frame: "frame-2" }];
    expect(eventsAfter(buffer, "e-1")).toBeNull();
    expect(eventsAfter(buffer, "1234-99")).toBeNull();
  });
});
