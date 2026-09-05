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
  it("keeps income statement selection distinct from early raw report pages", () => {
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
    expect(selectedReasons(context, 1)).toEqual(["report_overview"]);
    expect(context.text).toContain("REPORT OVERVIEW");
    expect(context.metrics.every(metric => metric.pageNumber === 4)).toBe(true);
  });

  it("keeps a bounded unrecognised early overview beside a later financial table", () => {
    const overview = "Review of our quarter\nDemand fell after the temporary distribution closure.\nBacklog\t740\t620\n";
    const table = ["Consolidated income statement", "NOK million", "Q1 2028 Q1 2027", "Revenue 86 92", "Operating profit 8 11", "Profit before tax 6 9"].join("\n");
    const context = buildReportContextFromPages([
      "Report cover",
      "Table of contents\nReview 3\nFinancial statements 12",
      overview + "Further background on the distribution network.\n".repeat(2000) + "OVERVIEW END",
      ...Array.from({ length: 8 }, () => "Illustration"),
      table
    ]);
    expect(selectedReasons(context, 3)).toEqual(["report_overview"]);
    expect(selectedReasons(context, 12)).toContain("income_statement");
    expect(selectedReasons(context, 2)).toEqual([]);
    expect(context.text).toContain(overview);
    expect(context.text).toContain(table);
    expect(context.referenceText).toContain(`[PDF page 3]\n${overview}`);
    expect(context.referenceText).toContain(`[PDF page 12]\n${table}`);
    expect(context.referenceText).not.toContain("OVERVIEW END");
    expect(context.text.length).toBeLessThanOrEqual(24000);
    expect(context.referenceText.length).toBeLessThanOrEqual(72000);
    expect(context.diagnostics.referenceTextTruncated).toBe(true);
    expect(context.financialFacts?.filter(fact => fact.usable)).toHaveLength(6);
    expect(context.metrics.every(metric => metric.pageNumber === 12)).toBe(true);
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

describe("financial table evidence", () => {
  const financialContext = (rows: string[], header = "Q2 2026 Q2 2025 H1 2026 H1 2025 FY 2025", unit = "NOK million") => buildReportContextFromPages([
    ["Consolidated income statement", unit, header, ...rows].join("\n")
  ]);

  it("keeps five decimal columns separate and binds only comparable periods", () => {
    const context = financialContext(["Revenue 33,9 30,1 56,1 50,4 117,2"]);
    expect(context.metrics[0].values).toEqual(["33,9", "30,1", "56,1", "50,4", "117,2"]);
    expect(context.financialFacts?.map((fact) => fact.numericValue)).toEqual([33.9, 30.1, 56.1, 50.4, 117.2]);
    expect(context.financialFacts?.every((fact) => fact.usable)).toBe(true);
    expect(context.financialFacts?.map((fact) => fact.comparisonPeriodId)).toEqual(["2025-Q2", null, "2025-H1", null, null]);
    expect(context.financialFacts?.[0]).toMatchObject({ currency: "NOK", scale: "millions", pageNumber: 1, rowNumber: 4, rowText: "Revenue 33,9 30,1 56,1 50,4 117,2", tableScope: "consolidated" });
    expect(context.referenceText).not.toContain("ALIGNED FINANCIAL FACTS");
    expect(context.referenceText).toContain("NOK million\nQ2 2026 Q2 2025 H1 2026 H1 2025 FY 2025");
  });

  it("keeps integer columns separate but recognises thousands inside explicit cells", () => {
    const simple = financialContext(["Revenue 100 200"], "Q2 2026 Q2 2025");
    expect(simple.financialFacts?.map((fact) => fact.numericValue)).toEqual([100, 200]);
    const grouped = financialContext(["Revenue\t1 234 567\t1 123 456"], "Q2 2026 Q2 2025", "NOK");
    expect(grouped.metrics[0].values).toEqual(["1 234 567", "1 123 456"]);
    expect(grouped.financialFacts?.map((fact) => fact.numericValue)).toEqual([1234567, 1123456]);
    expect(grouped.financialFacts?.every((fact) => fact.usable)).toBe(true);
  });

  it("does not infer a period type, currency, scale or scope from a title or number order", () => {
    const context = buildReportContextFromPages(["Income statement\n2026 2025\nRevenue 33,9 30,1"]);
    expect(context.financialFacts?.every((fact) => !fact.usable)).toBe(true);
    expect(context.financialFacts?.[0].unresolved).toEqual(expect.arrayContaining(["period_unresolved", "currency_unresolved", "scale_unresolved", "table_scope_unresolved"]));
    expect(context.diagnostics.completeness).toBe("insufficient");
    expect(reportNeedsOpenAIPdfFallback(context)).toBe(true);
  });

  it.each([
    ["Revenue 3 33,9 30,1", "Q2 2026 Q2 2025"],
    ["Revenue 33,9 – 30,1", "Q2 2026 H1 2026 Q2 2025"],
    ["Revenue 33,9% 30,1%", "Q2 2026 Q2 2025"],
    ["Revenue 33,9 30,1", "Q2 2026 Q2 2026"],
    ["Revenue was 33,9 versus 30,1", "Q2 2026 Q2 2025"],
    ["Revenue 33,9 30,1", "We improved from Q2 2025 to Q2 2026"]
  ])("withholds aligned periods for ambiguous rows/headers: %s", (row, header) => {
    const context = financialContext([row], header);
    expect(context.financialFacts?.length).toBeGreaterThan(0);
    expect(context.financialFacts?.every((fact) => !fact.usable && fact.period === null)).toBe(true);
  });

  it("preserves ambiguous separators and parses unambiguous signed locale numbers", () => {
    const context = financialContext(["Revenue 1,234 1.234,5 (30,1) −12.5 0,0"]);
    expect(context.financialFacts?.map((fact) => fact.numericValue)).toEqual([null, 1234.5, -30.1, -12.5, 0]);
    expect(context.financialFacts?.[0].rawValue).toBe("1,234");
    expect(context.financialFacts?.[0].unresolved).toContain("ambiguous_number_separators");
  });

  it("combines explicit split period/year column headers", () => {
    const context = financialContext(["Revenue 33,9 30,1 56,1 50,4 117,2"], "Q2\tQ2\tH1\tH1\tYear\n2026\t2025\t2026\t2025\t2025");
    expect(context.financialFacts?.map((fact) => fact.period?.id)).toEqual(["2026-Q2", "2025-Q2", "2026-H1", "2025-H1", "2025-FY"]);
    expect(context.financialFacts?.every((fact) => fact.usable)).toBe(true);
  });

  it("does not borrow another statement's scope, period or units", () => {
    const context = buildReportContextFromPages([
      ["Consolidated income statement", "NOK million", "Q2 2026 Q2 2025", "Revenue 33,9 30,1", "Cash flow statement", "Operating profit 15,2 12,4"].join("\n")
    ]);
    const operating = context.financialFacts?.find((fact) => fact.metric === "operating_result");
    expect(operating).toMatchObject({ usable: false, currency: null, scale: null, period: null, tableScope: null });
  });
});
