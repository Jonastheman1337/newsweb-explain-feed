import { describe, expect, it } from "vitest";
import { mergeReportPdfFallback } from "./report-pdf-fallback.js";
import type { ReportExtractionResult } from "./pdf-extract.js";

const raw = "Q2 2026. Revenue was NOK 120 million, compared with NOK 100 million in Q2 2025.";
const pdf = { attachmentId: 2, attachmentName: "report.pdf", pageCount: 10 };
const fallback = { context: "Revenue doubled to NOK 200 million.", sourceEvidence: [raw], limitations: [], confidence: "high" as const };
const existing: ReportExtractionResult = {
  ...pdf, text: raw, referenceText: raw, selectedPages: [], metrics: [], financialFacts: [],
  attachments: [{ ...pdf, extractedPageCount: 10, selectedPageNumbers: [2], relevanceScore: 5 }],
  diagnostics: { incomeStatementFound: false, fallbackUsed: true, requestedPageNumbers: [2], requestedTopicTerms: [],
    totalExtractedChars: raw.length, completeness: "insufficient", inspectedAttachmentIds: [2, 3], uninspectedAttachmentIds: [4] }
};
describe("PDF fallback provenance", () => {
  it("retains raw sources and attachment diagnostics, never treats the interpretation as source", () => {
    const result = mergeReportPdfFallback(pdf, fallback, existing);
    expect(result.text).toContain("200 million");
    expect(result.referenceText).toBe(raw);
    expect(result.referenceText).not.toContain("200 million");
    expect(result.attachments).toEqual(existing.attachments);
    expect(result.diagnostics.inspectedAttachmentIds).toEqual([2, 3]);
    expect(result.diagnostics.uninspectedAttachmentIds).toEqual([4]);
    expect(result.diagnostics.requestedPageNumbers).toEqual([2]);
    expect(result.diagnostics.completeness).toBe("partial");
  });
  it("does not promote a confident model summary with no original readable evidence", () => {
    const result = mergeReportPdfFallback(pdf, fallback);
    expect(result.referenceText).toBe("");
    expect(result.diagnostics.completeness).toBe("insufficient");
  });
  it("requires exact source excerpts and preserves existing limited readiness", () => {
    expect(mergeReportPdfFallback(pdf, { ...fallback, sourceEvidence: ["Revenue was NOK 200 million."] }, existing)
      .diagnostics.completeness).toBe("insufficient");
    expect(mergeReportPdfFallback(pdf, { ...fallback, confidence: "low" }, existing).diagnostics.completeness).toBe("insufficient");
    expect(mergeReportPdfFallback(pdf, fallback, { ...existing, diagnostics: { ...existing.diagnostics, completeness: "complete" } })
      .diagnostics.completeness).toBe("partial");
  });
});
