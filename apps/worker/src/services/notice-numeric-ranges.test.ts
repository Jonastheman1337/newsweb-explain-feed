import { readFileSync } from "node:fs";
import { assessNumbersInText } from "@newsweb/prompt-kit";
import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import { normalizeNoticeNumericRanges } from "./notice-numeric-ranges.js";
import { validateRewriteOutput } from "./rewrite-validation.js";

const unexpected = (draft: string, source: string) => assessNumbersInText(
  normalizeNoticeNumericRanges(draft), normalizeNoticeNumericRanges(source)
).filter(item => item.disposition === "unexpected").map(item => item.display);
const payload: PromptPayload = { messageId: 990100, issuerName: "Eksempel ASA", issuerSign: "TEST", title: "Finansieringsbehov",
  bodyText: "The company requires USD 10-15 million of liquidity.", sourceBodyChars: 50, publishedAt: "2026-09-04T08:00:00Z", categories: [], markets: [], hasAttachments: false };
const draft: RewriteOutput = { title: "Selskapet oppgir finansieringsbehov", lead: "Selskapet trenger 10–15 millioner dollar.", body: [],
  company_sentence: "", key_facts: [], negative_or_surprising: [], excluded_hype: [], source_limitations: [], source_spans: [], confidence: "high", importance: "medium" };
const frozenNumericCorpus = JSON.parse(readFileSync(
  new URL("../fixtures/editorial-eval/safety/numeric-unresolved.json", import.meta.url), "utf8"
)) as { cases: Array<{ messageId: number; storedOutput: RewriteOutput; sourcePayload: PromptPayload }> };

describe("notice-only range comparisons", () => {
  it.each(["10-15", "10–15", "10—15", "10 - 15"])("matches equivalent unsigned range typography %s", range => {
    expect(unexpected(`${range} millioner dollar`, "USD 10-15 million")).toEqual([]);
    expect(unexpected("10–15 millioner dollar", `USD ${range} million`)).toEqual([]);
  });
  it("is opt-in and never changes source or article bytes", () => {
    const before = JSON.stringify({ payload, draft });
    expect(validateRewriteOutput(draft, payload).publicationNumberAssessments).toContainEqual(expect.objectContaining({ display: "15", disposition: "unexpected" }));
    expect(validateRewriteOutput(draft, payload, { noticeSemantics: true }).publicationNumberAssessments.every(item => item.disposition !== "unexpected")).toBe(true);
    expect(JSON.stringify({ payload, draft })).toBe(before);
  });
  it.each(["-15", "−15", "− 15"])("preserves a genuine negative sign in %s", amount => {
    expect(unexpected("15 millioner dollar", `USD ${amount} million`)).toContain("15");
    expect(unexpected("-15 millioner dollar", `USD ${amount} million`)).toEqual([]);
  });
  it("preserves signed range endpoints, changed endpoints and decimal magnitude", () => {
    expect(unexpected("10–15 millioner dollar", "USD 10–-15 million")).toContain("15");
    expect(unexpected("10–15 millioner dollar", "USD -10–-15 million")).toEqual(["10", "15"]);
    expect(unexpected("10–16 millioner dollar", "USD 10-15 million")).toContain("16");
    expect(unexpected("1,5–2,5 millioner dollar", "USD 1.5-2.5 million")).toEqual([]);
    expect(unexpected("15–25 millioner dollar", "USD 1.5-2.5 million")).toEqual(["15", "25"]);
  });
  it("does not reinterpret subtraction, explicit minus operators or separated rows as positive ranges", () => {
    for (const source of ["USD 10-15 = -5 million", "USD 10-15 million equals -5 million", "USD 10−15 million", "USD 10\n-15 million"]) {
      expect(unexpected("15 millioner dollar", source)).toContain("15");
    }
    expect(normalizeNoticeNumericRanges("10-15")).toBe("10-15");
    expect(normalizeNoticeNumericRanges("10-15 = -5")).toBe("10-15 = -5");
  });
  it("rejects inequalities and preceding equation lines from the independent adversarial review", () => {
    for (const [source, articleNumber] of [
      ["Cash adjustment: USD 40-15 ≥ 20 million.", "15"],
      ["Net cash =\nUSD 64-21 million", "21"],
      ["Net cash =\nUSD 10-15 million", "15"],
      ["Cash adjustment: USD 10-15 ≤ 20 million.", "15"],
      ["USD 64-21 million", "21"]
    ]) {
      expect(normalizeNoticeNumericRanges(source!), source).toBe(source);
      expect(unexpected(`${articleNumber} millioner dollar`, source!)).toContain(articleNumber);
    }
    expect(unexpected("10–15 millioner dollar", "Liquidity requirement:\nUSD 10-15 million")).toEqual([]);
  });
  it("does not allow prior-only title amounts through the opt-in", () => {
    const source = { ...payload, bodyText: "Dialogen om finansiering fortsetter.", relatedNotices: [{
      messageId: 990099, issuerName: "Eksempel ASA", issuerSign: "TEST", title: "Tidligere behov", text: payload.bodyText,
      textChars: payload.bodyText.length, publishedAt: "2026-08-07T08:00:00Z", relation: "reference" as const, resolvedBy: "newsweb" as const, score: 1
    }] };
    const result = validateRewriteOutput({ ...draft, title: "Selskapet trenger 10–15 millioner dollar" }, source, { noticeSemantics: true });
    expect(result.issues.some(issue => issue.code === "SECONDARY_ONLY_TITLE_NUMBER")).toBe(true);
  });
  it("accepts a complete trusted source date without lending its day to an unrelated amount", () => {
    const source = { ...payload, relatedNotices: [{
      messageId: 990099, issuerName: "Eksempel ASA", issuerSign: "TEST", title: "Tidligere behov", text: payload.bodyText,
      textChars: payload.bodyText.length, publishedAt: "2026-06-17T08:00:00Z", relation: "reference" as const, resolvedBy: "newsweb" as const, score: 1
    }] };
    const datedDraft = { ...draft, body: ["17. juni 2026 oppga selskapet et finansieringsbehov."] };
    const before = JSON.stringify({ source, datedDraft });
    const exact = validateRewriteOutput(datedDraft, source, { noticeSemantics: true });
    expect(exact.publicationNumberAssessments.filter(item => item.disposition === "unexpected")).toEqual([]);
    expect(exact.publicationNumberAssessments).toContainEqual(expect.objectContaining({ display: "17", disposition: "matched",
      provenance: expect.objectContaining({ sourceId: "prior_990099", sourceDate: "17. juni 2026" }) }));
    const fabricatedAmount = validateRewriteOutput({ ...datedDraft, body: [...datedDraft.body, "Behovet er 17 millioner dollar."] }, source, { noticeSemantics: true });
    expect(fabricatedAmount.publicationNumberAssessments).toContainEqual(expect.objectContaining({ display: "17", disposition: "unexpected" }));
    expect(JSON.stringify({ source, datedDraft })).toBe(before);
  });
  it("uses the Oslo calendar date and does not accept a wrong or partial date", () => {
    const source = { ...payload, relatedNotices: [{
      messageId: 990099, issuerName: "Eksempel ASA", issuerSign: "TEST", title: "Tidligere behov", text: payload.bodyText,
      textChars: payload.bodyText.length, publishedAt: "2026-08-06T22:30:00Z", relation: "reference" as const, resolvedBy: "newsweb" as const, score: 1
    }] };
    const exact = validateRewriteOutput({ ...draft, body: ["7. august 2026 oppga selskapet behovet."] }, source, { noticeSemantics: true });
    expect(exact.publicationNumberAssessments.filter(item => item.disposition === "unexpected")).toEqual([]);
    for (const date of ["6. august 2026", "7. juli 2026", "7. august 2025", "17. august 2026", "7. august"]) {
      const wrong = validateRewriteOutput({ ...draft, body: [`${date} oppga selskapet behovet.`] }, source, { noticeSemantics: true });
      expect(wrong.issues.some(issue => issue.code === "UNEXPECTED_NUMBERS"), date).toBe(true);
    }
  });
  it("never obtains numeric date support from invalid or future related timestamps", () => {
    for (const publishedAt of ["not-a-date", "2026-10-17T08:00:00Z"]) {
      const source = { ...payload, relatedNotices: [{
        messageId: 990099, issuerName: "Eksempel ASA", issuerSign: "TEST", title: "Tidligere behov", text: payload.bodyText,
        textChars: payload.bodyText.length, publishedAt, relation: "reference" as const, resolvedBy: "newsweb" as const, score: 1
      }] };
      const result = validateRewriteOutput({ ...draft, body: ["17. oktober 2026 oppga selskapet behovet."] }, source, { noticeSemantics: true });
      expect(result.publicationNumberAssessments).toContainEqual(expect.objectContaining({ display: "17", disposition: "unexpected" }));
    }
  });
  it("keeps exact prior-only title dates separate from the primary source date", () => {
    const source = { ...payload, relatedNotices: [{
      messageId: 990099, issuerName: "Eksempel ASA", issuerSign: "TEST", title: "Tidligere behov", text: payload.bodyText,
      textChars: payload.bodyText.length, publishedAt: "2026-06-17T08:00:00Z", relation: "reference" as const, resolvedBy: "newsweb" as const, score: 1
    }] };
    const priorTitle = validateRewriteOutput({ ...draft, title: "Behovet fra 17. juni 2026" }, source, { noticeSemantics: true });
    expect(priorTitle.issues.some(issue => issue.code === "SECONDARY_ONLY_TITLE_NUMBER")).toBe(true);
    const primaryTitle = validateRewriteOutput({ ...draft, title: "Behovet fra 4. september 2026" }, source, { noticeSemantics: true });
    expect(primaryTitle.issues.some(issue => ["UNEXPECTED_NUMBERS", "SECONDARY_ONLY_TITLE_NUMBER"].includes(issue.code))).toBe(false);
    const legacy = validateRewriteOutput({ ...draft, title: "Behovet fra 4. september 2026" }, source);
    expect(legacy.publicationNumberAssessments).toContainEqual(expect.objectContaining({ display: "4", disposition: "unexpected" }));
  });
  it("never assembles a trusted source date across visible fields or paragraph breaks", () => {
    const source = { ...payload, publishedAt: "2028-08-18T10:04:00Z", bodyText: "The cost was EUR 47 million.", relatedNotices: [{
      messageId: 990099, issuerName: "Eksempel ASA", issuerSign: "TEST", title: "Earlier cost", text: "The cost was EUR 47 million.",
      textChars: 28, publishedAt: "2028-04-26T08:00:00Z", relation: "reference" as const, resolvedBy: "newsweb" as const, score: 1
    }] };
    const sourceDraft = { ...draft, title: "Selskapet oppgir en endring", lead: "Selskapet oppgir en endring.", body: [] as string[] };
    const complete = validateRewriteOutput({ ...sourceDraft, body: ["26. april 2028 oppga selskapet kostnaden."] }, source, { noticeSemantics: true });
    expect(complete.publicationNumberAssessments.filter(item => item.disposition === "unexpected")).toEqual([]);
    const paragraph = "april 2028 var måneden for omleggingen.";
    for (const article of [
      { ...sourceDraft, body: ["Kostnaden ble 26.", paragraph] },
      { ...sourceDraft, lead: "Kostnaden ble 26.", body: [paragraph] },
      { ...sourceDraft, title: "Kostnaden ble 26.", lead: paragraph },
      { ...sourceDraft, body: [`Kostnaden ble 26.\n${paragraph}`] },
      { ...sourceDraft, body: [`Kostnaden ble 26.\n\n${paragraph}`] }
    ]) {
      const before = JSON.stringify({ source, article });
      const result = validateRewriteOutput(article, source, { noticeSemantics: true });
      expect(result.publicationNumberAssessments).toContainEqual(expect.objectContaining({ display: "26", disposition: "unexpected" }));
      expect(result.publicationNumberAssessments.some(item => item.provenance?.sourceDate === "26. april 2028")).toBe(false);
      expect(JSON.stringify({ source, article })).toBe(before);
    }
  });
  it("requires a nonempty frozen numeric corpus", () => {
    expect(frozenNumericCorpus.cases.length).toBeGreaterThan(0);
  });
  // Large report sources are assessed twice. Give each immutable replay its
  // own deadline with room for the full suite's parallel CPU contention.
  it.each(frozenNumericCorpus.cases)(
    "keeps frozen numeric case $messageId blocked except its explicit source-backed range correction", item => {
      const result = validateRewriteOutput(item.storedOutput, item.sourcePayload, { noticeSemantics: true });
      if (item.messageId === 676662) {
        // The immutable legacy corpus calls this unresolved because 7-10 was
        // tokenized as 7/-10. This source-faithful correction is deliberately
        // explicit here; no case ID exception exists in the implementation.
        expect(item.sourcePayload.bodyText).toContain("NOK 7-10 million");
        expect(item.storedOutput.lead).toContain("7–10 millioner kroner");
        const legacy = validateRewriteOutput(item.storedOutput, item.sourcePayload);
        expect(legacy.publicationNumberAssessments.filter(number => number.disposition === "unexpected").map(number => number.display)).toEqual(["10"]);
        expect(result.publicationNumberAssessments.filter(number => number.disposition === "unexpected")).toEqual([]);
        return;
      }
      expect(result.issues.some(issue => issue.code === "UNEXPECTED_NUMBERS"), `frozen numeric case ${item.messageId}`).toBe(true);
      const legacy = validateRewriteOutput(item.storedOutput, item.sourcePayload);
      expect(result.publicationNumberAssessments.filter(number => number.disposition === "unexpected").map(number => number.display))
        .toEqual(legacy.publicationNumberAssessments.filter(number => number.disposition === "unexpected").map(number => number.display));
    },
    10_000
  );
});
