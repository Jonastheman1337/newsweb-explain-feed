import { isYearlyReportCategory, shouldSkipRewrite } from "@newsweb/shared";
import { describe, expect, it } from "vitest";

describe("annual notice attachment routing", () => {
  it.each([
    "ÅRSRAPPORTER OG REVISJONSBERETNINGER",
    "ÅRSRAPPORT",
    "ANNUAL FINANCIAL REPORT"
  ])("routes the annual category %s to remuneration assessment", category => {
    expect(shouldSkipRewrite([category])).toBe(false);
    expect(isYearlyReportCategory([category])).toBe(true);
    expect(isYearlyReportCategory(["ANNEN INFORMASJONSPLIKTIG REGULATORISK INFORMASJON", category])).toBe(true);
  });

  it.each([[], ["ÅRSRESULTATER"], ["HALVÅRSRAPPORT"], ["EKS.DATO"], ["PRESENTASJON"]].map(categories => ({ categories })))(
    "does not reroute other categories $categories", ({ categories }) => {
      expect(isYearlyReportCategory(categories)).toBe(false);
    }
  );
});
