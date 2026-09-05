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
    generationRunId: `run-${version}`,
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

function publishedRewrite(version: number) {
  const staged = rewrite(version, "published", new Date("2026-05-07T08:00:00.000Z"));
  return {
    id: `published-${version}`,
    messageId: 123,
    version,
    generationRunId: `run-${version}`,
    lang: staged.lang,
    model: staged.model,
    promptVersion: staged.promptVersion,
    rewriteJson: staged.rewriteJson,
    validationJson: staged.validationJson,
    userInstruction: null,
    contentHash: `hash-${version}`,
    finalizedAt: new Date("2026-05-07T08:05:00.000Z")
  };
}

function feedItem(
  rewrites: ReturnType<typeof rewrite>[],
  activePublishedRewrite: ReturnType<typeof publishedRewrite> | null = null
) {
  return {
    messageId: 123,
    publishedAt: new Date("2026-05-07T08:00:00.000Z"),
    visibilityStatus: "published",
    rankScore: 0,
    activePublishedRewriteId: activePublishedRewrite?.id ?? null,
    publicationRevision: activePublishedRewrite ? 1 : 0,
    nextRewriteVersion: 3,
    activeGenerationRunId: null,
    activePublishedRewrite,
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
      hasAttachments: true,
      rawMessageJson: {
        attachments: [
          {
            id: 77,
            name: "rapport.pdf",
            contentType: "application/pdf",
            size: 987
          }
        ]
      },
      ingestedAt: new Date("2026-05-07T08:00:00.000Z"),
      rewrites
    }
  };
}

describe("mapDbItemToFeedItem", () => {
  it("keeps newer stored articles readable after rollback when company context is empty", () => {
    const published = publishedRewrite(1);
    published.rewriteJson.company_sentence = "";
    const originalJson = JSON.stringify(published.rewriteJson);

    const item = mapDbItemToFeedItem(feedItem([], published) as never);

    expect(item?.isFinal).toBe(true);
    expect(item?.title).toBe(published.rewriteJson.title);
    expect(item?.body).toEqual(published.rewriteJson.body);
    expect(item?.contentHash).toBe(published.contentHash);
    expect(JSON.stringify(published.rewriteJson)).toBe(originalJson);
  });

  it("keeps showing the latest published rewrite while a newer version is pending", () => {
    const item = mapDbItemToFeedItem(
      feedItem([
        rewrite(2, "pending", new Date("2026-05-07T08:10:00.000Z")),
        rewrite(1, "published", new Date("2026-05-07T08:00:00.000Z"))
      ], publishedRewrite(1)) as never
    );

    expect(item?.processing).toBe(false);
    expect(item?.rewriteVersion).toBe(1);
    expect(item?.rewriteId).toBe("published-1");
    expect(item?.contentHash).toBe("hash-1");
    expect(item?.isFinal).toBe(true);
    expect(item?.title).toBe("Publisert versjon 1");
    expect(item?.attachments).toEqual([
      {
        id: 77,
        fileName: "rapport.pdf",
        fileType: "application/pdf",
        fileSize: 987
      }
    ]);
  });

  it("reports processing when only a pending rewrite exists", () => {
    const item = mapDbItemToFeedItem(
      feedItem([rewrite(1, "pending", new Date("2026-05-07T08:00:00.000Z"))]) as never
    );

    expect(item?.processing).toBe(true);
    expect(item?.rewriteVersion).toBe(1);
    expect(item?.notGenerated).toBe(false);
    expect(item?.title).toBe("Original tittel");
  });

  it("does not expose a staging row without an immutable active pointer", () => {
    const item = mapDbItemToFeedItem(
      feedItem([
        rewrite(1, "published", new Date("2026-05-07T08:00:00.000Z"))
      ]) as never
    );

    expect(item?.isFinal).toBe(false);
    expect(item?.rewriteId).toBe(null);
    expect(item?.title).toBe("Original tittel");
  });

  it("reports not generated when no rewrite exists", () => {
    const item = mapDbItemToFeedItem(feedItem([]) as never);

    expect(item?.notGenerated).toBe(true);
    expect(item?.rewriteVersion).toBe(null);
    expect(item?.processing).toBe(false);
    expect(item?.title).toBe("Original tittel");
  });

  it("passes source categories through and repairs legacy double-encoded rows", () => {
    const dbItem = feedItem([]);
    const item = mapDbItemToFeedItem({
      ...dbItem,
      sourceNotice: {
        ...dbItem.sourceNotice,
        categoriesJson: ["INNSIDEINFORMASJON", "BÃ˜RSPAUSE / HANDELSPAUSE"]
      }
    } as never);

    expect(item?.categories).toEqual([
      "INNSIDEINFORMASJON",
      "BØRSPAUSE / HANDELSPAUSE"
    ]);
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
