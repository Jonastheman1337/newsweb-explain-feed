import { createHash } from "node:crypto";
import {
  isRelatedNoticeTimestampValid,
  relatedNoticeTimeMarker,
  type PromptPayload,
  type ReportPromptPayload,
  type YearlyReportPromptPayload
} from "@newsweb/prompt-kit";
import type { NoticeEditorialBrief, NoticePromptKind } from "@newsweb/prompt-kit";
import type { RewriteOutput } from "@newsweb/shared";
import type { ReportFinancialFact } from "./report-financial-facts.js";

export type NoticePayload = PromptPayload & Partial<ReportPromptPayload & YearlyReportPromptPayload> & {
  reportReferenceText?: string;
  reportCompleteness?: "complete" | "partial" | "insufficient";
  reportFinancialFacts?: ReportFinancialFact[];
};
export type NoticeEvidenceSource = { id: string; text: string; kind: "primary" | "material" | "prior" };
export type NoticeEvidence = {
  sources: NoticeEvidenceSource[];
  sha256: string;
  attachmentTextAvailable: boolean;
  sourceLimitations: string[];
};

export function buildNoticeEvidence(payload: NoticePayload): NoticeEvidence {
  const attachmentText = [payload.reportReferenceText ?? payload.reportText, payload.pdfSupplementText, payload.letterText, payload.remunerationText]
    .filter((text): text is string => Boolean(text?.trim()));
  const sources: NoticeEvidenceSource[] = [{
    id: "primary", kind: "primary",
    text: [payload.title, payload.bodyText, ...new Set(attachmentText)].filter(Boolean).join("\n\n")
  }];
  for (const material of payload.supplementalMaterials ?? []) {
    if (material.text.trim()) sources.push({ id: material.sourceId, kind: "material", text: material.text });
  }
  for (const prior of payload.relatedNotices ?? []) {
    if (prior.relation === "sibling" && relatedNoticeTimeMarker(prior.publishedAt, payload.publishedAt).daysBefore !== 0) continue;
    if (prior.text.trim() && isRelatedNoticeTimestampValid(prior.publishedAt, payload.publishedAt)) {
      sources.push({ id: `prior_${prior.messageId}`, kind: "prior", text: prior.text });
    }
  }
  if (new Set(sources.map(source => source.id)).size !== sources.length) {
    throw new Error("NOTICE_EVIDENCE_DUPLICATE_SOURCE_ID");
  }
  const sourceLimitations = payload.hasAttachments && attachmentText.length === 0
    ? ["Vedlegg er ikke tilgjengelige i kildegrunnlaget."] : [];
  if (payload.reportCompleteness && payload.reportCompleteness !== "complete") {
    sourceLimitations.push("Rapportgrunnlaget er et begrenset utdrag, ikke en full analyse av alle vedlegg.");
  }
  return {
    sources,
    sha256: createHash("sha256").update(JSON.stringify(sources)).digest("hex"),
    attachmentTextAvailable: attachmentText.length > 0,
    sourceLimitations
  };
}

export function noticeReferencePayload(payload: NoticePayload): PromptPayload {
  // Keep primary and prior source ownership separate for the reference checker.
  const evidence = buildNoticeEvidence(payload);
  const primary = evidence.sources.find(source => source.id === "primary")!.text;
  const allowedPriorIds = new Set(evidence.sources.filter(source => source.kind === "prior").map(source => source.id));
  return { ...payload, bodyText: primary, sourceBodyChars: primary.length, pdfSupplementText: undefined,
    relatedNotices: payload.relatedNotices?.filter(prior => allowedPriorIds.has(`prior_${prior.messageId}`)) };
}

function normalizeEvidence(text: string): string {
  return text.normalize("NFKC").replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
}

export function validateBriefEvidence(brief: NoticeEditorialBrief, evidence: NoticeEvidence): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const fact of brief.mustInclude) {
    if (ids.has(fact.id)) errors.push(`Duplicate fact id: ${fact.id}`);
    ids.add(fact.id);
    const source = evidence.sources.find(item => item.id === fact.sourceId);
    if (!source || normalizeEvidence(fact.sourceEvidence).length < 12 ||
        !normalizeEvidence(source.text).includes(normalizeEvidence(fact.sourceEvidence))) {
      errors.push(`Fact ${fact.id} does not quote its named source exactly.`);
    }
  }
  if (brief.newsworthy && brief.mustInclude.length === 0) errors.push("A newsworthy brief needs at least one supported fact.");
  if (brief.newsworthy && !brief.mustInclude.some(fact =>
    evidence.sources.some(source => source.id === fact.sourceId && source.kind !== "prior"))) {
    errors.push("The current event cannot rest only on prior notices.");
  }
  if (brief.usefulQuote) {
    const quote = brief.usefulQuote;
    const source = evidence.sources.find(item => item.id === quote.sourceId);
    if (!source || !normalizeEvidence(source.text).includes(normalizeEvidence(quote.sourceEvidence)) ||
        normalizeEvidence(quote.sourceEvidence).length < 12 ||
        !normalizeEvidence(quote.sourceEvidence).includes(normalizeEvidence(quote.text)) ||
        !normalizeEvidence(source.text).includes(normalizeEvidence(quote.speaker))) {
      errors.push("The proposed quote does not have literal source evidence.");
    }
  }
  return errors;
}

export function isResultsNotice(payload: PromptPayload, kind: NoticePromptKind): boolean {
  if (kind === "yearly") return false; // The annual flow intentionally covers remuneration.
  return kind === "report" || /halv[åa]rs(?:regnskap|rapport)|kvartals(?:regnskap|rapport)|financial results|quarter.{0,30}(?:results|reports?)|interim (?:financial )?report|half[- ]year(?:ly)?(?: financial)? reports?|\b[QH][1-4]\b.{0,30}(?:financial )?(?:report|results)/i
    .test([payload.title, ...payload.categories].join(" "));
}

export function reportEvidenceIssues(
  payload: NoticePayload,
  kind: NoticePromptKind,
  evidence: NoticeEvidence,
  brief?: NoticeEditorialBrief
): string[] {
  if (!isResultsNotice(payload, kind)) return [];
  // Report-level extraction confidence is not a verdict on every current fact.
  // A validated newsworthy brief may attempt a limited draft from the raw
  // evidence that exists; the final article still needs every publication check.
  if (brief?.newsworthy && validateBriefEvidence(brief, evidence).length === 0) return [];
  if (payload.reportCompleteness === "insufficient") return ["INCOMPLETE_REPORT_SOURCE: No usable financial evidence was obtained from the report."];
  if (!payload.hasAttachments) return [];
  if (!evidence.attachmentTextAvailable) return ["INCOMPLETE_REPORT_SOURCE: The results notice has attachments but no report evidence was obtained."];
  return [];
}

export function briefPrompt(payload: NoticePayload, kind: NoticePromptKind, evidence: NoticeEvidence, instruction?: string, previousOutput?: RewriteOutput, allowSkip = true): string {
  // No head-only excerpt: the planner sees all extracted evidence, including late facts.
  return JSON.stringify({
    task: "Velg nyheten og de få opplysningene som må bevares i en kort notis.",
    kind, publishedAt: payload.publishedAt, issuerName: payload.issuerName, allowSkip,
    categories: payload.categories, instruction: instruction ?? null,
    previousArticle: previousOutput ? { title: previousOutput.title, lead: previousOutput.lead, body: previousOutput.body } : null,
    related: (payload.relatedNotices ?? []).map(({ messageId, publishedAt, relation }) => ({ messageId, publishedAt, relation })),
    sources: evidence.sources, sourceLimitations: evidence.sourceLimitations,
    extractedFinancialFacts: payload.reportFinancialFacts ?? []
  });
}
