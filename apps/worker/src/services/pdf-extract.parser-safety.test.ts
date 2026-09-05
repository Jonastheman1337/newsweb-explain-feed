import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildReportContextFromPages, reportNeedsOpenAIPdfFallback } from "./pdf-extract.js";

const intro = "Styret si melding\nKonsernet rapporterer for første halvår 2025 og første halvår 2026.\n";
const padding = "Dette avsnittet gir generell bakgrunn for rapporten. ".repeat(30);
const layout = JSON.parse(readFileSync(new URL("../fixtures/reports/public-layout-regressions-2026-09-05.json", import.meta.url), "utf8"));
const byggmaPages = () => Array.from({ length: 32 }, (_, index) => layout.documents.byggma.pages.find((page: { pageNumber: number }) => page.pageNumber === index + 1)?.text ?? "");

describe("independent parser safety probes", () => {
  it.each([
    "I andre kvartal løfta driftsresultatet frå 100 mill. kr i fjor til 200 mill. kr.",
    "Datterselskapet Alfa AS løfta driftsresultatet frå 100 mill. kr i fjor til 200 mill. kr.",
    "Ein dobling av kraftprisen ville ha løfta driftsresultatet frå 100 mill. kr i fjor til 200 mill. kr.",
    "Konsernet løfta driftsresultatet frå 100 mill. kr i fjor til 200 mill. kr."
  ])("keeps the full narrative assertion as raw evidence without borrowing typed ownership: %s", assertion => {
    const context = buildReportContextFromPages([intro + assertion + "\n" + padding]);
    expect(context.financialFacts!.filter(fact => fact.usable)).toEqual([]);
    expect(context.diagnostics.completeness).toBe("insufficient");
    expect(reportNeedsOpenAIPdfFallback(context)).toBe(true);
    expect(context.referenceText).toContain(assertion);
  });

  it.each(["Note references", "Revenue note references", "Footnotes", "Metadata"])("does not use %s as a financial number-format witness", label => {
    const context = buildReportContextFromPages([
      `Consolidated income statement\nNOK millions\nMonetary values are presented to three decimal places using a decimal point.\nQ2 2026\tQ2 2025\nRevenue\t1.234\t1.123\n${label}\t5,6\t6,7`
    ]);
    const revenue = context.financialFacts!.filter(fact => fact.label === "Revenue");
    expect(revenue.map(fact => fact.numericValue)).toEqual([null, null]);
    expect(revenue.every(fact => !fact.usable && fact.unresolved.includes("ambiguous_number_separators"))).toBe(true);
    expect(revenue.every(fact => !fact.headerText.some(line => line.startsWith(label)))).toBe(true);
  });

  it("does not override an explicit decimal convention with a contradictory financial row", () => {
    const context = buildReportContextFromPages([
      "Consolidated income statement\nNOK millions\nMonetary values use a decimal point.\nQ2 2026\tQ2 2025\nRevenue\t1.234\t1.123\nOperating expenses\t5,6\t6,7"
    ]);
    expect(context.financialFacts!.map(fact => fact.numericValue)).toEqual([null, null]);
  });

  it("uses the nearer explicit header after an older reconstructed grouped-month header", () => {
    const context = buildReportContextFromPages([
      "Consolidated income statement\nNOK thousands\nThree months ended\t\tSix months ended\t\t\nJun 30, 2026\tJun 30, 2025\tJun 30, 2026\tJun 30, 2025\nRevenue\t100\t90\t200\t180\nSelected full-year and half-year results\nH1 2025\tH1 2024\tFY 2025\tFY 2024\nOperating profit\t80\t70\t160\t140"
    ]);
    const revenue = context.financialFacts!.filter(fact => fact.metric === "revenue");
    const operating = context.financialFacts!.filter(fact => fact.metric === "operating_result");
    expect(revenue.map(fact => fact.period?.id)).toEqual(["2026-Q2", "2025-Q2", "2026-H1", "2025-H1"]);
    expect(operating.map(fact => fact.period?.id)).toEqual(["2025-H1", "2024-H1", "2025-FY", "2024-FY"]);
    expect(operating.every(fact => fact.usable)).toBe(true);
    expect(operating.every(fact => !fact.headerText.some(line => line.includes("months ended")))).toBe(true);
  });

  it("also lets a nearer explicit header supersede stacked IFRS columns", () => {
    const context = buildReportContextFromPages([
      "Consolidated income statement\nNOK millions\nIFRS\n2.kv. 2026\nIFRS\n2.kv. 2025\nRevenue\t100\t90\nH1 2025\tH1 2024\nOperating profit\t80\t70"
    ]);
    expect(context.financialFacts!.filter(fact => fact.metric === "operating_result").map(fact => fact.period?.id)).toEqual(["2025-H1", "2024-H1"]);
  });

  it("does not let a future group notes section certify a preceding parent continuation", () => {
    const context = buildReportContextFromPages([
      "Parent company financial statements\nThe income statement continues on the next page.",
      "Income statement\nNOK thousands\nQ2 2026\tQ2 2025\nRevenue\t100\t90",
      "Notes to the consolidated financial statements\nThe following notes relate to the group."
    ]);
    expect(context.financialFacts!.every(fact => !fact.usable && fact.tableScope === null)).toBe(true);
  });

  it("requires an explicit note reference with the same labelled amounts, units and periods", () => {
    const context = buildReportContextFromPages(byggmaPages());
    expect(context.financialFacts!.filter(fact => fact.usable)).toHaveLength(16);
    const current = context.financialFacts!.find(fact => fact.label === "Salgsinntekter" && fact.period?.id === "2026-Q2")!;
    expect(current.headerText).toContain("Netto finans (inntekt \"+\" - kostnad \"-\")\t3\t-22,6\t-24,8\t-44,2\t-49,5\t-96,3");
    expect(current.headerText).toContain("Note 3 Netto finans (NOK mill)");
  });

  const linkPage = "Income statement\nNOK thousands\nNote\nH1 2026\tH1 2025\nRevenue\t11\t100\t90\nNet finance\t3\t5\t4";
  const notePage = "Notes to the consolidated financial statements\nNote 3 Net finance\nNOK thousands\nH1 2026\tH1 2025\nNet finance\t5\t4";
  it("accepts a uniquely matching note row in the same local statement section", () => {
    const facts = buildReportContextFromPages([linkPage, notePage]).financialFacts!;
    expect(facts).toHaveLength(2);
    expect(facts.every(fact => fact.usable && fact.tableScope === "consolidated")).toBe(true);
  });

  it.each([
    "H1 2025\tH1 2024", "EUR thousands", "Parent company figures",
    "H1 2026\tH1 2025", "NOK thousands", "Consolidated figures", "Subsidiary figures", "Alfa AS", "Another business area"
  ])("does not borrow a note link across an intervening local section boundary: %s", caption => {
    const pages = [linkPage.replace("Net finance\t3", caption + "\nNet finance\t3"), notePage];
    const facts = buildReportContextFromPages(pages).financialFacts!.filter(fact => fact.label === "Revenue");
    expect(facts).toHaveLength(2);
    expect(facts.every(fact => !fact.usable && fact.tableScope === null)).toBe(true);
  });

  it.each(["missing link", "amount mismatch", "period mismatch", "currency mismatch", "parent continuation", "duplicate note", "duplicate matching row"])("rejects group-note ownership on %s", fault => {
    const pages = byggmaPages();
    if (fault === "missing link") pages[31] = "Noter konsern";
    if (fault === "amount mismatch") pages[31] = pages[31].replace("-22,6", "-22,7");
    if (fault === "period mismatch") pages[31] = pages[31].replace("2.kv. 2026", "1.kv. 2026");
    if (fault === "currency mismatch") pages[31] = pages[31].replace("NOK", "SEK");
    if (fault === "parent continuation") pages[26] = "Parent company financial statements\nContinued on the following page.";
    if (fault === "duplicate note") pages[31] += "\nNote 3 Netto finans (NOK mill)\nAdditional conflicting disclosure.";
    if (fault === "duplicate matching row") pages[31] += "\n" + pages[31].split("\n").find((line: string) => line.startsWith("Netto finans ("));
    expect(buildReportContextFromPages(pages).financialFacts!.every(fact => !fact.usable && fact.tableScope === null)).toBe(true);
  });

  it("keeps ordinary EBIT ahead of NOI/APMs and carries exact source labels into the aligned summary", () => {
    const context = buildReportContextFromPages([
      "Consolidated income statement\nEUR millions\nQ2 2026\tQ2 2025\nRental revenue\t100\t90\nNet operating income\t60\t55\nAdjusted operating profit\t50\t45\nOperating profit\t20\t15\nProfit before tax\t10\t8\nNet operating income is property rent less property costs and excludes central expenses and depreciation."
    ]);
    const operating = context.financialFacts!.filter(fact => fact.metric === "operating_result");
    expect(operating.map(fact => fact.numericValue)).toEqual([20, 15]);
    expect(operating.every(fact => fact.usable && fact.label === "Operating profit")).toBe(true);
    const aligned = context.text.split("KEY METRICS")[0];
    expect(aligned).toContain("operating_result (Operating profit): 20 EUR millions");
    expect(aligned).toContain("revenue (Rental revenue): 100 EUR millions");
    expect(aligned).not.toContain("operating_result (Net operating income)");
    expect(aligned).not.toContain("operating_result (Adjusted operating profit)");
    expect(context.referenceText).toContain("Net operating income\t60\t55");
    expect(context.referenceText).toContain("Adjusted operating profit\t50\t45");
  });
});
