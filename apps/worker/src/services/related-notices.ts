import {
  extractNoticeReferences,
  type NoticeReference,
  type RelatedNoticePayload,
  type RelatedNoticeRelation
} from "@newsweb/prompt-kit";
import type { PrismaClient } from "@prisma/client";
import {
  buildNewswebListUrlForRange,
  fetchNewswebListMessages,
  fetchNewswebMessage
} from "./newsweb-client.js";
import { normalizeGuardrailText } from "./text-normalization.js";

// The production default. The RELATED_NOTICE_CONTEXT env is the emergency
// kill-switch only; this constant is what a release flip changes. "sibling"
// (parallel notices about one event) is Phase B and stays off until its own
// replay evidence lands.
export const defaultEnabledRelatedNoticeRelations: readonly RelatedNoticeRelation[] =
  ["reference", "correction"];

export const RELATED_NOTICE_MAX_COUNT = 2;
export const RELATED_NOTICE_MAX_TEXT_CHARS = 6_000;
const RELATED_NOTICE_TRUNCATION_MARKER = "\n\n[... teksten er avkortet ...]";
// Minimum overlap between the cited topic and a candidate title/lead when
// more than one same-issuer notice exists on the cited day, plus the margin
// the winner must keep over the runner-up. Below either → ambiguous, nothing
// attached (a wrong earlier notice is worse than none).
const MIN_ACCEPT_SCORE = 0.35;
const MIN_ACCEPT_MARGIN = 0.15;
// Undated formula references ("Reference is made to the notice ... related to
// the contemplated private placement") search the previous week and must
// match the topic clearly, since there is no date to anchor on.
const UNDATED_WINDOW_DAYS = 7;
const UNDATED_MIN_ACCEPT_SCORE = 0.5;
const UNDATED_MIN_ACCEPT_MARGIN = 0.2;
const DATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const BILINGUAL_PAIR_WINDOW_MS = 10_000;

export type RelatedNoticeCandidate = {
  messageId: number;
  title: string;
  issuerName: string;
  issuerSign: string;
  publishedAt: Date;
  bodyText: string;
};

export type RelatedNoticeSource = {
  messageId: number;
  issuerName: string;
  issuerSign: string;
  publishedAt: Date;
  bodyText: string;
  rawMessageJson: unknown;
};

export type RelatedNoticeStore = {
  findByIssuerAndDate(args: {
    issuerSign: string;
    excludeMessageId: number;
    from: Date;
    to: Date;
    before: Date;
  }): Promise<RelatedNoticeCandidate[]>;
  findByMessageId(messageId: number): Promise<RelatedNoticeCandidate | null>;
};

export type RelatedNoticeNewswebClient = {
  /** Calendar dates (YYYY-MM-DD), inclusive; `toDate` defaults to `fromDate`. */
  listByDate(fromDate: string, toDate?: string): Promise<
    Array<{
      messageId: number;
      title: string;
      issuerName: string;
      issuerSign: string | null;
      publishedTime: string;
    }>
  >;
  fetchMessage(messageId: number): Promise<RelatedNoticeCandidate | null>;
};

export type RelatedNoticeUnresolvedReason =
  | "no-candidate"
  | "ambiguous"
  | "fetch-failed"
  | "self"
  | "disabled";

export type RelatedNoticeTelemetry = {
  enabledRelations: RelatedNoticeRelation[];
  references: Array<{
    raw: string;
    date: string | null;
    topic: string | null;
    messageId?: number;
  }>;
  resolved: Array<{
    messageId: number;
    relation: RelatedNoticeRelation;
    resolvedBy: "db" | "newsweb";
    score: number;
    publishedAt: string;
    textChars: number;
    title: string;
  }>;
  unresolved: Array<{ raw: string; reason: RelatedNoticeUnresolvedReason }>;
  durationMs: number;
};

export type RelatedNoticeResolution = {
  related: RelatedNoticePayload[];
  telemetry: RelatedNoticeTelemetry;
};

const relatedNoticeSelect = {
  messageId: true,
  title: true,
  issuerName: true,
  issuerSign: true,
  publishedAt: true,
  bodyText: true
} as const;

/** Store adapter over source_notices (indexes: issuer_sign, published_at). */
export function createPrismaRelatedNoticeStore(
  prisma: Pick<PrismaClient, "sourceNotice">
): RelatedNoticeStore {
  return {
    async findByIssuerAndDate({ issuerSign, excludeMessageId, from, to, before }) {
      return prisma.sourceNotice.findMany({
        where: {
          issuerSign,
          messageId: { not: excludeMessageId },
          publishedAt: { gte: from, lte: to, lt: before }
        },
        select: relatedNoticeSelect,
        orderBy: { publishedAt: "asc" },
        take: 12
      });
    },
    async findByMessageId(messageId) {
      return prisma.sourceNotice.findUnique({
        where: { messageId },
        select: relatedNoticeSelect
      });
    }
  };
}

/** A store with nothing in it: forces the Newsweb path (offline enrichment). */
export const emptyRelatedNoticeStore: RelatedNoticeStore = {
  async findByIssuerAndDate() {
    return [];
  },
  async findByMessageId() {
    return null;
  }
};

/** Newsweb adapter: list a calendar day, fetch one message body. */
export function createNewswebRelatedNoticeClient(
  fetchImpl: typeof fetch = fetch
): RelatedNoticeNewswebClient {
  return {
    async listByDate(fromDate, toDate = fromDate) {
      const messages = await fetchNewswebListMessages(
        buildNewswebListUrlForRange(fromDate, toDate),
        fetchImpl
      );
      return messages.map((message) => ({
        messageId: message.messageId,
        title: message.title,
        issuerName: message.issuerName,
        issuerSign: message.issuerSign ?? null,
        publishedTime: message.publishedTime
      }));
    },
    async fetchMessage(messageId) {
      const details = await fetchNewswebMessage(messageId, fetchImpl);
      const message = details.message;
      if (!message.issuerSign || !message.publishedTime) {
        return null;
      }
      return {
        messageId: message.messageId,
        title: message.title,
        issuerName: message.issuerName ?? message.issuerSign,
        issuerSign: message.issuerSign,
        publishedAt: new Date(message.publishedTime),
        bodyText: details.bodyText
      };
    }
  };
}

export function emptyRelatedNoticeTelemetry(
  enabledRelations: readonly RelatedNoticeRelation[]
): RelatedNoticeTelemetry {
  return {
    enabledRelations: [...enabledRelations],
    references: [],
    resolved: [],
    unresolved: [],
    durationMs: 0
  };
}

const TAIL_PATTERNS = [
  /\bfor (?:further|more|additional) (?:information|queries|details|enquiries)\b/i,
  /\bfor (?:mer|ytterligere|nærmere) informasjon\b/i,
  /\b(?:kontaktpersoner?|kontaktinformasjon|contacts?|contact persons?)\s*:/i,
  /\bthis information is subject to (?:the )?disclosure/i,
  /\bthis (?:stock exchange )?announcement (?:was|is) (?:published|made) by\b/i,
  /\bdenne (?:opplysningen|meldingen|informasjonen) er informasjonspliktig\b/i,
  /\bdenne børsmeldingen ble (?:publisert|offentliggjort) av\b/i,
  /\babout (?:the company|[A-ZÆØÅ][\w.&-]+(?: [A-ZÆØÅ][\w.&-]+)?)\s*:?\s*\n/,
  /\bom (?:selskapet|[A-ZÆØÅ][\w.&-]+(?: [A-ZÆØÅ][\w.&-]+)?)\s*:?\s*\n/,
  /\bimportant (?:notice|information)\b/i,
  /\bdisclaimer\b/i
];
const MIN_KEEP_CHARS_BEFORE_TAIL = 200;

/**
 * Drops the contact / disclaimer tail of a notice and caps the length. The
 * tail is only cut when enough substantive text precedes it, so a short
 * notice is never truncated to nothing.
 */
export function trimRelatedNoticeText(
  text: string,
  maxChars = RELATED_NOTICE_MAX_TEXT_CHARS
): string {
  let cut = text.trim();
  let tailIndex = -1;
  for (const pattern of TAIL_PATTERNS) {
    const match = pattern.exec(cut);
    if (
      match &&
      match.index >= MIN_KEEP_CHARS_BEFORE_TAIL &&
      (tailIndex === -1 || match.index < tailIndex)
    ) {
      tailIndex = match.index;
    }
  }
  if (tailIndex > 0) {
    cut = cut.slice(0, tailIndex).trim();
  }
  if (cut.length > maxChars) {
    cut = `${cut.slice(0, maxChars).trimEnd()}${RELATED_NOTICE_TRUNCATION_MARKER}`;
  }
  return cut;
}

const TOPIC_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "regarding",
  "concerning",
  "company",
  "companys",
  "its",
  "asa",
  "ltd",
  "limited",
  "plc",
  "announcement",
  "notice",
  "release",
  "published",
  "stock",
  "exchange",
  "shares",
  "share",
  "new",
  "det",
  "den",
  "som",
  "med",
  "til",
  "fra",
  "ved",
  "vedrorende",
  "angaende",
  "selskapet",
  "selskapets",
  "borsmelding",
  "melding",
  "meldingen",
  "aksjer",
  "aksje",
  "nye",
  "har",
  "ble",
  "vil",
  "skal",
  "har",
  "sin",
  "sitt",
  "sine",
  "on",
  "of",
  "in",
  "to",
  "by",
  "a",
  "an",
  "en",
  "et",
  "og",
  "av",
  "om",
  "i",
  "pa"
]);

function topicTokens(text: string): Set<string> {
  return new Set(
    normalizeGuardrailText(text)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !TOPIC_STOPWORDS.has(token))
  );
}

/** Token overlap between the cited topic and a candidate's title + lead. */
export function scoreRelatedNoticeCandidate(
  topic: string | null,
  candidate: Pick<RelatedNoticeCandidate, "title" | "bodyText">
): number {
  if (!topic) return 0;
  const wanted = topicTokens(topic);
  if (wanted.size === 0) return 0;
  const haystack = topicTokens(
    `${candidate.title}\n${candidate.bodyText.slice(0, 300)}`
  );
  let hits = 0;
  for (const token of wanted) {
    if (haystack.has(token)) hits += 1;
  }
  return Math.round((hits / wanted.size) * 100) / 100;
}

const NORWEGIAN_FUNCTION_WORDS =
  /\b(?:og|til|av|for|med|som|det|er|ikke|har|skal|vil|fra|ved|denne|selskapet)\b/gi;
const ENGLISH_FUNCTION_WORDS =
  /\b(?:the|and|of|to|for|with|that|is|not|has|will|from|by|this|company)\b/gi;

export function detectNoticeLanguage(text: string): "no" | "en" | "unknown" {
  const sample = text.slice(0, 800);
  const norwegian = (sample.match(NORWEGIAN_FUNCTION_WORDS) ?? []).length;
  const english = (sample.match(ENGLISH_FUNCTION_WORDS) ?? []).length;
  if (norwegian === english) return "unknown";
  return norwegian > english ? "no" : "en";
}

/**
 * Newsweb publishes many notices as NO/EN pairs seconds apart. Keep one per
 * pair, preferring the candidate written in the same language as the new
 * notice so the model reads the version it can quote naturally.
 */
export function dedupeBilingualCandidates(
  candidates: RelatedNoticeCandidate[],
  preferredLanguage: "no" | "en" | "unknown"
): RelatedNoticeCandidate[] {
  const sorted = [...candidates].sort(
    (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime()
  );
  const kept: RelatedNoticeCandidate[] = [];
  for (const candidate of sorted) {
    const pairIndex = kept.findIndex(
      (existing) =>
        existing.issuerSign === candidate.issuerSign &&
        Math.abs(existing.publishedAt.getTime() - candidate.publishedAt.getTime()) <=
          BILINGUAL_PAIR_WINDOW_MS
    );
    if (pairIndex === -1) {
      kept.push(candidate);
      continue;
    }
    const existing = kept[pairIndex];
    if (
      preferredLanguage !== "unknown" &&
      detectNoticeLanguage(existing.bodyText) !== preferredLanguage &&
      detectNoticeLanguage(candidate.bodyText) === preferredLanguage
    ) {
      kept[pairIndex] = candidate;
    }
  }
  return kept;
}

function parseIsoDate(date: string): Date | null {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function correctionTargetFromRaw(rawMessageJson: unknown): number | null {
  if (!rawMessageJson || typeof rawMessageJson !== "object") return null;
  const value = (rawMessageJson as Record<string, unknown>).correctionForMessageId;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function toPayload(
  candidate: RelatedNoticeCandidate,
  relation: RelatedNoticeRelation,
  resolvedBy: "db" | "newsweb",
  score: number
): RelatedNoticePayload | null {
  const text = trimRelatedNoticeText(candidate.bodyText);
  if (!text) return null;
  return {
    messageId: candidate.messageId,
    relation,
    title: candidate.title,
    issuerName: candidate.issuerName,
    issuerSign: candidate.issuerSign,
    publishedAt: candidate.publishedAt.toISOString(),
    text,
    textChars: text.length,
    resolvedBy,
    score
  };
}

type Pick_ = {
  candidate: RelatedNoticeCandidate;
  resolvedBy: "db" | "newsweb";
  score: number;
};

function pickCandidate(
  reference: NoticeReference,
  candidates: RelatedNoticeCandidate[],
  preferredLanguage: "no" | "en" | "unknown",
  mode: "dated" | "undated" = "dated"
): { pick: RelatedNoticeCandidate; score: number } | { reason: "no-candidate" | "ambiguous" } {
  const deduped = dedupeBilingualCandidates(candidates, preferredLanguage);
  if (deduped.length === 0) return { reason: "no-candidate" };
  const scored = deduped
    .map((candidate) => ({
      candidate,
      score: scoreRelatedNoticeCandidate(reference.topic, candidate)
    }))
    .sort((a, b) => b.score - a.score);
  const minScore = mode === "undated" ? UNDATED_MIN_ACCEPT_SCORE : MIN_ACCEPT_SCORE;
  const minMargin = mode === "undated" ? UNDATED_MIN_ACCEPT_MARGIN : MIN_ACCEPT_MARGIN;
  if (scored.length === 1) {
    // A lone notice on the cited day is the citation; without a date the
    // topic alone has to carry it.
    return mode === "dated" || scored[0].score >= minScore
      ? { pick: scored[0].candidate, score: scored[0].score }
      : { reason: "ambiguous" };
  }
  const [best, runnerUp] = scored;
  if (best.score >= minScore && best.score - runnerUp.score >= minMargin) {
    return { pick: best.candidate, score: best.score };
  }
  return { reason: "ambiguous" };
}

function isoDateOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function resolveRelatedNotices(
  source: RelatedNoticeSource,
  options: {
    enabledRelations: readonly RelatedNoticeRelation[];
    store: RelatedNoticeStore;
    newsweb?: RelatedNoticeNewswebClient | null;
    maxNotices?: number;
  }
): Promise<RelatedNoticeResolution> {
  const startedAt = Date.now();
  const enabled = new Set(options.enabledRelations);
  const telemetry = emptyRelatedNoticeTelemetry(options.enabledRelations);
  const maxNotices = options.maxNotices ?? RELATED_NOTICE_MAX_COUNT;
  const related: RelatedNoticePayload[] = [];
  const seen = new Set<number>([source.messageId]);
  const preferredLanguage = detectNoticeLanguage(source.bodyText);

  const finish = (): RelatedNoticeResolution => {
    telemetry.durationMs = Date.now() - startedAt;
    return { related, telemetry };
  };

  const accept = (pick: Pick_, relation: RelatedNoticeRelation): boolean => {
    if (seen.has(pick.candidate.messageId)) return false;
    const payload = toPayload(pick.candidate, relation, pick.resolvedBy, pick.score);
    if (!payload) return false;
    seen.add(pick.candidate.messageId);
    related.push(payload);
    telemetry.resolved.push({
      messageId: payload.messageId,
      relation,
      resolvedBy: pick.resolvedBy,
      score: pick.score,
      publishedAt: payload.publishedAt,
      textChars: payload.textChars,
      title: payload.title
    });
    return true;
  };

  const fetchById = async (
    messageId: number
  ): Promise<Pick_ | { reason: RelatedNoticeUnresolvedReason }> => {
    try {
      const stored = await options.store.findByMessageId(messageId);
      if (stored) return { candidate: stored, resolvedBy: "db", score: 1 };
    } catch {
      // fall through to Newsweb
    }
    if (!options.newsweb) return { reason: "no-candidate" };
    try {
      const fetched = await options.newsweb.fetchMessage(messageId);
      return fetched
        ? { candidate: fetched, resolvedBy: "newsweb", score: 1 }
        : { reason: "no-candidate" };
    } catch {
      return { reason: "fetch-failed" };
    }
  };

  if (enabled.size === 0) {
    return finish();
  }

  // 1. Correction target from the raw Newsweb message.
  const correctionTarget = correctionTargetFromRaw(source.rawMessageJson);
  if (correctionTarget && enabled.has("correction")) {
    const raw = `correctionForMessageId=${correctionTarget}`;
    telemetry.references.push({ raw, date: null, topic: null, messageId: correctionTarget });
    if (correctionTarget === source.messageId) {
      telemetry.unresolved.push({ raw, reason: "self" });
    } else {
      const result = await fetchById(correctionTarget);
      if ("reason" in result) {
        telemetry.unresolved.push({ raw, reason: result.reason });
      } else if (related.length < maxNotices) {
        accept(result, "correction");
      }
    }
  }

  // 2. Explicit references in the notice body.
  if (!enabled.has("reference")) {
    return finish();
  }
  let references: NoticeReference[] = [];
  try {
    references = extractNoticeReferences(source.bodyText, {
      publishedAt: source.publishedAt.toISOString(),
      includeUndated: true
    });
  } catch {
    references = [];
  }

  for (const reference of references) {
    if (related.length >= maxNotices) break;
    telemetry.references.push({
      raw: reference.raw,
      date: reference.date,
      topic: reference.topic,
      ...(reference.messageId !== undefined ? { messageId: reference.messageId } : {})
    });

    if (reference.messageId !== undefined) {
      if (reference.messageId === source.messageId) {
        telemetry.unresolved.push({ raw: reference.raw, reason: "self" });
        continue;
      }
      const result = await fetchById(reference.messageId);
      if ("reason" in result) {
        telemetry.unresolved.push({ raw: reference.raw, reason: result.reason });
      } else {
        accept(result, "reference");
      }
      continue;
    }

    const citedDate = reference.date ? parseIsoDate(reference.date) : null;
    const mode: "dated" | "undated" = citedDate ? "dated" : "undated";
    if (!citedDate && !reference.topic) {
      telemetry.unresolved.push({ raw: reference.raw, reason: "no-candidate" });
      continue;
    }
    const from = citedDate
      ? new Date(citedDate.getTime() - DATE_WINDOW_MS)
      : new Date(source.publishedAt.getTime() - UNDATED_WINDOW_DAYS * DATE_WINDOW_MS);
    const to = citedDate
      ? new Date(citedDate.getTime() + 2 * DATE_WINDOW_MS - 1)
      : source.publishedAt;
    const listFrom = citedDate ? (reference.date as string) : isoDateOf(from);
    const listTo = citedDate ? (reference.date as string) : isoDateOf(source.publishedAt);

    // 2a. Local database first.
    let dbCandidates: RelatedNoticeCandidate[] = [];
    let dbFailed = false;
    try {
      dbCandidates = (
        await options.store.findByIssuerAndDate({
          issuerSign: source.issuerSign,
          excludeMessageId: source.messageId,
          from,
          to,
          before: source.publishedAt
        })
      ).filter((candidate) => !seen.has(candidate.messageId));
    } catch {
      dbFailed = true;
    }
    if (dbCandidates.length > 0) {
      const picked = pickCandidate(reference, dbCandidates, preferredLanguage, mode);
      if ("pick" in picked) {
        accept({ candidate: picked.pick, resolvedBy: "db", score: picked.score }, "reference");
      } else {
        telemetry.unresolved.push({ raw: reference.raw, reason: picked.reason });
      }
      continue;
    }

    // 2b. Newsweb fallback for notices older than the local database.
    if (!options.newsweb) {
      telemetry.unresolved.push({
        raw: reference.raw,
        reason: dbFailed ? "fetch-failed" : "no-candidate"
      });
      continue;
    }
    try {
      const listed = (await options.newsweb.listByDate(listFrom, listTo)).filter(
        (item) =>
          item.issuerSign === source.issuerSign &&
          item.messageId !== source.messageId &&
          !seen.has(item.messageId) &&
          new Date(item.publishedTime).getTime() < source.publishedAt.getTime()
      );
      if (listed.length === 0) {
        telemetry.unresolved.push({ raw: reference.raw, reason: "no-candidate" });
        continue;
      }
      // Fetch bodies only for the few most title-relevant listed candidates.
      const ranked = [...listed].sort(
        (a, b) =>
          scoreRelatedNoticeCandidate(reference.topic, { title: b.title, bodyText: "" }) -
          scoreRelatedNoticeCandidate(reference.topic, { title: a.title, bodyText: "" })
      );
      const fetched: RelatedNoticeCandidate[] = [];
      for (const item of ranked.slice(0, 6)) {
        const candidate = await options.newsweb.fetchMessage(item.messageId);
        if (candidate) fetched.push(candidate);
      }
      const picked = pickCandidate(reference, fetched, preferredLanguage, mode);
      if ("pick" in picked) {
        accept(
          { candidate: picked.pick, resolvedBy: "newsweb", score: picked.score },
          "reference"
        );
      } else {
        telemetry.unresolved.push({ raw: reference.raw, reason: picked.reason });
      }
    } catch {
      telemetry.unresolved.push({ raw: reference.raw, reason: "fetch-failed" });
    }
  }

  // Corrections carry the strongest signal and are listed first; references
  // keep document order.
  related.sort((a, b) => {
    if (a.relation === b.relation) return 0;
    return a.relation === "correction" ? -1 : b.relation === "correction" ? 1 : 0;
  });
  return finish();
}
