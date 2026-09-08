import { describe, expect, it } from "vitest";
import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { validateRewriteOutput } from "./rewrite-validation.js";

function currencyIssues(source: string, currency: string) {
  const bodyText = "Fjorddata has signed a contract worth " + source + ".";
  const payload: PromptPayload = {
    messageId: 1, title: "New contract", issuerName: "Fjorddata", issuerSign: "FJORD",
    publishedAt: "2026-09-08T07:00:00Z", categories: [], markets: [], bodyText,
    hasAttachments: false, sourceBodyChars: bodyText.length
  };
  const rewrite: RewriteOutput = {
    title: "Fjorddata inngår avtale",
    lead: "Fjorddata har inngått en avtale verdt 10 millioner " + currency + ", melder selskapet.",
    body: [], company_sentence: "", key_facts: [], negative_or_surprising: [],
    excluded_hype: [], source_limitations: [], confidence: "high", importance: "medium",
    source_spans: [bodyText]
  };
  return validateRewriteOutput(rewrite, payload).issues.filter(issue => issue.code === "UNEXPECTED_CURRENCY");
}

const names = [
  ["CAD", "kanadiske dollar"], ["AUD", "australske dollar"],
  ["NZD", "newzealandske dollar"], ["SGD", "singaporske dollar"],
  ["HKD", "Hongkong-dollar"], ["USD", "amerikanske dollar"],
  ["NOK", "kroner"], ["SEK", "svenske kroner"], ["DKK", "danske kroner"],
  ["ISK", "islandske kroner"], ["EUR", "euro"], ["GBP", "britiske pund"],
  ["CHF", "sveitsiske franc"], ["JPY", "japanske yen"], ["CNY", "kinesiske yuan"],
  ["INR", "indiske rupier"], ["BRL", "brasilianske real"], ["ZAR", "sørafrikanske rand"],
  ["PLN", "polske zloty"], ["KRW", "sørkoreanske won"]
];

describe("currency names in future articles", () => {
  it.each(names)("accepts %s written as %s", (code, name) => {
    expect(currencyIssues(code + " 10 million", name)).toEqual([]);
    expect(currencyIssues("10 millioner " + name, code)).toEqual([]);
    expect(currencyIssues("Amounts in M" + code + ": 10", name)).toEqual([]);
  });
  it.each(["Canadian dollars", "C$", "CA$", "kanadiske dollar"])("accepts explicit Canadian source notation %s", source => {
    expect(currencyIssues("10 million " + source, "kanadiske dollar")).toEqual([]);
  });
  it.each(["kanadiske dollar", "australske dollar", "Hongkong-dollar", "islandske kroner"])("rejects unsupported currency %s", name => {
    expect(currencyIssues("USD 10 million", name)).not.toEqual([]);
  });
  it("does not mistake US$ for Singapore dollars", () => {
    expect(currencyIssues("US$ 10 million", "amerikanske dollar")).toEqual([]);
  });
  it("does not let a Canadian amount become US dollars", () => {
    for (const source of ["CAD 10 million", "10 million Canadian dollars", "C$ 10 million"]) {
      expect(currencyIssues(source, "amerikanske dollar")).toEqual([
        expect.objectContaining({ message: expect.stringContaining("USD/dollar") })
      ]);
    }
  });
  it("rejects a change between non-US dollar currencies", () => {
    expect(currencyIssues("CAD 10 million", "australske dollar")).not.toEqual([]);
  });
  it("keeps separate currencies when the source contains both", () => {
    expect(currencyIssues("CAD 10 million and USD 7 million", "kanadiske dollar")).toEqual([]);
    expect(currencyIssues("CAD 10 million and USD 7 million", "amerikanske dollar")).toEqual([]);
  });
});
