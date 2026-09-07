import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderPdfTextItems } from "./pdf-extract.js";
import { buildNewswebListUrlForRange, fetchNewswebListMessages, fetchNewswebMessage } from "./newsweb-client.js";
import {
  NOTICE_NOVELTY_LIMITS, noveltyTextHash, rankNoveltyCandidates,
  type NoveltyDependencies, type NoveltyDocument, type NoveltyNotice, type NoveltyNoticeMetadata
} from "./notice-novelty.js";

const MAX_PDF_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_PDF_BYTES = 40 * 1024 * 1024;
const MAX_PAGES_PER_PDF = 80;
const MAX_TOTAL_PAGES = 160;
const MAX_EXTRACTED_CHARS = 150_000;
const MAX_RENDER_PIXELS = 2_000_000;

type StoredNoveltySource = {
  messageId: number; issuerSign: string; title: string; publishedAt: Date;
  bodyText: string; rawMessageJson: unknown; hasAttachments?: boolean;
};

export function toNoveltyNotice(source: StoredNoveltySource): NoveltyNotice {
  const raw = source.rawMessageJson as Record<string, unknown> | null;
  const rawAttachments = Array.isArray(raw?.attachments) ? raw.attachments : [];
  const attachments = rawAttachments.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const id = Number(record.id);
    if (!Number.isSafeInteger(id) || id <= 0) return [];
    return [{ id, name: String(record.name ?? record.fileName ?? "") }];
  });
  return {
    messageId: source.messageId, issuerSign: source.issuerSign, title: source.title,
    publishedAt: source.publishedAt, bodyText: source.bodyText,
    ...(typeof raw?.issuerId === "string" || typeof raw?.issuerId === "number" ? { issuerId: String(raw.issuerId) } : {}),
    attachments,
    attachmentsComplete: (!source.hasAttachments || attachments.length > 0) && attachments.length === rawAttachments.length
  };
}

async function boundedBytes(response: Response, limit: number, signal: AbortSignal): Promise<Buffer> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Novelty source HTTP ${response.status}`); }
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("Novelty source byte limit"); }
  if (!response.body) throw new Error("Novelty source has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new Error("Novelty source byte limit");
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); }
}

/** Bounded CPU/text extraction; no full-PDF model call and no process-wide worker start. */
export async function extractNoveltyDocument(buffer: Buffer, signal: AbortSignal, pageBudget = MAX_TOTAL_PAGES): Promise<NoveltyDocument> {
  signal.throwIfAborted();
  if (buffer.byteLength > MAX_PDF_BYTES || buffer.subarray(0, 5).toString() !== "%PDF-") throw new Error("Unsupported novelty PDF");
  const loading = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const abort = () => { void loading.destroy().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const doc = await loading.promise;
    if (doc.numPages > MAX_PAGES_PER_PDF || doc.numPages > pageBudget) throw new Error("Novelty PDF page limit");
    const pages: string[] = [];
    const visualHashes: string[] = [];
    let hasImages = false;
    let hasVectorGraphics = false;
    const imageHashes = new Set<string>();
    let totalChars = 0;
    type Surface = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };
    const factory = doc.canvasFactory as { create(width: number, height: number): Surface; destroy(surface: Surface): void };
    for (let index = 1; index <= doc.numPages; index++) {
      signal.throwIfAborted();
      const page = await doc.getPage(index);
      const content = await page.getTextContent();
      const text = renderPdfTextItems(content.items.filter((item): item is typeof item & { str: string; width: number; transform: number[] } => "str" in item));
      pages.push(text);
      totalChars += text.length;
      const operators = await page.getOperatorList();
      for (let opIndex = 0; opIndex < operators.fnArray.length; opIndex++) {
        const op = operators.fnArray[opIndex], args = operators.argsArray[opIndex];
        if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
          const name = args[0];
          const decoded = op === OPS.paintInlineImageXObject ? name : await new Promise<Record<string, unknown>>(resolve =>
            (String(name).startsWith("g_") ? page.commonObjs : page.objs).get(name, resolve));
          if (decoded.data instanceof Uint8Array || decoded.data instanceof Uint8ClampedArray) {
            imageHashes.add(createHash("sha256").update(`${decoded.kind}:${decoded.width}x${decoded.height}:`)
              .update(decoded.data).digest("hex"));
          } else hasVectorGraphics = true; // Unknown image representation cannot be waived.
        } else if ([OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat, OPS.paintInlineImageXObjectGroup, OPS.shadingFill].includes(op)) {
          hasVectorGraphics = true;
        } else if (op === OPS.constructPath && args[0] !== OPS.endPath) {
          const bounds = args[2];
          // pdf.js 5 folds painting into constructPath. Only thin filled rules
          // are decorative here; all other painted paths require a page match.
          if (args[0] !== OPS.fill || !bounds || Math.min(Math.abs(bounds[2] - bounds[0]), Math.abs(bounds[3] - bounds[1])) > 1) hasVectorGraphics = true;
        }
      }
      hasImages ||= text.trim().length < 12 || operators.fnArray.some(op => [
        OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject,
        OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat, OPS.paintInlineImageXObjectGroup
      ].includes(op));
      const viewport = page.getViewport({ scale: 1 });
      const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
      if (width < 1 || height < 1 || width * height > MAX_RENDER_PIXELS) throw new Error("Novelty PDF render limit");
      const surface = factory.create(width, height);
      try {
        signal.throwIfAborted();
        const task = page.render({ canvas: surface.canvas, canvasContext: surface.context, viewport });
        const cancelRender = () => task.cancel();
        signal.addEventListener("abort", cancelRender, { once: true });
        try { await task.promise; } finally { signal.removeEventListener("abort", cancelRender); }
        const pixels = surface.context.getImageData(0, 0, width, height);
        visualHashes.push(createHash("sha256").update(`${width}x${height}:`).update(Buffer.from(pixels.data.buffer)).digest("hex"));
      } finally { factory.destroy(surface); }
      page.cleanup();
      if (totalChars > MAX_EXTRACTED_CHARS) throw new Error("Novelty PDF text limit");
    }
    signal.throwIfAborted();
    const text = pages.join("\n\n");
    return {
      text, sha256: createHash("sha256").update(buffer).digest("hex"),
      textSha256: noveltyTextHash(text), pageCount: doc.numPages,
      visualSha256: createHash("sha256").update(visualHashes.join(":")).digest("hex"), hasImages,
      imageSha256s: [...imageHashes].sort(), hasVectorGraphics,
      // The evidence builder separately requires an earlier rendered-page match
      // for images. A wholly unreadable scan is still insufficient for the model.
      complete: totalChars >= 100
    };
  } finally { signal.removeEventListener("abort", abort); await loading.destroy(); }
}

/** New instance per observation, so byte/page budgets are not shared by concurrent jobs. */
export function createNoticeNoveltyDependencies(
  prisma: Pick<PrismaClient, "sourceNotice">,
  options: { fetchImpl?: typeof fetch } = {}
): NoveltyDependencies {
  const fetchImpl = options.fetchImpl ?? fetch;
  const metadataOrigins = new Map<number, "db" | "newsweb">();
  let remainingBytes = MAX_TOTAL_PDF_BYTES;
  let remainingPages = MAX_TOTAL_PAGES;
  const safeFetch = (signal: AbortSignal): typeof fetch => async (input, init) => {
    const response = await fetchImpl(input, { ...init, signal, redirect: "error" });
    const bytes = await boundedBytes(response, 12 * 1024 * 1024, signal);
    return new Response(bytes.toString("utf8"), { status: response.status, headers: { "content-type": "application/json" } });
  };
  return {
    async listMetadata(source, signal) {
      signal.throwIfAborted();
      const from = new Date(source.publishedAt.getTime() - NOTICE_NOVELTY_LIMITS.lookbackDays * 86_400_000);
      let stored: NoveltyNoticeMetadata[] = [];
      try {
        stored = await prisma.sourceNotice.findMany({
          where: { issuerSign: source.issuerSign, messageId: { not: source.messageId }, publishedAt: { gte: from, lt: source.publishedAt } },
          select: { messageId: true, issuerSign: true, title: true, publishedAt: true },
          orderBy: { publishedAt: "desc" }, take: NOTICE_NOVELTY_LIMITS.metadataCount
        });
      } catch { /* Bounded official-source fallback below. */ }
      signal.throwIfAborted();
      stored.forEach(row => metadataOrigins.set(row.messageId, "db"));
      if (rankNoveltyCandidates(source, stored).length) return { items: stored, source: "db" };
      // UTC list dates are retrieval padding; the ranker enforces exact earlier timestamps.
      const rows = await fetchNewswebListMessages(
        buildNewswebListUrlForRange(new Date(from.getTime() - 86_400_000).toISOString().slice(0, 10), source.publishedAt.toISOString().slice(0, 10)), safeFetch(signal)
      );
      const remote = rows.filter(row => row.issuerSign === source.issuerSign).map(row => ({
        messageId: row.messageId, issuerSign: source.issuerSign, title: row.title,
        publishedAt: new Date(row.publishedTime)
      })).filter(row => Number.isFinite(row.publishedAt.getTime()) && row.publishedAt >= from && row.publishedAt < source.publishedAt)
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .slice(0, NOTICE_NOVELTY_LIMITS.metadataCount);
      remote.forEach(row => metadataOrigins.set(row.messageId, "newsweb"));
      const combined = [...new Map([...stored, ...remote].map(row => [row.messageId, row])).values()]
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, NOTICE_NOVELTY_LIMITS.metadataCount);
      return { items: combined, source: "newsweb" };
    },
    async loadNotice(metadata, signal) {
      signal.throwIfAborted();
      if (metadataOrigins.get(metadata.messageId) !== "newsweb") {
        try {
          const stored = await prisma.sourceNotice.findUnique({ where: { messageId: metadata.messageId }, select: {
            messageId: true, issuerSign: true, title: true, publishedAt: true, bodyText: true, rawMessageJson: true, hasAttachments: true
          } });
          signal.throwIfAborted();
          if (stored) return toNoveltyNotice(stored);
        } catch { signal.throwIfAborted(); }
      }
      const details = await fetchNewswebMessage(metadata.messageId, safeFetch(signal));
      const message = details.message;
      if (!message.issuerSign || !message.publishedTime) return null;
      return toNoveltyNotice({ messageId: message.messageId, issuerSign: message.issuerSign, title: message.title,
        publishedAt: new Date(message.publishedTime), bodyText: details.bodyText,
        rawMessageJson: details.rawMessageJson, hasAttachments: details.hasAttachments });
    },
    async readDocument(notice, attachment, signal) {
      signal.throwIfAborted();
      const url = `https://api3.oslo.oslobors.no/v1/newsreader/attachment?messageId=${notice.messageId}&attachmentId=${attachment.id}`;
      const response = await fetchImpl(url, { signal, redirect: "error" });
      const buffer = await boundedBytes(response, Math.min(MAX_PDF_BYTES, remainingBytes), signal);
      remainingBytes -= buffer.byteLength;
      const document = await extractNoveltyDocument(buffer, signal, remainingPages);
      remainingPages -= document.pageCount;
      return document;
    }
  };
}
