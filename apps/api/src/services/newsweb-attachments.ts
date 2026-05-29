export const NEWSWEB_ATTACHMENT_URL =
  "https://api3.oslo.oslobors.no/v1/newsreader/attachment";

export type NormalizedAttachment = {
  id: number;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
};

type AttachmentDownloadResult =
  | {
      ok: true;
      attachment: NormalizedAttachment;
      response: Response;
    }
  | {
      ok: false;
      reason: "not_found";
    }
  | {
      ok: false;
      reason: "upstream_error";
      status: number;
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parsePositiveInteger(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    return null;
  }
  return numberValue;
}

function parseText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseFileSize(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return null;
  }
  return numberValue;
}

export function sanitizeAttachmentFileName(fileName: string): string {
  const cleaned = fileName
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180)
    .trim();

  if (!cleaned || cleaned === "." || cleaned === "..") {
    return "vedlegg";
  }

  return cleaned;
}

export function normalizeNewswebAttachments(
  rawMessageJson: unknown
): NormalizedAttachment[] {
  const message = asRecord(rawMessageJson);
  const rawAttachments = Array.isArray(message?.attachments)
    ? message.attachments
    : [];
  const seenIds = new Set<number>();
  const attachments: NormalizedAttachment[] = [];

  for (const rawAttachment of rawAttachments) {
    const attachment = asRecord(rawAttachment);
    if (!attachment) {
      continue;
    }

    const id = parsePositiveInteger(attachment.id);
    if (!id || seenIds.has(id)) {
      continue;
    }

    const rawName =
      parseText(attachment.fileName) ??
      parseText(attachment.name) ??
      `vedlegg-${id}`;
    const fileType =
      parseText(attachment.fileType) ?? parseText(attachment.contentType);

    attachments.push({
      id,
      fileName: sanitizeAttachmentFileName(rawName),
      fileType,
      fileSize: parseFileSize(attachment.fileSize ?? attachment.size)
    });
    seenIds.add(id);
  }

  return attachments;
}

export function findNewswebAttachment(
  rawMessageJson: unknown,
  attachmentId: number
): NormalizedAttachment | null {
  return (
    normalizeNewswebAttachments(rawMessageJson).find(
      (attachment) => attachment.id === attachmentId
    ) ?? null
  );
}

export function buildNewswebAttachmentUrl(
  messageId: number,
  attachmentId: number
): string {
  const url = new URL(NEWSWEB_ATTACHMENT_URL);
  url.searchParams.set("messageId", String(messageId));
  url.searchParams.set("attachmentId", String(attachmentId));
  return url.toString();
}

export function createAttachmentContentDisposition(fileName: string): string {
  const sanitized = sanitizeAttachmentFileName(fileName);
  const asciiFallback =
    sanitized
      .replace(/[^\x20-\x7e]+/g, "_")
      .replace(/["\\]+/g, "_")
      .trim() || "vedlegg";

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(
    sanitized
  )}`;
}

export async function resolveNewswebAttachmentDownload(options: {
  rawMessageJson: unknown;
  messageId: number;
  attachmentId: number;
  fetchImpl?: typeof fetch;
}): Promise<AttachmentDownloadResult> {
  const attachment = findNewswebAttachment(
    options.rawMessageJson,
    options.attachmentId
  );
  if (!attachment) {
    return { ok: false, reason: "not_found" };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    buildNewswebAttachmentUrl(options.messageId, options.attachmentId)
  );

  if (!response.ok) {
    return { ok: false, reason: "upstream_error", status: response.status };
  }

  return { ok: true, attachment, response };
}
