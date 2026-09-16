import { describe, it, expect } from "vitest";
import { isIncomeStatementPage, selectPdfSourcePages, packPdfSourcePages } from "./pdf-source-pages.js";
const statement = "Unaudited condensed\nconsolidated interim\nstatement\nof profit or loss\n(in thousands of USD)\n2026 2025\nRevenue 1,223,573 622,852\nProfit for the period 733,214 32,789";
describe("PDF source pages", () => {
 it("retains a late statement, its units and continuation before trimming", () => {
   const pages = ["Background ".repeat(4000), statement, "Attributable to:\nBasic earnings per share 2.53 0.27"];
   const indexes = selectPdfSourcePages(pages, "Use the report I attached and focus on profit/loss statement. That is what is new.");
   expect(indexes.slice(0,2)).toEqual([1,2]);
   const text = packPdfSourcePages(pages,indexes,1500);
   expect(text.length).toBeLessThanOrEqual(1500);
   expect(text).toContain("[PDF page 2]"); expect(text).toContain("733,214"); expect(text).toContain("2.53");
 });
 it("does not mistake contents or prose for the statement", () => {
   expect(isIncomeStatementPage("Table of contents\n"+statement)).toBe(false);
   expect(isIncomeStatementPage("Our income statement explains the revenue figures 100 90")).toBe(false);
 });
 it("finds a requested nonfinancial page without predicting the filename", () => {
   const pages = ["Other ".repeat(4000), "Construction progress at Sarpsborg: the datacenter opens in May."];
   expect(selectPdfSourcePages(pages,"Explain construction progress at the datacenter in Sarpsborg")[0]).toBe(1);
 });
});
