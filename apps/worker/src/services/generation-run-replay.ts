import type { PromptPayload, SupplementalMaterialPayload } from "@newsweb/prompt-kit";
import { rewriteOutputSchema, type RewriteOutput } from "@newsweb/shared";

// Replaying a stored generation run against the current validators requires
// reconstructing exactly what the worker validated at the time:
//  - the stored rewrite output, which failed rows wrap as
//    output_json.blockedRewrite (worker rewriteJsonForValidation);
//  - the validation payload, which for report flows is NOT the raw
//    sourcePayload but the reportReferencePayload join (worker.ts), with
//    validation_json.reportExtraction.validationSourceChars persisted as the
//    per-row tripwire.
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
  // validation_json.hiddenDraft. Hydrate only the non-visible schema fields
  // with number-free values so replay stays deterministic.
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

export function replayValidationPayloadFromRow(row: {
  sourcePayload?: unknown;
  validationJson?: unknown;
}): ReplayValidationPayload | null {
  const sourcePayload = asRecord(row.sourcePayload);
  if (!sourcePayload) return null;

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
