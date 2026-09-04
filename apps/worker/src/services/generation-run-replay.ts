import {
  collectNumberTokens,
  parseNumberToken,
  relatedNoticeRelations,
  type PromptPayload,
  type RelatedNoticePayload,
  type RelatedNoticeRelation,
  type SupplementalMaterialPayload
} from "@newsweb/prompt-kit";
import { rewriteOutputSchema, type RewriteOutput } from "@newsweb/shared";
import { buildNoticeEvidence, noticeReferencePayload, type NoticePayload } from "./notice-evidence.js";

// Replaying a stored generation run against the current validators requires
// reconstructing exactly what the worker validated at the time:
//  - the stored rewrite output, which failed rows wrap as
//    output_json.blockedRewrite (worker rewriteJsonForValidation);
//  - the validation payload, which for report flows is NOT the raw
//    sourcePayload but the reportReferencePayload join (worker.ts), with
//    validation_json.reportExtraction.validationSourceChars persisted as the
//    per-row tripwire. Versioned notice pipelines instead use their shared
//    source builder, with the stored audit hash checking source identity.
// This module is the single implementation of both reconstructions; the
// safety-fixture seeder and the offline replay-numbers harness share it.

export type GenerationRunReplayRow = {
  id?: unknown;
  messageId?: unknown;
  promptVersion?: unknown;
  requestedAt?: unknown;
  sourcePayload?: unknown;
  outputJson?: unknown;
  validationJson?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function storedRewriteOutputFromRow(row: {
  outputJson?: unknown;
  validationJson?: unknown;
}): RewriteOutput | null {
  const storedOutput = rewriteOutputSchema.safeParse(row.outputJson);
  if (storedOutput.success) return storedOutput.data;

  // Validation-blocked rows wrap the full rejected rewrite as
  // output_json.blockedRewrite (since 2026-05-29, before the corpus window);
  // it preserves key_facts/source_spans/source_limitations exactly as the
  // validator saw them.
  const blockedRewrite = rewriteOutputSchema.safeParse(
    asRecord(row.outputJson)?.blockedRewrite
  );
  if (blockedRewrite.success) return blockedRewrite.data;

  // Last resort: the worker keeps the rejected visible article fields in
  // validation_json.hiddenDraft.
  return hiddenDraftRewriteOutputFromRow(row);
}

// Published number-strip rows must use this directly: their outputJson parses
// successfully as the POST-strip published rewrite, so storedRewriteOutputFromRow
// would never reach the hiddenDraft. Hydrates only the non-visible schema
// fields, with number-free values so replay stays deterministic.
export function hiddenDraftRewriteOutputFromRow(row: {
  validationJson?: unknown;
}): RewriteOutput | null {
  const hiddenDraft = asRecord(asRecord(row.validationJson)?.hiddenDraft);
  if (!hiddenDraft) return null;
  const replayOutput = rewriteOutputSchema.safeParse({
    ...hiddenDraft,
    key_facts: ["Fixture replay placeholder"],
    negative_or_surprising: [],
    excluded_hype: [],
    source_limitations: [],
    confidence: "medium",
    importance: "medium",
    source_spans: ["Fixture replay source span"]
  });
  return replayOutput.success ? replayOutput.data : null;
}

const REPORT_PAYLOAD_MARKER_KEYS = [
  "reportText",
  "reportPageCount",
  "letterText",
  "remunerationText"
] as const;

export function isReportSourcePayload(
  sourcePayload: Record<string, unknown>
): boolean {
  return REPORT_PAYLOAD_MARKER_KEYS.some((key) => key in sourcePayload);
}

function supplementalMaterialsFromPayload(
  value: unknown
): SupplementalMaterialPayload[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const materials: SupplementalMaterialPayload[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (
      !record ||
      typeof record.id !== "string" ||
      typeof record.sourceId !== "string" ||
      typeof record.kind !== "string" ||
      typeof record.title !== "string" ||
      typeof record.text !== "string"
    ) {
      return null;
    }
    materials.push({
      id: record.id,
      sourceId: record.sourceId,
      kind: record.kind,
      title: record.title,
      text: record.text,
      ...(typeof record.url === "string" || record.url === null
        ? { url: record.url }
        : {}),
      ...(typeof record.textChars === "number"
        ? { textChars: record.textChars }
        : {})
    });
  }
  return materials;
}

export function relatedNoticesFromPayload(
  value: unknown
): RelatedNoticePayload[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const notices: RelatedNoticePayload[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (
      !record ||
      typeof record.messageId !== "number" ||
      typeof record.relation !== "string" ||
      !(relatedNoticeRelations as readonly string[]).includes(record.relation) ||
      typeof record.title !== "string" ||
      typeof record.issuerName !== "string" ||
      typeof record.issuerSign !== "string" ||
      typeof record.publishedAt !== "string" ||
      typeof record.text !== "string"
    ) {
      return null;
    }
    notices.push({
      messageId: record.messageId,
      relation: record.relation as RelatedNoticeRelation,
      title: record.title,
      issuerName: record.issuerName,
      issuerSign: record.issuerSign,
      publishedAt: record.publishedAt,
      text: record.text,
      textChars:
        typeof record.textChars === "number" ? record.textChars : record.text.length,
      resolvedBy: record.resolvedBy === "newsweb" ? "newsweb" : "db",
      score: typeof record.score === "number" ? record.score : 0
    });
  }
  return notices;
}

function basePayloadFromSource(
  sourcePayload: Record<string, unknown>
): PromptPayload | null {
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
  const supplementalMaterials = supplementalMaterialsFromPayload(
    sourcePayload.supplementalMaterials
  );
  if (supplementalMaterials === null) {
    return null;
  }
  const relatedNotices = relatedNoticesFromPayload(sourcePayload.relatedNotices);
  if (relatedNotices === null) {
    return null;
  }
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
    sourceBodyChars:
      typeof sourcePayload.sourceBodyChars === "number"
        ? sourcePayload.sourceBodyChars
        : sourcePayload.bodyText.length,
    ...(sourcePayload.outputMode === "notice" ||
    sourcePayload.outputMode === "extended_notice"
      ? { outputMode: sourcePayload.outputMode }
      : {}),
    ...(typeof sourcePayload.maxVisibleArticleChars === "number"
      ? { maxVisibleArticleChars: sourcePayload.maxVisibleArticleChars }
      : {}),
    ...(supplementalMaterials !== undefined ? { supplementalMaterials } : {}),
    ...(relatedNotices !== undefined ? { relatedNotices } : {}),
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

export type ReplayValidationPayload = {
  flow: "regular" | "report";
  payload: PromptPayload;
  // true/false only for report rows that persisted the
  // reportExtraction.validationSourceChars tripwire; null when the tripwire
  // is absent (all regular rows, plus report rows predating its persistence).
  validationSourceCharsMatch: boolean | null;
};

function noticePayloadFromSource(sourcePayload: Record<string, unknown>): NoticePayload | null {
  const base = basePayloadFromSource(sourcePayload);
  if (!base) return null;
  for (const key of ["reportText", "reportReferenceText"] as const) {
    if (sourcePayload[key] !== undefined && typeof sourcePayload[key] !== "string") return null;
  }
  for (const key of ["letterText", "remunerationText"] as const) {
    if (sourcePayload[key] !== undefined && sourcePayload[key] !== null && typeof sourcePayload[key] !== "string") return null;
  }
  const completeness = sourcePayload.reportCompleteness;
  if (completeness !== undefined && completeness !== "complete" && completeness !== "partial" && completeness !== "insufficient") return null;
  return {
    ...base,
    ...(typeof sourcePayload.reportText === "string" ? { reportText: sourcePayload.reportText } : {}),
    ...(typeof sourcePayload.reportReferenceText === "string" ? { reportReferenceText: sourcePayload.reportReferenceText } : {}),
    ...(typeof sourcePayload.letterText === "string" || sourcePayload.letterText === null ? { letterText: sourcePayload.letterText } : {}),
    ...(typeof sourcePayload.remunerationText === "string" || sourcePayload.remunerationText === null ? { remunerationText: sourcePayload.remunerationText } : {}),
    ...(completeness !== undefined ? { reportCompleteness: completeness } : {})
  };
}

function replayNoticePipelineV1(
  sourcePayload: Record<string, unknown>, validationJson: unknown, audit: Record<string, unknown> | null
): ReplayValidationPayload | null {
  const source = noticePayloadFromSource(sourcePayload);
  if (!source) return null;
  try {
    const evidence = buildNoticeEvidence(source);
    if (audit?.sourceSha256 !== undefined && audit.sourceSha256 !== evidence.sha256) return null;
    const payload = noticeReferencePayload(source);
    const validationSourceChars = asRecord(asRecord(validationJson)?.reportExtraction)?.validationSourceChars;
    return {
      flow: isReportSourcePayload(sourcePayload) || "reportReferenceText" in sourcePayload ? "report" : "regular",
      payload,
      validationSourceCharsMatch: typeof validationSourceChars === "number" ? payload.bodyText.length === validationSourceChars : null
    };
  } catch {
    // Duplicate source IDs or malformed source evidence must not silently
    // fall back to the historical join and produce a misleading replay.
    return null;
  }
}

export function replayValidationPayloadFromRow(row: {
  sourcePayload?: unknown;
  validationJson?: unknown;
}): ReplayValidationPayload | null {
  const sourcePayload = asRecord(row.sourcePayload);
  if (!sourcePayload) return null;

  const noticeAudit = asRecord(asRecord(row.validationJson)?.noticePipeline);
  const pipelineVersion = noticeAudit?.version;
  if (pipelineVersion !== undefined || "reportReferenceText" in sourcePayload) {
    // Pin reconstruction to the source semantics of this version. A future
    // version needs its own explicit branch before historical rows are replayed.
    if (pipelineVersion !== undefined && pipelineVersion !== "notice-pipeline-v1") return null;
    return replayNoticePipelineV1(sourcePayload, row.validationJson, noticeAudit);
  }

  if (!isReportSourcePayload(sourcePayload)) {
    const payload = basePayloadFromSource(sourcePayload);
    return payload
      ? { flow: "regular", payload, validationSourceCharsMatch: null }
      : null;
  }

  const base = basePayloadFromSource(sourcePayload);
  if (!base || typeof sourcePayload.reportText !== "string") {
    return null;
  }
  // Mirrors worker.ts reportReferencePayload exactly, including the
  // filter(Boolean) semantics: a body below 100 trimmed chars is dropped
  // entirely, so the joined text starts at the report text with no leading
  // separator. reportContent.referenceText || reportContent.text equals the
  // payload's reportText at both production construction sites.
  const reportReferenceText = [
    base.bodyText && base.bodyText.trim().length >= 100 ? base.bodyText : "",
    sourcePayload.reportText
  ]
    .filter(Boolean)
    .join("\n\n");
  const payload: PromptPayload = {
    ...base,
    bodyText: reportReferenceText,
    sourceBodyChars: reportReferenceText.length
  };

  const reportExtraction = asRecord(
    asRecord(row.validationJson)?.reportExtraction
  );
  const validationSourceChars = reportExtraction?.validationSourceChars;
  const validationSourceCharsMatch =
    typeof validationSourceChars === "number"
      ? reportReferenceText.length === validationSourceChars
      : null;

  return { flow: "report", payload, validationSourceCharsMatch };
}

const UNEXPECTED_NUMBERS_MESSAGE_PREFIX = "Unexpected numbers: ";

export type StoredUnexpectedNumbers = {
  displays: string[];
  raw: string;
};

// Parses the stored UNEXPECTED_NUMBERS issue message. The message format is
// fixed (`Unexpected numbers: ${displays.join(", ")}`) and number displays
// cannot contain ", ", so the split is unambiguous; callers should still
// compare both the display sets and the raw string and route disagreements
// into a fidelity bucket rather than trusting either side blindly.
export function storedUnexpectedNumberDisplays(
  validationJson: unknown
): StoredUnexpectedNumbers | null {
  const validation = asRecord(validationJson);
  if (!Array.isArray(validation?.issues)) return null;
  for (const issue of validation.issues) {
    const record = asRecord(issue);
    if (record?.code !== "UNEXPECTED_NUMBERS") continue;
    const message = record.message;
    if (
      typeof message !== "string" ||
      !message.startsWith(UNEXPECTED_NUMBERS_MESSAGE_PREFIX)
    ) {
      return null;
    }
    const raw = message.slice(UNEXPECTED_NUMBERS_MESSAGE_PREFIX.length);
    return { displays: raw.length > 0 ? raw.split(", ") : [], raw };
  }
  return null;
}

// Published rows persist the INITIAL draft's high-risk warnings in
// validation_json.validationRepair.initialWarnings; validation_json.issues on
// those rows describes the final (post-repair) rewrite and must not be used as
// draft ground truth.
export function storedRepairInitialUnexpectedNumbers(
  validationJson: unknown
): StoredUnexpectedNumbers | null {
  const repair = asRecord(asRecord(validationJson)?.validationRepair);
  if (!Array.isArray(repair?.initialWarnings)) return null;
  for (const warning of repair.initialWarnings) {
    if (
      typeof warning !== "string" ||
      !warning.startsWith(UNEXPECTED_NUMBERS_MESSAGE_PREFIX)
    ) {
      continue;
    }
    const raw = warning.slice(UNEXPECTED_NUMBERS_MESSAGE_PREFIX.length);
    return { displays: raw.length > 0 ? raw.split(", ") : [], raw };
  }
  return null;
}

function visibleArticleText(rewrite: RewriteOutput): string {
  return [rewrite.title, rewrite.lead, ...rewrite.body, rewrite.company_sentence]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
}

// Numbers present in the draft's visible article text but absent from the
// published one, compared by parsed key so pure separator restyling
// ("1.402.704" vs "1 402 704") does not count as stripped. Returns deduped
// sanitized displays aligned with NumberAssessment.display.
export function strippedNumberDisplays(
  draft: RewriteOutput,
  published: RewriteOutput
): string[] {
  const publishedKeys = new Set<string>();
  for (const token of collectNumberTokens(visibleArticleText(published))) {
    const parsed = parseNumberToken(token);
    if (parsed) publishedKeys.add(parsed.key);
  }
  const stripped = new Map<string, string>();
  for (const token of collectNumberTokens(visibleArticleText(draft))) {
    const parsed = parseNumberToken(token);
    if (!parsed || publishedKeys.has(parsed.key) || stripped.has(parsed.key)) {
      continue;
    }
    stripped.set(parsed.key, parsed.display);
  }
  return [...stripped.values()];
}

export type DigitVariantMatch = {
  variant: "digits_equal" | "digit_subrun";
  sourceDisplay: string;
};

// Matcher-gap scan: does the display's digit string exist in the validation
// source under SOME separator styling the assessment engine failed to bridge?
// Per-token only — never matches digits across token boundaries. digit_subrun
// (the display's digits inside a longer source token, i.e. a merged table run)
// requires >= 4 digits to bound coincidental hits.
export function findDigitVariantInSource(
  display: string,
  sourceText: string
): DigitVariantMatch | null {
  const parsed = parseNumberToken(display);
  const digits = (parsed?.display ?? display).replace(/\D/g, "");
  if (!digits) return null;
  let subrun: DigitVariantMatch | null = null;
  for (const token of collectNumberTokens(sourceText)) {
    const sourceParsed = parseNumberToken(token);
    if (!sourceParsed) continue;
    const sourceDigits = sourceParsed.display.replace(/\D/g, "");
    if (sourceDigits === digits) {
      return { variant: "digits_equal", sourceDisplay: sourceParsed.display };
    }
    if (
      !subrun &&
      digits.length >= 4 &&
      sourceDigits.length > digits.length &&
      sourceDigits.includes(digits)
    ) {
      subrun = { variant: "digit_subrun", sourceDisplay: sourceParsed.display };
    }
  }
  return subrun;
}
