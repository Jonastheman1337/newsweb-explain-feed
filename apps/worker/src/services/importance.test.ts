import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import { applyImportanceHighBar } from "./importance.js";

function createPayload(overrides?: Partial<PromptPayload>): PromptPayload {
  const bodyText =
    "Company reports update. No major strategic, financial or regulatory event is described.";
  return {
    messageId: 1,
    title: "General update",
    issuerName: "Test ASA",
    issuerSign: "TEST",
    publishedAt: "2026-02-27T12:00:00.000Z",
    categories: ["OTHER"],
    markets: ["XOSL"],
    bodyText,
    hasAttachments: false,
    sourceBodyChars: bodyText.length,
    ...overrides
  };
}

function createRewrite(overrides?: Partial<RewriteOutput>): RewriteOutput {
  return {
    title: "Kort oppdatering",
    lead: "Selskapet la frem en oppdatering i dag.",
    body: [
      "Teksten oppsummerer endringer uten store konsekvenser.",
      "Det er ingen nye strategiske hendelser nevnt i meldingen.",
      "Selskapet viser til videre informasjon i markedskommunikasjon."
    ],
    company_sentence: "Test ASA er et norsk selskap notert pa Oslo Bors.",
    key_facts: ["Punkt 1", "Punkt 2", "Punkt 3"],
    negative_or_surprising: [],
    excluded_hype: [],
    source_limitations: [],
    confidence: "medium",
    importance: "medium",
    source_spans: ["General update"],
    ...overrides
  };
}

describe("applyImportanceHighBar", () => {
  it("downgrades 'viktig' when severe signal is missing", () => {
    const payload = createPayload();
    const rewrite = createRewrite({ importance: "viktig" });

    const result = applyImportanceHighBar(rewrite, payload);
    expect(result.rewrite.importance).toBe("medium");
    expect(result.adjusted).toBe(true);
  });

  it("keeps 'viktig' on clear severe signal", () => {
    const payload = createPayload({
      title: "Company issues profit warning",
      bodyText: "The company has issued a profit warning and cuts guidance."
    });
    const rewrite = createRewrite({ importance: "viktig" });

    const result = applyImportanceHighBar(rewrite, payload);
    expect(result.rewrite.importance).toBe("viktig");
    expect(result.adjusted).toBe(false);
  });

  it("downgrades routine medium notice to uviktig", () => {
    const payload = createPayload({
      title: "Share repurchases on 27.2.2026",
      bodyText: "The issuer reports share repurchases in line with prior plan."
    });
    const rewrite = createRewrite({ importance: "medium" });

    const result = applyImportanceHighBar(rewrite, payload);
    expect(result.rewrite.importance).toBe("uviktig");
    expect(result.adjusted).toBe(true);
  });
});
