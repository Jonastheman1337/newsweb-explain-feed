import { describe, expect, it, vi } from "vitest";
import { createNoticeNoveltyDependencies, extractNoveltyDocument, toNoveltyNotice } from "./notice-novelty-io.js";
const current = { messageId: 101, issuerSign: "TEST", title: "Invitation to Q1 2027 results",
  publishedAt: new Date("2026-09-07T09:00:00Z"), bodyText: "Q1 2027 presentation", attachments: [] };
const prior = { ...current, messageId: 100, title: "Q1 2027 results", publishedAt: new Date("2026-09-04T09:00:00Z") };
const signal = () => new AbortController().signal;
function setup(rows: unknown[] = []) {
  const db = { sourceNotice: { findMany: vi.fn(async () => rows), findUnique: vi.fn(async () => null) } };
  const fetchImpl = vi.fn<typeof fetch>();
  const deps = createNoticeNoveltyDependencies(db as unknown as Parameters<typeof createNoticeNoveltyDependencies>[0], { fetchImpl });
  return { db, fetchImpl, deps };
}
function listRow(notice: typeof current) { return { messageId: notice.messageId, newsId: notice.messageId, title: notice.title,
  issuerName: "Test", issuerSign: notice.issuerSign, publishedTime: notice.publishedAt.toISOString(), markets: [], category: [], numbAttachments: 0 }; }

describe("novelty source IO", () => {
  it("queries bounded earlier database metadata without downloading history bodies", async () => {
    const { db, deps, fetchImpl } = setup([prior]);
    expect((await deps.listMetadata(current, signal())).source).toBe("db");
    expect(db.sourceNotice.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50, where: expect.objectContaining({
      issuerSign: "TEST", publishedAt: { gte: new Date("2026-08-08T09:00:00Z"), lt: current.publishedAt } }),
      select: { messageId: true, issuerSign: true, title: true, publishedAt: true } }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("falls back to public Newsweb and excludes other issuers and same-time or future rows", async () => {
    const { deps, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(Response.json({ data: { overflow: false, messages: [prior, current,
      { ...prior, messageId: 102, issuerSign: "OTHER" }, { ...prior, messageId: 103, publishedAt: new Date("2026-10-01") }].map(listRow) } }));
    const result = await deps.listMetadata(current, signal());
    expect(result.items.map(n => n.messageId)).toEqual([100]);
    expect(result.source).toBe("newsweb");
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("fromDate=2026-08-07&toDate=2026-09-07"), expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
  });
  it("falls back after a database error, and preserves raw attachment metadata from details", async () => {
    const { db, deps, fetchImpl } = setup();
    db.sourceNotice.findMany.mockRejectedValueOnce(new Error("DB unavailable"));
    fetchImpl.mockResolvedValueOnce(Response.json({ data: { overflow: false, messages: [listRow(prior)] } }));
    await deps.listMetadata(current, signal());
    fetchImpl.mockResolvedValueOnce(Response.json({ data: { message: { ...listRow(prior), body: "Original disclosure", issuerId: 20,
      attachments: [{ id: 77, name: "Q1.pdf" }] } } }));
    const loaded = await deps.loadNotice(prior, signal());
    expect(loaded).toMatchObject({ issuerId: "20", bodyText: "Original disclosure", attachments: [{ id: 77, name: "Q1.pdf" }] });
    expect(db.sourceNotice.findUnique).not.toHaveBeenCalled();
  });
  it("marks missing or malformed current attachments incomplete", () => {
    for (const attachments of [[], [null], [{ name: "no-id.pdf" }]]) {
      expect(toNoveltyNotice({ ...current, hasAttachments: true, rawMessageJson: { attachments } }).attachmentsComplete).toBe(false);
    }
  });
  it("rejects an oversized download before reading the PDF body", async () => {
    const { deps, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(new Response("too large", { headers: { "content-length": String(17 * 1024 * 1024) } }));
    await expect(deps.readDocument(current, { id: 77, name: "Q1.pdf" }, signal())).rejects.toThrow("byte limit");
  });
  it("does no IO after cancellation and rejects non-PDF payloads", async () => {
    const { deps, fetchImpl, db } = setup();
    await expect(deps.listMetadata(current, AbortSignal.abort())).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.sourceNotice.findMany).not.toHaveBeenCalled();
    await expect(extractNoveltyDocument(Buffer.from("<html>error</html>"), signal())).rejects.toThrow("Unsupported novelty PDF");
  });
});
