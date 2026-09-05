import { describe, expect, it } from "vitest";
import { defaultEnabledDerivationRules, type NumberDerivationRuleId } from "@newsweb/prompt-kit";
import { runNoticePipeline } from "./notice-pipeline.js";
import type { NoticeJsonCaller, NoticeJsonRequest } from "./notice-model-client.js";

// Invented issuer and controlled checker verdicts. These tests deliberately
// make both model checks approve a damaged amount to exercise the real gate.
const row = "Dividends paid to shareholders\t-127.9\t-20.1";
const source = `[PDF page 4]\nParent company financial statements\nEUR million\t2026\t2025\n${row}`;
const draft = {
  title: "Utbytte til eierne", lead: "Selskapet betalte 127,9 millioner euro i utbytte.", body: [],
  key_facts: [], source_spans: [], company_sentence: "", negative_or_surprising: [], excluded_hype: [],
  source_limitations: [], confidence: "medium", importance: "medium"
};
function caller(evidence: string, requests: NoticeJsonRequest[]): NoticeJsonCaller {
  return async request => {
    requests.push(request);
    let content: unknown;
    if (request.schemaName === "notice_editorial_brief") content = {
      newsworthy: true, reason: "Selskapet rapporterer en utbyttebetaling.", eventType: "dividend", eventStatus: "Betalt.",
      angle: "Utbytte betalt til eierne.", mustInclude: [{ id: "payment", fact: "Selskapet rapporterer utbyttebetaling.", sourceId: "primary", sourceEvidence: evidence }],
      usefulQuote: null, sourceLimitations: []
    };
    else if (request.schemaName === "notice_rewrite_output") content = { ...draft,
      key_facts: ["Rapportert utbyttebetaling."], source_spans: [`primary: ${evidence}`] };
    else if (request.schemaName === "reference_check_result") {
      const marker = "SETNINGER SOM SKAL SJEKKES (indeks + tekst):\n";
      const sentences = JSON.parse(request.userPrompt.slice(request.userPrompt.lastIndexOf(marker) + marker.length));
      content = { sentences: sentences.map((sentence: object) => ({ ...sentence, grounded: true, interpretation: "Kontrollert syntetisk godkjenning.", source: "primary", sourceEvidence: evidence, priorUses: [] })) };
    } else if (request.schemaName === "notice_editorial_coverage") content = {
      coveredFactIds: ["payment"], missingFactIds: [], statusAccurate: true, instructionCompliant: true,
      semanticChecks: { actorAndPayment: "pass", metricAndMaterialScope: "pass", relativeQuantityContext: "not_applicable", materialEventCoverage: "pass" },
      semanticFindings: [], findings: [], repairInstruction: ""
    };
    else throw new Error(`Unexpected synthetic schema ${request.schemaName}`);
    return { content: JSON.stringify(content), promptChars: 0, modelCall: {
      ...request, provider: "openai", model: "synthetic-no-network", reasoningEffort: "medium", timeoutMs: 1000, maxOutputTokens: 1000,
      promptChars: 0, promptCacheMode: "implicit", promptCacheKey: null, responseModel: "synthetic-no-network",
      requestedServiceTier: "default", serviceTier: "default", attemptCount: 1, attempts: [], usage: null
    } };
  };
}
async function run(raw: string, enabledDerivationRules?: readonly NumberDerivationRuleId[]) {
  const requests: NoticeJsonRequest[] = [];
  const paymentRow = raw.split("\n").at(-1)!;
  const payload = { messageId: 990190, title: "Årsresultat", issuerName: "Syntetisk Test AS", issuerSign: "SYNTH",
    publishedAt: "2026-08-31T05:00:00Z", categories: ["FINANCIAL REPORTS"], markets: ["XOSL"],
    bodyText: "Selskapet har publisert sitt regnskap.", sourceBodyChars: 39, hasAttachments: true,
    reportReferenceText: raw, reportText: raw, reportCompleteness: "partial" as const };
  return { payload, requests, result: await runNoticePipeline({ payload, kind: "report", call: caller(paymentRow, requests), allowSkip: false, maxRepairAttempts: 0, enabledDerivationRules }) };
}

describe("signed paid amounts through the actual notice pipeline", () => {
  it("publishes a source-bound paid magnitude without the report numeric override", async () => {
    const { result, requests, payload } = await run(source);
    expect(result.decision).toBe("publish");
    expect(result.audit.numericPublicationPolicy).toMatchObject({ unexpectedDisplays: [], corruptedSourceDisplays: [], referenceGroundedOverrideApplied: false });
    expect(result.validation?.publicationNumberAssessments).toContainEqual(expect.objectContaining({ display: "127,9", ruleId: "paid_outflow_magnitude" }));
    const check = requests.find(request => request.schemaName === "reference_check_result")!;
    expect(check.userPrompt).toContain(payload.publishedAt);
    expect(check.userPrompt).toContain("mandag 31. august 2026");
    expect(check.userPrompt).toContain(source);
  });

  it("keeps evaluator-resolved defaults identical to the worker's omitted rule options", async () => {
    const worker = await run(source);
    const evaluator = await run(source, defaultEnabledDerivationRules);
    expect(evaluator.result.decision).toBe("publish");
    expect(evaluator.result.validation?.publicationNumberAssessments).toEqual(worker.result.validation?.publicationNumberAssessments);
    expect(evaluator.result.audit.numericPublicationPolicy).toEqual(worker.result.audit.numericPublicationPolicy);
  });

  it.each([
    { label: "all disabled", enabledDerivationRules: [] as NumberDerivationRuleId[] },
    { label: "paid rule disabled", enabledDerivationRules: defaultEnabledDerivationRules.filter(rule => rule !== "paid_outflow_magnitude") }
  ])("cannot restore an explicitly disabled paid conversion through the report reference override: $label", async ({ enabledDerivationRules }) => {
    const { result } = await run(source, enabledDerivationRules);
    expect(result.decision).toBe("failed");
    expect(result.errors).toContain("Unexpected numbers: 127,9");
    expect(result.audit.finalReferenceCoverage?.coveragePercent).toBe(100);
    expect(result.audit.finalCoverage?.semanticFindings).toEqual([]);
    expect(result.audit.numericPublicationPolicy).toMatchObject({
      unexpectedDisplays: ["127,9"], corruptedSourceDisplays: [], disabledPaidOutflowDisplays: ["127,9"], referenceGroundedOverrideApplied: false
    });
    expect(result.validation?.publicationNumberAssessments).toContainEqual({
      display: "127,9", disposition: "unexpected", ruleId: null, candidateRuleId: "paid_outflow_magnitude", count: 1
    });
  });

  it.each(["\uE000127.9", "-\uE000127.9", "-127.9\uFFFD"])(
    "blocks corrupted-only evidence %s despite current reference and semantic approval", async corruptedCell => {
      const raw = source.replace("-127.9", corruptedCell);
      const { result, requests, payload } = await run(raw);
      expect(result.decision).toBe("failed");
      expect(result.errors).toContain("Unexpected numbers: 127,9");
      expect(result.audit.finalReferenceCoverage?.coveragePercent).toBe(100);
      expect(result.audit.finalCoverage?.semanticFindings).toEqual([]);
      expect(result.audit.numericPublicationPolicy).toMatchObject({ unexpectedDisplays: ["127,9"], corruptedSourceDisplays: ["127,9"], referenceGroundedOverrideApplied: false });
      expect(result.validation?.publicationNumberAssessments).toContainEqual(expect.objectContaining({ display: "127,9", disposition: "unexpected",
        provenance: { corruptedSourceMatchBlocked: true } }));
      // Numeric exclusion never edits the independently retained raw source.
      expect(payload.reportReferenceText).toBe(raw);
      expect(requests.find(request => request.schemaName === "reference_check_result")!.userPrompt).toContain(raw);
    }
  );
});
