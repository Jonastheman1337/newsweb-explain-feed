import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import {
  assessReferenceCheckGate, buildCorrectionInstruction, buildCoverageReport,
  buildReferenceCheckPrompt, type ReferenceCheckResult
} from "./reference-check.js";

const anchorEvidence = "The municipality will buy the factories.";
const priceEvidence = "The factories are valued at SEK 145 million, and the purchase price will be approximately SEK 132 million after adjustment for tax values.";
const anchor = "I oktober 2023 meldte selskapet at kommunen skulle kjøpe fabrikkene.";
const price = "Kjøpesummen var anslått til om lag 132 millioner SEK etter justering for skatteverdier.";
const payload: PromptPayload = {
  messageId: 990080, title: "Godkjenning", issuerName: "Eksempel ASA", issuerSign: "TEST",
  publishedAt: "2026-09-01T08:00:00Z", categories: [], markets: [],
  bodyText: "The transaction may proceed to completion. Approval is now final.",
  sourceBodyChars: 70, hasAttachments: false,
  relatedNotices: [{ messageId: 990079, title: "Factory sale", issuerName: "Eksempel ASA", issuerSign: "TEST",
    publishedAt: "2023-10-27T06:50:00Z", relation: "reference", text: `${anchorEvidence} ${priceEvidence}`,
    textChars: anchorEvidence.length + priceEvidence.length + 1, resolvedBy: "newsweb", score: 1 }]
};
const draft: RewriteOutput = {
  title: "Salget kan gjennomføres", lead: "Selskapet har fått godkjenning.",
  body: [`${anchor} ${price}`, "Godkjenningen er nå endelig."], company_sentence: "",
  key_facts: [], negative_or_surprising: [], excluded_hype: [], source_limitations: [],
  confidence: "high", importance: "medium", source_spans: []
};

function check(options: {
  payload?: PromptPayload; draft?: RewriteOutput; notice?: boolean;
  mutate?: (raw: ReferenceCheckResult) => void; staleDraftSentences?: string[];
} = {}) {
  const prompt = buildReferenceCheckPrompt(options.payload ?? payload, options.draft ?? draft,
    { noticeSemantics: options.notice ?? true });
  const raw: ReferenceCheckResult = { sentences: prompt.draftSentences.map((sentence, index) => {
    const isAnchor = sentence === anchor;
    const isPrice = sentence.includes("132");
    const evidence = isAnchor ? anchorEvidence : priceEvidence;
    return { index, sentence, grounded: true, source: isAnchor || isPrice ? "prior" : "primary",
      interpretation: "Dekket.", sourceEvidence: isAnchor || isPrice ? evidence : sentence,
      priorUses: isAnchor || isPrice ? [{ priorMessageId: 990079, fact: sentence, sourceEvidence: evidence,
        historicalMarker: "I oktober 2023", correctionStatusMarker: "" }] : [] };
  }) };
  options.mutate?.(raw);
  const report = buildCoverageReport(options.staleDraftSentences ?? prompt.draftSentences, raw, {
    visibleArticleSentenceCount: prompt.visibleDraftSentences.length, headSentenceCount: prompt.headDraftSentenceCount,
    priorContext: prompt.priorContext
  });
  return { prompt, report, gate: assessReferenceCheckGate(report) };
}

describe("notice historical context within a paragraph", () => {
  it("accepts a dated paragraph only after each claim independently matches the same unique source", () => {
    const { prompt, report, gate } = check();
    expect(gate.blocking).toBe(false);
    expect(report.items[2]?.priorUses?.[0]?.sourceEvidenceMatchesCitedSource).toBe(true);
    expect(report.items[3]?.priorUses?.[0]?.sourceEvidenceMatchesCitedSource).toBe(true);
    expect(report.priorContext?.draftParagraphIds).toEqual([0, 1, 2, 2, 3]);
    expect(report.priorContext).not.toHaveProperty("draftSentences");
    expect(report.priorContext?.sources?.[0]).not.toHaveProperty("normalizedEvidence");
    expect(prompt.userPrompt).toContain('"paragraphIndex":2');
    expect(prompt.draftSentences[3]).toBe(price);
  });

  it("retains the exact original date including its year as a stronger paragraph anchor", () => {
    const dated = anchor.replace("I oktober 2023", "27. oktober 2023");
    const result = check({ draft: { ...draft, body: [`${dated} ${price}`, draft.body[1]!] }, mutate: raw => {
      raw.sentences[2] = { ...raw.sentences[2]!, source: "prior", priorUses: [{ priorMessageId: 990079,
        fact: dated, sourceEvidence: anchorEvidence, historicalMarker: "27. oktober 2023", correctionStatusMarker: "" }] };
      raw.sentences[3]!.priorUses![0]!.historicalMarker = "27. oktober 2023";
    } });
    expect(result.gate.blocking).toBe(false);
  });

  it.each([
    ["separate body paragraphs", [anchor, price, draft.body[1]!]],
    ["embedded newline", [`${anchor}\n${price}`, draft.body[1]!]],
    ["embedded blank line", [`${anchor}\n\n${price}`, draft.body[1]!]]
  ])("does not borrow a marker across %s", (_label, body) => {
    const { gate } = check({ draft: { ...draft, body } });
    expect(gate.priorContextViolations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "prior_unmarked", item: expect.objectContaining({ index: 3 }) })]));
  });

  it.each([
    ["present amount", "Kjøpesummen er 132 millioner SEK."],
    ["current status despite a past verb", "Kjøpesummen var 132 millioner SEK og gjelder nå."],
    ["wrong day", "28. oktober 2023 var kjøpesummen 132 millioner SEK."],
    ["wrong year", "I oktober 2024 var kjøpesummen 132 millioner SEK."],
    ["new same-day anchor", "Tidligere i dag var kjøpesummen 132 millioner SEK."]
  ])("does not inherit through %s", (_label, continuation) => {
    expect(check({ draft: { ...draft, body: [`${anchor} ${continuation}`, draft.body[1]!] } })
      .gate.priorContextViolations.map(item => item.kind)).toContain("prior_unmarked");
  });

  it.each([
    ["invalid anchor quote", (raw: ReferenceCheckResult) => { raw.sentences[2]!.priorUses![0]!.sourceEvidence = "The municipality ... buy the factories."; }],
    ["invalid continuation quote", (raw: ReferenceCheckResult) => { raw.sentences[3]!.priorUses![0]!.sourceEvidence = "The purchase price is SEK 132 million."; }],
    ["unknown anchor source", (raw: ReferenceCheckResult) => { raw.sentences[2]!.priorUses![0]!.priorMessageId = 1; }],
    ["unknown continuation source", (raw: ReferenceCheckResult) => { raw.sentences[3]!.priorUses![0]!.priorMessageId = 1; }],
    ["mixed current anchor", (raw: ReferenceCheckResult) => { raw.sentences[2]!.source = "both"; }],
    ["mixed current continuation", (raw: ReferenceCheckResult) => { raw.sentences[3]!.source = "both"; }],
    ["unsupported anchor", (raw: ReferenceCheckResult) => { raw.sentences[2]!.grounded = false; }],
    ["unmatched anchor clause", (raw: ReferenceCheckResult) => { raw.sentences[2]!.priorUses![0]!.fact = "I oktober 2023 var noe annet meldt."; }]
  ])("fails closed for %s", (_label, mutate) => {
    const { gate } = check({ mutate });
    expect(gate.blocking).toBe(true);
    expect(gate.priorContextViolations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "prior_unmarked", item: expect.objectContaining({ index: 3 }) })]));
  });

  it("does not treat a duplicate source excerpt as a unique historical anchor", () => {
    const result = check({ payload: { ...payload, relatedNotices: [...payload.relatedNotices!,
      { ...payload.relatedNotices![0]!, messageId: 990078 }] } });
    expect(result.gate.priorContextViolations.map(item => item.kind)).toContain("prior_evidence_mismatch");
    expect(result.gate.priorContextViolations.map(item => item.kind)).toContain("prior_unmarked");
  });

  it("does not inherit after an intervening current-source sentence", () => {
    const result = check({ draft: { ...draft, body: [`${anchor} Godkjenningen er endelig. ${price}`, draft.body[1]!] } });
    expect(result.gate.priorContextViolations.map(item => item.kind)).toContain("prior_unmarked");
  });

  it("does not borrow an anchor through a different valid historical source", () => {
    const intervening = "I desember 2025 var fristen fastsatt.";
    const otherEvidence = "The factory transaction had a deadline.";
    const other = { ...payload.relatedNotices![0]!, messageId: 990078, publishedAt: "2025-12-10T08:00:00Z",
      text: otherEvidence, textChars: otherEvidence.length };
    const result = check({ payload: { ...payload, relatedNotices: [...payload.relatedNotices!, other] },
      draft: { ...draft, body: [`${anchor} ${intervening} ${price}`, draft.body[1]!] },
      mutate: raw => { raw.sentences[3] = { ...raw.sentences[3]!, source: "prior", priorUses: [{
        priorMessageId: 990078, fact: intervening, historicalMarker: "I desember 2025",
        sourceEvidence: otherEvidence, correctionStatusMarker: ""
      }] }; } });
    expect(result.report.items[3]!.priorUses![0]!.sourceEvidenceMatchesCitedSource).toBe(true);
    expect(result.gate.priorContextViolations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "prior_unmarked", item: expect.objectContaining({ index: 4 }) })
    ]));
  });

  it("can carry one valid source date through multiple independently grounded historical sentences", () => {
    const originalBytes = JSON.stringify({ payload, draft });
    const extra = "Beløpet var fortsatt anslått til om lag 132 millioner SEK.";
    const result = check({ draft: { ...draft, body: [`${anchor} ${price} ${extra}`, draft.body[1]!] } });
    expect(result.gate.blocking).toBe(false);
    expect(result.report.items[4]!.priorUses![0]!.sourceEvidenceMatchesCitedSource).toBe(true);
    expect(JSON.stringify({ payload, draft })).toBe(originalBytes);
  });

  it.each(["correction", "sibling", "same-day reference"] as const)("keeps %s sentence-local", relation => {
    const prior = { ...payload.relatedNotices![0]!, relation: relation === "same-day reference" ? "reference" as const : relation,
      ...(relation !== "correction" ? { publishedAt: "2026-09-01T06:00:00Z" } : {}) };
    expect(check({ payload: { ...payload, relatedNotices: [prior] } })
      .gate.priorContextViolations.map(item => item.kind)).toContain("prior_unmarked");
  });

  it("does not inherit a paragraph map from an earlier draft", () => {
    const sentences = check().prompt.draftSentences;
    sentences[3] = price.replace("132", "133");
    const { report, gate } = check({ staleDraftSentences: sentences });
    expect(report.priorContext).not.toHaveProperty("draftParagraphIds");
    expect(gate.priorContextViolations.map(item => item.kind)).toContain("prior_unmarked");
  });

  it("retains title/lead ownership and prior-at-end gates", () => {
    expect(check({ draft: { ...draft, lead: anchor, body: [price, draft.body[1]!] } })
      .gate.priorContextViolations.map(item => item.kind)).toContain("prior_in_head");
    expect(check({ draft: { ...draft, body: [draft.body[0]!] } })
      .gate.priorContextViolations.map(item => item.kind)).toContain("prior_at_end");
  });

  it("preserves the legacy/Sak same-sentence contract", () => {
    const { gate, prompt } = check({ notice: false });
    expect(prompt.priorContext).not.toHaveProperty("draftParagraphIds");
    expect(prompt.userPrompt).not.toContain("paragraphIndex");
    expect(gate.priorContextViolations.map(item => item.kind)).toContain("prior_unmarked");
  });
});

describe("notice reference meaning contract", () => {
  it.each([
    ["2026-08-31T05:00:00Z", "mandag 31. august 2026"],
    ["2026-08-30T22:30:00Z", "mandag 31. august 2026"],
    ["2025-12-31T23:30:00Z", "torsdag 1. januar 2026"]
  ])("provides publication-only Oslo metadata for %s", (publishedAt, localDate) => {
    const notice = buildReferenceCheckPrompt({ ...payload, publishedAt, relatedNotices: [] }, draft, { noticeSemantics: true });
    expect(notice.userPrompt).toContain(JSON.stringify(publishedAt));
    expect(notice.userPrompt).toContain(localDate);
    expect(notice.developerPrompt).toContain("aldri datoen for en annen hendelse");
    expect(buildReferenceCheckPrompt({ ...payload, publishedAt, relatedNotices: [] }, draft).userPrompt)
      .not.toContain("PUBLISERINGSMETADATA");
  });

  it("does not invent publication metadata when the timestamp is invalid", () => {
    const notice = buildReferenceCheckPrompt({ ...payload, publishedAt: "not-a-date", relatedNotices: [] }, draft, { noticeSemantics: true });
    expect(notice.userPrompt).not.toContain("PUBLISERINGSMETADATA");
  });

  it("gives checking and primary-only repairs the same bounded terminology and semantic rules", () => {
    const { report } = check({ payload: { ...payload, relatedNotices: [] } });
    report.unsupportedSentences = [{ index: 0, sentence: draft.title, grounded: false,
      interpretation: "Meaning needs checking.", sourceEvidence: "may proceed to completion" }];
    const prompt = buildReferenceCheckPrompt(payload, draft, { noticeSemantics: true });
    const repair = buildCorrectionInstruction(report, { noticeSemantics: true })!;
    for (const expected of ["'tap issue' i obligasjonskontekst", "utvidelse av et eksisterende obligasjonslån",
      "aldri at finansieringen er sikret", "beløp, rente, forfall, sikkerhet", "foregående kildeavsnitt",
      "både antecedenten og den relative påstanden", "timing/tidspunkt/tidsforskyvning er ikke quantity/mengde",
      "også i title", "grounded være false", "ikke bekrefter/opplyser at den er fullført"])
      expect([prompt.developerPrompt.includes(expected), repair.includes(expected)], expected).toEqual([true, true]);
    expect(repair).toContain("hele den opprinnelige kilden");
    expect(repair).not.toContain("omskriv den kun med tekst/fakta som finnes i feltet");
    expect(buildCorrectionInstruction(report)).not.toContain("'tap issue' i obligasjonskontekst");
  });
});
