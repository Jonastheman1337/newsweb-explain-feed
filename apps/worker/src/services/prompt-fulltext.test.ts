import { createUserPrompt, type PromptPayload } from "@newsweb/prompt-kit";
import { describe, expect, it } from "vitest";

describe("createUserPrompt", () => {
  it("includes full bodyText and sourceBodyChars in prompt payload", () => {
    const bodyText = `Line 1: ${"A".repeat(1200)}\nLine 2: ${"B".repeat(1200)}`;
    const payload: PromptPayload = {
      messageId: 42,
      title: "Lang melding",
      issuerName: "Langtekst ASA",
      issuerSign: "LONG",
      publishedAt: "2026-02-27T12:00:00.000Z",
      categories: ["OTHER"],
      markets: ["XOSL"],
      bodyText,
      hasAttachments: true,
      sourceBodyChars: bodyText.length
    };

    const prompt = createUserPrompt(payload);

    expect(prompt).toContain(`sourceBodyChars: ${bodyText.length}`);
    expect(prompt).toContain("KILDE (FULL ORIGINALTEKST):");
    expect(prompt).toContain(bodyText);
  });
});
