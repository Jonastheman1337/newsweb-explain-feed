// Use legacy build — the default build requires browser APIs (DOMMatrix)
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  extractReportFinancialFacts,
  extractReportNumberValues,
  type ReportFinancialFact
} from "./report-financial-facts.js";
export type { ReportFinancialFact, ReportFinancialPeriod } from "./report-financial-facts.js";

const ATTACHMENT_URL =
  "https://api3.oslo.oslobors.no/v1/newsreader/attachment";
const MAX_TEXT_CHARS = 15_000;
const MAX_REPORT_CONTEXT_CHARS = 24_000;
const MAX_REPORT_REFERENCE_CHARS = 72_000;
const MAX_REPORT_ATTACHMENTS_INSPECTED = 4;
const MAX_REPORT_ATTACHMENTS_SELECTED = 2;
const MAX_REPORT_PDF_BYTES = 20 * 1024 * 1024;
const MAX_REPORT_DOWNLOAD_BYTES = 40 * 1024 * 1024;
const MAX_REPORT_PAGES_INSPECTED = 160;
const MAX_PRIMARY_PAGE_CHARS = 4_500;
const MAX_USER_PAGE_CHARS = 3_500;
const MAX_SECONDARY_PAGE_CHARS = 3_000;
const MAX_SECONDARY_PAGES = 4;
const MIN_TEXT_CHARS = 500;
const INCOME_STATEMENT_SCORE_THRESHOLD = 16;
const FINANCIAL_FALLBACK_SCORE_THRESHOLD = 8;

const REPORT_FILENAME_PATTERN =
  /(?:Q[1-4]|quarterly|kvartalsrapport|halv[aå]r|halv[aå]rsrapport|interim|investor\s*(?:report|update)|management\s*accounts)/i;

const YEARLY_REPORT_FILENAME_PATTERN =
  /(?:annual\s*report|[åa]rsrapport|[åa]rsmelding|annual\s*accounts|[åa]rs(?:regnskap|beretning))/i;

/**
 * Section-heading keywords for remuneration/compensation tables.
 * Must match headings like "Godtgjørelse til ledende ansatte", "Remuneration report"
 * — NOT every mention of "godtgjørelse" or "remuneration" in running text.
 */
const REMUNERATION_KEYWORDS =
  /(?:godtgj[øo]relse\s*(?:til|og)\s*(?:ledende|styret|daglig)|lederl[øo]nn|remuneration\s*(?:report|to\s*(?:the\s*)?(?:board|senior|executive))|salary\s*and\s*(?:other\s*)?remuneration\s*to|executive\s*(?:compensation|pay)\s*(?:report|summary)|l[øo]nn\s*(?:og|til)\s*(?:ledende|daglig\s*leder))/i;

export type ReportMetricKind =
  | "revenue"
  | "operating_result"
  | "earnings_before_tax";

export type ReportPageReason =
  | "income_statement"
  | "financial_fallback"
  | "ceo_or_management"
  | "outlook_or_events"
  | "user_page"
  | "user_page_context"
  | "user_topic"
  | "user_topic_context";

export type ReportMetricCandidate = {
  metric: ReportMetricKind;
  label: string;
  values: string[];
  pageNumber: number;
  rowNumber?: number;
  rowText: string;
  attachmentId?: number;
  attachmentName?: string | null;
};

export type SelectedReportPage = {
  pageNumber: number;
  reasons: ReportPageReason[];
  score: number;
  textChars: number;
  attachmentId?: number;
  attachmentName?: string | null;
};

export type ReportAttachmentEvidence = {
  attachmentId: number;
  attachmentName: string | null;
  pageCount: number;
  extractedPageCount: number;
  selectedPageNumbers: number[];
  relevanceScore: number;
};

export type ReportExtractionDiagnostics = {
  incomeStatementFound: boolean;
  fallbackUsed: boolean;
  openAIPdfFallback?: boolean;
  requestedPageNumbers: number[];
  requestedTopicTerms: string[];
  totalExtractedChars: number;
  usableFinancialFactCount?: number;
  unresolvedFinancialFactCount?: number;
  /** Completeness of extraction, never a claim that every material story fact was found. */
  completeness?: "complete" | "partial" | "insufficient";
  completenessReasons?: string[];
  contextTruncated?: boolean;
  referenceTextTruncated?: boolean;
  eligibleAttachmentIds?: number[];
  inspectedAttachmentIds?: number[];
  selectedAttachmentIds?: number[];
  uninspectedAttachmentIds?: number[];
  failedAttachments?: Array<{ attachmentId: number; reason: string }>;
};

export type ReportContextPack = {
  text: string;
  referenceText: string;
  pageCount: number;
  metrics: ReportMetricCandidate[];
  financialFacts?: ReportFinancialFact[];
  attachments?: ReportAttachmentEvidence[];
  selectedPages: SelectedReportPage[];
  diagnostics: ReportExtractionDiagnostics;
};

export type ReportExtractionResult = ReportContextPack & {
  attachmentId: number;
  attachmentName: string | null;
};

export type PdfAttachmentDownload = {
  buffer: Buffer;
  attachmentId: number;
  attachmentName: string | null;
  pageCount: number;
};

type PdfPageText = {
  index: number;
  pageNumber: number;
  text: string;
  normalized: string;
};

type ScoredPage = {
  index: number;
  score: number;
};

type MutableSelectedPage = {
  index: number;
  reasons: Set<ReportPageReason>;
  score: number;
};

export async function downloadAttachmentPdf(
  messageId: number,
  attachmentId: number,
  options?: { maxBytes?: number }
): Promise<Buffer> {
  const url = `${ATTACHMENT_URL}?messageId=${messageId}&attachmentId=${attachmentId}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(
      `Failed to download attachment ${attachmentId} for message ${messageId}: ${response.status}`
    );
  }
  if (!options?.maxBytes) return Buffer.from(await response.arrayBuffer());
  const maxBytes = options.maxBytes;
  const contentLength = Number(response.headers.get("content-length"));
  if (contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`PDF attachment ${attachmentId} exceeds the download byte budget`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`PDF attachment ${attachmentId} exceeds the download byte budget`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * Extract text from each page of a PDF independently.
 */
export async function extractPagesFromPdf(
  buffer: Buffer,
  options?: { maxPages?: number }
): Promise<{ pages: string[]; pageCount: number }> {
  const data = new Uint8Array(buffer);
  const doc: PDFDocumentProxy = await getDocument({ data, useSystemFonts: true }).promise;

  const pages: string[] = [];
  const pageCount = doc.numPages;
  try {
    for (let i = 1; i <= Math.min(pageCount, options?.maxPages ?? pageCount); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let lastY: number | undefined;
      let lastEndX: number | undefined;
      let pageText = "";
      for (const item of content.items) {
        if ("str" in item) {
          if (lastY !== undefined && Math.abs(lastY - item.transform[5]) > 2) {
            pageText += "\n";
          } else if (lastEndX !== undefined && item.transform[4] - lastEndX >= Math.max(12, Math.abs(item.transform[0]) * 1.2)) {
            // Preserve actual column gaps. A single ordinary space cannot tell a
            // thousands separator from two adjacent values once geometry is lost.
            pageText += "\t";
          } else if (
            pageText &&
            item.str &&
            !/\s$/.test(pageText) &&
            !/^[\s,.;:%)]/.test(item.str)
          ) {
            pageText += " ";
          }
          pageText += item.str;
          lastY = item.transform[5];
          lastEndX = item.transform[4] + item.width;
        }
      }
      pages.push(pageText);
    }
  } finally {
    await doc.destroy();
  }
  return { pages, pageCount };
}

export async function extractTextFromPdf(
  buffer: Buffer
): Promise<{ text: string; pageCount: number }> {
  const { pages, pageCount } = await extractPagesFromPdf(buffer);
  return { text: pages.join("\n\n"), pageCount };
}

type AttachmentMeta = {
  id: number;
  fileName?: string | null;
  fileType?: string | null;
  fileSize?: number | null;
};

function normalizeAttachments(rawMessageJson: unknown): AttachmentMeta[] {
  const message = rawMessageJson as {
    attachments?: Array<Record<string, unknown>>;
  };
  const rawAttachments = message?.attachments ?? [];
  if (rawAttachments.length === 0) return [];

  return rawAttachments.map((att) => ({
    id: Number(att.id),
    fileName: (att.fileName ?? att.name ?? null) as string | null,
    fileType: (att.fileType ?? att.contentType ?? null) as string | null,
    fileSize: (att.fileSize ?? att.size ?? null) as number | null
  })).filter((att) => Number.isSafeInteger(att.id) && att.id > 0);
}

function filterPdfs(attachments: AttachmentMeta[], filenamePattern?: RegExp): AttachmentMeta[] {
  return attachments.filter((att) => {
    const name = att.fileName ?? "";
    const type = (att.fileType ?? "").toLowerCase();
    const isPdf =
      name.toLowerCase().endsWith(".pdf") ||
      type === "application/pdf" ||
      type === "pdf";
    if (!isPdf) return false;
    if (filenamePattern) return filenamePattern.test(name);
    return true;
  });
}

function pickLargestAttachment(attachments: AttachmentMeta[]): AttachmentMeta | null {
  if (attachments.length === 0) return null;
  const sorted = [...attachments].sort(
    (a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0)
  );
  return sorted[0] ?? null;
}

async function downloadPdfTarget(
  messageId: number,
  target: AttachmentMeta,
  options?: { maxBytes?: number; maxPages?: number }
): Promise<PdfAttachmentDownload> {
  const buffer = await downloadAttachmentPdf(messageId, target.id, options);
  const { pageCount } = await extractPagesFromPdf(buffer, options);
  return {
    buffer,
    pageCount,
    attachmentId: target.id,
    attachmentName: target.fileName ?? null
  };
}

export async function downloadReportPdfAttachment(
  rawMessageJson: unknown,
  messageId: number,
  preferredAttachmentId?: number
): Promise<PdfAttachmentDownload | null> {
  const attachments = normalizeAttachments(rawMessageJson);
  const preferred = filterPdfs(attachments).find((attachment) => attachment.id === preferredAttachmentId);
  if (preferred) return downloadPdfTarget(messageId, preferred, { maxBytes: MAX_REPORT_PDF_BYTES, maxPages: 1 });
  const inspection = await inspectReportAttachments(attachments, messageId);
  const selected = inspection.documents.filter((document) => document.relevant).sort((a, b) => b.score - a.score)[0];
  if (selected) return { buffer: selected.buffer, pageCount: selected.pageCount, attachmentId: selected.target.id, attachmentName: selected.target.fileName ?? null };
  // A scanned, explicitly named report can still be sent to visual extraction.
  // An opaque non-report must not enter the report route just because it is a PDF.
  const named = inspection.documents.find((document) => REPORT_FILENAME_PATTERN.test(document.target.fileName ?? "") && document.pages.join("").trim().length < MIN_TEXT_CHARS);
  return named ? { buffer: named.buffer, pageCount: named.pageCount, attachmentId: named.target.id, attachmentName: named.target.fileName ?? null } : null;
}

export async function downloadYearlyReportPdfAttachment(
  rawMessageJson: unknown,
  messageId: number
): Promise<PdfAttachmentDownload | null> {
  const attachments = normalizeAttachments(rawMessageJson);
  const yearlyPdfs = filterPdfs(attachments, YEARLY_REPORT_FILENAME_PATTERN);
  const norwegianReport = yearlyPdfs.find((att) =>
    /[åa]rsrapport/i.test(att.fileName ?? "")
  );
  const target =
    norwegianReport ??
    pickLargestAttachment(yearlyPdfs) ??
    pickLargestAttachment(filterPdfs(attachments));
  return target ? downloadPdfTarget(messageId, target) : null;
}

export async function downloadGeneralPdfAttachment(
  rawMessageJson: unknown,
  messageId: number
): Promise<PdfAttachmentDownload | null> {
  const attachments = normalizeAttachments(rawMessageJson);
  const generalPdfs = filterPdfs(attachments).filter((att) => {
    const name = att.fileName ?? "";
    return !REPORT_FILENAME_PATTERN.test(name) && !YEARLY_REPORT_FILENAME_PATTERN.test(name);
  });
  const target = pickLargestAttachment(generalPdfs);
  return target ? downloadPdfTarget(messageId, target) : null;
}

export function reportNeedsOpenAIPdfFallback(
  context: ReportContextPack
): boolean {
  const requestedTopicMissing =
    context.diagnostics.requestedTopicTerms.length > 0 &&
    !context.selectedPages.some((page) => page.reasons.includes("user_topic"));
  const requestedPageMissing =
    context.diagnostics.requestedPageNumbers.some((number) =>
      !context.selectedPages.some((page) => page.pageNumber === number && page.reasons.includes("user_page"))
    );

  return (
    context.diagnostics.totalExtractedChars < 1200 ||
    context.metrics.length === 0 ||
    (context.financialFacts !== undefined && !context.financialFacts.some((fact) => fact.usable)) ||
    requestedTopicMissing ||
    requestedPageMissing
  );
}

/**
 * Given a sorted list of page indices, find the largest cluster of consecutive pages.
 * E.g., [4, 5, 6, 60, 112, 113, 114] → [112, 113, 114] (or [4, 5, 6] — picks the one with more pages).
 * This filters out isolated TOC/reference hits and keeps the actual section.
 */
function pickLargestCluster(sortedPages: number[]): number[] {
  if (sortedPages.length <= 1) return sortedPages;

  let bestStart = 0;
  let bestLen = 1;
  let curStart = 0;
  let curLen = 1;

  for (let i = 1; i < sortedPages.length; i++) {
    if (sortedPages[i] - sortedPages[i - 1] <= 1) {
      curLen++;
    } else {
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
      curStart = i;
      curLen = 1;
    }
  }
  if (curLen > bestLen) {
    bestStart = curStart;
    bestLen = curLen;
  }

  return sortedPages.slice(bestStart, bestStart + bestLen);
}

function truncateText(text: string): string {
  if (text.length > MAX_TEXT_CHARS) {
    return text.slice(0, MAX_TEXT_CHARS) + "\n\n[... resten er utelatt ...]";
  }
  return text;
}

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const INCOME_STATEMENT_TERMS: Array<{ term: string; weight: number }> = [
  { term: "consolidated statement of comprehensive income", weight: 20 },
  { term: "statement of comprehensive income", weight: 16 },
  { term: "consolidated statement of profit or loss", weight: 18 },
  { term: "statement of profit or loss", weight: 16 },
  { term: "consolidated income statement", weight: 16 },
  { term: "income statement", weight: 12 },
  { term: "resultatregnskap", weight: 14 },
  { term: "oppstilling over totalresultat", weight: 18 },
  { term: "totalresultat", weight: 10 }
];

const CONTENTS_TERMS = [
  "table of contents",
  "contents",
  "innholdsfortegnelse",
  "innhold"
];

const NON_INCOME_STATEMENT_TERMS = [
  "statement of financial position",
  "balance sheet",
  "cash flow statement",
  "kontantstrom",
  "balanse"
];

// Match section headings, not accounting notes that merely mention management,
// estimates or an income statement. Period suffixes cover report mastheads.
const SECONDARY_CONTEXT_HEADINGS: Array<{ pattern: RegExp; weight: number; reason: ReportPageReason }> = [
  { pattern: /^(?:(?:q[1-4]|h[12])\s+(?:20\d{2}\s+)?)?financial (?:results|review|performance)(?:\s+(?:q[1-4]|h[12]|20\d{2})[\d\s]*)?$/, weight: 12, reason: "ceo_or_management" },
  { pattern: /^(?:resultat(?:et)? per\s+\d{1,2}\.\d{1,2}\.20\d{2}|resultatutvikling|okonomisk utvikling)$/, weight: 12, reason: "ceo_or_management" },
  { pattern: /^(?:management (?:report|review)|(?:board of )?directors['’]? report|report (?:of|from) the (?:board of )?directors|styrets beretning|halvarsberetning)(?:\s+(?:q[1-4]|h[12]|20\d{2})[\d\s]*)?$/, weight: 10, reason: "ceo_or_management" },
  { pattern: /^(?:(?:letter|message|statement|review|report) from (?:the )?(?:ceo|chief executive(?: officer)?|konsernsjef(?:en)?|administrerende direktor)|(?:ceo|chief executive(?: officer)?|konsernsjef(?:en)?|administrerende direktor)(?:['’]s)?\s+(?:letter|message|statement|review|report|kommentar|har ordet))$/, weight: 8, reason: "ceo_or_management" },
  { pattern: /^(?:outlook|guidance|utsikter|fremtidsutsikter)$/, weight: 6, reason: "outlook_or_events" },
  { pattern: /^(?:key events|highlights|subsequent events|events after (?:the )?reporting period|(?:viktige |vesentlige )?hendelser(?: etter balansedagen| i forste halvar(?: 20\d{2})?)?|hoydepunkter)$/, weight: 5, reason: "outlook_or_events" }
];

const METRIC_MATCHERS: Record<ReportMetricKind, RegExp[]> = {
  revenue: [
    /\b(total\s+)?(operating\s+)?revenues?\b/,
    /\bsales revenue\b/,
    /\btotal\s+operating\s+income\b/,
    /\bsalgsinntekter\b/,
    /\bdriftsinntekter\b/,
    /\binntekter\b/,
    /\bomsetning\b/
  ],
  operating_result: [
    /\boperating\s+(profit|loss|result)\b/,
    /\boperating profit\/loss\b/,
    /\bdriftsresultat\b/,
    /\bebit\b(?!da)/
  ],
  earnings_before_tax: [
    /\b(profit|loss|earnings|result).{0,35}before tax\b/,
    /\bresultat.{0,35}for skatt\b/,
    /\bresultat.{0,35}skattekostnad\b/
  ]
};

const METRIC_LABELS: Record<ReportMetricKind, string> = {
  revenue: "revenue",
  operating_result: "operating profit/EBIT",
  earnings_before_tax: "earnings before tax"
};

const INSTRUCTION_STOPWORDS = new Set([
  "about",
  "also",
  "better",
  "could",
  "content",
  "explain",
  "from",
  "have",
  "include",
  "more",
  "page",
  "pages",
  "please",
  "report",
  "should",
  "specific",
  "take",
  "that",
  "this",
  "want",
  "with",
  "you",
  "kan",
  "side",
  "siden",
  "sider",
  "forklar",
  "forklare",
  "bedre",
  "inkluder",
  "inkludere",
  "gjerne",
  "rapport",
  "saken",
  "notis",
  "mer",
  "med",
  "for",
  "fra",
  "til",
  "det",
  "den",
  "som",
  "og",
  "om",
  "pa",
  "av",
  "the",
  "and",
  "out",
  "can"
]);

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function metricKindMatches(normalizedText: string, kind: ReportMetricKind): boolean {
  return METRIC_MATCHERS[kind].some((pattern) => pattern.test(normalizedText));
}

function metricKindsInText(text: string): Set<ReportMetricKind> {
  const normalizedText = normalizeForSearch(text);
  const result = new Set<ReportMetricKind>();
  for (const kind of Object.keys(METRIC_MATCHERS) as ReportMetricKind[]) {
    if (metricKindMatches(normalizedText, kind)) {
      result.add(kind);
    }
  }
  return result;
}

function extractNumberValues(text: string): string[] {
  return extractReportNumberValues(text).slice(0, 8);
}

function extractMetricLabel(rowText: string): string {
  const numberIndex = rowText.search(/(?:\(\s*)?-?\d/);
  const label =
    numberIndex >= 0 ? rowText.slice(0, numberIndex) : rowText;
  return label.replace(/\s+/g, " ").trim().slice(0, 140);
}

function scoreTermWeights(
  normalizedText: string,
  terms: Array<{ term: string; weight: number }>
): number {
  return terms.reduce(
    (score, item) => score + (normalizedText.includes(item.term) ? item.weight : 0),
    0
  );
}

function hasIncomeStatementHeading(page: PdfPageText): boolean {
  if (isContentsPage(page) || isAccountingPolicyPage(page)) return false;
  return possibleHeadingLines(page).some(line => {
    const heading = line.match(/^(?:(?:condensed|consolidated|interim|unaudited|group|parent(?: company)?|konsern(?:ets)?)\s+)*(?:income statements?|statements? of (?:comprehensive income|profit (?:or|and) loss(?: and (?:other )?comprehensive income)?)|resultatregnskap(?:et)?(?: for konsernet)?|oppstilling over totalresultat|totalresultat)(?=$|\s|[(:–-])/);
    if (!heading) return false;
    const suffix = line.slice(heading[0].length).replace(/\([^)]{1,60}\)/g, "").trim();
    if (!suffix) return true;
    // Accept ordinary reporting-period headings, including wrapped long IFRS
    // names, while rejecting sentences about how an income statement is used.
    if (!/\b(?:20\d{2}|q[1-4]|h[12]|fy)\b/.test(suffix)) return false;
    return suffix
      .replace(/\b(?:for|the|periods?|perioden|quarter|kvartal|year|ended|ending|as|at|three|six|nine|twelve|months?|q[1-4]|h[12]|fy|january|february|march|april|may|june|july|august|september|october|november|december|januar|februar|mars|mai|juni|juli|oktober|desember)\b/g, "")
      .replace(/[\d\s.,/:–-]/g, "").length === 0;
  });
}

function normalizedPageLines(page: PdfPageText): string[] {
  return page.text.split(/\r?\n/).map(normalizeForSearch).filter(Boolean);
}

function possibleHeadingLines(page: PdfPageText): string[] {
  const lines = normalizedPageLines(page);
  return lines.flatMap((line, index) => line.length <= 80 && lines[index + 1]?.length <= 80
    ? [line, `${line} ${lines[index + 1]}`]
    : [line]);
}

function isContentsPage(page: PdfPageText): boolean {
  return normalizedPageLines(page).some(line => /^(?:table of contents|contents|innholdsfortegnelse|innhold)$/.test(line));
}

function isAccountingPolicyPage(page: PdfPageText): boolean {
  return normalizedPageLines(page).some(line =>
    /^(?:note\s+\d+\s*[-.:]?\s*)?(?:(?:significant |material |summary of significant )?accounting (?:principles|policies)|basis (?:for consolidation|of preparation)|regnskapsprinsipper)(?:\s*\([^)]*\))?$/.test(line)
  );
}

function scoreIncomeStatementPage(page: PdfPageText): number {
  let score = scoreTermWeights(page.normalized, INCOME_STATEMENT_TERMS);
  score += metricKindsInText(page.text).size * 6;
  score += Math.min(extractNumberValues(page.text).length, 12);

  if (hasAnyTerm(page.normalized, CONTENTS_TERMS)) {
    score -= 18;
  }
  if (
    hasAnyTerm(page.normalized, NON_INCOME_STATEMENT_TERMS) &&
    scoreTermWeights(page.normalized, INCOME_STATEMENT_TERMS) === 0
  ) {
    score -= 8;
  }

  return Math.max(0, score);
}

function scoreFinancialFallbackPage(page: PdfPageText): number {
  if (isAccountingPolicyPage(page)) return 0;
  let score = metricKindsInText(page.text).size * 6;
  score += scoreTermWeights(page.normalized, [
    { term: "financial review", weight: 5 },
    { term: "key figures", weight: 5 },
    { term: "highlights", weight: 3 },
    { term: "quarter", weight: 2 },
    { term: "q1", weight: 2 },
    { term: "q2", weight: 2 },
    { term: "q3", weight: 2 },
    { term: "q4", weight: 2 },
    { term: "profit", weight: 2 },
    { term: "revenue", weight: 2 },
    { term: "resultat", weight: 2 },
    { term: "inntekter", weight: 2 }
  ]);
  if (hasAnyTerm(page.normalized, CONTENTS_TERMS)) {
    score -= 12;
  }
  return Math.max(0, score);
}

function scoreSecondaryPage(page: PdfPageText): { score: number; reason: ReportPageReason } {
  if (isContentsPage(page) || isAccountingPolicyPage(page)) return { score: 0, reason: "ceo_or_management" };
  let score = 0;
  let reason: ReportPageReason = "ceo_or_management";
  const headings = possibleHeadingLines(page).map(line => line.split(":")[0].trim()).filter(line => line.length <= 120);
  for (const heading of SECONDARY_CONTEXT_HEADINGS) {
    if (headings.some(line => heading.pattern.test(line)) && heading.weight > score) {
      score = heading.weight;
      reason = heading.reason;
    }
  }
  return { score, reason };
}

function isManagementContinuation(page: PdfPageText): boolean {
  if (isContentsPage(page) || isAccountingPolicyPage(page) || hasIncomeStatementHeading(page)) return false;
  // Do not follow management prose into a financial statement, a numbered note,
  // an image page or a table. One adjacent prose page is enough to recover a
  // section broken at a physical page boundary without unbounded expansion.
  const lines = normalizedPageLines(page);
  if (lines.some(line => /^(?:note\s+\d+\b|(?:consolidated )?(?:statement of financial position|balance sheet|cash flow statement)|balanse|kontantstromoppstilling|nokkel(?:tall|tal))/.test(line))) return false;
  const prose = lines.filter(line => (line.match(/[a-z]+/g) ?? []).length >= 8 && !/^\d/.test(line));
  return prose.join(" ").length >= 120;
}

function scoreByInstructionTerms(page: PdfPageText, terms: string[]): number {
  return terms.reduce((score, term) => {
    if (!page.normalized.includes(term)) return score;
    return score + (term.length >= 6 ? 2 : 1);
  }, 0);
}

function addSelectedPage(
  selected: Map<number, MutableSelectedPage>,
  pages: PdfPageText[],
  index: number,
  reason: ReportPageReason,
  score: number
): void {
  const page = pages[index];
  if (!page || page.text.trim().length === 0) return;
  const existing = selected.get(index);
  if (existing) {
    existing.reasons.add(reason);
    existing.score = Math.max(existing.score, score);
    return;
  }
  selected.set(index, {
    index,
    reasons: new Set([reason]),
    score
  });
}

function toSelectedPages(
  selected: Map<number, MutableSelectedPage>,
  pages: PdfPageText[]
): SelectedReportPage[] {
  return [...selected.values()]
    .sort((left, right) => left.index - right.index)
    .map((item) => ({
      pageNumber: pages[item.index].pageNumber,
      reasons: [...item.reasons],
      score: item.score,
      textChars: pages[item.index].text.length
    }));
}

function extractRequestedPageNumbers(
  instruction: string | undefined,
  pageCount: number
): number[] {
  if (!instruction) return [];
  const requested = new Set<number>();
  const regex =
    /\b(?:page|pages|p\.?|side|s\.)\s*(\d{1,4})(?:\s*(?:-|to|til)\s*(\d{1,4}))?/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(instruction)) !== null) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const from = Math.max(1, Math.min(start, end));
    const to = Math.min(pageCount, Math.max(start, end));
    for (let page = from; page <= to && page - from < 5; page++) {
      requested.add(page);
    }
  }
  return [...requested].sort((a, b) => a - b);
}

function extractInstructionTopicTerms(instruction: string | undefined): string[] {
  if (!instruction) return [];
  const withoutPageRefs = instruction.replace(
    /\b(?:page|pages|p\.?|side|s\.)\s*\d{1,4}(?:\s*(?:-|to|til)\s*\d{1,4})?/gi,
    " "
  );
  const normalized = normalizeForSearch(withoutPageRefs);
  const terms = new Set(
    normalized
      .split(/[^a-z0-9]+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 4 && !INSTRUCTION_STOPWORDS.has(term))
  );

  if (terms.has("datacenter")) {
    terms.add("data");
    terms.add("center");
  }
  if (terms.has("datasenter")) {
    terms.add("data");
    terms.add("senter");
  }

  return [...terms].slice(0, 10);
}

function truncatePageText(text: string, maxChars: number): string {
  const compacted = text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (compacted.length <= maxChars) return compacted;
  return `${compacted.slice(0, maxChars)}\n[... page truncated ...]`;
}

function formatPageForContext(page: PdfPageText, maxChars: number): string {
  return [`[PDF page ${page.pageNumber}]`, truncatePageText(page.text, maxChars)].join(
    "\n"
  );
}

function metricDisplayName(kind: ReportMetricKind): string {
  return METRIC_LABELS[kind];
}

function extractMetricsFromPages(
  pages: PdfPageText[],
  pageIndexes: Set<number>
): ReportMetricCandidate[] {
  const candidates: ReportMetricCandidate[] = [];

  for (const page of pages) {
    if (!pageIndexes.has(page.index)) continue;
    const lines = page.text.split(/\r?\n/);

    for (const [lineIndex, line] of lines.entries()) {
      const normalizedLine = normalizeForSearch(line);
      const values = extractNumberValues(line);
      if (values.length === 0) continue;

      for (const kind of Object.keys(METRIC_MATCHERS) as ReportMetricKind[]) {
        if (!metricKindMatches(normalizedLine, kind)) continue;
        candidates.push({
          metric: kind,
          label: extractMetricLabel(line) || metricDisplayName(kind),
          values,
          pageNumber: page.pageNumber,
          rowNumber: lineIndex + 1,
          rowText: line
        });
      }
    }
  }

  // Preserve the bounded context while keeping explicit totals ahead of
  // components. Otherwise sales + other income can consume both slots before
  // a later total operating income row is considered.
  const selected = new Set<ReportMetricCandidate>();
  const isRevenueTotal = (candidate: ReportMetricCandidate) =>
    /^(?:total\s+(?:(?:operating\s+)?revenues?|operating\s+income)|sum\s+(?:driftsinntekter|inntekter|omsetning))$/.test(normalizeForSearch(candidate.label));
  for (const kind of Object.keys(METRIC_MATCHERS) as ReportMetricKind[]) {
    const matching = candidates.filter(candidate => candidate.metric === kind);
    if (kind === "revenue") matching.sort((left, right) => Number(isRevenueTotal(right)) - Number(isRevenueTotal(left)));
    for (const candidate of matching.slice(0, 2)) selected.add(candidate);
  }
  return candidates.filter(candidate => selected.has(candidate));
}

function buildMetricSection(metrics: ReportMetricCandidate[]): string {
  if (metrics.length === 0) {
    return [
      "KEY METRICS (BEST-EFFORT EXTRACTION):",
      "- No structured metric rows were confidently extracted. Use the included source pages."
    ].join("\n");
  }

  return [
    "KEY METRICS (BEST-EFFORT EXTRACTION - VERIFY AGAINST PAGE TEXT):",
    ...metrics.map((metric) =>
      [
        `- ${metricDisplayName(metric.metric)} | page ${metric.pageNumber}`,
        `  label: ${metric.label}`,
        `  values: ${metric.values.join(" | ")}`,
        `  row: ${metric.rowText}`
      ].join("\n")
    )
  ].join("\n");
}

function buildReportContextText(
  pages: PdfPageText[],
  selected: Map<number, MutableSelectedPage>,
  metrics: ReportMetricCandidate[],
  financialFacts: ReportFinancialFact[]
): string {
  const selectedItems = [...selected.values()];
  const hasReason = (item: MutableSelectedPage, reasons: ReportPageReason[]) =>
    reasons.some((reason) => item.reasons.has(reason));
  const indexesForReasons = (reasons: ReportPageReason[]) =>
    selectedItems
      .filter((item) => hasReason(item, reasons))
      .sort((left, right) => left.index - right.index)
      .map((item) => item.index);

  const primaryIndexes = indexesForReasons([
    "income_statement",
    "financial_fallback"
  ]);
  const primarySet = new Set(primaryIndexes);
  const userIndexes = indexesForReasons([
    "user_page",
    "user_page_context",
    "user_topic",
    "user_topic_context"
  ]).filter((index) => !primarySet.has(index));
  const userSet = new Set(userIndexes);
  const secondaryIndexes = indexesForReasons([
    "ceo_or_management",
    "outlook_or_events"
  ]).filter((index) => !primarySet.has(index) && !userSet.has(index));

  const usableFacts = financialFacts.filter((fact) => fact.usable);
  const sections: string[] = [
    [
      "ALIGNED FINANCIAL FACTS (original units; no conversions):",
      ...(usableFacts.length ? usableFacts.map((fact) =>
        `- ${fact.metric}: ${fact.rawValue} ${fact.currency} ${fact.scale}; ${fact.period?.label}; ${fact.tableScope}; PDF page ${fact.pageNumber}, row ${fact.rowNumber}; comparison column: ${fact.comparisonPeriodId ?? "none identified"}`
      ) : ["- None. Column periods, scale, currency or scope could not be resolved safely. Do not infer them from column order."])
    ].join("\n"),
    buildMetricSection(metrics)
  ];
  if (primaryIndexes.length > 0) {
    sections.push(
      [
        "PRIMARY SOURCE (CONSOLIDATED INCOME STATEMENT / FINANCIAL TABLES):",
        ...primaryIndexes.map((index) =>
          formatPageForContext(pages[index], MAX_PRIMARY_PAGE_CHARS)
        )
      ].join("\n\n")
    );
  }
  if (userIndexes.length > 0) {
    sections.push(
      [
        "USER REQUESTED CONTEXT:",
        ...userIndexes.map((index) =>
          formatPageForContext(pages[index], MAX_USER_PAGE_CHARS)
        )
      ].join("\n\n")
    );
  }
  if (secondaryIndexes.length > 0) {
    sections.push(
      [
        "SECONDARY CONTEXT (CEO/MANAGEMENT/OUTLOOK/KEY EVENTS):",
        ...secondaryIndexes.map((index) =>
          formatPageForContext(pages[index], MAX_SECONDARY_PAGE_CHARS)
        )
      ].join("\n\n")
    );
  }

  const text = sections.join("\n\n---\n\n");
  if (text.length <= MAX_REPORT_CONTEXT_CHARS) return text;
  return `${text.slice(0, MAX_REPORT_CONTEXT_CHARS)}\n\n[... more selected report context omitted ...]`;
}

export function buildReportContextFromPages(
  rawPages: string[],
  userInstruction?: string,
  options?: { pageCount?: number }
): ReportContextPack {
  const pages: PdfPageText[] = rawPages.map((text, index) => ({
    index,
    pageNumber: index + 1,
    text,
    normalized: normalizeForSearch(text)
  }));
  const selected = new Map<number, MutableSelectedPage>();

  const incomeScores: ScoredPage[] = pages
    .map((page) => ({ index: page.index, score: scoreIncomeStatementPage(page) }))
    .sort((left, right) => right.score - left.score);
  const incomeStatementFound = incomeScores.some((item) => item.score >= INCOME_STATEMENT_SCORE_THRESHOLD && hasIncomeStatementHeading(pages[item.index]));

  if (incomeStatementFound) {
    for (const item of incomeScores
      .filter(
        (score) =>
          score.score >= INCOME_STATEMENT_SCORE_THRESHOLD &&
          hasIncomeStatementHeading(pages[score.index])
      )
      .slice(0, 3)) {
      addSelectedPage(selected, pages, item.index, "income_statement", item.score);
    }
  } else {
    const fallbackScores = pages
      .map((page) => ({ index: page.index, score: scoreFinancialFallbackPage(page) }))
      .filter((item) => item.score >= FINANCIAL_FALLBACK_SCORE_THRESHOLD)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
    for (const item of fallbackScores) {
      addSelectedPage(selected, pages, item.index, "financial_fallback", item.score);
    }
  }

  if (selected.size === 0 && incomeScores[0]) {
    addSelectedPage(
      selected,
      pages,
      incomeScores[0].index,
      "financial_fallback",
      incomeScores[0].score
    );
  }

  const requestedPageNumbers = extractRequestedPageNumbers(
    userInstruction,
    options?.pageCount ?? pages.length
  );
  for (const pageNumber of requestedPageNumbers) {
    const index = pageNumber - 1;
    addSelectedPage(selected, pages, index, "user_page", 100);
    addSelectedPage(selected, pages, index - 1, "user_page_context", 90);
    addSelectedPage(selected, pages, index + 1, "user_page_context", 90);
  }

  const requestedTopicTerms = extractInstructionTopicTerms(userInstruction);
  if (requestedTopicTerms.length > 0) {
    const topicScores = pages
      .map((page) => ({
        index: page.index,
        score: scoreByInstructionTerms(page, requestedTopicTerms)
      }))
      .filter((item) => item.score >= 2)
      .sort((left, right) => right.score - left.score)
      .slice(0, 2);
    for (const item of topicScores) {
      addSelectedPage(selected, pages, item.index, "user_topic", 80 + item.score);
      addSelectedPage(selected, pages, item.index - 1, "user_topic_context", 70);
      addSelectedPage(selected, pages, item.index + 1, "user_topic_context", 70);
    }
  }

  const selectedPrimaryIndexes = new Set(
    [...selected.values()]
      .filter(
        (item) =>
          item.reasons.has("income_statement") ||
          item.reasons.has("financial_fallback")
      )
      .map((item) => item.index)
  );
  const metricPageIndexes =
    selectedPrimaryIndexes.size > 0
      ? selectedPrimaryIndexes
      : new Set(incomeScores.slice(0, 3).map((item) => item.index));
  const metrics = extractMetricsFromPages(pages, metricPageIndexes);
  const financialFacts = extractReportFinancialFacts(pages, metrics);

  const secondaryCandidates = pages
    .map((page) => ({
      index: page.index,
      ...scoreSecondaryPage(page)
    }))
    .filter((item) => item.score >= 4 && !selectedPrimaryIndexes.has(item.index));
  const secondaryByIndex = new Map(secondaryCandidates.map(item => [item.index, item]));
  for (const item of secondaryCandidates) {
    const next = pages[item.index + 1];
    if (item.reason === "ceo_or_management" && next && !selected.has(next.index) && !secondaryByIndex.has(next.index) && isManagementContinuation(next)) {
      secondaryByIndex.set(next.index, { index: next.index, score: item.score - 1, reason: item.reason });
    }
  }
  const secondaryScores = [...secondaryByIndex.values()]
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_SECONDARY_PAGES);
  for (const item of secondaryScores) {
    addSelectedPage(selected, pages, item.index, item.reason, item.score);
  }

  const selectedPages = toSelectedPages(selected, pages);
  const text = buildReportContextText(pages, selected, metrics, financialFacts);
  const evidenceRows = financialFacts.filter((fact, index) => financialFacts.findIndex((other) => other.pageNumber === fact.pageNumber && other.rowNumber === fact.rowNumber) === index);
  // Put the exact financial rows and their source headings before long pages so
  // truncation cannot leave only a derived value without its original evidence.
  const rawReferenceText = [
    ...evidenceRows.map((fact) => `[PDF page ${fact.pageNumber}, row ${fact.rowNumber}; original table headings and row]\n${[...fact.headerText, fact.rowText].join("\n")}`),
    ...selectedPages.map((page) => `[PDF page ${page.pageNumber}]\n${rawPages[page.pageNumber - 1]}`)
  ].join("\n\n");
  const referenceTextTruncated = rawReferenceText.length > MAX_REPORT_REFERENCE_CHARS;
  const referenceText = referenceTextTruncated ? `${rawReferenceText.slice(0, MAX_REPORT_REFERENCE_CHARS)}\n[... selected source pages truncated ...]` : rawReferenceText;
  const contextTruncated = text.includes("[... page truncated ...]") || text.includes("[... more selected report context omitted ...]");
  const usableFinancialFactCount = financialFacts.filter((fact) => fact.usable).length;
  const unresolvedFinancialFactCount = financialFacts.length - usableFinancialFactCount;
  const completenessReasons: string[] = [];
  if (!incomeStatementFound) completenessReasons.push("income_statement_not_identified");
  if (!metrics.length) completenessReasons.push("metric_rows_not_identified");
  if (new Set(financialFacts.filter((fact) => fact.usable).map((fact) => fact.metric)).size < Object.keys(METRIC_MATCHERS).length) completenessReasons.push("key_financial_metrics_unresolved");
  if (!usableFinancialFactCount) completenessReasons.push("no_usable_financial_facts");
  if (unresolvedFinancialFactCount) completenessReasons.push("financial_fact_ambiguity");
  if (contextTruncated) completenessReasons.push("selected_context_truncated");
  if (referenceTextTruncated) completenessReasons.push("selected_reference_pages_truncated");
  if ([...secondaryByIndex.keys()].some(index => !selected.has(index))) completenessReasons.push("management_context_selection_budget");
  if (requestedTopicTerms.length && !selectedPages.some((page) => page.reasons.includes("user_topic"))) completenessReasons.push("requested_topic_not_found");
  if (requestedPageNumbers.some((number) => !selectedPages.some((page) => page.pageNumber === number && page.reasons.includes("user_page")))) completenessReasons.push("requested_page_not_found");

  return {
    text,
    referenceText,
    pageCount: pages.length,
    metrics,
    financialFacts,
    selectedPages,
    diagnostics: {
      incomeStatementFound,
      fallbackUsed: !incomeStatementFound,
      requestedPageNumbers,
      requestedTopicTerms,
      totalExtractedChars: rawPages.join("\n\n").length,
      usableFinancialFactCount,
      unresolvedFinancialFactCount,
      completeness: usableFinancialFactCount === 0 ? "insufficient" : completenessReasons.length ? "partial" : "complete",
      completenessReasons,
      contextTruncated,
      referenceTextTruncated
    }
  };
}

type InspectedReportDocument = {
  target: AttachmentMeta;
  buffer: Buffer;
  pages: string[];
  pageCount: number;
  relevant: boolean;
  score: number;
};

/** Filename hints affect the bounded inspection order; content decides relevance. */
function scoreReportDocument(pages: string[]): { relevant: boolean; score: number } {
  let bestScore = 0;
  let relevant = false;
  for (const [index, text] of pages.entries()) {
    const page = { index, pageNumber: index + 1, text, normalized: normalizeForSearch(text) };
    if (hasAnyTerm(page.normalized, CONTENTS_TERMS)) continue;
    const rows = extractMetricsFromPages([page], new Set([index]));
    const kinds = new Set(rows.map((row) => row.metric));
    const statement = hasIncomeStatementHeading(page) && kinds.size >= 1;
    const summary = kinds.size >= 2 && new Set(rows.map((row) => row.rowNumber)).size >= 2 && /\b(?:q[1-4]|h[12]|quarter(?:ly)?|kvartal|halvar|interim|financial results|financial report)\b/.test(page.normalized);
    if (statement || summary) {
      relevant = true;
      bestScore = Math.max(bestScore, scoreIncomeStatementPage(page) + kinds.size * 8 + (statement ? 20 : 0));
    }
  }
  return { relevant, score: bestScore };
}

async function inspectReportAttachments(attachments: AttachmentMeta[], messageId: number): Promise<{
  documents: InspectedReportDocument[];
  eligibleAttachmentIds: number[];
  inspectedAttachmentIds: number[];
  uninspectedAttachmentIds: number[];
  failedAttachments: Array<{ attachmentId: number; reason: string }>;
}> {
  const eligible = filterPdfs(attachments);
  const priority = (attachment: AttachmentMeta) => REPORT_FILENAME_PATTERN.test(attachment.fileName ?? "") ? 2 : YEARLY_REPORT_FILENAME_PATTERN.test(attachment.fileName ?? "") ? 0 : 1;
  const candidates = [...eligible].sort((a, b) => priority(b) - priority(a));
  const documents: InspectedReportDocument[] = [];
  const inspectedAttachmentIds: number[] = [];
  const failedAttachments: Array<{ attachmentId: number; reason: string }> = [];
  let remainingBytes = MAX_REPORT_DOWNLOAD_BYTES;
  for (const target of candidates.slice(0, MAX_REPORT_ATTACHMENTS_INSPECTED)) {
    if (remainingBytes <= 0) break;
    const maxBytes = Math.min(MAX_REPORT_PDF_BYTES, remainingBytes);
    if (target.fileSize && target.fileSize > maxBytes) {
      failedAttachments.push({ attachmentId: target.id, reason: "download_byte_budget" });
      continue;
    }
    inspectedAttachmentIds.push(target.id);
    // Reserve the whole allowance until a successful download establishes the
    // actual byte count. A failed/truncated response cannot evade the total cap.
    remainingBytes -= maxBytes;
    try {
      const buffer = await downloadAttachmentPdf(messageId, target.id, { maxBytes });
      remainingBytes += maxBytes - buffer.byteLength;
      const { pages, pageCount } = await extractPagesFromPdf(buffer, { maxPages: MAX_REPORT_PAGES_INSPECTED });
      documents.push({ target, buffer, pages, pageCount, ...scoreReportDocument(pages) });
    } catch (error) {
      failedAttachments.push({ attachmentId: target.id, reason: error instanceof Error ? error.message.slice(0, 200) : "pdf_extraction_failed" });
    }
  }
  return {
    documents,
    eligibleAttachmentIds: eligible.map((attachment) => attachment.id),
    inspectedAttachmentIds,
    uninspectedAttachmentIds: eligible.filter((attachment) => !inspectedAttachmentIds.includes(attachment.id)).map((attachment) => attachment.id),
    failedAttachments
  };
}

// ---------------------------------------------------------------------------
// TIER 2: Quarterly report extraction (existing behavior, refactored)
// ---------------------------------------------------------------------------

export async function extractReportContent(
  rawMessageJson: unknown,
  messageId: number,
  userInstruction?: string
): Promise<ReportExtractionResult | null> {
  const attachments = normalizeAttachments(rawMessageJson);
  const inspection = await inspectReportAttachments(attachments, messageId);
  const relevant = inspection.documents.filter((document) => document.relevant && document.pages.join("\n\n").trim().length >= MIN_TEXT_CHARS).sort((a, b) => b.score - a.score);
  // Keep substantively different PDFs; exact duplicate language copies waste the
  // limited context without contributing a source or a missing financial fact.
  const unique = relevant.filter((document, index) => relevant.findIndex((other) => other.pages.join("\n").trim() === document.pages.join("\n").trim()) === index);
  const selected = unique.slice(0, MAX_REPORT_ATTACHMENTS_SELECTED);
  if (!selected.length) return null;
  const contexts = selected.map((document) => ({ document, context: buildReportContextFromPages(document.pages, userInstruction, { pageCount: document.pageCount }) }));
  const primary = contexts[0];
  const attachmentHeading = (document: InspectedReportDocument) => `[PDF attachment ${document.target.id}: ${(document.target.fileName ?? "unnamed").replace(/\s+/g, " ").slice(0, 160)}]`;
  const perDocumentTextBudget = Math.floor((MAX_REPORT_CONTEXT_CHARS - 1000) / selected.length);
  const perDocumentReferenceBudget = Math.floor((MAX_REPORT_REFERENCE_CHARS - 1000) / selected.length);
  let contextTruncated = false;
  let referenceTextTruncated = false;
  const withBudget = (value: string, budget: number, reference: boolean) => {
    if (value.length <= budget) return value;
    if (reference) referenceTextTruncated = true;
    else contextTruncated = true;
    const lastLineEnd = value.lastIndexOf("\n", budget);
    return `${value.slice(0, lastLineEnd > budget / 2 ? lastLineEnd : budget)}\n[... attachment context truncated ...]`;
  };
  const text = contexts.map(({ document, context }) => `${attachmentHeading(document)}\n${withBudget(context.text, perDocumentTextBudget, false)}`).join("\n\n---\n\n");
  const referenceText = contexts.map(({ document, context }) => `${attachmentHeading(document)}\n${withBudget(context.referenceText, perDocumentReferenceBudget, true)}`).join("\n\n");
  const provenance = (document: InspectedReportDocument) => ({ attachmentId: document.target.id, attachmentName: document.target.fileName ?? null });
  const metrics = contexts.flatMap(({ document, context }) => context.metrics.map((metric) => ({ ...metric, ...provenance(document) })));
  const financialFacts = contexts.flatMap(({ document, context }) => (context.financialFacts ?? []).map((fact) => ({ ...fact, ...provenance(document) })));
  const selectedPages = contexts.flatMap(({ document, context }) => context.selectedPages.map((page) => ({ ...page, ...provenance(document) })));
  const completenessReasons = new Set(contexts.flatMap(({ context }) => context.diagnostics.completenessReasons ?? []));
  if (inspection.uninspectedAttachmentIds.length) completenessReasons.add("attachment_inspection_budget");
  if (inspection.failedAttachments.length) completenessReasons.add("attachment_extraction_failed");
  if (unique.length > selected.length) completenessReasons.add("additional_relevant_attachments_omitted");
  if (contexts.some(({ document }) => document.pages.length < document.pageCount)) completenessReasons.add("report_page_inspection_budget");
  contextTruncated ||= contexts.some(({ context }) => context.diagnostics.contextTruncated);
  referenceTextTruncated ||= contexts.some(({ context }) => context.diagnostics.referenceTextTruncated);
  if (contextTruncated) completenessReasons.add("selected_context_truncated");
  if (referenceTextTruncated) completenessReasons.add("selected_reference_pages_truncated");
  const usableFinancialFactCount = financialFacts.filter((fact) => fact.usable).length;
  return {
    text,
    referenceText,
    // Compatibility: singular page count/id describe the primary attachment.
    pageCount: primary.document.pageCount,
    attachmentId: primary.document.target.id,
    attachmentName: primary.document.target.fileName ?? null,
    metrics,
    financialFacts,
    selectedPages,
    attachments: contexts.map(({ document, context }) => ({
      ...provenance(document),
      pageCount: document.pageCount,
      extractedPageCount: document.pages.length,
      selectedPageNumbers: context.selectedPages.map((page) => page.pageNumber),
      relevanceScore: document.score
    })),
    diagnostics: {
      ...primary.context.diagnostics,
      totalExtractedChars: contexts.reduce((sum, { context }) => sum + context.diagnostics.totalExtractedChars, 0),
      usableFinancialFactCount,
      unresolvedFinancialFactCount: financialFacts.length - usableFinancialFactCount,
      completeness: usableFinancialFactCount === 0 ? "insufficient" : completenessReasons.size ? "partial" : "complete",
      completenessReasons: [...completenessReasons],
      contextTruncated,
      referenceTextTruncated,
      eligibleAttachmentIds: inspection.eligibleAttachmentIds,
      inspectedAttachmentIds: inspection.inspectedAttachmentIds,
      selectedAttachmentIds: selected.map((document) => document.target.id),
      uninspectedAttachmentIds: inspection.uninspectedAttachmentIds,
      failedAttachments: inspection.failedAttachments
    }
  };
}

// ---------------------------------------------------------------------------
// TIER 1: Yearly report targeted section extraction
// ---------------------------------------------------------------------------

export async function extractYearlyReportSections(
  rawMessageJson: unknown,
  messageId: number
): Promise<{
  letterText: string | null;
  remunerationText: string | null;
  pageCount: number;
  attachmentId: number;
} | null> {
  const attachments = normalizeAttachments(rawMessageJson);

  // Prefer Norwegian annual report (better keyword matching, output is Norwegian)
  const yearlyPdfs = filterPdfs(attachments, YEARLY_REPORT_FILENAME_PATTERN);
  const norwegianReport = yearlyPdfs.find((att) =>
    /[åa]rsrapport/i.test(att.fileName ?? "")
  );
  let target = norwegianReport ?? pickLargestAttachment(yearlyPdfs);
  if (!target) {
    target = pickLargestAttachment(filterPdfs(attachments));
  }
  if (!target) return null;

  const buffer = await downloadAttachmentPdf(messageId, target.id);
  const { pages, pageCount } = await extractPagesFromPdf(buffer);

  if (pages.length === 0) return null;

  // Scan pages for remuneration keyword matches.
  // Skip first 3 pages (cover, TOC, summary) to avoid false positives.
  const remunerationPages = new Set<number>();
  const scanStart = Math.min(3, pages.length);
  for (let i = scanStart; i < pages.length; i++) {
    if (REMUNERATION_KEYWORDS.test(pages[i])) {
      for (let j = i; j <= Math.min(pages.length - 1, i + 2); j++) {
        remunerationPages.add(j);
      }
    }
  }

  let remunerationText: string | null = null;

  if (remunerationPages.size > 0) {
    // When hits are spread across the report (TOC refs, note refs, actual section),
    // pick only the largest cluster of consecutive pages to avoid noise.
    const sorted = [...remunerationPages].sort((a, b) => a - b);
    const bestCluster = pickLargestCluster(sorted);
    remunerationText = bestCluster.map((i) => pages[i]).join("\n\n");
  }

  if (!remunerationText) return null;

  // Verify the extracted text contains actual salary/compensation amounts,
  // not just policy descriptions. Look for Norwegian-style currency amounts
  // (e.g. "20 694 474", "736 000 kroner", "15,6 mill.") or tabular salary data.
  const hasSalaryAmounts =
    /\d{1,3}[\s.]\d{3}[\s.]\d{3}/.test(remunerationText) ||      // e.g. "20 694 474"
    /\d{3}[\s.]\d{3}\s*(?:kroner|kr)/i.test(remunerationText) ||  // e.g. "736 000 kroner"
    /\d+[,.]\d\s*mill/i.test(remunerationText) ||                 // e.g. "15,6 mill."
    /(?:grunnl[øo]nn|variabel\s*l[øo]nn|pensjon|bonus)\s.*\d/i.test(remunerationText);  // salary label + number
  if (!hasSalaryAmounts) return null;

  remunerationText = truncateText(remunerationText);

  return {
    letterText: null,
    remunerationText,
    pageCount,
    attachmentId: target.id
  };
}

// ---------------------------------------------------------------------------
// TIER 3: General PDF extraction (any PDF not matching quarterly/yearly)
// ---------------------------------------------------------------------------

export async function extractGeneralPdfContent(
  rawMessageJson: unknown,
  messageId: number
): Promise<{
  text: string;
  pageCount: number;
  attachmentId: number;
} | null> {
  const attachments = normalizeAttachments(rawMessageJson);

  // Exclude PDFs that match quarterly or yearly patterns
  const generalPdfs = filterPdfs(attachments).filter((att) => {
    const name = att.fileName ?? "";
    return !REPORT_FILENAME_PATTERN.test(name) && !YEARLY_REPORT_FILENAME_PATTERN.test(name);
  });

  const target = pickLargestAttachment(generalPdfs);
  if (!target) return null;

  const buffer = await downloadAttachmentPdf(messageId, target.id);
  const { text, pageCount } = await extractTextFromPdf(buffer);

  if (text.trim().length < MIN_TEXT_CHARS) return null;

  return {
    text: truncateText(text),
    pageCount,
    attachmentId: target.id
  };
}
