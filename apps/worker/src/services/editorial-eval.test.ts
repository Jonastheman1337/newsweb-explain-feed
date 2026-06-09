import { describe, expect, it } from "vitest";
import type { PromptPayload } from "@newsweb/prompt-kit";
import {
  categorizeEvalPayload,
  createReviewAssignments,
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

describe("createReviewAssignments", () => {
  it("creates deterministic A/B assignments", () => {
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
      createReviewAssignments(
        generations,
        "regular_v5_6_control",
        "audience_mechanism_v1"
      )
    ).toEqual(
      createReviewAssignments(
        generations,
        "regular_v5_6_control",
        "audience_mechanism_v1"
      )
    );
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
});
