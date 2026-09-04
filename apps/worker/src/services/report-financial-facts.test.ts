import { describe, expect, it } from "vitest";
import { buildReportContextFromPages } from "./pdf-extract.js";

// These compact table-layout regressions preserve the formats visually checked
// in public NewsWeb attachments 681201/332352 (page 5) and 681267/332291 (page 7).
const mixedHeader = "Note Q2 2026 Q2 2025 30.06.2026 30.06.2025 31.12.2025";
const carucelTable = [
  "Carucel Property AS", "925 988 413", "Consolidated Financial Statements Q2 2026",
  "(all amounts in NOK millions)", "INCOME STATEMENT", mixedHeader,
  "Sales revenue 33,9 30,1 56,1 50,4 117,2",
  "Total operating income 132,3 175,3 252,4 295,2 546,1",
  "Operating profit 22,0 107,1 40,8 131,5 177,3",
  "Profit before tax -67,6 40,5 -138,8 -21,6 -160,8"
];
const haugalandTable = [
  "HAUGALAND KRAFT-KONSERN", "DRIFTSINNTEKTER", "OG DRIFTSKOSTNADER",
  "01.01. - 30.06.2026\t01.01. - 30.06.2025 01.01. - 31.12.2025",
  "Salgsinntekter\t2 389 606\t2 142 010\t4 483 644",
  "Andre driftsinntekter\t93 153\t35 954\t70 206",
  "Sum driftsinntekter\t2 482 760\t2 177 965\t4 553 850",
  "DRIFTSRESULTAT\t1 347 063\t1 170 505\t2 254 910",
  "Resultat før skatt\t1 230 300\t1 022 321\t2 020 014",
  // PDF drawing order emits the visible title/unit above the table last.
  "RESULTATREGNSKAP", "(ALLE TALL NOK 1 000)", "HAUGALAND KRAFT HALVÅRSRAPPORT 2026 7", "Resultatregnskap"
];

describe("financial table layout recovery", () => {
  it("recovers explicitly named quarters while keeping adjacent bare-date periods unresolved", () => {
    const context = buildReportContextFromPages([carucelTable.join("\n")]);
    const sales = context.financialFacts!.filter(fact => fact.label === "Sales revenue");
    expect(sales.map(fact => fact.numericValue)).toEqual([33.9, 30.1, 56.1, 50.4, 117.2]);
    expect(sales.slice(0, 2).every(fact => fact.usable)).toBe(true);
    expect(sales[0]).toMatchObject({ currency: "NOK", scale: "millions", tableScope: "consolidated", period: { id: "2026-Q2" }, comparisonPeriodId: "2025-Q2" });
    expect(sales[0].headerText).toEqual(expect.arrayContaining(["Consolidated Financial Statements Q2 2026", "(all amounts in NOK millions)", mixedHeader]));
    expect(sales.slice(2).every(fact => !fact.usable && fact.period?.kind === "unspecified" && fact.comparisonPeriodId === null)).toBe(true);
    expect(sales[2].unresolved).toEqual(["period_unresolved"]);
    expect(context.diagnostics.completeness).toBe("partial");
  });

  it("retains total income and sales components under their exact separate labels", () => {
    const context = buildReportContextFromPages([carucelTable.join("\n")]);
    const current = context.financialFacts!.filter(fact => fact.metric === "revenue" && fact.period?.id === "2026-Q2");
    expect(current.map(({ label, numericValue }) => ({ label, numericValue }))).toEqual([
      { label: "Sales revenue", numericValue: 33.9 }, { label: "Total operating income", numericValue: 132.3 }
    ]);
  });

  it("uses explicit calendar ranges and an isolated reordered unit caption for the Norwegian income statement", () => {
    const context = buildReportContextFromPages([haugalandTable.join("\n")]);
    const sales = context.financialFacts!.filter(fact => fact.label === "Salgsinntekter");
    expect(sales.map(fact => fact.numericValue)).toEqual([2389606, 2142010, 4483644]);
    expect(sales.map(fact => fact.period?.id)).toEqual(["2026-H1", "2025-H1", "2025-FY"]);
    expect(sales[0]).toMatchObject({ usable: true, currency: "NOK", scale: "thousands", tableScope: "consolidated", comparisonPeriodId: "2025-H1" });
    expect(sales[0].headerText).toContain("(ALLE TALL NOK 1 000)");
    expect(context.financialFacts!.every(fact => fact.usable)).toBe(true);
    const currentRevenue = context.financialFacts!.filter(fact => fact.metric === "revenue" && fact.period?.id === "2026-H1");
    expect(currentRevenue.map(fact => fact.label)).toEqual(["Salgsinntekter", "Sum driftsinntekter"]);
    expect(currentRevenue[1].numericValue).toBe(2482760);
    expect(context.metrics.filter(metric => metric.metric === "revenue")).toHaveLength(2);
  });

  it("keeps the same table header for bottom rows beyond the old fixed search windows", () => {
    const context = buildReportContextFromPages([
      [...carucelTable.slice(0, 8), ...Array.from({ length: 30 }, (_, index) => `Expense item ${index + 1} 1,0 1,0 1,0 1,0 1,0`), carucelTable[9]].join("\n")
    ]);
    const profit = context.financialFacts!.find(fact => fact.metric === "earnings_before_tax" && fact.period?.id === "2026-Q2");
    expect(profit).toMatchObject({ usable: true, numericValue: -67.6, currency: "NOK", scale: "millions", tableScope: "consolidated" });
  });

  it.each([
    "30.06.2026 30.06.2025",
    "01.01.2025 - 30.06.2026\t01.01.2024 - 30.06.2025",
    "Revenue between 01.01. - 30.06.2026 and 01.01. - 30.06.2025"
  ])("does not invent period types from ambiguous date headers: %s", header => {
    const context = buildReportContextFromPages([["Consolidated income statement", "NOK million", header, "Revenue 100 90"].join("\n")]);
    expect(context.financialFacts!.every(fact => !fact.usable && fact.unresolved.includes("period_unresolved"))).toBe(true);
  });

  it("rejects invalid calendar ranges without shifting remaining columns", () => {
    const context = buildReportContextFromPages([["Consolidated income statement", "NOK million", "01.01. - 31.02.2026\t01.01. - 30.06.2025", "Revenue 100 90"].join("\n")]);
    expect(context.financialFacts!.every(fact => fact.period === null && !fact.usable)).toBe(true);
  });

  it.each([
    ["Balance sheet", "NOK million"],
    ["Parent company", "Q2 2026 Q2 2025", "Revenue 10 9"],
    ["NOK million"]
  ].map(extra => ({ extra })))("does not borrow a trailing caption when another table or data makes ownership ambiguous %#", ({ extra }) => {
    const page = [...haugalandTable.slice(0, -4), ...extra, ...haugalandTable.slice(-4)];
    const context = buildReportContextFromPages([page.join("\n")]);
    expect(context.financialFacts!.filter(fact => fact.label === "Salgsinntekter").every(fact => !fact.usable && fact.currency === null)).toBe(true);
  });

  it("does not assign a reordered caption if more numeric table rows follow it", () => {
    const page = [...haugalandTable.slice(0, -2), "Revenue 10 9", ...haugalandTable.slice(-2)];
    const context = buildReportContextFromPages([page.join("\n")]);
    expect(context.financialFacts!.filter(fact => fact.label === "Salgsinntekter").every(fact => !fact.usable && fact.currency === null)).toBe(true);
  });
});
