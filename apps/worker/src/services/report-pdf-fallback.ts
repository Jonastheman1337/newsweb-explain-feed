import type { PdfAttachmentDownload, ReportExtractionResult } from "./pdf-extract.js";

const normalize = (value: string) => value.normalize("NFKC").replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
type PdfFallbackEvidence = { context: string; sourceEvidence: string[]; limitations: string[]; confidence: "high" | "medium" | "low" };

/** Model interpretation is useful to the writer, but is never its own source. */
export function mergeReportPdfFallback(
  pdf: Pick<PdfAttachmentDownload, "attachmentId" | "attachmentName" | "pageCount">,
  fallback: PdfFallbackEvidence,
  existing?: ReportExtractionResult
): ReportExtractionResult {
  const referenceText = existing?.referenceText ?? "";
  const raw = normalize(referenceText);
  const supportedExcerpts = fallback.sourceEvidence.filter(excerpt =>
    normalize(excerpt).length >= 20 && raw.includes(normalize(excerpt)));
  // A readable narrative can establish limited financial evidence even when
  // column extraction failed. Confidence or model-generated prose alone cannot.
  const hasFinancialExcerpt = supportedExcerpts.some(excerpt => /\d/.test(excerpt) &&
    /revenue|income|profit|loss|EBIT|resultat|inntekt|omsetning|overskudd|underskudd/i.test(excerpt));
  const hasPeriod = /\b(?:20\d{2}|19\d{2})\b/.test(raw) &&
    /quarter|half.year|interim|kvartal|halvår|\b[QH][1-4]\b/i.test(raw);
  const priorReadiness = existing?.diagnostics.completeness;
  const sufficient = priorReadiness === "complete" || priorReadiness === "partial" ||
    (fallback.confidence !== "low" && hasFinancialExcerpt && hasPeriod);
  return {
    ...existing,
    text: [existing?.text, "MODEL INTERPRETATION — verify every claim against raw report evidence:", fallback.context,
      "FALLBACK LIMITATIONS:", ...fallback.limitations].filter(Boolean).join("\n\n"),
    referenceText,
    pageCount: existing?.pageCount ?? pdf.pageCount,
    metrics: existing?.metrics ?? [], financialFacts: existing?.financialFacts ?? [],
    attachments: existing?.attachments ?? [], selectedPages: existing?.selectedPages ?? [],
    diagnostics: {
      incomeStatementFound: false, fallbackUsed: true,
      requestedPageNumbers: [], requestedTopicTerms: [], totalExtractedChars: 0,
      ...existing?.diagnostics,
      openAIPdfFallback: true,
      // Partial always: a second model reading does not prove full extraction.
      completeness: sufficient ? "partial" : "insufficient",
      completenessReasons: [...new Set([
        ...(existing?.diagnostics.completenessReasons ?? []), "model_pdf_interpretation_requires_raw_evidence",
        ...(!sufficient ? ["no_verified_financial_source_evidence"] : [])
      ])]
    },
    attachmentId: existing?.attachmentId ?? pdf.attachmentId,
    attachmentName: existing?.attachmentName ?? pdf.attachmentName
  };
}
