import { noticeEditorialExamples, type PromptPayload } from "@newsweb/prompt-kit";
import { rewriteOutputSchema } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import { findNoticeAttributionRisks } from "./notice-claim-precautions.js";
import { validateRewriteOutput } from "./rewrite-validation.js";

describe("notice prompts and publication validators agree", () => {
  it.each(Object.values(noticeEditorialExamples))("accepts the complete $id source/output example", (example) => {
    const payload: PromptPayload = {
      messageId: 900001,
      title: example.output.title,
      issuerName: "Fiktivt eksempelselskap",
      issuerSign: "TEST",
      publishedAt: "2026-09-04T10:00:00Z",
      categories: [],
      markets: [],
      bodyText: example.source,
      sourceBodyChars: example.source.length,
      hasAttachments: false
    };
    expect(rewriteOutputSchema.safeParse(example.output).success).toBe(true);
    const validation = validateRewriteOutput(example.output, payload);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(findNoticeAttributionRisks(example.output)).toEqual([]);
  });

  it("accepts omitted company context when unavailable or already conveyed", () => {
    const withoutCompanyContext = Object.values(noticeEditorialExamples).filter(example => example.output.company_sentence === "");
    expect(withoutCompanyContext.map(example => example.id)).toEqual(expect.arrayContaining(["financing", "remuneration", "routine"]));
    for (const example of withoutCompanyContext) {
      expect(rewriteOutputSchema.safeParse(example.output).success).toBe(true);
    }
  });
});
