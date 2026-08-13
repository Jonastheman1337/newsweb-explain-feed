import { describe, expect, it } from "vitest";
import type { PromptPayload } from "@newsweb/prompt-kit";
import {
  assertReviewProtocolIntegrity,
  categorizeEvalPayload,
  createLegacyReviewProtocol,
  createReviewProtocol,
  difficultyTagsForPayload,
  evalCategoryQuotasForLimit,
  selectBalancedEvalCases,
  summarizeEditorialEval,
  type EvalCandidate,
  type EvalGenerationSummary,
  type EvalReview
} from "./editorial-eval.js";

function payload(overrides: Partial<PromptPayload> = {}): PromptPayload {
  const bodyText =
    overrides.bodyText ??
    "Selskapet har meldt en kontrakt pa 100 millioner kroner.";
  return {
    messageId: overrides.messageId ?? 1,
    title: overrides.title ?? "Test melding",
    issuerName: overrides.issuerName ?? "Test ASA",
    issuerSign: overrides.issuerSign ?? "TEST",
    publishedAt: overrides.publishedAt ?? "2026-01-01T08:00:00.000Z",
    categories: overrides.categories ?? [],
    markets: overrides.markets ?? ["XOSL"],
    bodyText,
    hasAttachments: overrides.hasAttachments ?? false,
    sourceBodyChars: overrides.sourceBodyChars ?? bodyText.length,
    pdfSupplementText: overrides.pdfSupplementText
  };
}

function candidate(
  messageId: number,
  bodyText: string,
  category = categorizeEvalPayload(payload({ messageId, bodyText }))
): EvalCandidate {
  const candidatePayload = payload({ messageId, bodyText });
  return {
    messageId,
    company: "Test ASA",
    issuerSign: "TEST",
    sourceTitle: `Title ${messageId}`,
    publishedAt: "2026-01-01T08:00:00.000Z",
    category,
    difficultyTags: difficultyTagsForPayload(candidatePayload),
    payload: candidatePayload
  };
}

describe("categorizeEvalPayload", () => {
  it("puts dilution mechanisms before generic financing", () => {
    expect(
      categorizeEvalPayload(
        payload({
          bodyText:
            "Selskapet gjennomforer en emisjon med warrants og mulig utvanning."
        })
      )
    ).toBe("warrants_options_convertibles");
  });

  it("detects contracts and short vague notices", () => {
    expect(
      categorizeEvalPayload(
        payload({ bodyText: "Selskapet har signert en ny kontrakt." })
      )
    ).toBe("contracts_orders");
    expect(
      categorizeEvalPayload(payload({ bodyText: "Kort melding.", sourceBodyChars: 12 }))
    ).toBe("short_vague");
  });

  it("does not treat contract extension options as dilution mechanisms", () => {
    expect(
      categorizeEvalPayload(
        payload({
          bodyText:
            "Selskapet har signert en kontrakt med opsjoner for kunden til a forlenge avtalen."
        })
      )
    ).toBe("contracts_orders");
  });

  it("keeps contract and management notices out of broader buckets", () => {
    expect(
      categorizeEvalPayload(
        payload({
          bodyText:
            "Selskapet har signert en rammeavtale som ventes a gi revenue over flere ar."
        })
      )
    ).toBe("contracts_orders");
    expect(
      categorizeEvalPayload(
        payload({
          bodyText:
            "Nordic Semiconductor appoints a new EVP for strategy and corporate development."
        })
      )
    ).toBe("governance_insider");
  });

  it("ignores generic regulatory flags and own-share buyback wording", () => {
    expect(
      categorizeEvalPayload(
        payload({
          bodyText:
            "Inside information: Selskapet har inngatt en partnership-avtale for en ny installasjon."
        })
      )
    ).toBe("contracts_orders");
    expect(
      categorizeEvalPayload(
        payload({
          bodyText:
            "The issuer has completed transactions under its share buy-back programme for own shares.",
          sourceBodyChars: 500
        })
      )
    ).not.toBe("ma");
  });
});

describe("evalCategoryQuotasForLimit", () => {
  it("uses a deliberately mixed 15-case review quota", () => {
    const quotas = evalCategoryQuotasForLimit(15);

    expect(quotas.financing).toBe(3);
    expect(quotas.warrants_options_convertibles).toBe(3);
    expect(quotas.short_vague).toBe(2);
    expect(Object.values(quotas).reduce((sum, value) => sum + value, 0)).toBe(15);
  });
});

describe("selectBalancedEvalCases", () => {
  it("fills quotas first and then backfills to the requested limit", () => {
    const selected = selectBalancedEvalCases(
      [
        candidate(1, "Selskapet melder resultat og guiding.", "results_guidance"),
        candidate(2, "Selskapet melder resultat og guiding.", "results_guidance"),
        candidate(3, "Selskapet henter penger i emisjon.", "financing"),
        candidate(4, "Selskapet signerer kontrakt.", "contracts_orders")
      ],
      {
        limit: 3,
        quotas: {
          results_guidance: 1,
          financing: 1,
          warrants_options_convertibles: 0,
          contracts_orders: 0,
          ma: 0,
          governance_insider: 0,
          short_vague: 0,
          hard_other: 0
        }
      }
    );

    expect(selected.map((item) => item.messageId)).toEqual([1, 3, 2]);
    expect(selected[0]?.caseId).toBe("case_001_1");
  });
});

describe("createReviewProtocol", () => {
  it("creates deterministic A/B assignments and order", () => {
    const generations: EvalGenerationSummary[] = [
      {
        id: "case1-control",
        caseId: "case_001",
        variantId: "regular_v5_6_control",
        category: "financing",
        fatalStatus: { fatal: false, reasons: [] }
      },
      {
        id: "case1-challenger",
        caseId: "case_001",
        variantId: "audience_mechanism_v1",
        category: "financing",
        fatalStatus: { fatal: false, reasons: [] }
      }
    ];

    expect(
      createReviewProtocol(
        generations,
        "regular_v5_6_control",
        "audience_mechanism_v1",
        { assignmentSeed: "assign-1", orderingSeed: "order-1" }
      )
    ).toEqual(
      createReviewProtocol(
        generations,
        "regular_v5_6_control",
        "audience_mechanism_v1",
        { assignmentSeed: "assign-1", orderingSeed: "order-1" }
      )
    );
  });

  it("varies which side the challenger lands on across cases", () => {
    // Generation ids follow the run script's `${caseId}:${arm}` scheme, which
    // duplicates the caseId inside the hash input — the exact shape that made
    // FNV-1a bit 0 constant across all cases.
    const generations: EvalGenerationSummary[] = Array.from(
      { length: 40 },
      (_, index) => {
        const caseId = `case_${String(index + 1).padStart(3, "0")}_${675000 + index}`;
        return (["control", "challenger"] as const).map((arm) => ({
          id: `${caseId}:${arm}`,
          caseId,
          arm,
          variantId:
            arm === "control"
              ? ("regular_v5_6_control" as const)
              : ("audience_mechanism_v1" as const),
          category: "financing" as const,
          fatalStatus: { fatal: false, reasons: [] }
        }));
      }
    ).flat();

    const assignments = createReviewProtocol(
      generations,
      "regular_v5_6_control",
      "audience_mechanism_v1",
      { assignmentSeed: "balanced", orderingSeed: "randomized" }
    ).assignments;
    const challengerOnA = assignments.filter((assignment) =>
      assignment.aGenerationId.endsWith(":challenger")
    ).length;

    expect(assignments).toHaveLength(40);
    expect(challengerOnA).toBe(20);
    expect(assignments.map((item) => item.presentationPosition)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1)
    );
    expect(assignments.map((item) => item.caseId)).not.toEqual(
      [...assignments.map((item) => item.caseId)].sort()
    );
  });

  it("keeps odd runs within one side and isolates assignment/order seeds", () => {
    const nineCases = 9;
    const generations: EvalGenerationSummary[] = Array.from(
      { length: nineCases },
      (_, index) => {
        const caseId = `odd_${index}`;
        return (["control", "challenger"] as const).map((arm) => ({
          id: `${caseId}:${arm}`,
          caseId,
          arm,
          variantId:
            arm === "control"
              ? ("regular_v5_6_control" as const)
              : ("audience_mechanism_v1" as const),
          category: "hard_other" as const,
          fatalStatus: { fatal: false, reasons: [] }
        }));
      }
    ).flat();
    const first = createReviewProtocol(
      generations,
      "regular_v5_6_control",
      "audience_mechanism_v1",
      { assignmentSeed: "assign-a", orderingSeed: "order-a" }
    );
    const changedOrder = createReviewProtocol(
      generations,
      "regular_v5_6_control",
      "audience_mechanism_v1",
      { assignmentSeed: "assign-a", orderingSeed: "order-b" }
    );
    const changedAssignment = createReviewProtocol(
      generations,
      "regular_v5_6_control",
      "audience_mechanism_v1",
      { assignmentSeed: "assign-b", orderingSeed: "order-a" }
    );
    const countA = first.assignments.filter(
      (item) => item.challengerSide === "A"
    ).length;
    expect(Math.abs(countA - (nineCases - countA))).toBe(1);
    expect(changedOrder.assignments.map((item) => item.caseId)).not.toEqual(
      first.assignments.map((item) => item.caseId)
    );
    expect(
      Object.fromEntries(
        changedOrder.assignments.map((item) => [item.caseId, item.challengerSide])
      )
    ).toEqual(
      Object.fromEntries(
        first.assignments.map((item) => [item.caseId, item.challengerSide])
      )
    );
    expect(changedAssignment.assignments.map((item) => item.caseId)).toEqual(
      first.assignments.map((item) => item.caseId)
    );
  });

  it("rejects incomplete generation pairs", () => {
    expect(() =>
      createReviewProtocol(
        [
          {
            id: "only-control",
            caseId: "broken",
            arm: "control",
            variantId: "regular_v5_6_control",
            category: "hard_other",
            fatalStatus: { fatal: false, reasons: [] }
          }
        ],
        "regular_v5_6_control",
        "audience_mechanism_v1",
        { assignmentSeed: "a", orderingSeed: "b" }
      )
    ).toThrow(/exactly one control and one challenger/);
  });

  it("rejects a stored protocol whose assignment was tampered with", () => {
    const generations: EvalGenerationSummary[] = [
      {
        id: "c:control",
        caseId: "c",
        arm: "control",
        variantId: "regular_v5_6_control",
        category: "hard_other",
        fatalStatus: { fatal: false, reasons: [] }
      },
      {
        id: "c:challenger",
        caseId: "c",
        arm: "challenger",
        variantId: "audience_mechanism_v1",
        category: "hard_other",
        fatalStatus: { fatal: false, reasons: [] }
      }
    ];
    const protocol = createReviewProtocol(
      generations,
      "regular_v5_6_control",
      "audience_mechanism_v1",
      { assignmentSeed: "a", orderingSeed: "b" }
    );
    protocol.assignments[0] = {
      ...protocol.assignments[0]!,
      aGenerationId: "c:missing"
    };
    expect(() =>
      assertReviewProtocolIntegrity(
        protocol,
        generations,
        "regular_v5_6_control",
        "audience_mechanism_v1"
      )
    ).toThrow(/assignment mismatch/);
  });
});

describe("summarizeEditorialEval", () => {
  const generations: EvalGenerationSummary[] = [
    {
      id: "c1-control",
      caseId: "c1",
      variantId: "regular_v5_6_control",
      category: "financing",
      fatalStatus: { fatal: false, reasons: [] }
    },
    {
      id: "c1-challenger",
      caseId: "c1",
      variantId: "audience_mechanism_v1",
      category: "financing",
      fatalStatus: { fatal: false, reasons: [] }
    },
    {
      id: "c2-control",
      caseId: "c2",
      variantId: "regular_v5_6_control",
      category: "warrants_options_convertibles",
      fatalStatus: { fatal: false, reasons: [] }
    },
    {
      id: "c2-challenger",
      caseId: "c2",
      variantId: "audience_mechanism_v1",
      category: "warrants_options_convertibles",
      fatalStatus: { fatal: false, reasons: [] }
    }
  ];

  it("ships only when the challenger clears the 65 percent and fatal gates", () => {
    const reviews: EvalReview[] = [
      {
        caseId: "c1",
        aGenerationId: "c1-challenger",
        bGenerationId: "c1-control",
        winner: "A"
      },
      {
        caseId: "c2",
        aGenerationId: "c2-control",
        bGenerationId: "c2-challenger",
        winner: "B"
      }
    ];

    const summary = summarizeEditorialEval(
      { generations },
      reviews,
      {
        controlVariant: "regular_v5_6_control",
        challengerVariant: "audience_mechanism_v1"
      }
    );

    expect(summary.challengerWinRate).toBe(1);
    expect(summary.recommendation).toBe("ship_candidate");
  });

  it("rejects a challenger with more fatal failures", () => {
    const summary = summarizeEditorialEval(
      {
        generations: [
          ...generations,
          {
            id: "c3-challenger",
            caseId: "c3",
            variantId: "audience_mechanism_v1",
            category: "financing",
            fatalStatus: { fatal: true, reasons: ["reference"] }
          }
        ]
      },
      [
        {
          caseId: "c1",
          aGenerationId: "c1-challenger",
          bGenerationId: "c1-control",
          winner: "A"
        },
        {
          caseId: "c2",
          aGenerationId: "c2-challenger",
          bGenerationId: "c2-control",
          winner: "A"
        }
      ],
      {
        controlVariant: "regular_v5_6_control",
        challengerVariant: "audience_mechanism_v1"
      }
    );

    expect(summary.recommendation).toBe("reject");
    expect(summary.reasons).toContain(
      "Challenger has more fatal validation/reference failures."
    );
  });

  it("summarizes per-variant quote metrics from generation quote telemetry", () => {
    const telemetry = {
      sourceContainsNamedQuoteLikePattern: true,
      draftContainsStandaloneDashQuote: false,
      draftContainsInlineGuillemets: false,
      draftContainsNamedPersonAttribution: false,
      draftSourceSpansMentionQuoteSpeaker: false
    };
    const summary = summarizeEditorialEval(
      {
        generations: [
          {
            ...generations[0],
            quoteTelemetry: {
              ...telemetry,
              draftContainsStandaloneDashQuote: true,
              draftSourceSpansMentionQuoteSpeaker: true
            }
          },
          {
            ...generations[2],
            quoteTelemetry: {
              ...telemetry,
              draftContainsNamedPersonAttribution: true
            }
          },
          {
            ...generations[1],
            quoteTelemetry: {
              ...telemetry,
              draftContainsInlineGuillemets: true,
              draftSourceSpansMentionQuoteSpeaker: true
            }
          },
          // No telemetry: ignored by the quote metrics.
          generations[3]
        ]
      },
      [],
      {
        controlVariant: "regular_v5_6_control",
        challengerVariant: "audience_mechanism_v1"
      }
    );

    expect(summary.quoteMetrics["regular_v5_6_control"]).toEqual({
      generationsWithTelemetry: 2,
      quoteOpportunityCount: 2,
      quotePresenceCount: 1,
      quotePresenceRate: 0.5,
      dashQuoteCount: 1,
      guillemetsCount: 0,
      attributionOnlyCount: 1
    });
    expect(summary.quoteMetrics["audience_mechanism_v1"]).toEqual({
      generationsWithTelemetry: 1,
      quoteOpportunityCount: 1,
      quotePresenceCount: 1,
      quotePresenceRate: 1,
      dashQuoteCount: 0,
      guillemetsCount: 1,
      attributionOnlyCount: 0
    });
  });

  it("exposes the known legacy placement and displayed-side bias", () => {
    const legacyGenerations: EvalGenerationSummary[] = Array.from(
      { length: 50 },
      (_, index) => {
        const caseId = `legacy_${String(index + 1).padStart(2, "0")}`;
        return (["control", "challenger"] as const).map((arm) => ({
          id: `${caseId}:${arm}`,
          caseId,
          arm,
          variantId:
            arm === "control"
              ? ("regular_v5_6_control" as const)
              : ("regular_v6_draft" as const),
          category: "hard_other" as const,
          fatalStatus: { fatal: false, reasons: [] }
        }));
      }
    ).flat();
    const legacyReviews: EvalReview[] = Array.from({ length: 50 }, (_, index) => {
      const caseId = `legacy_${String(index + 1).padStart(2, "0")}`;
      const challengerOnA = index < 36;
      return {
        caseId,
        aGenerationId: `${caseId}:${challengerOnA ? "challenger" : "control"}`,
        bGenerationId: `${caseId}:${challengerOnA ? "control" : "challenger"}`,
        winner: index < 31 ? "B" : index < 46 ? "A" : "both_bad"
      };
    });
    const reviewProtocol = createLegacyReviewProtocol(
      legacyGenerations,
      legacyReviews,
      "regular_v5_6_control",
      "regular_v6_draft"
    );
    const summary = summarizeEditorialEval(
      { generations: legacyGenerations },
      legacyReviews,
      {
        controlVariant: "regular_v5_6_control",
        challengerVariant: "regular_v6_draft",
        reviewProtocol,
        artifactIntegrity: {
          promotionEligible: false,
          reasons: ["Legacy run schema lacks stored protocol metadata."]
        }
      }
    );

    expect(summary.challengerPlacement).toEqual({ A: 36, B: 14, difference: 22 });
    expect(summary.displayedSidePreference).toEqual({
      A: 15,
      B: 31,
      tie: 0,
      bothBad: 4
    });
    expect(summary.integrity.promotionEligible).toBe(false);
    expect(summary.recommendation).toBe("reject");
  });
});
