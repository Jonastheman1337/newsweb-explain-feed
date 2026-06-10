import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  assessReferenceCheckGate,
  buildCorrectionInstruction,
  buildCoverageReport,
  buildReferenceCheckPrompt,
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

  it("does not split Norwegian calendar dates into sentence fragments", () => {
    expect(
      splitIntoSentences(
        "Handelen ble gjort på Oslo Børs 1. juni. Hun betalte 287,60 kroner per aksje."
      )
    ).toEqual([
      "Handelen ble gjort på Oslo Børs 1. juni.",
      "Hun betalte 287,60 kroner per aksje."
    ]);
  });
});

describe("assessReferenceCheckGate", () => {
  it("blocks unsupported high-risk factual claims", () => {
    const report = buildCoverageReport(
      [
        "Selskapet fikk et resultat før skatt på 100 millioner kroner.",
        "Selskapet er notert i Oslo."
      ],
      {
        sentences: [
          {
            index: 0,
            sentence: "Selskapet fikk et resultat før skatt på 100 millioner kroner.",
            grounded: false,
            interpretation: "Tallet finnes ikke i kilden.",
            sourceEvidence: ""
          },
          {
            index: 1,
            sentence: "Selskapet er notert i Oslo.",
            grounded: true,
            interpretation: "Dekket.",
            sourceEvidence: "notert i Oslo"
          }
        ]
      },
      { visibleArticleSentenceCount: 0 }
    );

    const result = assessReferenceCheckGate(report);

    expect(result.blocking).toBe(true);
    expect(result.highRiskUnsupportedSentences).toHaveLength(1);
  });

  it("does not block one low-risk unsupported context sentence", () => {
    const report = buildCoverageReport(
      ["Selskapet la frem tall.", "Selskapet er notert i Oslo."],
      {
        sentences: [
          {
            index: 0,
            sentence: "Selskapet la frem tall.",
            grounded: true,
            interpretation: "Dekket.",
            sourceEvidence: "la frem tall"
          },
          {
            index: 1,
            sentence: "Selskapet er notert i Oslo.",
            grounded: false,
            interpretation: "Selskapsbeskrivelsen finnes ikke i kilden.",
            sourceEvidence: ""
          }
        ]
      },
      { visibleArticleSentenceCount: 1 }
    );

    const result = assessReferenceCheckGate(report);

    expect(result.blocking).toBe(false);
  });

  it("blocks one unsupported visible sentence in a short article", () => {
    const report = buildCoverageReport(
      ["Selskapet la frem tall.", "Dette gir bedre kapitalutnyttelse."],
      {
        sentences: [
          {
            index: 0,
            sentence: "Selskapet la frem tall.",
            grounded: true,
            interpretation: "Dekket.",
            sourceEvidence: "la frem tall"
          },
          {
            index: 1,
            sentence: "Dette gir bedre kapitalutnyttelse.",
            grounded: false,
            interpretation: "Effekten er ikke dekket.",
            sourceEvidence: ""
          }
        ]
      },
      { visibleArticleSentenceCount: 2 }
    );

    const result = assessReferenceCheckGate(report);

    expect(result.blocking).toBe(true);
    expect(result.reason).toContain("short article");
  });

  it("does not block simple insider-trade totals derived from source inputs", () => {
    const report = buildCoverageReport(
      [
        "Lorenz har kjøpt 10.000 aksjer i Codelab Capital for 34.300 kroner, ifølge en børsmelding."
      ],
      {
        sentences: [
          {
            index: 0,
            sentence:
              "Lorenz har kjøpt 10.000 aksjer i Codelab Capital for 34.300 kroner, ifølge en børsmelding.",
            grounded: false,
            interpretation:
              "Kilden oppgir antall aksjer og kurs per aksje, men ikke totalbeløpet eksplisitt.",
            sourceEvidence:
              "Lorenz AS has acquired 10.000 shares at an average price of NOK 3,43 per share."
          }
        ]
      },
      { visibleArticleSentenceCount: 1 }
    );

    const result = assessReferenceCheckGate(report);

    expect(result.blocking).toBe(false);
  });

  it("blocks low coverage after correction", () => {
    const report = buildCoverageReport(
      ["Første setning.", "Andre setning.", "Tredje setning."],
      {
        sentences: [
          {
            index: 0,
            sentence: "Første setning.",
            grounded: true,
            interpretation: "Dekket.",
            sourceEvidence: "Første"
          },
          {
            index: 1,
            sentence: "Andre setning.",
            grounded: false,
            interpretation: "Ikke dekket.",
            sourceEvidence: ""
          },
          {
            index: 2,
            sentence: "Tredje setning.",
            grounded: false,
            interpretation: "Ikke dekket.",
            sourceEvidence: ""
          }
        ]
      },
      { visibleArticleSentenceCount: 0 }
    );

    const result = assessReferenceCheckGate(report);

    expect(result.blocking).toBe(true);
    expect(result.reason).toContain("below 75 percent");
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

describe("buildReferenceCheckPrompt", () => {
  it("builds the same reference-check prompt parts production uses", () => {
    const rewrite = createRewrite({
      lead: "FÃ¸rste setning.",
      body: ["Andre setning."],
      company_sentence: "Tredje setning."
    });

    const prompt = buildReferenceCheckPrompt(
      {
        messageId: 123,
        title: "Test",
        issuerName: "Test ASA",
        issuerSign: "TEST",
        publishedAt: "2026-01-01T08:00:00.000Z",
        categories: [],
        markets: [],
        bodyText: "Referansen sier noe.",
        hasAttachments: false,
        sourceBodyChars: 22
      },
      rewrite
    );

    expect(prompt.systemPrompt).toContain("streng referansesjekker");
    expect(prompt.developerPrompt).toContain("Vurder hver setning");
    expect(prompt.developerPrompt).toContain(
      "En naturlig norsk oversettelse eller gjengivelse"
    );
    expect(prompt.developerPrompt).toContain(
      "skal ikke gi grounded=false"
    );
    expect(prompt.userPrompt).toContain("REFERANSETEKST");
    expect(prompt.userPrompt).toContain("Referansen sier noe.");
    expect(prompt.draftSentences).toEqual([
      "FÃ¸rste setning.",
      "Andre setning.",
      "Tredje setning."
    ]);
    expect(prompt.visibleDraftSentences).toEqual([
      "FÃ¸rste setning.",
      "Andre setning."
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
    expect(instruction).toContain(
      "skal beholdes ordrett i det korrigerte utkastet"
    );
    expect(instruction).not.toContain("siste reparasjonsforsøk");
  });

  it("preserves grounded quotes in the final repair attempt instruction", () => {
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
    const instruction = buildCorrectionInstruction(report, {
      attempt: 3,
      maxAttempts: 3
    });
    expect(instruction).toContain("Dette er siste reparasjonsforsøk");
    expect(instruction).toContain(
      "Sitater og personuttalelser som har dekning i kilden, skal beholdes."
    );
  });
});
