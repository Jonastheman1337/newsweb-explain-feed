import type { NoticeEditorialBrief } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import { describe, expect, it } from "vitest";
import type { NoticePayload } from "./notice-evidence.js";
import type { NoticeJsonCaller, NoticeJsonRequest, NoticeModelCallLog } from "./notice-model-client.js";
import { runNoticePipeline } from "./notice-pipeline.js";

// Invented source/claim pairs. Sentence grounding and brief coverage deliberately
// pass so these exercise the independent semantic gate in the actual pipeline.
const scenarios = [
  {
    check: "actorAndPayment", field: "lead",
    source: "Kjøperen betaler 100 millioner kroner. Målselskapet betaler et utbytte på 20 millioner kroner dersom oppkjøpet gjennomføres. Samlet aksjonærverdi er 120 millioner kroner.",
    title: "Avtaler oppkjøp",
    lead: "Kjøperen betaler 120 millioner kroner dersom oppkjøpet gjennomføres.", body: [],
    corrected: "Kjøperen betaler 100 millioner kroner, mens målselskapet betaler 20 millioner i utbytte dersom oppkjøpet gjennomføres.",
    explanation: "Kjøperens betaling inkluderer feilaktig målselskapets utbytte.",
    repair: "Skill kjøperens 100 millioner fra målselskapets betingede utbytte på 20 millioner."
  },
  {
    check: "metricAndMaterialScope", field: "title",
    source: "Anlegget behandlet 100 tonn materiale, fordelt på 20 tonn malm og 80 tonn restmasser.",
    title: "Anlegget behandlet 100 tonn malm", lead: "Anlegget behandlet 100 tonn materiale, ifølge selskapet.", body: [],
    corrected: "Anlegget behandlet 100 tonn materiale",
    explanation: "Tittelen gjør samlet materiale til malm selv om malm bare er en del av totalen.",
    repair: "Bruk materiale om totalen i tittelen, og behold den kildekorrekte mengden."
  },
  {
    check: "relativeQuantityContext", field: "lead",
    source: "På lageret ligger 100 tonn malm. Jernbanen kan gi tilgang til ytterligere 100 tonn malm.",
    title: "Jernbane kan gi tilgang til mer malm",
    lead: "Jernbanen kan gi tilgang til en tilsvarende mengde malm.", body: ["På lageret ligger 100 tonn malm."],
    corrected: "Jernbanen kan gi tilgang til ytterligere 100 tonn malm.",
    explanation: "Den relative mengden har ingen identifiserbar tidligere mengde i den synlige artikkelen.",
    repair: "Skriv ytterligere 100 tonn i ingressen slik at mengden er entydig."
  },
  {
    check: "materialEventCoverage", field: "lead", findingKind: "material_omission",
    source: "Omsetningen var 100 millioner kroner. Selskapet legger ned kjølevirksomheten og har stengt pilotanlegget.",
    briefFact: "Omsetningen var 100 millioner kroner.",
    title: "Selskapet hadde 100 millioner i omsetning",
    lead: "Selskapet hadde en omsetning på 100 millioner kroner.", body: [],
    corrected: "Selskapet hadde en omsetning på 100 millioner kroner. Det legger samtidig ned kjølevirksomheten og har stengt pilotanlegget.",
    explanation: "Artikkelen utelater den varslede nedleggelsen selv om hele den begrensede briefen er dekket.",
    repair: "Behold omsetningen og ta med den kildebelagte nedleggelsen av kjølevirksomheten."
  },
  {
    check: "materialEventCoverage", field: "lead", findingKind: "material_omission",
    source: "Styret har vedtatt et utbytte på 10 kroner per aksje. I tillegg blir det utbetalt 5 kroner per aksje dersom fartøysalget fullføres.",
    briefFact: "Styret har vedtatt et utbytte på 10 kroner per aksje.",
    title: "Selskapet vedtar utbytte",
    lead: "Styret har vedtatt et utbytte på 10 kroner per aksje.", body: [],
    corrected: "Styret har vedtatt et utbytte på 10 kroner per aksje. I tillegg blir det utbetalt 5 kroner per aksje dersom fartøysalget fullføres.",
    explanation: "Den separat varslede betingede utbetalingen mangler, selv om det ordinære utbyttet er korrekt.",
    repair: "Ta med tilleggsutbyttet på 5 kroner med vilkåret om fullført fartøysalg."
  }
] as const;

function modelLog(request: NoticeJsonRequest): NoticeModelCallLog {
  return { ...request, provider: "openai", model: "synthetic", reasoningEffort: "medium", timeoutMs: 1000,
    maxOutputTokens: 16384, promptChars: request.userPrompt.length, promptCacheMode: "implicit", promptCacheKey: null,
    responseModel: "synthetic", requestedServiceTier: "default", serviceTier: "default", attemptCount: 1,
    attempts: [], usage: null };
}

function harness(scenario: typeof scenarios[number], options: {
  repair?: boolean; malformed?: "source" | "missing_checks"; failAfterRepair?: boolean; inconsistentSkipFirst?: boolean;
} = {}) {
  const payload: NoticePayload = {
    messageId: 990080, title: scenario.title, issuerName: "Eksempelselskapet ASA", issuerSign: "SYNTH",
    publishedAt: "2026-09-04T08:00:00Z", categories: [], markets: [], bodyText: scenario.source,
    sourceBodyChars: scenario.source.length, hasAttachments: false
  };
  const brief: NoticeEditorialBrief = {
    newsworthy: true, reason: "En konkret ny hendelse.", eventType: "update", eventStatus: "Som beskrevet i kilden.",
    angle: "Den nye hendelsen.", mustInclude: [{ id: "event", fact: "briefFact" in scenario ? scenario.briefFact : scenario.source,
      sourceId: "primary", sourceEvidence: "briefFact" in scenario ? scenario.briefFact : scenario.source }],
    usefulQuote: null, sourceLimitations: []
  };
  const initial: RewriteOutput = {
    title: scenario.title, lead: scenario.lead, body: [...scenario.body], company_sentence: "", key_facts: [scenario.source],
    source_spans: [scenario.source], negative_or_surprising: [], excluded_hype: [], source_limitations: [],
    importance: "medium", confidence: "high"
  };
  let writes = 0;
  let briefs = 0;
  const requests: NoticeJsonRequest[] = [];
  const call: NoticeJsonCaller = async request => {
    requests.push(request);
    let content: unknown;
    if (request.schemaName === "notice_editorial_brief") {
      briefs += 1;
      content = options.inconsistentSkipFirst && briefs === 1 ? { ...brief, newsworthy: false } : brief;
    } else if (request.schemaName === "notice_rewrite_output") {
      writes += 1;
      content = options.repair && writes > 1 ? { ...initial, [scenario.field]: scenario.corrected } : initial;
    } else if (request.schemaName === "reference_check_result") {
      const marker = "SETNINGER SOM SKAL SJEKKES (indeks + tekst):\n";
      const sentences = JSON.parse(request.userPrompt.slice(request.userPrompt.lastIndexOf(marker) + marker.length)) as Array<{ index: number; sentence: string }>;
      content = { sentences: sentences.map(sentence => ({ ...sentence, grounded: true, source: "primary",
        sourceEvidence: scenario.source, interpretation: "Syntetisk kontroll godkjenner setningen.", priorUses: [] })) };
    } else if (request.schemaName === "notice_editorial_coverage") {
      if (options.failAfterRepair && writes > 1) throw new Error("SYNTHETIC_SEMANTIC_CHECK_OUTAGE");
      const repaired = options.repair && writes > 1;
      const article = JSON.parse(request.userPrompt).article as { title: string; lead: string; body: string[] };
      const review: Record<string, unknown> = {
        coveredFactIds: ["event"], missingFactIds: [], statusAccurate: true, instructionCompliant: true,
        semanticChecks: { actorAndPayment: "pass", metricAndMaterialScope: "pass", relativeQuantityContext: "pass", materialEventCoverage: "pass",
          [scenario.check]: repaired ? "pass" : "fail" },
        semanticFindings: repaired ? [] : [{ check: scenario.check, kind: "findingKind" in scenario ? scenario.findingKind : "contradiction", articleField: scenario.field,
          articleEvidence: article[scenario.field], sourceId: "primary",
          sourceEvidence: options.malformed === "source" ? "This invented evidence does not occur in the source." : scenario.source,
          explanation: scenario.explanation }],
        findings: [], repairInstruction: repaired ? "" : scenario.repair
      };
      if (options.malformed === "missing_checks") delete review.semanticChecks;
      content = review;
    } else throw new Error(`Unexpected schema ${request.schemaName}`);
    const modelCall = modelLog(request);
    return { content: JSON.stringify(content), promptChars: modelCall.promptChars, modelCall };
  };
  return { payload, call, requests };
}

describe("independent semantic publication gate", () => {
  it.each(scenarios)("blocks $check even when status, grounding and brief coverage pass", async scenario => {
    const { payload, call } = harness(scenario);
    const result = await runNoticePipeline({ payload, kind: "regular", call, maxRepairAttempts: 0 });
    expect(result.decision).toBe("failed");
    expect(result.audit.finalCoverage?.missingFactIds).toEqual([]);
    expect(result.audit.finalCoverage?.statusAccurate).toBe(true);
    expect(result.audit.finalReferenceCoverage?.coveragePercent).toBe(100);
    expect(result.validation?.issues).toContainEqual(expect.objectContaining({ code: "EDITORIAL_SEMANTIC_MISMATCH", severity: "blocking" }));
  });

  it.each(scenarios)("repairs $check and requires fresh checks of the final article", async scenario => {
    const { payload, call, requests } = harness(scenario, { repair: true });
    const result = await runNoticePipeline({ payload, kind: "regular", call, maxRepairAttempts: 1 });
    expect(result.decision).toBe("publish");
    expect(result.rewrite?.[scenario.field]).toBe(scenario.corrected);
    expect(result.audit.iterations).toHaveLength(2);
    expect(result.audit.iterations[0]?.repairInstruction).toContain(scenario.repair);
    expect(result.audit.iterations[0]?.draftSha256).not.toBe(result.audit.iterations[1]?.draftSha256);
    expect(result.audit.finalCoverage?.semanticFindings).toEqual([]);
    for (const schema of ["notice_rewrite_output", "reference_check_result", "notice_editorial_coverage"]) {
      expect(requests.filter(request => request.schemaName === schema)).toHaveLength(2);
    }
  });

  it.each(["source", "missing_checks"] as const)("does not use malformed %s review as permission to repair or publish", async malformed => {
    const { payload, call, requests } = harness(scenarios[0], { malformed, repair: true });
    const result = await runNoticePipeline({ payload, kind: "regular", call, maxRepairAttempts: 1 });
    expect(result.decision).not.toBe("publish");
    expect(result.audit.finalCoverage).toBeNull();
    expect(result.errors.join(" ")).toContain("NOTICE_CHECK_UNAVAILABLE");
    expect(requests.filter(request => request.schemaName === "notice_rewrite_output")).toHaveLength(1);
  });

  it("discards prior semantic approval when the check after repair fails", async () => {
    const { payload, call } = harness(scenarios[1], { repair: true, failAfterRepair: true });
    const result = await runNoticePipeline({ payload, kind: "regular", call, maxRepairAttempts: 1 });
    expect(result.decision).not.toBe("publish");
    expect(result.audit.finalCoverage).toBeNull();
    expect(result.errors.join(" ")).toContain("SYNTHETIC_SEMANTIC_CHECK_OUTAGE");
  });

  it("reconsiders an inconsistent skip instead of discarding its essential facts", async () => {
    const { payload, call, requests } = harness(scenarios[0], { repair: true, inconsistentSkipFirst: true });
    const result = await runNoticePipeline({ payload, kind: "regular", call, maxRepairAttempts: 1, allowSkip: true });
    expect(result.decision).toBe("publish");
    expect(requests.filter(request => request.schemaName === "notice_editorial_brief")).toHaveLength(2);
    expect(result.audit.briefErrors[0]?.length).toBeGreaterThan(0);
    expect(result.audit.briefErrors[1]).toEqual([]);
    expect(result.audit.briefAttempts[0]?.brief).toMatchObject({ newsworthy: false, mustInclude: [{ id: "event" }] });
    const retryRequest = requests.filter(request => request.schemaName === "notice_editorial_brief")[1]!;
    expect(retryRequest.userPrompt).toContain('"newsworthy":false');
    expect(retryRequest.userPrompt).toContain("EDITORIAL_BRIEF_SKIP_CONTRADICTS_ESSENTIAL_FACTS");
  });
});
