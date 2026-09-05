import { describe, expect, it } from "vitest";
import { evaluateTriageClasses } from "./newsworthiness-triage.js";
import type { NoticePayload } from "./notice-evidence.js";
import { deferUnavailableReportSkip } from "./notice-triage.js";

const report: NoticePayload = {
  messageId: 990601, title: "Interim report 2026", issuerName: "Example Group", issuerSign: "EXAMPLE",
  publishedAt: "2026-09-01T08:00:00Z", categories: [], markets: [], hasAttachments: true,
  bodyText: "The interim report is available in the attachment.", sourceBodyChars: 51
};
const evaluate = (payload: NoticePayload) => evaluateTriageClasses(payload.title,
  [payload.bodyText, payload.pdfSupplementText ?? ""].join("\n\n"), payload.categories,
  payload.hasAttachments, payload.issuerName, payload.bodyText).enabledSkip;

describe("report triage after source acquisition", () => {
  it("defers an attachment-only report's routine verdict when the attachment is unavailable", () => {
    const skip = evaluate(report);
    expect(skip?.classId).toBe("document-only");
    expect(deferUnavailableReportSkip(report, skip)).toBe(true);
  });

  it("lets substantive extracted report text inform the existing triage", () => {
    const available = { ...report, pdfSupplementText: "Operating revenue rose to EUR 47 million and the company announced a dividend." };
    const skip = evaluate(available);
    expect(skip).toBeNull();
    expect(deferUnavailableReportSkip(available, skip)).toBe(false);
  });

  it("keeps document triage for non-report documents and notices without attachments", () => {
    const prospectus = { ...report, title: "Prospectus publication", bodyText: "The prospectus is available in the attachment." };
    expect(evaluate(prospectus)?.classId).toBe("document-only");
    expect(deferUnavailableReportSkip(prospectus, evaluate(prospectus))).toBe(false);
    const textOnly = { ...report, hasAttachments: false };
    expect(deferUnavailableReportSkip(textOnly, evaluate(textOnly))).toBe(false);
  });
});
