import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  assessNumbers,
  findUnexpectedNumbers,
  unexpectedNumberDisplays
} from "./numbers.js";

function createRewrite(overrides: Partial<RewriteOutput>): RewriteOutput {
  return {
    title: "Selskapet melder oppdatering",
    lead: "Selskapet melder om nye detaljer.",
    body: [],
    company_sentence: "Test ASA er et norsk selskap.",
    key_facts: [],
    negative_or_surprising: [],
    excluded_hype: [],
    source_limitations: [],
    confidence: "high",
    importance: "medium",
    source_spans: [],
    ...overrides
  };
}

function wrapperMatchesAssessments(
  rewrite: RewriteOutput,
  sourceText: string
): void {
  expect(findUnexpectedNumbers(rewrite, sourceText)).toEqual(
    unexpectedNumberDisplays(assessNumbers(rewrite, sourceText))
  );
}

describe("assessNumbers", () => {
  it("attributes exact source matches and folds repeated occurrences", () => {
    const rewrite = createRewrite({
      lead: "Styremedlemmet har kjøpt 500 aksjer i selskapet.",
      key_facts: ["Kjøpt 500 aksjer"]
    });
    const source = "The board member acquired 500 shares in the company.";

    expect(assessNumbers(rewrite, source)).toContainEqual({
      display: "500",
      disposition: "matched",
      ruleId: "exact_source_match",
      count: 2
    });
    wrapperMatchesAssessments(rewrite, source);
  });

  it("attributes thousands-separator equivalents", () => {
    const rewrite = createRewrite({
      lead: "Styremedlemmet har kjøpt 10.000 aksjer i selskapet."
    });
    const source = "The board member acquired 10 000 shares in the company.";

    expect(assessNumbers(rewrite, source)).toContainEqual({
      display: "10.000",
      disposition: "matched",
      ruleId: "thousands_separator_equivalent",
      count: 1
    });
    wrapperMatchesAssessments(rewrite, source);
  });

  it("attributes rounded million figures from thousand-scaled report tables", () => {
    const rewrite = createRewrite({
      lead: "CMM okte inntektene til 33,6 millioner dollar i kvartalet."
    });
    const source = [
      "Consolidated statement of income",
      "(in USD thousands)",
      "Revenue 33,613 12,118"
    ].join("\n");

    expect(assessNumbers(rewrite, source)).toContainEqual({
      display: "33,6",
      disposition: "matched",
      ruleId: "scaled_million_report_table",
      count: 1
    });
    wrapperMatchesAssessments(rewrite, source);
  });

  it("attributes unit-scaled amounts with unit and scale provenance", () => {
    const rewrite = createRewrite({
      lead: "Norse Atlantic skal hente 1,02 milliarder kroner brutto."
    });
    const source =
      "raising gross proceeds of NOK 1,019,832,000 in the rights issue";

    expect(assessNumbers(rewrite, source)).toContainEqual({
      display: "1,02",
      disposition: "matched",
      ruleId: "scaled_unit_amount",
      count: 1,
      provenance: { unit: "nok", scale: "billion" }
    });
    wrapperMatchesAssessments(rewrite, source);
  });

  it("attributes shared percent ranges when the source only marks percent forms", () => {
    const rewrite = createRewrite({
      lead: "Photocure venter vekst paa 7 til 11 prosent i konstant valuta."
    });
    const source =
      "Photocure expects product revenue growth of 7% to 11% on a constant currency basis.";

    const assessments = assessNumbers(rewrite, source);
    expect(assessments).toContainEqual({
      display: "7",
      disposition: "matched",
      ruleId: "shared_percent_range",
      count: 1
    });
    expect(assessments).toContainEqual({
      display: "11",
      disposition: "matched",
      ruleId: "exact_source_match",
      count: 1
    });
    wrapperMatchesAssessments(rewrite, source);
  });

  it("attributes paired trade arithmetic with operand provenance", () => {
    const rewrite = createRewrite({
      lead: "Lorenz har kjopt aksjer for 34.300 kroner.",
      source_spans: ["10.000 shares", "NOK 3,43 per share"]
    });
    const source =
      "Lorenz AS acquired 10.000 shares at a price of NOK 3,43 per share.";

    expect(assessNumbers(rewrite, source)).toContainEqual({
      display: "34.300",
      disposition: "matched",
      ruleId: "trade_arithmetic_pair",
      count: 1,
      provenance: { paired: true, quantity: 10000, price: 3.43 }
    });
    wrapperMatchesAssessments(rewrite, source);
  });

  it("attributes aggregate trade arithmetic with term provenance", () => {
    const rewrite = createRewrite({
      lead: "Investorene kjopte samlet aksjer for 95.000 kroner.",
      source_spans: ["10.000 shares at NOK 3,50", "20.000 shares at NOK 3,00"]
    });
    const source = [
      "Investor A acquired 10.000 shares at a price of NOK 3,50 per share.",
      "Investor B acquired 20.000 shares at a price of NOK 3,00 per share."
    ].join("\n");

    expect(assessNumbers(rewrite, source)).toContainEqual({
      display: "95.000",
      disposition: "matched",
      ruleId: "trade_arithmetic_aggregate",
      count: 1,
      provenance: { terms: [35000, 60000], sum: 95000 }
    });
    wrapperMatchesAssessments(rewrite, source);
  });

  it("reports unmatched numbers as unexpected with a null rule", () => {
    const rewrite = createRewrite({
      lead: "Selskapet skal hente 1,02 milliarder kroner.",
      key_facts: ["Henter 1,02 milliarder kroner"]
    });
    const source = "The company will raise gross proceeds of NOK 900,000,000.";

    expect(assessNumbers(rewrite, source)).toContainEqual({
      display: "1,02",
      disposition: "unexpected",
      ruleId: null,
      count: 2
    });
    expect(findUnexpectedNumbers(rewrite, source)).toEqual(["1,02"]);
  });

  it("credits the highest-priority rule when several rules match", () => {
    const rewrite = createRewrite({
      lead: "Selskapet henter 1,5 milliarder kroner i emisjonen."
    });
    const source =
      "The company will raise NOK 1,500,000,000 (NOK 1,5 billion) in the offering.";

    expect(assessNumbers(rewrite, source)).toContainEqual({
      display: "1,5",
      disposition: "matched",
      ruleId: "exact_source_match",
      count: 1
    });
    wrapperMatchesAssessments(rewrite, source);
  });

  it("keeps matched and unexpected records separate for the same display", () => {
    const rewrite = createRewrite({
      lead: "Inntektene ble 33,6 millioner dollar.",
      body: [
        "Selskapet viser i presentasjonen ellers til at nivaaet 33,6 gjelder kvartalet."
      ]
    });
    const source = [
      "Consolidated statement of income",
      "(in USD thousands)",
      "Revenue 33,613 12,118"
    ].join("\n");

    const assessments = assessNumbers(rewrite, source);
    expect(assessments).toContainEqual({
      display: "33,6",
      disposition: "matched",
      ruleId: "scaled_million_report_table",
      count: 1
    });
    expect(assessments).toContainEqual({
      display: "33,6",
      disposition: "unexpected",
      ruleId: null,
      count: 1
    });
    expect(findUnexpectedNumbers(rewrite, source)).toEqual(["33,6"]);
  });
});
