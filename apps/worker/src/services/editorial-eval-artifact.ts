import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  getRegularPromptVariantProfile,
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

export function createArtifactSeed(): string {
  return randomBytes(16).toString("hex");
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
