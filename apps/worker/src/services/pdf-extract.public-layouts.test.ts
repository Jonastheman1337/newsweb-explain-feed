import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildReportContextFromPages, renderPdfTextItems, reportNeedsOpenAIPdfFallback, type PdfTextItem } from "./pdf-extract.js";

type Excerpt = { pages: Array<{ pageNumber: number; text: string }>; geometry: Array<{ pageNumber: number; items: PdfTextItem[] }> };
const source = JSON.parse(readFileSync(new URL("../fixtures/reports/public-layout-regressions-2026-09-05.json", import.meta.url), "utf8")) as { documents: Record<string, Excerpt> };
const pagesFor = (document: Excerpt) => Array.from({ length: Math.max(...document.pages.map(page => page.pageNumber)) }, (_, index) => document.pages.find(page => page.pageNumber === index + 1)?.text ?? "");
const factsFor = (document: Excerpt) => buildReportContextFromPages(pagesFor(document)).financialFacts!;
const basic = (rows: string[], extra = "") => buildReportContextFromPages([
  ["Consolidated income statement", "NOK thousands", "Q2 2026\tQ2 2025", ...rows, extra].join("\n")
]);

describe("original public PDF geometry", () => {
  it("preserves Ocean's wide whitespace cells as boundaries, without splitting grouped digits", () => {
    const text = renderPdfTextItems(source.documents.ocean.geometry[0].items);
    expect(text).toBe("Revenues\t93 106 459\t106 820 627\t204 853 000");
    const facts = factsFor(source.documents.ocean).filter(fact => fact.label === "Revenues");
    expect(facts.map(fact => fact.numericValue)).toEqual([93106459, 106820627, 204853000]);
    expect(facts.every(fact => fact.usable && fact.currency === "NOK" && fact.scale === "units")).toBe(true);
    expect(facts.map(fact => fact.period?.id)).toEqual(["2026-H1", "2025-H1", "2025-FY"]);
  });

  it("joins adjacent glyph fragments without changing their characters or real word gaps", () => {
    expect(renderPdfTextItems(source.documents.sfe.geometry[0].items)).toBe("Styret si melding");
    expect(renderPdfTextItems(source.documents.sfe.geometry[1].items)).toBe("Resultatrekneskap");
    const items = [{ str: "A", width: 6, transform: [10, 0, 0, 10, 0, 100] }, { str: "\uE132", width: 6, transform: [10, 0, 0, 10, 6, 100] }];
    expect(renderPdfTextItems(items)).toBe("A\uE132");
  });

  it("recovers Frontline's uniquely aligned three-quarter/two-half-year spans", () => {
    const header = renderPdfTextItems(source.documents.frontline.geometry[0].items);
    expect(header).toContain("Three months ended\t\t\tSix months ended\t\t\n");
    const facts = factsFor(source.documents.frontline);
    const revenue = facts.filter(fact => fact.label === "Revenues");
    expect(revenue.map(fact => fact.period?.id)).toEqual(["2026-Q2", "2026-Q1", "2025-Q2", "2026-H1", "2025-H1"]);
    expect(revenue.map(fact => fact.numericValue)).toEqual([943299, 714242, 480077, 1657541, 907943]);
    expect(revenue.every(fact => fact.usable && fact.currency === "$" && fact.scale === "thousands")).toBe(true);
    expect(facts.some(fact => fact.currency === "USD")).toBe(false);
    expect(revenue[0].comparisonPeriodId).toBe("2025-Q2");
    expect(revenue[1].comparisonPeriodId).toBeNull();
    expect(revenue[3].comparisonPeriodId).toBe("2025-H1");
    expect(facts.some(fact => fact.metric === "operating_result")).toBe(false);
    expect(source.documents.frontline.pages[0].text).toContain("Net operating income\t671,501");
    expect(facts.find(fact => fact.metric === "earnings_before_tax" && fact.period?.id === "2026-Q2")?.numericValue).toBe(659726);
  });

  it("does not infer group widths from flattened words, ambiguous geometry or a distant date row", () => {
    const original = source.documents.frontline.pages[0].text;
    const flattened = original.replace("Three months ended\t\t\tSix months ended\t\t", "Three months ended\tSix months ended");
    expect(factsFor({ pages: [{ pageNumber: 1, text: flattened }], geometry: [] }).every(fact => !fact.usable && fact.period === null)).toBe(true);
    const cell = (str: string, x: number, y: number) => ({ str, width: 10, transform: [10, 0, 0, 10, x, y] });
    const ambiguous = [cell("Three months ended", 10, 100), cell("Six months ended", 12, 100), cell("Jun 30, 2026", 10, 80), cell("Mar 31, 2026", 11, 80), cell("Jun 30, 2025", 12, 80)];
    expect(renderPdfTextItems(ambiguous)).not.toContain("\t\t");
    const distant = source.documents.frontline.geometry[0].items.map(item => /^(?:Jun|Mar) /.test(item.str) ? { ...item, transform: item.transform.map((n, i) => i === 5 ? n - 100 : n) } : item);
    expect(renderPdfTextItems(distant)).not.toContain("Three months ended\t\t\t");
  });
});

describe("explicit table captions and locale evidence", () => {
  it("recovers Byggma's stacked IFRS headers and physical note cells while leaving its bare year unresolved", () => {
    const facts = factsFor(source.documents.byggma);
    const sales = facts.filter(fact => fact.label === "Salgsinntekter");
    expect(sales.map(fact => fact.rawValue)).toEqual(["600,3", "592,4", "1 252,8", "1 228,4", "2 349,0"]);
    expect(sales.map(fact => fact.period?.id)).toEqual(["2026-Q2", "2025-Q2", "2026-H1", "2025-H1", "2025-unspecified"]);
    expect(sales.slice(0, 4).every(fact => fact.usable && fact.tableScope === "consolidated")).toBe(true);
    expect(sales[4].unresolved).toEqual(["period_unresolved"]);
    expect(sales[0].headerText).toContain("[PDF page 32] Noter konsern");
    expect(facts.find(fact => fact.metric === "operating_result" && fact.period?.id === "2026-Q2")?.numericValue).toBe(8.7);
    expect(facts.find(fact => fact.metric === "earnings_before_tax" && fact.period?.id === "2026-Q2")?.numericValue).toBe(-47.7);
  });

  it.each(["unrelated prose", "gap", "parent table"])("does not cross %s to borrow a later consolidated scope", interruption => {
    const document = structuredClone(source.documents.byggma);
    document.pages[1].text = interruption === "gap" ? "" : interruption === "parent table" ? "Balanse\nMorselskapet" : "Chair's message\nThe group reports progress.";
    expect(factsFor(document).every(fact => !fact.usable && fact.tableScope === null)).toBe(true);
  });

  it("does not drop leading note-like digits without both an explicit Note header and physical cells", () => {
    const document = structuredClone(source.documents.byggma);
    document.pages[0].text = document.pages[0].text.replace("Salgsinntekter\t11\t", "Salgsinntekter 11 ").replace(/\t/g, " ");
    expect(factsFor(document).filter(fact => fact.label === "Salgsinntekter").every(fact => !fact.usable && fact.period === null)).toBe(true);
    const context = basic(["Revenue\t11\t1,234\t1,123", "Per share\t0.12\t0.11"]);
    expect(context.financialFacts!.every(fact => !fact.usable && fact.period === null)).toBe(true);
  });

  it("uses Circio's explicit thousands caption and decimal witness, excluding note references", () => {
    const facts = factsFor(source.documents.circio);
    const operating = facts.filter(fact => fact.metric === "operating_result" && fact.label === "Operating profit/ loss (-)");
    expect(operating.map(fact => fact.numericValue)).toEqual([-42361, -20374, -41051]);
    expect(operating.every(fact => fact.usable && fact.currency === "NOK" && fact.scale === "thousands" && fact.tableScope === "consolidated")).toBe(true);
    expect(operating[0].headerText).toContain("Basic and dilutive earnings/ loss (-) per share (figures in NOK)\t11\t-0.20\t-0.26\t-0.44");
    expect(facts.find(fact => fact.metric === "earnings_before_tax" && fact.period?.id === "2026-H1")?.numericValue).toBe(-41234);
  });

  it.each([
    [],
    ["Note reference\t5,6"],
    ["Per share\t0.12\t0.11", "Other operating expenses\t0,12\t0,11"],
    ["Balance sheet", "Asset price\t0.12\t0.11"]
  ].map(witness => ({ witness })))("keeps single separator plus three digits unresolved without one consistent same-table convention %#", ({ witness }) => {
    const facts = basic(["Revenue\t1,234\t1,123", ...witness]).financialFacts!;
    expect(facts.map(fact => fact.numericValue)).toEqual([null, null]);
    expect(facts.every(fact => !fact.usable && fact.unresolved.includes("ambiguous_number_separators"))).toBe(true);
  });

  it("does not borrow number format, units or grouped periods across a page or statement boundary", () => {
    const first = source.documents.frontline.pages[0].text;
    const context = buildReportContextFromPages([first, "Consolidated income statement\nRevenue\t1,234\t1,123"]);
    const nextPage = context.financialFacts!.filter(fact => fact.pageNumber === 2);
    // Use direct standalone context too: the bounded metric cap may prefer page 1.
    const standalone = basic(["Revenue\t1,234\t1,123"]).financialFacts!;
    expect([...nextPage, ...standalone].every(fact => !fact.usable && fact.numericValue === null)).toBe(true);
    const second = buildReportContextFromPages([first + "\nCash flow statement\nOperating profit\t100\t90"]);
    const last = second.financialFacts!.filter(fact => fact.rowText === "Operating profit\t100\t90");
    expect(last).toHaveLength(2);
    expect(last.every(fact => !fact.usable && fact.period === null && fact.currency === null && fact.tableScope === null)).toBe(true);
  });
});

describe("raw narrative when table glyphs are unusable", () => {
  it("retains SFE's complete raw narrative and damaged table without certifying implicit typed facts", () => {
    const context = buildReportContextFromPages(pagesFor(source.documents.sfe));
    const facts = context.financialFacts!.filter(fact => fact.usable);
    expect(facts).toHaveLength(0);
    expect(context.referenceText).toContain("løfta driftsresultatet frå 326 mill. kr i fjor til 948 mill. kr.");
    expect(context.referenceText).toContain("  ");
    expect(context.diagnostics.completeness).toBe("insufficient");
    expect(context.diagnostics.completenessReasons).toContain("unmapped_pdf_glyphs");
    // The fixture is deliberately excerpted; the real report exceeds the text minimum.
    expect(reportNeedsOpenAIPdfFallback({ ...context, diagnostics: { ...context.diagnostics, totalExtractedChars: 5000 } })).toBe(true);
  });

  it.each([
    (text: string) => text.replace("løfta driftsresultatet", "kan løfta driftsresultatet"),
    (text: string) => text.replace("326 mill. kr", "36 mill. kr"),
    (text: string) => text.replace("første halvår 2025", "sist år"),
    (text: string) => text.replace(/konsernet/g, "selskapet")
  ])("does not turn forecasts, damaged figures or missing period/scope evidence into typed facts %#", mutate => {
    const text = mutate(source.documents.sfe.pages[0].text);
    expect(buildReportContextFromPages([text]).financialFacts!.filter(fact => fact.usable)).toEqual([]);
  });

  it("does not borrow another page's reporting period or group scope for narrative facts", () => {
    const [prefix, suffix] = source.documents.sfe.pages[0].text.split("kraftproduksjonen og ");
    expect(buildReportContextFromPages([prefix, suffix]).financialFacts!.filter(fact => fact.usable)).toEqual([]);
  });

  it("keeps Ocean's management warning beside its EBIT table without promoting EBITDA", () => {
    const context = buildReportContextFromPages(pagesFor(source.documents.ocean));
    expect(context.selectedPages.find(page => page.pageNumber === 4)?.reasons).toContain("ceo_or_management");
    expect(context.text).toContain("the last employees of Captured left on 31 August");
    expect(context.text).toContain("liquidity at Energi Teknikk is currently strained");
    expect(context.referenceText).toContain("pilot plant has been dismantled and transported to storage");
    const operating = context.financialFacts!.filter(fact => fact.metric === "operating_result");
    expect(operating.map(fact => fact.numericValue)).toEqual([-33023385, -35423680, -141604000]);
    expect(operating.every(fact => !fact.label.includes("before depreciation"))).toBe(true);
  });
});
