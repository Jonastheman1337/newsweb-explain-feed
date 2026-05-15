// Use legacy build — the default build requires browser APIs (DOMMatrix)
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

const ATTACHMENT_URL =
  "https://api3.oslo.oslobors.no/v1/newsreader/attachment";
const MAX_TEXT_CHARS = 15_000;
const MAX_REPORT_CONTEXT_CHARS = 24_000;
const MAX_PRIMARY_PAGE_CHARS = 4_500;
const MAX_USER_PAGE_CHARS = 3_500;
const MAX_SECONDARY_PAGE_CHARS = 3_000;
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
  rowText: string;
};

export type SelectedReportPage = {
  pageNumber: number;
  reasons: ReportPageReason[];
  score: number;
  textChars: number;
};

export type ReportExtractionDiagnostics = {
  incomeStatementFound: boolean;
  fallbackUsed: boolean;
  openAIPdfFallback?: boolean;
  requestedPageNumbers: number[];
  requestedTopicTerms: string[];
  totalExtractedChars: number;
};

export type ReportContextPack = {
  text: string;
  referenceText: string;
  pageCount: number;
  metrics: ReportMetricCandidate[];
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
  attachmentId: number
): Promise<Buffer> {
  const url = `${ATTACHMENT_URL}?messageId=${messageId}&attachmentId=${attachmentId}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download attachment ${attachmentId} for message ${messageId}: ${response.status}`
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Extract text from each page of a PDF independently.
 */
export async function extractPagesFromPdf(
  buffer: Buffer
): Promise<{ pages: string[]; pageCount: number }> {
  const data = new Uint8Array(buffer);
  const doc: PDFDocumentProxy = await getDocument({ data, useSystemFonts: true }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY: number | undefined;
    let pageText = "";
    for (const item of content.items) {
      if ("str" in item) {
        if (lastY !== undefined && lastY !== item.transform[5]) {
          pageText += "\n";
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
      }
    }
    pages.push(pageText);
  }

  doc.destroy();

  return { pages, pageCount: doc.numPages };
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
  }));
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
  target: AttachmentMeta
): Promise<PdfAttachmentDownload> {
  const buffer = await downloadAttachmentPdf(messageId, target.id);
  const { pageCount } = await extractPagesFromPdf(buffer);
  return {
    buffer,
    pageCount,
    attachmentId: target.id,
    attachmentName: target.fileName ?? null
  };
}

export async function downloadReportPdfAttachment(
  rawMessageJson: unknown,
  messageId: number
): Promise<PdfAttachmentDownload | null> {
  const attachments = normalizeAttachments(rawMessageJson);
  const target = pickLargestAttachment(filterPdfs(attachments, REPORT_FILENAME_PATTERN));
  return target ? downloadPdfTarget(messageId, target) : null;
}

export async function downloadYearlyReportPdfAttachment(
  rawMessageJson: unknown,
  messageId: number
): Promise<PdfAttachmentDownload | null> {
  const attachments = normalizeAttachments(rawMessageJson);
  const yearlyPdfs = filterPdfs(attachments, YEARLY_REPORT_FILENAME_PATTERN);
  const norwegianReport = yearlyPdfs.find((att) =>
    /[Ã¥a]rsrapport/i.test(att.fileName ?? "")
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
    context.diagnostics.requestedPageNumbers.length > 0 &&
    !context.selectedPages.some((page) => page.reasons.includes("user_page"));

  return (
    context.diagnostics.totalExtractedChars < 1200 ||
    context.metrics.length === 0 ||
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

const SECONDARY_CONTEXT_TERMS: Array<{ term: string; weight: number; reason: ReportPageReason }> = [
  { term: "ceo", weight: 6, reason: "ceo_or_management" },
  { term: "chief executive", weight: 6, reason: "ceo_or_management" },
  { term: "letter from", weight: 4, reason: "ceo_or_management" },
  { term: "konsernsjef", weight: 6, reason: "ceo_or_management" },
  { term: "administrerende direktor", weight: 6, reason: "ceo_or_management" },
  { term: "management review", weight: 5, reason: "ceo_or_management" },
  { term: "directors report", weight: 4, reason: "ceo_or_management" },
  { term: "financial review", weight: 4, reason: "ceo_or_management" },
  { term: "outlook", weight: 5, reason: "outlook_or_events" },
  { term: "guidance", weight: 4, reason: "outlook_or_events" },
  { term: "key events", weight: 4, reason: "outlook_or_events" },
  { term: "highlights", weight: 3, reason: "outlook_or_events" },
  { term: "subsequent events", weight: 4, reason: "outlook_or_events" },
  { term: "utsikter", weight: 5, reason: "outlook_or_events" },
  { term: "hendelser", weight: 3, reason: "outlook_or_events" },
  { term: "hoydepunkter", weight: 3, reason: "outlook_or_events" }
];

const METRIC_MATCHERS: Record<ReportMetricKind, RegExp[]> = {
  revenue: [
    /\b(total\s+)?(operating\s+)?revenues?\b/,
    /\bsales revenue\b/,
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
  const matches = text.match(/(?:\(\s*)?-?\d[\d\s.,]*(?:\))?/g) ?? [];
  return matches
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => /\d/.test(value))
    .slice(0, 8);
}

function extractMetricLabel(rowText: string): string {
  const numberIndex = rowText.search(/(?:\(\s*)?-?\d/);
  const label =
    numberIndex >= 0 ? rowText.slice(0, numberIndex) : rowText;
  return label.replace(/\s+/g, " ").trim().slice(0, 140);
}

function compactRowText(rowText: string): string {
  return rowText.replace(/\s+/g, " ").trim().slice(0, 320);
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
  return scoreTermWeights(page.normalized, INCOME_STATEMENT_TERMS) > 0;
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
  let score = 0;
  let reason: ReportPageReason = "ceo_or_management";
  for (const term of SECONDARY_CONTEXT_TERMS) {
    if (page.normalized.includes(term.term)) {
      score += term.weight;
      reason = term.reason;
    }
  }
  if (hasAnyTerm(page.normalized, CONTENTS_TERMS)) {
    score -= 12;
  }
  return { score: Math.max(0, score), reason };
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
  const perKindCount = new Map<ReportMetricKind, number>();

  for (const page of pages) {
    if (!pageIndexes.has(page.index)) continue;
    const lines = page.text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const normalizedLine = normalizeForSearch(line);
      const values = extractNumberValues(line);
      if (values.length === 0) continue;

      for (const kind of Object.keys(METRIC_MATCHERS) as ReportMetricKind[]) {
        if (!metricKindMatches(normalizedLine, kind)) continue;
        if ((perKindCount.get(kind) ?? 0) >= 2) continue;
        candidates.push({
          metric: kind,
          label: extractMetricLabel(line) || metricDisplayName(kind),
          values,
          pageNumber: page.pageNumber,
          rowText: compactRowText(line)
        });
        perKindCount.set(kind, (perKindCount.get(kind) ?? 0) + 1);
      }
    }
  }

  return candidates;
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
  metrics: ReportMetricCandidate[]
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

  const sections: string[] = [buildMetricSection(metrics)];
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
  userInstruction?: string
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
  const incomeStatementFound =
    (incomeScores[0]?.score ?? 0) >= INCOME_STATEMENT_SCORE_THRESHOLD &&
    !!incomeScores[0] &&
    hasIncomeStatementHeading(pages[incomeScores[0].index]);

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
    pages.length
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

  const secondaryScores = pages
    .map((page) => ({
      index: page.index,
      ...scoreSecondaryPage(page)
    }))
    .filter((item) => item.score >= 4)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
  for (const item of secondaryScores) {
    addSelectedPage(selected, pages, item.index, item.reason, item.score);
  }

  const selectedPages = toSelectedPages(selected, pages);
  const text = buildReportContextText(pages, selected, metrics);

  return {
    text,
    referenceText: text,
    pageCount: pages.length,
    metrics,
    selectedPages,
    diagnostics: {
      incomeStatementFound,
      fallbackUsed: !incomeStatementFound,
      requestedPageNumbers,
      requestedTopicTerms,
      totalExtractedChars: rawPages.join("\n\n").length
    }
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
  const reportPdfs = filterPdfs(attachments, REPORT_FILENAME_PATTERN);
  const target = pickLargestAttachment(reportPdfs);
  if (!target) return null;

  const buffer = await downloadAttachmentPdf(messageId, target.id);
  const { pages, pageCount } = await extractPagesFromPdf(buffer);
  const fullText = pages.join("\n\n");

  if (fullText.trim().length < MIN_TEXT_CHARS) return null;

  const contextPack = buildReportContextFromPages(pages, userInstruction);

  return {
    ...contextPack,
    pageCount,
    attachmentId: target.id,
    attachmentName: target.fileName ?? null
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
