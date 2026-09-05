import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  requireYearlyRemunerationSource,
  selectYearlyRemunerationPages,
  type YearlyRawPage
} from "./yearly-remuneration.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/reports/servatur-remuneration-raw-2026-09-05.json", import.meta.url), "utf8")) as {
  sourceSha256: string; pageCount: number; pages: YearlyRawPage[];
};
const select = (...texts: string[]) => selectYearlyRemunerationPages(texts.map((text, i) => ({ pageNumber: i + 1, text })));
const padding = "The company prepares its annual financial statements for the reporting year.";
const pay = "Consolidated financial statements\nExecutive remuneration\nEUR million\n2026 CEO Board members\nBase salary\t1.2\t0.1\nTotal remuneration\t1.3\t0.1";

describe("annual raw remuneration selection", () => {
  it("retains the frozen group table, fiscal basis and units as unaltered physical pages", () => {
    expect(fixture.sourceSha256).toBe("bf99c732a854844d4a34ac0b85e992ffb707e3b89d38a1d7de6aa48511d13121");
    const before = JSON.stringify(fixture.pages);
    const result = selectYearlyRemunerationPages(fixture.pages, fixture.pageCount);
    expect(result.status).toBe("available");
    expect(result.diagnostics.disclosurePages).toContain(32);
    expect(result.selectedPages.map(page => page.pageNumber)).toEqual(expect.arrayContaining([1, 27, 31, 32]));
    for (const number of [27, 31, 32]) {
      const raw = fixture.pages.find(page => page.pageNumber === number)!;
      expect(result.remunerationText).toContain(`[PDF page ${number}]\n${raw.text}`);
    }
    expect(result.remunerationText).toContain("Total employee benefit expense\t0.2\t0.1\t49.9\t50.2");
    expect(result.remunerationText).toContain("Total employee benefit expense\t0.3\t0.1\t40.6\t41.0");
    expect(result.remunerationText).toContain("from 1 May to 30 April");
    expect(result.remunerationText).toContain("30 April 2026");
    expect(result.remunerationText).toContain("Due to rounding");
    expect(result.remunerationText).toContain("EUR million");
    expect(result.letterText).toBeNull();
    expect(JSON.stringify(fixture.pages)).toBe(before);
    // This fixture has explicit gaps; seeing its table cannot certify all 76 pages.
    expect(result.diagnostics.completeReadableScan).toBe(false);
  });

  it.each(["1.2", "1,2", "1 250 000", "1.250.000", "1,250,000", "0"])(
    "recognizes a monetary row with literal %s without converting it", amount => {
      const text = `Godtgjørelse til ledende ansatte\nAlle tall i tusen kroner\nDaglig leder\nGrunnlønn ${amount}\n${padding}`;
      const result = select(text);
      expect(result.status).toBe("available");
      expect(result.remunerationText).toBe(`[PDF page 1]\n${text}`);
    }
  );

  it.each([
    "CEO remuneration policy\nThe company reports amounts in EUR.\nBase salary may be increased by EUR 1.2 million under this policy.",
    "Salaries and remuneration\nEUR million\nOther employees\nBase salary 36.3\nTotal employee benefit expense 49.9",
    "Contents\nCEO remuneration ........... 35\nSalaries in EUR ........... 36\nTotal remuneration ........... 37",
    "CEO remuneration\nEUR million is used elsewhere in these financial statements.\nNumber of shares awarded\nShare-based compensation 1000\nTotal benefits 2000",
    "Executive remuneration\nEUR million\nCEO\nBonus 50 percent\nTotal remuneration 2026\nNumber of meetings 12",
    "Salaries and remuneration\nEUR million\nTotal salary 23.5\nCONTENTS | ABOUT & HIGHLIGHTS BOARD OF DIRECTORS' REPORT FINANCIAL INFORMATION"
  ])("does not select policy, employee-only, TOC or count material: %s", text => {
    const result = select(text);
    expect(result.status).toBe("no_disclosure_found");
    expect(result.remunerationText).toBeNull();
    expect(result.diagnostics.completeReadableScan).toBe(true);
  });

  it("preserves explicit parent nonpayment and its other-group-entities qualification for review", () => {
    const page = fixture.pages.find(item => item.pageNumber === 66)!;
    const result = selectYearlyRemunerationPages([page], 76);
    expect(result.status).toBe("available");
    expect(result.diagnostics.explicitNonpaymentPages).toEqual([66]);
    expect(result.remunerationText).toBe(`[PDF page 66]\n${page.text}`);
    expect(result.remunerationText).toContain("other Group entities");
    expect(result.remunerationText).toContain("separate financial statements");
  });

  it("does not supply group units or accounting basis from an intervening parent section", () => {
    const groupBasis = `Notes to the consolidated financial statements\nBasis of preparation\nAmounts are in EUR million for 2026.\n${padding}`;
    const parentBoundary = `Parent company financial statements\nAmounts in USD thousands.\n${padding}`;
    const noUnits = pay.replace("EUR million\n", "");
    const result = select(groupBasis, parentBoundary, noUnits);
    expect(result.status).toBe("unavailable");
    expect(result.diagnostics.unusableDisclosurePages).toEqual([3]);
    expect(result.diagnostics.disclosurePages).toEqual([]);
    expect(result.remunerationText).toBeNull();
  });

  it("keeps explicit group and parent disclosures on their own original pages", () => {
    const parent = `Separate financial statements\nKey management personnel\nNo remuneration is paid directly to members of the Board of Directors; costs are borne by other group entities.\n${padding}`;
    const result = select(pay, parent);
    expect(result.status).toBe("available");
    expect(result.remunerationText).toBe(`[PDF page 1]\n${pay}\n\n[PDF page 2]\n${parent}`);
    expect(result.diagnostics.explicitNonpaymentPages).toEqual([2]);
  });

  it("keeps a disclosed pay table without monetary basis unavailable instead of skipping it", () => {
    const result = select(pay.replace("EUR million\n", ""));
    expect(result.status).toBe("unavailable");
    expect(result.diagnostics.unusableDisclosurePages).toEqual([1]);
    expect(() => requireYearlyRemunerationSource(result)).toThrow("pay_rows_without_monetary_basis");
  });

  it.each(["", "scanned page", "CEO remuneration\nSalary EUR \uFFFD million\n" + padding,
    "CONTENTS | ABOUT THE COMPANY BOARD OF DIRECTORS REPORT FINANCIAL INFORMATION"])(
    "keeps missing or corrupted page text unavailable even beside a readable page", bad => {
      const result = select(padding, bad);
      expect(result.status).toBe("unavailable");
      expect(result.diagnostics.completeReadableScan).toBe(false);
      expect(result.diagnostics.unreadablePages).toContain(2);
      expect(() => requireYearlyRemunerationSource(result)).toThrow("YEARLY_REPORT_SOURCE_UNAVAILABLE");
    }
  );

  it("rejects missing, duplicate and invalid page identities", () => {
    for (const pages of [[], [{ pageNumber: 2, text: padding }], [{ pageNumber: 1, text: pay }, { pageNumber: 1, text: pay }], [{ pageNumber: 0, text: pay }]]) {
      const result = selectYearlyRemunerationPages(pages, 2);
      expect(result.status).toBe("unavailable");
      expect(result.diagnostics.completeReadableScan).toBe(false);
    }
    expect(() => requireYearlyRemunerationSource(null)).toThrow("YEARLY_REPORT_SOURCE_UNAVAILABLE");
  });

  it("never cuts a table or its basis to satisfy the context budget", () => {
    const result = select(pay + "\n" + padding.repeat(400));
    expect(result.status).toBe("unavailable");
    expect(result.remunerationText).toBeNull();
    expect(result.diagnostics.reasons).toContain("whole_page_context_exceeds_budget");
  });

  it("only allows a no-disclosure decision for a complete readable scan", () => {
    const result = select(padding, padding);
    expect(result.status).toBe("no_disclosure_found");
    expect(requireYearlyRemunerationSource(result)).toBe(result);
    expect(result.diagnostics.completeReadableScan).toBe(true);
    expect(result.remunerationText).toBeNull();
  });
});
