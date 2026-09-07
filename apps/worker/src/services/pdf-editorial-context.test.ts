import { describe, expect, it } from "vitest";
import { buildReportContextFromPages, renderPdfTextItems } from "./pdf-extract.js";

const table = "Consolidated income statement\nNOK million\nQ2 2026 Q2 2025\nRevenue 100 90\nOperating profit 20 18\nProfit before tax 12 10";
const prose = "The company sold fewer products because customers postponed deliveries during the quarter. Management expects the postponed deliveries to resume later in the year.";

describe("PDF context for the historical editorial writer", () => {
  it("keeps the explanation beside the figures without selecting incidental accounting-policy mentions", () => {
    const context = buildReportContextFromPages([
      "Table of contents\nManagement report 2\nIncome statement 4",
      `Management report Q2 2026\n${prose}`,
      "Financial results\nThe previous year's result included a NOK 46 million gain on a property sale.",
      table,
      "Note 1 - Accounting policies\nManagement review\nIncome statement\nManagement uses estimates and assumptions about the outlook."
    ]);
    expect(context.selectedPages.map(page => page.pageNumber)).toEqual([2, 3, 4]);
    expect(context.text).toContain("NOK 46 million gain");
    expect(context.referenceText).toContain("[PDF page 3]\nFinancial results");
    expect(context.referenceText).not.toContain("STRUCTURED");
    expect(context.referenceText).not.toContain("Accounting policies");
  });

  it("recovers an adjacent page of management prose but stops at the accounts", () => {
    const context = buildReportContextFromPages([
      `Letter from the CEO\n${prose}`,
      "Some customers are now bringing forward their deliveries, after reducing orders last year. This has helped the company keep production running at both factories throughout the quarter.",
      table,
      "Note 1 - Accounting policies\n" + prose
    ]);
    expect(context.selectedPages.map(page => page.pageNumber)).toEqual([1, 2, 3]);
    expect(context.text).toContain("both factories");
  });

  it("keeps user-requested accounting notes and bounds the raw reference context", () => {
    const context = buildReportContextFromPages([
      table, "Note 1 - Accounting policies\n" + prose.repeat(600)
    ], "Include page 2");
    expect(context.selectedPages.find(page => page.pageNumber === 2)?.reasons).toContain("user_page");
    expect(context.referenceText).toContain("Accounting policies");
    expect(context.referenceText.length).toBeLessThanOrEqual(72000);
    expect(context.diagnostics.referenceTextTruncated).toBe(true);
  });

  it("preserves table column gaps and whole words despite visual-space items and baseline jitter", () => {
    const item = (str: string, x: number, y: number, width: number) => ({str, width, transform: [10, 0, 0, 10, x, y]});
    const rendered = renderPdfTextItems([
      item("Revenue", 0, 100, 40), item(" ", 40, 100, 100),
      item("100", 140, 100.5, 15), item("90", 200, 100, 10),
      item("Operating", 0, 80, 45), item("profit", 48, 80, 25),
      item("20", 140, 80, 10), item("18", 200, 80, 10)
    ]);
    expect(rendered).toBe("Revenue\t100\t90\nOperating profit\t20\t18");
  });

  it("does not select a sentence mentioning an income statement as the statement itself", () => {
    const context = buildReportContextFromPages([table,
      "The income statement is prepared under the stated policy. Management uses estimates and the CEO approves assumptions concerning the outlook."
    ]);
    expect(context.selectedPages.map(page => page.pageNumber)).toEqual([1]);
  });
});
