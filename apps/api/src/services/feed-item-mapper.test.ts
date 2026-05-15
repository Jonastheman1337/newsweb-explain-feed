import { describe, expect, it } from "vitest";
import { mapDbItemToFeedItem } from "./feed-item-mapper.js";

function rewrite(
  version: number,
  status: "pending" | "published" | "failed" | "skipped",
  generatedAt: Date
) {
  return {
    id: `rewrite-${version}`,
    messageId: 123,
    version,
    lang: "nb",
    model: "test-model",
    promptVersion: "test-prompt",
    status,
    userInstruction: null,
    generatedAt,
    validationJson: { valid: true },
    rewriteJson: {
      title: `Publisert versjon ${version}`,
      lead: "Dette er en lang nok ingress for validering.",
      body: ["Dette er en lang nok brodtekst for validering."],
      company_sentence: "Selskapet er omtalt i meldingen.",
      key_facts: ["Nokkelpunkt fra kilden"],
      negative_or_surprising: [],
      excluded_hype: [],
      source_limitations: [],
      confidence: "high",
      importance: "medium",
      source_spans: ["Kildeutdrag fra meldingen"]
    }
  };
}

function feedItem(rewrites: ReturnType<typeof rewrite>[]) {
  return {
    messageId: 123,
    publishedAt: new Date("2026-05-07T08:00:00.000Z"),
    visibilityStatus: "published",
    rankScore: 0,
    sourceNotice: {
      messageId: 123,
      newsId: 456,
      title: "Original tittel",
      issuerName: "Test ASA",
      issuerSign: "TEST",
      publishedAt: new Date("2026-05-07T08:00:00.000Z"),
      categoriesJson: [],
      marketsJson: [],
      bodyText: "Original meldingstekst.",
      hasAttachments: false,
      rawMessageJson: {},
      ingestedAt: new Date("2026-05-07T08:00:00.000Z"),
      rewrites
    }
  };
}

describe("mapDbItemToFeedItem", () => {
  it("keeps showing the latest published rewrite while a newer version is pending", () => {
    const item = mapDbItemToFeedItem(
      feedItem([
        rewrite(2, "pending", new Date("2026-05-07T08:10:00.000Z")),
        rewrite(1, "published", new Date("2026-05-07T08:00:00.000Z"))
      ]) as never
    );

    expect(item?.processing).toBe(false);
    expect(item?.title).toBe("Publisert versjon 1");
  });

  it("reports processing when only a pending rewrite exists", () => {
    const item = mapDbItemToFeedItem(
      feedItem([rewrite(1, "pending", new Date("2026-05-07T08:00:00.000Z"))]) as never
    );

    expect(item?.processing).toBe(true);
    expect(item?.title).toBe("Original tittel");
  });

  it("keeps failed rewrites visible as retryable source cards", () => {
    const item = mapDbItemToFeedItem(
      feedItem([rewrite(1, "failed", new Date("2026-05-07T08:00:00.000Z"))]) as never
    );

    expect(item?.failed).toBe(true);
    expect(item?.processing).toBe(false);
    expect(item?.title).toBe("Original tittel");
  });

  it("keeps skipped rewrites visible as source cards", () => {
    const item = mapDbItemToFeedItem(
      feedItem([rewrite(1, "skipped", new Date("2026-05-07T08:00:00.000Z"))]) as never
    );

    expect(item?.skipped).toBe(true);
    expect(item?.processing).toBe(false);
    expect(item?.title).toBe("Original tittel");
  });
});
