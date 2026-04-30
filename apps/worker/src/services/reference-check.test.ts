import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  buildCorrectionInstruction,
  buildCoverageReport,
  collectDraftSentences,
  splitIntoSentences,
  type ReferenceCheckResult
} from "./reference-check.js";

function createRewrite(overrides?: Partial<RewriteOutput>): RewriteOutput {
  return {
    title: "Kort oppdatering",
    lead: "Erna Solberg var tidligere statsminister i Norge.",
    body: [
      "Hun kommer fra partiet Hoyre.",
      "Dette er en ekstra testsetning.",
      "Ingen flere detaljer er oppgitt."
    ],
    company_sentence: "Test AS er et norsk selskap notert pa Oslo Bors.",
    key_facts: ["Faktum 1", "Faktum 2", "Faktum 3"],
    negative_or_surprising: [],
    excluded_hype: [],
    source_limitations: [],
    confidence: "medium",
    importance: "medium",
    source_spans: ["Erna Solberg er tidligere statsminister i Norge."],
    ...overrides
  };
}

describe("splitIntoSentences", () => {
  it("splits sentence chunks on punctuation boundaries", () => {
    expect(splitIntoSentences("En setning. To setning! Tre setning?")).toEqual([
      "En setning.",
      "To setning!",
      "Tre setning?"
    ]);
  });
});

describe("collectDraftSentences", () => {
  it("collects visible article sentences from rewrite", () => {
    const rewrite = createRewrite({
      lead: "Første. Andre.",
      body: ["Tredje.", "Fjerde.", "Femte."],
      company_sentence: "Sjette."
    });

    expect(collectDraftSentences(rewrite)).toEqual([
      "Første.",
      "Andre.",
      "Tredje.",
      "Fjerde.",
      "Femte.",
      "Sjette."
    ]);
  });
});

describe("buildCoverageReport", () => {
  it("computes coverage percent and unsupported sentence list", () => {
    const draftSentences = [
      "Statsministeren het tidligere Erna Solberg.",
      "Hun er fra partiet Hoyre."
    ];

    const raw: ReferenceCheckResult = {
      sentences: [
        {
          index: 0,
          sentence: draftSentences[0],
          grounded: true,
          interpretation: "Setningen har dekning i kilden.",
          sourceEvidence: "Erna Solberg er tidligere statsminister i Norge."
        },
        {
          index: 1,
          sentence: draftSentences[1],
          grounded: false,
          interpretation: "Partitilhørighet er ikke oppgitt i kilden.",
          sourceEvidence: "Erna Solberg er tidligere statsminister i Norge."
        }
      ]
    };

    const report = buildCoverageReport(draftSentences, raw);
    expect(report.totalSentences).toBe(2);
    expect(report.groundedSentences).toBe(1);
    expect(report.coveragePercent).toBe(50);
    expect(report.unsupportedSentences).toHaveLength(1);
    expect(report.unsupportedSentences[0]?.sentence).toContain("partiet Hoyre");
  });
});

describe("buildCorrectionInstruction", () => {
  it("builds rewrite instruction when unsupported sentences exist", () => {
    const rewrite = createRewrite();
    const raw: ReferenceCheckResult = {
      sentences: collectDraftSentences(rewrite).map((sentence, index) => ({
        index,
        sentence,
        grounded: index !== 1,
        interpretation:
          index === 1 ? "Partitilhørighet er ikke oppgitt i kilden." : "Dekket.",
        sourceEvidence: "Erna Solberg er tidligere statsminister i Norge."
      }))
    };
    const report = buildCoverageReport(collectDraftSentences(rewrite), raw);
    const instruction = buildCorrectionInstruction(report);
    expect(instruction).toContain("Setninger uten dekning i forrige utkast");
    expect(instruction).toContain("Hun kommer fra partiet Hoyre.");
  });
});
