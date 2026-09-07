import { describe, expect, it, vi } from "vitest";
import { createHybridDeveloperPrompt, createHybridReportDeveloperPrompt, createReportUserPrompt, createUserPrompt } from "@newsweb/prompt-kit";
import {
  NOTICE_NOVELTY_LIMITS, buildNoveltyEvidencePack, createNoticeNoveltyObserver, detectNoticeNoveltyTrigger,
  noticeReportingPeriods, noveltyTextHash, observeNoticeNovelty, rankNoveltyCandidates,
  splitNoveltyObservation, validateNoveltyAssessment,
  type NoveltyAssessment, type NoveltyDependencies, type NoveltyDocument, type NoveltyEvidencePack, type NoveltyNotice
} from "./notice-novelty.js";

const old: NoveltyNotice = { messageId: 100, issuerSign: "TEST", issuerId: "issuer-1", title: "Test Q1 2027 results",
  publishedAt: new Date("2026-09-04T04:00:00Z"), bodyText: "Adjusted EBITDA was GBP 4.9 million. Guidance remains GBP 16-20 million.",
  attachments: [{ id: 1000, name: "Q1 2027 Presentation.pdf" }] };
const current: NoveltyNotice = { ...old, messageId: 101, title: "Investor Presentation via Investor Meet Company",
  publishedAt: new Date("2026-09-07T09:30:00Z"), bodyText: "The CEO will provide a live presentation relating to Q1 2027 results and a Q&A. Register for Friday.",
  attachments: [{ id: 1001, name: "Q1 2027 Presentation.pdf" }] };
const pdfText = "Presentation dated 4 September 2026. Q1 2027. Adjusted EBITDA was GBP 4.9 million. Guidance remains GBP 16-20 million.";
function document(text = pdfText, hash = "old-bytes"): NoveltyDocument {
  return { text, sha256: hash, textSha256: noveltyTextHash(text), pageCount: 1, complete: true };
}
function deps(priors = [old]): NoveltyDependencies {
  return {
    listMetadata: vi.fn(async () => ({ items: priors, source: "db" as const })),
    loadNotice: vi.fn(async metadata => priors.find(p => p.messageId === metadata.messageId) ?? null),
    readDocument: vi.fn(async notice => document(pdfText, notice.messageId === 101 ? "new-bytes" : "old-bytes"))
  };
}
const repeated: NoveltyAssessment = {
  decision: "already_disclosed", announcementKind: "administrative", confidence: "high",
  repeatedFacts: [{ fact: "EBITDA was already announced", current: { sourceId: "current_pdf_1001", quote: "Adjusted EBITDA was GBP 4.9 million." },
    prior: { sourceId: "prior_100_pdf_1000", quote: "Adjusted EBITDA was GBP 4.9 million." } }],
  newFacts: [], uncertainties: []
};
async function pack(notice = current, dependencies = deps()): Promise<NoveltyEvidencePack> {
  return (await buildNoveltyEvidencePack(notice, dependencies, new AbortController().signal))!;
}

describe("bounded discovery of unreferenced earlier disclosures", () => {
  it("allows one comparison per worker process and immediately releases other jobs", async () => {
    const observe = createNoticeNoveltyObserver();
    const dependencies = deps();
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    dependencies.listMetadata = vi.fn(async () => { await ready; return { items: [], source: "db" as const }; });
    const options = { mode: "shadow" as const, dependencies, assess: vi.fn() };
    const first = observe(current, options);
    expect(await observe(current, options)).toMatchObject({ decision: "uncertain", reasonCode: "capacity_busy", durationMs: 0 });
    expect(dependencies.listMetadata).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(await observe(current, options)).toMatchObject({ reasonCode: "no_prior_disclosure_found" });
    expect(dependencies.listMetadata).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["Investor Presentation via Investor Meet Company", "invitation"], ["Q1 2027 Webcast Recording", "recording"],
    ["Correction: Q1 2027 results", "correction"], ["Reminder: investor webcast", "reminder"],
    ["Quarterly report published", "document-publication"]
  ])("recognises %s without requiring a citation", (title, trigger) => {
    expect(detectNoticeNoveltyTrigger({ title, bodyText: "" })).toBe(trigger);
  });
  it("does not mistake a first results release containing webcast logistics for a repeat", () => {
    expect(detectNoticeNoveltyTrigger({ title: "Test Q1 2027: EBITDA triples", bodyText: "We release our Q1 report today. We will present results at 10:00." })).toBeNull();
  });
  it("keeps fiscal years distinct from the calendar publication year", () => {
    expect(noticeReportingPeriods("first quarter of fiscal 2027, April-June 2026; Q1 FY2027")).toEqual(["Q1:2027"]);
  });
  it("excludes wrong issuers, future/current notices, different quarters and outside-window history", () => {
    expect(rankNoveltyCandidates(current, [
      old, current, { ...old, messageId: 102, issuerSign: "OTHER" },
      { ...old, messageId: 103, publishedAt: new Date("2026-09-07T10:00:00Z") },
      { ...old, messageId: 104, publishedAt: new Date("2026-08-01T04:00:00Z") },
      { ...old, messageId: 105, title: "Test Q1 2026 results" },
      { ...old, messageId: 106, title: "Test Q2 2027 results" }
    ]).map(x => x.messageId)).toEqual([100]);
  });
  it("prioritises the original results over later invitations and bounds detail reads", () => {
    const candidates = [old, ...[1, 2, 3, 4, 5].map(n => ({ ...old, messageId: 110 + n,
      title: "Invitation to Q1 2027 webcast", publishedAt: new Date(`2026-09-0${n + 1}T12:00:00Z`) }))];
    const ranked = rankNoveltyCandidates(current, candidates);
    expect(ranked[0].messageId).toBe(100);
    expect(ranked).toHaveLength(NOTICE_NOVELTY_LIMITS.priorNotices);
  });
  it("checks the loaded source identity and chronology again", async () => {
    const dependencies = deps();
    dependencies.loadNotice = vi.fn(async () => ({ ...old, issuerId: "another-issuer" }));
    expect((await pack(current, dependencies)).sources.some(s => s.kind === "prior-notice")).toBe(false);
    dependencies.loadNotice = vi.fn(async () => ({ ...old, publishedAt: current.publishedAt }));
    expect((await pack(current, dependencies)).sources.some(s => s.kind === "prior-notice")).toBe(false);
  });
});

describe("original notice and attachment evidence", () => {
  it("recognises a re-exported PDF by text rather than the new binary checksum", async () => {
    const evidence = await pack();
    const prior = evidence.sources.find(s => s.id === "prior_100_pdf_1000")!;
    const latest = evidence.sources.find(s => s.id === "current_pdf_1001")!;
    expect(prior.sha256).not.toBe(latest.sha256);
    expect(prior.sameTextAs).toBe(latest.id);
    expect(prior.text).toBe("");
    expect(validateNoveltyAssessment(evidence, repeated).assessment.decision).toBe("already_disclosed");
  });
  it("does not treat changed guidance inside an otherwise similarly named PDF as identical", async () => {
    const dependencies = deps();
    dependencies.readDocument = vi.fn(async notice => document(notice.messageId === current.messageId ? pdfText.replace("16-20", "25-30") : pdfText));
    const evidence = await pack(current, dependencies);
    expect(evidence.sources.find(s => s.id === "prior_100_pdf_1000")?.sameTextAs).toBeUndefined();
    const assessment: NoveltyAssessment = { ...repeated, decision: "new_information", newFacts: [{ fact: "Raised guidance",
      evidence: { sourceId: "current_pdf_1001", quote: "Guidance remains GBP 25-30 million." } }], repeatedFacts: [] };
    expect(validateNoveltyAssessment(evidence, assessment).assessment.decision).toBe("new_information");
  });
  it("rejects an image/chart change even when all extracted text is identical", async () => {
    const dependencies = deps();
    dependencies.readDocument = vi.fn(async notice => ({ ...document(), hasImages: true,
      visualSha256: notice.messageId === current.messageId ? "new-chart" : "old-chart" }));
    const evidence = await pack(current, dependencies);
    expect(evidence.currentComplete).toBe(false);
    expect(validateNoveltyAssessment(evidence, repeated).assessment.decision).toBe("uncertain");
    dependencies.readDocument = vi.fn(async () => ({ ...document(), hasImages: true, visualSha256: "same-rendered-pages" }));
    expect((await pack(current, dependencies)).currentComplete).toBe(true);
  });
  it("accepts a previously published logo in a new text wrapper but rejects new images or graphics", async () => {
    const dependencies = deps();
    let imageSha256s = ["known-logo"], hasVectorGraphics = false;
    dependencies.readDocument = vi.fn(async notice => ({
      ...document(notice.messageId === current.messageId ? pdfText + " New invitation logistics." : pdfText),
      hasImages: true, visualSha256: String(notice.messageId),
      imageSha256s: notice.messageId === current.messageId ? imageSha256s : ["known-logo"],
      hasVectorGraphics: notice.messageId === current.messageId ? hasVectorGraphics : false
    }));
    expect((await pack(current, dependencies)).currentComplete).toBe(true);
    imageSha256s = ["known-logo", "new-chart"];
    expect((await pack(current, dependencies)).currentComplete).toBe(false);
    imageSha256s = ["known-logo"];
    hasVectorGraphics = true;
    expect((await pack(current, dependencies)).currentComplete).toBe(false);
  });
  it("preserves a material new fact in the notice even with an identical attached report", async () => {
    const evidence = await pack({ ...current, bodyText: current.bodyText + " We have now signed a new GBP 50 million contract." });
    const assessment: NoveltyAssessment = { ...repeated, decision: "new_information", newFacts: [{ fact: "A new contract",
      evidence: { sourceId: "current", quote: "We have now signed a new GBP 50 million contract." } }] };
    expect(validateNoveltyAssessment(evidence, assessment).assessment.decision).toBe("new_information");
  });
  it("downgrades contradictory repeated-and-new assessments", async () => {
    const evidence = await pack({ ...current, bodyText: "Q1 2027 webcast. Corrected profit is GBP 9 million, previously GBP 3 million." });
    const result = validateNoveltyAssessment(evidence, { ...repeated, newFacts: [{ fact: "Corrected profit",
      evidence: { sourceId: "current", quote: "Corrected profit is GBP 9 million, previously GBP 3 million." } }] });
    expect(result.assessment.decision).toBe("uncertain");
    expect(result.rejectionCodes).toContain("contradictory_repeat_assessment");
  });
  it.each(["missing", "image-only", "truncated", "extra", "unsupported", "missing-metadata"])("cannot conclude repetition from %s current material", async kind => {
    const dependencies = deps();
    const source = structuredClone(current);
    if (kind === "missing") dependencies.readDocument = vi.fn(async () => { throw new Error("download failed"); });
    if (kind === "image-only") dependencies.readDocument = vi.fn(async () => ({ ...document(), complete: false }));
    if (kind === "truncated") source.bodyText = "Q1 2027 presentation. " + "Administrative text. ".repeat(1000);
    if (kind === "extra") source.attachments = [...current.attachments, { id: 1002, name: "B.pdf" }, { id: 1003, name: "New guidance.pdf" }];
    if (kind === "unsupported") source.attachments.push({ id: 1002, name: "New guidance.xlsx" });
    if (kind === "missing-metadata") source.attachmentsComplete = false;
    const evidence = await pack(source, dependencies);
    expect(evidence.currentComplete).toBe(false);
    expect(validateNoveltyAssessment(evidence, repeated).assessment.decision).toBe("uncertain");
  });
  it("rejects invented evidence and current-source masquerading as historical proof", async () => {
    const evidence = await pack();
    expect(validateNoveltyAssessment(evidence, { ...repeated, repeatedFacts: [{ ...repeated.repeatedFacts[0],
      prior: { sourceId: "prior_100", quote: "This quote was never in the notice." } }] }).rejectionCodes).toContain("ungrounded_evidence");
    expect(validateNoveltyAssessment(evidence, { ...repeated, repeatedFacts: [{ ...repeated.repeatedFacts[0],
      prior: { sourceId: "current_pdf_1001", quote: "Adjusted EBITDA was GBP 4.9 million." } }] }).assessment.decision).toBe("uncertain");
  });
  it("does not accept low confidence, missing repeated facts or unresolved doubts as duplicate evidence", async () => {
    const evidence = await pack();
    for (const patch of [{ confidence: "low" }, { repeatedFacts: [] }, { uncertainties: ["Guidance may have changed"] }, { announcementKind: "substantive" }]) {
      expect(validateNoveltyAssessment(evidence, { ...repeated, ...patch }).assessment.decision).toBe("uncertain");
    }
  });
});

describe("observation lifecycle", () => {
  it("performs no I/O or model call while off, or for an unrelated ordinary notice", async () => {
    const dependencies = deps(); const assess = vi.fn();
    expect(await observeNoticeNovelty(current, { mode: "off", dependencies, assess })).toBeUndefined();
    expect(await observeNoticeNovelty(old, { mode: "shadow", dependencies, assess })).toBeUndefined();
    expect(dependencies.listMetadata).not.toHaveBeenCalled(); expect(assess).not.toHaveBeenCalled();
  });
  it("missing history stays uncertain without downloading PDFs or asking the model to guess", async () => {
    const dependencies = deps([]); const assess = vi.fn();
    const result = await observeNoticeNovelty(current, { mode: "shadow", dependencies, assess });
    expect(result?.decision).toBe("uncertain"); expect(result?.reasonCode).toBe("no_prior_disclosure_found");
    expect(dependencies.readDocument).not.toHaveBeenCalled(); expect(assess).not.toHaveBeenCalled();
  });
  it("contains lookup and model errors instead of failing the generation", async () => {
    const dependencies = deps(); dependencies.listMetadata = vi.fn(async () => { throw new Error("DB/network failure"); });
    const options = { mode: "shadow" as const, dependencies, assess: vi.fn(async () => repeated) };
    expect((await observeNoticeNovelty(current, options))?.decision).toBe("uncertain");
    options.dependencies = deps(); options.assess = vi.fn(async () => { throw new Error("bad model JSON"); });
    expect((await observeNoticeNovelty(current, options))?.reasonCode).toBe("check_unavailable");
  });
  it("cancels a stalled lookup at the observation deadline", async () => {
    let aborted = false;
    const dependencies = deps();
    dependencies.listMetadata = vi.fn((_source, signal) => new Promise<Awaited<ReturnType<NoveltyDependencies["listMetadata"]>>>((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
    }));
    const result = await observeNoticeNovelty(current, { mode: "shadow", dependencies, assess: vi.fn(), timeoutMs: 10 });
    expect(result?.decision).toBe("uncertain"); expect(aborted).toBe(true);
  });
  it("keeps the observation outside normal/report writer prompts and persisted source payloads", async () => {
    const observation = await observeNoticeNovelty(current, { mode: "shadow", dependencies: deps(), assess: async () => repeated });
    const payload = { messageId: 101, issuerSign: "TEST", issuerName: "Test", publishedAt: current.publishedAt.toISOString(), title: current.title,
      bodyText: current.bodyText, categories: [], markets: [], hasAttachments: true, sourceBodyChars: current.bodyText.length };
    const annotated = { ...payload, noticeNoveltyObservation: observation };
    expect(createUserPrompt(annotated)).toBe(createUserPrompt(payload));
    expect(createHybridDeveloperPrompt(undefined, annotated)).toBe(createHybridDeveloperPrompt(undefined, payload));
    const report = { ...payload, reportText: pdfText, reportPageCount: 1, reportMetrics: [], reportSelectedPages: [] };
    const annotatedReport = { ...report, ...annotated };
    expect(createReportUserPrompt(annotatedReport)).toBe(createReportUserPrompt(report));
    expect(createHybridReportDeveloperPrompt(undefined, annotatedReport)).toBe(createHybridReportDeveloperPrompt(undefined, report));
    expect(splitNoveltyObservation(annotatedReport).sourcePayload).toEqual(report);
    expect(splitNoveltyObservation(annotatedReport).noticeNoveltyObservation?.decision).toBe("already_disclosed");
  });
});
