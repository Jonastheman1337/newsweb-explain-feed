import { defaultEnabledDerivationRules, numberDerivationRuleIds, type NoticePromptKind, type NumberDerivationRuleId } from "@newsweb/prompt-kit";
import { rewriteOutputSchema, type OpenAITokenUsage, type RewriteOutput } from "@newsweb/shared";
import { z } from "zod";
import {
  createCorpusIdentity,
  sha256CanonicalJson,
  sourcePayloadSha256,
  type EvalGitSourceState
} from "./editorial-eval-artifact.js";
import { buildNoticeEvidence, type NoticePayload } from "./notice-evidence.js";
import type { NoticeJsonCaller, NoticeModelCallLog } from "./notice-model-client.js";
import { routeOpenAIModel } from "./openai-model-routing.js";
import { NOTICE_PIPELINE_VERSION, runNoticePipeline, type NoticePipelineResult } from "./notice-pipeline.js";
import { openAIReasoningEfforts, openAIServiceTiers, type OpenAIReasoningEffort } from "./openai-responses.js";

export const NOTICE_PIPELINE_EVAL_VERSION = "notice_full_pipeline_eval_v1";

const sourceHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const payloadSchema = z.object({
  messageId: z.number().int().positive(),
  title: z.string(),
  issuerName: z.string(),
  issuerSign: z.string(),
  publishedAt: z.string().datetime({ offset: true }),
  categories: z.array(z.string()),
  markets: z.array(z.string()),
  bodyText: z.string(),
  hasAttachments: z.boolean(),
  sourceBodyChars: z.number().int().nonnegative(),
  outputMode: z.enum(["notice", "extended_notice"]).optional(),
  maxVisibleArticleChars: z.number().int().positive().optional(),
  reportText: z.string().optional(),
  reportReferenceText: z.string().optional(),
  reportCompleteness: z.enum(["complete", "partial", "insufficient"]).optional(),
  pdfSupplementText: z.string().optional(),
  letterText: z.string().nullable().optional(),
  remunerationText: z.string().nullable().optional(),
  supplementalMaterials: z.array(z.object({
    id: z.string(), sourceId: z.string(), kind: z.string(), title: z.string(),
    text: z.string(), url: z.string().nullable().optional(), textChars: z.number().optional()
  }).passthrough()).optional(),
  relatedNotices: z.array(z.object({
    messageId: z.number().int().positive(), relation: z.enum(["reference", "correction", "sibling"]),
    title: z.string(), issuerName: z.string(), issuerSign: z.string(), publishedAt: z.string(),
    text: z.string(), textChars: z.number(), resolvedBy: z.enum(["db", "newsweb"]), score: z.number()
  }).passthrough()).optional()
}).passthrough();

const caseSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/),
  provenance: z.enum(["synthetic", "frozen_notice"]),
  kind: z.enum(["regular", "report", "yearly"]),
  sourceSha256: sourceHashSchema,
  payload: payloadSchema,
  instruction: z.string().optional(),
  previousOutput: rewriteOutputSchema.optional(),
  reportExtraction: z.object({
    metrics: z.array(z.unknown()).optional(), metricCandidates: z.array(z.unknown()).optional(),
    diagnostics: z.object({ fallbackUsed: z.boolean().optional(), incomeStatementFound: z.boolean().optional(), openAIPdfFallback: z.boolean().optional() }).passthrough().optional()
  }).passthrough().optional(),
  expectedDecision: z.enum(["publish", "skip", "retry", "failed"]).optional()
}).strict();

export type NoticePipelineEvalCase = Omit<z.infer<typeof caseSchema>, "payload" | "kind"> & {
  payload: NoticePayload;
  kind: NoticePromptKind;
};

export const noticePipelineEvalProfileSchema = z.object({
  model: z.string().trim().min(1).max(160),
  hardModel: z.string().trim().min(1).max(160).optional(),
  reasoningEffort: z.enum(openAIReasoningEfforts),
  referenceReasoningEffort: z.enum(openAIReasoningEfforts),
  reviewReasoningEffort: z.enum(openAIReasoningEfforts),
  serviceTier: z.enum(openAIServiceTiers),
  timeoutMs: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive()
}).strict().superRefine((profile, context) => {
  for (const key of ["reasoningEffort", "referenceReasoningEffort", "reviewReasoningEffort"] as const) {
    if (!routeOpenAIModel({ mainModel: profile.model, hardModel: profile.hardModel ?? "", reasoningEffort: profile[key] })) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["hardModel"], message: `--hard-model is required for ${key}=${profile[key]}; pass the same model explicitly if intentional.` });
      break;
    }
  }
});
export type NoticePipelineEvalProfile = z.infer<typeof noticePipelineEvalProfileSchema>;

export type NoticePipelineEvalOptions = {
  allowSkip: boolean;
  // Undefined deliberately inherits the same default as the worker pipeline.
  maxRepairAttempts?: number;
  reasoningEffort?: OpenAIReasoningEffort;
  referenceReasoningEffort?: OpenAIReasoningEffort;
  reviewReasoningEffort?: OpenAIReasoningEffort;
  enabledDerivationRules?: readonly NumberDerivationRuleId[];
};

export function resolveNoticePipelineEvalOptions(options: NoticePipelineEvalOptions): NoticePipelineEvalOptions & {
  enabledDerivationRules: NumberDerivationRuleId[];
} {
  if (options.maxRepairAttempts !== undefined &&
      (!Number.isInteger(options.maxRepairAttempts) || options.maxRepairAttempts < 0 || options.maxRepairAttempts > 3)) {
    throw new Error("maxRepairAttempts must be an integer from 0 through 3 (the shared pipeline limit).");
  }
  const enabledDerivationRules = z.array(z.enum(numberDerivationRuleIds)).parse(
    options.enabledDerivationRules === undefined ? [...defaultEnabledDerivationRules] : [...options.enabledDerivationRules]
  );
  if (new Set(enabledDerivationRules).size !== enabledDerivationRules.length) throw new Error("Duplicate numeric derivation rule id.");
  return { ...options, enabledDerivationRules };
}

/** Validate the entire frozen corpus before any caller can make a model request. */
export function parseNoticePipelineEvalCases(jsonl: string): NoticePipelineEvalCase[] {
  const cases: NoticePipelineEvalCase[] = [];
  const ids = new Set<string>();
  for (const [index, line] of jsonl.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const item = caseSchema.parse(JSON.parse(line)) as NoticePipelineEvalCase;
      if (ids.has(item.caseId)) throw new Error(`Duplicate caseId: ${item.caseId}`);
      const actualHash = sourcePayloadSha256(item.payload);
      if (item.sourceSha256 !== actualHash) {
        throw new Error(`Source hash mismatch for ${item.caseId}: expected ${item.sourceSha256}, actual ${actualHash}`);
      }
      // Also validates source ids and the fields the pipeline will consume.
      buildNoticeEvidence(item.payload);
      ids.add(item.caseId);
      cases.push(item);
    } catch (error) {
      throw new Error(`Invalid full-pipeline case on line ${index + 1}: ${errorMessage(error)}`);
    }
  }
  if (cases.length === 0) throw new Error("Full-pipeline evaluation needs at least one frozen JSONL case.");
  return cases;
}

export function summarizeNoticeEvalUsage(calls: NoticeModelCallLog[]) {
  const knownUsage = calls.flatMap(call => call.usage ? [call.usage] : []);
  const totals: OpenAITokenUsage | null = knownUsage.length === 0 ? null : {
    inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0,
    outputTokens: 0, reasoningTokens: 0, totalTokens: 0
  };
  if (totals) {
    for (const usage of knownUsage) {
      for (const key of Object.keys(totals) as Array<keyof OpenAITokenUsage>) totals[key] += usage[key];
    }
  }
  return {
    modelCallCount: calls.length,
    providerAttemptCount: calls.reduce((total, call) => total + call.attemptCount, 0),
    callsWithUsage: knownUsage.length,
    callsWithoutUsage: calls.length - knownUsage.length,
    complete: calls.length === knownUsage.length,
    totals
  };
}

export type NoticePipelineEvalGeneration = {
  caseId: string;
  caseSha256: string;
  sourceSha256: string;
  evidenceSha256: string;
  pipelineVersion: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  decision: NoticePipelineResult["decision"];
  expectedDecision: NoticePipelineEvalCase["expectedDecision"] | null;
  expectedDecisionMatches: boolean | null;
  initialDraft: RewriteOutput | null;
  initialDraftSha256: string | null;
  finalDraft: RewriteOutput | null;
  finalDraftSha256: string | null;
  finalOutput: RewriteOutput | null;
  finalOutputSha256: string | null;
  finalVisibleTextSha256: string | null;
  changedAfterInitialDraft: boolean | null;
  brief: NoticePipelineResult["brief"];
  audit: NoticePipelineResult["audit"] | null;
  validation: NoticePipelineResult["validation"];
  modelCalls: NoticeModelCallLog[];
  responseModels: string[];
  servedServiceTiers: string[];
  usage: ReturnType<typeof summarizeNoticeEvalUsage>;
  promptChars: number;
  errors: string[];
  executionError: string | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hashOutput(output: RewriteOutput | null): string | null {
  return output ? sha256CanonicalJson(output) : null;
}

export async function evaluateNoticePipelineCase(options: {
  evalCase: NoticePipelineEvalCase;
  call: NoticeJsonCaller;
  pipelineOptions: NoticePipelineEvalOptions;
  now?: () => number;
}): Promise<NoticePipelineEvalGeneration> {
  const { evalCase } = options;
  const pipelineOptions = resolveNoticePipelineEvalOptions(options.pipelineOptions);
  // Recheck identity for programmatic callers as well as the JSONL CLI.
  parseNoticePipelineEvalCases(JSON.stringify(evalCase));
  const now = options.now ?? Date.now;
  const started = now();
  const observedCalls: NoticeModelCallLog[] = [];
  const trackedCall: NoticeJsonCaller = async request => {
    try {
      const response = await options.call(request);
      observedCalls.push(response.modelCall);
      return response;
    } catch (error) {
      if (error && typeof error === "object" && "modelCall" in error && error.modelCall) {
        observedCalls.push(error.modelCall as NoticeModelCallLog);
      }
      throw error;
    }
  };
  let result: NoticePipelineResult | null = null;
  let executionError: string | null = null;
  try {
    result = await runNoticePipeline({
      payload: structuredClone(evalCase.payload), kind: evalCase.kind,
      instruction: evalCase.instruction,
      previousOutput: evalCase.previousOutput ? structuredClone(evalCase.previousOutput) : undefined,
      reportExtraction: evalCase.reportExtraction ? structuredClone(evalCase.reportExtraction) : undefined,
      ...pipelineOptions, call: trackedCall
    });
  } catch (error) {
    executionError = errorMessage(error);
  }
  const completed = now();
  const modelCalls = result?.modelCalls ?? observedCalls;
  const initialDraft = result?.initialDraft ?? null;
  const finalDraft = result?.rewrite ?? null;
  const finalOutput = result?.decision === "publish" ? finalDraft : null;
  const initialDraftSha256 = hashOutput(initialDraft);
  const finalOutputSha256 = hashOutput(finalOutput);
  const decision = result?.decision ?? "failed";
  return {
    caseId: evalCase.caseId,
    caseSha256: sha256CanonicalJson(evalCase),
    sourceSha256: evalCase.sourceSha256,
    evidenceSha256: result?.audit.sourceSha256 ?? buildNoticeEvidence(evalCase.payload).sha256,
    pipelineVersion: result?.audit.version ?? NOTICE_PIPELINE_VERSION,
    startedAt: new Date(started).toISOString(),
    completedAt: new Date(completed).toISOString(),
    latencyMs: Math.max(0, completed - started),
    decision,
    expectedDecision: evalCase.expectedDecision ?? null,
    expectedDecisionMatches: evalCase.expectedDecision ? evalCase.expectedDecision === decision : null,
    initialDraft,
    initialDraftSha256,
    finalDraft,
    finalDraftSha256: hashOutput(finalDraft),
    finalOutput,
    finalOutputSha256,
    finalVisibleTextSha256: finalOutput ? sha256CanonicalJson({
      title: finalOutput.title, lead: finalOutput.lead, body: finalOutput.body
    }) : null,
    changedAfterInitialDraft: initialDraftSha256 && finalOutputSha256
      ? initialDraftSha256 !== finalOutputSha256 : null,
    brief: result?.brief ?? null,
    audit: result?.audit ?? null,
    validation: result?.validation ?? null,
    modelCalls,
    responseModels: [...new Set(modelCalls.flatMap(call => call.responseModel ? [call.responseModel] : []))],
    servedServiceTiers: [...new Set(modelCalls.flatMap(call => call.serviceTier ? [call.serviceTier] : []))],
    usage: summarizeNoticeEvalUsage(modelCalls),
    promptChars: result?.promptChars ?? modelCalls.reduce((total, call) => total + call.promptChars, 0),
    errors: result?.errors ?? (executionError ? [executionError] : []),
    executionError
  };
}

export async function runNoticePipelineEvaluation(options: {
  cases: NoticePipelineEvalCase[];
  sourceCasesPath: string;
  sourceCasesFileSha256: string;
  sourceState: EvalGitSourceState;
  profile: NoticePipelineEvalProfile;
  pipelineOptions: NoticePipelineEvalOptions;
  call: NoticeJsonCaller;
  onCaseComplete?: (result: NoticePipelineEvalGeneration, index: number, total: number) => void | Promise<void>;
}) {
  const startedAt = new Date().toISOString();
  const profile = noticePipelineEvalProfileSchema.parse(options.profile);
  // Whole-corpus preflight precedes the first request, even via the JS API.
  const cases = parseNoticePipelineEvalCases(options.cases.map(item => JSON.stringify(item)).join("\n"));
  const pipelineOptions = resolveNoticePipelineEvalOptions({
    ...options.pipelineOptions,
    reasoningEffort: profile.reasoningEffort,
    referenceReasoningEffort: profile.referenceReasoningEffort,
    reviewReasoningEffort: profile.reviewReasoningEffort
  });
  const generations: NoticePipelineEvalGeneration[] = [];
  for (const [index, evalCase] of cases.entries()) {
    const result = await evaluateNoticePipelineCase({ evalCase, call: options.call, pipelineOptions });
    generations.push(result);
    await options.onCaseComplete?.(result, index, cases.length);
  }
  const completedAt = new Date().toISOString();
  const corpus = createCorpusIdentity(cases, options.sourceCasesPath);
  const corpusExecutionSha256 = sha256CanonicalJson(cases);
  const decisions = { publish: 0, skip: 0, retry: 0, failed: 0 };
  for (const generation of generations) decisions[generation.decision] += 1;
  return {
    schemaVersion: 1 as const,
    artifactType: "notice_full_pipeline_eval" as const,
    evaluatorVersion: NOTICE_PIPELINE_EVAL_VERSION,
    runId: `notice_pipeline_${startedAt.replace(/[^0-9]/g, "")}_${corpusExecutionSha256.slice(0, 12)}`,
    startedAt, completedAt,
    sourceState: options.sourceState,
    corpus: { ...corpus, corpusExecutionSha256, sourceCasesFileSha256: options.sourceCasesFileSha256 },
    profile: { ...profile, profileSha256: sha256CanonicalJson(profile) },
    pipelineOptions: { ...pipelineOptions, maxRepairAttempts: pipelineOptions.maxRepairAttempts ?? null },
    numberDerivationPolicy: { source: options.pipelineOptions.enabledDerivationRules === undefined ? "code_default" : "explicit_override", enabledRuleIds: pipelineOptions.enabledDerivationRules },
    evidencePolicy: {
      purpose: "full_pipeline_diagnostics" as const,
      automaticChecksEstablishEditorialQuality: false,
      syntheticCases: cases.filter(item => item.provenance === "synthetic").length
    },
    pipelineVersions: [...new Set(generations.flatMap(result => result.pipelineVersion ? [result.pipelineVersion] : []))],
    cases,
    generations,
    summary: {
      decisions,
      changedAfterInitialDraft: generations.filter(item => item.changedAfterInitialDraft).length,
      expectedDecisionMismatches: generations.filter(item => item.expectedDecisionMatches === false).map(item => item.caseId),
      executionErrors: generations.filter(item => item.executionError).length,
      totalLatencyMs: generations.reduce((total, item) => total + item.latencyMs, 0),
      usage: summarizeNoticeEvalUsage(generations.flatMap(item => item.modelCalls))
    }
  };
}
