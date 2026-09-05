import type { NoticeEditorialBrief } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import type { NoticePayload } from "./notice-evidence.js";
import type { NoticeJsonCaller, NoticeJsonRequest, NoticeModelCallLog } from "./notice-model-client.js";
import { runNoticePipeline } from "./notice-pipeline.js";

// Invented sources: readiness must follow evidence, not a report layout or issuer.
const loss = "Testdrift har fått varsel om at den største kunden avslutter leveranseavtalen.";
const timing = "Avtalen løper ut ved årsskiftet.";
const currentSource = `${loss} ${timing}`;
const payload: NoticePayload = {
  messageId: 991720, title: "Testdrift - kvartalsrapport", issuerName: "Testdrift", issuerSign: "TEST",
  publishedAt: "2026-09-01T08:00:00Z", categories: ["KVARTALSRAPPORT"], markets: [],
  bodyText: currentSource, sourceBodyChars: currentSource.length, hasAttachments: true
};
const brief: NoticeEditorialBrief = {
  newsworthy: true, reason: "Den største kunden avslutter leveranseavtalen.", eventType: "commercial_update",
  eventStatus: "Varslet; avtalen løper ut ved årsskiftet.", angle: "Testdrift mister sin største kunde",
  mustInclude: [
    { id: "customer", fact: loss, sourceId: "primary", sourceEvidence: loss },
    { id: "timing", fact: timing, sourceId: "primary", sourceEvidence: timing }
  ], usefulQuote: null, sourceLimitations: []
};
const article: RewriteOutput = {
  title: "Testdrift mister sin største kunde",
  lead: "Testdrift har fått varsel om at den største kunden avslutter leveranseavtalen, opplyser selskapet.",
  body: [timing], company_sentence: "", key_facts: [loss, timing], source_spans: [loss, timing],
  negative_or_surprising: [], excluded_hype: [], source_limitations: [], confidence: "high", importance: "medium"
};

function harness(proposal = brief, output = article, source = currentSource) {
  const requests: NoticeJsonRequest[] = [];
  const call: NoticeJsonCaller = async request => {
    requests.push(request);
    let content: unknown;
    if (request.schemaName === "notice_editorial_brief") content = proposal;
    else if (request.schemaName === "notice_rewrite_output") content = output;
    else if (request.schemaName === "reference_check_result") {
      const marker = "SETNINGER SOM SKAL SJEKKES (indeks + tekst):\n";
      const sentences = JSON.parse(request.userPrompt.slice(request.userPrompt.lastIndexOf(marker) + marker.length)) as Array<{ index: number; sentence: string }>;
      content = { sentences: sentences.map(sentence => ({ ...sentence, grounded: true, source: "primary",
        sourceEvidence: source, interpretation: "Syntetisk kildekontroll.", priorUses: [] })) };
    } else if (request.schemaName === "notice_editorial_coverage") {
      const { materialEventCoverageEnabled } = JSON.parse(request.userPrompt);
      content = {
        coveredFactIds: proposal.mustInclude.map(fact => fact.id), missingFactIds: [],
        statusAccurate: true, instructionCompliant: true,
        semanticChecks: { actorAndPayment: "not_applicable", metricAndMaterialScope: "pass",
          relativeQuantityContext: "not_applicable", materialEventCoverage: materialEventCoverageEnabled ? "pass" : "not_applicable" },
        semanticFindings: [], findings: [], repairInstruction: ""
      };
    } else throw new Error(`Unexpected schema ${request.schemaName}`);
    const modelCall: NoticeModelCallLog = {
      ...request, provider: "openai", model: "synthetic", reasoningEffort: "medium", timeoutMs: 1000,
      maxOutputTokens: 16384, promptChars: request.userPrompt.length, promptCacheMode: "implicit", promptCacheKey: null,
      responseModel: "synthetic", requestedServiceTier: "default", serviceTier: "default", attemptCount: 1,
      attempts: [], usage: null
    };
    return { content: JSON.stringify(content), promptChars: modelCall.promptChars, modelCall };
  };
  return { call, requests, calls: (name: string) => requests.filter(request => request.schemaName === name) };
}

describe("source-bound limited report drafting", () => {
  it.each(["regular", "report"] as const)("allows substantive primary facts with an unavailable attachment on the %s route", async kind => {
    const h = harness();
    const result = await runNoticePipeline({ payload, kind, call: h.call, allowSkip: true, maxRepairAttempts: 0 });
    expect(result.decision).toBe("publish");
    expect(result.audit.reportReadiness).toMatchObject({ attachmentTextAvailable: false, reportCompleteness: null, supportedLimitedDraft: true });
    expect(result.audit.reportReadiness?.sourceIssues).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(h.calls("notice_rewrite_output")).toHaveLength(1);
    expect(h.calls("reference_check_result")).toHaveLength(1);
    expect(h.calls("notice_editorial_coverage")).toHaveLength(1);
    expect(result.audit.finalCoverage?.missingFactIds).toEqual([]);
    expect(result.audit.finalReferenceCoverage).not.toBeNull();
    expect(result.rewrite?.confidence).toBe("medium");
    expect(result.rewrite?.source_limitations).toContain("Vedlegg er ikke tilgjengelige i kildegrunnlaget.");
    expect(h.calls("notice_rewrite_output")[0]!.userPrompt).toContain("Vedlegg er ikke tilgjengelige i kildegrunnlaget.");
    expect(result.audit.briefAttempts[0]!.brief?.sourceLimitations).toEqual([]);
    expect(brief.sourceLimitations).toEqual([]);
  });

  it.each(["high", "low"] as const)("uses exact raw report facts despite zero typed metrics and preserves %s confidence limits", async confidence => {
    const cash = "Kontantbeholdningen var 18 millioner kroner ved utgangen av tredje kvartal.";
    const closure = "Styret har vedtatt å avvikle produksjonen ved det vestlige anlegget.";
    const raw = `${cash}\n${closure}`;
    const input: NoticePayload = { ...payload, bodyText: "Kvartalsrapporten følger vedlagt.",
      reportText: raw, reportReferenceText: raw, reportCompleteness: "insufficient", reportFinancialFacts: [] };
    const proposal: NoticeEditorialBrief = { ...brief, reason: "Besluttet avvikling av produksjonen.",
      eventStatus: "Vedtatt, ikke gjennomført.", mustInclude: [
        { id: "cash", fact: cash, sourceId: "primary", sourceEvidence: cash },
        { id: "closure", fact: closure, sourceId: "primary", sourceEvidence: closure }
      ] };
    const output: RewriteOutput = { ...article, title: "Testdrift vedtar å avvikle produksjon",
      lead: "Styret i Testdrift har vedtatt å avvikle produksjonen ved det vestlige anlegget, opplyser selskapet.",
      body: [cash], key_facts: [cash, closure], source_spans: [cash, closure], confidence,
      source_limitations: Array.from({ length: 6 }, (_, index) => `Modellens kildeforbehold ${index + 1}.`) };
    const h = harness(proposal, output, raw);
    const result = await runNoticePipeline({ payload: input, kind: "report", call: h.call, allowSkip: true, maxRepairAttempts: 0 });
    expect(result.decision).toBe("publish");
    expect(result.audit.reportReadiness).toMatchObject({ reportCompleteness: "insufficient", attachmentTextAvailable: true, supportedLimitedDraft: true });
    expect(input.reportCompleteness).toBe("insufficient");
    expect(input.reportFinancialFacts).toEqual([]);
    expect(result.rewrite?.confidence).toBe(confidence === "high" ? "medium" : "low");
    expect(result.rewrite?.source_limitations).toContain("Rapportgrunnlaget er et begrenset utdrag, ikke en full analyse av alle vedlegg.");
    expect(result.rewrite?.source_limitations).toHaveLength(6);
    const reviewInput = JSON.parse(h.calls("notice_editorial_coverage")[0]!.userPrompt);
    expect(reviewInput.sources[0].text).toContain(raw);
    expect(h.calls("notice_rewrite_output")).toHaveLength(1);
  });

  it("keeps an empty body without attachment evidence blocked before any model call", async () => {
    const h = harness();
    const result = await runNoticePipeline({ payload: { ...payload, bodyText: " \n ", sourceBodyChars: 0 },
      kind: "report", call: h.call, allowSkip: true });
    expect(result.decision).toBe("retry");
    expect(result.errors.join(" ")).toContain("SOURCE_TEXT_EMPTY");
    expect(result.rewrite).toBeNull();
    expect(h.requests).toHaveLength(0);
  });

  it.each([false, true])("keeps unavailable-source and editorial non-news outcomes distinct (raw source available: %s)", async available => {
    const announcement = "Rapporten er publisert i vedlegget.";
    const input: NoticePayload = { ...payload, bodyText: announcement, sourceBodyChars: announcement.length,
      ...(available ? { reportText: "Den eneste opplysningen er at tidligere oppgitte regnskapsprinsipper er uendret.", reportCompleteness: "partial" as const } : {}) };
    const proposal: NoticeEditorialBrief = { ...brief, newsworthy: false, mustInclude: [],
      reason: "Ingen ny materiell opplysning er dokumentert.", sourceLimitations: available ? [] : ["Vedlegget mangler."] };
    const h = harness(proposal);
    const result = await runNoticePipeline({ payload: input, kind: "report", call: h.call, allowSkip: true });
    expect(result.decision).toBe(available ? "skip" : "retry");
    expect(result.audit.reportReadiness?.supportedLimitedDraft).toBe(false);
    if (!available) expect(result.errors.join(" ")).toContain("INCOMPLETE_REPORT_SOURCE");
    expect(result.rewrite).toBeNull();
    expect(h.calls("notice_rewrite_output")).toHaveLength(0);
  });

  it.each(["wrong_witness", "prior_only"] as const)("does not open the writer for a %s brief", async variant => {
    const input: NoticePayload = { ...payload, bodyText: "En ny kvartalsrapport er publisert.", relatedNotices: [{
      messageId: 991710, title: "Tidligere leveranseavtale", issuerName: "Testdrift", issuerSign: "TEST",
      publishedAt: "2026-08-01T08:00:00Z", relation: "reference", text: currentSource, textChars: currentSource.length,
      resolvedBy: "db", score: 1
    }] };
    const proposal: NoticeEditorialBrief = { ...brief, mustInclude: brief.mustInclude.map(fact => ({
      ...fact, sourceId: variant === "prior_only" ? "prior_991710" : "primary"
    })) };
    const h = harness(proposal);
    const result = await runNoticePipeline({ payload: input, kind: "report", call: h.call, allowSkip: true });
    expect(result.decision).toBe("retry");
    expect(result.errors.join(" ")).toContain("EDITORIAL_BRIEF_UNGROUNDED");
    expect(h.calls("notice_editorial_brief")).toHaveLength(2);
    expect(h.calls("notice_rewrite_output")).toHaveLength(0);
  });

  it("still blocks an unsupported final headline amount even when both model reviews approve it", async () => {
    const h = harness(brief, { ...article, title: "Testdrift mister kontrakt verdt 77 millioner" });
    const result = await runNoticePipeline({ payload, kind: "report", call: h.call, allowSkip: true, maxRepairAttempts: 0 });
    expect(result.audit.reportReadiness?.supportedLimitedDraft).toBe(true);
    expect(h.calls("notice_rewrite_output")).toHaveLength(1);
    expect(h.calls("reference_check_result")).toHaveLength(1);
    expect(h.calls("notice_editorial_coverage")).toHaveLength(1);
    expect(result.decision).toBe("failed");
    expect(result.validation?.issues).toContainEqual(expect.objectContaining({ code: "UNEXPECTED_NUMBERS", severity: "blocking" }));
    expect(result.audit.numericPublicationPolicy?.referenceGroundedOverrideApplied).toBe(false);
  });
});
