import { describe, expect, it } from "vitest";
import type { FeedItem } from "@newsweb/shared";

process.env.DATABASE_URL ??=
  "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public";

const { applyFeedUpdateState, parseFeedUpdate } = await import("./feed-stream.js");

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
});
