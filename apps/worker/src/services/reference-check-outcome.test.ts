import { describe, expect, it } from "vitest";
import {
  absorbReferenceRepairResult,
  createReferenceRepairAccumulator,
  referenceCheckFailureJson,
  referenceCheckValidationJson,
  referenceCoverageJson,
  type ReferenceRepairResult
} from "./reference-check-outcome.js";
import {
  buildCoverageReport,
  type ReferenceCheckGateResult,
  type ReferenceCoverageReport
} from "./reference-check.js";

function coverage(grounded: boolean): ReferenceCoverageReport {
  return buildCoverageReport(
    ["Selskapet er notert i Oslo."],
    {
      sentences: [
        {
          index: 0,
          sentence: "Selskapet er notert i Oslo.",
          grounded,
          interpretation: grounded ? "Dekket." : "Ikke dekket.",
          sourceEvidence: grounded ? "notert i Oslo" : ""
        }
      ]
    },
    { visibleArticleSentenceCount: 0 }
  );
}

function repairResult(
  overrides: Partial<ReferenceRepairResult>
): ReferenceRepairResult {
  return {
    checkerError: null,
    checkerErrors: [],
    correctionAttempts: 0,
    initialCoverage: null,
    finalCoverage: null,
    repairHistory: [],
    ...overrides
  };
}

function historyEntry(checkNumber: number) {
  return {
    checkNumber,
    correctionAttempt: 0,
    coveragePercent: 100,
    unsupportedSentenceCount: 0,
    highRiskUnsupportedSentenceCount: 0,
    blocking: false,
    blockingReason: null,
    unsupportedSentences: []
  };
}

describe("absorbReferenceRepairResult", () => {
  it("reproduces the legacy no-error three-stage absorption", () => {
    // Golden comparison against the hand-written absorb blocks this helper
    // replaced: stage 1 assigns coverages directly, later stages only merge
    // finalCoverage through the ?? chain and never touch initialCoverage.
    const first = coverage(false);
    const second = coverage(true);
    const state = createReferenceRepairAccumulator();

    absorbReferenceRepairResult(
      state,
      repairResult({
        correctionAttempts: 1,
        initialCoverage: first,
        finalCoverage: first,
        repairHistory: [historyEntry(1), historyEntry(2)]
      })
    );
    expect(state.initialCoverage).toBe(first);
    expect(state.finalCoverage).toBe(first);
    expect(state.correctionApplied).toBe(true);
    expect(state.correctionAttempts).toBe(1);

    absorbReferenceRepairResult(
      state,
      repairResult({
        correctionAttempts: 1,
        initialCoverage: second,
        finalCoverage: second,
        repairHistory: [historyEntry(1)]
      })
    );
    expect(state.initialCoverage).toBe(first);
    expect(state.finalCoverage).toBe(second);
    expect(state.correctionAttempts).toBe(2);
    expect(state.repairHistory).toHaveLength(3);
  });

  it("keeps overwrite semantics for checkerError across error-then-success", () => {
    const state = createReferenceRepairAccumulator();
    absorbReferenceRepairResult(
      state,
      repairResult({
        checkerError: "OpenAI request failed for reference_check_result: x",
        checkerErrors: [
          {
            stage: 1,
            kind: "checker_transport",
            message: "OpenAI request failed for reference_check_result: x"
          }
        ]
      })
    );
    expect(state.checkerError).toContain("request failed");
    // Legacy: stage-1 error leaves initialCoverage null and a later success
    // must NOT backfill it.
    const later = coverage(true);
    absorbReferenceRepairResult(
      state,
      repairResult({
        initialCoverage: later,
        finalCoverage: later,
        repairHistory: [historyEntry(1)]
      })
    );
    expect(state.checkerError).toBeNull();
    expect(state.initialCoverage).toBeNull();
    expect(state.finalCoverage).toBe(later);
    expect(state.checkerErrors).toHaveLength(1);
  });

  it("re-stages call-local checker errors to run-global check numbers", () => {
    const state = createReferenceRepairAccumulator();
    absorbReferenceRepairResult(
      state,
      repairResult({
        initialCoverage: coverage(true),
        finalCoverage: coverage(true),
        repairHistory: [historyEntry(1), historyEntry(2)]
      })
    );
    absorbReferenceRepairResult(
      state,
      repairResult({
        checkerError: "boom",
        checkerErrors: [{ stage: 1, kind: "unknown", message: "boom" }]
      })
    );
    expect(state.checkerErrors).toEqual([
      { stage: 3, kind: "unknown", message: "boom" }
    ]);
  });

  it("keeps success-then-error coverage evidence in finalCoverage", () => {
    const state = createReferenceRepairAccumulator();
    const first = coverage(true);
    absorbReferenceRepairResult(
      state,
      repairResult({
        initialCoverage: first,
        finalCoverage: first,
        repairHistory: [historyEntry(1)]
      })
    );
    absorbReferenceRepairResult(
      state,
      repairResult({
        checkerError: "boom",
        checkerErrors: [{ stage: 1, kind: "unknown", message: "boom" }]
      })
    );
    expect(state.checkerError).toBe("boom");
    expect(state.finalCoverage).toBe(first);
    expect(state.initialCoverage).toBe(first);
  });
});

describe("referenceCheck persistence builders", () => {
  const gate: ReferenceCheckGateResult = {
    blocking: true,
    reason: "Reference check found unsupported high-risk factual claims.",
    highRiskUnsupportedSentences: coverage(false).unsupportedSentences,
    priorContextViolations: []
  };
  const flow = {
    attributionCorrectionApplied: true,
    attributionRiskCount: 2,
    importanceAdjusted: false,
    importanceAdjustReason: null
  };

  function populatedState() {
    const state = createReferenceRepairAccumulator();
    absorbReferenceRepairResult(
      state,
      repairResult({
        checkerError: "late error",
        checkerErrors: [{ stage: 1, kind: "unknown", message: "late error" }],
        correctionAttempts: 2,
        initialCoverage: coverage(false),
        finalCoverage: coverage(true),
        repairHistory: [historyEntry(1), historyEntry(2)]
      })
    );
    return state;
  }

  it("builds the frozen full literal byte-identically", () => {
    const state = populatedState();
    const { initialCoverage, finalCoverage } = state;
    // Hand-written replica of the legacy validationJson.referenceCheck
    // literal the three flows shared before extraction; the JSON.stringify
    // comparison also pins key order.
    const legacy = {
      enabled: true,
      checkerError: state.checkerError,
      correctionApplied: state.correctionApplied,
      correctionAttempts: state.correctionAttempts,
      repairHistory: state.repairHistory,
      attributionCorrectionApplied: flow.attributionCorrectionApplied,
      attributionRiskCount: flow.attributionRiskCount,
      initialCoveragePercent: initialCoverage?.coveragePercent ?? null,
      finalCoveragePercent:
        finalCoverage?.coveragePercent ??
        initialCoverage?.coveragePercent ??
        null,
      importanceAdjusted: flow.importanceAdjusted,
      importanceAdjustReason: flow.importanceAdjustReason,
      blocking: gate.blocking,
      blockingReason: gate.reason,
      highRiskUnsupportedSentenceCount:
        gate.highRiskUnsupportedSentences.length,
      initialCoverage: referenceCoverageJson(initialCoverage),
      finalCoverage: referenceCoverageJson(finalCoverage ?? initialCoverage),
      totalSentences:
        finalCoverage?.totalSentences ?? initialCoverage?.totalSentences ?? 0,
      unsupportedSentenceCount:
        finalCoverage?.unsupportedSentences.length ??
        initialCoverage?.unsupportedSentences.length ??
        0,
      sentenceReviews: (
        finalCoverage?.items ?? initialCoverage?.items ?? []
      ).map((item) => ({
        index: item.index,
        sentence: item.sentence,
        grounded: item.grounded,
        interpretation: item.interpretation,
        sourceEvidence: item.sourceEvidence
      })),
      unsupportedSentences: (
        finalCoverage?.unsupportedSentences ??
        initialCoverage?.unsupportedSentences ??
        []
      ).map((item) => ({
        index: item.index,
        sentence: item.sentence,
        interpretation: item.interpretation,
        sourceEvidence: item.sourceEvidence
      }))
    };

    const built = referenceCheckValidationJson(state, gate, flow);
    expect(built).toEqual(legacy);
    expect(JSON.stringify(built)).toBe(JSON.stringify(legacy));
  });

  it("appends prior-context keys last, and only when a run carried related notices", () => {
    const priorContext = {
      sourceIds: ["prior_676863"],
      issuerAliases: ["sentia", "sntia"],
      timeMarkers: ["i juni"],
      sources: [
        {
          sourceId: "prior_676863",
          messageId: 676863,
          relation: "reference" as const,
          contextMarker: "i juni",
          normalizedEvidence: "innledende avtale"
        }
      ]
    };
    const withPrior = buildCoverageReport(
      ["Hent signerte kontrakt.", "Selskapet meldte i juni om en innledende avtale."],
      {
        sentences: [
          {
            index: 0,
            sentence: "Hent signerte kontrakt.",
            grounded: true,
            interpretation: "Dekket.",
            sourceEvidence: "signert kontrakt",
            source: "primary"
          },
          {
            index: 1,
            sentence: "Selskapet meldte i juni om en innledende avtale.",
            grounded: true,
            interpretation: "Dekket av tidligere melding.",
            sourceEvidence: "innledende avtale",
            source: "prior",
            priorUses: [
              {
                priorMessageId: 676863,
                fact: "Selskapet meldte i juni om en innledende avtale.",
                sourceEvidence: "innledende avtale",
                historicalMarker: "i juni",
                correctionStatusMarker: ""
              }
            ]
          }
        ]
      },
      { visibleArticleSentenceCount: 2, headSentenceCount: 1, priorContext }
    );

    const json = referenceCoverageJson(withPrior) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual([
      "totalSentences",
      "visibleArticleSentenceCount",
      "groundedSentences",
      "coveragePercent",
      "sentenceReviews",
      "unsupportedSentences",
      "headSentenceCount",
      "priorContext"
    ]);
    const reviews = json.sentenceReviews as Array<Record<string, unknown>>;
    expect(Object.keys(reviews[1])).toEqual([
      "index",
      "sentence",
      "grounded",
      "interpretation",
      "sourceEvidence",
      "source",
      "priorUses"
    ]);
    expect(reviews[1].source).toBe("prior");
    expect(reviews[1].priorUses).toEqual([
      {
        priorMessageId: 676863,
        fact: "Selskapet meldte i juni om en innledende avtale.",
        sourceEvidence: "innledende avtale",
        historicalMarker: "i juni",
        correctionStatusMarker: "",
        sourceEvidenceMatchesCitedSource: true
      }
    ]);
    expect(json.headSentenceCount).toBe(1);
    expect(json.priorContext).toEqual({
      sourceIds: ["prior_676863"],
      issuerAliases: ["sentia", "sntia"],
      timeMarkers: ["i juni"],
      sources: [
        {
          sourceId: "prior_676863",
          messageId: 676863,
          relation: "reference",
          contextMarker: "i juni"
        }
      ]
    });
    expect(JSON.stringify(json)).not.toContain("normalizedEvidence");

    // The legacy fixtures carry no source/prior keys and stay untouched.
    const legacy = referenceCoverageJson(coverage(true)) as Record<string, unknown>;
    expect(Object.keys(legacy)).toEqual([
      "totalSentences",
      "visibleArticleSentenceCount",
      "groundedSentences",
      "coveragePercent",
      "sentenceReviews",
      "unsupportedSentences"
    ]);
    expect(
      Object.keys((legacy.sentenceReviews as Array<Record<string, unknown>>)[0])
    ).toEqual(["index", "sentence", "grounded", "interpretation", "sourceEvidence"]);

    const priorGate: ReferenceCheckGateResult = {
      blocking: true,
      reason: "Reference check found prior-notice-only sentence in lead or first paragraph.",
      highRiskUnsupportedSentences: [],
      priorContextViolations: [{ item: withPrior.items[1], kind: "prior_in_head" }]
    };
    const full = referenceCheckValidationJson(populatedState(), priorGate, flow) as Record<
      string,
      unknown
    >;
    const keys = Object.keys(full);
    expect(keys.indexOf("priorContextViolationCount")).toBe(
      keys.indexOf("highRiskUnsupportedSentenceCount") + 1
    );
    expect(full.priorContextViolationCount).toBe(1);

    const priorState = createReferenceRepairAccumulator();
    absorbReferenceRepairResult(
      priorState,
      repairResult({
        initialCoverage: withPrior,
        finalCoverage: withPrior,
        repairHistory: [historyEntry(1)]
      })
    );
    const fullWithPrior = referenceCheckValidationJson(
      priorState,
      priorGate,
      flow
    ) as Record<string, unknown>;
    const topLevelReviews = fullWithPrior.sentenceReviews as Array<
      Record<string, unknown>
    >;
    expect(topLevelReviews[1]?.priorUses).toEqual(reviews[1]?.priorUses);
    expect(JSON.stringify(fullWithPrior)).not.toContain("normalizedEvidence");
    expect(
      Object.keys(referenceCheckValidationJson(populatedState(), gate, flow))
    ).not.toContain("priorContextViolationCount");
  });

  it("builds the frozen reduced failure literal byte-identically", () => {
    const state = populatedState();
    const { initialCoverage, finalCoverage } = state;
    const legacy = {
      enabled: true,
      checkerError: state.checkerError,
      correctionApplied: state.correctionApplied,
      correctionAttempts: state.correctionAttempts,
      repairHistory: state.repairHistory,
      attributionCorrectionApplied: flow.attributionCorrectionApplied,
      attributionRiskCount: flow.attributionRiskCount,
      importanceAdjusted: flow.importanceAdjusted,
      importanceAdjustReason: flow.importanceAdjustReason,
      initialCoveragePercent: initialCoverage?.coveragePercent ?? null,
      finalCoveragePercent: finalCoverage?.coveragePercent ?? null,
      initialCoverage: referenceCoverageJson(initialCoverage),
      finalCoverage: referenceCoverageJson(finalCoverage)
    };

    const built = referenceCheckFailureJson(state, flow);
    expect(built).toEqual(legacy);
    expect(JSON.stringify(built)).toBe(JSON.stringify(legacy));
  });
});
