import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  countWords,
  countSentences,
  countSummarySentences,
  validateRewriteOutput
} from "./rewrite-validation.js";

function createPayload(overrides?: Partial<PromptPayload>): PromptPayload {
  const bodyText =
    "Selskapet melder at omsetningen var 100 i kvartalet. Resultatet var 20. Guiding er ikke oppgitt.";
  return {
    messageId: 1,
    title: "Kvartalsrapport",
    issuerName: "Test ASA",
    issuerSign: "TEST",
    publishedAt: "2026-02-27T12:00:00.000Z",
    categories: ["FINANCIAL REPORTS"],
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
    lead: "Selskapet la frem kvartalstall.",
    body: [
      "Omsetningen i kvartalet var 100.",
      "Resultatet i perioden var 20.",
      "Meldingen oppgir ingen ny guiding."
    ],
    company_sentence: "Test ASA er et norsk selskap notert pa Oslo Bors.",
    key_facts: ["Omsetning 100", "Resultat 20", "Guiding ikke oppgitt"],
    negative_or_surprising: [],
    excluded_hype: [],
    source_limitations: [],
    confidence: "high",
    importance: "medium",
    source_spans: ["omsetningen var 100", "Resultatet var 20"],
    ...overrides
  };
}

describe("countSentences", () => {
  it("counts punctuation-terminated sentences", () => {
    expect(countSentences("En. To? Tre!")).toBe(3);
  });

  it("treats plain text as one sentence", () => {
    expect(countSentences("Ingen punktum i denne teksten")).toBe(1);
  });
});

describe("countWords", () => {
  it("counts words in headline-like strings", () => {
    expect(countWords("Norsk Titanium inn i forsvar med GA")).toBe(7);
  });
});

describe("countSummarySentences", () => {
  it("sums lead and body sentence counts", () => {
    const rewrite = createRewrite({
      lead: "En setning.",
      body: ["To setninger her. Ja.", "En setning.", "En setning."]
    });
    expect(countSummarySentences(rewrite)).toBe(5);
  });
});

describe("validateRewriteOutput", () => {
  it("allows up to two unexpected number tokens", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead: "Selskapet la frem kvartalstall med nye detaljer.",
      body: [
        "Omsetningen i kvartalet var 101 i denne omtalen.",
        "Resultatet i perioden var 21 ifolge omtalen.",
        "Meldingen oppgir ingen ny guiding."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(true);
  });

  it("fails when more than two unexpected number tokens appear", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead: "Selskapet la frem kvartalstall med nye detaljer.",
      body: [
        "Omsetningen i kvartalet var 101 i denne omtalen.",
        "Resultatet i perioden var 21 ifolge omtalen.",
        "Kontantbeholdningen var 303 ved periodens slutt."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.startsWith("Unexpected numbers:"))).toBe(
      true
    );
  });

  it("fails when summary exceeds max sentence limit", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      lead: "En. To. Tre.",
      body: [
        "Fire. Fem. Seks.",
        "Sju. Atte. Ni.",
        "Ti. Elleve. Tolv.",
        "Tretten. Fjorten. Femten.",
        "Seksten."
      ]
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Summary exceeds 15 sentences.");
  });

  it("fails when company_sentence has more than one sentence", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      company_sentence: "Test ASA er notert. Selskapet driver industri."
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "company_sentence must contain exactly one sentence."
    );
  });

  it("fails when title exceeds eight words", () => {
    const payload = createPayload();
    const rewrite = createRewrite({
      title: "Norsk Titanium med stor milepael i forsvarsmarkedet med Boeing"
    });

    const result = validateRewriteOutput(rewrite, payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Title exceeds 8 words.");
  });
});
