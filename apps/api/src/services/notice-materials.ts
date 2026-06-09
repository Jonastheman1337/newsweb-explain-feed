import { newswebMessageResponseSchema } from "@newsweb/shared";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export const MAX_MATERIAL_TEXT_CHARS = 15_000;
export const MAX_TOTAL_MATERIAL_TEXT_CHARS = 24_000;
export const MAX_MATERIAL_FILE_BYTES = 20 * 1024 * 1024;

const NEWSWEB_MESSAGE_URL = "https://api3.oslo.oslobors.no/v1/newsreader/message";

export function truncateMaterialText(text: string): string {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (normalized.length <= MAX_MATERIAL_TEXT_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_MATERIAL_TEXT_CHARS)}\n\n[... materialet er avkortet ...]`;
}

export function sanitizeMaterialTitle(title: string, fallback = "Materiale"): string {
  const cleaned = title
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180)
    .trim();
  return cleaned || fallback;
}

export function pdfTitleFromFileName(fileName: string): string {
  const withoutPath = fileName.split(/[\\/]/).pop() ?? fileName;
  const withoutExt = withoutPath.replace(/\.pdf$/i, "");
  return sanitizeMaterialTitle(withoutExt, "PDF-materiale");
}

export async function extractPdfMaterialText(buffer: Buffer): Promise<{
  text: string;
  pageCount: number;
}> {
  const data = new Uint8Array(buffer);
  const doc: PDFDocumentProxy = await getDocument({
    data,
    useSystemFonts: true
  }).promise;
  const pageCount = doc.numPages;
  const pages: string[] = [];

  try {
    for (let i = 1; i <= pageCount; i += 1) {
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
  } finally {
    doc.destroy();
  }

  return {
    text: truncateMaterialText(pages.join("\n\n")),
    pageCount
  };
}

export function parseNewswebMaterialMessageId(input: string): number | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (host !== "newsweb.oslobors.no" && !host.endsWith(".newsweb.oslobors.no")) {
      return null;
    }
    const messageMatch = url.pathname.match(/\/message\/(\d+)/i);
    const fromPath = messageMatch ? Number(messageMatch[1]) : null;
    const fromQuery = Number(url.searchParams.get("messageId") ?? "");
    const id = fromPath ?? (Number.isSafeInteger(fromQuery) && fromQuery > 0 ? fromQuery : null);
    return id && Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export async function fetchNewswebMaterial(
  messageId: number,
  fetchImpl: typeof fetch = fetch
): Promise<{
  title: string;
  text: string;
  metadata: {
    messageId: number;
    issuerName: string | null;
    issuerSign: string | null;
    publishedAt: string | null;
  };
}> {
  const response = await fetchImpl(`${NEWSWEB_MESSAGE_URL}?messageId=${messageId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Newsweb message ${messageId} failed: ${response.status}`);
  }

  const parsed = newswebMessageResponseSchema.parse(await response.json());
  const message = parsed.data.message;
  const text = truncateMaterialText(message.body ?? "");
  if (!text) {
    throw new Error(`Newsweb message ${messageId} has no source text`);
  }

  return {
    title: sanitizeMaterialTitle(message.title, `Newsweb ${messageId}`),
    text,
    metadata: {
      messageId,
      issuerName: message.issuerName ?? null,
      issuerSign: message.issuerSign ?? null,
      publishedAt: message.publishedTime ?? null
    }
  };
}
