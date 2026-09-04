import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { numberDerivationRuleIds, type NumberDerivationRuleId } from "@newsweb/prompt-kit";
import {
  collectGitSourceState, createCorpusIdentity, sha256CanonicalJson, sha256Text, writeNewJsonArtifact
} from "../services/editorial-eval-artifact.js";
import { createNoticeJsonCaller } from "../services/notice-model-client.js";
import { NOTICE_PIPELINE_VERSION } from "../services/notice-pipeline.js";
import {
  NOTICE_PIPELINE_EVAL_VERSION,
  noticePipelineEvalProfileSchema,
  parseNoticePipelineEvalCases,
  resolveNoticePipelineEvalOptions,
  runNoticePipelineEvaluation,
  type NoticePipelineEvalOptions,
  type NoticePipelineEvalProfile
} from "../services/notice-pipeline-eval.js";

const HELP = `Full notice-pipeline evaluation (local source cases; never queues or publishes)

npx tsx apps/worker/src/scripts/notice-pipeline-eval.ts --preflight \\
  --cases path/to/frozen-cases.jsonl --model MODEL --effort medium --reference-effort medium --review-effort medium --service-tier default

npx tsx apps/worker/src/scripts/notice-pipeline-eval.ts \\
  --cases path/to/frozen-cases.jsonl --out path/to/new-run.json \\
  --model MODEL --effort medium --reference-effort medium --review-effort medium --service-tier default

Required: --cases, --model, --effort, --reference-effort, --review-effort, --service-tier. --out is required for a model run.
Options: --preflight (offline only), --no-skip, --max-repairs N,
         --hard-model MODEL (required if any phase uses a hard reasoning effort),
         --timeout-ms N (default 240000), --max-output-tokens N (default 16384),
         --derivation-rules none|RULE1,RULE2 (default: the recorded code-default rules).
Preflight may also write an immutable --out receipt. Existing files are never overwritten.
Only a model run needs OPENAI_API_KEY. Each case can make several paid calls, including repairs.
Historical editorial-eval commands and artifacts are unchanged.`;

export function parseNoticePipelineEvalCliArgs(argv: string[]): {
  preflight: boolean;
  casesPath: string;
  outPath?: string;
  profile: NoticePipelineEvalProfile;
  pipelineOptions: NoticePipelineEvalOptions;
} {
  const flags = new Set(["preflight", "no-skip"]);
  const keys = new Set(["cases", "out", "model", "hard-model", "effort", "reference-effort", "review-effort", "service-tier", "max-repairs", "timeout-ms", "max-output-tokens", "derivation-rules"]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (values.has(key)) throw new Error(`Duplicate option: ${arg}`);
    if (flags.has(key)) {
      values.set(key, "true");
    } else if (keys.has(key)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      values.set(key, value);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  const required = (key: string) => {
    const value = values.get(key)?.trim();
    if (!value) throw new Error(`--${key} is required; model settings are never inferred from environment defaults.`);
    return value;
  };
  const integer = (key: string, fallback?: number, minimum = 1): number | undefined => {
    const text = values.get(key);
    if (text === undefined) return fallback;
    if (!/^\d+$/.test(text)) throw new Error(`--${key} must be an integer.`);
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`--${key} must be at least ${minimum}.`);
    return value;
  };
  const preflight = values.has("preflight");
  if (!preflight && !values.has("out")) throw new Error("--out is required for a model run.");
  const profile = noticePipelineEvalProfileSchema.parse({
    model: required("model"),
    ...(values.has("hard-model") ? { hardModel: required("hard-model") } : {}),
    reasoningEffort: required("effort"),
    referenceReasoningEffort: required("reference-effort"),
    reviewReasoningEffort: required("review-effort"),
    serviceTier: required("service-tier"),
    timeoutMs: integer("timeout-ms", 240_000),
    maxOutputTokens: integer("max-output-tokens", 16_384)
  });
  const ruleOption = values.get("derivation-rules");
  const enabledDerivationRules = ruleOption === undefined ? undefined : ruleOption === "none" ? [] : ruleOption.split(",");
  if (enabledDerivationRules?.some(rule => !(numberDerivationRuleIds as readonly string[]).includes(rule))) {
    throw new Error(`Unknown --derivation-rules value; allowed ids: ${numberDerivationRuleIds.join(",")}`);
  }
  const pipelineOptions = { allowSkip: !values.has("no-skip"), maxRepairAttempts: integer("max-repairs", undefined, 0), enabledDerivationRules: enabledDerivationRules as NumberDerivationRuleId[] | undefined };
  resolveNoticePipelineEvalOptions(pipelineOptions);
  return {
    preflight,
    casesPath: path.resolve(required("cases")),
    outPath: values.has("out") ? path.resolve(required("out")) : undefined,
    profile,
    pipelineOptions
  };
}

async function assertNewOutput(outPath?: string): Promise<void> {
  if (!outPath) return;
  try {
    await fs.lstat(outPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Refusing to overwrite immutable artifact: ${outPath}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.length === 1 && argv[0] === "--help") {
    console.log(HELP);
    return;
  }
  const options = parseNoticePipelineEvalCliArgs(argv);
  const rawCases = await fs.readFile(options.casesPath, "utf8");
  const cases = parseNoticePipelineEvalCases(rawCases);
  await assertNewOutput(options.outPath);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const sourceState = await collectGitSourceState(repoRoot);
  const sourceCasesFileSha256 = sha256Text(rawCases);
  if (options.preflight) {
    const receipt = {
      schemaVersion: 1,
      artifactType: "notice_full_pipeline_eval_preflight",
      evaluatorVersion: NOTICE_PIPELINE_EVAL_VERSION,
      pipelineVersion: NOTICE_PIPELINE_VERSION,
      createdAt: new Date().toISOString(),
      corpus: {
        ...createCorpusIdentity(cases, options.casesPath),
        corpusExecutionSha256: sha256CanonicalJson(cases), sourceCasesFileSha256
      },
      profile: options.profile,
      pipelineOptions: { ...resolveNoticePipelineEvalOptions(options.pipelineOptions),
        reasoningEffort: options.profile.reasoningEffort, referenceReasoningEffort: options.profile.referenceReasoningEffort,
        reviewReasoningEffort: options.profile.reviewReasoningEffort,
        maxRepairAttempts: options.pipelineOptions.maxRepairAttempts ?? null },
      sourceState,
      cases: cases.map(item => ({ caseId: item.caseId, provenance: item.provenance, kind: item.kind, sourceSha256: item.sourceSha256 })),
      modelCalls: 0
    };
    if (options.outPath) await writeNewJsonArtifact(options.outPath, receipt);
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }

  // No client, credential lookup, DB connection, source fetch or queue exists
  // before full preflight succeeds. All source evidence must be in the JSONL.
  loadDotEnv({ path: path.join(repoRoot, ".env"), quiet: true });
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for a full-pipeline model run.");
  const call = createNoticeJsonCaller({ apiKey, ...options.profile });
  const artifact = await runNoticePipelineEvaluation({
    cases, sourceCasesPath: options.casesPath, sourceCasesFileSha256, sourceState,
    profile: options.profile, pipelineOptions: options.pipelineOptions, call,
    onCaseComplete: (result, index, total) => {
      console.log(`[notice-pipeline] ${index + 1}/${total} ${result.caseId}: ${result.decision}, ${result.modelCalls.length} calls, ${result.latencyMs} ms`);
    }
  });
  await writeNewJsonArtifact(options.outPath!, artifact);
  console.log(`Wrote full-pipeline evaluation to ${options.outPath}`);
  console.log(JSON.stringify(artifact.summary, null, 2));
  if (artifact.summary.decisions.retry || artifact.summary.decisions.failed || artifact.summary.expectedDecisionMismatches.length) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
