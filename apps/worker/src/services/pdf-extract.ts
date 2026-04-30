// Use legacy build — the default build requires browser APIs (DOMMatrix)
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

const ATTACHMENT_URL =
  "https://api3.oslo.oslobors.no/v1/newsreader/attachment";
const MAX_TEXT_CHARS = 15_000;
const MIN_TEXT_CHARS = 500;

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

// ---------------------------------------------------------------------------
// TIER 2: Quarterly report extraction (existing behavior, refactored)
// ---------------------------------------------------------------------------

export async function extractReportContent(
  rawMessageJson: unknown,
  messageId: number
): Promise<{
  text: string;
  pageCount: number;
  attachmentId: number;
} | null> {
  const attachments = normalizeAttachments(rawMessageJson);
  const reportPdfs = filterPdfs(attachments, REPORT_FILENAME_PATTERN);
  const target = pickLargestAttachment(reportPdfs);
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
