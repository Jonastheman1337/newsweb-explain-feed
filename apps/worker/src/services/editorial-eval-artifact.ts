import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  createRegularPromptVariantMessages,
  getRegularPromptVariantProfile,
  type PromptPayload,
  type RegularPromptMessages,
  type RegularPromptResponseSchemaId,
  type RegularPromptVariantId,
  type RegularPromptVariantProfile
} from "@newsweb/prompt-kit";
import {
  rewriteOutputJsonSchema,
  rewriteOutputJsonSchemaV6
} from "@newsweb/shared";
import type {
  OpenAIReasoningEffort,
  OpenAIServiceTier
} from "./openai-responses.js";
import type { ReviewProtocol } from "./editorial-eval.js";

const execFileAsync = promisify(execFile);

export const evalResponseSchemaProfiles = {
  rewrite_v5_title_first_v1: {
    schemaId: "rewrite_v5_title_first_v1",
    schemaName: "rewrite_output",
    schema: rewriteOutputJsonSchema,
    parserProfileId: "rewrite_output_zod_v1"
  },
  rewrite_v6_extract_first_v1: {
    schemaId: "rewrite_v6_extract_first_v1",
    schemaName: "rewrite_output",
    schema: rewriteOutputJsonSchemaV6,
    parserProfileId: "rewrite_output_zod_v1"
  }
} as const satisfies Record<
  RegularPromptResponseSchemaId,
  {
    schemaId: RegularPromptResponseSchemaId;
    schemaName: "rewrite_output";
    schema: Record<string, unknown>;
    parserProfileId: "rewrite_output_zod_v1";
  }
>;

export type EvalResponseSchemaProfile =
  (typeof evalResponseSchemaProfiles)[RegularPromptResponseSchemaId];

export type EvalPromptHashes = {
  systemSha256: string;
  developerSha256: string;
  userSha256: string;
  combinedSha256: string;
};

export type EvalArmRunProfile = {
  arm: "control" | "challenger";
  variantId: RegularPromptVariantId;
  promptVersion: string;
  responseSchemaId: RegularPromptResponseSchemaId;
  schemaSha256: string;
  parserProfileId: "rewrite_output_zod_v1";
  validationProfileId: "regular_rewrite_validation_v1";
  requestedModel: string;
  requestedReasoningEffort: OpenAIReasoningEffort;
  requestedVerbosity: "low";
  requestedServiceTier: OpenAIServiceTier;
  reasoningContext: "current_turn";
  maxOutputTokens: number;
  modelGenerationSeed: null;
  profileSha256: string;
};

export type EvalReferenceRunProfile = {
  schemaId: "reference_check_result_v1";
  schemaName: "reference_check_result";
  schemaSha256: string;
  parserProfileId: "reference_check_result_zod_v1";
  gateProfileId: "reference_check_gate_v1";
  requestedModel: string;
  requestedReasoningEffort: OpenAIReasoningEffort;
  requestedVerbosity: "low";
  requestedServiceTier: OpenAIServiceTier;
  reasoningContext: "current_turn";
  maxOutputTokens: number;
  modelGenerationSeed: null;
  profileSha256: string;
};

export type EvalCorpusIdentity = {
  corpusId: string;
  corpusSha256: string;
  sourceCasesPath: string;
  caseCount: number;
};

export type EvalGitSourceState = {
  headRevision: string;
  dirty: boolean;
  changedPaths: string[];
  trackedDiffSha256: string;
  untrackedFiles: Array<{ path: string; sha256: string }>;
  sourceStateSha256: string;
};

export type EvalArtifactIntegrity = {
  promotionEligible: boolean;
  reasons: string[];
  warnings: string[];
};

export const lockedManualAbCaseCount = 15;

export type LockedManualAbDiagnostics = {
  caseCount: number;
  challengerOnA: number;
  challengerOnB: number;
  sideDifference: number;
  assignmentIdentitySha256: string;
  displayedOrderSha256: string;
};

export type RetrospectiveBaselineCase = {
  caseId: string;
  messageId: number;
  generationRunId: string;
  publishedRewriteId: string;
  version: number | null;
  status: "published";
  reason: string;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  model: string;
  promptVersion: "v5.9.2";
  promptChars: number | null;
  inputJson: {
    sourcePayload: unknown;
    previousRewrite: unknown;
    reasoningEffortOverride: unknown;
    modelCalls: Array<Record<string, unknown>>;
  };
  outputJson: unknown;
  publishedRewriteJson: unknown;
  validationJson: unknown;
  rewriteCall: Record<string, unknown>;
  referenceCall: Record<string, unknown>;
  sourcePayloadSha256: string;
  outputSha256: string;
  promptHashes: EvalPromptHashes;
  referencePromptHashes: EvalPromptHashes;
  provenanceSha256: string;
};

export type RetrospectiveBaselineV1 = {
  schemaVersion: 1;
  artifactType: "editorial_retrospective_baseline";
  baselineId: string;
  baselineSha256: string;
  createdAt: string;
  source: {
    host: string;
    selection: "explicit_generation_run_ids_v5_9_2";
    messageIds: number[];
    generationRunIds: string[];
  };
  profile: {
    variantId: "regular_v5_9_2_frozen";
    promptVersion: "v5.9.2";
    responseSchemaId: "rewrite_v5_title_first_v1";
    schemaSha256: string;
    requestedModel: string;
    requestedReasoningEffort: OpenAIReasoningEffort;
    requestedServiceTier: OpenAIServiceTier;
    responseModel: string;
    serviceTier: OpenAIServiceTier;
    maxOutputTokens: 16384;
    reference: {
      requestedModel: "gpt-5.6-terra";
      requestedReasoningEffort: "medium";
      requestedServiceTier: "default";
      responseModel: string;
      serviceTier: OpenAIServiceTier;
      maxOutputTokens: 16384;
    };
  };
  cases: RetrospectiveBaselineCase[];
};

export type LockedManualAbPlanV1 = {
  schemaVersion: 1;
  artifactType: "editorial_manual_ab_plan";
  generationMode: "stored_control_fresh_challenger_one_shot_pilot";
  evidencePolicy: {
    purpose: "retrospective_one_shot_selected_pilot";
    promotionEligible: false;
    shippingEvidence: false;
  };
  planId: string;
  planSha256: string;
  createdAt: string;
  caseCount: typeof lockedManualAbCaseCount;
  corpus: EvalCorpusIdentity;
  profiles: {
    control: EvalArmRunProfile;
    challenger: EvalArmRunProfile;
    reference: EvalReferenceRunProfile;
  };
  controlVariant: "regular_v5_9_2_frozen";
  challengerVariant: RegularPromptVariantId;
  baseline: {
    baselineId: string;
    baselineSha256: string;
    sourcePath: string;
  };
  sourceMaterial: {
    lockedCorpusSha256: string;
    primaryNoticePolicy: "identical_locked_payload";
    relatedNoticeTreatment: {
      control: "stripped_by_frozen_pre_v5_10_profile";
      challenger: "included_from_locked_payload";
    };
  };
  caseInputs: Array<{
    caseId: string;
    lockedSourceSha256: string;
    controlPayloadSha256: string;
    challengerPayloadSha256: string;
    controlPromptHashes: EvalPromptHashes;
    challengerPromptHashes: EvalPromptHashes;
  }>;
  reviewProtocol: ReviewProtocol;
  diagnostics: LockedManualAbDiagnostics;
};

export type RunArtifactV3<TCase, TGeneration> = {
  schemaVersion: 3;
  runId: string;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  sourceState: EvalGitSourceState;
  corpus: EvalCorpusIdentity;
  profiles: {
    control: EvalArmRunProfile;
    challenger: EvalArmRunProfile;
    reference: EvalReferenceRunProfile;
  };
  controlVariant: RegularPromptVariantId;
  challengerVariant: RegularPromptVariantId;
  reviewProtocol: ReviewProtocol;
  manualReviewPlan?: {
    planId: string;
    planSha256: string;
    diagnostics: LockedManualAbDiagnostics;
  };
  integrity: EvalArtifactIntegrity;
  cases: TCase[];
  generations: TGeneration[];
};

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

export function sha256Text(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256CanonicalJson(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

export function promptHashes(messages: RegularPromptMessages): EvalPromptHashes {
  return {
    systemSha256: sha256Text(messages.systemPrompt),
    developerSha256: sha256Text(messages.developerPrompt),
    userSha256: sha256Text(messages.userPrompt),
    combinedSha256: sha256Text(
      canonicalJson({
        system: messages.systemPrompt,
        developer: messages.developerPrompt,
        user: messages.userPrompt
      })
    )
  };
}

export function sourcePayloadSha256(payload: unknown): string {
  return sha256CanonicalJson(payload);
}

export function createCorpusIdentity(
  cases: Array<{ caseId: string; payload: unknown; sourceSha256?: string }>,
  sourceCasesPath: string
): EvalCorpusIdentity {
  const entries = cases.map((item) => ({
    caseId: item.caseId,
    sourceSha256: item.sourceSha256 ?? sourcePayloadSha256(item.payload)
  }));
  const corpusSha256 = sha256CanonicalJson(entries);
  return {
    corpusId: `editorial_eval_${corpusSha256.slice(0, 16)}`,
    corpusSha256,
    sourceCasesPath,
    caseCount: cases.length
  };
}

export function assertLockedManualAbCorpus<
  TCase extends {
    caseId: string;
    messageId?: number;
    payload: unknown;
    sourceSha256?: string;
  }
>(
  casesFile: {
    schemaVersion?: number;
    totalCases?: number;
    corpusId?: string;
    corpusSha256?: string;
    cases: TCase[];
  },
  sourceCasesPath: string
): EvalCorpusIdentity {
  if (casesFile.schemaVersion !== 2) {
    throw new Error("Locked 15-case A/B requires a schema-2 cases artifact");
  }
  if (
    casesFile.totalCases !== lockedManualAbCaseCount ||
    casesFile.cases.length !== lockedManualAbCaseCount
  ) {
    throw new Error(
      `Locked manual A/B requires exactly ${lockedManualAbCaseCount} cases; artifact declares ${String(
        casesFile.totalCases
      )} and contains ${casesFile.cases.length}`
    );
  }
  const caseIds = new Set<string>();
  const messageIds = new Set<number>();
  for (const item of casesFile.cases) {
    if (!item.caseId || caseIds.has(item.caseId)) {
      throw new Error(`Locked manual A/B has a missing or duplicate case id: ${item.caseId}`);
    }
    caseIds.add(item.caseId);
    if (
      typeof item.messageId !== "number" ||
      !Number.isInteger(item.messageId) ||
      messageIds.has(item.messageId)
    ) {
      throw new Error(
        `Locked manual A/B has a missing or duplicate message id for ${item.caseId}`
      );
    }
    messageIds.add(item.messageId);
    const calculated = sourcePayloadSha256(item.payload);
    if (!item.sourceSha256 || item.sourceSha256 !== calculated) {
      throw new Error(
        `Locked manual A/B source hash mismatch for ${item.caseId}: stored ${String(
          item.sourceSha256
        )}, calculated ${calculated}`
      );
    }
  }
  const corpus = createCorpusIdentity(casesFile.cases, sourceCasesPath);
  if (
    !casesFile.corpusId ||
    !casesFile.corpusSha256 ||
    casesFile.corpusId !== corpus.corpusId ||
    casesFile.corpusSha256 !== corpus.corpusSha256
  ) {
    throw new Error(
      `Locked manual A/B corpus identity mismatch: stored ${String(
        casesFile.corpusId
      )}/${String(casesFile.corpusSha256)}, calculated ${corpus.corpusId}/${corpus.corpusSha256}`
    );
  }
  return corpus;
}

export function assertLockedManualAbProfiles(
  control: EvalArmRunProfile,
  challenger: EvalArmRunProfile,
  reference: EvalReferenceRunProfile
): void {
  if (control.variantId !== "regular_v5_9_2_frozen") {
    throw new Error(
      `Locked manual A/B control must be regular_v5_9_2_frozen, received ${control.variantId}`
    );
  }
  const equalFields: Array<keyof EvalArmRunProfile> = [
    "responseSchemaId",
    "schemaSha256",
    "parserProfileId",
    "validationProfileId",
    "requestedModel",
    "requestedReasoningEffort",
    "requestedVerbosity",
    "requestedServiceTier",
    "reasoningContext",
    "maxOutputTokens",
    "modelGenerationSeed"
  ];
  for (const field of equalFields) {
    if (control[field] !== challenger[field]) {
      throw new Error(
        `Locked manual A/B arm mismatch for ${field}: ${String(
          control[field]
        )} != ${String(challenger[field])}`
      );
    }
  }
  if (
    reference.requestedModel !== control.requestedModel ||
    reference.requestedReasoningEffort !== control.requestedReasoningEffort ||
    reference.requestedServiceTier !== control.requestedServiceTier ||
    reference.maxOutputTokens !== control.maxOutputTokens
  ) {
    throw new Error(
      "Locked manual A/B reference checker must match the schema-filtered stored checker profile"
    );
  }
}

export function lockedManualAbGenerationId({
  corpusSha256,
  assignmentSeed,
  caseId,
  arm
}: {
  corpusSha256: string;
  assignmentSeed: string;
  caseId: string;
  arm: "control" | "challenger";
}): string {
  return `eval_output_${sha256CanonicalJson({
    domain: "locked_manual_ab_generation_v1",
    corpusSha256,
    assignmentSeed,
    caseId,
    arm
  }).slice(0, 24)}`;
}

export function lockedManualAbDiagnostics(
  protocol: ReviewProtocol
): LockedManualAbDiagnostics {
  const challengerOnA = protocol.assignments.filter(
    (item) => item.challengerSide === "A"
  ).length;
  const challengerOnB = protocol.assignments.length - challengerOnA;
  return {
    caseCount: protocol.assignments.length,
    challengerOnA,
    challengerOnB,
    sideDifference: Math.abs(challengerOnA - challengerOnB),
    assignmentIdentitySha256: sha256CanonicalJson({
      assignmentAlgorithmVersion: protocol.assignmentAlgorithmVersion,
      assignmentSeed: protocol.assignmentSeed,
      assignments: protocol.assignments
        .map((item) => ({
          caseId: item.caseId,
          aGenerationId: item.aGenerationId,
          bGenerationId: item.bGenerationId,
          challengerSide: item.challengerSide
        }))
        .sort((left, right) => left.caseId.localeCompare(right.caseId))
    }),
    displayedOrderSha256: sha256CanonicalJson({
      orderingAlgorithmVersion: protocol.orderingAlgorithmVersion,
      orderingSeed: protocol.orderingSeed,
      displayedCases: [...protocol.assignments]
        .sort(
          (left, right) =>
            left.presentationPosition - right.presentationPosition
        )
        .map((item) => item.caseId)
    })
  };
}

export function createLockedManualAbPlan({
  createdAt,
  corpus,
  control,
  challenger,
  reference,
  baseline,
  baselinePath,
  caseInputs,
  reviewProtocol
}: {
  createdAt: string;
  corpus: EvalCorpusIdentity;
  control: EvalArmRunProfile;
  challenger: EvalArmRunProfile;
  reference: EvalReferenceRunProfile;
  baseline: RetrospectiveBaselineV1;
  baselinePath: string;
  caseInputs: LockedManualAbPlanV1["caseInputs"];
  reviewProtocol: ReviewProtocol;
}): LockedManualAbPlanV1 {
  assertLockedManualAbProfiles(control, challenger, reference);
  assertRetrospectiveBaselineArtifact(baseline);
  if (
    baseline.profile.requestedModel !== control.requestedModel ||
    baseline.profile.requestedReasoningEffort !==
      control.requestedReasoningEffort ||
    baseline.profile.requestedServiceTier !== control.requestedServiceTier ||
    baseline.profile.maxOutputTokens !== control.maxOutputTokens ||
    baseline.profile.reference.requestedModel !== reference.requestedModel ||
    baseline.profile.reference.requestedReasoningEffort !==
      reference.requestedReasoningEffort ||
    baseline.profile.reference.requestedServiceTier !==
      reference.requestedServiceTier ||
    baseline.profile.reference.maxOutputTokens !== reference.maxOutputTokens
  ) {
    throw new Error(
      "Locked one-shot plan profiles do not match the schema-filtered stored control calls"
    );
  }
  const diagnostics = lockedManualAbDiagnostics(reviewProtocol);
  if (
    caseInputs.length !== lockedManualAbCaseCount ||
    new Set(caseInputs.map((item) => item.caseId)).size !== lockedManualAbCaseCount ||
    diagnostics.caseCount !== lockedManualAbCaseCount ||
    diagnostics.sideDifference !== 1 ||
    !reviewProtocol.assignmentSeed ||
    !reviewProtocol.orderingSeed ||
    reviewProtocol.assignmentSeed === reviewProtocol.orderingSeed
  ) {
    throw new Error(
      "Locked 15-case A/B requires 15 assignments, a 7/8 displayed-side split, and distinct stored assignment/order seeds"
    );
  }
  const base = {
    schemaVersion: 1 as const,
    artifactType: "editorial_manual_ab_plan" as const,
    generationMode: "stored_control_fresh_challenger_one_shot_pilot" as const,
    evidencePolicy: {
      purpose: "retrospective_one_shot_selected_pilot" as const,
      promotionEligible: false as const,
      shippingEvidence: false as const
    },
    createdAt,
    caseCount: 15 as const,
    corpus,
    profiles: { control, challenger, reference },
    controlVariant: "regular_v5_9_2_frozen" as const,
    challengerVariant: challenger.variantId,
    baseline: {
      baselineId: baseline.baselineId,
      baselineSha256: baseline.baselineSha256,
      sourcePath: baselinePath
    },
    sourceMaterial: {
      lockedCorpusSha256: corpus.corpusSha256,
      primaryNoticePolicy: "identical_locked_payload" as const,
      relatedNoticeTreatment: {
        control: "stripped_by_frozen_pre_v5_10_profile" as const,
        challenger: "included_from_locked_payload" as const
      }
    },
    caseInputs,
    reviewProtocol,
    diagnostics
  };
  const planSha256 = sha256CanonicalJson(base);
  return {
    ...base,
    planId: `editorial_ab15_${planSha256.slice(0, 16)}`,
    planSha256
  };
}

export function assertLockedManualAbPlan(plan: LockedManualAbPlanV1): void {
  if (
    plan.schemaVersion !== 1 ||
    plan.artifactType !== "editorial_manual_ab_plan" ||
    plan.generationMode !==
      "stored_control_fresh_challenger_one_shot_pilot" ||
    plan.evidencePolicy.purpose !== "retrospective_one_shot_selected_pilot" ||
    plan.evidencePolicy.promotionEligible !== false ||
    plan.evidencePolicy.shippingEvidence !== false ||
    plan.caseCount !== lockedManualAbCaseCount
  ) {
    throw new Error("Invalid locked 15-case A/B plan header");
  }
  assertLockedManualAbProfiles(
    plan.profiles.control,
    plan.profiles.challenger,
    plan.profiles.reference
  );
  const { planId: _planId, planSha256: _planSha256, ...base } = plan;
  const calculated = sha256CanonicalJson(base);
  if (
    plan.planSha256 !== calculated ||
    plan.planId !== `editorial_ab15_${calculated.slice(0, 16)}`
  ) {
    throw new Error("Locked 15-case A/B plan identity mismatch");
  }
  const diagnostics = lockedManualAbDiagnostics(plan.reviewProtocol);
  if (sha256CanonicalJson(diagnostics) !== sha256CanonicalJson(plan.diagnostics)) {
    throw new Error("Locked 15-case A/B plan diagnostics mismatch");
  }
  if (
    plan.caseInputs.length !== lockedManualAbCaseCount ||
    new Set(plan.caseInputs.map((item) => item.caseId)).size !==
      lockedManualAbCaseCount
  ) {
    throw new Error("Locked 15-case A/B plan input manifest is incomplete");
  }
}

export function createArtifactSeed(): string {
  return randomBytes(16).toString("hex");
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export type RewriteExecutionIdentity = {
  requestedModel: string;
  requestedReasoningEffort: OpenAIReasoningEffort;
  requestedServiceTier: OpenAIServiceTier;
  responseModel: string;
  serviceTier: OpenAIServiceTier;
};

export function rewriteExecutionIdentity(
  call: Record<string, unknown>,
  context: string
): RewriteExecutionIdentity {
  if (
    typeof call.model !== "string" ||
    typeof call.reasoningEffort !== "string" ||
    typeof call.requestedServiceTier !== "string" ||
    typeof call.responseModel !== "string" ||
    typeof call.serviceTier !== "string"
  ) {
    throw new Error(`${context} is missing requested or actual model/service-tier telemetry`);
  }
  return {
    requestedModel: call.model,
    requestedReasoningEffort:
      call.reasoningEffort as OpenAIReasoningEffort,
    requestedServiceTier: call.requestedServiceTier as OpenAIServiceTier,
    responseModel: call.responseModel,
    serviceTier: call.serviceTier as OpenAIServiceTier
  };
}

export function assertRewriteExecutionParity(
  expected: RewriteExecutionIdentity,
  actualCall: Record<string, unknown>,
  context: string
): void {
  const actual = rewriteExecutionIdentity(actualCall, context);
  if (sha256CanonicalJson(actual) !== sha256CanonicalJson(expected)) {
    throw new Error(
      `${context} requested/actual model or service tier does not match the stored control`
    );
  }
}

export function createRetrospectiveBaselineArtifact({
  createdAt,
  host,
  messageIds,
  schemaSha256,
  rows
}: {
  createdAt: string;
  host: string;
  messageIds: number[];
  schemaSha256: string;
  rows: Array<{
    id: string;
    messageId: number;
    version: number | null;
    status: string;
    reason: string;
    requestedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    model: string | null;
    promptVersion: string | null;
    promptChars: number | null;
    inputJson: unknown;
    outputJson: unknown;
    publishedRewriteId: string;
    publishedRewriteJson: unknown;
    validationJson: unknown;
  }>;
}): RetrospectiveBaselineV1 {
  const cases: RetrospectiveBaselineCase[] = rows.map((row) => {
    const input = recordValue(row.inputJson);
    const modelCalls = Array.isArray(input?.modelCalls)
      ? (input!.modelCalls as Array<Record<string, unknown>>)
      : [];
    const rewriteCalls = modelCalls.filter(
      (item) => recordValue(item)?.schemaName === "rewrite_output"
    );
    const referenceCalls = modelCalls.filter(
      (item) => recordValue(item)?.schemaName === "reference_check_result"
    );
    const rewriteCall = rewriteCalls[0];
    const referenceCall = referenceCalls[0];
    const sourcePayload = input?.sourcePayload;
    if (!input || !rewriteCall || !referenceCall || !sourcePayload) {
      throw new Error(
        `Baseline ${row.messageId} is missing sourcePayload, rewrite, or reference-check provenance`
      );
    }
    const messages = {
      systemPrompt: rewriteCall.systemPrompt,
      developerPrompt: rewriteCall.developerPrompt,
      userPrompt: rewriteCall.userPrompt
    };
    const referenceMessages = {
      systemPrompt: referenceCall.systemPrompt,
      developerPrompt: referenceCall.developerPrompt,
      userPrompt: referenceCall.userPrompt
    };
    if (
      typeof messages.systemPrompt !== "string" ||
      typeof messages.developerPrompt !== "string" ||
      typeof messages.userPrompt !== "string" ||
      typeof referenceMessages.systemPrompt !== "string" ||
      typeof referenceMessages.developerPrompt !== "string" ||
      typeof referenceMessages.userPrompt !== "string"
    ) {
      throw new Error(`Baseline ${row.messageId} does not store all exact prompts`);
    }
    const rewritePromptHashes = promptHashes({
      variantId: "regular_v5_9_2_frozen",
      promptVersion: "v5.9.2:regular_v5_9_2_frozen",
      systemPrompt: messages.systemPrompt,
      developerPrompt: messages.developerPrompt,
      userPrompt: messages.userPrompt
    });
    const referencePromptHashes = promptHashes({
      variantId: "regular_v5_9_2_frozen",
      promptVersion: "v5.9.2:regular_v5_9_2_frozen",
      systemPrompt: referenceMessages.systemPrompt,
      developerPrompt: referenceMessages.developerPrompt,
      userPrompt: referenceMessages.userPrompt
    });
    const base = {
      caseId: `case_${String(messageIds.indexOf(row.messageId) + 1).padStart(
        3,
        "0"
      )}_${row.messageId}`,
      messageId: row.messageId,
      generationRunId: row.id,
      publishedRewriteId: row.publishedRewriteId,
      version: row.version,
      status: row.status as "published",
      reason: row.reason,
      requestedAt: row.requestedAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      model: row.model ?? "",
      promptVersion: row.promptVersion as "v5.9.2",
      promptChars: row.promptChars,
      inputJson: {
        sourcePayload,
        previousRewrite: input.previousRewrite ?? null,
        reasoningEffortOverride: input.reasoningEffortOverride ?? null,
        modelCalls
      },
      outputJson: row.outputJson,
      publishedRewriteJson: row.publishedRewriteJson,
      validationJson: row.validationJson,
      rewriteCall,
      referenceCall,
      sourcePayloadSha256: sourcePayloadSha256(sourcePayload),
      outputSha256: sha256CanonicalJson(row.outputJson),
      promptHashes: rewritePromptHashes,
      referencePromptHashes
    };
    return { ...base, provenanceSha256: sha256CanonicalJson(base) };
  });
  const firstCall = cases[0]?.rewriteCall;
  const firstReferenceCall = cases[0]?.referenceCall;
  const firstExecution = firstCall
    ? rewriteExecutionIdentity(firstCall, "First retrospective baseline rewrite")
    : null;
  const firstReferenceExecution = firstReferenceCall
    ? rewriteExecutionIdentity(
        firstReferenceCall,
        "First retrospective baseline reference check"
      )
    : null;
  const base = {
    schemaVersion: 1 as const,
    artifactType: "editorial_retrospective_baseline" as const,
    createdAt,
    source: {
      host,
      selection: "explicit_generation_run_ids_v5_9_2" as const,
      messageIds,
      generationRunIds: cases.map((item) => item.generationRunId)
    },
    profile: {
      variantId: "regular_v5_9_2_frozen" as const,
      promptVersion: "v5.9.2" as const,
      responseSchemaId: "rewrite_v5_title_first_v1" as const,
      schemaSha256,
      requestedModel: firstExecution?.requestedModel ?? "",
      requestedReasoningEffort:
        firstExecution?.requestedReasoningEffort ?? "medium",
      requestedServiceTier: firstExecution?.requestedServiceTier ?? "default",
      responseModel: firstExecution?.responseModel ?? "",
      serviceTier: firstExecution?.serviceTier ?? "default",
      maxOutputTokens: 16384 as const,
      reference: {
        requestedModel: firstReferenceExecution?.requestedModel as "gpt-5.6-terra",
        requestedReasoningEffort:
          firstReferenceExecution?.requestedReasoningEffort as "medium",
        requestedServiceTier:
          firstReferenceExecution?.requestedServiceTier as "default",
        responseModel: firstReferenceExecution?.responseModel ?? "",
        serviceTier: firstReferenceExecution?.serviceTier ?? "default",
        maxOutputTokens: 16384 as const
      }
    },
    cases
  };
  const baselineSha256 = sha256CanonicalJson(base);
  const artifact: RetrospectiveBaselineV1 = {
    ...base,
    baselineId: `editorial_baseline15_${baselineSha256.slice(0, 16)}`,
    baselineSha256
  };
  assertRetrospectiveBaselineArtifact(artifact);
  return artifact;
}

export function assertRetrospectiveBaselineArtifact(
  artifact: RetrospectiveBaselineV1
): void {
  if (
    artifact.schemaVersion !== 1 ||
    artifact.artifactType !== "editorial_retrospective_baseline" ||
    artifact.cases.length !== lockedManualAbCaseCount ||
    artifact.source.messageIds.length !== lockedManualAbCaseCount ||
    artifact.source.generationRunIds.length !== lockedManualAbCaseCount
  ) {
    throw new Error("Retrospective baseline must contain exactly 15 cases");
  }
  if (
    new Set(artifact.source.messageIds).size !== lockedManualAbCaseCount ||
    new Set(artifact.cases.map((item) => item.messageId)).size !==
      lockedManualAbCaseCount ||
    new Set(artifact.cases.map((item) => item.generationRunId)).size !==
      lockedManualAbCaseCount
  ) {
    throw new Error("Retrospective baseline IDs must be unique");
  }
  if (
    artifact.profile.variantId !== "regular_v5_9_2_frozen" ||
    artifact.profile.promptVersion !== "v5.9.2" ||
    artifact.profile.responseSchemaId !== "rewrite_v5_title_first_v1" ||
    !/^[a-f0-9]{64}$/.test(artifact.profile.schemaSha256) ||
    artifact.profile.requestedModel !== "gpt-5.6-terra" ||
    artifact.profile.requestedReasoningEffort !== "medium" ||
    artifact.profile.requestedServiceTier !== "default" ||
    !artifact.profile.responseModel ||
    !artifact.profile.serviceTier ||
    artifact.profile.maxOutputTokens !== 16384 ||
    artifact.profile.reference.requestedModel !== "gpt-5.6-terra" ||
    artifact.profile.reference.requestedReasoningEffort !== "medium" ||
    artifact.profile.reference.requestedServiceTier !== "default" ||
    !artifact.profile.reference.responseModel ||
    !artifact.profile.reference.serviceTier ||
    artifact.profile.reference.maxOutputTokens !== 16384
  ) {
    throw new Error("Retrospective baseline profile must be v5.9.2 gpt-5.6-terra/medium/default with the pinned v5 schema");
  }
  if (
    artifact.cases.map((item) => item.messageId).join(",") !==
    artifact.source.messageIds.join(",")
  ) {
    throw new Error("Retrospective baseline row order must match the locked ID list");
  }
  if (
    artifact.cases.map((item) => item.generationRunId).join(",") !==
    artifact.source.generationRunIds.join(",")
  ) {
    throw new Error("Retrospective baseline rows must match the pinned generation-run IDs");
  }
  for (const item of artifact.cases) {
    const rewriteCall = item.rewriteCall;
    const referenceCall = item.referenceCall;
    const input = item.inputJson;
    const rewriteCalls = input.modelCalls.filter(
      (call) => recordValue(call)?.schemaName === "rewrite_output"
    );
    const referenceCalls = input.modelCalls.filter(
      (call) => recordValue(call)?.schemaName === "reference_check_result"
    );
    const source = recordValue(input.sourcePayload);
    const output = recordValue(item.outputJson);
    const validation = recordValue(item.validationJson);
    const referenceCheck = recordValue(validation?.referenceCheck);
    const validationRepair = recordValue(validation?.validationRepair);
    const styleSanitization = recordValue(validation?.styleSanitization);
    if (
      item.status !== "published" ||
      item.reason !== "new-message" ||
      item.promptVersion !== "v5.9.2" ||
      item.model !== artifact.profile.requestedModel ||
      rewriteCall.schemaName !== "rewrite_output" ||
      referenceCall.schemaName !== "reference_check_result" ||
      rewriteCalls.length !== 1 ||
      referenceCalls.length !== 1 ||
      sha256CanonicalJson(rewriteCalls[0]) !== sha256CanonicalJson(rewriteCall) ||
      sha256CanonicalJson(referenceCalls[0]) !==
        sha256CanonicalJson(referenceCall) ||
      typeof rewriteCall.systemPrompt !== "string" ||
      typeof rewriteCall.developerPrompt !== "string" ||
      typeof rewriteCall.userPrompt !== "string" ||
      typeof referenceCall.systemPrompt !== "string" ||
      typeof referenceCall.developerPrompt !== "string" ||
      typeof referenceCall.userPrompt !== "string" ||
      !source ||
      !output ||
      !item.publishedRewriteId ||
      sha256CanonicalJson(item.publishedRewriteJson) !==
        sha256CanonicalJson(item.outputJson) ||
      typeof output.title !== "string" ||
      typeof output.lead !== "string" ||
      !Array.isArray(output.body) ||
      source.relatedNotices !== undefined ||
      input.previousRewrite !== null ||
      input.reasoningEffortOverride !== null ||
      (validation?.valid === false &&
        validation.errorCode !== "NON_BLOCKING_VALIDATION_WARNINGS") ||
      referenceCheck?.blocking === true ||
      referenceCheck?.correctionAttempts !== 0 ||
      validationRepair?.applied === true ||
      styleSanitization?.changed !== false
    ) {
      throw new Error(`Baseline ${item.messageId} is not a homogeneous regular v5.9.2 pass`);
    }
    const expectedExecution: RewriteExecutionIdentity = {
      requestedModel: artifact.profile.requestedModel,
      requestedReasoningEffort: artifact.profile.requestedReasoningEffort,
      requestedServiceTier: artifact.profile.requestedServiceTier,
      responseModel: artifact.profile.responseModel,
      serviceTier: artifact.profile.serviceTier
    };
    assertRewriteExecutionParity(
      expectedExecution,
      rewriteCall,
      `Baseline ${item.messageId} rewrite call`
    );
    if (rewriteCall.maxOutputTokens !== artifact.profile.maxOutputTokens) {
      throw new Error(`Baseline ${item.messageId} rewrite max-output mismatch`);
    }
    const expectedReferenceExecution: RewriteExecutionIdentity = {
      requestedModel: artifact.profile.reference.requestedModel,
      requestedReasoningEffort:
        artifact.profile.reference.requestedReasoningEffort,
      requestedServiceTier: artifact.profile.reference.requestedServiceTier,
      responseModel: artifact.profile.reference.responseModel,
      serviceTier: artifact.profile.reference.serviceTier
    };
    assertRewriteExecutionParity(
      expectedReferenceExecution,
      referenceCall,
      `Baseline ${item.messageId} reference call`
    );
    if (
      referenceCall.maxOutputTokens !==
      artifact.profile.reference.maxOutputTokens
    ) {
      throw new Error(`Baseline ${item.messageId} reference max-output mismatch`);
    }
    const frozenInitialMessages = createRegularPromptVariantMessages(
      "regular_v5_9_2_frozen",
      input.sourcePayload as PromptPayload
    );
    if (
      rewriteCall.systemPrompt !== frozenInitialMessages.systemPrompt ||
      rewriteCall.developerPrompt !== frozenInitialMessages.developerPrompt ||
      rewriteCall.userPrompt !== frozenInitialMessages.userPrompt
    ) {
      throw new Error(
        `Baseline ${item.messageId} first rewrite call does not match the frozen v5.9.2 source prompt`
      );
    }
    const recalculatedPrompts = promptHashes({
      variantId: "regular_v5_9_2_frozen",
      promptVersion: "v5.9.2:regular_v5_9_2_frozen",
      systemPrompt: rewriteCall.systemPrompt,
      developerPrompt: rewriteCall.developerPrompt,
      userPrompt: rewriteCall.userPrompt
    });
    const recalculatedReferencePrompts = promptHashes({
      variantId: "regular_v5_9_2_frozen",
      promptVersion: "v5.9.2:regular_v5_9_2_frozen",
      systemPrompt: referenceCall.systemPrompt,
      developerPrompt: referenceCall.developerPrompt,
      userPrompt: referenceCall.userPrompt
    });
    const { provenanceSha256: _provenance, ...provenanceBase } = item;
    if (
      item.sourcePayloadSha256 !== sourcePayloadSha256(input.sourcePayload) ||
      item.outputSha256 !== sha256CanonicalJson(item.outputJson) ||
      sha256CanonicalJson(item.promptHashes) !==
        sha256CanonicalJson(recalculatedPrompts) ||
      sha256CanonicalJson(item.referencePromptHashes) !==
        sha256CanonicalJson(recalculatedReferencePrompts) ||
      item.provenanceSha256 !== sha256CanonicalJson(provenanceBase)
    ) {
      throw new Error(`Baseline ${item.messageId} provenance hash mismatch`);
    }
  }
  const { baselineId: _id, baselineSha256: _sha, ...base } = artifact;
  const calculated = sha256CanonicalJson(base);
  if (
    artifact.baselineSha256 !== calculated ||
    artifact.baselineId !== `editorial_baseline15_${calculated.slice(0, 16)}`
  ) {
    throw new Error("Retrospective baseline artifact identity mismatch");
  }
}

export function getEvalResponseSchemaProfile(
  schemaId: RegularPromptResponseSchemaId
): EvalResponseSchemaProfile {
  return evalResponseSchemaProfiles[schemaId];
}

export function assertEvalProfileCompatibility(
  variantProfile: RegularPromptVariantProfile,
  schemaProfile: EvalResponseSchemaProfile
): void {
  if (variantProfile.responseSchemaId !== schemaProfile.schemaId) {
    throw new Error(
      `Evaluation profile mismatch for ${variantProfile.variantId}: prompt requires ${variantProfile.responseSchemaId}, received ${schemaProfile.schemaId}`
    );
  }
  if (variantProfile.parserProfileId !== schemaProfile.parserProfileId) {
    throw new Error(
      `Evaluation parser mismatch for ${variantProfile.variantId}: prompt requires ${variantProfile.parserProfileId}, received ${schemaProfile.parserProfileId}`
    );
  }
}

export function resolveEvalArmRunProfile({
  arm,
  variantId,
  model,
  reasoningEffort,
  serviceTier
}: {
  arm: "control" | "challenger";
  variantId: RegularPromptVariantId;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  serviceTier: OpenAIServiceTier;
}): EvalArmRunProfile {
  const variantProfile = getRegularPromptVariantProfile(variantId);
  const schemaProfile = getEvalResponseSchemaProfile(
    variantProfile.responseSchemaId
  );
  assertEvalProfileCompatibility(variantProfile, schemaProfile);
  const base = {
    arm,
    variantId,
    promptVersion: variantProfile.promptVersion,
    responseSchemaId: variantProfile.responseSchemaId,
    schemaSha256: sha256CanonicalJson(schemaProfile.schema),
    parserProfileId: variantProfile.parserProfileId,
    validationProfileId: variantProfile.validationProfileId,
    requestedModel: model,
    requestedReasoningEffort: reasoningEffort,
    requestedVerbosity: "low" as const,
    requestedServiceTier: serviceTier,
    reasoningContext: "current_turn" as const,
    maxOutputTokens: 16384,
    modelGenerationSeed: null
  };
  return { ...base, profileSha256: sha256CanonicalJson(base) };
}

export function resolveReferenceRunProfile({
  schema,
  model,
  reasoningEffort,
  serviceTier
}: {
  schema: Record<string, unknown>;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  serviceTier: OpenAIServiceTier;
}): EvalReferenceRunProfile {
  const base = {
    schemaId: "reference_check_result_v1" as const,
    schemaName: "reference_check_result" as const,
    schemaSha256: sha256CanonicalJson(schema),
    parserProfileId: "reference_check_result_zod_v1" as const,
    gateProfileId: "reference_check_gate_v1" as const,
    requestedModel: model,
    requestedReasoningEffort: reasoningEffort,
    requestedVerbosity: "low" as const,
    requestedServiceTier: serviceTier,
    reasoningContext: "current_turn" as const,
    maxOutputTokens: 16384,
    modelGenerationSeed: null
  };
  return { ...base, profileSha256: sha256CanonicalJson(base) };
}

export function isRunArtifactV3(
  value: { schemaVersion?: unknown }
): value is RunArtifactV3<unknown, unknown> {
  return value.schemaVersion === 3;
}

export async function collectGitSourceState(
  repoRoot: string
): Promise<EvalGitSourceState> {
  const [headResult, statusResult, diffResult, untrackedResult] =
    await Promise.all([
      git(repoRoot, ["rev-parse", "HEAD"]),
      git(repoRoot, ["status", "--short", "--untracked-files=all"]),
      git(repoRoot, ["diff", "--binary", "HEAD", "--", "."]),
      git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"])
    ]);
  const untrackedPaths = untrackedResult.split("\0").filter(Boolean).sort();
  const untrackedFiles = await Promise.all(
    untrackedPaths.map(async (relativePath) => ({
      path: relativePath,
      sha256: sha256Text(await fs.readFile(path.join(repoRoot, relativePath)))
    }))
  );
  const changedPaths = statusResult
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
  const base = {
    headRevision: headResult.trim(),
    dirty: changedPaths.length > 0,
    changedPaths,
    trackedDiffSha256: sha256Text(diffResult),
    untrackedFiles
  };
  return { ...base, sourceStateSha256: sha256CanonicalJson(base) };
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  return stdout;
}

export async function writeNewJsonArtifact(
  filePath: string,
  value: unknown
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    await fs.link(tempPath, filePath);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error(`Refusing to overwrite immutable artifact: ${filePath}`);
    }
    throw error;
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}
