import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import {
  createRegularPromptVariantMessages,
  isRegularPromptVariantId,
  regularPromptVariantIds,
  type PromptPayload,
  type RegularPromptVariantId
} from "@newsweb/prompt-kit";
import {
  rewriteOutputJsonSchema,
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
  categorizeEvalPayload,
  createReviewAssignments,
  difficultyTagsForPayload,
  evalCategoryQuotasForLimit,
  selectBalancedEvalCases,
  summarizeEditorialEval,
  type EvalCategoryId,
  type EvalCandidate,
  type EvalCase,
  type EvalFatalStatus,
  type EvalGenerationSummary,
  type EvalReview
} from "../services/editorial-eval.js";
import {
  callOpenAIForJson,
  createOpenAIClient,
  openAIReasoningEfforts,
  type OpenAIReasoningEffort
} from "../services/openai-responses.js";
import { sanitizeRewriteStyle } from "../services/style-sanitizer.js";
import { validateRewriteOutput } from "../services/rewrite-validation.js";

type CasesFile = {
  schemaVersion: 1;
  createdAt: string;
  source: {
    from: string;
    to: string;
    limit: number;
    selection: "direct_prisma_generation_runs" | "direct_prisma_mixed";
  };
  quotas: Record<EvalCategoryId, number>;
  totalCases: number;
  cases: EvalCase[];
};

type EvalGeneration = EvalGenerationSummary & {
  promptVersion: string;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
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

type RunFile = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  controlVariant: RegularPromptVariantId;
  challengerVariant: RegularPromptVariantId;
  sourceCasesPath: string;
  cases: EvalCase[];
  generations: EvalGeneration[];
};

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

await main();

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
  });
  const output: CasesFile = {
    schemaVersion: 1,
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
    cases
  };

  await writeJson(outPath, output);
  console.log(`Wrote ${cases.length} eval cases to ${outPath}`);
}

async function runCommand(options: Map<string, string>): Promise<void> {
  const casesPath = requiredOption(options, "cases");
  const controlVariant = parseVariant(requiredOption(options, "control"));
  const challengerVariant = parseVariant(requiredOption(options, "challenger"));
  const outPath = requiredOption(options, "out");
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.5";
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? 240000);
  const reasoningEffort = parseReasoningEffort(
    process.env.OPENAI_DEFAULT_REASONING_EFFORT,
    "medium"
  );
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for eval run.");
  }
  const client = createOpenAIClient(apiKey);
  const casesFile = await readJson<CasesFile>(casesPath);
  const generations: EvalGeneration[] = [];

  for (const evalCase of casesFile.cases) {
    for (const variantId of [controlVariant, challengerVariant]) {
      console.log(`[eval] ${evalCase.caseId} ${variantId}`);
      generations.push(
        await runGeneration({
          evalCase,
          variantId,
          model,
          reasoningEffort,
          timeoutMs,
          client
        })
      );
    }
  }

  const output: RunFile = {
    schemaVersion: 1,
    runId: `editorial_eval_${timestampForFile(new Date())}`,
    createdAt: new Date().toISOString(),
    model,
    reasoningEffort,
    controlVariant,
    challengerVariant,
    sourceCasesPath: casesPath,
    cases: casesFile.cases,
    generations
  };

  await writeJson(outPath, output);
  console.log(`Wrote eval run to ${outPath}`);
}

async function runGeneration({
  evalCase,
  variantId,
  model,
  reasoningEffort,
  timeoutMs,
  client
}: {
  evalCase: EvalCase;
  variantId: RegularPromptVariantId;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  timeoutMs: number;
  client: ReturnType<typeof createOpenAIClient>;
}): Promise<EvalGeneration> {
  const startedAt = Date.now();
  const messages = createRegularPromptVariantMessages(variantId, evalCase.payload);
  const rewritePromptChars =
    messages.systemPrompt.length +
    messages.developerPrompt.length +
    messages.userPrompt.length;
  let referencePromptChars = 0;

  try {
    const raw = await callOpenAIForJson(client, {
      schemaName: "rewrite_output",
      schema: rewriteOutputJsonSchema as Record<string, unknown>,
      systemPrompt: messages.systemPrompt,
      developerPrompt: messages.developerPrompt,
      userPrompt: messages.userPrompt,
      model,
      reasoningEffort,
      timeoutMs,
      maxOutputTokens: 4096
    });
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
      model,
      reasoningEffort,
      timeoutMs,
      client
    });
    referencePromptChars = referenceResult.promptChars;
    const referenceGate = assessReferenceCheckGate(referenceResult.coverage);
    const fatalStatus = fatalStatusFor({
      validationBlockingErrors: validation.blockingErrors,
      referenceBlocking: referenceGate.blocking,
      referenceBlockingReason: referenceGate.reason
    });

    return {
      id: `${evalCase.caseId}:${variantId}`,
      caseId: evalCase.caseId,
      variantId,
      category: evalCase.category,
      promptVersion: messages.promptVersion,
      model,
      reasoningEffort,
      output,
      validation: {
        valid: validation.valid,
        issues: validation.issues,
        blockingErrors: validation.blockingErrors,
        warnings: validation.warnings
      },
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
      id: `${evalCase.caseId}:${variantId}`,
      caseId: evalCase.caseId,
      variantId,
      category: evalCase.category,
      promptVersion: messages.promptVersion,
      model,
      reasoningEffort,
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
  model,
  reasoningEffort,
  timeoutMs,
  client
}: {
  payload: PromptPayload;
  rewrite: RewriteOutput;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  timeoutMs: number;
  client: ReturnType<typeof createOpenAIClient>;
}): Promise<{ coverage: ReferenceCoverageReport; promptChars: number }> {
  const referencePrompt = buildReferenceCheckPrompt(payload, rewrite);
  const promptChars =
    referencePrompt.systemPrompt.length +
    referencePrompt.developerPrompt.length +
    referencePrompt.userPrompt.length;

  if (referencePrompt.draftSentences.length === 0) {
    return { coverage: emptyReferenceCoverageReport(), promptChars: 0 };
  }

  const raw = await callOpenAIForJson(client, {
    schemaName: "reference_check_result",
    schema: referenceCheckJsonSchema as Record<string, unknown>,
    systemPrompt: referencePrompt.systemPrompt,
    developerPrompt: referencePrompt.developerPrompt,
    userPrompt: referencePrompt.userPrompt,
    model,
    reasoningEffort,
    timeoutMs,
    maxOutputTokens: 4096
  });
  const parsed = referenceCheckResultSchema.parse(JSON.parse(raw));
  return {
    coverage: buildCoverageReport(referencePrompt.draftSentences, parsed, {
      visibleArticleSentenceCount: referencePrompt.visibleDraftSentences.length
    }),
    promptChars
  };
}

async function reviewHtmlCommand(options: Map<string, string>): Promise<void> {
  const runPath = requiredOption(options, "run");
  const outPath = requiredOption(options, "out");
  const run = await readJson<RunFile>(runPath);
  const assignments = createReviewAssignments(
    run.generations,
    run.controlVariant,
    run.challengerVariant
  );
  await writeText(outPath, renderReviewHtml({ run, assignments }));
  console.log(`Wrote blind review HTML to ${outPath}`);
}

async function summarizeCommand(options: Map<string, string>): Promise<void> {
  const runPath = requiredOption(options, "run");
  const reviewsPath = requiredOption(options, "reviews");
  const outPath = requiredOption(options, "out");
  const run = await readJson<RunFile>(runPath);
  const rawReviews = await readJson<unknown>(reviewsPath);
  const reviews = Array.isArray(rawReviews)
    ? (rawReviews as EvalReview[])
    : ((rawReviews as { reviews?: EvalReview[] }).reviews ?? []);
  const summary = summarizeEditorialEval(run, reviews, {
    controlVariant: run.controlVariant,
    challengerVariant: run.challengerVariant
  });
  await writeJson(outPath, {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    runId: run.runId,
    controlVariant: run.controlVariant,
    challengerVariant: run.challengerVariant,
    summary
  });
  console.log(`Wrote eval summary to ${outPath}`);
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
  assignments
}: {
  run: RunFile;
  assignments: ReturnType<typeof createReviewAssignments>;
}): string {
  const payload = JSON.stringify({ run, assignments }).replace(/</g, "\\u003c");
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
      --accent-2: #36c89a;
      --line: #3d3d3d;
      --warning: #fa4747;
      --radius: 8px;
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
    .pageShell {
      width: calc(100% - 2rem);
      max-width: 1100px;
      margin: 0 auto;
      padding: 1.5rem 0 3rem;
    }
    .topBar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .topBar > div { min-width: 0; }
    .topBar h1 {
      margin: 0;
      font-size: clamp(1.4rem, 3vw, 2rem);
      line-height: 1.1;
      font-weight: 800;
      opacity: 0.4;
    }
    .muted { color: var(--ink-soft); }
    .meta {
      color: var(--ink-soft);
      font-size: 0.82rem;
      line-height: 1.4;
    }
    .ghostButton {
      padding: 0;
      border: none;
      border-radius: 0;
      background: transparent;
      color: var(--ink-soft);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .ghostButton:hover { color: var(--ink); }
    .progressTrack {
      width: min(360px, 100%);
      height: 3px;
      margin-top: 0.65rem;
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
    .caseBlock {
      min-width: 0;
      padding: 1rem 0 1.2rem;
      border-bottom: 1px solid var(--line);
    }
    .caseBlock h2,
    .versionPanel h2 {
      margin: 0.35rem 0 0.45rem;
      font-size: 1.25rem;
      line-height: 1.3;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .caseTags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      margin-top: 0.75rem;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--bg-soft);
      color: var(--ink-soft);
      padding: 0.18rem 0.48rem;
      font-size: 0.76rem;
    }
    .sourceBlock {
      min-width: 0;
      max-height: 280px;
      overflow-y: auto;
      overflow-x: hidden;
      padding-right: 0.5rem;
      scrollbar-width: thin;
      scrollbar-color: var(--line) transparent;
    }
    .sourceBlock::-webkit-scrollbar { width: 4px; }
    .sourceBlock::-webkit-scrollbar-track { background: transparent; }
    .sourceBlock::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }
    .sourceBlock p,
    .articleBody p {
      margin: 0.6rem 0;
      line-height: 1.6;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .articleBody { min-width: 0; overflow-x: hidden; }
    .compareGrid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 1.5rem;
      align-items: start;
      margin-top: 0.25rem;
    }
    .versionPanel {
      min-width: 0;
      padding: 1rem 0 1.2rem;
      border-bottom: 1px solid var(--line);
    }
    .versionLabel {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.25rem;
    }
    .fatal {
      color: var(--warning);
      font-size: 0.78rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .reviewPanel {
      min-width: 0;
      margin-top: 1rem;
      padding: 1rem;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--bg-panel);
    }
    .reviewPanel h2 {
      margin: 0 0 0.85rem;
      font-size: 1rem;
      line-height: 1.35;
    }
    .choiceRow,
    .navRow,
    .tagRow {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .choiceButton {
      min-width: 7.5rem;
      padding: 0.55rem 0.7rem;
      text-align: center;
      overflow-wrap: anywhere;
    }
    .choiceButton.selected {
      border-color: var(--ink);
      background: var(--ink);
      color: var(--bg-main);
    }
    .decisionLine {
      min-height: 1.25rem;
      margin: 0.8rem 0;
      color: var(--ink-soft);
      font-size: 0.84rem;
    }
    .tagRow {
      margin: 0.45rem 0 0.75rem;
    }
    .tagRow label {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.28rem 0.48rem;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      color: var(--ink-soft);
      background: var(--bg-soft);
      font-size: 0.8rem;
      cursor: pointer;
    }
    .tagRow input { accent-color: var(--accent-2); }
    textarea {
      display: block;
      width: 100%;
      min-height: 74px;
      margin: 0.75rem 0 0.85rem;
      padding: 0.65rem 0.75rem;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--bg-soft);
      color: var(--ink);
      resize: vertical;
      outline: none;
    }
    textarea:focus { border-color: var(--ink-soft); }
    .navRow {
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .navButtons {
      display: inline-flex;
      gap: 0.5rem;
    }
    .navButtons button {
      padding: 0.5rem 0.7rem;
    }
    @media (max-width: 900px) {
      .topBar {
        display: grid;
        grid-template-columns: 1fr;
      }
      .ghostButton { justify-self: start; }
      .compareGrid { grid-template-columns: 1fr; gap: 0; }
      .choiceButton { flex: 1 1 calc(50% - 0.5rem); }
      .navRow { align-items: stretch; }
      .navButtons { width: 100%; }
      .navButtons button { flex: 1; }
    }
  </style>
</head>
<body>
  <main class="pageShell">
    <header class="topBar">
      <div>
        <h1>Editorial Eval</h1>
        <div class="meta" id="progress"></div>
        <div class="progressTrack" aria-hidden="true"><div class="progressFill" id="progress-fill"></div></div>
      </div>
      <button class="ghostButton" id="export" type="button">Export reviews.json</button>
    </header>

    <section class="caseBlock">
      <div class="meta" id="case-meta"></div>
      <h2 id="case-title"></h2>
      <div class="caseTags" id="case-tags"></div>
    </section>

    <section class="caseBlock">
      <div class="meta">Original notice</div>
      <div class="sourceBlock" id="source"></div>
    </section>

    <div class="compareGrid">
      <section class="versionPanel" id="article-a"></section>
      <section class="versionPanel" id="article-b"></section>
    </div>

    <section class="reviewPanel">
      <h2>Which version would require less editing before publication?</h2>
      <div class="choiceRow">
        <button class="choiceButton" data-winner="A" type="button">A wins</button>
        <button class="choiceButton" data-winner="B" type="button">B wins</button>
        <button class="choiceButton" data-winner="tie" type="button">Tie</button>
        <button class="choiceButton" data-winner="both_bad" type="button">Both bad</button>
      </div>
      <div class="decisionLine" id="decision-status"></div>
      <div class="tagRow" id="tags"></div>
      <textarea id="comment" placeholder="Optional comment"></textarea>
      <div class="navRow">
        <div class="meta" id="nav-status"></div>
        <div class="navButtons">
          <button id="prev" type="button">Previous</button>
          <button id="next" type="button">Next case</button>
        </div>
      </div>
    </section>
  </main>
  <script type="application/json" id="eval-data">${payload}</script>
  <script>
    const data = JSON.parse(document.getElementById("eval-data").textContent);
    const storageKey = "editorial-eval:" + data.run.runId + ":reviews";
    const tags = ["clearer explanation", "better financial language", "better structure", "better Norwegian", "less robotic", "less overexplaining", "less underexplaining", "safer"];
    const byCase = Object.fromEntries(data.run.cases.map(item => [item.caseId, item]));
    const byGeneration = Object.fromEntries(data.run.generations.map(item => [item.id, item]));
    let reviews = JSON.parse(localStorage.getItem(storageKey) || "[]");
    let index = Number(localStorage.getItem(storageKey + ":index") || "0");
    let renderedAt = Date.now();

    const winnerLabels = {
      A: "A wins",
      B: "B wins",
      tie: "Tie",
      both_bad: "Both bad"
    };

    function save() {
      localStorage.setItem(storageKey, JSON.stringify(reviews));
      localStorage.setItem(storageKey + ":index", String(index));
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
        return "<div class='versionLabel'><div class='meta'>Version " + label + "</div><span class='fatal'>Fatal</span></div><h2>No output</h2><div class='articleBody'><p>" + escapeHtml(generation.errorText || "No output") + "</p></div>";
      }
      return [
        "<div class='versionLabel'><div class='meta'>Version " + label + "</div>" + (generation.fatalStatus.fatal ? "<span class='fatal'>Fatal</span>" : "<span class='meta'>" + generation.referenceCheck.coveragePercent + "% coverage</span>") + "</div>",
        "<h2>" + escapeHtml(output.title) + "</h2>",
        "<div class='articleBody'>",
        "<p>" + escapeHtml(output.lead) + "</p>",
        ...output.body.map(p => "<p>" + escapeHtml(p) + "</p>"),
        "</div>",
        generation.referenceCheck.blockingReason ? "<div class='meta'>Reference: " + escapeHtml(generation.referenceCheck.blockingReason) + "</div>" : ""
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
      document.getElementById("next").textContent = index >= data.assignments.length - 1 ? "Last case" : "Next case";
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
    "  npm run eval:editorial -w apps/worker -- run --cases tmp/editorial-eval/cases.json --control regular_v5_6_control --challenger audience_mechanism_v1 --out tmp/editorial-eval/run.json",
    "  npm run eval:editorial -w apps/worker -- review-html --run tmp/editorial-eval/run.json --out tmp/editorial-eval/review.html",
    "  npm run eval:editorial -w apps/worker -- summarize --run tmp/editorial-eval/run.json --reviews tmp/editorial-eval/reviews.json --out tmp/editorial-eval/summary.json"
  ].join("\n"));
}
