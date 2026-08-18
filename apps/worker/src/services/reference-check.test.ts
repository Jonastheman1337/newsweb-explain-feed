import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  applyReferenceCheckEnforcement,
  assessReferenceCheckGate,
  buildCorrectionInstruction,
  buildCoverageReport,
  buildReferenceCheckPrompt,
  classifyCheckerErrorKind,
  classifyLegacyCheckerErrorMessage,
  collectDraftSentences,
  defaultReferenceCheckEnforcement,
  resolveReferenceCheckOutcome,
  splitIntoSentences,
  type ReferenceCheckerErrorEntry,
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

function cleanCoverageReport() {
  return buildCoverageReport(
    ["Selskapet er notert i Oslo."],
    {
      sentences: [
        {
          index: 0,
          sentence: "Selskapet er notert i Oslo.",
          grounded: true,
          interpretation: "Dekket.",
          sourceEvidence: "notert i Oslo"
        }
      ]
    },
    { visibleArticleSentenceCount: 0 }
  );
}

function blockingCoverageReport() {
  return buildCoverageReport(
    ["Selskapet fikk et resultat på 100 millioner kroner."],
    {
      sentences: [
        {
          index: 0,
          sentence: "Selskapet fikk et resultat på 100 millioner kroner.",
          grounded: false,
          interpretation: "Tallet finnes ikke i kilden.",
          sourceEvidence: ""
        }
      ]
    },
    { visibleArticleSentenceCount: 0 }
  );
}

const transportEntry: ReferenceCheckerErrorEntry = {
  stage: 1,
  kind: "checker_transport",
  message:
    "OpenAI request failed for reference_check_result: Request was aborted."
};

const parseEntry: ReferenceCheckerErrorEntry = {
  stage: 1,
  kind: "checker_parse",
  message: "Expected ',' or '}' after property value in JSON at position 2310"
};

describe("resolveReferenceCheckOutcome", () => {
  it("resolves pass, repaired_pass and residual_unsupported from clean inputs", () => {
    const clean = cleanCoverageReport();
    expect(
      resolveReferenceCheckOutcome({
        checkerErrors: [],
        initialCoverage: clean,
        finalCoverage: clean,
        correctionAttempts: 0
      }).state
    ).toBe("pass");
    expect(
      resolveReferenceCheckOutcome({
        checkerErrors: [],
        initialCoverage: blockingCoverageReport(),
        finalCoverage: clean,
        correctionAttempts: 2
      }).state
    ).toBe("repaired_pass");
    const residual = resolveReferenceCheckOutcome({
      checkerErrors: [],
      initialCoverage: blockingCoverageReport(),
      finalCoverage: blockingCoverageReport(),
      correctionAttempts: 3
    });
    expect(residual.state).toBe("residual_unsupported");
    expect(residual.wouldBlock).toBe(true);
    expect(residual.degraded).toBe(false);
  });

  it("evaluates the gate on final coverage even when a checker error occurred", () => {
    const outcome = resolveReferenceCheckOutcome({
      checkerErrors: [{ ...transportEntry, stage: 2 }],
      initialCoverage: blockingCoverageReport(),
      finalCoverage: blockingCoverageReport(),
      correctionAttempts: 1
    });
    expect(outcome.evaluatedCoverage).toBe("final");
    expect(outcome.degraded).toBe(true);
    expect(outcome.state).toBe("residual_unsupported");
    expect(outcome.gate.blocking).toBe(true);
    expect(outcome.wouldBlock).toBe(true);
    expect(outcome.wouldRetry).toBe(false);
  });

  it("falls back to initial coverage when no final coverage exists", () => {
    const outcome = resolveReferenceCheckOutcome({
      checkerErrors: [{ ...transportEntry, stage: 2 }],
      initialCoverage: cleanCoverageReport(),
      finalCoverage: null,
      correctionAttempts: 0
    });
    expect(outcome.evaluatedCoverage).toBe("initial");
    expect(outcome.state).toBe("pass");
    expect(outcome.degraded).toBe(true);
  });

  it("resolves unavailable_error when transport failure leaves no coverage", () => {
    const outcome = resolveReferenceCheckOutcome({
      checkerErrors: [transportEntry],
      initialCoverage: null,
      finalCoverage: null,
      correctionAttempts: 0
    });
    expect(outcome.state).toBe("unavailable_error");
    expect(outcome.evaluatedCoverage).toBe("none");
    expect(outcome.wouldRetry).toBe(true);
    expect(outcome.wouldBlock).toBe(false);
  });

  it("resolves malformed_result when a parse failure leaves no coverage", () => {
    const outcome = resolveReferenceCheckOutcome({
      checkerErrors: [parseEntry],
      initialCoverage: null,
      finalCoverage: null,
      correctionAttempts: 0
    });
    expect(outcome.state).toBe("malformed_result");
    expect(outcome.wouldRetry).toBe(true);
  });

  it("keeps a stage-1 blocking result visible through a later checker error", () => {
    // Legacy overwrite semantics masked this: a stage-2 error nulled the gate
    // and the stage-1 block published.
    const outcome = resolveReferenceCheckOutcome({
      checkerErrors: [{ ...transportEntry, stage: 2 }],
      initialCoverage: blockingCoverageReport(),
      finalCoverage: blockingCoverageReport(),
      correctionAttempts: 0
    });
    expect(outcome.state).toBe("residual_unsupported");
    expect(outcome.checkerErrors).toHaveLength(1);
  });

  it("downgrades blocking evidence that predates a successful repair to a retry signal", () => {
    // check 1 blocked -> repair succeeded -> check 2 errored: the blocking
    // verdict describes the pre-repair draft, so it must not count as a
    // would-block, and the unknown current coverage becomes a retry signal.
    const outcome = resolveReferenceCheckOutcome({
      checkerErrors: [
        { ...transportEntry, stage: 2, afterCorrection: true }
      ],
      initialCoverage: blockingCoverageReport(),
      finalCoverage: blockingCoverageReport(),
      correctionAttempts: 1,
      completedCheckCount: 1
    });
    expect(outcome.evidenceStale).toBe(true);
    expect(outcome.wouldBlock).toBe(false);
    expect(outcome.wouldRetry).toBe(true);
  });

  it("treats evidence as fresh when a later check succeeded after the stale error", () => {
    const outcome = resolveReferenceCheckOutcome({
      checkerErrors: [
        { ...transportEntry, stage: 2, afterCorrection: true }
      ],
      initialCoverage: blockingCoverageReport(),
      finalCoverage: blockingCoverageReport(),
      correctionAttempts: 1,
      completedCheckCount: 2
    });
    expect(outcome.evidenceStale).toBe(false);
    expect(outcome.wouldBlock).toBe(true);
  });

  it("retains a stage-1 error through a later successful check", () => {
    // Legacy overwrite semantics silently reset checkerError to null here.
    const outcome = resolveReferenceCheckOutcome({
      checkerErrors: [transportEntry],
      initialCoverage: cleanCoverageReport(),
      finalCoverage: cleanCoverageReport(),
      correctionAttempts: 0
    });
    expect(outcome.degraded).toBe(true);
    expect(outcome.checkerErrors).toEqual([transportEntry]);
    expect(outcome.state).toBe("pass");
  });
});

describe("classifyCheckerErrorKind", () => {
  it("classifies runtime error shapes", () => {
    expect(
      classifyCheckerErrorKind(z.string().safeParse(1).error)
    ).toBe("checker_schema");
    let syntaxError: unknown;
    try {
      JSON.parse("{");
    } catch (error) {
      syntaxError = error;
    }
    expect(classifyCheckerErrorKind(syntaxError)).toBe("checker_parse");
    expect(
      classifyCheckerErrorKind(
        new Error(
          "OpenAI returned no output_text for reference_check_result after 2 attempts"
        )
      )
    ).toBe("checker_empty_output");
    expect(
      classifyCheckerErrorKind(
        new Error(
          "OpenAI response incomplete (max_output_tokens) for reference_check_result"
        )
      )
    ).toBe("checker_empty_output");
    expect(
      classifyCheckerErrorKind(
        new Error(
          "OpenAI request failed for reference_check_result: Request was aborted."
        )
      )
    ).toBe("checker_transport");
    expect(classifyCheckerErrorKind(new Error("boom"))).toBe("unknown");
  });
});

describe("classifyLegacyCheckerErrorMessage", () => {
  it("classifies the four production fixture error strings", () => {
    expect(
      classifyLegacyCheckerErrorMessage(
        "OpenAI returned no output_text for rewrite_output after 2 attempts | request | emptyResponses=..."
      )
    ).toEqual({ kind: "repair_rewrite_failed", phase: "repair_rewrite" });
    expect(
      classifyLegacyCheckerErrorMessage(
        "OpenAI request failed for rewrite_output: Request was aborted."
      )
    ).toEqual({ kind: "repair_rewrite_failed", phase: "repair_rewrite" });
    // Bare JSON-parse strings carry no schema name, so the phase cannot be
    // proven from the message alone.
    expect(
      classifyLegacyCheckerErrorMessage(
        "Expected ',' or '}' after property value in JSON at position 2310 (line 1 column 2311)"
      )
    ).toEqual({ kind: "checker_parse", phase: "unknown" });
    expect(
      classifyLegacyCheckerErrorMessage(
        "OpenAI request failed for reference_check_result: Request was aborted."
      )
    ).toEqual({ kind: "checker_transport", phase: "checker" });
  });

  it("classifies by schema name before embedded parse wording", () => {
    // Gateway HTML inside a transport failure must stay transport.
    expect(
      classifyLegacyCheckerErrorMessage(
        "OpenAI request failed for reference_check_result: Unexpected token < in JSON at position 0"
      )
    ).toEqual({ kind: "checker_transport", phase: "checker" });
  });
});

const shadowEnforcement = {
  blockOnResidualUnsupported: false,
  retryOnUnavailable: false
} as const;

describe("applyReferenceCheckEnforcement", () => {
  it("pins the promoted production default", () => {
    // Flipping these fields is a deliberate release act (2026-08-18 for the
    // checker enforcement); rollback is the REFERENCE_CHECK_ENFORCEMENT env.
    expect(defaultReferenceCheckEnforcement).toEqual({
      blockOnResidualUnsupported: true,
      retryOnUnavailable: true
    });
  });

  it("reproduces the legacy vacuous pass for degraded input under the shadow config", () => {
    const outcome = resolveReferenceCheckOutcome({
      checkerErrors: [transportEntry],
      initialCoverage: blockingCoverageReport(),
      finalCoverage: blockingCoverageReport(),
      correctionAttempts: 1
    });
    const enforced = applyReferenceCheckEnforcement(
      outcome,
      { legacyCheckerError: transportEntry.message },
      shadowEnforcement
    );
    expect(enforced.gate.blocking).toBe(false);
    expect(enforced.gate.reason).toBeNull();
    expect(enforced.forceNeedsRetry).toBe(false);
  });

  it("evaluates the real gate for non-degraded runs under any config", () => {
    const outcome = resolveReferenceCheckOutcome({
      checkerErrors: [],
      initialCoverage: blockingCoverageReport(),
      finalCoverage: blockingCoverageReport(),
      correctionAttempts: 3
    });
    for (const enforcement of [shadowEnforcement, defaultReferenceCheckEnforcement]) {
      const enforced = applyReferenceCheckEnforcement(
        outcome,
        { legacyCheckerError: null },
        enforcement
      );
      expect(enforced.gate.blocking).toBe(true);
    }
  });

  it("enforces coverage evidence and retry when promoted", () => {
    const degradedBlocking = resolveReferenceCheckOutcome({
      checkerErrors: [transportEntry],
      initialCoverage: blockingCoverageReport(),
      finalCoverage: blockingCoverageReport(),
      correctionAttempts: 1
    });
    const enforcedBlocking = applyReferenceCheckEnforcement(
      degradedBlocking,
      { legacyCheckerError: transportEntry.message },
      { blockOnResidualUnsupported: true, retryOnUnavailable: true }
    );
    expect(enforcedBlocking.gate.blocking).toBe(true);
    expect(enforcedBlocking.forceNeedsRetry).toBe(false);

    const unavailable = resolveReferenceCheckOutcome({
      checkerErrors: [transportEntry],
      initialCoverage: null,
      finalCoverage: null,
      correctionAttempts: 0
    });
    const enforcedRetry = applyReferenceCheckEnforcement(
      unavailable,
      { legacyCheckerError: transportEntry.message },
      { blockOnResidualUnsupported: true, retryOnUnavailable: true }
    );
    expect(enforcedRetry.forceNeedsRetry).toBe(true);
    expect(enforcedRetry.gate.blocking).toBe(false);
  });

  it("routes stale blocking evidence to retry instead of blocking when promoted", () => {
    const stale = resolveReferenceCheckOutcome({
      checkerErrors: [
        { ...transportEntry, stage: 2, afterCorrection: true }
      ],
      initialCoverage: blockingCoverageReport(),
      finalCoverage: blockingCoverageReport(),
      correctionAttempts: 1,
      completedCheckCount: 1
    });
    const enforced = applyReferenceCheckEnforcement(
      stale,
      { legacyCheckerError: transportEntry.message },
      { blockOnResidualUnsupported: true, retryOnUnavailable: true }
    );
    expect(enforced.gate.blocking).toBe(false);
    expect(enforced.forceNeedsRetry).toBe(true);
  });
});
