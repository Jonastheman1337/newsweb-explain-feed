import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import { sanitizeRewriteStyle } from "./style-sanitizer.js";

function createRewrite(overrides?: Partial<RewriteOutput>): RewriteOutput {
  return {
    title: "Norsk Titanium ASA pa XHEL FY25",
    lead: "Norsk Titanium ASA melder at selskapet i FY25 starter leveranser pa XSTO og XCSE.",
    body: [
      "Selskapet skriver at teknologien® kutter kostnader 10% i FY25.",
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
    source_spans: ["Norsk Titanium ASA melder oppdatering for FY25."],
    ...overrides
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
    expect(result.rewrite.body.join(" ")).not.toContain("%");
    expect(result.rewrite.body.join(" ")).toContain("10 prosent");

    expect(result.rewrite.title).toContain("regnskapsåret 2025");
    expect(result.rewrite.lead).toContain("Stockholm-børsen");
    expect(result.rewrite.lead).toContain("København-børsen");
    expect(result.rewrite.company_sentence).toContain("Helsinki-børsen");
    expect(result.stats.changed).toBe(true);
    expect(result.stats.replacedFiscalYearAbbrev).toBeGreaterThan(0);
    expect(result.stats.expandedMarketCodes).toBeGreaterThan(0);
    expect(result.stats.removedAsaSuffix).toBeGreaterThan(0);
    expect(result.stats.removedRegisteredMarks).toBeGreaterThan(0);
    expect(result.stats.replacedPercentSigns).toBeGreaterThan(0);
  });

  it("normalizes visible accounting acronyms to lowercase", () => {
    const rewrite = createRewrite({
      title: "Selskapet løfter EBIT",
      lead: "Selskapet melder at EBITDA steg, mens EBITA falt.",
      body: ["EBIT endte på 20 millioner kroner."],
      key_facts: ["EBITDA opp", "EBITA ned"]
    });

    const result = sanitizeRewriteStyle(rewrite);
    const visibleAndMetadata = [
      result.rewrite.title,
      result.rewrite.lead,
      ...result.rewrite.body,
      ...result.rewrite.key_facts
    ].join(" ");

    expect(visibleAndMetadata).not.toMatch(/\b(?:EBITDA|EBITA|EBIT)\b/);
    expect(visibleAndMetadata).toContain("ebitda");
    expect(visibleAndMetadata).toContain("ebita");
    expect(visibleAndMetadata).toContain("ebit");
    expect(result.stats.normalizedAccountingAcronyms).toBe(6);
    expect(result.stats.changed).toBe(true);
  });

  it("keeps schema-safe minimum lengths", () => {
    const rewrite = createRewrite({
      source_limitations: ["Vedlegg fra ASA er ikke analysert."]
    });
    const result = sanitizeRewriteStyle(rewrite);
    expect(result.rewrite.source_limitations[0].length).toBeGreaterThanOrEqual(5);
  });

  it("normalizes million amounts from 1.000 and up to milliarder", () => {
    const rewrite = createRewrite();
    rewrite.title = "Vegfinans utsteder for 1.000 millioner kroner";
    rewrite.lead = "Vegfinans har utstedt nye obligasjoner på 1.000 millioner kroner.";
    rewrite.body = [
      "Lånet er på 1000 millioner kroner.",
      "Rammen er 1.200 millioner kroner og kan økes til 2.500 millioner."
    ];

    const result = sanitizeRewriteStyle(rewrite);

    expect(result.rewrite.title).toContain("én milliard kroner");
    expect(result.rewrite.lead).toContain("én milliard kroner");
    expect(result.rewrite.body[0]).toContain("én milliard kroner");
    expect(result.rewrite.body[1]).toContain("1,2 milliarder kroner");
    expect(result.rewrite.body[1]).toContain("2,5 milliarder");
    expect(result.stats.normalizedBillionPhrases).toBe(5);
  });

  it("leaves amounts below 1.000 millioner unchanged", () => {
    const rewrite = createRewrite();
    rewrite.title = "Selskapet henter 999 millioner kroner";
    rewrite.lead = "Selskapet henter 999 millioner kroner.";
    rewrite.body = ["Rammen er 250 millioner kroner."];

    const result = sanitizeRewriteStyle(rewrite);

    expect(result.rewrite.title).toContain("999 millioner kroner");
    expect(result.rewrite.lead).toContain("999 millioner kroner");
    expect(result.rewrite.body[0]).toContain("250 millioner kroner");
    expect(result.stats.normalizedBillionPhrases).toBe(0);
  });

  it("normalizes exact billion-scale kroner totals", () => {
    const rewrite = createRewrite();
    rewrite.title = "Austevoll betaler 1.317.662.931 kroner";
    rewrite.lead = "Austevoll Seafood betaler 1.317.662.931 kroner i utbytte.";
    rewrite.body = ["Beløpet er 2 000 000 000 kroner i et annet eksempel."];

    const result = sanitizeRewriteStyle(rewrite);

    expect(result.rewrite.title).toContain("1,3 milliarder kroner");
    expect(result.rewrite.lead).toContain("1,3 milliarder kroner");
    expect(result.rewrite.body[0]).toContain("2 milliarder kroner");
    expect(result.stats.normalizedExactBillionAmounts).toBe(3);
  });

  it("keeps enough precision for exact kroner totals close to one billion", () => {
    const rewrite = createRewrite();
    rewrite.lead =
      "Norse Atlantic oker aksjekapitalen med 1.019.832.000 kroner.";

    const result = sanitizeRewriteStyle(rewrite);

    expect(result.rewrite.lead).toContain("1,02 milliarder kroner");
    expect(result.stats.normalizedExactBillionAmounts).toBe(1);
  });

  it("leaves exact kroner totals below one billion unchanged", () => {
    const rewrite = createRewrite();
    rewrite.title = "HAV Group-styremedlem kjøper for 448.760 kroner";
    rewrite.lead = "Kamato kjøper aksjer for 448.760 kroner.";

    const result = sanitizeRewriteStyle(rewrite);

    expect(result.rewrite.title).toContain("448.760 kroner");
    expect(result.rewrite.lead).toContain("448.760 kroner");
    expect(result.stats.normalizedExactBillionAmounts).toBe(0);
  });
});
