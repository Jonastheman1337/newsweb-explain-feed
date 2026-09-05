import type { NoticeEditorialBrief } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import type { NoticePayload } from "./notice-evidence.js";
import type { NoticeJsonCaller, NoticeJsonRequest, NoticeModelCallLog } from "./notice-model-client.js";
import { runNoticePipeline } from "./notice-pipeline.js";

// Invented notices exercise the complete production orchestration without
// provider calls. The related source is independently validated, not mocked
// as pre-approved coverage.
const approval = "Eksempelbygg ASA har fått godkjent salg og tilbakeleie av to produksjonseiendommer.";
const finality = "Avgjørelsen er endelig og kan ikke ankes.";
const completion = "Transaksjonen kan nå fullføres.";
const primary = `${approval} ${finality} ${completion}`;
const priorEvidence = "The purchase price was estimated at NOK 50 million.";
const history = "I juni var kjøpesummen anslått til 50 millioner kroner.";
const malformedEvidence = "“The purchase price” ... “NOK 50 million”";
const payload: NoticePayload = {
  messageId: 990050, title: "Godkjenning av eiendomssalg", issuerName: "Eksempelbygg ASA", issuerSign: "SYNTH",
  publishedAt: "2026-09-04T08:00:00.000Z", categories: [], markets: [],
  bodyText: primary, sourceBodyChars: primary.length, hasAttachments: false,
  relatedNotices: [{
    messageId: 990049, relation: "reference", title: "Conditional property sale", issuerName: "Eksempelbygg ASA", issuerSign: "SYNTH",
    publishedAt: "2026-06-04T08:00:00.000Z", text: priorEvidence, textChars: priorEvidence.length,
    resolvedBy: "newsweb", score: 1
  }]
};
const brief: NoticeEditorialBrief = {
  newsworthy: true, reason: "Endelig godkjenning gjør at eiendomssalget kan fullføres.",
  eventType: "transaction", eventStatus: "Godkjent, men ikke meldt fullført.", angle: "Eksempelbygg kan fullføre eiendomssalget.",
  mustInclude: [
    { id: "approval", fact: approval, sourceId: "primary", sourceEvidence: approval },
    { id: "finality", fact: finality, sourceId: "primary", sourceEvidence: finality }
  ], usefulQuote: null, sourceLimitations: []
};
const draft: RewriteOutput = {
  title: "Eksempelbygg kan fullføre eiendomssalg", lead: approval,
  body: [history, finality], company_sentence: "",
  key_facts: [approval, finality], negative_or_surprising: [], excluded_hype: [], source_limitations: [],
  confidence: "high", importance: "medium", source_spans: [approval, finality]
};

function logFor(request: NoticeJsonRequest): NoticeModelCallLog {
  return {
    ...request, provider: "openai", model: "synthetic-model", reasoningEffort: "medium", timeoutMs: 1000,
    maxOutputTokens: 16384, promptChars: request.systemPrompt.length + request.developerPrompt.length + request.userPrompt.length,
    promptCacheMode: "implicit", promptCacheKey: null, responseModel: "synthetic-model",
    requestedServiceTier: "default", serviceTier: "default", attemptCount: 1, attempts: [], usage: null
  };
}

type Fault = "ellipsis" | "unknown_source" | "missing_number_anchor";
function harness(options: {
  fault?: Fault;
  persistent?: boolean;
  failReferenceAt?: number;
  changeSentenceAt?: number;
  omitFinalityFirst?: boolean;
  removeBackgroundOnRepair?: boolean;
  removeEssentialOnRepair?: boolean;
  unmarkedBackground?: boolean;
} = {}) {
  const requests: NoticeJsonRequest[] = [];
  let referenceCount = 0;
  let rewriteCount = 0;
  const call: NoticeJsonCaller = async request => {
    requests.push(request);
    let content: unknown;
    if (request.schemaName === "notice_editorial_brief") content = brief;
    else if (request.schemaName === "notice_rewrite_output") {
      rewriteCount += 1;
      const background = options.unmarkedBackground ? "Kjøpesummen var anslått til 50 millioner kroner." : history;
      content = { ...draft, body: [
        ...(options.removeBackgroundOnRepair && rewriteCount > 1 ? [] : [background]),
        (options.omitFinalityFirst && rewriteCount === 1) || (options.removeEssentialOnRepair && rewriteCount > 1) ? completion : finality
      ] };
    } else if (request.schemaName === "reference_check_result") {
      referenceCount += 1;
      if (referenceCount === options.failReferenceAt) throw new Error("SYNTHETIC_CHECKER_OUTAGE");
      const marker = "SETNINGER SOM SKAL SJEKKES (indeks + tekst):\n";
      const sentences = JSON.parse(request.userPrompt.slice(request.userPrompt.lastIndexOf(marker) + marker.length)) as Array<{ index: number; sentence: string }>;
      const faulty = options.persistent || referenceCount === 1;
      content = { sentences: sentences.map(item => {
        const isPrior = item.sentence.includes("50 millioner");
        const evidence = !faulty ? priorEvidence : options.fault === "missing_number_anchor" ? "The purchase price" : options.fault === "unknown_source" ? priorEvidence : malformedEvidence;
        return {
          ...item,
          sentence: referenceCount === options.changeSentenceAt && isPrior ? `${item.sentence} Uvedkommende tillegg.` : item.sentence,
          grounded: true, interpretation: "Dekket av oppgitt syntetisk kilde.",
          sourceEvidence: isPrior ? evidence : primary, source: isPrior ? "prior" : "primary",
          priorUses: isPrior ? [{
            priorMessageId: faulty && options.fault === "unknown_source" ? 990099 : 990049,
            fact: item.sentence, sourceEvidence: evidence, historicalMarker: "I juni", correctionStatusMarker: ""
          }] : []
        };
      }) };
    } else if (request.schemaName === "notice_editorial_coverage") {
      const { article } = JSON.parse(request.userPrompt) as { article: { body: string[] } };
      const complete = article.body.includes(finality);
      content = {
        coveredFactIds: complete ? ["approval", "finality"] : ["approval"], missingFactIds: complete ? [] : ["finality"],
        statusAccurate: true, instructionCompliant: true, findings: complete ? [] : ["Endelig avgjørelse mangler."],
        repairInstruction: complete ? "" : `Ta med: ${finality}`
      };
    } else throw new Error(`Unexpected schema ${request.schemaName}`);
    const modelCall = logFor(request);
    return { content: JSON.stringify(content), promptChars: modelCall.promptChars, modelCall };
  };
  return { call, requests };
}

describe("notice reference metadata retry", () => {
  it("corrects checker quotations on identical article bytes without consuming an article repair", async () => {
    const { call, requests } = harness();
    const result = await runNoticePipeline({ payload, kind: "regular", call, maxRepairAttempts: 0 });
    expect(result.decision).toBe("publish");
    expect(result.audit.repairAttempts).toBe(0);
    expect(result.audit.iterations).toHaveLength(1);
    const iteration = result.audit.iterations[0]!;
    expect(iteration.referenceCheckAttempts).toHaveLength(2);
    expect(iteration.referenceCheckAttempts.map(attempt => attempt.draftSha256)).toEqual([iteration.draftSha256, iteration.draftSha256]);
    expect(iteration.referenceCheckAttempts[0]?.coverage?.items[2]?.priorUses?.[0]).toMatchObject({
      sourceEvidence: malformedEvidence, sourceEvidenceMatchesCitedSource: false
    });
    expect(iteration.referenceCheckAttempts[1]?.coverage?.items[2]?.priorUses?.[0]).toMatchObject({
      sourceEvidence: priorEvidence, sourceEvidenceMatchesCitedSource: true
    });
    expect(result.rewrite?.body).toEqual([history, finality]);
    expect(requests.filter(request => request.schemaName === "notice_rewrite_output")).toHaveLength(1);
    expect(requests.filter(request => request.schemaName === "notice_editorial_coverage")).toHaveLength(1);
    const checks = requests.filter(request => request.schemaName === "reference_check_result");
    expect(checks).toHaveLength(2);
    expect(checks[1]?.userPrompt).toContain(malformedEvidence);
    expect(checks[1]?.userPrompt).toContain("prior_evidence_mismatch");
    expect(checks[1]?.userPrompt.endsWith(checks[0]!.userPrompt)).toBe(true);
    expect(checks[1]?.developerPrompt).toContain("Rett kontrollens metadata, ikke artikkelen");
  });

  it.each(["ellipsis", "unknown_source", "missing_number_anchor"] as const)("still blocks persistent %s after exactly one checker retry", async fault => {
    const { call, requests } = harness({ fault, persistent: true });
    const result = await runNoticePipeline({ payload, kind: "regular", call, maxRepairAttempts: 0 });
    expect(result.decision).toBe("failed");
    expect(result.validation?.blockingErrors.length).toBeGreaterThan(0);
    expect(result.audit.iterations[0]?.referenceCheckAttempts).toHaveLength(2);
    expect(result.audit.iterations[0]?.referenceCheckAttempts[1]?.metadataViolations.map(item => item.kind))
      .toContain(fault === "unknown_source" ? "prior_message_unknown" : "prior_evidence_mismatch");
    expect(requests.filter(request => request.schemaName === "reference_check_result")).toHaveLength(2);
    expect(requests.filter(request => request.schemaName === "notice_rewrite_output")).toHaveLength(1);
  });

  it("does not reuse rejected evidence when the metadata retry is unavailable", async () => {
    const { call } = harness({ failReferenceAt: 2 });
    const result = await runNoticePipeline({ payload, kind: "regular", call, maxRepairAttempts: 1 });
    expect(result.decision).toBe("retry");
    expect(result.audit.finalReferenceCoverage).toBeNull();
    expect(result.audit.iterations[0]?.referenceCoverage).toBeNull();
    expect(result.audit.iterations[0]?.referenceCheckAttempts[0]?.coverage).not.toBeNull();
    expect(result.audit.iterations[0]?.referenceCheckAttempts[1]).toMatchObject({ coverage: null, error: "SYNTHETIC_CHECKER_OUTAGE" });
    expect(result.audit.referenceCheck).toMatchObject({ finalCoverage: null, finalCoverageAvailable: false });
  });

  it("invalidates even corrected checker evidence after an article rewrite", async () => {
    const { call, requests } = harness({ omitFinalityFirst: true, failReferenceAt: 3 });
    const result = await runNoticePipeline({ payload, kind: "regular", call, maxRepairAttempts: 1 });
    expect(result.decision).toBe("retry");
    expect(result.audit.iterations).toHaveLength(2);
    expect(result.audit.iterations[0]?.referenceCheckAttempts).toHaveLength(2);
    expect(result.audit.iterations[0]?.referenceCoverage?.coveragePercent).toBe(100);
    expect(result.audit.iterations[0]?.draftSha256).not.toBe(result.audit.iterations[1]?.draftSha256);
    expect(result.audit.iterations[1]?.referenceCoverage).toBeNull();
    expect(result.audit.finalReferenceCoverage).toBeNull();
    expect(result.audit.referenceCheck).toMatchObject({ finalCoverageAvailable: false, outcome: { evaluatedCoverage: "none", evidenceStale: true } });
    expect(requests.filter(request => request.schemaName === "notice_editorial_coverage")).toHaveLength(2);
  });

  it("rejects a checker that changes the sentence while repairing its metadata", async () => {
    const { call } = harness({ changeSentenceAt: 2 });
    const result = await runNoticePipeline({ payload, kind: "regular", call, maxRepairAttempts: 0 });
    expect(result.decision).toBe("retry");
    expect(result.errors.join(" ")).toContain("REFERENCE_CHECK_SENTENCE_MISMATCH");
    expect(result.audit.finalReferenceCoverage).toBeNull();
  });

  it("keeps a genuinely missing historical marker blocking after literal evidence is corrected", async () => {
    const { call } = harness({ unmarkedBackground: true });
    const result = await runNoticePipeline({ payload, kind: "regular", call, maxRepairAttempts: 0 });
    expect(result.decision).toBe("failed");
    expect(result.audit.iterations[0]?.referenceCheckAttempts[1]?.metadataViolations).toEqual([]);
    expect(result.audit.iterations[0]?.referenceCheckAttempts[1]?.coverage?.items[2]?.priorUses?.[0]?.sourceEvidenceMatchesCitedSource).toBe(true);
    expect(result.validation?.blockingErrors.join(" ")).toContain("insufficiently marked");
  });

  it.each([false, true])("uses final repair metadata to remove optional background while essential facts remain required (removed=%s)", async removeEssentialOnRepair => {
    const { call, requests } = harness({ persistent: true, removeBackgroundOnRepair: true, removeEssentialOnRepair });
    const result = await runNoticePipeline({ payload, kind: "regular", call, maxRepairAttempts: 1 });
    expect(result.decision).toBe(removeEssentialOnRepair ? "failed" : "publish");
    expect(result.audit.repairAttempts).toBe(1);
    expect(result.audit.finalCoverage?.missingFactIds).toEqual(removeEssentialOnRepair ? ["finality"] : []);
    const repair = result.audit.iterations[0]?.repairInstruction;
    expect(repair).toContain("Referansereparasjon 1 av 1.");
    expect(repair).toContain("Dette er siste reparasjonsforsøk");
    expect(repair).toContain("valgfri bakgrunn utenfor brief.mustInclude");
    expect(requests.filter(request => request.schemaName === "reference_check_result")).toHaveLength(3);
    expect(requests.filter(request => request.schemaName === "notice_editorial_coverage")).toHaveLength(2);
  });

  it("gives completeness review raw source conditions beyond the brief excerpts", async () => {
    const lateCondition = "The dividend may be declared before completion, but payment is conditional on the acquisition becoming effective.";
    const reportText = `REPORT\n${"Other source detail. ".repeat(200)}\n${lateCondition}`;
    const completePayload = { ...payload, hasAttachments: true, reportReferenceText: reportText, reportCompleteness: "complete" as const };
    const { call, requests } = harness();
    await runNoticePipeline({ payload: completePayload, kind: "regular", call, maxRepairAttempts: 0 });
    const coverage = requests.find(request => request.schemaName === "notice_editorial_coverage");
    expect(coverage).toBeDefined();
    const reviewPayload = JSON.parse(coverage!.userPrompt) as { brief: unknown; sources: Array<{ id: string; kind: string; text: string }> };
    expect(JSON.stringify(reviewPayload.brief)).not.toContain(lateCondition);
    expect(reviewPayload.sources.find(source => source.id === "primary")?.text).toContain(reportText);
    expect(reviewPayload.sources.find(source => source.id === "primary")?.kind).toBe("primary");
    expect(reviewPayload.sources.find(source => source.id === "prior_990049")?.text).toBe(priorEvidence);
  });
});
