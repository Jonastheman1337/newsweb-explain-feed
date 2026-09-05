import { describe, expect, it } from "vitest";
import {
  buildReportContextFromPages,
  reportNeedsOpenAIPdfFallback,
  type ReportContextPack
} from "./pdf-extract.js";

function selectedReasons(
  context: ReturnType<typeof buildReportContextFromPages>,
  pageNumber: number
): string[] {
  return (
    context.selectedPages.find((page) => page.pageNumber === pageNumber)
      ?.reasons ?? []
  );
}

describe("buildReportContextFromPages", () => {
  it("selects income statement pages instead of the first report pages", () => {
    const context = buildReportContextFromPages([
      "UNRELATED FIRST PAGE with generic company branding.",
      "Table of contents\nConsolidated statement of comprehensive income 61",
      "Letter from the CEO\nWe are pleased with strategic progress.",
      [
        "Consolidated statement of comprehensive income",
        "Revenue 100 90",
        "Operating profit 20 10",
        "Profit before tax 15 8"
      ].join("\n"),
      "Consolidated statement of financial position\nAssets 500 450"
    ]);

    expect(context.diagnostics.incomeStatementFound).toBe(true);
    expect(selectedReasons(context, 4)).toContain("income_statement");
    expect(context.text).toContain("[PDF page 4]");
    expect(context.text).toContain("PRIMARY SOURCE");
    expect(context.text).not.toContain("UNRELATED FIRST PAGE");
  });

  it("extracts the three key metrics and does not prefer EBITDA over EBIT", () => {
    const context = buildReportContextFromPages([
      [
        "Consolidated income statement",
        "Revenue 500 400",
        "EBITDA 999 888",
        "Operating profit 123 111",
        "Profit before tax 99 77"
      ].join("\n")
    ]);

    expect(context.metrics.map((metric) => metric.metric)).toEqual(
      expect.arrayContaining([
        "revenue",
        "operating_result",
        "earnings_before_tax"
      ])
    );
    const operatingResult = context.metrics.find(
      (metric) => metric.metric === "operating_result"
    );
    expect(operatingResult?.rowText).toContain("Operating profit");
    expect(operatingResult?.rowText).not.toContain("EBITDA");
  });

  it("does not label management commentary as an income statement without a heading", () => {
    const context = buildReportContextFromPages([
      [
        "CEO review",
        "Revenue was 500, operating profit was 123 and profit before tax was 99.",
        "The quarter showed progress in several markets."
      ].join("\n")
    ]);

    expect(context.diagnostics.incomeStatementFound).toBe(false);
    expect(selectedReasons(context, 1)).not.toContain("income_statement");
  });

  it("force-includes physical PDF pages requested by the user", () => {
    const pages = Array.from({ length: 63 }, (_, index) => `PDF page ${index + 1}`);
    pages[60] = "Requested detail on construction progress.";

    const context = buildReportContextFromPages(pages, "Please include page 61");

    expect(context.diagnostics.requestedPageNumbers).toEqual([61]);
    expect(selectedReasons(context, 61)).toContain("user_page");
    expect(selectedReasons(context, 60)).toContain("user_page_context");
    expect(selectedReasons(context, 62)).toContain("user_page_context");
    expect(context.text).toContain("USER REQUESTED CONTEXT");
    expect(context.text).toContain("[PDF page 61]");
  });

  it("finds pages by semantic user instruction terms", () => {
    const context = buildReportContextFromPages(
      [
        "Generic operating update.",
        "The data center build-out in Sarpsborg is progressing according to plan.",
        "Other report text."
      ],
      "Can you explain better the build out of the datacenter in Sarpsborg?"
    );

    expect(context.diagnostics.requestedTopicTerms).toEqual(
      expect.arrayContaining(["datacenter", "sarpsborg"])
    );
    expect(selectedReasons(context, 2)).toContain("user_topic");
    expect(context.text).toContain("Sarpsborg");
  });
});

describe("reportNeedsOpenAIPdfFallback", () => {
  const strongContext: ReportContextPack = {
    text: "curated report context",
    referenceText: "curated report context",
    pageCount: 12,
    metrics: [
      {
        metric: "revenue",
        label: "Revenue",
        values: ["100", "90"],
        pageNumber: 4,
        rowText: "Revenue 100 90"
      }
    ],
    selectedPages: [
      {
        pageNumber: 4,
        reasons: ["income_statement"],
        score: 30,
        textChars: 3000
      }
    ],
    diagnostics: {
      incomeStatementFound: true,
      fallbackUsed: false,
      requestedPageNumbers: [],
      requestedTopicTerms: [],
      totalExtractedChars: 5000
    }
  };

  it("does not trigger when local extraction has enough text and metrics", () => {
    expect(reportNeedsOpenAIPdfFallback(strongContext)).toBe(false);
  });

  it("triggers when report metrics are missing", () => {
    expect(
      reportNeedsOpenAIPdfFallback({
        ...strongContext,
        metrics: []
      })
    ).toBe(true);
  });

  it("triggers when extracted PDF text is very short", () => {
    expect(
      reportNeedsOpenAIPdfFallback({
        ...strongContext,
        diagnostics: {
          ...strongContext.diagnostics,
          totalExtractedChars: 200
        }
      })
    ).toBe(true);
  });

  it("triggers when a requested topic cannot be satisfied locally", () => {
    expect(
      reportNeedsOpenAIPdfFallback({
        ...strongContext,
        diagnostics: {
          ...strongContext.diagnostics,
          requestedTopicTerms: ["sarpsborg"]
        }
      })
    ).toBe(true);
  });
});
