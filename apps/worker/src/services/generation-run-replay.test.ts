import { describe, expect, it } from "vitest";
import type { RewriteOutput } from "@newsweb/shared";
import {
  findDigitVariantInSource,
  hiddenDraftRewriteOutputFromRow,
  replayValidationPayloadFromRow,
  storedRepairInitialUnexpectedNumbers,
  storedRewriteOutputFromRow,
  storedUnexpectedNumberDisplays,
  strippedNumberDisplays
} from "./generation-run-replay.js";

function createRewrite(overrides: Partial<RewriteOutput> = {}): RewriteOutput {
  return {
    title: "Selskapet melder oppdatering",
    lead: "Selskapet melder om nye detaljer.",
    body: ["Selskapet ga en oppdatering i dag."],
    company_sentence: "Test ASA er et norsk selskap.",
    key_facts: ["Oppdatering meldt"],
    negative_or_surprising: [],
    excluded_hype: [],
    source_limitations: [],
    confidence: "high",
    importance: "medium",
    source_spans: ["Selskapet ga en oppdatering"],
    ...overrides
  };
}

function createSourcePayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    messageId: 675167,
    title: "Mandatory notification of trade",
    issuerName: "Test ASA",
    issuerSign: "TEST",
    publishedAt: "2026-06-02T11:38:00Z",
    categories: ["MELDEPLIKTIG HANDEL"],
    markets: ["XOSL"],
    bodyText: "The board member acquired 500 shares in the company today.",
    hasAttachments: false,
    sourceBodyChars: 58,
    ...overrides
  };
}

describe("storedRewriteOutputFromRow", () => {
  it("parses a directly stored rewrite output", () => {
    const rewrite = createRewrite();
    expect(storedRewriteOutputFromRow({ outputJson: rewrite })).toEqual(rewrite);
  });

  it("unwraps blockedRewrite from failed rows", () => {
    const rewrite = createRewrite();
    expect(
      storedRewriteOutputFromRow({
        outputJson: {
          errorCode: "BLOCKING_VALIDATION_ERRORS",
          message: "Unexpected numbers: 101",
          blockedRewrite: rewrite
        }
      })
    ).toEqual(rewrite);
  });

  it("falls back to hiddenDraft with number-free placeholder fields", () => {
    const output = storedRewriteOutputFromRow({
      outputJson: { errorCode: "BLOCKING_VALIDATION_ERRORS", message: "x" },
      validationJson: {
        hiddenDraft: {
          title: "Selskapet melder oppdatering",
          lead: "Selskapet melder om nye detaljer.",
          body: ["Selskapet ga en oppdatering i dag."],
          company_sentence: "Test ASA er et norsk selskap."
        }
      }
    });
    expect(output).not.toBeNull();
    expect(output?.key_facts).toEqual(["Fixture replay placeholder"]);
    expect(output?.source_spans).toEqual(["Fixture replay source span"]);
    expect(output?.excluded_hype).toEqual([]);
  });

  it("returns null when no stored output is recoverable", () => {
    expect(
      storedRewriteOutputFromRow({ outputJson: { errorCode: "X" }, validationJson: {} })
    ).toBeNull();
  });
});

describe("replayValidationPayloadFromRow", () => {
  it("passes regular payloads through with supplemental fields intact", () => {
    const result = replayValidationPayloadFromRow({
      sourcePayload: createSourcePayload({
        outputMode: "notice",
        maxVisibleArticleChars: 1000,
        supplementalMaterials: [],
        pdfSupplementText: "PDF table text",
        pdfSupplementPageCount: 3
      }),
      validationJson: {}
    });
    expect(result).not.toBeNull();
    expect(result?.flow).toBe("regular");
    expect(result?.validationSourceCharsMatch).toBeNull();
    expect(result?.payload.pdfSupplementText).toBe("PDF table text");
    expect(result?.payload.supplementalMaterials).toEqual([]);
    expect(result?.payload.maxVisibleArticleChars).toBe(1000);
    expect(result?.payload.outputMode).toBe("notice");
  });

  it("reconstructs report payloads with the worker join and verifies the tripwire", () => {
    const bodyText = "B".repeat(120);
    const reportText = "Revenue 33,613 12,118";
    const joined = `${bodyText}\n\n${reportText}`;
    const result = replayValidationPayloadFromRow({
      sourcePayload: createSourcePayload({
        bodyText,
        reportText,
        reportPageCount: 12,
        reportSelectedPages: [1, 2],
        reportMetrics: { tables: 3 }
      }),
      validationJson: {
        reportExtraction: { validationSourceChars: joined.length }
      }
    });
    expect(result).not.toBeNull();
    expect(result?.flow).toBe("report");
    expect(result?.payload.bodyText).toBe(joined);
    expect(result?.payload.sourceBodyChars).toBe(joined.length);
    expect(result?.validationSourceCharsMatch).toBe(true);
    expect("reportText" in (result?.payload ?? {})).toBe(false);
  });

  it("drops short bodies from the report join with no leading separator", () => {
    const reportText = "Revenue 33,613 12,118";
    const result = replayValidationPayloadFromRow({
      sourcePayload: createSourcePayload({
        bodyText: "See attached report.",
        reportText
      }),
      validationJson: {}
    });
    expect(result?.payload.bodyText).toBe(reportText);
    expect(result?.validationSourceCharsMatch).toBeNull();
  });

  it("flags tripwire mismatches", () => {
    const result = replayValidationPayloadFromRow({
      sourcePayload: createSourcePayload({
        bodyText: "B".repeat(120),
        reportText: "Revenue 33,613"
      }),
      validationJson: { reportExtraction: { validationSourceChars: 7 } }
    });
    expect(result?.validationSourceCharsMatch).toBe(false);
  });

  it("returns null when the payload is missing or malformed", () => {
    expect(replayValidationPayloadFromRow({ sourcePayload: null })).toBeNull();
    expect(
      replayValidationPayloadFromRow({
        sourcePayload: createSourcePayload({ title: 42 })
      })
    ).toBeNull();
    expect(
      replayValidationPayloadFromRow({
        sourcePayload: createSourcePayload({
          supplementalMaterials: [{ sourceId: "s1" }]
        })
      })
    ).toBeNull();
  });
});

describe("storedUnexpectedNumberDisplays", () => {
  it("parses the stored issue message into displays and raw text", () => {
    const stored = storedUnexpectedNumberDisplays({
      issues: [
        { code: "VISIBLE_PERCENT_SIGN", severity: "warning", message: "x" },
        {
          code: "UNEXPECTED_NUMBERS",
          severity: "warning",
          message: "Unexpected numbers: 1.402.704, 7,5, 2026"
        }
      ]
    });
    expect(stored).toEqual({
      displays: ["1.402.704", "7,5", "2026"],
      raw: "1.402.704, 7,5, 2026"
    });
  });

  it("returns null when the issue or message format is absent", () => {
    expect(storedUnexpectedNumberDisplays({ issues: [] })).toBeNull();
    expect(storedUnexpectedNumberDisplays(null)).toBeNull();
    expect(
      storedUnexpectedNumberDisplays({
        issues: [{ code: "UNEXPECTED_NUMBERS", message: "different format" }]
      })
    ).toBeNull();
  });
});

describe("hiddenDraftRewriteOutputFromRow", () => {
  const hiddenDraft = {
    title: "Selskapet melder oppdatering",
    lead: "Selskapet melder om nye detaljer.",
    body: ["Selskapet ga en oppdatering i dag."],
    company_sentence: "Test ASA er et norsk selskap."
  };

  it("uses hiddenDraft even when outputJson parses as a full rewrite", () => {
    // Published number-strip rows: outputJson is the POST-strip rewrite;
    // the draft under test must come from hiddenDraft regardless.
    const output = hiddenDraftRewriteOutputFromRow({
      validationJson: { hiddenDraft }
    });
    expect(output?.lead).toBe(hiddenDraft.lead);
    expect(output?.key_facts).toEqual(["Fixture replay placeholder"]);
    expect(output?.source_spans).toEqual(["Fixture replay source span"]);
  });

  it("returns null when hiddenDraft is absent or malformed", () => {
    expect(hiddenDraftRewriteOutputFromRow({ validationJson: {} })).toBeNull();
    expect(
      hiddenDraftRewriteOutputFromRow({
        validationJson: { hiddenDraft: { title: 42 } }
      })
    ).toBeNull();
  });
});

describe("storedRepairInitialUnexpectedNumbers", () => {
  it("reads the UNEXPECTED_NUMBERS entry from validationRepair.initialWarnings", () => {
    const stored = storedRepairInitialUnexpectedNumbers({
      issues: [
        { code: "UNEXPECTED_NUMBERS", message: "Unexpected numbers: 999" }
      ],
      validationRepair: {
        applied: true,
        issueCodes: ["UNEXPECTED_NUMBERS"],
        initialWarnings: [
          "Visible percent sign",
          "Unexpected numbers: 89,17, 10,83"
        ]
      }
    });
    // The final issues entry (999) must be ignored — it describes the
    // post-repair rewrite, not the draft.
    expect(stored).toEqual({
      displays: ["89,17", "10,83"],
      raw: "89,17, 10,83"
    });
  });

  it("returns null when validationRepair or the warning entry is absent", () => {
    expect(storedRepairInitialUnexpectedNumbers({})).toBeNull();
    expect(storedRepairInitialUnexpectedNumbers(null)).toBeNull();
    expect(
      storedRepairInitialUnexpectedNumbers({
        validationRepair: { initialWarnings: ["Visible percent sign"] }
      })
    ).toBeNull();
  });
});

describe("strippedNumberDisplays", () => {
  it("reports draft numbers missing from the published rewrite", () => {
    const draft = createRewrite({
      lead: "Resultatet ble minus 66.155 kroner.",
      body: ["Omsetningen var 164.423 kroner i kvartalet."]
    });
    const published = createRewrite({
      lead: "Resultatet ble negativt.",
      body: ["Omsetningen falt i kvartalet."]
    });
    expect(strippedNumberDisplays(draft, published)).toEqual([
      "66.155",
      "164.423"
    ]);
  });

  it("does not count separator restyling as stripped", () => {
    const draft = createRewrite({
      lead: "Selskapet hadde 1.402.704 passasjerer.",
      body: []
    });
    const published = createRewrite({
      lead: "Selskapet hadde 1 402 704 passasjerer.",
      body: []
    });
    expect(strippedNumberDisplays(draft, published)).toEqual([]);
  });

  it("includes company_sentence and dedupes by parsed key", () => {
    const draft = createRewrite({
      lead: "Avtalen er verdt 12,5 millioner.",
      body: ["Avtalen på 12,5 millioner løper i tre år."],
      company_sentence: "Selskapet omsatte for 900 millioner i fjor."
    });
    const published = createRewrite({
      lead: "Avtalen er inngått.",
      body: [],
      company_sentence: "Selskapet er notert på Oslo Børs."
    });
    expect(strippedNumberDisplays(draft, published)).toEqual(["12,5", "900"]);
  });
});

describe("findDigitVariantInSource", () => {
  it("finds digits_equal across separator stylings", () => {
    expect(
      findDigitVariantInSource("66.155", "Operating profit -66 155 in Q2")
    ).toEqual({ variant: "digits_equal", sourceDisplay: "-66 155" });
    expect(findDigitVariantInSource("89,17", "row 4 total 89.17 pct")).toEqual({
      variant: "digits_equal",
      sourceDisplay: "89.17"
    });
  });

  it("finds digit_subrun inside a longer merged table run", () => {
    expect(
      findDigitVariantInSource("90 244", "Cells 90 244 118 630 merged")
    ).toEqual(
      expect.objectContaining({ variant: expect.stringMatching(/digits_equal|digit_subrun/) })
    );
    expect(
      findDigitVariantInSource("1 337 911", "Row 11 016 820 89 1 337 911 10")
    ).not.toBeNull();
  });

  it("requires at least 4 digits for subrun matches and returns null on miss", () => {
    // "25" appears inside "12 250 000" digits but is too short for a subrun.
    expect(findDigitVariantInSource("25", "Total 12 250 000")).toBeNull();
    expect(findDigitVariantInSource("77,4", "No such figure here 12")).toBeNull();
    expect(findDigitVariantInSource("ingen tall", "12 345")).toBeNull();
  });
});
