import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  buildAttributionCorrectionInstruction,
  findAttributionRisks
} from "./claim-precautions.js";

function createRewrite(overrides?: Partial<RewriteOutput>): RewriteOutput {
  return {
    title: "Kort oppdatering",
    lead: "Selskapet lanserer en ny teknologiplattform i dag.",
    body: [
      "Teknologien gjor det mulig a redusere materialsvinn og energibruk.",
      "Dette bidrar til bedre kapitalutnyttelse for kundene.",
      "Selskapet vil starte kommersiell produksjon i andre halvaar."
    ],
    company_sentence: "Test ASA er et norsk selskap notert pa Oslo Bors.",
    key_facts: ["Punkt 1", "Punkt 2", "Punkt 3"],
    negative_or_surprising: [],
    excluded_hype: [],
    source_limitations: [],
    confidence: "medium",
    importance: "medium",
    source_spans: ["Teknologien gjor det mulig a redusere materialsvinn."],
    ...overrides
  };
}

describe("findAttributionRisks", () => {
  it("flags assertive effect claims without attribution", () => {
    const rewrite = createRewrite();
    const risks = findAttributionRisks(rewrite);
    expect(risks.length).toBeGreaterThanOrEqual(2);
    expect(risks[0]?.sentence).toContain("gjor det mulig");
  });

  it("flags attributed claims that still lack hedging", () => {
    const rewrite = createRewrite({
      body: [
        "Teknologien ifolge selskapet gjor det mulig a redusere materialsvinn og energibruk.",
        "Dette ifolge selskapet bidrar til bedre kapitalutnyttelse for kundene.",
        "Selskapet vil starte kommersiell produksjon i andre halvaar."
      ]
    });
    const risks = findAttributionRisks(rewrite);
    expect(risks.length).toBeGreaterThanOrEqual(2);
    expect(risks[0]?.reason).toContain("mangler forbehold");
  });

  it("accepts hedged and attributed effect claims", () => {
    const rewrite = createRewrite({
      body: [
        "Teknologien skal ifolge selskapet gjor det mulig a redusere materialsvinn og energibruk.",
        "Dette kan bidra til bedre kapitalutnyttelse, hevdes det.",
        "Selskapet vil starte kommersiell produksjon i andre halvaar."
      ]
    });
    const risks = findAttributionRisks(rewrite);
    expect(risks).toEqual([]);
  });
});

describe("buildAttributionCorrectionInstruction", () => {
  it("returns correction prompt with risky sentence details", () => {
    const rewrite = createRewrite();
    const risks = findAttributionRisks(rewrite);
    const instruction = buildAttributionCorrectionInstruction(risks);
    expect(instruction).toContain("Setninger som ma omskrives");
    expect(instruction).toContain("ifolge selskapet");
  });
});
