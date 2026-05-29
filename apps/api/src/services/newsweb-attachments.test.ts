import { describe, expect, it, vi } from "vitest";
import {
  buildNewswebAttachmentUrl,
  createAttachmentContentDisposition,
  normalizeNewswebAttachments,
  resolveNewswebAttachmentDownload,
  sanitizeAttachmentFileName
} from "./newsweb-attachments.js";

describe("newsweb attachment helpers", () => {
  it("normalizes mixed Newsweb attachment shapes", () => {
    const attachments = normalizeNewswebAttachments({
      attachments: [
        {
          id: 7,
          name: " Rapport/Q1.pdf ",
          contentType: "application/pdf",
          size: 12345
        },
        {
          id: "8",
          fileName: "presentation.pptx",
          fileType: "application/vnd.ms-powerpoint",
          fileSize: "456"
        }
      ]
    });

    expect(attachments).toEqual([
      {
        id: 7,
        fileName: "Rapport-Q1.pdf",
        fileType: "application/pdf",
        fileSize: 12345
      },
      {
        id: 8,
        fileName: "presentation.pptx",
        fileType: "application/vnd.ms-powerpoint",
        fileSize: 456
      }
    ]);
  });

  it("falls back for missing names and skips invalid ids", () => {
    const attachments = normalizeNewswebAttachments({
      attachments: [
        { id: 9, fileSize: -1 },
        { id: 0, name: "bad.pdf" },
        { id: "not-a-number", name: "bad.pdf" },
        "bad"
      ]
    });

    expect(attachments).toEqual([
      {
        id: 9,
        fileName: "vedlegg-9",
        fileType: null,
        fileSize: null
      }
    ]);
  });

  it("returns an empty list without attachments", () => {
    expect(normalizeNewswebAttachments({})).toEqual([]);
    expect(normalizeNewswebAttachments(null)).toEqual([]);
  });

  it("sanitizes filenames for response headers", () => {
    expect(sanitizeAttachmentFileName("..\\bad\r\nname.pdf")).toBe(
      "..-bad name.pdf"
    );
    expect(createAttachmentContentDisposition("Årsrapport 2025.pdf")).toBe(
      "attachment; filename=\"_rsrapport 2025.pdf\"; filename*=UTF-8''%C3%85rsrapport%202025.pdf"
    );
  });

  it("resolves allowed downloads and calls Newsweb", async () => {
    const fetchImpl = vi.fn(async () => new Response("pdf", { status: 200 }));

    const result = await resolveNewswebAttachmentDownload({
      rawMessageJson: { attachments: [{ id: 10, name: "file.pdf" }] },
      messageId: 123,
      attachmentId: 10,
      fetchImpl
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      buildNewswebAttachmentUrl(123, 10)
    );
  });

  it("rejects unknown attachment ids without calling Newsweb", async () => {
    const fetchImpl = vi.fn(async () => new Response("pdf", { status: 200 }));

    const result = await resolveNewswebAttachmentDownload({
      rawMessageJson: { attachments: [{ id: 10, name: "file.pdf" }] },
      messageId: 123,
      attachmentId: 11,
      fetchImpl
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns upstream errors from Newsweb", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 502 }));

    const result = await resolveNewswebAttachmentDownload({
      rawMessageJson: { attachments: [{ id: 10, name: "file.pdf" }] },
      messageId: 123,
      attachmentId: 10,
      fetchImpl
    });

    expect(result).toEqual({
      ok: false,
      reason: "upstream_error",
      status: 502
    });
  });
});
