import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import { findUnexpectedNumbers } from "./numbers.js";

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

describe("findUnexpectedNumbers", () => {
  it("accepts source-derived rounded million and billion amounts", () => {
    const rewrite = createRewrite({
      title: "Norse Atlantic skal hente en milliard",
      lead:
        "Norse Atlantic skal hente 1,02 milliarder kroner brutto ved aa selge 2,04 milliarder nye aksjer til 0,50 kroner stykket.",
      body: [],
      key_facts: [
        "Skal hente 1,02 milliarder kroner brutto",
        "Selger 2,04 milliarder nye aksjer"
      ],
      source_spans: [
        "NOK 1,019,832,000",
        "2,039,664,000 new shares"
      ]
    });

    const source = [
      "rights issue of 2,039,664,000 new shares in the Company",
      "at a subscription price of NOK 0.50 per Offer Share",
      "raising gross proceeds of NOK 1,019,832,000 (the NOK equivalent of approximately USD 110 million)"
    ].join("\n");

    expect(findUnexpectedNumbers(rewrite, source)).toEqual([]);
  });

  it("accepts exact share-count times exact price totals", () => {
    const rewrite = createRewrite({
      lead: "Lorenz har kjopt aksjer for 34.300 kroner.",
      key_facts: ["Kjopt for 34.300 kroner"],
      source_spans: ["10.000 shares", "NOK 3,43 per share"]
    });

    const source =
      "Lorenz AS acquired 10.000 shares at a price of NOK 3,43 per share.";

    expect(findUnexpectedNumbers(rewrite, source)).toEqual([]);
  });

  it("requires approximate wording for average-price totals", () => {
    const rewrite = createRewrite({
      lead: "Lorenz har kjopt aksjer for 34.300 kroner.",
      key_facts: ["Kjopt for 34.300 kroner"],
      source_spans: ["10.000 shares", "average price of NOK 3,43 per share"]
    });

    const source =
      "Lorenz AS acquired 10.000 shares at an average price of NOK 3,43 per share.";

    expect(findUnexpectedNumbers(rewrite, source)).toContain("34.300");
  });

  it("accepts approximate totals derived from average trade prices", () => {
    const rewrite = createRewrite({
      lead: "Investoren kjopte aksjer for rundt 1,2 millioner kroner.",
      key_facts: ["Kjopt for rundt 1,2 millioner kroner"],
      source_spans: ["100.000 shares", "average price of NOK 12,38 per share"]
    });

    const source =
      "The investor acquired 100.000 shares at an average price of NOK 12,38 per share.";

    expect(findUnexpectedNumbers(rewrite, source)).toEqual([]);
  });

  it("accepts aggregate totals from multiple explicit share-price pairs", () => {
    const rewrite = createRewrite({
      lead: "Investorene kjopte samlet aksjer for 95.000 kroner.",
      key_facts: ["Samlet kjop for 95.000 kroner"],
      source_spans: [
        "10.000 shares at NOK 3,50",
        "20.000 shares at NOK 3,00"
      ]
    });

    const source = [
      "Investor A acquired 10.000 shares at a price of NOK 3,50 per share.",
      "Investor B acquired 20.000 shares at a price of NOK 3,00 per share."
    ].join("\n");

    expect(findUnexpectedNumbers(rewrite, source)).toEqual([]);
  });

  it("still flags rounded magnitude amounts without a close source number", () => {
    const rewrite = createRewrite({
      lead: "Selskapet skal hente 1,02 milliarder kroner.",
      key_facts: ["Henter 1,02 milliarder kroner"]
    });

    const source = "The company will raise gross proceeds of NOK 900,000,000.";

    expect(findUnexpectedNumbers(rewrite, source)).toContain("1,02");
  });

  it("accepts shared percent-unit ranges", () => {
    const rewrite = createRewrite({
      lead:
        "Photocure venter produktinntektsvekst paa 7 til 11 prosent i konstant valuta.",
      key_facts: ["Produktinntektsvekst paa 7 til 11 prosent"],
      source_spans: ["product revenue growth in the range of 7% to 11%"]
    });

    const source =
      "Photocure continues to expect product revenue growth in the range of 7% to 11% on a constant currency basis.";

    expect(findUnexpectedNumbers(rewrite, source)).toEqual([]);
  });

  it("accepts shared percent-unit ranges when the source only marks the second bound", () => {
    const rewrite = createRewrite({
      lead:
        "Photocure venter produktinntektsvekst paa 7 til 11 prosent i konstant valuta.",
      key_facts: ["Produktinntektsvekst paa 7 til 11 prosent"]
    });

    const source =
      "Photocure continues to expect product revenue growth in the range of 7 to 11% on a constant currency basis.";

    expect(findUnexpectedNumbers(rewrite, source)).toEqual([]);
  });

  it("still flags percent values used without visible percent context", () => {
    const rewrite = createRewrite({
      lead: "Photocure venter produktinntektsvekst paa 7.",
      key_facts: ["Produktinntektsvekst paa 7"]
    });

    const source =
      "Photocure continues to expect product revenue growth of 7% on a constant currency basis.";

    expect(findUnexpectedNumbers(rewrite, source)).toContain("7");
  });
});
