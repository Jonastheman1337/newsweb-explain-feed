import type { Prisma, PrismaClient } from "@prisma/client";
import {
  NUMERIC_SHADOW_MONITOR_APP_SETTING_KEY,
  numericShadowMonitorSnapshotSchema,
  type NumericShadowMonitorSnapshot
} from "@newsweb/shared";
import { isDedicatedLogDatabaseConfigured, logPrisma, prisma } from "@newsweb/shared/db";

export const SIGNAL_TABS = [
  "feedback",
  "edits",
  "titles",
  "events",
  "generations"
] as const;

export type SignalTab = (typeof SIGNAL_TABS)[number];

export type SignalsQuery = {
  tab: SignalTab;
  messageId?: number;
  action?: string;
  from?: string;
  to?: string;
  limit: number;
};

export type NoticeSummary = {
  messageId: number;
  title: string;
  issuerName: string;
  issuerSign: string;
  publishedAt: string;
};

type SourceDb = "primary" | "log";

type EventContext = {
  promptVersion: string | null;
  model: string | null;
  actionSource: string | null;
};

export type FeedbackSignal = {
  id: string;
  eventId: string | null;
  messageId: number;
  version: number | null;
  text: string;
  createdAt: string;
  promptVersion: string | null;
  model: string | null;
  actionSource: string | null;
  notice: NoticeSummary | null;
};

export type EditSignal = {
  id: string;
  eventId: string | null;
  messageId: number;
  hasEdits: boolean;
  originalTitle: string;
  editedTitle: string;
  originalBody: string;
  editedBody: string;
  copiedAt: string;
  promptVersion: string | null;
  model: string | null;
  actionSource: string | null;
  notice: NoticeSummary | null;
};

export type TitleSignal = {
  id: string;
  eventId: string | null;
  messageId: number;
  currentTitle: string;
  selectedTitle: string | null;
  action: string | null;
  selectedIndex: number | null;
  selectedWasOriginal: boolean | null;
  suggestions: string[];
  createdAt: string;
  promptVersion: string | null;
  model: string | null;
  actionSource: string | null;
  notice: NoticeSummary | null;
};

export type EventSignal = {
  id: string;
  sourceDb: SourceDb;
  messageId: number | null;
  version: number | null;
  action: string;
  actionSource: string | null;
  hasClientEventId: boolean;
  hasEditorIdHash: boolean;
  hasSessionIdHash: boolean;
  rewriteId: string | null;
  promptVersion: string | null;
  model: string | null;
  payloadJson: Prisma.JsonValue | null;
  createdAt: string;
  notice: NoticeSummary | null;
};

export type GenerationSignal = {
  id: string;
  sourceDb: SourceDb;
  messageId: number;
  version: number | null;
  reason: string;
  status: string;
  jobId: string | null;
  jobName: string | null;
  userInstruction: string | null;
  model: string | null;
  promptVersion: string | null;
  promptChars: number | null;
  reasoningEffortOverride: string | null;
  modelCalls: ModelCallSignal[];
  modelCallCount: number;
  modelCallAttemptCount: number;
  modelCallUsage: ModelCallUsageSignal | null;
  referenceCheck: ReferenceCheckSignal | null;
  outputJson: Prisma.JsonValue | null;
  validationJson: Prisma.JsonValue | null;
  errorText: string | null;
  errorGroup: string | null;
  errorGroupCount: number;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  notice: NoticeSummary | null;
};

export type ModelCallSignal = {
  schemaName: string | null;
  model: string | null;
  responseModel: string | null;
  requestedServiceTier: string | null;
  serviceTier: string | null;
  reasoningEffort: string | null;
  promptCacheMode: string | null;
  promptCacheKey: string | null;
  timeoutMs: number | null;
  maxOutputTokens: number | null;
  promptChars: number | null;
  attemptCount: number | null;
  attempts: ModelCallAttemptSignal[];
  usage: ModelCallUsageSignal | null;
};

export type ModelCallUsageSignal = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type ModelCallAttemptSignal = {
  responseId: string | null;
  status: string | null;
  responseModel: string | null;
  requestedServiceTier: string | null;
  serviceTier: string | null;
  durationMs: number | null;
  requestedMaxOutputTokens: number | null;
  error: string | null;
  rawUsage: Prisma.JsonValue | null;
  usage: ModelCallUsageSignal | null;
};

export type ReferenceCheckSignal = {
  summary: string;
  detailJson: Prisma.JsonValue | null;
};

export type SignalsData =
  | { tab: "feedback"; rows: FeedbackSignal[] }
  | { tab: "edits"; rows: EditSignal[] }
  | { tab: "titles"; rows: TitleSignal[] }
  | { tab: "events"; rows: EventSignal[] }
  | { tab: "generations"; rows: GenerationSignal[] };

export type SignalsResult = {
  query: SignalsQuery;
  data: SignalsData;
  warnings: string[];
  logDbMode: "dedicated" | "primary";
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseLimit(value: string | string[] | undefined): number {
  const parsed = Number(firstValue(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(parsed), MAX_LIMIT);
}

function parseMessageId(value: string | string[] | undefined): number | undefined {
  const parsed = Number(firstValue(value));
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseDate(value: string | string[] | undefined): string | undefined {
  const raw = firstValue(value)?.trim();
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

function parseTab(value: string | string[] | undefined): SignalTab {
  const raw = firstValue(value);
  return SIGNAL_TABS.includes(raw as SignalTab) ? (raw as SignalTab) : "feedback";
}

export function parseSignalsQuery(
  params: Record<string, string | string[] | undefined>
): SignalsQuery {
  const action = firstValue(params.action)?.trim();
  return {
    tab: parseTab(params.tab),
    messageId: parseMessageId(params.messageId),
    action: action || undefined,
    from: parseDate(params.from),
    to: parseDate(params.to),
    limit: parseLimit(params.limit)
  };
}

function dateStart(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateEnd(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

function dateRange(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = dateStart(from);
  if (to) range.lte = dateEnd(to);
  return Object.keys(range).length ? range : undefined;
}

function jsonText(value: Prisma.JsonValue | null): string {
  if (value == null) return "";
  return JSON.stringify(value);
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asJsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function modelCallUsage(value: unknown): ModelCallUsageSignal | null {
  const usage = asJsonRecord(value);
  if (!usage) return null;
  const inputTokens = numberValue(usage.inputTokens);
  const outputTokens = numberValue(usage.outputTokens);
  const totalTokens = numberValue(usage.totalTokens);
  if (inputTokens == null && outputTokens == null && totalTokens == null) {
    return null;
  }
  return {
    inputTokens: inputTokens ?? 0,
    cachedInputTokens: numberValue(usage.cachedInputTokens) ?? 0,
    cacheWriteInputTokens: numberValue(usage.cacheWriteInputTokens) ?? 0,
    outputTokens: outputTokens ?? 0,
    reasoningTokens: numberValue(usage.reasoningTokens) ?? 0,
    totalTokens: totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0)
  };
}

function modelCallAttempts(value: unknown): ModelCallAttemptSignal[] {
  return asJsonArray(value)
    .map(asJsonRecord)
    .filter((attempt): attempt is Record<string, unknown> => attempt != null)
    .map((attempt) => ({
      responseId: stringValue(attempt.responseId),
      status: stringValue(attempt.status),
      responseModel: stringValue(attempt.responseModel),
      requestedServiceTier: stringValue(attempt.requestedServiceTier),
      serviceTier: stringValue(attempt.serviceTier),
      durationMs: numberValue(attempt.durationMs),
      requestedMaxOutputTokens: numberValue(attempt.requestedMaxOutputTokens),
      error: stringValue(attempt.error),
      rawUsage:
        attempt.rawUsage == null
          ? null
          : (attempt.rawUsage as Prisma.JsonValue),
      usage: modelCallUsage(attempt.usage)
    }));
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function truncate(value: string, length = 220): string {
  return value.length > length ? `${value.slice(0, length - 1)}...` : value;
}

function generationErrorGroup(errorText: string | null): string | null {
  if (!errorText) return null;
  if (/no output_text/i.test(errorText)) return "openai_no_output_text";
  if (/request was aborted|aborted|aborterror/i.test(errorText)) {
    return "openai_request_aborted";
  }
  if (/timeout|timed out|etimedout/i.test(errorText)) return "openai_timeout";
  if (/unterminated string|unexpected token|json/i.test(errorText)) {
    return "json_parse_error";
  }
  return truncate(errorText.replace(/\s+/g, " "), 80);
}

function extractModelCalls(inputJson: Prisma.JsonValue | null): ModelCallSignal[] {
  const input = asJsonRecord(inputJson);
  return asJsonArray(input?.modelCalls)
    .map(asJsonRecord)
    .filter((call): call is Record<string, unknown> => call != null)
    .map((call) => ({
      schemaName: stringValue(call.schemaName),
      model: stringValue(call.model),
      responseModel: stringValue(call.responseModel),
      requestedServiceTier: stringValue(call.requestedServiceTier),
      serviceTier: stringValue(call.serviceTier),
      reasoningEffort: stringValue(call.reasoningEffort),
      promptCacheMode: stringValue(call.promptCacheMode),
      promptCacheKey: stringValue(call.promptCacheKey),
      timeoutMs: numberValue(call.timeoutMs),
      maxOutputTokens: numberValue(call.maxOutputTokens),
      promptChars: numberValue(call.promptChars),
      attemptCount: numberValue(call.attemptCount),
      attempts: modelCallAttempts(call.attempts),
      usage: modelCallUsage(call.usage)
    }));
}

function summarizeModelCalls(modelCalls: ModelCallSignal[]): {
  attemptCount: number;
  usage: ModelCallUsageSignal | null;
} {
  let attempts = 0;
  let usageCount = 0;
  const usage: ModelCallUsageSignal = {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0
  };
  for (const call of modelCalls) {
    attempts += call.attemptCount ?? call.attempts.length;
    if (!call.usage) continue;
    usageCount += 1;
    for (const key of Object.keys(usage) as Array<keyof ModelCallUsageSignal>) {
      usage[key] += call.usage[key];
    }
  }
  return { attemptCount: attempts, usage: usageCount > 0 ? usage : null };
}

function extractReasoningEffortOverride(inputJson: Prisma.JsonValue | null): string | null {
  const input = asJsonRecord(inputJson);
  return stringValue(input?.reasoningEffortOverride);
}

function extractReferenceCheck(
  validationJson: Prisma.JsonValue | null
): ReferenceCheckSignal | null {
  const validation = asJsonRecord(validationJson);
  const referenceCheck = asJsonRecord(validation?.referenceCheck);
  if (!referenceCheck) return null;

  const checkerError = stringValue(referenceCheck.checkerError);
  const initialCoverage = numberValue(referenceCheck.initialCoveragePercent);
  const finalCoverage = numberValue(referenceCheck.finalCoveragePercent);
  const unsupportedSentenceCount = numberValue(referenceCheck.unsupportedSentenceCount);
  const attributionRiskCount = numberValue(referenceCheck.attributionRiskCount);
  const summaryParts: string[] = [];

  if (checkerError) {
    summaryParts.push(`checker error: ${truncate(checkerError, 90)}`);
  } else if (finalCoverage != null) {
    summaryParts.push(`${finalCoverage}% grounded`);
  } else if (initialCoverage != null) {
    summaryParts.push(`${initialCoverage}% grounded initially`);
  } else {
    summaryParts.push("ran");
  }

  if (unsupportedSentenceCount != null) {
    summaryParts.push(`${unsupportedSentenceCount} unsupported`);
  }
  if (booleanValue(referenceCheck.correctionApplied)) {
    summaryParts.push("fact correction applied");
  }
  if (booleanValue(referenceCheck.attributionCorrectionApplied)) {
    summaryParts.push("attribution corrected");
  }
  if (attributionRiskCount != null && attributionRiskCount > 0) {
    summaryParts.push(`${attributionRiskCount} attribution risks`);
  }
  if (booleanValue(referenceCheck.importanceAdjusted)) {
    summaryParts.push("importance adjusted");
  }

  // P4 shadow outcome, appended LAST: the "checker error:" prefix above is a
  // stable series that pull-signals sniffs with /checker error/i.
  const outcome = asJsonRecord(referenceCheck.outcome);
  const outcomeState = outcome ? stringValue(outcome.state) : null;
  if (outcomeState) {
    summaryParts.push(`outcome: ${outcomeState}`);
  }

  return {
    summary: summaryParts.join(" | "),
    detailJson: referenceCheck as Prisma.JsonValue
  };
}

async function fetchNoticeMap(messageIds: Array<number | null | undefined>) {
  const uniqueIds = Array.from(
    new Set(messageIds.filter((id): id is number => Number.isInteger(id)))
  );
  if (!uniqueIds.length) return new Map<number, NoticeSummary>();

  const notices = await prisma.sourceNotice.findMany({
    where: { messageId: { in: uniqueIds } },
    select: {
      messageId: true,
      title: true,
      issuerName: true,
      issuerSign: true,
      publishedAt: true
    }
  });

  return new Map(
    notices.map((notice) => [
      notice.messageId,
      {
        messageId: notice.messageId,
        title: notice.title,
        issuerName: notice.issuerName,
        issuerSign: notice.issuerSign,
        publishedAt: notice.publishedAt.toISOString()
      }
    ])
  );
}

async function fetchEventContextMap(
  eventIds: Array<string | null | undefined>
): Promise<Map<string, EventContext>> {
  const uniqueIds = Array.from(
    new Set(eventIds.filter((id): id is string => typeof id === "string" && id.length > 0))
  );
  const map = new Map<string, EventContext>();
  if (!uniqueIds.length) return map;

  const result = await readLogSources(async (client) => {
    return client.userActionEvent.findMany({
      where: { id: { in: uniqueIds } },
      select: {
        id: true,
        promptVersion: true,
        model: true,
        actionSource: true
      }
    });
  });

  for (const row of result.rows) {
    if (map.has(row.id)) continue;
    map.set(row.id, {
      promptVersion: row.promptVersion,
      model: row.model,
      actionSource: row.actionSource
    });
  }

  return map;
}

async function readLogSources<T>(
  query: (client: PrismaClient, sourceDb: SourceDb) => Promise<T[]>
): Promise<{ rows: T[]; warnings: string[] }> {
  const warnings: string[] = [];
  const rows: T[] = [];

  if (isDedicatedLogDatabaseConfigured) {
    try {
      rows.push(...(await query(logPrisma, "log")));
    } catch (error) {
      warnings.push(`Could not read dedicated log database: ${errorMessage(error)}`);
    }
  }

  try {
    rows.push(...(await query(prisma, "primary")));
  } catch (error) {
    warnings.push(`Could not read primary database log tables: ${errorMessage(error)}`);
  }

  return { rows, warnings };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function attachNotice<T extends { messageId: number | null; notice?: NoticeSummary | null }>(
  rows: T[],
  noticeMap: Map<number, NoticeSummary>
): T[] {
  return rows.map((row) => ({
    ...row,
    notice: row.messageId == null ? null : noticeMap.get(row.messageId) ?? null
  }));
}

async function getFeedback(query: SignalsQuery): Promise<FeedbackSignal[]> {
  const createdAt = dateRange(query.from, query.to);
  const where: Prisma.FeedbackWhereInput = {};
  if (query.messageId) where.messageId = query.messageId;
  if (createdAt) where.createdAt = createdAt;

  const rows = await prisma.feedback.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: query.limit,
    select: {
      id: true,
      eventId: true,
      messageId: true,
      version: true,
      text: true,
      createdAt: true
    }
  });
  const noticeMap = await fetchNoticeMap(rows.map((row) => row.messageId));
  const eventContextMap = await fetchEventContextMap(rows.map((row) => row.eventId));

  return rows.map((row) => {
    const eventContext = row.eventId ? eventContextMap.get(row.eventId) : null;
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      promptVersion: eventContext?.promptVersion ?? null,
      model: eventContext?.model ?? null,
      actionSource: eventContext?.actionSource ?? null,
      notice: noticeMap.get(row.messageId) ?? null
    };
  });
}

async function getEdits(query: SignalsQuery): Promise<EditSignal[]> {
  const copiedAt = dateRange(query.from, query.to);
  const where: Prisma.EditLogWhereInput = {};
  if (query.messageId) where.messageId = query.messageId;
  if (copiedAt) where.copiedAt = copiedAt;

  const rows = await prisma.editLog.findMany({
    where,
    orderBy: { copiedAt: "desc" },
    take: query.limit,
    select: {
      id: true,
      eventId: true,
      messageId: true,
      hasEdits: true,
      originalTitle: true,
      editedTitle: true,
      originalBody: true,
      editedBody: true,
      copiedAt: true
    }
  });
  const noticeMap = await fetchNoticeMap(rows.map((row) => row.messageId));
  const eventContextMap = await fetchEventContextMap(rows.map((row) => row.eventId));

  return rows.map((row) => {
    const eventContext = row.eventId ? eventContextMap.get(row.eventId) : null;
    return {
      ...row,
      copiedAt: row.copiedAt.toISOString(),
      promptVersion: eventContext?.promptVersion ?? null,
      model: eventContext?.model ?? null,
      actionSource: eventContext?.actionSource ?? null,
      notice: noticeMap.get(row.messageId) ?? null
    };
  });
}

async function getTitles(query: SignalsQuery): Promise<TitleSignal[]> {
  const createdAt = dateRange(query.from, query.to);
  const where: Prisma.TitleSuggestionLogWhereInput = {};
  if (query.messageId) where.messageId = query.messageId;
  if (query.action) where.action = query.action;
  if (createdAt) where.createdAt = createdAt;

  const rows = await prisma.titleSuggestionLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: query.limit,
    select: {
      id: true,
      eventId: true,
      messageId: true,
      currentTitle: true,
      selectedTitle: true,
      action: true,
      selectedIndex: true,
      selectedWasOriginal: true,
      suggestions: true,
      createdAt: true
    }
  });
  const noticeMap = await fetchNoticeMap(rows.map((row) => row.messageId));
  const eventContextMap = await fetchEventContextMap(rows.map((row) => row.eventId));

  return rows.map((row) => {
    const eventContext = row.eventId ? eventContextMap.get(row.eventId) : null;
    return {
      ...row,
      suggestions: asStringArray(row.suggestions),
      createdAt: row.createdAt.toISOString(),
      promptVersion: eventContext?.promptVersion ?? null,
      model: eventContext?.model ?? null,
      actionSource: eventContext?.actionSource ?? null,
      notice: noticeMap.get(row.messageId) ?? null
    };
  });
}

async function getEvents(query: SignalsQuery): Promise<{ rows: EventSignal[]; warnings: string[] }> {
  const createdAt = dateRange(query.from, query.to);
  const where: Prisma.UserActionEventWhereInput = {};
  if (query.messageId) where.messageId = query.messageId;
  if (query.action) where.action = query.action;
  if (createdAt) where.createdAt = createdAt;

  const result = await readLogSources(async (client, sourceDb) => {
    const rows = await client.userActionEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit,
      select: {
        id: true,
        messageId: true,
        version: true,
        clientEventId: true,
        editorIdHash: true,
        sessionIdHash: true,
        rewriteId: true,
        promptVersion: true,
        model: true,
        action: true,
        actionSource: true,
        payloadJson: true,
        createdAt: true
      }
    });
    return rows.map((row) => ({
      ...row,
      sourceDb,
      hasClientEventId: Boolean(row.clientEventId),
      hasEditorIdHash: Boolean(row.editorIdHash),
      hasSessionIdHash: Boolean(row.sessionIdHash),
      createdAt: row.createdAt.toISOString(),
      notice: null
    }));
  });

  const sortedRows = result.rows
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, query.limit);
  const noticeMap = await fetchNoticeMap(sortedRows.map((row) => row.messageId));

  return {
    rows: attachNotice(sortedRows, noticeMap),
    warnings: result.warnings
  };
}

async function getGenerations(
  query: SignalsQuery
): Promise<{ rows: GenerationSignal[]; warnings: string[] }> {
  const requestedAt = dateRange(query.from, query.to);
  const where: Prisma.GenerationRunWhereInput = {};
  if (query.messageId) where.messageId = query.messageId;
  if (query.action) {
    where.OR = [{ reason: query.action }, { status: query.action }];
  }
  if (requestedAt) where.requestedAt = requestedAt;

  const result = await readLogSources(async (client, sourceDb) => {
    const rows = await client.generationRun.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      take: query.limit,
      select: {
        id: true,
        messageId: true,
        version: true,
        jobId: true,
        jobName: true,
        reason: true,
        status: true,
        userInstruction: true,
        model: true,
        promptVersion: true,
        promptChars: true,
        inputJson: true,
        outputJson: true,
        validationJson: true,
        errorText: true,
        requestedAt: true,
        startedAt: true,
        finishedAt: true
      }
    });
    return rows.map((row) => {
      const modelCalls = extractModelCalls(row.inputJson);
      const modelCallSummary = summarizeModelCalls(modelCalls);
      return {
        ...row,
        sourceDb,
        reasoningEffortOverride: extractReasoningEffortOverride(row.inputJson),
        modelCalls,
        modelCallCount: modelCalls.length,
        modelCallAttemptCount: modelCallSummary.attemptCount,
        modelCallUsage: modelCallSummary.usage,
        referenceCheck: extractReferenceCheck(row.validationJson),
        outputJson: row.outputJson,
        requestedAt: row.requestedAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        finishedAt: row.finishedAt?.toISOString() ?? null,
        notice: null
      };
    });
  });

  const sortedRows = result.rows
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .slice(0, query.limit);
  const errorGroupCounts = new Map<string, number>();
  for (const row of sortedRows) {
    const group = generationErrorGroup(row.errorText);
    if (group) {
      errorGroupCounts.set(group, (errorGroupCounts.get(group) ?? 0) + 1);
    }
  }
  const groupedRows = sortedRows.map((row) => {
    const errorGroup = generationErrorGroup(row.errorText);
    return {
      ...row,
      errorGroup,
      errorGroupCount: errorGroup ? errorGroupCounts.get(errorGroup) ?? 0 : 0
    };
  });
  const noticeMap = await fetchNoticeMap(groupedRows.map((row) => row.messageId));

  return {
    rows: attachNotice(groupedRows, noticeMap),
    warnings: result.warnings
  };
}

export async function getSignalsData(query: SignalsQuery): Promise<SignalsResult> {
  if (query.tab === "feedback") {
    return {
      query,
      data: { tab: "feedback", rows: await getFeedback(query) },
      warnings: [],
      logDbMode: isDedicatedLogDatabaseConfigured ? "dedicated" : "primary"
    };
  }
  if (query.tab === "edits") {
    return {
      query,
      data: { tab: "edits", rows: await getEdits(query) },
      warnings: [],
      logDbMode: isDedicatedLogDatabaseConfigured ? "dedicated" : "primary"
    };
  }
  if (query.tab === "titles") {
    return {
      query,
      data: { tab: "titles", rows: await getTitles(query) },
      warnings: [],
      logDbMode: isDedicatedLogDatabaseConfigured ? "dedicated" : "primary"
    };
  }
  if (query.tab === "events") {
    const events = await getEvents(query);
    return {
      query,
      data: { tab: "events", rows: events.rows },
      warnings: events.warnings,
      logDbMode: isDedicatedLogDatabaseConfigured ? "dedicated" : "primary"
    };
  }

  const generations = await getGenerations(query);
  return {
    query,
    data: { tab: "generations", rows: generations.rows },
    warnings: generations.warnings,
    logDbMode: isDedicatedLogDatabaseConfigured ? "dedicated" : "primary"
  };
}

export type DatabaseSizes = {
  primaryBytes: number;
  // null when no dedicated log DB is configured (it would be the same DB).
  logBytes: number | null;
};

export type NumericShadowMonitorReadResult = {
  snapshot: NumericShadowMonitorSnapshot | null;
  error: string | null;
};

export async function getNumericShadowMonitorStatus(): Promise<NumericShadowMonitorReadResult> {
  const row = await prisma.appSetting.findUnique({
    where: { key: NUMERIC_SHADOW_MONITOR_APP_SETTING_KEY },
    select: { valueJson: true }
  });
  if (!row) return { snapshot: null, error: null };

  const parsed = numericShadowMonitorSnapshotSchema.safeParse(row.valueJson);
  if (!parsed.success) {
    return {
      snapshot: null,
      error: "The stored numeric shadow monitor status is invalid or from an unsupported version."
    };
  }
  return { snapshot: parsed.data, error: null };
}

export async function getDatabaseSizes(): Promise<DatabaseSizes> {
  async function sizeOf(client: PrismaClient): Promise<number> {
    const rows = await client.$queryRaw<Array<{ size: bigint }>>`
      SELECT pg_database_size(current_database()) AS size
    `;
    return Number(rows[0]?.size ?? 0n);
  }

  const primaryBytes = await sizeOf(prisma);
  const logBytes = isDedicatedLogDatabaseConfigured ? await sizeOf(logPrisma) : null;
  return { primaryBytes, logBytes };
}

export function formatDatabaseSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

export function queryToSearchParams(query: SignalsQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("tab", query.tab);
  if (query.messageId) params.set("messageId", String(query.messageId));
  if (query.action) params.set("action", query.action);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  params.set("limit", String(query.limit));
  return params;
}

function noticeLabel(notice: NoticeSummary | null, messageId: number | null): string {
  if (!notice) return messageId == null ? "" : String(messageId);
  return `${notice.issuerSign || notice.issuerName}: ${notice.title}`;
}

function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(","))
  ].join("\n");
}

export async function getSignalsCsv(query: SignalsQuery): Promise<string> {
  const result = await getSignalsData(query);
  const { data } = result;

  if (data.tab === "feedback") {
    return toCsv(
      [
        "created_at",
        "message_id",
        "version",
        "notice",
        "text",
        "event_id",
        "prompt_version",
        "model",
        "action_source"
      ],
      data.rows.map((row) => [
        row.createdAt,
        row.messageId,
        row.version,
        noticeLabel(row.notice, row.messageId),
        row.text,
        row.eventId,
        row.promptVersion,
        row.model,
        row.actionSource
      ])
    );
  }

  if (data.tab === "edits") {
    return toCsv(
      [
        "copied_at",
        "message_id",
        "notice",
        "has_edits",
        "original_title",
        "edited_title",
        "original_body",
        "edited_body",
        "event_id",
        "prompt_version",
        "model",
        "action_source"
      ],
      data.rows.map((row) => [
        row.copiedAt,
        row.messageId,
        noticeLabel(row.notice, row.messageId),
        row.hasEdits,
        row.originalTitle,
        row.editedTitle,
        row.originalBody,
        row.editedBody,
        row.eventId,
        row.promptVersion,
        row.model,
        row.actionSource
      ])
    );
  }

  if (data.tab === "titles") {
    return toCsv(
      [
        "created_at",
        "message_id",
        "notice",
        "action",
        "current_title",
        "selected_title",
        "selected_index",
        "selected_was_original",
        "suggestions",
        "event_id",
        "prompt_version",
        "model",
        "action_source"
      ],
      data.rows.map((row) => [
        row.createdAt,
        row.messageId,
        noticeLabel(row.notice, row.messageId),
        row.action,
        row.currentTitle,
        row.selectedTitle,
        row.selectedIndex,
        row.selectedWasOriginal,
        row.suggestions.join(" | "),
        row.eventId,
        row.promptVersion,
        row.model,
        row.actionSource
      ])
    );
  }

  if (data.tab === "events") {
    return toCsv(
      [
        "created_at",
        "source_db",
        "message_id",
        "version",
        "notice",
        "action",
        "action_source",
        "has_client_event_id",
        "has_editor_id_hash",
        "has_session_id_hash",
        "rewrite_id",
        "prompt_version",
        "model",
        "payload_json"
      ],
      data.rows.map((row) => [
        row.createdAt,
        row.sourceDb,
        row.messageId,
        row.version,
        noticeLabel(row.notice, row.messageId),
        row.action,
        row.actionSource,
        row.hasClientEventId,
        row.hasEditorIdHash,
        row.hasSessionIdHash,
        row.rewriteId,
        row.promptVersion,
        row.model,
        jsonText(row.payloadJson)
      ])
    );
  }

  return toCsv(
    [
      "requested_at",
      "source_db",
      "message_id",
      "version",
      "notice",
      "reason",
      "status",
      "job_id",
      "job_name",
      "user_instruction",
      "model",
      "prompt_version",
      "prompt_chars",
      "reasoning_override",
      "model_call_count",
      "api_attempt_count",
      "input_tokens",
      "cached_input_tokens",
      "cache_write_input_tokens",
      "output_tokens",
      "reasoning_tokens",
      "total_tokens",
      "model_calls",
      "reference_check_summary",
      "reference_check_json",
      "output_json",
      "validation_json",
      "started_at",
      "finished_at",
      "error_text",
      "error_group",
      "error_group_count"
    ],
    data.rows.map((row) => [
      row.requestedAt,
      row.sourceDb,
      row.messageId,
      row.version,
      noticeLabel(row.notice, row.messageId),
      row.reason,
      row.status,
      row.jobId,
      row.jobName,
      row.userInstruction,
      row.model,
      row.promptVersion,
      row.promptChars,
      row.reasoningEffortOverride,
      row.modelCallCount,
      row.modelCallAttemptCount,
      row.modelCallUsage?.inputTokens ?? null,
      row.modelCallUsage?.cachedInputTokens ?? null,
      row.modelCallUsage?.cacheWriteInputTokens ?? null,
      row.modelCallUsage?.outputTokens ?? null,
      row.modelCallUsage?.reasoningTokens ?? null,
      row.modelCallUsage?.totalTokens ?? null,
      jsonText(row.modelCalls as unknown as Prisma.JsonValue),
      row.referenceCheck?.summary ?? null,
      jsonText(row.referenceCheck?.detailJson ?? null),
      jsonText(row.outputJson),
      jsonText(row.validationJson),
      row.startedAt,
      row.finishedAt,
      row.errorText,
      row.errorGroup,
      row.errorGroupCount
    ])
  );
}

export function previewJson(value: Prisma.JsonValue | null): string {
  return truncate(jsonText(value), 420);
}
