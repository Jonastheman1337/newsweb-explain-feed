import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import { sanitizeRewriteStyle } from "./style-sanitizer.js";

function createRewrite(overrides?: Partial<RewriteOutput>): RewriteOutput {
  return {
    title: "Norsk Titanium ASA pa XHEL FY25",
    lead: "Norsk Titanium ASA melder at selskapet i FY25 starter leveranser pa XSTO og XCSE.",
    body: [
      "Selskapet skriver at teknologien® kutter kostnader i FY25.",
      "Noteringen pa XHEL, XSTO og XCSE omtales som viktig av selskapet.",
      "Norsk Titanium ASA viser til planer for videre vekst i FY25."
    ],
    company_sentence: "Norsk Titanium ASA er notert pa XHEL.",
    key_facts: [
      "Plan for FY25",
      "Notert pa XSTO",
      "Teknologi® i bruk"
    ],
    negative_or_surprising: ["Kostnader i FY25 kan oke."],
    excluded_hype: ["Ledelsen kalte dette en gamechanger®."],
    source_limitations: ["Vedlegg fra XHEL er ikke analysert."],
    confidence: "medium",
    importance: "medium",
    source_spans: ["Norsk Titanium ASA melder oppdatering for FY25."]
  };
}

describe("sanitizeRewriteStyle", () => {
  it("replaces abbreviations and removes unwanted symbols/suffixes", () => {
    const rewrite = createRewrite();
    const result = sanitizeRewriteStyle(rewrite);

    expect(result.rewrite.title).not.toContain("FY25");
    expect(result.rewrite.title).not.toContain("ASA");
    expect(result.rewrite.lead).not.toContain("XSTO");
    expect(result.rewrite.lead).not.toContain("XCSE");
    expect(result.rewrite.body.join(" ")).not.toContain("®");

    expect(result.rewrite.title).toContain("regnskapsaret 2025");
    expect(result.rewrite.lead).toContain("Stockholm-borsen");
    expect(result.rewrite.lead).toContain("Kobenhavn-borsen");
    expect(result.rewrite.company_sentence).toContain("Helsinki-borsen");
    expect(result.stats.changed).toBe(true);
    expect(result.stats.replacedFiscalYearAbbrev).toBeGreaterThan(0);
    expect(result.stats.expandedMarketCodes).toBeGreaterThan(0);
    expect(result.stats.removedAsaSuffix).toBeGreaterThan(0);
    expect(result.stats.removedRegisteredMarks).toBeGreaterThan(0);
  });

  it("keeps schema-safe minimum lengths", () => {
    const rewrite = createRewrite({
      source_limitations: ["Vedlegg fra ASA er ikke analysert."]
    });
    const result = sanitizeRewriteStyle(rewrite);
    expect(result.rewrite.source_limitations[0].length).toBeGreaterThanOrEqual(5);
  });
});
