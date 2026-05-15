import {
  QUEUE_NAMES,
  REDIS_CHANNELS,
  isYearlyReportCategory,
  needsNewsworthinessTriage,
  newswebListResponseSchema,
  newswebMessageResponseSchema,
  normalizeRewriteJson,
  parseRedisUrl,
  rewriteOutputJsonSchema,
  rewriteOutputSchema,
  shouldSkipRewrite,
  type RewriteOutput
} from "@newsweb/shared";
import { loadConfig } from "./config.js";
import { logPrisma, prisma } from "@newsweb/shared/db";
import type { Prisma } from "@prisma/client";
import {
  PROMPT_VERSION,
  createDeveloperPrompt,
  createReportDeveloperPrompt,
  createReportRevisionUserPrompt,
  createReportSystemPrompt,
  createReportUserPrompt,
  createRevisionUserPrompt,
  createSystemPrompt,
  createUserPrompt,
  createYearlyReportDeveloperPrompt,
  createYearlyReportRevisionUserPrompt,
  createYearlyReportSystemPrompt,
  createYearlyReportUserPrompt,
  type PromptPayload,
  type ReportPromptPayload,
  type YearlyReportPromptPayload
} from "@newsweb/prompt-kit";
import { Job, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  buildAttributionCorrectionInstruction,
  findAttributionRisks
} from "./services/claim-precautions.js";
import { applyImportanceHighBar } from "./services/importance.js";
import {
  buildCorrectionInstruction,
  buildCoverageReport,
  collectDraftSentences,
  referenceCheckJsonSchema,
  referenceCheckResultSchema,
  type ReferenceCoverageReport
} from "./services/reference-check.js";
import { validateRewriteOutput } from "./services/rewrite-validation.js";
import {
  TRIAGE_PROMPT,
  buildTriageUserPrompt,
  parseTriageResponse
} from "./services/newsworthiness-triage.js";
import {
  downloadGeneralPdfAttachment,
  downloadReportPdfAttachment,
  downloadYearlyReportPdfAttachment,
  extractGeneralPdfContent,
  extractReportContent,
  extractYearlyReportSections,
  reportNeedsOpenAIPdfFallback,
  type PdfAttachmentDownload,
  type ReportExtractionResult
} from "./services/pdf-extract.js";
import {
  callOpenAIForJson,
  createOpenAIClient,
  type OpenAIFileInput,
  type OpenAIReasoningEffort
} from "./services/openai-responses.js";
import { sanitizeRewriteStyle } from "./services/style-sanitizer.js";

const NEWSWEB_LIST_URL = "https://api3.oslo.oslobors.no/v1/newsreader/list";
const NEWSWEB_MESSAGE_URL = "https://api3.oslo.oslobors.no/v1/newsreader/message";

type IngestJobData = {
  messageId: number;
  newsId: number;
  title: string;
  issuerName: string;
  issuerSign: string;
  publishedTime: string;
  categories: string[];
  markets: string[];
  numbAttachments: number;
};

type RewriteJobData = {
  messageId: number;
  reason: "new-message" | "manual-reprocess";
  instruction?: string;
  generationRunId?: string;
  targetVersion?: number;
  previousRewriteJson?: unknown;
};

type PublishJobData = {
  messageId: number;
  version?: number;
  generationRunId?: string;
};

const config = loadConfig();
const openAIClient = createOpenAIClient(config.OPENAI_API_KEY);

const connection = parseRedisUrl(config.REDIS_URL);
const redisPub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const ingestQueue = new Queue<IngestJobData>(QUEUE_NAMES.ingest, { connection });
const rewriteQueue = new Queue<RewriteJobData>(QUEUE_NAMES.rewrite, { connection });
const publishQueue = new Queue<PublishJobData>(QUEUE_NAMES.publish, { connection });
const skippedMissingIssuerSign = new Set<number>();

async function enqueuePublish(
  messageId: number,
  version: number,
  generationRunId?: string
): Promise<void> {
  await publishQueue.add(
    "publish-notice",
    { messageId, version, generationRunId },
    { removeOnComplete: 2000, removeOnFail: 2000 }
  );
}

/**
 * The Newsweb API returns category strings with double-encoded UTF-8
 * (UTF-8 bytes interpreted as Windows-1252, then re-encoded as UTF-8).
 * For example, Å (UTF-8: c3 85) becomes Ã… (c3→U+00C3, 85→U+2026 in CP1252).
 * This reverses the double-encoding so category comparisons work.
 */
const CP1252_TO_BYTE = new Map<number, number>([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
  [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93],
  [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
  [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F]
]);

function fixDoubleEncodedUtf8(text: string): string {
  try {
    const bytes = new Uint8Array([...text].map((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp <= 0xFF) return cp;
      return CP1252_TO_BYTE.get(cp) ?? 0;
    }));
    // If unmapped characters produced zero bytes, keep the original
    if (bytes.includes(0) && !text.includes("\0")) return text;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return text;
  }
}

function buildListUrl(daysBack = 0): string {
  if (daysBack <= 0) return NEWSWEB_LIST_URL;
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - daysBack);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return `${NEWSWEB_LIST_URL}?fromDate=${fmt(fromDate)}&toDate=${fmt(today)}`;
}

async function fetchList(daysBack = 0): Promise<IngestJobData[]> {
  const response = await fetch(buildListUrl(daysBack));
  if (!response.ok) {
    throw new Error(`Newsweb list failed: ${response.status}`);
  }
  const json = await response.json();
  const parsed = newswebListResponseSchema.parse(json);
  return parsed.data.messages.flatMap((message) => {
    if (!message.issuerSign) {
      if (!skippedMissingIssuerSign.has(message.messageId)) {
        skippedMissingIssuerSign.add(message.messageId);
        console.warn(
          `[newsweb] skipping ${message.messageId}: missing issuerSign in list response`
        );
      }
      return [];
    }
    return [
      {
        messageId: message.messageId,
        newsId: message.newsId,
        title: message.title,
        issuerName: message.issuerName,
        issuerSign: message.issuerSign,
        publishedTime: message.publishedTime,
        categories: message.category.map((item) => fixDoubleEncodedUtf8(item.category_no)),
        markets: message.markets,
        numbAttachments: message.numbAttachments
      }
    ];
  });
}

async function fetchRecentListAtLeast(count: number): Promise<IngestJobData[]> {
  const windows = [3, 7, 14, 30];
  let latest: IngestJobData[] = [];

  for (const daysBack of windows) {
    latest = await fetchList(daysBack);
    if (latest.length >= count) {
      return latest;
    }
  }

  return latest;
}

async function fetchMessageDetails(messageId: number): Promise<{
  bodyText: string;
  hasAttachments: boolean;
  rawMessageJson: unknown;
}> {
  const response = await fetch(`${NEWSWEB_MESSAGE_URL}?messageId=${messageId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Newsweb message ${messageId} failed: ${response.status}`);
  }
  const json = await response.json();
  const parsed = newswebMessageResponseSchema.parse(json);
  const bodyText = parsed.data.message.body ?? "";
  const hasAttachments = parsed.data.message.attachments.length > 0;

  // Store the raw (unparsed) message so fields like attachment "name" aren't stripped by Zod
  const rawMessage = (json as Record<string, unknown>).data as Record<string, unknown>;

  return {
    bodyText,
    hasAttachments,
    rawMessageJson: rawMessage?.message ?? parsed.data.message
  };
}

async function enqueueLatestNotices(count: number): Promise<{
  requested: number;
  feedItemsEnsured: number;
  queuedIngest: number;
  queuedRewrite: number;
}> {
  if (count <= 0) {
    return {
      requested: 0,
      feedItemsEnsured: 0,
      queuedIngest: 0,
      queuedRewrite: 0
    };
  }

  const list = await fetchRecentListAtLeast(count);
  const latest = [...list]
    .sort(
      (left, right) =>
        new Date(right.publishedTime).getTime() - new Date(left.publishedTime).getTime()
    )
    .slice(0, count);

  const ids = latest.map((item) => item.messageId);
  const existing = await prisma.sourceNotice.findMany({
    where: {
      messageId: {
        in: ids
      }
    },
    select: {
      messageId: true
    }
  });
  const existingSet = new Set(existing.map((item) => item.messageId));

  let feedItemsEnsured = 0;
  let queuedIngest = 0;
  let queuedRewrite = 0;

  for (const item of latest) {
    if (existingSet.has(item.messageId)) {
      await prisma.feedItem.upsert({
        where: { messageId: item.messageId },
        create: {
          messageId: item.messageId,
          publishedAt: new Date(item.publishedTime),
          visibilityStatus: "published",
          rankScore: 0
        },
        update: {
          publishedAt: new Date(item.publishedTime),
          visibilityStatus: "published"
        }
      });
      feedItemsEnsured += 1;

      // Already ingested — check if it has a rewrite; if so, skip
      const existingRewrite = await prisma.rewrite.findFirst({
        where: { messageId: item.messageId },
        select: { status: true }
      });
      if (existingRewrite) {
        continue;
      }
      await rewriteQueue.add(
        "rewrite-latest-bootstrap",
        {
          messageId: item.messageId,
          reason: "new-message"
        },
        {
          jobId: `rewrite-latest-${item.messageId}`,
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000
          },
          removeOnComplete: 2000,
          removeOnFail: 2000
        }
      );
      queuedRewrite += 1;
      continue;
    }

    await ingestQueue.add("ingest-notice", item, {
      jobId: `ingest-${item.messageId}`,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000
      },
      removeOnComplete: 2000,
      removeOnFail: 2000
    });
    queuedIngest += 1;
  }

  return {
    requested: latest.length,
    feedItemsEnsured,
    queuedIngest,
    queuedRewrite
  };
}

async function withJobRun(
  jobType: string,
  messageId: number | null,
  task: () => Promise<void>
): Promise<void> {
  const run = await prisma.jobRun.create({
    data: {
      jobType,
      messageId: messageId ?? undefined,
      status: "started"
    }
  });

  try {
    await task();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date()
      }
    });
  } catch (error) {
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorText: error instanceof Error ? error.message : String(error)
      }
    });
    throw error;
  }
}

function extractPromptChars(validationJson: Prisma.InputJsonValue): number | null {
  if (
    typeof validationJson === "object" &&
    validationJson !== null &&
    !Array.isArray(validationJson)
  ) {
    const promptChars = (validationJson as Record<string, unknown>).promptChars;
    return typeof promptChars === "number" ? promptChars : null;
  }
  return null;
}

function extractRewriteErrorText(rewriteJson: Prisma.InputJsonValue): string | null {
  if (
    typeof rewriteJson === "object" &&
    rewriteJson !== null &&
    !Array.isArray(rewriteJson)
  ) {
    const message = (rewriteJson as Record<string, unknown>).message;
    return typeof message === "string" ? message : null;
  }
  return null;
}

function generationInputJson(
  payload: PromptPayload,
  previousOutput?: RewriteOutput,
  modelCalls: ModelCallLog[] = []
): Prisma.InputJsonValue {
  return {
    sourcePayload: payload,
    previousRewrite: previousOutput ?? null,
    modelCalls
  } as unknown as Prisma.InputJsonValue;
}

async function startGenerationRun(
  job: Job<RewriteJobData>,
  messageId: number,
  version: number,
  payload: PromptPayload,
  previousOutput?: RewriteOutput
): Promise<string> {
  const data = {
    version,
    jobId: job.id != null ? String(job.id) : null,
    jobName: job.name,
    reason: job.data.reason,
    status: "started",
    userInstruction: job.data.instruction ?? null,
    inputJson: generationInputJson(payload, previousOutput),
    ...(previousOutput
      ? {
          previousRewriteJson:
            previousOutput as unknown as Prisma.InputJsonValue
        }
      : {}),
    model: config.OPENAI_MODEL,
    promptVersion: PROMPT_VERSION,
    startedAt: new Date()
  };

  if (job.data.generationRunId) {
    await logPrisma.generationRun.update({
      where: { id: job.data.generationRunId },
      data
    });
    return job.data.generationRunId;
  }

  const generationRun = await logPrisma.generationRun.create({
    data: {
      messageId,
      requestedAt: new Date(),
      ...data
    }
  });
  return generationRun.id;
}

type JsonModelCallInput = {
  schemaName: string;
  schema: Record<string, unknown>;
  systemPrompt: string;
  developerPrompt: string;
  userPrompt: string;
  model?: string;
  reasoningEffort?: OpenAIReasoningEffort;
  timeoutMs?: number;
  maxOutputTokens?: number;
  file?: OpenAIFileInput;
};

type ModelCallLog = {
  provider: "openai";
  schemaName: string;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  systemPrompt: string;
  developerPrompt: string;
  userPrompt: string;
  promptChars: number;
};

const triageJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    newsworthy: { type: "boolean" },
    reason: { type: "string" }
  },
  required: ["newsworthy", "reason"]
} as const;

function clampRewriteArrays(raw: Record<string, unknown>): Record<string, unknown> {
  const limits: Record<string, number> = { body: 8, key_facts: 8, source_spans: 8, negative_or_surprising: 6, excluded_hype: 6, source_limitations: 6 };
  for (const [key, max] of Object.entries(limits)) {
    if (Array.isArray(raw[key]) && (raw[key] as unknown[]).length > max) {
      raw[key] = (raw[key] as unknown[]).slice(0, max);
    }
  }
  return raw;
}

async function callModelForJson({
  schemaName,
  schema,
  systemPrompt,
  developerPrompt,
  userPrompt,
  model = config.OPENAI_MODEL,
  reasoningEffort = config.OPENAI_DEFAULT_REASONING_EFFORT,
  timeoutMs = config.OPENAI_TIMEOUT_MS,
  maxOutputTokens = 4096,
  file
}: JsonModelCallInput): Promise<{
  content: string;
  promptChars: number;
  modelCall: ModelCallLog;
}> {
  const promptChars = systemPrompt.length + developerPrompt.length + userPrompt.length;
  const modelCall: ModelCallLog = {
    provider: "openai",
    schemaName,
    model,
    reasoningEffort,
    systemPrompt,
    developerPrompt,
    userPrompt,
    promptChars
  };

  return {
    content: await callOpenAIForJson(openAIClient, {
      schemaName,
      schema,
      systemPrompt,
      developerPrompt,
      userPrompt,
      model,
      reasoningEffort,
      timeoutMs,
      maxOutputTokens,
      file
    }),
    promptChars,
    modelCall
  };
}

async function callModelTriage(
  title: string,
  bodyText: string,
  categories: string[]
): Promise<{
  newsworthy: boolean;
  reason: string;
  promptChars: number;
  modelCall: ModelCallLog | null;
}> {
  const userPrompt = buildTriageUserPrompt(title, bodyText, categories);

  try {
    const result = await callModelForJson({
      schemaName: "newsworthiness_triage",
      schema: triageJsonSchema as Record<string, unknown>,
      systemPrompt: TRIAGE_PROMPT,
      developerPrompt: "Svar kun med strukturert triage etter skjemaet.",
      userPrompt,
      model: config.OPENAI_FAST_MODEL,
      reasoningEffort: "none",
      timeoutMs: config.OPENAI_FAST_TIMEOUT_MS,
      maxOutputTokens: 200
    });

    return {
      ...parseTriageResponse(result.content),
      promptChars: result.promptChars,
      modelCall: result.modelCall
    };
  } catch {
    // Fail-open: if triage errors, proceed with full rewrite
    return {
      newsworthy: true,
      reason: "Triage call error - defaulting to newsworthy",
      promptChars: 0,
      modelCall: null
    };
  }
}

async function callModelRewrite(
  payload: PromptPayload,
  revisionInstruction?: string,
  previousOutput?: RewriteOutput,
  reasoningEffort: OpenAIReasoningEffort = config.OPENAI_DEFAULT_REASONING_EFFORT
): Promise<{
  rewrite: RewriteOutput;
  promptChars: number;
  modelCall: ModelCallLog;
}> {
  const systemPrompt = createSystemPrompt();
  const developerPrompt = createDeveloperPrompt();
  let userPrompt: string;
  if (revisionInstruction && previousOutput) {
    userPrompt = createRevisionUserPrompt(
      payload,
      previousOutput,
      revisionInstruction
    );
  } else if (revisionInstruction) {
    userPrompt = `${createUserPrompt(payload)}\n\nKORRIGERINGSMODUS:\n${revisionInstruction}`;
  } else {
    userPrompt = createUserPrompt(payload);
  }
  const result = await callModelForJson({
    schemaName: "rewrite_output",
    schema: rewriteOutputJsonSchema as Record<string, unknown>,
    systemPrompt,
    developerPrompt,
    userPrompt,
    reasoningEffort
  });

  return {
    rewrite: rewriteOutputSchema.parse(clampRewriteArrays(JSON.parse(result.content))),
    promptChars: result.promptChars,
    modelCall: result.modelCall
  };
}

async function callModelReferenceCheck(
  payload: PromptPayload,
  draftRewrite: RewriteOutput
): Promise<{
  coverage: ReferenceCoverageReport;
  promptChars: number;
  modelCall: ModelCallLog | null;
}> {
  const draftSentences = collectDraftSentences(draftRewrite);
  if (draftSentences.length === 0) {
    return {
      coverage: {
        totalSentences: 0,
        groundedSentences: 0,
        coveragePercent: 100,
        items: [],
        unsupportedSentences: []
      },
      promptChars: 0,
      modelCall: null
    };
  }

  const systemPrompt =
    "Du er en streng referansesjekker som kun vurderer dekning mot oppgitt referansetekst.";
  const developerPrompt = [
    "Vurder hver setning i utkastet separat.",
    "Sett grounded=true kun hvis setningen har eksplisitt dekning i referanseteksten.",
    "Ikke bruk bakgrunnskunnskap utenfor referanseteksten.",
    "Hvis en setning inneholder subjektive vurderinger eller verdisprak (f.eks. 'milepael', 'styrker posisjon', 'betydelig') uten tydelig attribusjon til kilden/selskapet, skal grounded settes til false.",
    "Paatander om effekt, betydning eller kommersiell verdi ma enten ha direkte dekning i kilden og attribusjon, eller markeres som ikke dekket.",
    "interpretation skal kort forklare hvorfor setningen er dekket eller ikke.",
    "sourceEvidence skal inneholde et kort tekstutdrag fra referansen; tom streng hvis ingenting dekker setningen."
  ].join("\n");

  const userPrompt = [
    "REFERANSETEKST:",
    "<<<",
    payload.bodyText || "ikke oppgitt",
    ">>>",
    "",
    "SETNINGER SOM SKAL SJEKKES (indeks + tekst):",
    JSON.stringify(
      draftSentences.map((sentence, index) => ({
        index,
        sentence
      }))
    )
  ].join("\n");

  const result = await callModelForJson({
    schemaName: "reference_check_result",
    schema: referenceCheckJsonSchema as Record<string, unknown>,
    systemPrompt,
    developerPrompt,
    userPrompt
  });

  const parsed = referenceCheckResultSchema.parse(JSON.parse(result.content));
  return {
    coverage: buildCoverageReport(draftSentences, parsed),
    promptChars: result.promptChars,
    modelCall: result.modelCall
  };
}

async function callModelReportRewrite(
  payload: ReportPromptPayload,
  revisionInstruction?: string,
  previousOutput?: RewriteOutput,
  reasoningEffort: OpenAIReasoningEffort = config.OPENAI_REPORT_REASONING_EFFORT
): Promise<{
  rewrite: RewriteOutput;
  promptChars: number;
  modelCall: ModelCallLog;
}> {
  const systemPrompt = createReportSystemPrompt();
  const developerPrompt = createReportDeveloperPrompt();
  let userPrompt: string;
  if (revisionInstruction && previousOutput) {
    userPrompt = createReportRevisionUserPrompt(
      payload,
      previousOutput,
      revisionInstruction
    );
  } else if (revisionInstruction) {
    userPrompt = `${createReportUserPrompt(payload)}\n\nKORRIGERINGSMODUS:\n${revisionInstruction}`;
  } else {
    userPrompt = createReportUserPrompt(payload);
  }
  const result = await callModelForJson({
    schemaName: "rewrite_output",
    schema: rewriteOutputJsonSchema as Record<string, unknown>,
    systemPrompt,
    developerPrompt,
    userPrompt,
    reasoningEffort
  });

  return {
    rewrite: rewriteOutputSchema.parse(clampRewriteArrays(JSON.parse(result.content))),
    promptChars: result.promptChars,
    modelCall: result.modelCall
  };
}

async function callModelYearlyReportRewrite(
  payload: YearlyReportPromptPayload,
  revisionInstruction?: string,
  previousOutput?: RewriteOutput,
  reasoningEffort: OpenAIReasoningEffort = config.OPENAI_REPORT_REASONING_EFFORT
): Promise<{
  rewrite: RewriteOutput;
  promptChars: number;
  modelCall: ModelCallLog;
}> {
  const systemPrompt = createYearlyReportSystemPrompt();
  const developerPrompt = createYearlyReportDeveloperPrompt();
  let userPrompt: string;
  if (revisionInstruction && previousOutput) {
    userPrompt = createYearlyReportRevisionUserPrompt(
      payload,
      previousOutput,
      revisionInstruction
    );
  } else if (revisionInstruction) {
    userPrompt = `${createYearlyReportUserPrompt(payload)}\n\nKORRIGERINGSMODUS:\n${revisionInstruction}`;
  } else {
    userPrompt = createYearlyReportUserPrompt(payload);
  }
  const result = await callModelForJson({
    schemaName: "rewrite_output",
    schema: rewriteOutputJsonSchema as Record<string, unknown>,
    systemPrompt,
    developerPrompt,
    userPrompt,
    reasoningEffort
  });

  return {
    rewrite: rewriteOutputSchema.parse(clampRewriteArrays(JSON.parse(result.content))),
    promptChars: result.promptChars,
    modelCall: result.modelCall
  };
}

const pdfContextJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    context: { type: "string" },
    sourceEvidence: {
      type: "array",
      items: { type: "string" },
      maxItems: 8
    },
    limitations: {
      type: "array",
      items: { type: "string" },
      maxItems: 5
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] }
  },
  required: ["context", "sourceEvidence", "limitations", "confidence"]
} as const;

const yearlyRemunerationPdfContextJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    found: { type: "boolean" },
    context: { type: "string" },
    sourceEvidence: {
      type: "array",
      items: { type: "string" },
      maxItems: 8
    },
    limitations: {
      type: "array",
      items: { type: "string" },
      maxItems: 5
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] }
  },
  required: ["found", "context", "sourceEvidence", "limitations", "confidence"]
} as const;

type PdfContextResult = {
  context: string;
  sourceEvidence: string[];
  limitations: string[];
  confidence: "high" | "medium" | "low";
  found?: boolean;
  promptChars: number;
  modelCall: ModelCallLog;
};

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readConfidence(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "low";
}

function formatPdfContext(result: PdfContextResult, heading: string): string {
  return [
    heading,
    result.context.trim(),
    "",
    "SOURCE EVIDENCE:",
    ...(result.sourceEvidence.length > 0
      ? result.sourceEvidence.map((item) => `- ${item}`)
      : ["- No concise evidence extracted."]),
    "",
    "LIMITATIONS:",
    ...(result.limitations.length > 0
      ? result.limitations.map((item) => `- ${item}`)
      : ["- None stated."]),
    "",
    `CONFIDENCE: ${result.confidence}`
  ].join("\n");
}

async function callOpenAIPdfContext({
  pdf,
  schemaName,
  schema,
  userPrompt,
  foundField = false
}: {
  pdf: PdfAttachmentDownload;
  schemaName: string;
  schema: Record<string, unknown>;
  userPrompt: string;
  foundField?: boolean;
}): Promise<PdfContextResult> {
  const systemPrompt =
    "You read attached PDFs for a newsroom pipeline. Extract concise factual context only.";
  const developerPrompt = [
    "Use only the attached PDF and the user request.",
    "Do not write a news article.",
    "Include compact source evidence with page or section references when visible.",
    "If the requested material is missing, state that in limitations."
  ].join("\n");

  const result = await callModelForJson({
    schemaName,
    schema,
    systemPrompt,
    developerPrompt,
    userPrompt,
    model: config.OPENAI_MODEL,
    reasoningEffort: config.OPENAI_HARD_REASONING_EFFORT,
    timeoutMs: config.OPENAI_TIMEOUT_MS,
    maxOutputTokens: 2500,
    file: {
      filename: pdf.attachmentName ?? `attachment-${pdf.attachmentId}.pdf`,
      mimeType: "application/pdf",
      data: pdf.buffer
    }
  });
  const parsed = JSON.parse(result.content) as Record<string, unknown>;
  return {
    context: typeof parsed.context === "string" ? parsed.context : "",
    sourceEvidence: readStringArray(parsed.sourceEvidence),
    limitations: readStringArray(parsed.limitations),
    confidence: readConfidence(parsed.confidence),
    ...(foundField ? { found: parsed.found === true } : {}),
    promptChars: result.promptChars,
    modelCall: result.modelCall
  };
}

async function extractReportContextWithOpenAIPdf(
  pdf: PdfAttachmentDownload,
  source: { title: string; issuerName: string; issuerSign: string },
  userInstruction?: string
): Promise<PdfContextResult> {
  return callOpenAIPdfContext({
    pdf,
    schemaName: "pdf_report_context",
    schema: pdfContextJsonSchema as Record<string, unknown>,
    userPrompt: [
      `Company: ${source.issuerName} (${source.issuerSign})`,
      `Notice title: ${source.title}`,
      userInstruction ? `User instruction: ${userInstruction}` : "",
      "",
      "Extract concise report context for a Norwegian business-news rewrite.",
      "Prioritize revenue, operating result/EBIT, result before tax, reporting period, outlook/key events, and any user-requested page or topic."
    ]
      .filter(Boolean)
      .join("\n")
  });
}

async function extractYearlyRemunerationWithOpenAIPdf(
  pdf: PdfAttachmentDownload,
  source: { title: string; issuerName: string; issuerSign: string }
): Promise<PdfContextResult> {
  return callOpenAIPdfContext({
    pdf,
    schemaName: "pdf_yearly_remuneration_context",
    schema: yearlyRemunerationPdfContextJsonSchema as Record<string, unknown>,
    foundField: true,
    userPrompt: [
      `Company: ${source.issuerName} (${source.issuerSign})`,
      `Notice title: ${source.title}`,
      "",
      "Find the annual-report section about remuneration, salary, compensation, or pay for senior executives, CEO, board, or management.",
      "Extract only concrete names, roles, amounts, table labels, periods, and source evidence. Set found=false if no remuneration section with concrete amounts is present."
    ].join("\n")
  });
}

async function extractGeneralContextWithOpenAIPdf(
  pdf: PdfAttachmentDownload,
  payload: PromptPayload,
  userInstruction?: string
): Promise<PdfContextResult> {
  return callOpenAIPdfContext({
    pdf,
    schemaName: "pdf_general_context",
    schema: pdfContextJsonSchema as Record<string, unknown>,
    userPrompt: [
      `Company: ${payload.issuerName} (${payload.issuerSign})`,
      `Notice title: ${payload.title}`,
      userInstruction ? `User instruction: ${userInstruction}` : "",
      "",
      "Extract concise supplementary context from this PDF that is directly relevant to the notice.",
      "Prefer concrete facts, numbers, dates, contract terms, transaction terms, and source evidence. Ignore boilerplate."
    ]
      .filter(Boolean)
      .join("\n")
  });
}

function reportExtractionFromOpenAIPdf(
  pdf: PdfAttachmentDownload,
  result: PdfContextResult,
  existing?: ReportExtractionResult
): ReportExtractionResult {
  const text = formatPdfContext(result, "OPENAI PDF FALLBACK REPORT CONTEXT");
  return {
    text,
    referenceText: text,
    pageCount: pdf.pageCount,
    metrics: existing?.metrics ?? [],
    selectedPages: existing?.selectedPages ?? [],
    diagnostics: {
      incomeStatementFound: existing?.diagnostics.incomeStatementFound ?? false,
      fallbackUsed: true,
      openAIPdfFallback: true,
      requestedPageNumbers: existing?.diagnostics.requestedPageNumbers ?? [],
      requestedTopicTerms: existing?.diagnostics.requestedTopicTerms ?? [],
      totalExtractedChars:
        existing?.diagnostics.totalExtractedChars ?? text.length
    },
    attachmentId: pdf.attachmentId,
    attachmentName: pdf.attachmentName
  };
}

type RewriteRevisionOptions = {
  version?: number;
  userInstruction?: string;
  previousOutput?: RewriteOutput;
  generationRunId?: string;
  modelCalls?: ModelCallLog[];
  promptChars?: number;
};

type YearlyReportExtractionResult = {
  letterText: string | null;
  remunerationText: string | null;
  pageCount: number;
  attachmentId: number;
  openAIPdfFallback?: boolean;
};

async function processReportRewrite(
  messageId: number,
  source: {
    title: string;
    issuerName: string;
    issuerSign: string;
    publishedAt: Date;
    categoriesJson: unknown;
    marketsJson: unknown;
    bodyText: string;
    hasAttachments: boolean;
    rawMessageJson: unknown;
  },
  payload: PromptPayload,
  job: { opts: { attempts?: number }; attemptsMade: number },
  reportContent: ReportExtractionResult,
  revisionOptions: RewriteRevisionOptions = {}
): Promise<void> {
  const reportPayload: ReportPromptPayload = {
    ...payload,
    reportText: reportContent.text,
    reportPageCount: reportContent.pageCount,
    reportMetrics: reportContent.metrics,
    reportSelectedPages: reportContent.selectedPages
  };

  const maxAttempts = job.opts.attempts ?? 1;
  const finalAttempt = job.attemptsMade + 1 >= maxAttempts;
  let promptChars = revisionOptions.promptChars ?? 0;
  let checkerError: string | null = null;
  let correctionApplied = false;
  let initialCoverage: ReferenceCoverageReport | null = null;
  let finalCoverage: ReferenceCoverageReport | null = null;
  let hiddenDraft: RewriteOutput | null = null;
  let importanceAdjusted = false;
  let importanceAdjustReason: string | null = null;
  let attributionCorrectionApplied = false;
  let attributionRiskCount = 0;
  let styleSanitization: ReturnType<typeof sanitizeRewriteStyle>["stats"] | null = null;
  const modelCalls: ModelCallLog[] = [...(revisionOptions.modelCalls ?? [])];
  const reportReasoningEffort = reportContent.diagnostics.openAIPdfFallback
    ? config.OPENAI_HARD_REASONING_EFFORT
    : config.OPENAI_REPORT_REASONING_EFFORT;
  const reportReferenceText = [
    payload.bodyText && payload.bodyText.trim().length >= 100
      ? payload.bodyText
      : "",
    reportContent.referenceText || reportContent.text
  ]
    .filter(Boolean)
    .join("\n\n");
  const reportReferencePayload: PromptPayload = {
    ...payload,
    bodyText: reportReferenceText,
    sourceBodyChars: reportReferenceText.length
  };

  try {
    const initialDraftResult = await callModelReportRewrite(
      reportPayload,
      revisionOptions.userInstruction,
      revisionOptions.previousOutput,
      reportReasoningEffort
    );
    modelCalls.push(initialDraftResult.modelCall);
    promptChars += initialDraftResult.promptChars;
    hiddenDraft = initialDraftResult.rewrite;
    let rewrite = hiddenDraft;

    try {
      const initialReferenceCheck = await callModelReferenceCheck(
        reportReferencePayload,
        rewrite
      );
      if (initialReferenceCheck.modelCall) {
        modelCalls.push(initialReferenceCheck.modelCall);
      }
      promptChars += initialReferenceCheck.promptChars;
      initialCoverage = initialReferenceCheck.coverage;
      finalCoverage = initialReferenceCheck.coverage;

      const correctionInstruction = buildCorrectionInstruction(
        initialReferenceCheck.coverage
      );
      if (correctionInstruction) {
        const combinedCorrection = [
          revisionOptions.userInstruction,
          correctionInstruction
        ]
          .filter(Boolean)
          .join("\n\n");
        const correctedResult = await callModelReportRewrite(
          reportPayload,
          combinedCorrection,
          rewrite,
          reportReasoningEffort
        );
        modelCalls.push(correctedResult.modelCall);
        promptChars += correctedResult.promptChars;
        rewrite = correctedResult.rewrite;
        correctionApplied = true;

        const finalReferenceCheck = await callModelReferenceCheck(
          reportReferencePayload,
          rewrite
        );
        if (finalReferenceCheck.modelCall) {
          modelCalls.push(finalReferenceCheck.modelCall);
        }
        promptChars += finalReferenceCheck.promptChars;
        finalCoverage = finalReferenceCheck.coverage;
      }
    } catch (error) {
      checkerError = error instanceof Error ? error.message : String(error);
    }

    const attributionRisks = findAttributionRisks(rewrite);
    attributionRiskCount = attributionRisks.length;
    const attributionInstruction =
      buildAttributionCorrectionInstruction(attributionRisks);
    if (attributionInstruction) {
      const combinedAttribution = [
        revisionOptions.userInstruction,
        attributionInstruction
      ]
        .filter(Boolean)
        .join("\n\n");
      const correctedForAttribution = await callModelReportRewrite(
        reportPayload,
        combinedAttribution,
        rewrite,
        reportReasoningEffort
      );
      modelCalls.push(correctedForAttribution.modelCall);
      promptChars += correctedForAttribution.promptChars;
      rewrite = correctedForAttribution.rewrite;
      attributionCorrectionApplied = true;
      attributionRiskCount = findAttributionRisks(rewrite).length;
    }

    const importanceResult = applyImportanceHighBar(rewrite, payload);
    rewrite = importanceResult.rewrite;
    importanceAdjusted = importanceResult.adjusted;
    importanceAdjustReason = importanceResult.reason;

    const styleResult = sanitizeRewriteStyle(rewrite);
    rewrite = styleResult.rewrite;
    styleSanitization = styleResult.stats;

    const validation = validateRewriteOutput(rewrite, reportReferencePayload);

    await upsertRewrite({
      messageId,
      version: revisionOptions.version,
      userInstruction: revisionOptions.userInstruction,
      generationRunId: revisionOptions.generationRunId,
      inputJson: generationInputJson(
        reportPayload,
        revisionOptions.previousOutput,
        modelCalls
      ),
      rewriteJson: rewrite,
      status: "pending",
      validationJson: {
        valid: validation.valid,
        errorCode: validation.valid ? null : "NON_BLOCKING_VALIDATION_WARNINGS",
        errors: validation.errors,
        sourceBodyChars: payload.sourceBodyChars,
        promptChars,
        reportExtraction: {
          attachmentId: reportContent.attachmentId,
          attachmentName: reportContent.attachmentName,
          pageCount: reportContent.pageCount,
          extractedChars: reportContent.diagnostics.totalExtractedChars,
          contextChars: reportContent.text.length,
          validationSourceChars: reportReferenceText.length,
          selectedPages: reportContent.selectedPages,
          metricCandidates: reportContent.metrics,
          diagnostics: reportContent.diagnostics
        },
        styleSanitization,
        referenceCheck: {
          enabled: true,
          checkerError,
          correctionApplied,
          attributionCorrectionApplied,
          attributionRiskCount,
          initialCoveragePercent: initialCoverage?.coveragePercent ?? null,
          finalCoveragePercent:
            finalCoverage?.coveragePercent ??
            initialCoverage?.coveragePercent ??
            null,
          importanceAdjusted,
          importanceAdjustReason,
          totalSentences:
            finalCoverage?.totalSentences ?? initialCoverage?.totalSentences ?? 0,
          unsupportedSentenceCount:
            finalCoverage?.unsupportedSentences.length ??
            initialCoverage?.unsupportedSentences.length ??
            0,
          sentenceReviews: (
            finalCoverage?.items ?? initialCoverage?.items ?? []
          ).map((item) => ({
            index: item.index,
            sentence: item.sentence,
            grounded: item.grounded,
            interpretation: item.interpretation,
            sourceEvidence: item.sourceEvidence
          })),
          unsupportedSentences: (
            finalCoverage?.unsupportedSentences ??
            initialCoverage?.unsupportedSentences ??
            []
          ).map((item) => ({
            index: item.index,
            sentence: item.sentence,
            interpretation: item.interpretation,
            sourceEvidence: item.sourceEvidence
          }))
        },
        hiddenDraft: hiddenDraft
          ? {
              title: hiddenDraft.title,
              lead: hiddenDraft.lead,
              body: hiddenDraft.body,
              company_sentence: hiddenDraft.company_sentence
            }
          : null
      } as Prisma.InputJsonValue
    });

    await enqueuePublish(
      messageId,
      revisionOptions.version ?? 1,
      revisionOptions.generationRunId
    );
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);

    if (!finalAttempt) {
      await upsertRewrite({
        messageId,
        version: revisionOptions.version,
        userInstruction: revisionOptions.userInstruction,
        generationRunId: revisionOptions.generationRunId,
        inputJson: generationInputJson(
          reportPayload,
          revisionOptions.previousOutput,
          modelCalls
        ),
        rewriteJson: {
          errorCode: "REPORT_REWRITE_ATTEMPT_FAILED",
          message: errorText
        } as Prisma.InputJsonValue,
        status: "needs_retry",
        validationJson: {
          valid: false,
          errorCode: "REPORT_REWRITE_ATTEMPT_FAILED",
          errors: [errorText],
          sourceBodyChars: payload.sourceBodyChars,
          promptChars
        } as Prisma.InputJsonValue
      });
      throw new Error(`report rewrite pipeline failed for ${messageId}`);
    }

    await upsertRewrite({
      messageId,
      version: revisionOptions.version,
      userInstruction: revisionOptions.userInstruction,
      generationRunId: revisionOptions.generationRunId,
      inputJson: generationInputJson(
        reportPayload,
        revisionOptions.previousOutput,
        modelCalls
      ),
      rewriteJson: {
        errorCode: "REPORT_REWRITE_FAILED_FINAL",
        message: errorText
      } as Prisma.InputJsonValue,
      status: "failed",
      validationJson: {
        valid: false,
        errorCode: "REPORT_REWRITE_FAILED_FINAL",
        errors: [errorText],
        sourceBodyChars: payload.sourceBodyChars,
        promptChars
      } as Prisma.InputJsonValue
    });
  }
}

async function processYearlyReportRewrite(
  messageId: number,
  source: {
    title: string;
    issuerName: string;
    issuerSign: string;
    publishedAt: Date;
    categoriesJson: unknown;
    marketsJson: unknown;
    bodyText: string;
    hasAttachments: boolean;
    rawMessageJson: unknown;
  },
  payload: PromptPayload,
  job: { opts: { attempts?: number }; attemptsMade: number },
  yearlyContent: YearlyReportExtractionResult,
  revisionOptions: RewriteRevisionOptions = {}
): Promise<void> {
  const yearlyPayload: YearlyReportPromptPayload = {
    ...payload,
    letterText: yearlyContent.letterText,
    remunerationText: yearlyContent.remunerationText,
    reportPageCount: yearlyContent.pageCount
  };

  // Build combined text for reference checking
  const combinedText = [
    yearlyContent.letterText,
    yearlyContent.remunerationText
  ]
    .filter(Boolean)
    .join("\n\n");

  const maxAttempts = job.opts.attempts ?? 1;
  const finalAttempt = job.attemptsMade + 1 >= maxAttempts;
  let promptChars = revisionOptions.promptChars ?? 0;
  let checkerError: string | null = null;
  let correctionApplied = false;
  let initialCoverage: ReferenceCoverageReport | null = null;
  let finalCoverage: ReferenceCoverageReport | null = null;
  let hiddenDraft: RewriteOutput | null = null;
  let importanceAdjusted = false;
  let importanceAdjustReason: string | null = null;
  let attributionCorrectionApplied = false;
  let attributionRiskCount = 0;
  let styleSanitization: ReturnType<typeof sanitizeRewriteStyle>["stats"] | null = null;
  const modelCalls: ModelCallLog[] = [...(revisionOptions.modelCalls ?? [])];
  const reportReasoningEffort = yearlyContent.openAIPdfFallback
    ? config.OPENAI_HARD_REASONING_EFFORT
    : config.OPENAI_REPORT_REASONING_EFFORT;

  try {
    const initialDraftResult = await callModelYearlyReportRewrite(
      yearlyPayload,
      revisionOptions.userInstruction,
      revisionOptions.previousOutput,
      reportReasoningEffort
    );
    modelCalls.push(initialDraftResult.modelCall);
    promptChars += initialDraftResult.promptChars;
    hiddenDraft = initialDraftResult.rewrite;
    let rewrite = hiddenDraft;

    // Reference check against combined yearly report text
    const refPayload: PromptPayload = {
      ...payload,
      bodyText: combinedText,
      sourceBodyChars: combinedText.length
    };

    try {
      const initialReferenceCheck = await callModelReferenceCheck(
        refPayload,
        rewrite
      );
      if (initialReferenceCheck.modelCall) {
        modelCalls.push(initialReferenceCheck.modelCall);
      }
      promptChars += initialReferenceCheck.promptChars;
      initialCoverage = initialReferenceCheck.coverage;
      finalCoverage = initialReferenceCheck.coverage;

      const correctionInstruction = buildCorrectionInstruction(
        initialReferenceCheck.coverage
      );
      if (correctionInstruction) {
        const combinedCorrection = [
          revisionOptions.userInstruction,
          correctionInstruction
        ]
          .filter(Boolean)
          .join("\n\n");
        const correctedResult = await callModelYearlyReportRewrite(
          yearlyPayload,
          combinedCorrection,
          rewrite,
          reportReasoningEffort
        );
        modelCalls.push(correctedResult.modelCall);
        promptChars += correctedResult.promptChars;
        rewrite = correctedResult.rewrite;
        correctionApplied = true;

        const finalReferenceCheck = await callModelReferenceCheck(
          refPayload,
          rewrite
        );
        if (finalReferenceCheck.modelCall) {
          modelCalls.push(finalReferenceCheck.modelCall);
        }
        promptChars += finalReferenceCheck.promptChars;
        finalCoverage = finalReferenceCheck.coverage;
      }
    } catch (error) {
      checkerError = error instanceof Error ? error.message : String(error);
    }

    const attributionRisks = findAttributionRisks(rewrite);
    attributionRiskCount = attributionRisks.length;
    const attributionInstruction =
      buildAttributionCorrectionInstruction(attributionRisks);
    if (attributionInstruction) {
      const combinedAttribution = [
        revisionOptions.userInstruction,
        attributionInstruction
      ]
        .filter(Boolean)
        .join("\n\n");
      const correctedForAttribution = await callModelYearlyReportRewrite(
        yearlyPayload,
        combinedAttribution,
        rewrite,
        reportReasoningEffort
      );
      modelCalls.push(correctedForAttribution.modelCall);
      promptChars += correctedForAttribution.promptChars;
      rewrite = correctedForAttribution.rewrite;
      attributionCorrectionApplied = true;
      attributionRiskCount = findAttributionRisks(rewrite).length;
    }

    const importanceResult = applyImportanceHighBar(rewrite, payload);
    rewrite = importanceResult.rewrite;
    importanceAdjusted = importanceResult.adjusted;
    importanceAdjustReason = importanceResult.reason;

    const styleResult = sanitizeRewriteStyle(rewrite);
    rewrite = styleResult.rewrite;
    styleSanitization = styleResult.stats;

    const validation = validateRewriteOutput(rewrite, payload);

    await upsertRewrite({
      messageId,
      version: revisionOptions.version,
      userInstruction: revisionOptions.userInstruction,
      generationRunId: revisionOptions.generationRunId,
      inputJson: generationInputJson(
        yearlyPayload,
        revisionOptions.previousOutput,
        modelCalls
      ),
      rewriteJson: rewrite,
      status: "pending",
      validationJson: {
        valid: validation.valid,
        errorCode: validation.valid ? null : "NON_BLOCKING_VALIDATION_WARNINGS",
        errors: validation.errors,
        sourceBodyChars: payload.sourceBodyChars,
        promptChars,
        yearlyReportExtraction: {
          attachmentId: yearlyContent.attachmentId,
          pageCount: yearlyContent.pageCount,
          openAIPdfFallback: yearlyContent.openAIPdfFallback ?? false,
          hasLetterText: !!yearlyContent.letterText,
          hasRemunerationText: !!yearlyContent.remunerationText,
          extractedChars: combinedText.length
        },
        styleSanitization,
        referenceCheck: {
          enabled: true,
          checkerError,
          correctionApplied,
          attributionCorrectionApplied,
          attributionRiskCount,
          initialCoveragePercent: initialCoverage?.coveragePercent ?? null,
          finalCoveragePercent:
            finalCoverage?.coveragePercent ??
            initialCoverage?.coveragePercent ??
            null,
          importanceAdjusted,
          importanceAdjustReason,
          totalSentences:
            finalCoverage?.totalSentences ?? initialCoverage?.totalSentences ?? 0,
          unsupportedSentenceCount:
            finalCoverage?.unsupportedSentences.length ??
            initialCoverage?.unsupportedSentences.length ??
            0,
          sentenceReviews: (
            finalCoverage?.items ?? initialCoverage?.items ?? []
          ).map((item) => ({
            index: item.index,
            sentence: item.sentence,
            grounded: item.grounded,
            interpretation: item.interpretation,
            sourceEvidence: item.sourceEvidence
          })),
          unsupportedSentences: (
            finalCoverage?.unsupportedSentences ??
            initialCoverage?.unsupportedSentences ??
            []
          ).map((item) => ({
            index: item.index,
            sentence: item.sentence,
            interpretation: item.interpretation,
            sourceEvidence: item.sourceEvidence
          }))
        },
        hiddenDraft: hiddenDraft
          ? {
              title: hiddenDraft.title,
              lead: hiddenDraft.lead,
              body: hiddenDraft.body,
              company_sentence: hiddenDraft.company_sentence
            }
          : null
      } as Prisma.InputJsonValue
    });

    await enqueuePublish(
      messageId,
      revisionOptions.version ?? 1,
      revisionOptions.generationRunId
    );
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);

    if (!finalAttempt) {
      await upsertRewrite({
        messageId,
        version: revisionOptions.version,
        userInstruction: revisionOptions.userInstruction,
        generationRunId: revisionOptions.generationRunId,
        inputJson: generationInputJson(
          yearlyPayload,
          revisionOptions.previousOutput,
          modelCalls
        ),
        rewriteJson: {
          errorCode: "YEARLY_REPORT_REWRITE_ATTEMPT_FAILED",
          message: errorText
        } as Prisma.InputJsonValue,
        status: "needs_retry",
        validationJson: {
          valid: false,
          errorCode: "YEARLY_REPORT_REWRITE_ATTEMPT_FAILED",
          errors: [errorText],
          sourceBodyChars: payload.sourceBodyChars,
          promptChars
        } as Prisma.InputJsonValue
      });
      throw new Error(`yearly report rewrite pipeline failed for ${messageId}`);
    }

    await upsertRewrite({
      messageId,
      version: revisionOptions.version,
      userInstruction: revisionOptions.userInstruction,
      generationRunId: revisionOptions.generationRunId,
      inputJson: generationInputJson(
        yearlyPayload,
        revisionOptions.previousOutput,
        modelCalls
      ),
      rewriteJson: {
        errorCode: "YEARLY_REPORT_REWRITE_FAILED_FINAL",
        message: errorText
      } as Prisma.InputJsonValue,
      status: "failed",
      validationJson: {
        valid: false,
        errorCode: "YEARLY_REPORT_REWRITE_FAILED_FINAL",
        errors: [errorText],
        sourceBodyChars: payload.sourceBodyChars,
        promptChars
      } as Prisma.InputJsonValue
    });
  }
}

async function upsertRewrite(args: {
  messageId: number;
  rewriteJson: Prisma.InputJsonValue;
  status: "pending" | "needs_retry" | "failed" | "published" | "skipped";
  validationJson: Prisma.InputJsonValue;
  version?: number;
  userInstruction?: string;
  generationRunId?: string;
  inputJson?: Prisma.InputJsonValue;
}): Promise<void> {
  const version = args.version ?? 1;
  await prisma.rewrite.upsert({
    where: {
      messageId_version: {
        messageId: args.messageId,
        version
      }
    },
    create: {
      messageId: args.messageId,
      version,
      lang: "nb",
      model: config.OPENAI_MODEL,
      promptVersion: PROMPT_VERSION,
      rewriteJson: args.rewriteJson,
      validationJson: args.validationJson,
      status: args.status,
      userInstruction: args.userInstruction ?? null
    },
    update: {
      lang: "nb",
      model: config.OPENAI_MODEL,
      promptVersion: PROMPT_VERSION,
      rewriteJson: args.rewriteJson,
      validationJson: args.validationJson,
      status: args.status,
      userInstruction: args.userInstruction ?? null,
      generatedAt: new Date()
    }
  });

  if (args.generationRunId) {
    const terminalStatus =
      args.status === "published" ||
      args.status === "failed" ||
      args.status === "skipped";
    await logPrisma.generationRun.update({
      where: { id: args.generationRunId },
      data: {
        version,
        status: args.status,
        userInstruction: args.userInstruction ?? null,
        ...(args.inputJson ? { inputJson: args.inputJson } : {}),
        outputJson: args.rewriteJson,
        validationJson: args.validationJson,
        model: config.OPENAI_MODEL,
        promptVersion: PROMPT_VERSION,
        promptChars: extractPromptChars(args.validationJson),
        errorText: extractRewriteErrorText(args.rewriteJson),
        ...(terminalStatus ? { finishedAt: new Date() } : {})
      }
    });
  }
}

const ingestWorker = new Worker<IngestJobData>(
  QUEUE_NAMES.ingest,
  async (job: Job<IngestJobData>) => {
    if (job.name === "poll-list") {
      return withJobRun("poll", null, async () => {
        const list = await fetchList();
        const ids = list.map((item) => item.messageId);
        const existing = await prisma.sourceNotice.findMany({
          where: {
            messageId: {
              in: ids
            }
          },
          select: {
            messageId: true
          }
        });
        const existingSet = new Set(existing.map((item) => item.messageId));

        for (const item of list) {
          if (existingSet.has(item.messageId)) {
            continue;
          }
          await ingestQueue.add("ingest-notice", item, {
            jobId: `ingest-${item.messageId}`,
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 5000
            },
            removeOnComplete: 2000,
            removeOnFail: 2000
          });
        }
      });
    }

    // SourceNotice does not exist yet for ingest, so do not FK-link this run on create.
    return withJobRun("ingest", null, async () => {
      const details = await fetchMessageDetails(job.data.messageId);
      await prisma.sourceNotice.upsert({
        where: {
          messageId: job.data.messageId
        },
        create: {
          messageId: job.data.messageId,
          newsId: job.data.newsId,
          title: job.data.title,
          issuerName: job.data.issuerName,
          issuerSign: job.data.issuerSign,
          publishedAt: new Date(job.data.publishedTime),
          categoriesJson: job.data.categories,
          marketsJson: job.data.markets,
          bodyText: details.bodyText,
          hasAttachments: job.data.numbAttachments > 0 || details.hasAttachments,
          rawMessageJson: details.rawMessageJson as Prisma.InputJsonValue
        },
        update: {
          title: job.data.title,
          issuerName: job.data.issuerName,
          issuerSign: job.data.issuerSign,
          publishedAt: new Date(job.data.publishedTime),
          categoriesJson: job.data.categories,
          marketsJson: job.data.markets,
          bodyText: details.bodyText,
          hasAttachments: job.data.numbAttachments > 0 || details.hasAttachments,
          rawMessageJson: details.rawMessageJson as Prisma.InputJsonValue
        }
      });

      // Check if a sibling notice from the same issuer was published within 10 seconds
      // (bilingual duplicate — Newsweb publishes NO/EN versions with different newsIds)
      const publishedAt = new Date(job.data.publishedTime);
      const bilingualSibling = await prisma.sourceNotice.findFirst({
        where: {
          issuerSign: job.data.issuerSign,
          messageId: { not: job.data.messageId },
          publishedAt: {
            gte: new Date(publishedAt.getTime() - 10_000),
            lte: new Date(publishedAt.getTime() + 10_000)
          }
        },
        select: { messageId: true }
      });

      if (bilingualSibling) {
        // Bilingual duplicate — ingest but skip AI generation (shows as grayed-out card)
        await prisma.rewrite.create({
          data: {
            messageId: job.data.messageId,
            version: 1,
            lang: "nb",
            model: "",
            promptVersion: "",
            rewriteJson: {},
            validationJson: {},
            status: "skipped"
          }
        });
        await prisma.feedItem.upsert({
          where: { messageId: job.data.messageId },
          create: {
            messageId: job.data.messageId,
            publishedAt: new Date(job.data.publishedTime),
            visibilityStatus: "published",
            rankScore: 0
          },
          update: {}
        });
        return;
      }

      await prisma.feedItem.upsert({
        where: { messageId: job.data.messageId },
        create: {
          messageId: job.data.messageId,
          publishedAt: new Date(job.data.publishedTime),
          visibilityStatus: "published",
          rankScore: 0
        },
        update: {}
      });

      await rewriteQueue.add(
        "rewrite-notice",
        {
          messageId: job.data.messageId,
          reason: "new-message"
        },
        {
          jobId: `rewrite-${job.data.messageId}`,
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000
          },
          removeOnComplete: 2000,
          removeOnFail: 2000
        }
      );
    });
  },
  {
    connection,
    concurrency: 4
  }
);

const rewriteWorker = new Worker<RewriteJobData>(
  QUEUE_NAMES.rewrite,
  async (job: Job<RewriteJobData>) => {
    const messageId = job.data.messageId;
    return withJobRun("rewrite", messageId, async () => {
      const source = await prisma.sourceNotice.findUnique({
        where: { messageId }
      });
      if (!source) {
        throw new Error(`source_notices missing for ${messageId}`);
      }

      const categories = ((source.categoriesJson as string[]) ?? []).map(fixDoubleEncodedUtf8);

      const payload: PromptPayload = {
        messageId: source.messageId,
        title: source.title,
        issuerName: source.issuerName,
        issuerSign: source.issuerSign,
        publishedAt: source.publishedAt.toISOString(),
        categories,
        markets: (source.marketsJson as string[]) ?? [],
        bodyText: source.bodyText,
        hasAttachments: source.hasAttachments,
        sourceBodyChars: source.bodyText.length
      };

      // Manual reprocesses should create a new row before any branch can persist output.
      let targetVersion = job.data.targetVersion ?? 1;
      if (
        !job.data.targetVersion &&
        (job.data.reason === "manual-reprocess" || job.data.instruction)
      ) {
        const maxRow = await prisma.rewrite.findFirst({
          where: { messageId },
          orderBy: { version: "desc" },
          select: { version: true }
        });
        targetVersion = (maxRow?.version ?? 0) + 1;
      }

      let previousOutput: RewriteOutput | undefined;
      if (job.data.previousRewriteJson) {
        try {
          previousOutput = rewriteOutputSchema.parse(
            normalizeRewriteJson(job.data.previousRewriteJson)
          );
        } catch {
          // Corrupted queued previous output: fall back to DB lookup.
        }
      }
      if (
        !previousOutput &&
        (job.data.reason === "manual-reprocess" || job.data.instruction) &&
        targetVersion > 1
      ) {
        const prevRewrite = await prisma.rewrite.findFirst({
          where: {
            messageId,
            version: { lt: targetVersion },
            status: { in: ["published", "pending"] }
          },
          orderBy: { version: "desc" },
          select: { rewriteJson: true }
        });
        if (prevRewrite) {
          try {
            previousOutput = rewriteOutputSchema.parse(
              normalizeRewriteJson(prevRewrite.rewriteJson)
            );
          } catch {
            // Corrupted previous output: fall back to fresh generation.
          }
        }
      }

      const generationRunId = await startGenerationRun(
        job,
        messageId,
        targetVersion,
        payload,
        previousOutput
      );
      const preRewriteModelCalls: ModelCallLog[] = [];
      let preRewritePromptChars = 0;

      // Skip full AI rewrite for mechanical categories, unless manually triggered
      if (job.data.reason !== "manual-reprocess" && shouldSkipRewrite(categories)) {
        await upsertRewrite({
          messageId,
          version: targetVersion,
          userInstruction: job.data.instruction,
          generationRunId,
          rewriteJson: {
            skippedReason: "CATEGORY_SKIP",
            categories
          } as Prisma.InputJsonValue,
          status: "skipped",
          validationJson: {
            valid: true,
            errorCode: null,
            errors: [],
            sourceBodyChars: payload.sourceBodyChars,
            promptChars: 0,
            skippedCategories: categories
          } as Prisma.InputJsonValue
        });

        await enqueuePublish(messageId, targetVersion, generationRunId);
        return;
      }

      // Three-tier PDF processing for notices with attachments
      if (source.hasAttachments) {
        try {
          // If stored attachments lack filenames (old ingestion), re-fetch from API
          let rawJson = source.rawMessageJson;
          const storedAtts = (rawJson as Record<string, unknown>)?.attachments as
            | Array<Record<string, unknown>>
            | undefined;
          const missingNames =
            storedAtts &&
            storedAtts.length > 0 &&
            storedAtts.every((a) => !a.name && !a.fileName);
          if (missingNames) {
            const fresh = await fetchMessageDetails(messageId);
            rawJson = fresh.rawMessageJson as Prisma.JsonValue;
            await prisma.sourceNotice.update({
              where: { messageId },
              data: { rawMessageJson: fresh.rawMessageJson as Prisma.InputJsonValue }
            });
          }

          // TIER 1: Yearly report — targeted remuneration extraction
          if (isYearlyReportCategory(categories)) {
            let yearlyContent: YearlyReportExtractionResult | null =
              await extractYearlyReportSections(rawJson, messageId);
            if (!yearlyContent) {
              const yearlyPdf = await downloadYearlyReportPdfAttachment(
                rawJson,
                messageId
              );
              if (yearlyPdf) {
                const fallback = await extractYearlyRemunerationWithOpenAIPdf(
                  yearlyPdf,
                  source
                );
                preRewriteModelCalls.push(fallback.modelCall);
                preRewritePromptChars += fallback.promptChars;
                if (fallback.found && fallback.context.trim().length > 0) {
                  yearlyContent = {
                    letterText: null,
                    remunerationText: formatPdfContext(
                      fallback,
                      "OPENAI PDF FALLBACK YEARLY REMUNERATION CONTEXT"
                    ),
                    pageCount: yearlyPdf.pageCount,
                    attachmentId: yearlyPdf.attachmentId,
                    openAIPdfFallback: true
                  };
                }
              }
            }
            if (yearlyContent) {
              await processYearlyReportRewrite(
                messageId,
                source,
                payload,
                job,
                yearlyContent,
                {
                  version: targetVersion,
                  userInstruction: job.data.instruction,
                  previousOutput,
                  generationRunId,
                  modelCalls: preRewriteModelCalls,
                  promptChars: preRewritePromptChars
                }
              );
              return;
            }
            // No remuneration data found — skip (shows as grayed-out in feed)
            console.log(
              `[yearly-report] no remuneration data found for ${messageId} (${source.issuerSign}), skipping`
            );
            await upsertRewrite({
              messageId,
              version: targetVersion,
              userInstruction: job.data.instruction,
              generationRunId,
              inputJson: generationInputJson(
                payload,
                previousOutput,
                preRewriteModelCalls
              ),
              rewriteJson: {
                skippedReason: "YEARLY_REPORT_NO_REMUNERATION",
                categories
              } as Prisma.InputJsonValue,
              status: "skipped",
              validationJson: {
                valid: true,
                errorCode: null,
                errors: [],
                sourceBodyChars: payload.sourceBodyChars,
                promptChars: preRewritePromptChars
              } as Prisma.InputJsonValue
            });
            await enqueuePublish(messageId, targetVersion, generationRunId);
            return;
          }

          // TIER 2: Quarterly report — filename-matched PDF extraction (existing behavior)
          let reportContent = await extractReportContent(
            rawJson,
            messageId,
            job.data.instruction
          );
          if (reportContent && reportNeedsOpenAIPdfFallback(reportContent)) {
            const reportPdf = await downloadReportPdfAttachment(rawJson, messageId);
            if (reportPdf) {
              const fallback = await extractReportContextWithOpenAIPdf(
                reportPdf,
                source,
                job.data.instruction
              );
              preRewriteModelCalls.push(fallback.modelCall);
              preRewritePromptChars += fallback.promptChars;
              if (fallback.context.trim().length > 0) {
                reportContent = reportExtractionFromOpenAIPdf(
                  reportPdf,
                  fallback,
                  reportContent
                );
              }
            }
          }
          if (!reportContent) {
            const reportPdf = await downloadReportPdfAttachment(rawJson, messageId);
            if (reportPdf) {
              const fallback = await extractReportContextWithOpenAIPdf(
                reportPdf,
                source,
                job.data.instruction
              );
              preRewriteModelCalls.push(fallback.modelCall);
              preRewritePromptChars += fallback.promptChars;
              if (fallback.context.trim().length > 0) {
                reportContent = reportExtractionFromOpenAIPdf(reportPdf, fallback);
              }
            }
          }
          if (reportContent) {
            await processReportRewrite(
              messageId,
              source,
              payload,
              job,
              reportContent,
              {
                version: targetVersion,
                userInstruction: job.data.instruction,
                previousOutput,
                generationRunId,
                modelCalls: preRewriteModelCalls,
                promptChars: preRewritePromptChars
              }
            );
            return;
          }

          // TIER 3: General PDF — supplement the normal rewrite with PDF context
          const generalPdf = await extractGeneralPdfContent(rawJson, messageId);
          if (generalPdf) {
            payload.pdfSupplementText = generalPdf.text;
            payload.pdfSupplementPageCount = generalPdf.pageCount;
            payload.pdfSupplementAttachmentId = generalPdf.attachmentId;
            // Fall through to triage/rewrite with augmented payload
          } else {
            const fallbackPdf = await downloadGeneralPdfAttachment(rawJson, messageId);
            if (fallbackPdf) {
              const fallback = await extractGeneralContextWithOpenAIPdf(
                fallbackPdf,
                payload,
                job.data.instruction
              );
              preRewriteModelCalls.push(fallback.modelCall);
              preRewritePromptChars += fallback.promptChars;
              if (fallback.context.trim().length > 0) {
                payload.pdfSupplementText = formatPdfContext(
                  fallback,
                  "OPENAI PDF FALLBACK SUPPLEMENT CONTEXT"
                );
                payload.pdfSupplementPageCount = fallbackPdf.pageCount;
                payload.pdfSupplementAttachmentId = fallbackPdf.attachmentId;
              }
            }
          }
        } catch (error) {
          console.log(
            `[pdf] PDF extraction/rewrite failed for ${messageId} (${source.issuerSign}), falling through to normal pipeline: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          // Fall through to normal triage/rewrite pipeline
        }
      }

      // AI triage for ambiguous categories — lightweight check before full pipeline
      if (job.data.reason !== "manual-reprocess" && needsNewsworthinessTriage(categories)) {
        const triage = await callModelTriage(source.title, source.bodyText, categories);
        if (triage.modelCall) {
          preRewriteModelCalls.push(triage.modelCall);
          preRewritePromptChars += triage.promptChars;
        }
        if (!triage.newsworthy) {
          console.log(
            `[triage] skipping ${messageId} (${source.issuerSign}): ${triage.reason}`
          );
          await upsertRewrite({
            messageId,
            version: targetVersion,
            userInstruction: job.data.instruction,
            generationRunId,
            inputJson: generationInputJson(
              payload,
              previousOutput,
              preRewriteModelCalls
            ),
            rewriteJson: {
              skippedReason: "AI_TRIAGE_SKIP",
              triageReason: triage.reason,
              categories
            } as Prisma.InputJsonValue,
            status: "skipped",
            validationJson: {
              valid: true,
              errorCode: null,
              errors: [],
              sourceBodyChars: payload.sourceBodyChars,
              promptChars: preRewritePromptChars,
              triageResult: { newsworthy: false, reason: triage.reason }
            } as Prisma.InputJsonValue
          });

          await enqueuePublish(messageId, targetVersion, generationRunId);
          return;
        }
        console.log(
          `[triage] proceeding with ${messageId} (${source.issuerSign}): ${triage.reason}`
        );
      }

      const maxAttempts = job.opts.attempts ?? 1;
      const finalAttempt = job.attemptsMade + 1 >= maxAttempts;
      let promptChars = preRewritePromptChars;
      let checkerError: string | null = null;
      let correctionApplied = false;
      let initialCoverage: ReferenceCoverageReport | null = null;
      let finalCoverage: ReferenceCoverageReport | null = null;
      let hiddenDraft: RewriteOutput | null = null;
      let importanceAdjusted = false;
      let importanceAdjustReason: string | null = null;
      let attributionCorrectionApplied = false;
      let attributionRiskCount = 0;
      let styleSanitization: ReturnType<typeof sanitizeRewriteStyle>["stats"] | null =
        null;
      const modelCalls: ModelCallLog[] = [...preRewriteModelCalls];

      if (payload.bodyText.trim().length === 0) {
        await upsertRewrite({
          messageId,
          version: targetVersion,
          userInstruction: job.data.instruction,
          generationRunId,
          rewriteJson: {
            errorCode: "SOURCE_TEXT_EMPTY",
            message: "Source bodyText is empty."
          } as Prisma.InputJsonValue,
          status: "failed",
          validationJson: {
            valid: false,
            errorCode: "SOURCE_TEXT_EMPTY",
            errors: ["Source body text is empty."],
            sourceBodyChars: payload.sourceBodyChars,
            promptChars
          } as Prisma.InputJsonValue
        });
        return;
      }

      try {
        const initialDraftResult = await callModelRewrite(
          payload,
          job.data.instruction,
          previousOutput
        );
        modelCalls.push(initialDraftResult.modelCall);
        promptChars += initialDraftResult.promptChars;
        hiddenDraft = initialDraftResult.rewrite;
        let rewrite = hiddenDraft;

        try {
          // Include PDF supplement text in reference check so facts from
          // attached PDFs are considered grounded (not just the body text)
          const refPayload = payload.pdfSupplementText
            ? { ...payload, bodyText: payload.bodyText + "\n\n" + payload.pdfSupplementText }
            : payload;

          const initialReferenceCheck = await callModelReferenceCheck(refPayload, rewrite);
          if (initialReferenceCheck.modelCall) {
            modelCalls.push(initialReferenceCheck.modelCall);
          }
          promptChars += initialReferenceCheck.promptChars;
          initialCoverage = initialReferenceCheck.coverage;
          finalCoverage = initialReferenceCheck.coverage;

          const correctionInstruction = buildCorrectionInstruction(
            initialReferenceCheck.coverage
          );
          if (correctionInstruction) {
            const combinedCorrection = [job.data.instruction, correctionInstruction]
              .filter(Boolean)
              .join("\n\n");
            const correctedResult = await callModelRewrite(
              payload,
              combinedCorrection,
              rewrite,
              config.OPENAI_REPORT_REASONING_EFFORT
            );
            modelCalls.push(correctedResult.modelCall);
            promptChars += correctedResult.promptChars;
            rewrite = correctedResult.rewrite;
            correctionApplied = true;

            const finalReferenceCheck = await callModelReferenceCheck(refPayload, rewrite);
            if (finalReferenceCheck.modelCall) {
              modelCalls.push(finalReferenceCheck.modelCall);
            }
            promptChars += finalReferenceCheck.promptChars;
            finalCoverage = finalReferenceCheck.coverage;
          }
        } catch (error) {
          checkerError = error instanceof Error ? error.message : String(error);
        }

        const attributionRisks = findAttributionRisks(rewrite);
        attributionRiskCount = attributionRisks.length;
        const attributionInstruction =
          buildAttributionCorrectionInstruction(attributionRisks);
        if (attributionInstruction) {
          const combinedAttribution = [job.data.instruction, attributionInstruction]
            .filter(Boolean)
            .join("\n\n");
          const correctedForAttribution = await callModelRewrite(
            payload,
            combinedAttribution,
            rewrite,
            config.OPENAI_REPORT_REASONING_EFFORT
          );
          modelCalls.push(correctedForAttribution.modelCall);
          promptChars += correctedForAttribution.promptChars;
          rewrite = correctedForAttribution.rewrite;
          attributionCorrectionApplied = true;
          attributionRiskCount = findAttributionRisks(rewrite).length;
        }

        const importanceResult = applyImportanceHighBar(rewrite, payload);
        rewrite = importanceResult.rewrite;
        importanceAdjusted = importanceResult.adjusted;
        importanceAdjustReason = importanceResult.reason;

        const styleResult = sanitizeRewriteStyle(rewrite);
        rewrite = styleResult.rewrite;
        styleSanitization = styleResult.stats;

        const validation = validateRewriteOutput(rewrite, payload);

        await upsertRewrite({
          messageId,
          version: targetVersion,
          userInstruction: job.data.instruction,
          generationRunId,
          inputJson: generationInputJson(payload, previousOutput, modelCalls),
          rewriteJson: rewrite,
          status: "pending",
          validationJson: {
            valid: validation.valid,
            errorCode: validation.valid
              ? null
              : "NON_BLOCKING_VALIDATION_WARNINGS",
            errors: validation.errors,
            sourceBodyChars: payload.sourceBodyChars,
            promptChars,
            styleSanitization,
            referenceCheck: {
              enabled: true,
              checkerError,
              correctionApplied,
              attributionCorrectionApplied,
              attributionRiskCount,
              initialCoveragePercent: initialCoverage?.coveragePercent ?? null,
              finalCoveragePercent:
                finalCoverage?.coveragePercent ??
                initialCoverage?.coveragePercent ??
                null,
              importanceAdjusted,
              importanceAdjustReason,
              totalSentences:
                finalCoverage?.totalSentences ?? initialCoverage?.totalSentences ?? 0,
              unsupportedSentenceCount:
                finalCoverage?.unsupportedSentences.length ??
                initialCoverage?.unsupportedSentences.length ??
                0,
              sentenceReviews: (finalCoverage?.items ?? initialCoverage?.items ?? []).map(
                (item) => ({
                  index: item.index,
                  sentence: item.sentence,
                  grounded: item.grounded,
                  interpretation: item.interpretation,
                  sourceEvidence: item.sourceEvidence
                })
              ),
              unsupportedSentences: (
                finalCoverage?.unsupportedSentences ??
                initialCoverage?.unsupportedSentences ??
                []
              ).map((item) => ({
                index: item.index,
                sentence: item.sentence,
                interpretation: item.interpretation,
                sourceEvidence: item.sourceEvidence
              }))
            },
            hiddenDraft: hiddenDraft
              ? {
                  title: hiddenDraft.title,
                  lead: hiddenDraft.lead,
                  body: hiddenDraft.body,
                  company_sentence: hiddenDraft.company_sentence
                }
              : null
          } as Prisma.InputJsonValue
        });

        await enqueuePublish(messageId, targetVersion, generationRunId);
        return;
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);

        if (!finalAttempt) {
          await upsertRewrite({
            messageId,
            version: targetVersion,
            userInstruction: job.data.instruction,
            generationRunId,
            inputJson: generationInputJson(payload, previousOutput, modelCalls),
            rewriteJson: {
              errorCode: "REWRITE_ATTEMPT_FAILED",
              message: errorText
            } as Prisma.InputJsonValue,
            status: "needs_retry",
            validationJson: {
              valid: false,
              errorCode: "REWRITE_ATTEMPT_FAILED",
              errors: [errorText],
              sourceBodyChars: payload.sourceBodyChars,
              promptChars,
              styleSanitization,
              referenceCheck: {
                enabled: true,
                checkerError,
                correctionApplied,
                attributionCorrectionApplied,
                attributionRiskCount,
                importanceAdjusted,
                importanceAdjustReason,
                initialCoveragePercent: initialCoverage?.coveragePercent ?? null,
                finalCoveragePercent: finalCoverage?.coveragePercent ?? null
              }
            } as Prisma.InputJsonValue
          });
          throw new Error(`rewrite pipeline failed for ${messageId}`);
        }

        await upsertRewrite({
          messageId,
          version: targetVersion,
          userInstruction: job.data.instruction,
          generationRunId,
          inputJson: generationInputJson(payload, previousOutput, modelCalls),
          rewriteJson: {
            errorCode: "REWRITE_FAILED_FINAL",
            message: errorText
          } as Prisma.InputJsonValue,
          status: "failed",
          validationJson: {
            valid: false,
            errorCode: "REWRITE_FAILED_FINAL",
            errors: [errorText],
            sourceBodyChars: payload.sourceBodyChars,
            promptChars,
            styleSanitization,
            referenceCheck: {
              enabled: true,
              checkerError,
              correctionApplied,
              attributionCorrectionApplied,
              attributionRiskCount,
              importanceAdjusted,
              importanceAdjustReason,
              initialCoveragePercent: initialCoverage?.coveragePercent ?? null,
              finalCoveragePercent: finalCoverage?.coveragePercent ?? null
            }
          } as Prisma.InputJsonValue
        });
      }
    });
  },
  {
    connection,
    concurrency: 3
  }
);

const publishWorker = new Worker<PublishJobData>(
  QUEUE_NAMES.publish,
  async (job: Job<PublishJobData>) => {
    return withJobRun("publish", job.data.messageId, async () => {
      const source = await prisma.sourceNotice.findUnique({
        where: { messageId: job.data.messageId }
      });
      if (!source) {
        throw new Error(`source_notices missing for ${job.data.messageId}`);
      }

      await prisma.feedItem.upsert({
        where: {
          messageId: source.messageId
        },
        create: {
          messageId: source.messageId,
          publishedAt: source.publishedAt,
          visibilityStatus: "published",
          rankScore: 0
        },
        update: {
          publishedAt: source.publishedAt,
          visibilityStatus: "published",
          rankScore: 0
        }
      });

      const pendingRewrites = await prisma.rewrite.findMany({
        where: {
          messageId: source.messageId,
          status: "pending",
          ...(job.data.version ? { version: job.data.version } : {})
        },
        orderBy: { version: "desc" },
        take: job.data.version ? undefined : 1,
        select: { version: true }
      });

      const publishedVersions = pendingRewrites.map((rewrite) => rewrite.version);
      if (publishedVersions.length > 0) {
        await prisma.rewrite.updateMany({
          where: {
            messageId: source.messageId,
            status: "pending",
            version: { in: publishedVersions }
          },
          data: { status: "published" }
        });
      }

      if (publishedVersions.length > 0) {
        await logPrisma.generationRun.updateMany({
          where: {
            messageId: source.messageId,
            version: { in: publishedVersions },
            status: "pending"
          },
          data: {
            status: "published",
            finishedAt: new Date()
          }
        });
      }

      await redisPub.publish(
        REDIS_CHANNELS.feedNewItem,
        JSON.stringify({ messageId: source.messageId })
      );
    });
  },
  {
    connection,
    concurrency: 6
  }
);

async function bootstrap(): Promise<void> {
  const repeatables = await ingestQueue.getRepeatableJobs();
  for (const repeatable of repeatables) {
    if (repeatable.name === "poll-list") {
      await ingestQueue.removeRepeatableByKey(repeatable.key);
    }
  }

  await ingestQueue.add(
    "poll-list",
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as IngestJobData,
    {
      jobId: "poll-list-immediate",
      removeOnComplete: 2000,
      removeOnFail: 2000
    }
  );

  await ingestQueue.add(
    "poll-list",
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as IngestJobData,
    {
      jobId: "poll-list-repeat",
      repeat: {
        every: config.POLL_INTERVAL_MS
      },
      removeOnComplete: 2000,
      removeOnFail: 2000
    }
  );

  if (config.LATEST_BOOTSTRAP_COUNT > 0) {
    try {
      const seeded = await enqueueLatestNotices(config.LATEST_BOOTSTRAP_COUNT);
      console.log(
        `[worker] seeded latest notices requested=${seeded.requested} feedItemsEnsured=${seeded.feedItemsEnsured} ingestQueued=${seeded.queuedIngest} rewriteQueued=${seeded.queuedRewrite}`
      );
    } catch (error) {
      console.error(
        `[worker] failed seeding latest notices: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  console.log(
    `[worker] started. pollInterval=${config.POLL_INTERVAL_MS}ms model=${config.OPENAI_MODEL} fastModel=${config.OPENAI_FAST_MODEL}`
  );
}

ingestWorker.on("completed", (job) => {
  console.log(
    JSON.stringify({
      service: "worker",
      queue: QUEUE_NAMES.ingest,
      event: "completed",
      jobId: job.id,
      jobName: job.name
    })
  );
});

rewriteWorker.on("completed", (job) => {
  console.log(
    JSON.stringify({
      service: "worker",
      queue: QUEUE_NAMES.rewrite,
      event: "completed",
      jobId: job.id,
      messageId: job.data.messageId
    })
  );
});

publishWorker.on("completed", (job) => {
  console.log(
    JSON.stringify({
      service: "worker",
      queue: QUEUE_NAMES.publish,
      event: "completed",
      jobId: job.id,
      messageId: job.data.messageId
    })
  );
});

for (const [queueName, worker] of [
  [QUEUE_NAMES.ingest, ingestWorker],
  [QUEUE_NAMES.rewrite, rewriteWorker],
  [QUEUE_NAMES.publish, publishWorker]
] as const) {
  worker.on("failed", (job, error) => {
    console.error(
      JSON.stringify({
        service: "worker",
        queue: queueName,
        event: "failed",
        jobId: job?.id ?? null,
        messageId: job?.data?.messageId ?? null,
        error: error.message
      })
    );
  });
}

async function shutdown(): Promise<void> {
  await Promise.all([
    ingestWorker.close(),
    rewriteWorker.close(),
    publishWorker.close(),
    ingestQueue.close(),
    rewriteQueue.close(),
    publishQueue.close()
  ]);
  await redisPub.quit();
  await Promise.all([
    prisma.$disconnect(),
    logPrisma === prisma
      ? Promise.resolve()
      : logPrisma.$disconnect()
  ]);
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

void bootstrap();
