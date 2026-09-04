import { describe, expect, it } from "vitest";
import { buildReportContextFromPages } from "./pdf-extract.js";

const table = [
  "Consolidated income statement",
  "NOK million",
  "Q2 2026 Q2 2025",
  "Total operating income 132,3 175,3",
  "Operating profit 22,0 107,1",
  "Profit before tax -67,6 40,5"
].join("\n");
const prose = "The group continued work on the existing properties during the quarter. The report describes changes in occupancy and rental income for the current reporting period.";

describe("material management report context", () => {
  it("retains management and financial results beside tables, including a prior-year property gain", () => {
    // Compact source-format regression based on the physical Carucel pages 3–5.
    const context = buildReportContextFromPages([
      "Cover",
      "Table of contents\nManagement report 3\nIncome statement 5",
      `CARUCEL PROPERTY AS\nMANAGEMENT REPORT Q2 2026\n${prose}\nThe appointment of a new General Manager`,
      [
        "with international experience is expected to support the property's development.",
        "Acquisitions and divestments",
        "The group completed no significant property divestments during the quarter.",
        "Financial results",
        "EBITDA declined from NOK 109.0 million to NOK 62.8 million because Q2 2025 included a NOK 46 million gain on property divestments.",
        "Excluding this gain, EBITDA was broadly unchanged."
      ].join("\n"),
      table,
      "Note 1 - ACCOUNTING PRINCIPLES\nThe statements consist of income statement, balance sheet and notes. Management uses estimates.",
      "Revenue recognition\nNote 1 - ACCOUNTING PRINCIPLES\nRevenue is recognised in the income statement after delivery."
    ]);
    expect(context.selectedPages.map(page => page.pageNumber)).toEqual([3, 4, 5]);
    expect(context.selectedPages.find(page => page.pageNumber === 5)?.reasons).toContain("income_statement");
    expect(context.text).toContain("NOK 46 million gain on property divestments");
    expect(context.text).toContain("Excluding this gain, EBITDA was broadly unchanged.");
    expect(context.referenceText).toContain("[PDF page 4]\nwith international experience");
    expect(context.referenceText).not.toContain("ACCOUNTING PRINCIPLES");
    expect(context.financialFacts?.filter(fact => fact.usable)).toHaveLength(6);
  });

  it("follows one prose continuation without a repeated heading and stops before accounting notes", () => {
    const context = buildReportContextFromPages([
      `Management report\n${prose}\nThe reported change reflects`,
      `a disposal completed during the prior year. ${prose}`,
      `Note 1 - Accounting principles\n${prose}`,
      table
    ]);
    expect(context.selectedPages.map(page => page.pageNumber)).toEqual([1, 2, 4]);
    expect(context.referenceText).toContain("a disposal completed during the prior year");
  });

  it("recovers Norwegian half-year narrative and a results explanation with a dated heading", () => {
    // Headings can occur after the body in the PDF text item order.
    const context = buildReportContextFromPages([
      `OM KONSERNET\n${prose}\nHalvårsberetning`,
      `${prose}\nHalvårsberetning`,
      "Foto: Fagne",
      [
        "RESULTAT PER 30.06.2026",
        "Konsernet leverte et resultat på kr 492 mill., kr 82 mill. over samme periode i 2025, i all hovedsak grunnet oppnådd strømpris."
      ].join("\n"),
      table
    ]);
    expect(context.selectedPages.map(page => page.pageNumber)).toEqual([1, 2, 4, 5]);
    expect(context.text).toContain("i all hovedsak grunnet oppnådd strømpris");
    expect(context.referenceText).toContain("[PDF page 4]\nRESULTAT PER 30.06.2026");
  });

  it("does not select prose mentions of management, outlook or an income statement as headings", () => {
    const context = buildReportContextFromPages([
      table,
      "The income statement is prepared under the stated policy. Management uses estimates and the CEO approves assumptions concerning the outlook.",
      "Note 1 - Accounting policies\nManagement review\nIncome statement\nThe assumptions apply consistently to each period.",
      "Styrets erklæring\nEksempel Navn\nKonsernsjef\nVi bekrefter at halvårsregnskapet gir et rettvisende bilde av konsernets stilling."
    ]);
    expect(context.selectedPages.map(page => page.pageNumber)).toEqual([1]);
    expect(context.text).not.toContain("CEO approves");
  });

  it("recognises split statement and management headings without matching contents entries", () => {
    const context = buildReportContextFromPages([
      "Contents\nManagement report 2\nIncome statement 3",
      `Financial\nresults\n${prose}`,
      table.replace("Consolidated income statement", "Consolidated statement of\ncomprehensive income")
    ]);
    expect(context.selectedPages.map(page => page.pageNumber)).toEqual([2, 3]);
    expect(context.diagnostics.incomeStatementFound).toBe(true);
  });

  it.each(["\n", " "])("preserves long conventional statement headings with an explicit reporting period (%j)", separator => {
    const context = buildReportContextFromPages([
      table.replace("Consolidated income statement", `Condensed consolidated statement of profit or loss and other comprehensive income${separator}for the six months ended 30 June 2026 (unaudited)`),
      "Income statement for the period ended June 2026 is prepared using management estimates."
    ]);
    expect(context.diagnostics.incomeStatementFound).toBe(true);
    expect(context.selectedPages.map(page => page.pageNumber)).toEqual([1]);
    expect(context.selectedPages[0].reasons).toContain("income_statement");
  });

  it("keeps the four-page narrative limit, prioritises results, and records the omitted context", () => {
    const context = buildReportContextFromPages([
      table,
      ...Array.from({ length: 5 }, (_, index) => `Management report\nSection ${index}. ${prose}`),
      `Financial results\nThe financial result changed because a prior-year disposal gain was absent. ${prose}`
    ]);
    const narrative = context.selectedPages.filter(page => page.reasons.includes("ceo_or_management"));
    expect(narrative).toHaveLength(4);
    expect(narrative.some(page => page.pageNumber === 7)).toBe(true);
    expect(context.diagnostics.completenessReasons).toContain("management_context_selection_budget");
    expect(context.diagnostics.completeness).toBe("partial");
  });

  it("preserves explicit user page requests even for excluded accounting notes", () => {
    const context = buildReportContextFromPages([
      table,
      "Image page",
      "Note 1 - Accounting principles\nThe company changed its policy during the quarter."
    ], "Include page 3");
    expect(context.selectedPages.find(page => page.pageNumber === 3)?.reasons).toContain("user_page");
    expect(context.referenceText).toContain("The company changed its policy");
  });
});
