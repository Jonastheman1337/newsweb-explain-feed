import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  publishedRewrite: { findFirst: vi.fn() },
  feedItem: { findUnique: vi.fn() },
  generationRun: { findUnique: vi.fn() }
}));
vi.mock("@newsweb/shared/db", () => ({
  prisma: { publishedRewrite: mocks.publishedRewrite, feedItem: mocks.feedItem },
  logPrisma: { generationRun: mocks.generationRun }
}));
import { noticeRoutes } from "./notice.js";

let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  vi.resetAllMocks();
  app = Fastify();
  app.decorate("authenticate", async () => undefined);
  app.decorate("config", { FAST_DRAFT_ENABLED: false });
  await app.register(noticeRoutes);
});
afterEach(async () => app.close());

describe("GET /notice/:messageId/model-source", () => {
  it("returns the PDF text the active version's generation run read", async () => {
    mocks.feedItem.findUnique.mockResolvedValue({
      activePublishedRewrite: { id: "pub-1", generationRunId: "run-1" }
    });
    mocks.generationRun.findUnique.mockResolvedValue({
      inputJson: {
        sourcePayload: {
          bodyText: "Notice body",
          pdfSupplementText: "[PDF page 1]\nReport text",
          pdfSupplementPageCount: 12,
          pdfSupplementAttachmentId: 7
        },
        modelCalls: [{ secret: "never leaves" }]
      }
    });
    const response = await app.inject({ method: "GET", url: "/notice/42/model-source" });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      rewriteId: "pub-1",
      text: "[PDF page 1]\nReport text",
      pageCount: 12,
      attachmentId: 7
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(mocks.feedItem.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { messageId: 42 } })
    );
    expect(mocks.generationRun.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "run-1" } })
    );
  });

  it("resolves an explicit version only within the same notice", async () => {
    mocks.publishedRewrite.findFirst.mockResolvedValue(null);
    const response = await app.inject({
      method: "GET",
      url: "/notice/42/model-source?rewriteId=foreign"
    });
    expect(response.statusCode).toBe(404);
    expect(mocks.publishedRewrite.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "foreign", messageId: 42 } })
    );
    expect(mocks.feedItem.findUnique).not.toHaveBeenCalled();
    expect(mocks.generationRun.findUnique).not.toHaveBeenCalled();
  });

  it("returns null text when the version has no generation run or no PDF supplement", async () => {
    mocks.publishedRewrite.findFirst.mockResolvedValue({ id: "pub-2", generationRunId: null });
    const withoutRun = await app.inject({
      method: "GET",
      url: "/notice/42/model-source?rewriteId=pub-2"
    });
    expect(withoutRun.json()).toEqual({
      rewriteId: "pub-2",
      text: null,
      pageCount: null,
      attachmentId: null
    });
    expect(mocks.generationRun.findUnique).not.toHaveBeenCalled();

    mocks.publishedRewrite.findFirst.mockResolvedValue({ id: "pub-3", generationRunId: "run-3" });
    mocks.generationRun.findUnique.mockResolvedValue({
      inputJson: { sourcePayload: { bodyText: "Only the notice", pdfSupplementText: "   " } }
    });
    const withoutPdf = await app.inject({
      method: "GET",
      url: "/notice/42/model-source?rewriteId=pub-3"
    });
    expect(withoutPdf.json()).toEqual({
      rewriteId: "pub-3",
      text: null,
      pageCount: null,
      attachmentId: null
    });
  });

  it("reads the report text stored by the quarterly and yearly report paths", async () => {
    mocks.publishedRewrite.findFirst.mockResolvedValue({ id: "pub-4", generationRunId: "run-4" });
    mocks.generationRun.findUnique.mockResolvedValue({
      inputJson: {
        sourcePayload: {
          bodyText: "Half-year notice",
          reportText: "KEY METRICS\n\n[PDF page 2]\nRevenue rose",
          reportPageCount: 48,
          reportMetrics: { revenue: 1 }
        }
      }
    });
    const report = await app.inject({ method: "GET", url: "/notice/42/model-source?rewriteId=pub-4" });
    expect(report.json()).toEqual({
      rewriteId: "pub-4",
      text: "KEY METRICS\n\n[PDF page 2]\nRevenue rose",
      pageCount: 48,
      attachmentId: null
    });

    mocks.generationRun.findUnique.mockResolvedValue({
      inputJson: { sourcePayload: { bodyText: "Annual report", remunerationText: "CEO pay table" } }
    });
    const yearly = await app.inject({ method: "GET", url: "/notice/42/model-source?rewriteId=pub-4" });
    expect(yearly.json()).toEqual({ rewriteId: "pub-4", text: "CEO pay table", pageCount: null, attachmentId: null });
  });

  it("returns 404 for a notice without a published version", async () => {
    mocks.feedItem.findUnique.mockResolvedValue(null);
    const response = await app.inject({ method: "GET", url: "/notice/42/model-source" });
    expect(response.statusCode).toBe(404);
  });
});
