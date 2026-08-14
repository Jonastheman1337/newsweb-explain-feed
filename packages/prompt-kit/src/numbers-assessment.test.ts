import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  assessNumbers,
  defaultEnabledDerivationRules,
  findUnexpectedNumbers,
  numberDerivationRuleIds,
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

describe("derivation slot", () => {
  // Mixed matched + unexpected fixture exercising both dispositions.
  const rewrite = createRewrite({
    lead: "Selskapet henter 1,5 milliarder kroner, mot ventet 2,7 milliarder.",
    key_facts: ["Henter 1,5 milliarder kroner"]
  });
  const source = "The company will raise NOK 1,5 billion in the offering.";

  it("pins the registry contents and the default enabled set", () => {
    // Updating these expectations is a deliberate release act: appending a
    // rule id must come with corpus-replay evidence, and enabling one must
    // come with refreshed fixture expectations (see the plan doc).
    expect([...numberDerivationRuleIds]).toEqual(["source_cell_subrun"]);
    expect([...defaultEnabledDerivationRules]).toEqual([]);
  });

  it("returns identical assessments with an explicit empty enabled set", () => {
    expect(
      assessNumbers(rewrite, source, { enabledDerivationRules: [] })
    ).toEqual(assessNumbers(rewrite, source));
  });

  it("accepts the options argument on findUnexpectedNumbers without behavior change", () => {
    expect(
      findUnexpectedNumbers(rewrite, source, { enabledDerivationRules: [] })
    ).toEqual(findUnexpectedNumbers(rewrite, source));
  });

  it("emits no candidateRuleId key while the registry is empty", () => {
    for (const assessment of assessNumbers(rewrite, source)) {
      expect("candidateRuleId" in assessment).toBe(false);
    }
  });

  it("dedupes repeated displays in unexpectedNumberDisplays", () => {
    const displays = unexpectedNumberDisplays([
      { display: "2,7", disposition: "unexpected", ruleId: null, count: 1 },
      {
        display: "2,7",
        disposition: "unexpected",
        ruleId: null,
        count: 1,
        candidateRuleId: undefined
      },
      { display: "1,5", disposition: "matched", ruleId: "exact_source_match", count: 1 }
    ]);
    expect(displays).toEqual(["2,7"]);
  });
});

describe("source_cell_subrun rule", () => {
  // Real corpus shape (679614): the source table row tokenizes as one long
  // digit run; the rewrite's source_spans quotes the first two cells.
  const tableSource = [
    "Kvartalsrapport for konsernet",
    "Resultat etter skatt 297 689 186 914 484 438 328 548 847 619",
    "Totalresultat 297 689 186 914 484 438 328 548 847 619"
  ].join("\n");
  const spanQuotingRewrite = createRewrite({
    lead: "Konsernet fikk et resultat etter skatt paa 298 millioner kroner.",
    source_spans: ["primary: Resultat etter skatt 297 689 186 914"]
  });

  it("shadows a span-quoted cell sub-run while disabled by default", () => {
    const assessments = assessNumbers(spanQuotingRewrite, tableSource);
    expect(assessments).toContainEqual({
      display: "297 689 186 914",
      disposition: "unexpected",
      ruleId: null,
      count: 1,
      candidateRuleId: "source_cell_subrun"
    });
    // The warning still fires: shadow candidates do not change behavior.
    expect(findUnexpectedNumbers(spanQuotingRewrite, tableSource)).toContain(
      "297 689 186 914"
    );
  });

  it("derives the sub-run with provenance when enabled", () => {
    const enabled = { enabledDerivationRules: ["source_cell_subrun"] as const };
    const assessments = assessNumbers(spanQuotingRewrite, tableSource, enabled);
    expect(assessments).toContainEqual({
      display: "297 689 186 914",
      disposition: "derived",
      ruleId: "source_cell_subrun",
      count: 1,
      provenance: {
        source_run: "297 689 186 914 484 438 328 548 847 619",
        group_offset: 0,
        group_count: 4
      }
    });
    expect(
      findUnexpectedNumbers(spanQuotingRewrite, tableSource, enabled)
    ).not.toContain("297 689 186 914");
  });

  it("ignores the same digits in visible text", () => {
    const visibleRewrite = createRewrite({
      lead: "Resultatet ble 297 689 186 914 kroner i kvartalet.",
      source_spans: ["primary: Resultat etter skatt"]
    });
    const assessments = assessNumbers(visibleRewrite, tableSource, {
      enabledDerivationRules: ["source_cell_subrun"]
    });
    expect(assessments).toContainEqual({
      display: "297 689 186 914",
      disposition: "unexpected",
      ruleId: null,
      count: 1
    });
  });

  it("requires the groups to be contiguous in a single source run", () => {
    const gappedRewrite = createRewrite({
      source_spans: ["primary: Resultat etter skatt 297 689 328 548"]
    });
    const assessments = assessNumbers(gappedRewrite, tableSource, {
      enabledDerivationRules: ["source_cell_subrun"]
    });
    expect(assessments).toContainEqual({
      display: "297 689 328 548",
      disposition: "unexpected",
      ruleId: null,
      count: 1
    });
  });

  it("leaves single-group numbers to the legacy chain", () => {
    const singleRewrite = createRewrite({
      source_spans: ["primary: Sum 999888"]
    });
    const assessments = assessNumbers(singleRewrite, tableSource, {
      enabledDerivationRules: ["source_cell_subrun"]
    });
    expect(assessments).toContainEqual({
      display: "999888",
      disposition: "unexpected",
      ruleId: null,
      count: 1
    });
  });
});
