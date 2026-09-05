import type { PromptPayload } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import { assessReferenceCheckGate, buildCorrectionInstruction, buildCoverageReport, buildReferenceCheckPrompt } from "./reference-check.js";

const evidence = "The company requires USD 10-15 million of liquidity.";
const payload: PromptPayload = {
  messageId: 990090, title: "Finansieringsdialog", issuerName: "Eksempel ASA", issuerSign: "TEST",
  publishedAt: "2026-09-04T08:00:00Z", categories: [], markets: [],
  bodyText: "Dialogen fortsetter. Selskapet venter en løsning de kommende dagene.", sourceBodyChars: 65, hasAttachments: false,
  relatedNotices: [{ messageId: 990089, title: "Liquidity", issuerName: "Eksempel ASA", issuerSign: "TEST",
    publishedAt: "2026-08-07T05:59:07Z", relation: "reference", text: evidence, textChars: evidence.length,
    resolvedBy: "newsweb", score: 1 }]
};
function review(marker: string, options: {
  source?: PromptPayload; notice?: boolean; endOnPrior?: boolean; sourceId?: number; sourceEvidence?: string; amount?: string; articleMarker?: string;
} = {}) {
  const sentence = `${options.articleMarker ?? marker} oppga selskapet et behov for ${options.amount ?? "10–15"} millioner dollar.`;
  const draft: RewriteOutput = { title: "Dialogen fortsetter", lead: "Selskapet venter en løsning.",
    body: options.endOnPrior ? [sentence] : [sentence, "Selskapet venter en løsning de kommende dagene."],
    company_sentence: "", key_facts: [], negative_or_surprising: [], excluded_hype: [], source_limitations: [],
    confidence: "high", importance: "medium", source_spans: [] };
  const prompt = buildReferenceCheckPrompt(options.source ?? payload, draft, { noticeSemantics: options.notice ?? true });
  const report = buildCoverageReport(prompt.draftSentences, { sentences: prompt.draftSentences.map((text, index) => ({
    index, sentence: text, grounded: true, source: index === 2 ? "prior" as const : "primary" as const,
    interpretation: "Dekket.", sourceEvidence: index === 2 ? evidence : text,
    priorUses: index === 2 ? [{ fact: text, historicalMarker: marker, correctionStatusMarker: "",
      priorMessageId: options.sourceId ?? 990089, sourceEvidence: options.sourceEvidence ?? evidence }] : []
  })) }, { visibleArticleSentenceCount: prompt.visibleDraftSentences.length,
    headSentenceCount: prompt.headDraftSentenceCount, priorContext: prompt.priorContext });
  return { prompt, report, gate: assessReferenceCheckGate(report) };
}

describe("notice source-bound calendar dates", () => {
  it("accepts a more precise original date while retaining the month marker alternative", () => {
    for (const marker of ["7. august 2026", "I august"]) {
      const { report, gate } = review(marker);
      expect(gate.blocking).toBe(false);
      expect(report.items[2]!.priorUses![0]!.sourceEvidenceMatchesCitedSource).toBe(true);
    }
    const { prompt, report } = review("7. august 2026");
    expect(prompt.priorContext?.sources?.[0]).toMatchObject({ contextMarker: "i august", exactDateMarker: "7. august 2026" });
    expect(report.priorContext?.sources?.[0]).toMatchObject({ exactDateMarker: "7. august 2026" });
    expect(report.priorContext?.sources?.[0]).not.toHaveProperty("normalizedEvidence");
  });

  it.each(["6. august 2026", "7. juli 2026", "7. august 2025", "Da", "Den gang", "tidligere", "I juli"])(
    "still rejects the wrong or insufficiently anchored marker %s", marker => {
      expect(review(marker).gate.priorContextViolations.map(v => v.kind)).toContain("prior_unmarked");
    }
  );

  it.each([
    ["2026-08-06T22:30:00Z", "2026-09-04T08:00:00Z", "7. august 2026", "6. august 2026"],
    ["2025-12-31T23:30:00Z", "2026-02-04T08:00:00Z", "1. januar 2026", "31. desember 2025"],
    ["2026-03-28T23:30:00Z", "2026-05-04T08:00:00Z", "29. mars 2026", "28. mars 2026"],
    ["2026-10-24T22:30:00Z", "2026-12-04T08:00:00Z", "25. oktober 2026", "24. oktober 2026"]
  ])("uses the source's Oslo date at %s", (publishedAt, currentAt, osloDate, utcDate) => {
    const source = { ...payload, publishedAt: currentAt, relatedNotices: [{ ...payload.relatedNotices![0]!, publishedAt }] };
    expect(review(osloDate, { source }).gate.blocking).toBe(false);
    expect(review(utcDate, { source }).gate.priorContextViolations.map(v => v.kind)).toContain("prior_unmarked");
  });

  it("keeps same-day reference and sibling relation markers mandatory", () => {
    for (const relation of ["reference", "sibling"] as const) {
      const source = { ...payload, relatedNotices: [{ ...payload.relatedNotices![0]!, relation, publishedAt: "2026-09-04T06:00:00Z" }] };
      const result = review("4. september 2026", { source });
      expect(result.gate.priorContextViolations.map(v => v.kind)).toContain("prior_unmarked");
      const marker = relation === "reference" ? "i en tidligere melding samme dag" : "i en parallell melding samme dag";
      expect(review(marker, { source }).gate.blocking).toBe(false);
    }
  });

  it("accepts the exact day for an older-year source instead of losing that precision", () => {
    const source = { ...payload, relatedNotices: [{ ...payload.relatedNotices![0]!, publishedAt: "2023-10-27T06:50:00Z" }] };
    expect(review("27. oktober 2023", { source }).gate.blocking).toBe(false);
    expect(review("I oktober 2023", { source }).gate.blocking).toBe(false);
    expect(review("27. oktober 2026", { source }).gate.priorContextViolations.map(v => v.kind)).toContain("prior_unmarked");
  });

  it("does not trust a checker date that only matches a substring of the article's wrong date", () => {
    for (const articleMarker of ["17. august 2026", "7. august 20260", "-7. august 2026", "7. august 2026,5"]) {
      const result = review("7. august 2026", { articleMarker });
      expect(result.gate.priorContextViolations.map(v => v.kind), articleMarker).toContain("prior_unmarked");
    }
  });

  it("requires signed numeric identity in the cited original evidence for notices", () => {
    for (const [quotedAmount, articleAmount, shouldMatch] of [
      ["-15", "15", false], ["-15", "-15", true], ["−15", "15", false], ["− 15", "-15", true],
      ["10-15", "10–15", true], ["10–-15", "10–15", false], ["-10–-15", "-10–15", false],
      ["10-15 = -5", "15", false], ["40-15 ≥ 20", "15", false], ["Net cash =\nUSD 64-21", "21", false]
    ] as const) {
      const quoted = `The company requires USD ${quotedAmount} million of liquidity.`;
      const source = { ...payload, relatedNotices: [{ ...payload.relatedNotices![0]!, text: quoted, textChars: quoted.length }] };
      const result = review("7. august 2026", { source, sourceEvidence: quoted, amount: articleAmount });
      expect(result.report.items[2]!.priorUses![0]!.sourceEvidenceMatchesCitedSource, `${quotedAmount} -> ${articleAmount}`).toBe(shouldMatch);
      expect(result.gate.priorContextViolations.some(v => v.kind === "prior_evidence_mismatch")).toBe(!shouldMatch);
    }
  });

  it("does not change legacy/Sak date matching or prompts", () => {
    const { prompt, gate } = review("7. august 2026", { notice: false });
    expect(prompt.priorContext).not.toHaveProperty("noticeSemantics");
    expect(prompt.priorContext?.sources?.[0]).not.toHaveProperty("exactDateMarker");
    expect(prompt.developerPrompt).not.toContain("Kildespesifikke tidskrav");
    expect(gate.priorContextViolations.map(v => v.kind)).toContain("prior_unmarked");
  });

  it("retains source ID, literal evidence, unique source, numeric identity, correction and placement gates", () => {
    expect(review("7. august 2026", { sourceId: 123 }).gate.priorContextViolations.map(v => v.kind)).toContain("prior_message_unknown");
    expect(review("7. august 2026", { sourceEvidence: "USD ... 10-15 million" }).gate.priorContextViolations.map(v => v.kind)).toContain("prior_evidence_mismatch");
    expect(review("7. august 2026", { amount: "10–16" }).gate.priorContextViolations.map(v => v.kind)).toContain("prior_evidence_mismatch");
    const duplicate = { ...payload, relatedNotices: [...payload.relatedNotices!, { ...payload.relatedNotices![0]!, messageId: 990088 }] };
    expect(review("7. august 2026", { source: duplicate }).gate.priorContextViolations.map(v => v.kind)).toContain("prior_evidence_mismatch");
    const corrected = { ...payload, relatedNotices: [{ ...payload.relatedNotices![0]!, relation: "correction" as const }] };
    expect(review("7. august 2026", { source: corrected }).gate.priorContextViolations.map(v => v.kind)).toContain("prior_correction_status_missing");
    expect(review("7. august 2026", { endOnPrior: true }).gate.priorContextViolations.map(v => v.kind)).toContain("prior_at_end");
  });

  it("gives the checker and repair exact per-source requirements and handles placement in the same repair", () => {
    const other = { ...payload.relatedNotices![0]!, messageId: 990088, publishedAt: "2023-10-27T06:50:00Z", text: "A different historical fact." };
    const { prompt, report, gate } = review("Den gang", { source: { ...payload, relatedNotices: [...payload.relatedNotices!, other] }, endOnPrior: true });
    expect(prompt.developerPrompt).toContain('[prior_990089]: "i august" eller "7. august 2026".');
    expect(prompt.developerPrompt).toContain('[prior_990088]: "i oktober 2023" eller "27. oktober 2023".');
    const repair = buildCorrectionInstruction(report, { gate, attempt: 2, maxAttempts: 2 })!;
    const specific = repair.split("\n").find(line => line.startsWith("Krav: Bruk én av markørene"));
    expect(specific).toContain('"i august" eller "7. august 2026"');
    expect(specific).not.toContain("oktober");
    expect(repair).toContain("Flytt bakgrunnsavsnittet tidligere");
    expect(repair).toContain("ikke fjern brief.mustInclude-fakta");
    expect(repair).not.toContain("opplyste selskapet i juni");
    expect(repair).not.toContain("da emisjonen ble varslet torsdag");
  });
});
