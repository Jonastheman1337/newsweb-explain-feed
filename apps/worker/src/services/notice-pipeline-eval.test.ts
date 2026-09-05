import fs from "node:fs/promises";
import { defaultEnabledDerivationRules, type NoticeEditorialBrief } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it, vi } from "vitest";
import { parseNoticePipelineEvalCliArgs } from "../scripts/notice-pipeline-eval.js";
import { sha256CanonicalJson, sourcePayloadSha256, type EvalGitSourceState } from "./editorial-eval-artifact.js";
import type { NoticeJsonCaller, NoticeJsonRequest, NoticeModelCallLog } from "./notice-model-client.js";
import { NOTICE_PIPELINE_VERSION } from "./notice-pipeline.js";
import {
  evaluateNoticePipelineCase, parseNoticePipelineEvalCases, runNoticePipelineEvaluation,
  summarizeNoticeEvalUsage, type NoticePipelineEvalCase
} from "./notice-pipeline-eval.js";

// Synthetic fixtures: these companies and announcements are invented.
const priceEvidence = "Eksempelverk ASA har inngått en avtale om å kjøpe Testverksted AS for 100 millioner kroner.";
const conditionEvidence = "Avtalen er betinget av myndighetsgodkjenning.";
const source = `${priceEvidence} ${conditionEvidence}`;
const payload = {
  messageId: 990010, title: "Syntetisk oppkjøpsmelding", issuerName: "Eksempelverk ASA", issuerSign: "SYNTH",
  publishedAt: "2026-09-04T08:00:00.000Z", categories: ["Acquisition"], markets: ["Oslo"],
  bodyText: source, sourceBodyChars: source.length, hasAttachments: false
};
const evalCase: NoticePipelineEvalCase = {
  schemaVersion: 1, caseId: "synthetic-omission-repair-v1", provenance: "synthetic", kind: "regular",
  payload, sourceSha256: sourcePayloadSha256(payload), expectedDecision: "publish"
};
const brief: NoticeEditorialBrief = {
  newsworthy: true, reason: "Ny avtale om et oppkjøp med et vesentlig vilkår.",
  eventType: "acquisition", eventStatus: "Avtalt; myndighetsgodkjenning gjenstår.",
  angle: "Eksempelverk avtaler kjøp for 100 millioner kroner.",
  mustInclude: [
    { id: "price", fact: priceEvidence, sourceId: "primary", sourceEvidence: priceEvidence },
    { id: "condition", fact: conditionEvidence, sourceId: "primary", sourceEvidence: conditionEvidence }
  ],
  usefulQuote: null, sourceLimitations: []
};
const initialDraft: RewriteOutput = {
  title: "Eksempelverk avtaler kjøp for 100 millioner",
  lead: "Eksempelverk ASA har avtalt å kjøpe Testverksted AS for 100 millioner kroner, ifølge selskapet.",
  body: [], company_sentence: "", key_facts: ["Oppkjøpsavtale for 100 millioner kroner"],
  negative_or_surprising: [], excluded_hype: [], source_limitations: [], confidence: "high", importance: "medium",
  source_spans: [`primary: ${priceEvidence}`]
};
const repairedDraft: RewriteOutput = {
  ...initialDraft, body: [conditionEvidence], source_spans: [`primary: ${priceEvidence}`, `primary: ${conditionEvidence}`]
};

function callLog(request: NoticeJsonRequest, failed = false): NoticeModelCallLog {
  return {
    ...request, provider: "openai", model: "mock-notice-model", reasoningEffort: request.reasoningEffort ?? "medium",
    timeoutMs: 1000, maxOutputTokens: 16384,
    promptChars: request.systemPrompt.length + request.developerPrompt.length + request.userPrompt.length,
    promptCacheMode: "implicit", promptCacheKey: null,
    responseModel: failed ? null : "mock-notice-model-2026", requestedServiceTier: "default",
    serviceTier: failed ? null : "default", attemptCount: 1,
    attempts: [{ responseId: "synthetic-response", status: failed ? "failed" : "completed",
      responseModel: failed ? null : "mock-notice-model-2026", requestedServiceTier: "default", serviceTier: "default",
      durationMs: 1, requestedMaxOutputTokens: 16384, error: failed ? "synthetic outage" : null, rawUsage: null, usage: null }],
    usage: failed ? null : { inputTokens: 20, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 10, reasoningTokens: 3, totalTokens: 30 }
  };
}

function mockPipelineCaller(options: { repair?: boolean; failReference?: boolean; failCheckAfterRepair?: "reference" | "coverage"; skip?: boolean; skipFirstBrief?: boolean } = {}) {
  let rewriteCount = 0;
  let briefCount = 0;
  const requests: NoticeJsonRequest[] = [];
  const call: NoticeJsonCaller = vi.fn(async request => {
    requests.push(request);
    let content: unknown;
    switch (request.schemaName) {
      case "notice_editorial_brief":
        briefCount += 1;
        content = options.skip || (options.skipFirstBrief && briefCount === 1) ? { ...brief, newsworthy: false, mustInclude: [] } : brief;
        break;
      case "notice_rewrite_output":
        rewriteCount += 1;
        content = options.repair !== false && rewriteCount > 1 ? repairedDraft : initialDraft;
        break;
      case "reference_check_result": {
        if (options.failReference || (options.failCheckAfterRepair === "reference" && rewriteCount > 1)) throw Object.assign(new Error("SYNTHETIC_REFERENCE_OUTAGE"), { modelCall: callLog(request, true) });
        const marker = "SETNINGER SOM SKAL SJEKKES (indeks + tekst):\n";
        const sentences = JSON.parse(request.userPrompt.slice(request.userPrompt.lastIndexOf(marker) + marker.length)) as Array<{ index: number; sentence: string }>;
        content = { sentences: sentences.map(sentence => ({ ...sentence, grounded: true, interpretation: "Dekket av syntetisk kildetekst.", sourceEvidence: source, source: "primary", priorUses: [] })) };
        break;
      }
      case "notice_editorial_coverage": {
        if (options.failCheckAfterRepair === "coverage" && rewriteCount > 1) throw Object.assign(new Error("SYNTHETIC_COVERAGE_OUTAGE"), { modelCall: callLog(request, true) });
        const { article } = JSON.parse(request.userPrompt) as { article: { body: string[] } };
        const complete = article.body.some(paragraph => paragraph.includes("myndighetsgodkjenning"));
        content = {
          coveredFactIds: complete ? ["price", "condition"] : ["price"], missingFactIds: complete ? [] : ["condition"],
          statusAccurate: true, instructionCompliant: true,
          semanticChecks: { actorAndPayment: "pass", metricAndMaterialScope: "pass", relativeQuantityContext: "not_applicable" },
          semanticFindings: [],
          findings: complete ? [] : ["Det vesentlige vilkåret om myndighetsgodkjenning mangler."],
          repairInstruction: complete ? "" : "Ta med at avtalen er betinget av myndighetsgodkjenning. Behold resten."
        };
        break;
      }
      default:
        throw new Error(`Unexpected shared-pipeline schema: ${request.schemaName}`);
    }
    const modelCall = callLog(request);
    return { content: JSON.stringify(content), promptChars: modelCall.promptChars, modelCall };
  });
  return { call, requests };
}

const sourceState: EvalGitSourceState = {
  headRevision: "synthetic-checkout", dirty: false, changedPaths: [], trackedDiffSha256: "0".repeat(64),
  untrackedFiles: [], sourceStateSha256: "1".repeat(64)
};
const profile = { model: "mock-notice-model", reasoningEffort: "medium" as const, referenceReasoningEffort: "medium" as const, reviewReasoningEffort: "medium" as const, serviceTier: "default" as const, timeoutMs: 1000, maxOutputTokens: 16384 };

describe("full notice-pipeline evaluation", () => {
  it("records the actual repaired final output from the shared pipeline", async () => {
    const { call, requests } = mockPipelineCaller();
    let tick = 0;
    const result = await evaluateNoticePipelineCase({ evalCase, call, pipelineOptions: { allowSkip: true, maxRepairAttempts: 1 }, now: () => 1000 + 25 * tick++ });
    expect(result.decision).toBe("publish");
    expect(result.pipelineVersion).toBe(NOTICE_PIPELINE_VERSION);
    expect(result.initialDraft?.body).toEqual([]);
    expect(result.finalOutput?.body).toEqual([conditionEvidence]);
    expect(result.finalOutputSha256).toBe(sha256CanonicalJson(result.finalOutput));
    expect(result.initialDraftSha256).not.toBe(result.finalOutputSha256);
    expect(result.changedAfterInitialDraft).toBe(true);
    expect(result.audit?.repairAttempts).toBe(1);
    expect(result.audit?.iterations).toHaveLength(2);
    expect(result.latencyMs).toBe(25);
    expect(requests.filter(request => request.schemaName === "notice_rewrite_output")).toHaveLength(2);
    expect(requests.filter(request => request.schemaName === "reference_check_result")).toHaveLength(2);
    expect(requests.filter(request => request.schemaName === "notice_editorial_coverage")).toHaveLength(2);
    expect(result.usage.totals?.totalTokens).toBe(result.modelCalls.length * 30);
    expect(result.expectedDecisionMatches).toBe(true);
  });

  it("retains omission blocking even when every written sentence is reference-grounded", async () => {
    const { call } = mockPipelineCaller({ repair: false });
    const result = await evaluateNoticePipelineCase({ evalCase, call, pipelineOptions: { allowSkip: true, maxRepairAttempts: 1 } });
    expect(result.decision).not.toBe("publish");
    expect(result.finalOutput).toBeNull();
    expect(result.finalDraft).not.toBeNull();
    expect(result.initialDraft).not.toBeNull();
    expect(result.audit?.finalCoverage?.missingFactIds).toEqual(["condition"]);
    expect(result.audit?.finalReferenceCoverage?.coveragePercent).toBe(100);
    expect(result.expectedDecisionMatches).toBe(false);
  });

  it("keeps failed-call telemetry and never substitutes an unchecked initial draft", async () => {
    const { call } = mockPipelineCaller({ failReference: true });
    const result = await evaluateNoticePipelineCase({ evalCase, call, pipelineOptions: { allowSkip: true } });
    expect(result.decision).not.toBe("publish");
    expect(result.finalOutput).toBeNull();
    expect(result.finalOutputSha256).toBeNull();
    expect(result.finalDraft).not.toBeNull();
    expect(result.errors.join(" ")).toContain("SYNTHETIC_REFERENCE_OUTAGE");
    expect(result.modelCalls.some(item => item.schemaName === "reference_check_result")).toBe(true);
    expect(result.usage.callsWithoutUsage).toBeGreaterThan(0);
    expect(result.usage.complete).toBe(false);
  });

  it("records skip decisions with no fabricated draft or hash", async () => {
    const { call } = mockPipelineCaller({ skip: true });
    const result = await evaluateNoticePipelineCase({ evalCase: { ...evalCase, expectedDecision: "skip" }, call, pipelineOptions: { allowSkip: true } });
    expect(result.decision).toBe("skip");
    expect(result.initialDraft).toBeNull();
    expect(result.finalOutputSha256).toBeNull();
    expect(result.modelCalls).toHaveLength(1);
    expect(result.expectedDecisionMatches).toBe(true);
  });

  it.each(["reference", "coverage"] as const)("does not reuse the first draft's %s check when the repaired draft's check fails", async check => {
    const result = await evaluateNoticePipelineCase({
      evalCase, call: mockPipelineCaller({ failCheckAfterRepair: check }).call,
      pipelineOptions: { allowSkip: true, maxRepairAttempts: 1 }
    });
    expect(result.decision).toBe("retry");
    expect(result.finalOutput).toBeNull();
    expect(result.finalDraft?.body).toEqual([conditionEvidence]);
    expect(result.audit?.iterations).toHaveLength(2);
    expect(result.audit?.iterations[0]?.referenceCoverage?.coveragePercent).toBe(100);
    expect(check === "reference" ? result.audit?.finalReferenceCoverage : result.audit?.finalCoverage).toBeNull();
    expect(result.errors.join(" ")).toContain("NOTICE_CHECK_UNAVAILABLE");
    if (check === "reference") {
      expect(result.audit?.referenceCheck?.outcome).toMatchObject({
        state: "unavailable_error", evaluatedCoverage: "none", evidenceStale: true, shadow: { wouldRetry: true }
      });
      expect(result.audit?.referenceCheck).toMatchObject({
        finalCoverage: null, finalCoveragePercent: null, totalSentences: null,
        unsupportedSentenceCount: null, sentenceReviews: [], unsupportedSentences: [],
        finalCoverageAvailable: false
      });
    }
  });

  it("replans an empty skip brief for a forced manual draft", async () => {
    const { call, requests } = mockPipelineCaller({ skipFirstBrief: true });
    const result = await evaluateNoticePipelineCase({ evalCase, call, pipelineOptions: { allowSkip: false, maxRepairAttempts: 1 } });
    expect(result.decision).toBe("publish");
    const briefRequests = requests.filter(request => request.schemaName === "notice_editorial_brief");
    expect(briefRequests).toHaveLength(2);
    expect(JSON.parse(briefRequests[0]!.userPrompt).allowSkip).toBe(false);
    expect(result.audit?.briefErrors[0]?.join(" ")).toContain("forced draft request");
    expect(result.brief?.mustInclude).not.toHaveLength(0);
  });

  it.each([true, false])("retains rejected evidence and gives the retry its failed brief (corrected=%s)", async corrected => {
    const base = mockPipelineCaller();
    const rejected = { ...brief, mustInclude: [{ ...brief.mustInclude[0]!,
      sourceEvidence: "Eksempelverk opplyser at kjøpesummen er 100 millioner kroner."
    }] };
    let briefCount = 0;
    const call: NoticeJsonCaller = async request => {
      const response = await base.call(request);
      if (request.schemaName === "notice_editorial_brief" && (++briefCount === 1 || !corrected)) {
        response.content = JSON.stringify(rejected);
      }
      return response;
    };
    const result = await evaluateNoticePipelineCase({ evalCase, call, pipelineOptions: { allowSkip: true, maxRepairAttempts: 1 } });
    expect(result.audit?.briefAttempts).toHaveLength(2);
    expect(result.audit?.briefAttempts[0]?.brief).toEqual(rejected);
    expect(result.audit?.briefAttempts[0]?.errors).toEqual(["Fact price does not quote its named source exactly."]);
    const retry = base.requests.filter(request => request.schemaName === "notice_editorial_brief")[1]!;
    expect(retry.userPrompt).toContain(JSON.stringify(rejected));
    expect(retry.userPrompt).toContain("Fact price does not quote its named source exactly.");
    if (corrected) {
      expect(result.decision).toBe("publish");
      expect(result.audit?.briefAttempts[1]?.errors).toEqual([]);
      expect(result.brief).toEqual(brief);
    } else {
      expect(result.decision).toBe("retry");
      expect(result.brief).toBeNull();
      expect(result.finalOutput).toBeNull();
      expect(result.modelCalls).toHaveLength(2);
      expect(result.errors.join(" ")).toContain("EDITORIAL_BRIEF_UNGROUNDED");
    }
  });

  it.each([initialDraft.title, "Eksempelverk ASA avtaler kjøp for 100 millioner"])("preserves and checks title-only edits despite writer omissions and style cleanup: %s", async revisedTitle => {
    const previousOutput = { ...repairedDraft, title: "Eksempelverk inngår en kjøpsavtale" };
    const base = mockPipelineCaller({ repair: false });
    const { requests } = base;
    const call: NoticeJsonCaller = async request => {
      const response = await base.call(request);
      if (request.schemaName === "notice_rewrite_output") {
        response.content = JSON.stringify({ ...JSON.parse(response.content), title: revisedTitle });
      }
      return response;
    };
    const result = await evaluateNoticePipelineCase({
      evalCase: { ...evalCase, previousOutput, instruction: `Endre bare tittelen til «${revisedTitle}». Behold ingress og brødtekst nøyaktig uendret.` },
      call, pipelineOptions: { allowSkip: false, maxRepairAttempts: 0 }
    });
    expect(result.decision).toBe("publish");
    expect(result.finalOutput?.title).toBe(revisedTitle);
    expect(result.finalOutput?.lead).toBe(previousOutput.lead);
    expect(result.finalOutput?.lead).toContain("ASA");
    expect(result.finalOutput?.body).toEqual(previousOutput.body);
    expect(result.initialDraft?.body).toEqual([]);
    expect(result.audit?.repairAttempts).toBe(0);
    const coverageRequest = requests.find(request => request.schemaName === "notice_editorial_coverage")!;
    expect(JSON.parse(coverageRequest.userPrompt).article).toEqual({
      title: revisedTitle, lead: previousOutput.lead, body: previousOutput.body
    });
    const referenceRequest = requests.find(request => request.schemaName === "reference_check_result")!;
    expect(referenceRequest.userPrompt).toContain(previousOutput.lead);
    expect(result.audit?.finalCoverage?.missingFactIds).toEqual([]);
  });

  it("allows a combined title and lead request instead of freezing the lead on a broad legacy title match", async () => {
    const revisedLead = "Eksempelverk avtaler å kjøpe Testverksted AS for 100 millioner kroner, ifølge selskapet.";
    const base = mockPipelineCaller();
    const call: NoticeJsonCaller = async request => {
      const response = await base.call(request);
      if (request.schemaName === "notice_rewrite_output") {
        response.content = JSON.stringify({ ...JSON.parse(response.content), lead: revisedLead, body: repairedDraft.body });
      }
      return response;
    };
    const result = await evaluateNoticePipelineCase({
      evalCase: { ...evalCase, previousOutput: repairedDraft, instruction: "Endre tittelen og ingressen." },
      call, pipelineOptions: { allowSkip: false, maxRepairAttempts: 0 }
    });
    expect(result.decision).toBe("publish");
    expect(result.finalOutput?.lead).toBe(revisedLead);
    expect(result.finalOutput?.lead).not.toBe(repairedDraft.lead);
    expect(base.requests.find(request => request.schemaName === "notice_rewrite_output")?.userPrompt)
      .not.toContain("behold lead og body mest mulig uendret");
    expect(result.validation?.revisionCompliance?.intents).not.toContainEqual({ type: "title_only" });
  });

  it.each([
    ["partial", "high", "medium"],
    ["partial", "low", "low"],
    ["complete", "high", "high"]
  ] as const)("keeps %s report confidence calibrated across repairs: %s to %s", async (completeness, modelConfidence, expectedConfidence) => {
    const reportPayload = { ...payload, hasAttachments: true, reportText: source,
      reportReferenceText: source, reportCompleteness: completeness };
    const base = mockPipelineCaller();
    const call: NoticeJsonCaller = async request => {
      const response = await base.call(request);
      if (request.schemaName === "notice_rewrite_output") {
        response.content = JSON.stringify({ ...JSON.parse(response.content), confidence: modelConfidence });
      }
      return response;
    };
    const result = await evaluateNoticePipelineCase({
      evalCase: { ...evalCase, kind: "report", payload: reportPayload, sourceSha256: sourcePayloadSha256(reportPayload) },
      call, pipelineOptions: { allowSkip: true, maxRepairAttempts: 1 }
    });
    expect(result.decision).toBe("publish");
    expect(result.audit?.repairAttempts).toBe(1);
    expect(result.initialDraft?.confidence).toBe(modelConfidence);
    expect(result.audit?.iterations.every(iteration => iteration.draft.confidence === expectedConfidence)).toBe(true);
    expect(result.finalOutput?.confidence).toBe(expectedConfidence);
  });

  it.each([
    "Haugaland Kraft AS - Half-Year Report 2026", "H1 2026 Financial Report", "Q2 2026 results"
  ])("blocks missing report evidence on a regular fallback: %s", async title => {
    const reportPayload = { ...payload, title, hasAttachments: true, categories: ["Half yearly financial reports and audit reports"] };
    const { call, requests } = mockPipelineCaller();
    const result = await evaluateNoticePipelineCase({
      evalCase: { ...evalCase, payload: reportPayload, sourceSha256: sourcePayloadSha256(reportPayload) },
      call, pipelineOptions: { allowSkip: true }
    });
    expect(result.decision).toBe("retry");
    expect(result.errors.join(" ")).toContain("INCOMPLETE_REPORT_SOURCE");
    expect(result.finalOutput).toBeNull();
    expect(requests.filter(request => request.schemaName === "notice_rewrite_output")).toHaveLength(0);
  });

  it("validates a simplify-only revision against the original request without inventing a shortening target", async () => {
    const { call, requests } = mockPipelineCaller();
    const result = await evaluateNoticePipelineCase({
      evalCase: { ...evalCase, instruction: "Skriv enklere.", previousOutput: repairedDraft },
      call, pipelineOptions: { allowSkip: false, maxRepairAttempts: 1 }
    });
    expect(result.decision).toBe("publish");
    expect(result.finalOutput?.body).toEqual(repairedDraft.body);
    expect(result.validation?.revisionCompliance?.intents).toEqual([{ type: "simplify" }]);
    expect(result.validation?.revisionCompliance?.passed).toBe(true);
    const plan = JSON.parse(requests.find(request => request.schemaName === "notice_editorial_brief")!.userPrompt);
    expect(plan.instruction).toBe("Skriv enklere.");
    expect(plan.previousArticle.body).toEqual(repairedDraft.body);
    expect(requests.find(request => request.schemaName === "notice_rewrite_output")?.userPrompt).toContain("kortere setninger");
  });

  it("preflights all source identities before the first model call", async () => {
    const { call } = mockPipelineCaller();
    const changedCase = { ...evalCase, caseId: "changed-source", payload: { ...payload, bodyText: "Changed after freeze" } };
    await expect(runNoticePipelineEvaluation({
      cases: [evalCase, changedCase], sourceCasesPath: "synthetic.jsonl", sourceCasesFileSha256: "2".repeat(64), sourceState,
      profile, pipelineOptions: { allowSkip: true }, call
    })).rejects.toThrow("Source hash mismatch");
    expect(call).not.toHaveBeenCalled();
  });

  it("binds instructions as well as source data into the corpus execution identity", async () => {
    const run = async (instruction?: string) => runNoticePipelineEvaluation({
      cases: [{ ...evalCase, instruction, expectedDecision: "skip" }],
      sourceCasesPath: "synthetic.jsonl", sourceCasesFileSha256: "2".repeat(64), sourceState,
      profile, pipelineOptions: { allowSkip: true }, call: mockPipelineCaller({ skip: true }).call
    });
    const [first, changed] = await Promise.all([run(), run("Behold det materielle vilkåret.")]);
    expect(first.corpus.corpusSha256).toBe(changed.corpus.corpusSha256);
    expect(first.corpus.corpusExecutionSha256).not.toBe(changed.corpus.corpusExecutionSha256);
    expect(first.artifactType).toBe("notice_full_pipeline_eval");
    expect(first.summary.decisions.skip).toBe(1);
    expect(first.evidencePolicy.syntheticCases).toBe(1);
    expect(first.generations[0]?.pipelineVersion).toBe(NOTICE_PIPELINE_VERSION);
    expect(first.pipelineOptions.enabledDerivationRules).toEqual(defaultEnabledDerivationRules);
    expect(first.numberDerivationPolicy.source).toBe("code_default");
  });

  it("passes separate generation, reference and review effort through the actual pipeline", async () => {
    const { call, requests } = mockPipelineCaller();
    const artifact = await runNoticePipelineEvaluation({
      cases: [evalCase], sourceCasesPath: "synthetic.jsonl", sourceCasesFileSha256: "2".repeat(64), sourceState,
      profile: { ...profile, reasoningEffort: "high", referenceReasoningEffort: "low", reviewReasoningEffort: "minimal" },
      pipelineOptions: { allowSkip: true, enabledDerivationRules: [] }, call
    });
    expect(requests.filter(item => item.schemaName === "notice_rewrite_output").every(item => item.reasoningEffort === "high")).toBe(true);
    expect(requests.filter(item => item.schemaName === "reference_check_result").every(item => item.reasoningEffort === "low")).toBe(true);
    expect(requests.filter(item => item.schemaName === "notice_editorial_coverage").every(item => item.reasoningEffort === "minimal")).toBe(true);
    expect(artifact.numberDerivationPolicy).toEqual({ source: "explicit_override", enabledRuleIds: [] });
  });

  it("preserves frozen extraction diagnostics in the shared validation pass", async () => {
    const reportExtraction = { metrics: [], diagnostics: { fallbackUsed: true, incomeStatementFound: false } };
    const result = await evaluateNoticePipelineCase({
      evalCase: { ...evalCase, reportExtraction }, call: mockPipelineCaller().call,
      pipelineOptions: { allowSkip: true, maxRepairAttempts: 0 }
    });
    expect(result.finalDraft?.source_limitations).toContain("Ekstra kildetekst er analysert som begrenset kildegrunnlag.");
  });
});

describe("frozen full-pipeline case input", () => {
  it("loads the checked-in invented examples with their exact hashes", async () => {
    const raw = await fs.readFile(new URL("../fixtures/notice-pipeline-eval.synthetic.jsonl", import.meta.url), "utf8");
    const cases = parseNoticePipelineEvalCases(raw);
    expect(cases).toHaveLength(2);
    expect(cases.every(item => item.provenance === "synthetic")).toBe(true);
  });

  it("rejects duplicate stable ids and identifies malformed source line numbers", () => {
    expect(() => parseNoticePipelineEvalCases(`${JSON.stringify(evalCase)}\n${JSON.stringify(evalCase)}`)).toThrow("Duplicate caseId");
    expect(() => parseNoticePipelineEvalCases(`${JSON.stringify(evalCase)}\ninvalid`)).toThrow("line 2");
    expect(() => parseNoticePipelineEvalCases("\n")).toThrow("at least one");
  });

  it("preserves report evidence and nullable annual-source fields", () => {
    const reportPayload = { ...payload, reportReferenceText: source, reportCompleteness: "partial", letterText: null, remunerationText: null };
    const [parsed] = parseNoticePipelineEvalCases(JSON.stringify({ ...evalCase, payload: reportPayload, sourceSha256: sourcePayloadSha256(reportPayload) }));
    expect(parsed?.payload).toEqual(reportPayload);
  });

  it("keeps unavailable usage distinct from zero usage", () => {
    expect(summarizeNoticeEvalUsage([]).totals).toBeNull();
    const request = { schemaName: "synthetic", schema: {}, systemPrompt: "", developerPrompt: "", userPrompt: "" };
    const summary = summarizeNoticeEvalUsage([callLog(request), callLog(request, true)]);
    expect(summary.totals?.totalTokens).toBe(30);
    expect(summary.callsWithoutUsage).toBe(1);
    expect(summary.complete).toBe(false);
  });
});

describe("full-pipeline CLI options", () => {
  const args = ["--preflight", "--cases", "synthetic.jsonl", "--model", "mock-model", "--effort", "medium", "--reference-effort", "medium", "--review-effort", "medium", "--service-tier", "default"];

  it("requires an explicit model profile even for offline preflight", () => {
    expect(parseNoticePipelineEvalCliArgs(args)).toMatchObject({ preflight: true, profile: { model: "mock-model", reasoningEffort: "medium", serviceTier: "default" }, pipelineOptions: { allowSkip: true } });
    expect(() => parseNoticePipelineEvalCliArgs(["--preflight", "--cases", "synthetic.jsonl"])).toThrow("--model is required");
  });

  it("requires an artifact destination before a paid run", () => {
    expect(() => parseNoticePipelineEvalCliArgs(args.slice(1))).toThrow("--out is required");
  });

  it.each(["--effort", "--reference-effort", "--review-effort"])("requires a deliberate hard model for %s and preserves an intentional same-model selection", key => {
    const hardArgs = [...args];
    hardArgs[hardArgs.indexOf(key) + 1] = "xhigh";
    expect(() => parseNoticePipelineEvalCliArgs(hardArgs)).toThrow("--hard-model is required");
    expect(parseNoticePipelineEvalCliArgs([...hardArgs, "--hard-model", "mock-hard-model"]).profile.hardModel).toBe("mock-hard-model");
    expect(parseNoticePipelineEvalCliArgs([...hardArgs, "--hard-model", "mock-model"]).profile.hardModel).toBe("mock-model");
  });

  it.each([
    ["--unknown"], ["--effort", "high"], ["--max-repairs", "-1"], ["--max-repairs", "4"], ["--timeout-ms", "0"], ["--max-output-tokens", "NaN"], ["--derivation-rules", "invented_rule"]
  ])("rejects ambiguous or invalid options: %s", (...tail) => {
    expect(() => parseNoticePipelineEvalCliArgs([...args, ...tail])).toThrow();
  });
});
