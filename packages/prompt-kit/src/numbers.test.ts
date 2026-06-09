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
      body: [
        "Selskapet planlegger ogsa aa tilby obligasjonseiere aa gjore laan om til inntil 574,8 millioner nye aksjer."
      ],
      key_facts: [
        "Skal hente 1,02 milliarder kroner brutto",
        "Selger 2,04 milliarder nye aksjer",
        "Inntil 574,8 millioner bond conversion shares"
      ],
      source_spans: [
        "NOK 1,019,832,000",
        "2,039,664,000 new shares",
        "574,814,400 Bond Conversion Shares"
      ]
    });

    const source = [
      "rights issue of 2,039,664,000 new shares in the Company",
      "at a subscription price of NOK 0.50 per Offer Share",
      "raising gross proceeds of NOK 1,019,832,000",
      "The maximum number of new shares to be issued pursuant to the Bond Conversion Offer is 574,814,400."
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

  it("accepts exact share-count times exact price totals", () => {
    const rewrite = createRewrite({
      lead:
        "Lorenz har kjopt 10.000 aksjer for 34.300 kroner, ifolge en borsmelding.",
      key_facts: ["Kjopt for 34.300 kroner"],
      source_spans: ["10.000 shares", "NOK 3,43 per share"]
    });

    const source =
      "Lorenz AS has acquired 10.000 shares at NOK 3,43 per share.";

    expect(findUnexpectedNumbers(rewrite, source)).toEqual([]);
  });

  it("requires approximate wording for totals derived from average prices", () => {
    const rewrite = createRewrite({
      lead:
        "Lorenz har kjopt 10.000 aksjer for 34.300 kroner, ifolge en borsmelding.",
      key_facts: ["Kjopt for 34.300 kroner"],
      source_spans: ["10.000 shares", "average price of NOK 3,43 per share"]
    });

    const source =
      "Lorenz AS has acquired 10.000 shares at an average price of NOK 3,43 per share.";

    expect(findUnexpectedNumbers(rewrite, source)).toContain("34.300");
  });

  it("accepts rounded approximate totals derived from average prices", () => {
    const rewrite = createRewrite({
      lead:
        "Innsidehandleren kjopte aksjer for rundt 1,2 millioner kroner.",
      key_facts: ["Kjopt for rundt 1,2 millioner kroner"],
      source_spans: ["100.000 shares", "average price of NOK 12,38 per share"]
    });

    const source =
      "The primary insider acquired 100.000 shares at an average price of NOK 12,38 per share.";

    expect(findUnexpectedNumbers(rewrite, source)).toEqual([]);
  });

  it("accepts aggregate totals from multiple explicit share-price pairs", () => {
    const rewrite = createRewrite({
      lead:
        "To innsidere kjopte aksjer for til sammen 95.000 kroner.",
      key_facts: ["Til sammen 95.000 kroner"],
      source_spans: [
        "10.000 shares at NOK 3,50 per share",
        "20.000 shares at NOK 3,00 per share"
      ]
    });

    const source = [
      "Kari Hansen acquired 10.000 shares at NOK 3,50 per share.",
      "Ola Nordmann acquired 20.000 shares at NOK 3,00 per share."
    ].join("\n");

    expect(findUnexpectedNumbers(rewrite, source)).toEqual([]);
  });

  it("accepts approximate average-price totals written with proper Norwegian letters", () => {
    const rewrite = createRewrite({
      lead: "Innsidehandleren kjøpte aksjer for nær 1,2 millioner kroner.",
      key_facts: ["Kjøpt for nær 1,2 millioner kroner"],
      source_spans: ["100.000 shares", "average price of NOK 12,38 per share"]
    });

    const source =
      "The primary insider acquired 100.000 shares at an average price of NOK 12,38 per share.";

    expect(findUnexpectedNumbers(rewrite, source)).toEqual([]);
  });

  it("accepts exact totals introduced by 'kjøpesummen'", () => {
    const rewrite = createRewrite({
      lead: "Lorenz har kjøpt 10.000 aksjer. Kjøpesummen er 34.300 kroner.",
      key_facts: ["Kjøpesum: 34.300 kroner"],
      source_spans: ["10.000 shares", "NOK 3,43 per share"]
    });

    const source =
      "Lorenz AS has acquired 10.000 shares at NOK 3,43 per share.";

    expect(findUnexpectedNumbers(rewrite, source)).toEqual([]);
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
