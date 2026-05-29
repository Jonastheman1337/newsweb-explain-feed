import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  buildEditorialRevisionReviewUserPrompt,
  editorialRepairInstruction,
  parseEditorialRevisionReviewResponse,
  shouldRunEditorialRevisionReview
} from "./editorial-review.js";

function createRewrite(overrides?: Partial<RewriteOutput>): RewriteOutput {
  return {
    title: "Ensuro henter nye penger",
    lead: "Ensuro henter 200 millioner kroner i en emisjon.",
    body: ["Selskapet opplyser at kapitalen skal brukes til vekst."],
    company_sentence: "Ensuro er et teknologiselskap.",
    key_facts: ["Henter 200 millioner kroner"],
    negative_or_surprising: [],
    excluded_hype: [],
    source_limitations: [],
    confidence: "high",
    importance: "medium",
    source_spans: ["henter 200 millioner kroner"],
    ...overrides
  };
}

describe("editorial revision review", () => {
  it("does not run for ambiguous bare removal instructions", () => {
    expect(
      shouldRunEditorialRevisionReview({
        instruction: "fjern dette",
        previousOutput: createRewrite()
      })
    ).toBe(false);
  });

  it("runs for recognized manual revision intents", () => {
    expect(
      shouldRunEditorialRevisionReview({
        instruction: "fjern dette: Bare 0,57 prosent er vanlige aksjer.",
        previousOutput: createRewrite()
      })
    ).toBe(true);
  });

  it("passes compliant mocked review responses without repair", () => {
    const review = parseEditorialRevisionReviewResponse(
      JSON.stringify({
        compliant: true,
        findings: [],
        repairInstruction: ""
      })
    );

    expect(editorialRepairInstruction(review)).toBeNull();
  });

  it("triggers one narrow repair from mocked review responses", () => {
    const review = parseEditorialRevisionReviewResponse(
      JSON.stringify({
        compliant: false,
        findings: ["Urelatert lead ble skrevet om."],
        repairInstruction:
          "Fjern bare setningen om 0,57 prosent, og behold resten av forrige versjon mest mulig uendret."
      })
    );

    expect(editorialRepairInstruction(review)).toContain("Fjern bare setningen");
  });

  it("builds prompt with original instruction, intent summary and both rewrites", () => {
    const previousOutput = createRewrite({
      lead:
        "Ensuro henter 200 millioner kroner i en emisjon. Bare 0,57 prosent er vanlige aksjer."
    });
    const draftRewrite = createRewrite();
    const prompt = buildEditorialRevisionReviewUserPrompt({
      instruction: "Kutt dette: Bare 0,57 prosent er vanlige aksjer.",
      previousOutput,
      draftRewrite
    });

    expect(prompt).toContain("INSTRUKSJON:");
    expect(prompt).toContain("MASKINLEST INTENT:");
    expect(prompt).toContain("FORRIGE VERSJON:");
    expect(prompt).toContain("DRAFT:");
  });
});
