import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import {
  assessNumbers,
  createRegularPromptVariantMessages,
  getRegularPromptVariantProfile,
  isRegularPromptVariantId,
  numberDerivationRuleIds,
  regularPromptVariantIds,
  unexpectedNumberDisplays,
  type PromptPayload,
  type RegularPromptVariantId
} from "@newsweb/prompt-kit";
import {
  rewriteOutputSchema,
  type RewriteOutput
} from "@newsweb/shared";
import type { Prisma } from "@prisma/client";
import {
  assessReferenceCheckGate,
  buildCoverageReport,
  buildReferenceCheckPrompt,
  emptyReferenceCoverageReport,
  referenceCheckJsonSchema,
  referenceCheckResultSchema,
  type ReferenceCoverageReport
} from "../services/reference-check.js";
import {
  assertReviewProtocolIntegrity,
  categorizeEvalPayload,
  createLegacyReviewProtocol,
  createReviewProtocol,
  difficultyTagsForPayload,
  evalCategoryQuotasForLimit,
  selectBalancedEvalCases,
  summarizeEditorialEval,
  type EvalCategoryId,
  type EvalCandidate,
  type EvalCase,
  type EvalFatalStatus,
  type EvalGenerationSummary,
  type EvalReview,
  type ReviewAssignment,
  type ReviewProtocol
} from "../services/editorial-eval.js";
import {
  collectGitSourceState,
  createArtifactSeed,
  createCorpusIdentity,
  getEvalResponseSchemaProfile,
  promptHashes,
  resolveEvalArmRunProfile,
  resolveReferenceRunProfile,
  sha256CanonicalJson,
  sourcePayloadSha256,
  writeNewJsonArtifact,
  type EvalArmRunProfile,
  type EvalArtifactIntegrity,
  type EvalPromptHashes,
  type EvalReferenceRunProfile,
  type RunArtifactV3
} from "../services/editorial-eval-artifact.js";
import {
  replayExpected,
  safetyClassBehavior,
  type SafetyCase,
  type SafetyFixtureFile,
  type SafetyFixtureManifest,
  type SafetyGateClass
} from "../services/safety-fixtures.js";
import {
  callOpenAIForJson,
  createOpenAIClient,
  openAIReasoningEfforts,
  openAIServiceTiers,
  type OpenAIJsonResult,
  type OpenAIReasoningEffort,
  type OpenAIServiceTier
} from "../services/openai-responses.js";
import { sanitizeRewriteStyle } from "../services/style-sanitizer.js";
import {
  buildValidationSourceText,
  validateRewriteOutput
} from "../services/rewrite-validation.js";
import {
  replayValidationPayloadFromRow,
  storedRewriteOutputFromRow,
  storedUnexpectedNumberDisplays
} from "../services/generation-run-replay.js";

type CasesFile = {
  schemaVersion: 1 | 2;
  createdAt: string;
  source: {
    from: string;
    to: string;
    limit: number;
    selection:
      | "direct_prisma_generation_runs"
      | "direct_prisma_mixed"
      | "curated_message_ids";
  };
  quotas: Record<EvalCategoryId, number>;
  totalCases: number;
  corpusId?: string;
  corpusSha256?: string;
  cases: EvalCase[];
};

type EvalGeneration = EvalGenerationSummary & {
  promptVersion: string;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  serviceTier: OpenAIServiceTier;
  startedAt: string;
  completedAt: string;
  responseSchemaId: EvalArmRunProfile["responseSchemaId"];
  schemaSha256: string;
  parserProfileId: EvalArmRunProfile["parserProfileId"];
  validationProfileId: EvalArmRunProfile["validationProfileId"];
  promptHashes: EvalPromptHashes;
  requestMetadata: {
    requestedModel: string;
    requestedReasoningEffort: OpenAIReasoningEffort;
    requestedVerbosity: "low";
    requestedServiceTier: OpenAIServiceTier;
    reasoningContext: "current_turn";
    maxOutputTokens: number;
    modelGenerationSeed: null;
  };
  modelCalls: EvalModelCall[];
  output: RewriteOutput | null;
  validation: {
    valid: boolean;
    issues: Array<{ code: string; severity: string; message: string }>;
    blockingErrors: string[];
    warnings: string[];
  } | null;
  referenceCheck: {
    coveragePercent: number;
    unsupportedSentenceCount: number;
    blocking: boolean;
    blockingReason: string | null;
    highRiskUnsupportedSentenceCount: number;
    coverage: ReferenceCoverageReport | null;
    checkerError: string | null;
  };
  styleSanitization: ReturnType<typeof sanitizeRewriteStyle>["stats"] | null;
  promptChars: number;
  rewritePromptChars: number;
  referencePromptChars: number;
  latencyMs: number;
  errorText: string | null;
};

type EvalModelCall = Omit<OpenAIJsonResult, "content"> & {
  schemaName: string;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  serviceTierRequested: OpenAIServiceTier;
};

type LegacyRunFile = {
  schemaVersion: 1 | 2;
  runId: string;
  createdAt: string;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  serviceTier?: OpenAIServiceTier;
  controlProfile?: { model: string; reasoningEffort: OpenAIReasoningEffort };
  challengerProfile?: { model: string; reasoningEffort: OpenAIReasoningEffort };
  referenceProfile?: { model: string; reasoningEffort: OpenAIReasoningEffort };
  controlVariant: RegularPromptVariantId;
  challengerVariant: RegularPromptVariantId;
  sourceCasesPath: string;
  cases: EvalCase[];
  generations: EvalGeneration[];
};

type RunFile =
  | LegacyRunFile
  | RunArtifactV3<EvalCase, EvalGeneration>;

type ParsedArgs = {
  command: string;
  options: Map<string, string>;
};

type SourceNoticeCaseRow = {
  messageId: number;
  newsId: number;
  title: string;
  issuerName: string;
  issuerSign: string;
  publishedAt: Date;
  categoriesJson: Prisma.JsonValue;
  marketsJson: Prisma.JsonValue;
  bodyText: string;
  hasAttachments: boolean;
};

async function main(): Promise<void> {
  const rootDir = await findRepoRoot();
  loadDotEnv({ path: path.join(rootDir, ".env"), override: false });
  loadDotEnv({ path: path.resolve(process.cwd(), ".env"), override: false });

  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.command || parsed.options.has("help")) {
    printUsage();
    return;
  }

  if (parsed.command === "build-cases") {
    await buildCasesCommand(parsed.options);
  } else if (parsed.command === "run") {
    await runCommand(parsed.options);
  } else if (parsed.command === "review-html") {
    await reviewHtmlCommand(parsed.options);
  } else if (parsed.command === "summarize") {
    await summarizeCommand(parsed.options);
  } else if (parsed.command === "lock-cases") {
    await lockCasesCommand(parsed.options);
  } else if (parsed.command === "build-safety-fixtures") {
    await buildSafetyFixturesCommand(parsed.options, rootDir);
  } else if (parsed.command === "replay-numbers") {
    await replayNumbersCommand(parsed.options, rootDir);
  } else if (parsed.command === "refresh-numeric-payloads") {
    await refreshNumericPayloadsCommand(parsed.options, rootDir);
  } else {
    throw new Error(`Unknown command: ${parsed.command}`);
  }
}

function parseArgs(args: string[]): ParsedArgs {
  const [command = "", ...rest] = args;
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options.set(key, "true");
    } else {
      options.set(key, next);
      index += 1;
    }
  }
  return { command, options };
}

function requiredOption(options: Map<string, string>, name: string): string {
  const value = options.get(name);
  if (!value) {
    throw new Error(`Missing required option --${name}`);
  }
  return value;
}

function optionalInt(
  options: Map<string, string>,
  name: string,
  defaultValue: number
): number {
  const raw = options.get(name);
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

async function buildCasesCommand(options: Map<string, string>): Promise<void> {
  if (options.has("message-ids")) {
    await buildCasesFromMessageIds(options);
    return;
  }
  const from = requiredOption(options, "from");
  const to = requiredOption(options, "to");
  const limit = optionalInt(options, "limit", 50);
  const outPath = requiredOption(options, "out");
  const { logPrisma, prisma } = await import("@newsweb/shared/db");
  const quotas = evalCategoryQuotasForLimit(limit);
  const dateRange = {
    gte: new Date(`${from}T00:00:00.000Z`),
    lte: new Date(`${to}T23:59:59.999Z`)
  };

  const rows = await logPrisma.generationRun.findMany({
    where: {
      status: "published",
      userInstruction: null,
      requestedAt: dateRange
    },
    orderBy: { requestedAt: "desc" },
    take: Math.max(limit * 80, 2500),
    select: {
      messageId: true,
      inputJson: true,
      validationJson: true
    }
  });

  const seen = new Set<number>();
  const seenSourceNewsIds = new Set<number>();
  const candidates: EvalCandidate[] = [];
  for (const row of rows) {
    if (seen.has(row.messageId)) continue;
    const payload = extractRegularPayload(row.inputJson);
    if (!payload) continue;
    seen.add(row.messageId);
    const category = categorizeEvalPayload(payload);
    candidates.push({
      messageId: row.messageId,
      company: payload.issuerName,
      issuerSign: payload.issuerSign,
      sourceTitle: payload.title,
      publishedAt: payload.publishedAt,
      category,
      difficultyTags: [
        "from_generation_run",
        ...difficultyTagsForPayload(payload),
        ...difficultyTagsForValidation(row.validationJson)
      ],
      payload
    });
  }

  if (candidates.length < limit) {
    const sourceRows = await prisma.sourceNotice.findMany({
      where: {
        publishedAt: dateRange
      },
      orderBy: { publishedAt: "desc" },
      take: Math.max(limit * 160, 5000),
      select: {
        messageId: true,
        newsId: true,
        title: true,
        issuerName: true,
        issuerSign: true,
        publishedAt: true,
        categoriesJson: true,
        marketsJson: true,
        bodyText: true,
        hasAttachments: true
      }
    });

    for (const row of sourceRows) {
      if (seen.has(row.messageId)) continue;
      if (seenSourceNewsIds.has(row.newsId)) continue;
      const payload = payloadFromSourceNotice(row);
      if (isReportLikeRegularPayload(payload)) continue;
      if (isAttachmentOnlySourceNotice(payload)) continue;
      seen.add(row.messageId);
      seenSourceNewsIds.add(row.newsId);
      const category = categorizeEvalPayload(payload);
      const difficultyTags = [
        "from_source_notice",
        ...difficultyTagsForPayload(payload)
      ];
      if (payload.hasAttachments && !payload.pdfSupplementText) {
        difficultyTags.push("source_notice_without_attachment_text");
      }
      candidates.push({
        messageId: row.messageId,
        company: payload.issuerName,
        issuerSign: payload.issuerSign,
        sourceTitle: payload.title,
        publishedAt: payload.publishedAt,
        category,
        difficultyTags,
        payload
      });
    }
  }

  const cases = selectBalancedEvalCases(candidates, {
    limit,
    quotas
  }).map((item) => ({
    ...item,
    sourceSha256: sourcePayloadSha256(item.payload)
  }));
  const corpus = createCorpusIdentity(cases, outPath);
  const output: CasesFile = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    source: {
      from,
      to,
      limit,
      selection:
        cases.some((item) => item.difficultyTags.includes("from_source_notice"))
          ? "direct_prisma_mixed"
          : "direct_prisma_generation_runs"
    },
    quotas,
    totalCases: cases.length,
    corpusId: corpus.corpusId,
    corpusSha256: corpus.corpusSha256,
    cases
  };

  await writeNewJsonArtifact(outPath, output);
  console.log(`Wrote ${cases.length} eval cases to ${outPath}`);
}

function parseMessageIdList(raw: string): number[] {
  const ids = raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));
  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error("--message-ids must be a comma-separated list of message IDs");
  }
  return [...new Set(ids)];
}

async function buildCasesFromMessageIds(
  options: Map<string, string>
): Promise<void> {
  const rawIds = requiredOption(options, "message-ids");
  const messageIds = parseMessageIdList(
    rawIds.startsWith("@") ? await fs.readFile(rawIds.slice(1), "utf8") : rawIds
  );
  const outPath = requiredOption(options, "out");
  const { logPrisma, prisma } = await import("@newsweb/shared/db");

  const rows = await logPrisma.generationRun.findMany({
    where: { messageId: { in: messageIds } },
    orderBy: { requestedAt: "desc" },
    select: { messageId: true, status: true, inputJson: true, validationJson: true }
  });
  const payloadByMessageId = new Map<
    number,
    {
      payload: PromptPayload;
      validationJson: Prisma.JsonValue | null;
      fromRun: boolean;
      fromPublished: boolean;
    }
  >();
  // Rows are ordered latest-first: keep the latest published row's payload,
  // falling back to the latest row of any status.
  for (const row of rows) {
    const existing = payloadByMessageId.get(row.messageId);
    if (existing?.fromPublished) continue;
    const payload = extractRegularPayload(row.inputJson);
    if (!payload) continue;
    if (!existing || row.status === "published") {
      payloadByMessageId.set(row.messageId, {
        payload,
        validationJson: row.validationJson,
        fromRun: true,
        fromPublished: row.status === "published"
      });
    }
  }

  const missing = messageIds.filter((id) => !payloadByMessageId.has(id));
  if (missing.length > 0) {
    const sourceRows = await prisma.sourceNotice.findMany({
      where: { messageId: { in: missing } },
      select: {
        messageId: true,
        newsId: true,
        title: true,
        issuerName: true,
        issuerSign: true,
        publishedAt: true,
        categoriesJson: true,
        marketsJson: true,
        bodyText: true,
        hasAttachments: true
      }
    });
    for (const row of sourceRows) {
      payloadByMessageId.set(row.messageId, {
        payload: payloadFromSourceNotice(row),
        validationJson: null,
        fromRun: false,
        fromPublished: false
      });
    }
  }

  const unresolved = messageIds.filter((id) => !payloadByMessageId.has(id));
  if (unresolved.length > 0) {
    throw new Error(
      `No source payload found for message IDs: ${unresolved.join(", ")}`
    );
  }

  const cases: EvalCase[] = messageIds.map((messageId, index) => {
    const entry = payloadByMessageId.get(messageId)!;
    const category = categorizeEvalPayload(entry.payload);
    return {
      caseId: `case_${String(index + 1).padStart(3, "0")}_${messageId}`,
      messageId,
      company: entry.payload.issuerName,
      issuerSign: entry.payload.issuerSign,
      sourceTitle: entry.payload.title,
      publishedAt: entry.payload.publishedAt,
      category,
      difficultyTags: [
        entry.fromRun ? "from_generation_run" : "from_source_notice",
        "curated_message_id",
        ...difficultyTagsForPayload(entry.payload),
        ...difficultyTagsForValidation(entry.validationJson)
      ],
      payload: entry.payload,
      sourceSha256: sourcePayloadSha256(entry.payload)
    };
  });

  const corpus = createCorpusIdentity(cases, outPath);
  const quotas = {} as Record<EvalCategoryId, number>;
  const output: CasesFile = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    source: {
      from: options.get("from") ?? "curated",
      to: options.get("to") ?? "curated",
      limit: cases.length,
      selection: "curated_message_ids"
    },
    quotas,
    totalCases: cases.length,
    corpusId: corpus.corpusId,
    corpusSha256: corpus.corpusSha256,
    cases
  };

  await writeNewJsonArtifact(outPath, output);
  console.log(
    `Wrote ${cases.length} curated eval cases (${corpus.corpusId}) to ${outPath}`
  );
}

async function lockCasesCommand(options: Map<string, string>): Promise<void> {
  const casesPath = requiredOption(options, "cases");
  const outPath = requiredOption(options, "out");
  const casesFile = await readJson<CasesFile>(casesPath);
  const cases = casesFile.cases.map((item) => ({
    ...item,
    sourceSha256: item.sourceSha256 ?? sourcePayloadSha256(item.payload)
  }));
  const corpus = createCorpusIdentity(cases, outPath);
  const output: CasesFile = {
    ...casesFile,
    schemaVersion: 2,
    totalCases: cases.length,
    corpusId: corpus.corpusId,
    corpusSha256: corpus.corpusSha256,
    cases
  };
  await writeNewJsonArtifact(outPath, output);
  console.log(
    `Locked ${cases.length} cases from ${casesPath} as ${corpus.corpusId} at ${outPath}`
  );
}

// 675221 (Norse Atlantic rights issue) was reclassified out of
// numeric_unresolved on 2026-08-13: the current validator's scaled_unit_amount
// rule accepts its "1,02 milliarder kroner" as the rounded form of the source's
// NOK 1,019,832,000 — the deliberate, test-pinned behavior the rule was built
// for (see packages/prompt-kit numbers tests). It stays in the recoverable
// numeric_false_block pool.
// 679626 was reclassified out on 2026-08-14 (owner adjudication): its three
// blocking displays are digit-exact contiguous quotes of source table rows in
// the non-visible source_spans field — the source_cell_subrun mechanism shared
// with ten known false blocks — and its visible article numbers already pass.
// The report's "unresolved" label was a reference-coverage artifact, the same
// instrument that had misclassified 675221.
// 679552 is adjudicated recoverable as of 2026-08-19 (verbal_minus_composed
// replay): the rewrite's "minus 312,5 millioner euro" derives exactly from
// the EUR-thousand table row "Profit/(loss) before tax -312,453" — a correct
// sign-flipped scaled-table match, the 680021 failure class. It stays listed
// until the rule's enablement window, when the owner confirms the move and
// the fixture reseed records it (precedent: 679626 above).
const SAFETY_SEED_MESSAGE_IDS: Partial<Record<SafetyGateClass, number[]>> = {
  checker_error_published: [679311, 677571, 677082, 675348],
  numeric_unresolved: [679552, 679469, 678266, 676662, 676354]
};

// The marker leak and loaded-language evidence exists only in the rejected
// challenger's outputs inside the legacy A/B artifact; the production rows for
// these message IDs hold clean published outputs and would freeze the wrong
// evidence.
const AB_SOURCED_SEED_MESSAGE_IDS: Partial<Record<SafetyGateClass, number[]>> = {
  marker_leak: [675713],
  loaded_language: [675772]
};

type SafetySeedRow = {
  id: string;
  messageId: number;
  status: string;
  reason: string;
  promptVersion: string | null;
  requestedAt: Date;
  inputJson: Prisma.JsonValue | null;
  outputJson: Prisma.JsonValue | null;
  validationJson: Prisma.JsonValue | null;
};

const SAFETY_SEED_ROW_SELECT = {
  id: true,
  messageId: true,
  status: true,
  reason: true,
  promptVersion: true,
  requestedAt: true,
  inputJson: true,
  outputJson: true,
  validationJson: true
} as const;

function hasUnexpectedNumbersIssue(validationJson: Prisma.JsonValue | null): boolean {
  const validation = asRecord(validationJson);
  if (!Array.isArray(validation?.issues)) return false;
  return validation.issues.some(
    (issue) => asRecord(issue)?.code === "UNEXPECTED_NUMBERS"
  );
}

function strideSample<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const sampled: T[] = [];
  for (let index = 0; index < limit; index += 1) {
    sampled.push(items[Math.floor((index * items.length) / limit)]!);
  }
  return sampled;
}

async function safetyCaseFromRow(
  gateClass: SafetyGateClass,
  row: SafetySeedRow,
  window: { from: string; to: string },
  feedback: string[] | undefined,
  fetchSourceNotice: (messageId: number) => Promise<PromptPayload | null>
): Promise<SafetyCase | null> {
  // Validation-replay classes must be seeded with the payload production
  // VALIDATED against (report flows validate a reportReferencePayload join,
  // not the raw notice); triage and integrity classes replay the raw
  // generation payload, which the legacy chain below provides.
  let payload: PromptPayload | null = null;
  if (safetyClassBehavior[gateClass] === "validation") {
    const replayResult = replayValidationPayloadFromRow({
      sourcePayload: asRecord(row.inputJson)?.sourcePayload,
      validationJson: row.validationJson
    });
    if (replayResult) {
      if (
        replayResult.flow === "report" &&
        replayResult.validationSourceCharsMatch === false
      ) {
        console.warn(
          `[safety-fixtures] excluding ${gateClass} ${row.messageId}: report payload reconstruction failed the validationSourceChars tripwire`
        );
        return null;
      }
      payload = replayResult.payload;
    } else if (asRecord(row.validationJson)?.reportExtraction) {
      console.warn(
        `[safety-fixtures] excluding ${gateClass} ${row.messageId}: report row without a reconstructable source payload`
      );
      return null;
    } else {
      payload =
        extractRegularPayload(row.inputJson) ??
        (await fetchSourceNotice(row.messageId));
      if (payload) {
        console.warn(
          `[safety-fixtures] ${gateClass} ${row.messageId}: validation payload from source-notice fallback (stored payload missing; pdf/supplemental text unavailable)`
        );
      }
    }
  } else {
    payload =
      extractRegularPayload(row.inputJson) ??
      (await fetchSourceNotice(row.messageId));
  }
  if (!payload) {
    console.warn(
      `[safety-fixtures] skipping ${gateClass} ${row.messageId}: no source payload`
    );
    return null;
  }
  const parsedOutput = storedRewriteOutputFromRow(row);
  const item: SafetyCase = {
    messageId: row.messageId,
    generationRunId: row.id,
    promptVersion: row.promptVersion,
    sourcePayload: payload,
    storedOutput: parsedOutput,
    storedValidation: row.validationJson ?? null,
    labels: { class: gateClass, reportRef: "final report 2026-06-02_2026-08-13" },
    expected: {},
    provenance: {
      window,
      status: row.status,
      ...(feedback && feedback.length > 0 ? { feedback } : {})
    }
  };
  item.expected = replayExpected(item);
  return item;
}

type ReplayCorpusJsonlRow = {
  id: string;
  messageId: string | number;
  promptVersion?: string | null;
  requestedAt?: string;
  reason?: string | null;
  sourcePayload?: unknown;
  outputJson?: unknown;
  validationJson?: unknown;
};

type ReplayNumbersRowResult = {
  messageId: number;
  generationRunId: string;
  promptVersion: string | null;
  flow: "regular" | "report";
  unresolved: boolean;
  storedUnexpected: string[] | null;
  replayedUnexpected: string[];
  fidelity: { onlyStored: string[]; onlyReplayed: string[]; rawMatch: boolean | null };
  candidateClears: Array<{ display: string; ruleId: string }>;
  residualUnexpected: string[];
  fullyCleared: boolean;
  validationSourceCharsMatch: boolean | null;
  crossCheckClean: boolean;
};

async function replayNumbersCommand(
  options: Map<string, string>,
  rootDir: string
): Promise<void> {
  const corpusPath = path.resolve(
    rootDir,
    options.get("corpus") ??
      path.join("tmp", "editorial-eval", "replay-corpus-2026-06-02_2026-08-13.jsonl")
  );
  const corpusBase = path.basename(corpusPath);
  const windowLabel =
    /^replay-corpus-(.+)\.jsonl$/.exec(corpusBase)?.[1] ?? "output";
  const outPath = path.resolve(
    rootDir,
    options.get("out") ??
      path.join("tmp", "editorial-eval", `replay-numbers-${windowLabel}.json`)
  );

  let rawCorpus: string;
  try {
    rawCorpus = await fs.readFile(corpusPath, "utf8");
  } catch {
    throw new Error(
      [
        `Replay corpus not found: ${corpusPath}`,
        "The corpus is gitignored; regenerate it with the export documented in",
        "docs/editorial-eval.md (tmp/export-replay-corpus.mts against the",
        "generation-log database) or pass --corpus <path>."
      ].join("\n")
    );
  }
  const corpusSha256 = createHash("sha256").update(rawCorpus).digest("hex");
  const rows = rawCorpus
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ReplayCorpusJsonlRow);

  const latestByMessage = new Map<number, ReplayCorpusJsonlRow>();
  let malformedIds = 0;
  for (const row of rows) {
    const messageId = Number(row.messageId);
    if (!Number.isFinite(messageId)) {
      malformedIds += 1;
      continue;
    }
    const previous = latestByMessage.get(messageId);
    if (
      !previous ||
      String(row.requestedAt ?? "") > String(previous.requestedAt ?? "")
    ) {
      latestByMessage.set(messageId, row);
    }
  }

  const unresolvedIds = new Set(
    SAFETY_SEED_MESSAGE_IDS.numeric_unresolved ?? []
  );
  const allDerivationRules = [...numberDerivationRuleIds];
  const results: ReplayNumbersRowResult[] = [];
  const skips: Array<{ messageId: number; generationRunId: string; reason: string }> = [];

  for (const [messageId, row] of latestByMessage) {
    const storedOutput = storedRewriteOutputFromRow(row);
    if (!storedOutput) {
      skips.push({ messageId, generationRunId: row.id, reason: "no-stored-output" });
      continue;
    }
    const payloadResult = replayValidationPayloadFromRow(row);
    if (!payloadResult) {
      skips.push({ messageId, generationRunId: row.id, reason: "no-payload" });
      continue;
    }
    const sourceText = buildValidationSourceText(payloadResult.payload);
    const legacy = assessNumbers(storedOutput, sourceText, {
      enabledDerivationRules: []
    });
    const allOn = assessNumbers(storedOutput, sourceText, {
      enabledDerivationRules: allDerivationRules
    });

    const replayedUnexpected = unexpectedNumberDisplays(legacy).sort();
    const residualUnexpected = unexpectedNumberDisplays(allOn).sort();
    const candidatePairs = legacy
      .filter((assessment) => assessment.candidateRuleId)
      .map((assessment) => ({
        display: assessment.display,
        ruleId: String(assessment.candidateRuleId)
      }))
      .sort((a, b) =>
        a.display.localeCompare(b.display) || a.ruleId.localeCompare(b.ruleId)
      );
    const derivedPairs = allOn
      .filter((assessment) => assessment.disposition === "derived")
      .map((assessment) => ({
        display: assessment.display,
        ruleId: String(assessment.ruleId)
      }))
      .sort((a, b) =>
        a.display.localeCompare(b.display) || a.ruleId.localeCompare(b.ruleId)
      );
    const crossCheckClean =
      JSON.stringify(candidatePairs) === JSON.stringify(derivedPairs);

    const stored = storedUnexpectedNumberDisplays(row.validationJson);
    const storedDisplays = stored ? [...stored.displays].sort() : null;
    const replayedSet = new Set(replayedUnexpected);
    const storedSet = new Set(storedDisplays ?? []);
    const fidelity = {
      onlyStored: (storedDisplays ?? []).filter(
        (display) => !replayedSet.has(display)
      ),
      onlyReplayed: storedDisplays
        ? replayedUnexpected.filter((display) => !storedSet.has(display))
        : [],
      rawMatch: stored
        ? stored.raw === unexpectedNumberDisplays(legacy).join(", ")
        : null
    };

    results.push({
      messageId,
      generationRunId: row.id,
      promptVersion:
        typeof row.promptVersion === "string" ? row.promptVersion : null,
      flow: payloadResult.flow,
      unresolved: unresolvedIds.has(messageId),
      storedUnexpected: storedDisplays,
      replayedUnexpected,
      fidelity,
      candidateClears: candidatePairs,
      residualUnexpected,
      fullyCleared: residualUnexpected.length === 0,
      validationSourceCharsMatch: payloadResult.validationSourceCharsMatch,
      crossCheckClean
    });
  }

  results.sort((a, b) => a.messageId - b.messageId);
  skips.sort((a, b) => a.messageId - b.messageId);

  const fidelityMismatches = results.filter(
    (row) =>
      row.fidelity.onlyStored.length > 0 || row.fidelity.onlyReplayed.length > 0
  );
  const tripwireFailures = results.filter(
    (row) => row.validationSourceCharsMatch === false
  );
  const alreadyClean = results.filter(
    (row) => row.replayedUnexpected.length === 0
  );
  const crossCheckFailures = results.filter((row) => !row.crossCheckClean);
  const clearsByRule = new Map<string, number>();
  for (const row of results) {
    for (const pair of row.candidateClears) {
      clearsByRule.set(pair.ruleId, (clearsByRule.get(pair.ruleId) ?? 0) + 1);
    }
  }
  const unresolvedRows = results.filter((row) => row.unresolved);
  const unresolvedAlarms = unresolvedRows.filter(
    (row) => row.fullyCleared || row.replayedUnexpected.length === 0
  );

  const artifact = {
    header: {
      corpus: path.relative(rootDir, corpusPath).replaceAll("\\", "/"),
      corpusSha256,
      gitHead: (await collectGitSourceState(rootDir)).headRevision,
      derivationRuleIds: allDerivationRules,
      unresolvedMessageIds: [...unresolvedIds].sort((a, b) => a - b)
    },
    summary: {
      corpusRows: rows.length,
      malformedIds,
      pool: latestByMessage.size,
      replayed: results.length,
      skips,
      fidelityMismatchCount: fidelityMismatches.length,
      tripwireFailureCount: tripwireFailures.length,
      alreadyCleanUnderLegacy: alreadyClean.map((row) => row.messageId),
      crossCheckFailureCount: crossCheckFailures.length,
      candidateClearsByRule: [...clearsByRule.entries()]
        .map(([ruleId, count]) => ({ ruleId, count }))
        .sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId))
    },
    rows: results
  };
  await writeJson(outPath, artifact);

  console.log(`[replay-numbers] corpus ${corpusPath}`);
  console.log(
    `[replay-numbers] rows ${rows.length} -> pool ${latestByMessage.size} (latest per message), replayed ${results.length}, skipped ${skips.length}${
      malformedIds > 0 ? `, malformed ids ${malformedIds}` : ""
    }`
  );
  for (const skip of skips) {
    console.warn(
      `[replay-numbers] skipped ${skip.messageId} (${skip.generationRunId}): ${skip.reason}`
    );
  }
  const reportRows = results.filter((row) => row.flow === "report");
  const tripwireChecked = reportRows.filter(
    (row) => row.validationSourceCharsMatch !== null
  );
  console.log(
    `[replay-numbers] flows: report ${reportRows.length} (tripwire ${
      tripwireChecked.filter((row) => row.validationSourceCharsMatch).length
    }/${tripwireChecked.length} ok), regular ${results.length - reportRows.length}`
  );
  console.log(
    `[replay-numbers] fidelity: ${fidelityMismatches.length} row(s) with stored/replayed display drift`
  );
  for (const row of fidelityMismatches) {
    console.warn(
      `[replay-numbers] fidelity drift ${row.messageId}: onlyStored=[${row.fidelity.onlyStored.join(
        " | "
      )}] onlyReplayed=[${row.fidelity.onlyReplayed.join(" | ")}]`
    );
  }
  console.log(
    `[replay-numbers] already clean under legacy rules: ${alreadyClean.length} (${alreadyClean
      .map((row) => row.messageId)
      .join(", ")})`
  );
  if (allDerivationRules.length === 0) {
    console.log(
      "[replay-numbers] derivation registry is empty; legacy and all-rules runs are identical by construction"
    );
  } else {
    console.log(
      `[replay-numbers] candidate clears by rule: ${
        artifact.summary.candidateClearsByRule
          .map((entry) => `${entry.ruleId}=${entry.count}`)
          .join(", ") || "none"
      }`
    );
  }
  if (crossCheckFailures.length > 0) {
    console.error(
      `[replay-numbers] WARNING: derived/candidate cross-check failed for ${crossCheckFailures
        .map((row) => row.messageId)
        .join(", ")}`
    );
  }
  console.log("[replay-numbers] unresolved cases:");
  for (const id of [...unresolvedIds].sort((a, b) => a - b)) {
    const row = results.find((entry) => entry.messageId === id);
    if (!row) {
      console.warn(`[replay-numbers]   ${id}: NOT IN POOL`);
      continue;
    }
    console.log(
      `[replay-numbers]   ${id} (${row.generationRunId}): replayedUnexpected=[${row.replayedUnexpected.join(
        " | "
      )}] residual=[${row.residualUnexpected.join(" | ")}]`
    );
  }
  if (unresolvedAlarms.length > 0) {
    console.error(
      `[replay-numbers] HARD WARNING: unresolved case(s) would clear: ${unresolvedAlarms
        .map((row) => row.messageId)
        .join(", ")} - adjudicate before any fixture or rule change`
    );
  }
  console.log(`[replay-numbers] artifact written to ${outPath}`);
}

// One-time fidelity repair for the frozen numeric fixture classes: 21 of the
// 46 cases were report-flow rows seeded with the raw notice body instead of
// the reportReferencePayload join production validated against. The refresh
// keeps the same case membership and stored outputs (run-matched, asserted)
// and replaces only the payloads plus the recomputed expected blocks.
async function refreshNumericPayloadsCommand(
  options: Map<string, string>,
  rootDir: string
): Promise<void> {
  const corpusPath = path.resolve(
    rootDir,
    options.get("corpus") ??
      path.join("tmp", "editorial-eval", "replay-corpus-2026-06-02_2026-08-13.jsonl")
  );
  const replayArtifactPath = path.resolve(
    rootDir,
    options.get("replay-artifact") ??
      path.join("tmp", "editorial-eval", "replay-numbers-2026-06-02_2026-08-13.json")
  );
  const outDir =
    options.get("out") ??
    path.join(rootDir, "apps", "worker", "src", "fixtures", "editorial-eval", "safety");
  const manifestPath = path.join(outDir, "manifest.json");

  let rawCorpus: string;
  try {
    rawCorpus = await fs.readFile(corpusPath, "utf8");
  } catch {
    throw new Error(`Replay corpus not found: ${corpusPath}`);
  }
  const rowsByRunId = new Map<string, ReplayCorpusJsonlRow>();
  for (const line of rawCorpus.replace(/^﻿/, "").split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const row = JSON.parse(line) as ReplayCorpusJsonlRow;
    rowsByRunId.set(row.id, row);
  }

  const replayArtifact = await readJson<{
    summary?: { alreadyCleanUnderLegacy?: number[] };
  }>(replayArtifactPath).catch(() => null);
  const alreadyCleanIds = new Set(
    replayArtifact?.summary?.alreadyCleanUnderLegacy ?? []
  );
  if (!replayArtifact) {
    throw new Error(
      [
        `Replay artifact not found: ${replayArtifactPath}`,
        "Run `npm run eval:editorial -w apps/worker -- replay-numbers` first;",
        "its already-clean set is the independent cross-check for expectation flips."
      ].join("\n")
    );
  }

  const manifest = await readJson<SafetyFixtureManifest>(manifestPath);
  const numericClasses: SafetyGateClass[] = [
    "numeric_false_block",
    "numeric_unresolved"
  ];
  const diffLines: string[] = [];
  const cleanAfterIds: number[] = [];
  const fixtureMessageIds = new Set<number>();
  const refreshedFiles: Array<{
    entry: SafetyFixtureManifest["files"][number];
    filePath: string;
    file: SafetyFixtureFile;
  }> = [];
  const gitHead = (await collectGitSourceState(rootDir)).headRevision;

  // Pass 1: validate and rebuild everything in memory. Nothing is written
  // until every case in both classes has passed every check.
  for (const entry of manifest.files) {
    if (!numericClasses.includes(entry.class)) continue;
    const filePath = path.join(outDir, entry.path);
    const file = await readJson<SafetyFixtureFile>(filePath);

    for (const item of file.cases) {
      fixtureMessageIds.add(item.messageId);
      if (!item.generationRunId) {
        throw new Error(
          `${entry.class} ${item.messageId}: fixture has no generationRunId; cannot run-match`
        );
      }
      const row = rowsByRunId.get(item.generationRunId);
      if (!row) {
        throw new Error(
          `${entry.class} ${item.messageId}: corpus has no row for run ${item.generationRunId}`
        );
      }

      const reUnwrapped = storedRewriteOutputFromRow(row);
      if (!reUnwrapped || !item.storedOutput) {
        throw new Error(
          `${entry.class} ${item.messageId}: stored output missing on ${
            reUnwrapped ? "fixture" : "corpus row"
          }`
        );
      }
      if (
        sha256CanonicalJson(reUnwrapped) !== sha256CanonicalJson(item.storedOutput)
      ) {
        throw new Error(
          `${entry.class} ${item.messageId}: corpus stored output differs from frozen fixture output (run ${item.generationRunId}); investigate before overwriting`
        );
      }

      const payloadResult = replayValidationPayloadFromRow(row);
      if (!payloadResult) {
        throw new Error(
          `${entry.class} ${item.messageId}: corpus payload missing or malformed`
        );
      }
      if (
        payloadResult.flow === "report" &&
        payloadResult.validationSourceCharsMatch !== true
      ) {
        throw new Error(
          `${entry.class} ${item.messageId}: report payload reconstruction failed the validationSourceChars tripwire (${String(
            payloadResult.validationSourceCharsMatch
          )})`
        );
      }

      const before = item.expected.validation;
      item.sourcePayload = payloadResult.payload;
      item.expected = replayExpected(item);
      const after = item.expected.validation;
      if (!after) {
        throw new Error(
          `${entry.class} ${item.messageId}: replay produced no validation expectation`
        );
      }

      if (
        entry.class === "numeric_unresolved" &&
        after.hasUnexpectedNumbers !== true
      ) {
        throw new Error(
          `HARD STOP: unresolved case ${item.messageId} would lose UNEXPECTED_NUMBERS under the faithful payload. Adjudicate its classification (the 675221 pattern) first; nothing was written.`
        );
      }

      const beforeCodes = before?.issueCodes ?? [];
      const added = after.issueCodes.filter((code) => !beforeCodes.includes(code));
      const removed = beforeCodes.filter((code) => !after.issueCodes.includes(code));
      if (
        entry.class === "numeric_false_block" &&
        after.hasUnexpectedNumbers !== true
      ) {
        cleanAfterIds.push(item.messageId);
      }
      diffLines.push(
        [
          `${entry.class} ${item.messageId} [${payloadResult.flow}]`,
          `payloadChars ${String((item.sourcePayload as PromptPayload).sourceBodyChars)}`,
          `unexpected ${String(before?.hasUnexpectedNumbers)} -> ${String(after.hasUnexpectedNumbers)}`,
          added.length > 0 ? `+[${added.join(",")}]` : "",
          removed.length > 0 ? `-[${removed.join(",")}]` : ""
        ]
          .filter(Boolean)
          .join("  ")
      );
    }

    file.createdAt = new Date().toISOString();
    file.source = {
      ...file.source,
      gitHead,
      query: `${file.source.query}; payloads refreshed run-matched from ${path
        .relative(rootDir, corpusPath)
        .replaceAll("\\", "/")}`
    };
    refreshedFiles.push({ entry, filePath, file });
  }

  // Independent cross-check before writing: the END STATE must agree with the
  // replay harness — a false-block case replays clean under the faithful
  // payload here if and only if the harness's already-clean-under-legacy set
  // contains it. (Cases can be clean in the frozen expectations already:
  // 675221's "1,02" grounded against even the raw-body payload at freeze
  // time, so "flip transitions" are the wrong comparison surface.) Any
  // disagreement means the engine changed behavior between the replay run and
  // this refresh, or fixture rows diverge from the corpus's latest rows.
  const cleanAfterSet = new Set(cleanAfterIds);
  const replayCleanFixtureIds = new Set(
    [...alreadyCleanIds].filter((id) => fixtureMessageIds.has(id))
  );
  const cleanButNotReplayClean = cleanAfterIds.filter(
    (id) => !replayCleanFixtureIds.has(id)
  );
  const replayCleanButStillBlocked = [...replayCleanFixtureIds].filter(
    (id) => !cleanAfterSet.has(id)
  );
  if (cleanButNotReplayClean.length > 0 || replayCleanButStillBlocked.length > 0) {
    throw new Error(
      [
        "HARD STOP: refreshed expectations disagree with the replay harness already-clean set; nothing was written.",
        `clean here but not replay-clean: [${cleanButNotReplayClean.join(", ")}]`,
        `replay-clean fixture members still blocked here: [${replayCleanButStillBlocked.join(", ")}]`,
        "Re-run replay-numbers on the current build and investigate before retrying."
      ].join("\n")
    );
  }

  // Pass 2: all checks passed; write files and manifest.
  for (const { entry, filePath, file } of refreshedFiles) {
    await writeJson(filePath, file);
    entry.caseCount = file.cases.length;
    entry.contentSha256 = sha256CanonicalJson(file);
  }
  manifest.createdAt = new Date().toISOString();
  manifest.corpusId = `editorial_safety_${sha256CanonicalJson(
    manifest.files.map((entry) => entry.contentSha256)
  ).slice(0, 16)}`;
  manifest.uniformExpectations.numeric_false_block =
    "UNEXPECTED_NUMBERS present under current validator except where validator evolution already cleared the stored case (see refresh diff); P2 flips per approved rule class via --update-expected";
  await writeJson(manifestPath, manifest);

  console.log(`[refresh-numeric-payloads] per-case diff:`);
  for (const line of diffLines) console.log(`  ${line}`);
  console.log(
    `[refresh-numeric-payloads] rewrote ${refreshedFiles
      .map(({ entry }) => entry.path)
      .join(", ")} + manifest (corpusId ${manifest.corpusId})`
  );
  console.log(
    `[refresh-numeric-payloads] false-block cases clean under faithful payloads: [${cleanAfterIds.join(", ")}] — matches the replay already-clean set`
  );
  console.log(
    "[refresh-numeric-payloads] review the diff before committing; it is part of the release record."
  );
}

async function buildSafetyFixturesCommand(
  options: Map<string, string>,
  rootDir: string
): Promise<void> {
  const outDir =
    options.get("out") ??
    path.join(rootDir, "apps", "worker", "src", "fixtures", "editorial-eval", "safety");
  const manifestPath = path.join(outDir, "manifest.json");

  if (options.has("update-expected")) {
    const manifest = await readJson<SafetyFixtureManifest>(manifestPath);
    for (const entry of manifest.files) {
      const filePath = path.join(outDir, entry.path);
      const file = await readJson<SafetyFixtureFile>(filePath);
      for (const item of file.cases) {
        item.expected = replayExpected(item);
      }
      await writeJson(filePath, file);
      entry.caseCount = file.cases.length;
      entry.contentSha256 = sha256CanonicalJson(file);
    }
    manifest.createdAt = new Date().toISOString();
    manifest.corpusId = `editorial_safety_${sha256CanonicalJson(
      manifest.files.map((entry) => entry.contentSha256)
    ).slice(0, 16)}`;
    await writeJson(manifestPath, manifest);
    console.log(
      `Updated expected dispositions for ${manifest.files.length} fixture classes in ${outDir}`
    );
    console.log("Review the diff before committing; it is the release record.");
    return;
  }

  const from = options.get("from") ?? "2026-06-02";
  const to = options.get("to") ?? "2026-08-13";
  const numericLimit = optionalInt(options, "numeric-limit", 40);
  const window = { from, to };
  const dateRange = {
    gte: new Date(`${from}T00:00:00.000Z`),
    lte: new Date(`${to}T23:59:59.999Z`)
  };
  const { logPrisma, prisma } = await import("@newsweb/shared/db");

  const fetchSourceNotice = async (
    messageId: number
  ): Promise<PromptPayload | null> => {
    const row = await prisma.sourceNotice.findUnique({
      where: { messageId },
      select: {
        messageId: true,
        newsId: true,
        title: true,
        issuerName: true,
        issuerSign: true,
        publishedAt: true,
        categoriesJson: true,
        marketsJson: true,
        bodyText: true,
        hasAttachments: true
      }
    });
    return row ? payloadFromSourceNotice(row) : null;
  };

  const latestRowPerMessage = (
    rows: SafetySeedRow[],
    prefer?: (row: SafetySeedRow) => boolean
  ): Map<number, SafetySeedRow> => {
    const byMessage = new Map<number, SafetySeedRow>();
    const sorted = [...rows].sort(
      (a, b) => b.requestedAt.getTime() - a.requestedAt.getTime()
    );
    for (const row of sorted) {
      const existing = byMessage.get(row.messageId);
      if (!existing) {
        byMessage.set(row.messageId, row);
        continue;
      }
      if (prefer && !prefer(existing) && prefer(row)) {
        byMessage.set(row.messageId, row);
      }
    }
    return byMessage;
  };

  const curatedIds = Object.values(SAFETY_SEED_MESSAGE_IDS).flat();
  const curatedRows = (await logPrisma.generationRun.findMany({
    where: { messageId: { in: curatedIds } },
    select: SAFETY_SEED_ROW_SELECT
  })) as SafetySeedRow[];

  const classes = new Map<SafetyGateClass, SafetyCase[]>();
  const addCase = async (
    gateClass: SafetyGateClass,
    row: SafetySeedRow,
    feedback?: string[]
  ) => {
    const item = await safetyCaseFromRow(
      gateClass,
      row,
      window,
      feedback,
      fetchSourceNotice
    );
    if (!item) return;
    const list = classes.get(gateClass) ?? [];
    list.push(item);
    classes.set(gateClass, list);
  };

  for (const [gateClass, ids] of Object.entries(SAFETY_SEED_MESSAGE_IDS) as Array<
    [SafetyGateClass, number[]]
  >) {
    const preferPublished = gateClass !== "numeric_unresolved";
    const rows = curatedRows.filter((row) => ids.includes(row.messageId));
    const byMessage = latestRowPerMessage(
      rows,
      preferPublished
        ? (row) => row.status === "published"
        : (row) => hasUnexpectedNumbersIssue(row.validationJson)
    );
    for (const id of ids) {
      const row = byMessage.get(id);
      if (!row) {
        console.warn(`[safety-fixtures] no generation run found for ${gateClass} ${id}`);
        continue;
      }
      await addCase(gateClass, row);
    }
  }

  const legacyRunPath =
    options.get("legacy-run") ??
    path.join(rootDir, "tmp", "editorial-eval", "run-v6draft-50.json");
  let legacyRun: LegacyRunFile | null = null;
  try {
    legacyRun = await readJson<LegacyRunFile>(legacyRunPath);
  } catch {
    console.warn(
      `[safety-fixtures] legacy A/B artifact not readable at ${legacyRunPath}; marker_leak and loaded_language classes will be missing`
    );
  }
  if (legacyRun) {
    for (const [gateClass, ids] of Object.entries(
      AB_SOURCED_SEED_MESSAGE_IDS
    ) as Array<[SafetyGateClass, number[]]>) {
      for (const id of ids) {
        const evalCase = legacyRun.cases.find((item) => item.messageId === id);
        const generation = evalCase
          ? legacyRun.generations.find(
              (item) =>
                item.caseId === evalCase.caseId &&
                item.variantId === legacyRun.challengerVariant
            )
          : undefined;
        if (!evalCase || !generation) {
          console.warn(
            `[safety-fixtures] no challenger generation for ${gateClass} ${id} in ${legacyRunPath}`
          );
          continue;
        }
        const parsedOutput = rewriteOutputSchema.safeParse(generation.output);
        const item: SafetyCase = {
          messageId: id,
          generationRunId: generation.id,
          promptVersion: generation.promptVersion ?? null,
          sourcePayload: evalCase.payload,
          storedOutput: parsedOutput.success ? parsedOutput.data : null,
          storedValidation: {
            validation: generation.validation ?? null,
            referenceCheck: generation.referenceCheck ?? null
          },
          labels: {
            class: gateClass,
            note: `challenger (${legacyRun.challengerVariant}) output from legacy A/B run ${legacyRun.runId}`,
            reportRef: "final report 2026-06-02_2026-08-13"
          },
          expected: {},
          provenance: { window, status: "ab_challenger_output" }
        };
        item.expected = replayExpected(item);
        const list = classes.get(gateClass) ?? [];
        list.push(item);
        classes.set(gateClass, list);
      }
    }
  }

  const failedRows = (await logPrisma.generationRun.findMany({
    where: { status: "failed", requestedAt: dateRange },
    select: SAFETY_SEED_ROW_SELECT
  })) as SafetySeedRow[];
  const unresolvedIds = new Set(SAFETY_SEED_MESSAGE_IDS.numeric_unresolved ?? []);
  const numericByMessage = latestRowPerMessage(
    failedRows.filter(
      (row) =>
        hasUnexpectedNumbersIssue(row.validationJson) &&
        !unresolvedIds.has(row.messageId)
    )
  );
  const numericRows = [...numericByMessage.values()].sort(
    (a, b) => a.messageId - b.messageId
  );
  const sampledNumericRows = strideSample(numericRows, numericLimit);
  const sampledIds = new Set(sampledNumericRows.map((row) => row.messageId));
  const excludedNumericMessageIds = numericRows
    .map((row) => row.messageId)
    .filter((id) => !sampledIds.has(id));
  for (const row of sampledNumericRows) {
    await addCase("numeric_false_block", row);
  }
  console.log(
    `[safety-fixtures] numeric false-block pool ${numericRows.length}, sampled ${sampledNumericRows.length}, excluded ${excludedNumericMessageIds.length}`
  );

  const notNewsIdsRaw = options.get("not-news-ids");
  let notNewsFeedback = new Map<number, string[]>();
  if (notNewsIdsRaw) {
    for (const id of parseMessageIdList(notNewsIdsRaw)) {
      notNewsFeedback.set(id, []);
    }
  } else {
    const feedbackRows = await prisma.feedback.findMany({
      where: { createdAt: dateRange },
      select: { messageId: true, text: true }
    });
    notNewsFeedback = feedbackRows.reduce((map, row) => {
      const list = map.get(row.messageId) ?? [];
      list.push(row.text);
      map.set(row.messageId, list);
      return map;
    }, new Map<number, string[]>());
    console.log(
      `[safety-fixtures] derived ${notNewsFeedback.size} feedback message IDs for routine_not_news; curate with --not-news-ids if this includes non-"not news" feedback`
    );
  }
  if (notNewsFeedback.size > 0) {
    const rows = (await logPrisma.generationRun.findMany({
      where: { messageId: { in: [...notNewsFeedback.keys()] } },
      select: SAFETY_SEED_ROW_SELECT
    })) as SafetySeedRow[];
    const byMessage = latestRowPerMessage(rows, (row) => row.status === "published");
    for (const [id, texts] of [...notNewsFeedback.entries()].sort(
      (a, b) => a[0] - b[0]
    )) {
      const row = byMessage.get(id);
      if (!row) {
        console.warn(`[safety-fixtures] no generation run for routine_not_news ${id}`);
        continue;
      }
      await addCase("routine_not_news", row, texts);
    }
  }

  const falseSkipIdsRaw = options.get("false-skip-ids");
  let falseSkipIds: number[];
  if (falseSkipIdsRaw) {
    falseSkipIds = parseMessageIdList(falseSkipIdsRaw);
  } else {
    // Index-only query: the full JSON columns are far too heavy for the whole
    // window, and derivation needs only status/reason ordering per message.
    const windowIndexRows = await logPrisma.generationRun.findMany({
      where: { requestedAt: dateRange },
      select: { messageId: true, status: true, reason: true, requestedAt: true }
    });
    const byMessage = new Map<
      number,
      Array<{ status: string; reason: string; requestedAt: Date }>
    >();
    for (const row of windowIndexRows) {
      const list = byMessage.get(row.messageId) ?? [];
      list.push(row);
      byMessage.set(row.messageId, list);
    }
    falseSkipIds = [...byMessage.entries()]
      .filter(([, rows]) => {
        const ordered = [...rows].sort(
          (a, b) => a.requestedAt.getTime() - b.requestedAt.getTime()
        );
        const firstSkip = ordered.findIndex((row) => row.status === "skipped");
        if (firstSkip === -1) return false;
        return ordered
          .slice(firstSkip + 1)
          .some((row) => row.reason === "manual-reprocess");
      })
      .map(([messageId]) => messageId)
      .sort((a, b) => a - b);
    console.log(
      `[safety-fixtures] derived ${falseSkipIds.length} skip-then-regenerate message IDs for false_skip`
    );
  }
  if (falseSkipIds.length > 0) {
    const falseSkipRows = (await logPrisma.generationRun.findMany({
      where: { messageId: { in: falseSkipIds }, requestedAt: dateRange },
      select: SAFETY_SEED_ROW_SELECT
    })) as SafetySeedRow[];
    const byMessage = latestRowPerMessage(
      falseSkipRows,
      (row) => row.status === "skipped"
    );
    for (const id of falseSkipIds) {
      const row = byMessage.get(id);
      if (!row) {
        console.warn(`[safety-fixtures] no generation run for false_skip ${id}`);
        continue;
      }
      await addCase("false_skip", row);
    }
  }

  const createdAt = new Date().toISOString();
  const gitHead = (await collectGitSourceState(rootDir)).headRevision;
  const fileEntries: SafetyFixtureManifest["files"] = [];
  for (const [gateClass, cases] of [...classes.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    cases.sort((a, b) => a.messageId - b.messageId);
    const fileName = `${gateClass.replaceAll("_", "-")}.json`;
    const file: SafetyFixtureFile = {
      schemaVersion: 1,
      class: gateClass,
      createdAt,
      source: {
        db: "render-prod",
        query: `generation_runs/source_notices/feedback ${from}..${to}`,
        gitHead
      },
      cases
    };
    await writeJson(path.join(outDir, fileName), file);
    fileEntries.push({
      path: fileName,
      class: gateClass,
      caseCount: cases.length,
      contentSha256: sha256CanonicalJson(file)
    });
    console.log(`[safety-fixtures] wrote ${cases.length} ${gateClass} cases`);
  }

  const manifest: SafetyFixtureManifest = {
    schemaVersion: 1,
    corpusId: `editorial_safety_${sha256CanonicalJson(
      fileEntries.map((entry) => entry.contentSha256)
    ).slice(0, 16)}`,
    createdAt,
    files: fileEntries,
    uniformExpectations: {
      numeric_false_block:
        "UNEXPECTED_NUMBERS present under current validator; P2 flips per approved rule class via --update-expected",
      numeric_unresolved:
        "UNEXPECTED_NUMBERS present; hard invariant, never flips"
    },
    excludedNumericMessageIds,
    sourceQueries: {
      numeric_false_block: `generation_runs status=failed requestedAt ${from}..${to} with issues[].code=UNEXPECTED_NUMBERS, latest row per message, stride-sampled to ${numericLimit}`,
      routine_not_news: notNewsIdsRaw
        ? `curated --not-news-ids`
        : `feedback createdAt ${from}..${to} joined to latest published generation run`,
      false_skip: falseSkipIdsRaw
        ? `curated --false-skip-ids`
        : `generation_runs requestedAt ${from}..${to} with status=skipped followed by reason=manual-reprocess`
    }
  };
  await writeJson(manifestPath, manifest);
  console.log(
    `Wrote safety fixture manifest ${manifest.corpusId} (${fileEntries.length} classes) to ${manifestPath}`
  );
}

async function runCommand(options: Map<string, string>): Promise<void> {
  const startedAt = new Date().toISOString();
  const casesPath = requiredOption(options, "cases");
  const controlVariant = parseVariant(requiredOption(options, "control"));
  const challengerVariant = parseVariant(requiredOption(options, "challenger"));
  const outPath = requiredOption(options, "out");
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.5";
  const controlModel = options.get("control-model")?.trim() || model;
  const challengerModel = options.get("challenger-model")?.trim() || model;
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? 240000);
  const reasoningEffort = parseReasoningEffort(
    process.env.OPENAI_DEFAULT_REASONING_EFFORT,
    "medium"
  );
  const controlReasoningEffort = parseReasoningEffort(
    options.get("control-effort"),
    reasoningEffort
  );
  const challengerReasoningEffort = parseReasoningEffort(
    options.get("challenger-effort"),
    reasoningEffort
  );
  const referenceModel =
    options.get("reference-model")?.trim() || challengerModel;
  const referenceReasoningEffort = parseReasoningEffort(
    options.get("reference-effort"),
    "medium"
  );
  const serviceTier = parseServiceTier(
    options.get("service-tier") ?? process.env.OPENAI_SERVICE_TIER,
    "flex"
  );
  const controlProfile = resolveEvalArmRunProfile({
    arm: "control",
    variantId: controlVariant,
    model: controlModel,
    reasoningEffort: controlReasoningEffort,
    serviceTier
  });
  const challengerProfile = resolveEvalArmRunProfile({
    arm: "challenger",
    variantId: challengerVariant,
    model: challengerModel,
    reasoningEffort: challengerReasoningEffort,
    serviceTier
  });
  const referenceProfile = resolveReferenceRunProfile({
    schema: referenceCheckJsonSchema as Record<string, unknown>,
    model: referenceModel,
    reasoningEffort: referenceReasoningEffort,
    serviceTier
  });
  const assignmentSeed =
    options.get("assignment-seed")?.trim() || createArtifactSeed();
  const orderingSeed = options.get("ordering-seed")?.trim() || createArtifactSeed();
  const casesFile = await readJson<CasesFile>(casesPath);
  const cases = casesFile.cases.map((item) => {
    const calculatedSourceSha256 = sourcePayloadSha256(item.payload);
    if (
      item.sourceSha256 &&
      item.sourceSha256 !== calculatedSourceSha256
    ) {
      throw new Error(
        `Source hash mismatch for ${item.caseId}: stored ${item.sourceSha256}, calculated ${calculatedSourceSha256}`
      );
    }
    return { ...item, sourceSha256: calculatedSourceSha256 };
  });
  const corpus = createCorpusIdentity(cases, casesPath);
  if (casesFile.corpusSha256 && casesFile.corpusSha256 !== corpus.corpusSha256) {
    throw new Error(
      `Cases file corpus hash mismatch: stored ${casesFile.corpusSha256}, calculated ${corpus.corpusSha256}`
    );
  }
  const repoRoot = await findRepoRoot();
  const sourceState = await collectGitSourceState(repoRoot);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for eval run.");
  }
  const client = createOpenAIClient(apiKey);
  const generations: EvalGeneration[] = [];

  for (const evalCase of cases) {
    for (const profile of [controlProfile, challengerProfile]) {
      console.log(
        `[eval] ${evalCase.caseId} ${profile.arm} ${profile.requestedModel} ${profile.requestedReasoningEffort}`
      );
      generations.push(
        await runGeneration({
          evalCase,
          profile,
          referenceProfile,
          timeoutMs,
          client
        })
      );
    }
  }

  const reviewProtocol = createReviewProtocol(
    generations,
    controlVariant,
    challengerVariant,
    { assignmentSeed, orderingSeed }
  );
  const integrity: EvalArtifactIntegrity = {
    promotionEligible: true,
    reasons: [],
    warnings: sourceState.dirty
      ? [
          `Evaluation was generated from a dirty worktree (${sourceState.sourceStateSha256}).`
        ]
      : []
  };
  const output: RunArtifactV3<EvalCase, EvalGeneration> = {
    schemaVersion: 3,
    runId: `editorial_eval_${timestampForFile(new Date())}_${assignmentSeed.slice(0, 8)}`,
    createdAt: startedAt,
    startedAt,
    completedAt: new Date().toISOString(),
    sourceState,
    corpus,
    profiles: {
      control: controlProfile,
      challenger: challengerProfile,
      reference: referenceProfile
    },
    controlVariant,
    challengerVariant,
    reviewProtocol,
    integrity,
    cases,
    generations
  };

  await writeNewJsonArtifact(outPath, output);
  console.log(`Wrote eval run to ${outPath}`);
}

async function runGeneration({
  evalCase,
  profile,
  referenceProfile,
  timeoutMs,
  client
}: {
  evalCase: EvalCase;
  profile: EvalArmRunProfile;
  referenceProfile: EvalReferenceRunProfile;
  timeoutMs: number;
  client: ReturnType<typeof createOpenAIClient>;
}): Promise<EvalGeneration> {
  const generationStartedAt = new Date().toISOString();
  const startedAt = Date.now();
  const messages = createRegularPromptVariantMessages(
    profile.variantId,
    evalCase.payload
  );
  const registeredProfile = getRegularPromptVariantProfile(profile.variantId);
  if (
    messages.promptVersion !== profile.promptVersion ||
    registeredProfile.responseSchemaId !== profile.responseSchemaId
  ) {
    throw new Error(
      `Evaluation profile changed after preflight for ${profile.variantId}`
    );
  }
  const responseSchema = getEvalResponseSchemaProfile(profile.responseSchemaId);
  const generationPromptHashes = promptHashes(messages);
  const rewritePromptChars =
    messages.systemPrompt.length +
    messages.developerPrompt.length +
    messages.userPrompt.length;
  let referencePromptChars = 0;
  const modelCalls: EvalModelCall[] = [];

  const requestMetadata = {
    requestedModel: profile.requestedModel,
    requestedReasoningEffort: profile.requestedReasoningEffort,
    requestedVerbosity: profile.requestedVerbosity,
    requestedServiceTier: profile.requestedServiceTier,
    reasoningContext: profile.reasoningContext,
    maxOutputTokens: profile.maxOutputTokens,
    modelGenerationSeed: profile.modelGenerationSeed
  };
  const artifactMetadata = {
    startedAt: generationStartedAt,
    responseSchemaId: profile.responseSchemaId,
    schemaSha256: profile.schemaSha256,
    parserProfileId: profile.parserProfileId,
    validationProfileId: profile.validationProfileId,
    promptHashes: generationPromptHashes,
    requestMetadata
  };

  try {
    const rewriteResult = await callOpenAIForJson(client, {
      schemaName: responseSchema.schemaName,
      schema: responseSchema.schema as Record<string, unknown>,
      systemPrompt: messages.systemPrompt,
      developerPrompt: messages.developerPrompt,
      userPrompt: messages.userPrompt,
      model: profile.requestedModel,
      reasoningEffort: profile.requestedReasoningEffort,
      serviceTier: profile.requestedServiceTier,
      reasoningContext: profile.reasoningContext,
      timeoutMs,
      maxOutputTokens: profile.maxOutputTokens
    });
    modelCalls.push(
      evalModelCall(
        responseSchema.schemaName,
        profile.requestedModel,
        profile.requestedReasoningEffort,
        profile.requestedServiceTier,
        rewriteResult
      )
    );
    const raw = rewriteResult.content;
    const parsed = rewriteOutputSchema.parse(clampRewriteArrays(JSON.parse(raw)));
    const styleResult = sanitizeRewriteStyle(parsed);
    const output = styleResult.rewrite;
    const validation = validateRewriteOutput(output, evalCase.payload);
    const referencePayload = evalCase.payload.pdfSupplementText
      ? {
          ...evalCase.payload,
          bodyText: `${evalCase.payload.bodyText}\n\n${evalCase.payload.pdfSupplementText}`
        }
      : evalCase.payload;
    const referenceResult = await runReferenceCheck({
      payload: referencePayload,
      rewrite: output,
      profile: referenceProfile,
      timeoutMs,
      client
    });
    referencePromptChars = referenceResult.promptChars;
    if (referenceResult.modelCall) modelCalls.push(referenceResult.modelCall);
    const referenceGate = assessReferenceCheckGate(referenceResult.coverage);
    const fatalStatus = fatalStatusFor({
      validationBlockingErrors: validation.blockingErrors,
      referenceBlocking: referenceGate.blocking,
      referenceBlockingReason: referenceGate.reason
    });

    return {
      id: `${evalCase.caseId}:${profile.arm}`,
      caseId: evalCase.caseId,
      arm: profile.arm,
      variantId: profile.variantId,
      category: evalCase.category,
      promptVersion: messages.promptVersion,
      model: profile.requestedModel,
      reasoningEffort: profile.requestedReasoningEffort,
      serviceTier: profile.requestedServiceTier,
      ...artifactMetadata,
      completedAt: new Date().toISOString(),
      modelCalls,
      output,
      validation: {
        valid: validation.valid,
        issues: validation.issues,
        blockingErrors: validation.blockingErrors,
        warnings: validation.warnings
      },
      quoteTelemetry: validation.quoteTelemetry,
      referenceCheck: {
        coveragePercent: referenceResult.coverage.coveragePercent,
        unsupportedSentenceCount:
          referenceResult.coverage.unsupportedSentences.length,
        blocking: referenceGate.blocking,
        blockingReason: referenceGate.reason,
        highRiskUnsupportedSentenceCount:
          referenceGate.highRiskUnsupportedSentences.length,
        coverage: referenceResult.coverage,
        checkerError: null
      },
      styleSanitization: styleResult.stats,
      fatalStatus,
      promptChars: rewritePromptChars + referencePromptChars,
      rewritePromptChars,
      referencePromptChars,
      latencyMs: Date.now() - startedAt,
      errorText: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: `${evalCase.caseId}:${profile.arm}`,
      caseId: evalCase.caseId,
      arm: profile.arm,
      variantId: profile.variantId,
      category: evalCase.category,
      promptVersion: messages.promptVersion,
      model: profile.requestedModel,
      reasoningEffort: profile.requestedReasoningEffort,
      serviceTier: profile.requestedServiceTier,
      ...artifactMetadata,
      completedAt: new Date().toISOString(),
      modelCalls,
      output: null,
      validation: null,
      referenceCheck: {
        coveragePercent: 0,
        unsupportedSentenceCount: 0,
        blocking: true,
        blockingReason: "Generation or validation failed.",
        highRiskUnsupportedSentenceCount: 0,
        coverage: null,
        checkerError: message
      },
      styleSanitization: null,
      fatalStatus: { fatal: true, reasons: [message] },
      promptChars: rewritePromptChars + referencePromptChars,
      rewritePromptChars,
      referencePromptChars,
      latencyMs: Date.now() - startedAt,
      errorText: message
    };
  }
}

async function runReferenceCheck({
  payload,
  rewrite,
  profile,
  timeoutMs,
  client
}: {
  payload: PromptPayload;
  rewrite: RewriteOutput;
  profile: EvalReferenceRunProfile;
  timeoutMs: number;
  client: ReturnType<typeof createOpenAIClient>;
}): Promise<{
  coverage: ReferenceCoverageReport;
  promptChars: number;
  modelCall: EvalModelCall | null;
}> {
  const referencePrompt = buildReferenceCheckPrompt(payload, rewrite);
  const promptChars =
    referencePrompt.systemPrompt.length +
    referencePrompt.developerPrompt.length +
    referencePrompt.userPrompt.length;

  if (referencePrompt.draftSentences.length === 0) {
    return { coverage: emptyReferenceCoverageReport(), promptChars: 0, modelCall: null };
  }

  const result = await callOpenAIForJson(client, {
    schemaName: "reference_check_result",
    schema: referenceCheckJsonSchema as Record<string, unknown>,
    systemPrompt: referencePrompt.systemPrompt,
    developerPrompt: referencePrompt.developerPrompt,
    userPrompt: referencePrompt.userPrompt,
    model: profile.requestedModel,
    reasoningEffort: profile.requestedReasoningEffort,
    serviceTier: profile.requestedServiceTier,
    reasoningContext: profile.reasoningContext,
    timeoutMs,
    maxOutputTokens: profile.maxOutputTokens
  });
  const raw = result.content;
  const parsed = referenceCheckResultSchema.parse(JSON.parse(raw));
  return {
    coverage: buildCoverageReport(referencePrompt.draftSentences, parsed, {
      visibleArticleSentenceCount: referencePrompt.visibleDraftSentences.length
    }),
    promptChars,
    modelCall: evalModelCall(
      "reference_check_result",
      profile.requestedModel,
      profile.requestedReasoningEffort,
      profile.requestedServiceTier,
      result
    )
  };
}

function evalModelCall(
  schemaName: string,
  model: string,
  reasoningEffort: OpenAIReasoningEffort,
  serviceTierRequested: OpenAIServiceTier,
  result: OpenAIJsonResult
): EvalModelCall {
  const { content: _content, ...telemetry } = result;
  return {
    schemaName,
    model,
    reasoningEffort,
    serviceTierRequested,
    ...telemetry
  };
}

async function reviewHtmlCommand(options: Map<string, string>): Promise<void> {
  const runPath = requiredOption(options, "run");
  const outPath = requiredOption(options, "out");
  const run = await readJson<RunFile>(runPath);
  let reviewProtocol: ReviewProtocol;
  let integrity: EvalArtifactIntegrity;
  if (run.schemaVersion === 3) {
    assertReviewProtocolIntegrity(
      run.reviewProtocol,
      run.generations,
      run.controlVariant,
      run.challengerVariant
    );
    reviewProtocol = run.reviewProtocol;
    integrity = run.integrity;
  } else {
    const reviewsPath = requiredOption(options, "reviews");
    const reviews = await readReviews(reviewsPath);
    reviewProtocol = createLegacyReviewProtocol(
      run.generations,
      reviews,
      run.controlVariant,
      run.challengerVariant
    );
    integrity = {
      promotionEligible: false,
      reasons: [
        `Legacy run schema ${run.schemaVersion} lacks stored profiles and review protocol.`
      ],
      warnings: []
    };
  }
  await writeText(
    outPath,
    renderReviewHtml({
      run,
      assignments: reviewProtocol.assignments,
      integrity
    })
  );
  console.log(`Wrote blind review HTML to ${outPath}`);
}

async function summarizeCommand(options: Map<string, string>): Promise<void> {
  const runPath = requiredOption(options, "run");
  const reviewsPath = requiredOption(options, "reviews");
  const outPath = requiredOption(options, "out");
  const run = await readJson<RunFile>(runPath);
  const reviews = await readReviews(reviewsPath);
  const artifactIntegrity =
    run.schemaVersion === 3
      ? run.integrity
      : {
          promotionEligible: false,
          reasons: [
            `Legacy run schema ${run.schemaVersion} lacks stored profiles and review protocol.`
          ],
          warnings: []
        };
  if (run.schemaVersion === 3) {
    assertReviewProtocolIntegrity(
      run.reviewProtocol,
      run.generations,
      run.controlVariant,
      run.challengerVariant
    );
  }
  const summary = summarizeEditorialEval(run, reviews, {
    controlVariant: run.controlVariant,
    challengerVariant: run.challengerVariant,
    reviewProtocol: run.schemaVersion === 3 ? run.reviewProtocol : undefined,
    artifactIntegrity
  });
  await writeJson(outPath, {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    runId: run.runId,
    controlVariant: run.controlVariant,
    challengerVariant: run.challengerVariant,
    sourceRunSchemaVersion: run.schemaVersion,
    summary
  });
  console.log(`Wrote eval summary to ${outPath}`);
}

async function readReviews(filePath: string): Promise<EvalReview[]> {
  const rawReviews = await readJson<unknown>(filePath);
  return Array.isArray(rawReviews)
    ? (rawReviews as EvalReview[])
    : ((rawReviews as { reviews?: EvalReview[] }).reviews ?? []);
}

function fatalStatusFor({
  validationBlockingErrors,
  referenceBlocking,
  referenceBlockingReason
}: {
  validationBlockingErrors: string[];
  referenceBlocking: boolean;
  referenceBlockingReason: string | null;
}): EvalFatalStatus {
  const reasons = [
    ...validationBlockingErrors.map((message) => `validation: ${message}`),
    referenceBlocking
      ? `reference: ${referenceBlockingReason ?? "blocking reference check"}`
      : null
  ].filter((value): value is string => Boolean(value));
  return {
    fatal: reasons.length > 0,
    reasons
  };
}

function extractRegularPayload(inputJson: Prisma.JsonValue | null): PromptPayload | null {
  const input = asRecord(inputJson);
  const sourcePayload = asRecord(input?.sourcePayload);
  if (!sourcePayload || isReportPayload(sourcePayload)) {
    return null;
  }
  if (
    typeof sourcePayload.messageId !== "number" ||
    typeof sourcePayload.title !== "string" ||
    typeof sourcePayload.issuerName !== "string" ||
    typeof sourcePayload.issuerSign !== "string" ||
    typeof sourcePayload.publishedAt !== "string" ||
    !Array.isArray(sourcePayload.categories) ||
    !Array.isArray(sourcePayload.markets) ||
    typeof sourcePayload.bodyText !== "string" ||
    typeof sourcePayload.hasAttachments !== "boolean"
  ) {
    return null;
  }

  const sourceBodyChars =
    typeof sourcePayload.sourceBodyChars === "number"
      ? sourcePayload.sourceBodyChars
      : sourcePayload.bodyText.length;
  return {
    messageId: sourcePayload.messageId,
    title: sourcePayload.title,
    issuerName: sourcePayload.issuerName,
    issuerSign: sourcePayload.issuerSign,
    publishedAt: sourcePayload.publishedAt,
    categories: sourcePayload.categories.filter(
      (item): item is string => typeof item === "string"
    ),
    markets: sourcePayload.markets.filter(
      (item): item is string => typeof item === "string"
    ),
    bodyText: sourcePayload.bodyText,
    hasAttachments: sourcePayload.hasAttachments,
    sourceBodyChars,
    ...(typeof sourcePayload.pdfSupplementText === "string"
      ? { pdfSupplementText: sourcePayload.pdfSupplementText }
      : {}),
    ...(typeof sourcePayload.pdfSupplementPageCount === "number"
      ? { pdfSupplementPageCount: sourcePayload.pdfSupplementPageCount }
      : {}),
    ...(typeof sourcePayload.pdfSupplementAttachmentId === "number"
      ? { pdfSupplementAttachmentId: sourcePayload.pdfSupplementAttachmentId }
      : {})
  };
}

function payloadFromSourceNotice(row: SourceNoticeCaseRow): PromptPayload {
  return {
    messageId: row.messageId,
    title: row.title,
    issuerName: row.issuerName,
    issuerSign: row.issuerSign,
    publishedAt: row.publishedAt.toISOString(),
    categories: stringArrayFromJson(row.categoriesJson),
    markets: stringArrayFromJson(row.marketsJson),
    bodyText: row.bodyText,
    hasAttachments: row.hasAttachments,
    sourceBodyChars: row.bodyText.length
  };
}

function stringArrayFromJson(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isReportLikeRegularPayload(payload: PromptPayload): boolean {
  const searchText = `${payload.title}\n${payload.categories.join(" ")}`;
  const normalizedSearchText = searchText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return [
    /\bannual report\b/i,
    /\bquarterly report\b/i,
    /\bhalf-year(?:ly)? report\b/i,
    /\binterim report\b/i,
    /\bq[1-4]\s+(?:report|results)\b/i,
    /\bfinancial report\b/i,
    /\barsrapport\b/i,
    /\bkvartalsrapport\b/i,
    /\bhalvarsrapport\b/i,
    /\bdelarsrapport\b/i,
    /\bfinansiell rapport\b/i
  ].some(
    (pattern) => pattern.test(searchText) || pattern.test(normalizedSearchText)
  );
}

function isAttachmentOnlySourceNotice(payload: PromptPayload): boolean {
  if (!payload.hasAttachments) return false;
  const body = payload.bodyText.trim();
  if (body.length > 140) return false;
  return /\b(?:attached|attachment|pdf|vedlegg|newsweb)\b/i.test(body);
}

function isReportPayload(payload: Record<string, unknown>): boolean {
  return (
    "reportText" in payload ||
    "reportPageCount" in payload ||
    "letterText" in payload ||
    "remunerationText" in payload
  );
}

function difficultyTagsForValidation(validationJson: Prisma.JsonValue | null): string[] {
  const validation = asRecord(validationJson);
  const referenceCheck = asRecord(validation?.referenceCheck);
  const tags: string[] = [];
  if (referenceCheck?.correctionApplied === true) {
    tags.push("reference_repaired");
  }
  if (referenceCheck?.attributionCorrectionApplied === true) {
    tags.push("attribution_repaired");
  }
  if (Array.isArray(validation?.issues) && validation.issues.length > 0) {
    tags.push("had_validation_issues");
  }
  return tags;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseVariant(value: string): RegularPromptVariantId {
  if (!isRegularPromptVariantId(value)) {
    throw new Error(
      `Unknown prompt variant: ${value}. Expected one of ${regularPromptVariantIds.join(", ")}`
    );
  }
  return value;
}

function parseReasoningEffort(
  value: string | undefined,
  fallback: OpenAIReasoningEffort
): OpenAIReasoningEffort {
  if (!value) return fallback;
  if (!openAIReasoningEfforts.includes(value as OpenAIReasoningEffort)) {
    throw new Error(`Invalid reasoning effort: ${value}`);
  }
  return value as OpenAIReasoningEffort;
}

function parseServiceTier(
  value: string | undefined,
  fallback: OpenAIServiceTier
): OpenAIServiceTier {
  if (!value) return fallback;
  if (!openAIServiceTiers.includes(value as OpenAIServiceTier)) {
    throw new Error(`Invalid service tier: ${value}`);
  }
  return value as OpenAIServiceTier;
}

function clampRewriteArrays(raw: Record<string, unknown>): Record<string, unknown> {
  const limits: Record<string, number> = {
    body: 8,
    key_facts: 8,
    source_spans: 8,
    negative_or_surprising: 6,
    excluded_hype: 6,
    source_limitations: 6
  };
  for (const [key, max] of Object.entries(limits)) {
    if (Array.isArray(raw[key]) && raw[key].length > max) {
      raw[key] = raw[key].slice(0, max);
    }
  }
  return raw;
}

function renderReviewHtml({
  run,
  assignments,
  integrity
}: {
  run: RunFile;
  assignments: ReviewAssignment[];
  integrity: EvalArtifactIntegrity;
}): string {
  const payload = JSON.stringify({ run, assignments, integrity }).replace(
    /</g,
    "\\u003c"
  );
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Editorial Eval Review</title>
  <style>
    :root {
      --bg-main: #1d1d1d;
      --bg-panel: #2a2a2a;
      --bg-soft: #333333;
      --ink: #fffbf8;
      --ink-soft: #9b9b9b;
      --accent: #ffffff;
      --line: #3d3d3d;
      --warning: #fa4747;
      --radius: 8px;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg-main: #f5f5f5;
        --bg-panel: #ffffff;
        --bg-soft: #ebebeb;
        --ink: #1a1a1a;
        --ink-soft: #6b6b6b;
        --accent: #1a1a1a;
        --line: #d5d5d5;
        --warning: #d93025;
      }
    }
    :root[data-theme="light"] {
      --bg-main: #f5f5f5;
      --bg-panel: #ffffff;
      --bg-soft: #ebebeb;
      --ink: #1a1a1a;
      --ink-soft: #6b6b6b;
      --accent: #1a1a1a;
      --line: #d5d5d5;
      --warning: #d93025;
    }
    :root[data-theme="dark"] {
      --bg-main: #1d1d1d;
      --bg-panel: #2a2a2a;
      --bg-soft: #333333;
      --ink: #fffbf8;
      --ink-soft: #9b9b9b;
      --accent: #ffffff;
      --line: #3d3d3d;
      --warning: #fa4747;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--bg-main);
      overflow-x: hidden;
    }
    button, textarea, input { font: inherit; }
    button {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--bg-soft);
      color: var(--ink);
      cursor: pointer;
    }
    button:hover:not(:disabled) { border-color: var(--ink-soft); }
    button:disabled { cursor: default; opacity: 0.38; }
    button:focus-visible, summary:focus-visible, textarea:focus-visible {
      outline: 2px solid var(--ink-soft);
      outline-offset: 2px;
    }
    .pageShell {
      width: min(1060px, 92vw);
      margin: 0 auto;
      padding: 1.1rem 0 11rem;
    }
    .topBar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding-bottom: 0.9rem;
      border-bottom: 1px solid var(--line);
    }
    .topLead { min-width: 0; flex: 1; }
    .eyebrow { color: var(--ink-soft); font-size: 0.8rem; }
    .meta { color: var(--ink-soft); font-size: 0.8rem; line-height: 1.45; }
    #progress { margin-top: 0.35rem; font-variant-numeric: tabular-nums; }
    .warn { color: var(--warning); margin-top: 0.25rem; }
    .warn:empty { display: none; }
    .topActions { display: flex; gap: 0.4rem; flex-shrink: 0; }
    .ghostButton {
      padding: 0.35rem 0.6rem;
      border: none;
      border-radius: var(--radius);
      background: transparent;
      color: var(--ink-soft);
      font-size: 0.78rem;
      white-space: nowrap;
    }
    .ghostButton:hover { color: var(--ink); }
    .progressTrack {
      width: min(360px, 100%);
      height: 3px;
      margin-top: 0.5rem;
      overflow: hidden;
      border-radius: 2px;
      background: var(--bg-soft);
    }
    .progressFill {
      height: 100%;
      width: 0;
      border-radius: 2px;
      background: var(--accent);
      transition: width 0.18s ease;
    }
    .caseBlock { min-width: 0; padding: 1rem 0 0.5rem; }
    .caseMeta { font-size: 0.8rem; }
    #case-title {
      margin: 0.4rem 0 0.5rem;
      font-size: 1.25rem;
      line-height: 1.3;
      font-weight: 700;
      letter-spacing: -0.03em;
      overflow-wrap: anywhere;
    }
    .caseTags { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.4rem 0 0.6rem; }
    .chip {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--bg-soft);
      color: var(--ink-soft);
      padding: 0.16rem 0.5rem;
      font-size: 0.76rem;
    }
    .fold { border-top: 1px solid var(--line); }
    .fold summary {
      list-style: none;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.65rem 0;
      cursor: pointer;
      color: var(--ink-soft);
      font-size: 0.8rem;
    }
    .fold summary::-webkit-details-marker { display: none; }
    .fold summary::before { content: "+"; width: 1rem; }
    .fold[open] summary::before { content: "\\2212"; }
    .sourceBlock {
      min-width: 0;
      max-height: 44vh;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 0 0.5rem 0.8rem 1.5rem;
      scrollbar-width: thin;
      scrollbar-color: var(--line) transparent;
    }
    .sourceBlock::-webkit-scrollbar { width: 4px; }
    .sourceBlock::-webkit-scrollbar-track { background: transparent; }
    .sourceBlock::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }
    .sourceBlock p {
      margin: 0 0 0.7rem;
      font-size: 0.9rem;
      line-height: 1.6;
      color: var(--ink-soft);
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .compareGrid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0;
      align-items: start;
    }
    .versionPanel {
      min-width: 0;
      padding: 1.2rem 0;
      border-bottom: 1px solid var(--line);
      background: transparent;
    }
    .versionLabel {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.25rem;
    }
    .versionPanel h2 {
      margin: 0 0 0.4rem;
      font-size: 1.25rem;
      line-height: 1.3;
      font-weight: 700;
      letter-spacing: -0.03em;
      overflow-wrap: anywhere;
    }
    .articleBody { min-width: 0; overflow-x: hidden; }
    .articleBody p {
      margin: 0.55rem 0;
      font-size: 0.95rem;
      line-height: 1.6;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .tagRow { display: flex; flex-wrap: wrap; gap: 0.45rem; margin: 0.2rem 0 0.6rem; padding-left: 1.5rem; }
    .tagRow label {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.26rem 0.5rem;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      color: var(--ink-soft);
      background: var(--bg-soft);
      font-size: 0.78rem;
      cursor: pointer;
    }
    .tagRow input { accent-color: var(--ink); }
    textarea {
      display: block;
      width: calc(100% - 1.5rem);
      min-height: 70px;
      margin: 0 0 0.9rem 1.5rem;
      padding: 0.6rem 0.7rem;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--bg-soft);
      color: var(--ink);
      resize: vertical;
      outline: none;
    }
    textarea:focus { border-color: var(--ink-soft); }
    .verdictBar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 10;
      background: var(--bg-panel);
      border-top: 1px solid var(--line);
      padding: 0.55rem max(1.2rem, env(safe-area-inset-right)) max(0.75rem, env(safe-area-inset-bottom)) max(1.2rem, env(safe-area-inset-left));
    }
    .verdictInner { max-width: 1060px; margin: 0 auto; }
    .reviewQuestion {
      font-size: 0.84rem;
      color: var(--ink-soft);
      margin-bottom: 0.45rem;
    }
    .choiceRow { display: flex; gap: 0.45rem; align-items: stretch; }
    .choiceButton {
      flex: 1 1 auto;
      min-height: 2.7rem;
      padding: 0.45rem 0.5rem;
      text-align: center;
      font-size: 0.88rem;
      overflow-wrap: anywhere;
    }
    .choiceButton.big { flex: 1.6 1 auto; }
    .choiceButton.selected {
      border-color: var(--ink);
      background: var(--ink);
      color: var(--bg-main);
    }
    .navButton {
      flex: 0 0 3.2rem;
      min-height: 2.7rem;
      font-size: 0.88rem;
      color: var(--ink-soft);
    }
    .navButton:hover:not(:disabled) { color: var(--ink); }
    .verdictStatus { display: flex; justify-content: space-between; gap: 1rem; margin-top: 0.4rem; }
    .verdictStatus .meta {
      font-size: 0.72rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @media (min-width: 940px) {
      .compareGrid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 2rem; }
      .pageShell { padding-bottom: 9.5rem; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; }
    }
  </style>
</head>
<body>
  <main class="pageShell">
    <header class="topBar">
      <div class="topLead">
        <div class="eyebrow">Editorial eval &middot; blind A/B</div>
        <div class="meta" id="progress"></div>
        <div class="progressTrack" aria-hidden="true"><div class="progressFill" id="progress-fill"></div></div>
        <div class="meta warn" id="integrity-note"></div>
        <div class="meta warn" id="storage-note"></div>
      </div>
      <div class="topActions">
        <button class="ghostButton" id="copy" type="button">Copy JSON</button>
        <button class="ghostButton" id="export" type="button">Export reviews.json</button>
      </div>
    </header>

    <section class="caseBlock">
      <div class="meta caseMeta" id="case-meta"></div>
      <h2 id="case-title"></h2>
      <div class="caseTags" id="case-tags"></div>
    </section>

    <details class="fold" open>
      <summary>Original notice</summary>
      <div class="sourceBlock" id="source"></div>
    </details>

    <div class="compareGrid">
      <section class="versionPanel" id="article-a"></section>
      <section class="versionPanel" id="article-b"></section>
    </div>

    <details class="fold">
      <summary>Tags &amp; comment (optional)</summary>
      <div class="tagRow" id="tags"></div>
      <textarea id="comment" placeholder="Optional comment"></textarea>
    </details>
  </main>

  <footer class="verdictBar">
    <div class="verdictInner">
      <div class="reviewQuestion">Which version would require less editing before publication?</div>
      <div class="choiceRow">
        <button class="navButton" id="prev" type="button" aria-label="Previous case">&#8249;</button>
        <button class="choiceButton big" data-winner="A" type="button">A wins</button>
        <button class="choiceButton" data-winner="tie" type="button">Tie</button>
        <button class="choiceButton" data-winner="both_bad" type="button">Both bad</button>
        <button class="choiceButton big" data-winner="B" type="button">B wins</button>
        <button class="navButton" id="next" type="button" aria-label="Next case">&#8250;</button>
      </div>
      <div class="verdictStatus">
        <span class="meta" id="decision-status"></span>
        <span class="meta" id="nav-status"></span>
      </div>
    </div>
  </footer>
  <script type="application/json" id="eval-data">${payload}</script>
  <script>
    const data = JSON.parse(document.getElementById("eval-data").textContent);
    if (!data.integrity.promotionEligible) {
      document.getElementById("integrity-note").textContent =
        "Non-promotable evaluation: " + data.integrity.reasons.join(" ");
    } else if (data.integrity.warnings.length > 0) {
      document.getElementById("integrity-note").textContent =
        data.integrity.warnings.join(" ");
    }
    let storage;
    try {
      storage = window.localStorage;
      storage.setItem("__eval_probe__", "1");
      storage.removeItem("__eval_probe__");
    } catch (err) {
      const memoryStore = new Map();
      storage = {
        getItem: (key) => (memoryStore.has(key) ? memoryStore.get(key) : null),
        setItem: (key, value) => { memoryStore.set(key, String(value)); },
        removeItem: (key) => { memoryStore.delete(key); }
      };
      document.getElementById("storage-note").textContent =
        "This device cannot save progress between visits - copy or export your reviews before closing.";
    }
    const storageKey = "editorial-eval:" + data.run.runId + ":reviews";
    const tags = ["clearer explanation", "better financial language", "better structure", "better Norwegian", "less robotic", "less overexplaining", "less underexplaining", "safer"];
    const byCase = Object.fromEntries(data.run.cases.map(item => [item.caseId, item]));
    const byGeneration = Object.fromEntries(data.run.generations.map(item => [item.id, item]));
    let reviews = JSON.parse(storage.getItem(storageKey) || "[]");
    let index = Number(storage.getItem(storageKey + ":index") || "0");
    let renderedAt = Date.now();

    const winnerLabels = {
      A: "A wins",
      B: "B wins",
      tie: "Tie",
      both_bad: "Both bad"
    };

    function save() {
      storage.setItem(storageKey, JSON.stringify(reviews));
      storage.setItem(storageKey + ":index", String(index));
    }
    function currentReview(caseId) {
      return reviews.find(item => item.caseId === caseId) || null;
    }
    function orderedReviews() {
      const order = new Map(data.assignments.map((item, itemIndex) => [item.caseId, itemIndex]));
      return [...reviews].sort((left, right) => (order.get(left.caseId) ?? 9999) - (order.get(right.caseId) ?? 9999));
    }
    function articleHtml(label, generation) {
      const output = generation.output;
      if (!output) {
        return "<div class='versionLabel'><div class='meta'>Version " + label + "</div></div><h2>No output</h2><div class='articleBody'><p>" + escapeHtml(generation.errorText || "No output") + "</p></div>";
      }
      // Pipeline signals (fatal status, coverage, reference reasons) are
      // deliberately not shown: the blind review should reflect only what a
      // reader would see, without machine-check anchoring.
      return [
        "<div class='versionLabel'><div class='meta'>Version " + label + "</div></div>",
        "<h2>" + escapeHtml(output.title) + "</h2>",
        "<div class='articleBody'>",
        "<p>" + escapeHtml(output.lead) + "</p>",
        ...output.body.map(p => "<p>" + escapeHtml(p) + "</p>"),
        "</div>"
      ].join("");
    }
    function sourceHtml(text) {
      const trimmed = String(text || "").trim();
      if (!trimmed) return "<p class='muted'>No source text.</p>";
      return trimmed
        .split(/\\n{2,}/)
        .map(part => part.replace(/\\n/g, " ").replace(/ {2,}/g, " ").trim())
        .filter(Boolean)
        .map(part => "<p>" + escapeHtml(part) + "</p>")
        .join("");
    }
    function escapeHtml(text) {
      return String(text ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }
    function formatTime(isoString) {
      try {
        return new Intl.DateTimeFormat("nb-NO", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Europe/Oslo"
        }).format(new Date(isoString));
      } catch {
        return isoString;
      }
    }
    function updateCurrentReviewFields() {
      const assignment = data.assignments[index];
      if (!assignment) return;
      const review = currentReview(assignment.caseId);
      if (!review) return;
      review.issueTags = [...document.querySelectorAll("#tags input:checked")].map(input => input.value);
      review.comment = document.getElementById("comment").value.trim();
      save();
    }
    function render() {
      if (data.assignments.length === 0) return;
      index = Math.max(0, Math.min(index, data.assignments.length - 1));
      const assignment = data.assignments[index];
      const evalCase = byCase[assignment.caseId];
      const a = byGeneration[assignment.aGenerationId];
      const b = byGeneration[assignment.bGenerationId];
      const review = currentReview(assignment.caseId);
      const reviewedCount = reviews.length;
      document.getElementById("progress").textContent = (index + 1) + " / " + data.assignments.length + " cases | reviewed " + reviewedCount;
      document.getElementById("progress-fill").style.width = data.assignments.length > 0 ? Math.round((reviewedCount / data.assignments.length) * 100) + "%" : "0";
      document.getElementById("case-meta").textContent = formatTime(evalCase.publishedAt) + " | " + evalCase.company + " (" + evalCase.issuerSign + ") | " + evalCase.category;
      document.getElementById("case-title").textContent = evalCase.sourceTitle;
      document.getElementById("case-tags").innerHTML = evalCase.difficultyTags.map(tag => "<span class='chip'>" + escapeHtml(tag.replaceAll("_", " ")) + "</span>").join("");
      document.getElementById("source").innerHTML = sourceHtml(evalCase.payload.bodyText);
      document.getElementById("article-a").innerHTML = articleHtml("A", a);
      document.getElementById("article-b").innerHTML = articleHtml("B", b);
      document.getElementById("comment").value = review?.comment || "";
      document.getElementById("tags").innerHTML = tags.map(tag => {
        const checked = review?.issueTags?.includes(tag) ? " checked" : "";
        return "<label><input type='checkbox' value='" + escapeHtml(tag) + "'" + checked + "> " + escapeHtml(tag) + "</label>";
      }).join("");
      document.querySelectorAll("[data-winner]").forEach(button => {
        button.classList.toggle("selected", review?.winner === button.dataset.winner);
      });
      document.getElementById("decision-status").textContent = review ? "Saved decision: " + winnerLabels[review.winner] : "No decision saved for this case.";
      document.getElementById("nav-status").textContent = review ? "Ready for next case." : "Pick a decision to enable Next.";
      document.getElementById("prev").disabled = index === 0;
      document.getElementById("next").disabled = !review || index >= data.assignments.length - 1;
      document.getElementById("next").innerHTML = index >= data.assignments.length - 1 ? "&#8250;|" : "&#8250;";
      renderedAt = Date.now();
    }
    function record(winner) {
      const assignment = data.assignments[index];
      const issueTags = [...document.querySelectorAll("#tags input:checked")].map(input => input.value);
      const comment = document.getElementById("comment").value.trim();
      const nextReview = {
        caseId: assignment.caseId,
        aGenerationId: assignment.aGenerationId,
        bGenerationId: assignment.bGenerationId,
        winner,
        issueTags,
        comment,
        reviewTimeMs: Date.now() - renderedAt,
        reviewedAt: new Date().toISOString()
      };
      reviews = reviews.filter(item => item.caseId !== assignment.caseId).concat(nextReview);
      save();
      render();
    }
    document.querySelectorAll("[data-winner]").forEach(button => button.addEventListener("click", () => record(button.dataset.winner)));
    document.getElementById("tags").addEventListener("change", updateCurrentReviewFields);
    document.getElementById("comment").addEventListener("input", updateCurrentReviewFields);
    document.getElementById("prev").addEventListener("click", () => { index -= 1; save(); render(); });
    document.getElementById("next").addEventListener("click", () => {
      const assignment = data.assignments[index];
      if (!currentReview(assignment.caseId)) return;
      index += 1;
      save();
      render();
    });
    document.addEventListener("keydown", event => {
      if (event.target && event.target.tagName === "TEXTAREA") return;
      if (event.key === "1") record("A");
      if (event.key === "2") record("B");
      if (event.key === "3") record("tie");
      if (event.key === "4") record("both_bad");
      if (event.key === "ArrowLeft") { index -= 1; save(); render(); }
      if (event.key === "ArrowRight" && currentReview(data.assignments[index].caseId)) { index += 1; save(); render(); }
    });
    document.getElementById("export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ runId: data.run.runId, reviews: orderedReviews() }, null, 2) + "\\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "reviews.json";
      link.click();
      URL.revokeObjectURL(url);
    });
    function fallbackCopy(text, done) {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.focus();
      area.select();
      try {
        document.execCommand("copy");
        done();
      } catch (err) {
        window.prompt("Copy the JSON below:", text);
      }
      document.body.removeChild(area);
    }
    document.getElementById("copy").addEventListener("click", () => {
      const text = JSON.stringify({ runId: data.run.runId, reviews: orderedReviews() }, null, 2);
      const button = document.getElementById("copy");
      const done = () => {
        button.textContent = "Copied " + orderedReviews().length + "/" + data.assignments.length;
        setTimeout(() => { button.textContent = "Copy JSON"; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    });
    render();
  </script>
</body>
</html>`;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

async function findRepoRoot(): Promise<string> {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (current !== path.dirname(current)) {
    try {
      const packageJson = JSON.parse(
        await fs.readFile(path.join(current, "package.json"), "utf8")
      ) as { name?: string };
      if (packageJson.name === "newsweb-explain-feed") {
        return current;
      }
    } catch {
      // Keep walking.
    }
    current = path.dirname(current);
  }
  return process.cwd();
}

function timestampForFile(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function printUsage(): void {
  console.log([
    "Usage:",
    "  npm run eval:editorial -w apps/worker -- build-cases --from YYYY-MM-DD --to YYYY-MM-DD --limit 50 --out tmp/editorial-eval/cases.json",
    "  npm run eval:editorial -w apps/worker -- run --cases tmp/editorial-eval/cases.json --control regular_v5_6_control --challenger regular_v5_6_control --control-model gpt-5.5 --control-effort medium --challenger-model gpt-5.6-terra --challenger-effort medium --reference-model gpt-5.6-terra --reference-effort medium --service-tier flex [--assignment-seed SEED] [--ordering-seed SEED] --out tmp/editorial-eval/run.json",
    "  npm run eval:editorial -w apps/worker -- review-html --run tmp/editorial-eval/run.json --out tmp/editorial-eval/review.html",
    "  Legacy run schemas 1-2 require --reviews when rendering review HTML.",
    "  npm run eval:editorial -w apps/worker -- summarize --run tmp/editorial-eval/run.json --reviews tmp/editorial-eval/reviews.json --out tmp/editorial-eval/summary.json",
    "  npm run eval:editorial -w apps/worker -- build-cases --message-ids 679311,677571 --out tmp/editorial-eval/curated.json  (curated corpus; also accepts @path/to/ids.txt)",
    "  npm run eval:editorial -w apps/worker -- lock-cases --cases tmp/editorial-eval/cases-v6-50.json --out apps/worker/src/fixtures/editorial-eval/editorial/cases-locked-2026-08.json",
    "  npm run eval:editorial -w apps/worker -- build-safety-fixtures [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--numeric-limit 40] [--not-news-ids IDS] [--false-skip-ids IDS] [--legacy-run PATH] [--out DIR]",
    "  (marker_leak/loaded_language seed from the legacy A/B artifact --legacy-run, default tmp/editorial-eval/run-v6draft-50.json; the rest from the generation-log DB)",
    "  npm run eval:editorial -w apps/worker -- build-safety-fixtures --update-expected  (offline; re-replays validators and rewrites expected blocks)",
    "  npm run eval:editorial -w apps/worker -- replay-numbers [--corpus tmp/editorial-eval/replay-corpus-2026-06-02_2026-08-13.jsonl] [--out PATH]",
    "  (offline; replays the exported UNEXPECTED_NUMBERS corpus through the current assessment engine; paths resolve from the repo root)",
    "  npm run eval:editorial -w apps/worker -- refresh-numeric-payloads [--corpus PATH] [--replay-artifact PATH]",
    "  (offline one-time fidelity repair: run-matched faithful payloads for the two numeric fixture classes; requires a fresh replay-numbers artifact as cross-check)",
    "  Seeding commands need DATABASE_URL / GENERATION_LOG_DATABASE_URL in .env (Render external URLs or local prod clone). Paths resolve from apps/worker under npm -w; absolute paths are safest."
  ].join("\n"));
}

await main();
